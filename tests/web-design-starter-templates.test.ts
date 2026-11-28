import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateGraph } from '../src/domain/graph';
import { webDesignStarterTemplates } from '../src/domain/web-design-starter-templates';
import { executeGraph, type EngineServices } from '../src/engine';
import { completedRunFiles } from '../src/engine/legacy-files';
import { scopeModel } from './scope-fixture';
import { designSource, engineeringSource, originalSkill } from './web-design-skill-fixture';

function lessonFor(id: string) {
  const lesson = webDesignStarterTemplates.find(item => item.id === id);
  assert.ok(lesson, id);
  assert.deepEqual(validateGraph(lesson.graph), []);
  return lesson;
}

function services(model: EngineServices['model']): EngineServices {
  return {
    model, scopeModel, asset: originalSkill,
    tool: async name => { throw new Error('이 실습에서 예상하지 않은 도구 호출 ' + name); },
  };
}

test('입문 진단은 사용자의 요청과 주문 목록의 관찰 근거를 받아 우선 개선 한 가지를 전달한다', async () => {
  const lesson = lessonFor('web-design-diagnose');
  const finding = '배송 중을 누르면 ORD-1002만 남지만 어떤 필터가 켜졌는지 알기 어렵습니다.';
  const result = await executeGraph(lesson.graph, {input: lesson.question, runId: 'order-diagnosis'}, services(async request => {
    assert.equal(request.input, lesson.question);
    assert.match(request.context, /ORD-1002/);
    assert.match(request.context, /배송 중/);
    assert.match(request.instruction, /한 가지/);
    assert.match(request.instruction, /등록된 작업 지침 \(화면 진단 Skill · 1판\)/);
    assert.ok(request.instruction.includes(designSource));
    assert.ok(!request.instruction.includes(engineeringSource));
    assert.doesNotMatch(request.instruction, /## 참고한 원본/);
    assert.match(request.instruction, /조작 전후/);
    return {text: finding};
  }));
  assert.equal(result.status, 'completed', result.error ?? result.status);
  assert.equal(result.output, finding);
});

test('초급 개선안에는 현재 필터 소스가 전달되고 결과 파일의 본문이 화면 답변과 같다', async () => {
  const lesson = lessonFor('web-design-component');
  const answer = '기존 버튼에 aria-pressed를 반영합니다. 배송 중을 켰다가 전체를 키보드로 누르면 세 주문이 보이는지 확인하세요.';
  const result = await executeGraph(lesson.graph, {input: lesson.question, runId: 'order-component'}, services(async request => {
    assert.equal(request.input, lesson.question);
    assert.match(request.context, /renderOrders/);
    assert.match(request.context, /배송 중/);
    assert.match(request.instruction, /키보드/);
    assert.ok(request.instruction.includes(engineeringSource));
    assert.ok(!request.instruction.includes(designSource));
    return {text: answer};
  }));
  assert.equal(result.status, 'completed', result.error ?? result.status);
  assert.equal(result.output, answer);
  const files = completedRunFiles(lesson.graph, result.checkpoint);
  assert.deepEqual(files.map(file => [file.fileName, file.content]), [['컴포넌트-개선.md', answer]]);
});

test('초급 사본에서 Skill을 수정하면 같은 질문을 처리하는 Agent에 새 지침이 전달된다', async () => {
  const lesson = lessonFor('web-design-component');
  const graph = structuredClone(lesson.graph);
  const skill = graph.nodes.find(node => node.type === 'instruction.skill');
  assert.ok(skill);
  const original = String(skill.config.content);
  const addition = '선택 상태를 색과 글자로 함께 표시한다';
  assert.ok(!original.includes(addition));
  const instructions: string[] = [];
  const adapter = services(async request => {
    assert.equal(request.input, lesson.question);
    instructions.push(request.instruction);
    return {text: '기존 버튼의 선택 표시를 확인합니다.'};
  });
  for (const content of [original, original + '\n' + addition]) {
    skill.config.content = content;
    const result = await executeGraph(graph, {input: lesson.question, runId: crypto.randomUUID()}, adapter);
    assert.equal(result.status, 'completed', result.error ?? result.status);
  }
  assert.equal(instructions.length, 2);
  assert.ok(instructions[0].includes(original) && !instructions[0].includes(addition));
  assert.ok(instructions[1].includes(original + '\n' + addition));
});

test('중급은 재현 가능한 요청을 바로 처리하고 모호한 요청만 회신을 받아 같은 실행을 이어간다', async () => {
  const lesson = lessonFor('web-design-flow');
  const incomplete = '필터를 쓰다 막혔어요.';
  const clarification = '주문 목록에서 배송 중을 누르고 없는상품을 검색했습니다. 주문이 한 건도 보이지 않아요.';
  for (const initial of [lesson.question, incomplete]) {
    const answer = '빈 결과를 안내하고 검색어와 상태를 함께 해제해 주문 3건을 복구합니다.';
    const adapter = services(async request => {
      if (request.instruction.includes('"category"')) {
        assert.equal(request.input, initial);
        assert.doesNotMatch(request.instruction, /사용 흐름 개선 Skill/);
        assert.ok(!request.instruction.includes(engineeringSource));
        return {text: JSON.stringify({category: initial === incomplete ? null : '재현 가능'})};
      }
      assert.ok(String(request.input).includes(initial));
      if (initial === incomplete) assert.ok(String(request.input).includes(clarification));
      assert.match(request.context, /renderOrders/);
      assert.match(request.context, /0건/);
      assert.match(request.instruction, /등록된 작업 지침 \(사용 흐름 개선 Skill · 1판\)/);
      assert.ok(request.instruction.includes(engineeringSource));
      return {text: answer};
    });
    const input = {input: initial, runId: crypto.randomUUID()};
    let result = await executeGraph(lesson.graph, input, adapter);
    if (initial === incomplete) {
      assert.equal(result.status, 'waiting', result.error ?? result.status);
      assert.match(result.wait!.prompt, /화면/);
      result = await executeGraph(lesson.graph, {
        ...input, checkpoint: result.checkpoint, reply: {waitId: result.wait!.id, value: clarification},
      }, adapter);
    }
    assert.equal(result.status, 'completed', result.error ?? result.status);
    assert.equal(result.output, answer);
  }
});

test('내 프로젝트의 저장 폼도 진단·컴포넌트 개선·작업 흐름 개선에 바로 전달된다', async () => {
  const input = '내 프로젝트의 프로필 편집 화면에서 이름을 비우고 저장하면 오류가 뜨지만 포커스는 저장 버튼에 남아요. 잘못된 입력란으로 이동하게 해 주세요.';
  const finding = '저장 실패 후 이름 입력란에 포커스가 있는지 확인합니다.';
  for (const lesson of webDesignStarterTemplates) {
    const result = await executeGraph(lesson.graph, {input, runId: crypto.randomUUID()}, {
      asset: originalSkill,
      scopeModel: async request => {
        const {purpose} = JSON.parse(request.context);
        assert.doesNotMatch(purpose, /필터|목록|선택 상태/);
        return {text: '{"status":"in_scope"}'};
      },
      model: async request => {
        assert.equal(request.input, input);
        assert.doesNotMatch(request.instruction, /renderOrders|배송 중|검색어|빈 결과|전체 목록/);
        if (request.instruction.includes('"category"')) return {text: '{"category":"재현 가능"}'};
        return {text: finding};
      },
      tool: async name => { throw new Error('이 실습에서 예상하지 않은 도구 호출 ' + name); },
    });
    assert.equal(result.status, 'completed', result.error ?? result.status);
    assert.equal(result.output, finding);
  }
});
