import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGraph } from '../src/domain/graph';
import type { Graph } from '../src/domain/types';
import { webDesignTeamTemplates } from '../src/domain/web-design-team-templates';
import { executeGraph, type EngineServices, type ModelInput } from '../src/engine';
import { scopeModel } from './scope-fixture';
import { designSource, engineeringSource, originalSkill } from './web-design-skill-fixture';

function services(respond: (request: ModelInput) => string): EngineServices {
  return {
    scopeModel, asset: originalSkill,
    model: async request => ({text: respond(request)}),
    tool: async name => { throw Error('웹 디자인 예제에서 예기치 않은 도구 호출 ' + name); },
  };
}

function assertRoleSkills(request: ModelInput, graph: Graph, title: string, ...originals: string[]) {
  assert.equal(request.instruction.includes(designSource), originals.includes('frontend-design'));
  assert.equal(request.instruction.includes(engineeringSource), originals.includes('frontend-ui-engineering'));
  const skills = graph.nodes.filter(node => node.type === 'instruction.skill' && !node.config.assetId);
  const assigned = skills.find(node => node.title === title);
  assert.ok(assigned, title);
  for (const skill of skills) {
    const content = skill.config.content;
    assert.ok(typeof content === 'string' && content.trim().length > 0, skill.title);
    assert.equal(request.instruction.includes(content), skill === assigned, skill.title);
  }
}

test('공통 UI의 변경 예시와 주문·반품 회귀 시험이 함께 전달된다', async () => {
  const lesson = webDesignTeamTemplates.find(item => item.id === 'web-design-shared-ui')!;
  assert.deepEqual(validateGraph(lesson.graph), []);
  const proposal = '공통 필터 버튼에 선택 상태를 표시하고 화면별 상태값과 검색을 유지합니다.';
  const checks = '배송 중은 ORD-1002, 접수는 RET-2001 한 건입니다. 키보드로 전체를 선택해 각각 3건과 2건을 확인하세요.';
  const run = await executeGraph(lesson.graph, {input: lesson.question, runId: 'shared-filter'}, services(request => {
    if (request.input === lesson.question) {
      assertRoleSkills(request, lesson.graph, '공통 UI 개선 Skill', 'frontend-design', 'frontend-ui-engineering');
      assert.match(request.context, /renderOrders/);
      assert.match(request.context, /renderReturns/);
      return proposal;
    }
    assert.equal(request.input, proposal);
    assertRoleSkills(request, lesson.graph, '화면 검증 Skill', 'frontend-ui-engineering');
    assert.match(request.context, /ORD-1002/);
    assert.match(request.context, /RET-2001/);
    return checks;
  }));
  assert.equal(run.status, 'completed', run.error ?? run.status);
  assert.ok(run.output.includes(proposal));
  assert.ok(run.output.includes(checks));
});

test('화면별 담당자는 개발 결과를 받아 검토하고, 담당자가 입력한 반영 범위와 근거가 같은 실행에 남는다', async () => {
  const lesson = webDesignTeamTemplates.find(item => item.id === 'web-design-rollout')!;
  assert.deepEqual(validateGraph(lesson.graph), []);
  const impact = '영향 범위: 공통 필터, 주문 목록, 반품 목록';
  const change = '변경 예시: 선택 표시와 전체 복구를 한 공통 버튼에 연결했습니다.';
  const evidence = ['주문 검증: 1,280px에서 해제 후 3건 복구.', '반품 검증: 1,440px에서 해제 후 1건만 표시.'];
  const checked: string[] = [];
  const adapters = services(request => {
    if (request.input === lesson.question) {
      assertRoleSkills(request, lesson.graph, '변경 영향 조사 Skill', 'frontend-design');
      return impact;
    }
    if (request.input === impact) {
      assertRoleSkills(request, lesson.graph, '공통 UI 개선 Skill', 'frontend-design', 'frontend-ui-engineering');
      assert.match(request.context, /renderOrders/);
      assert.match(request.context, /renderReturns/);
      return change;
    }
    assert.equal(request.input, change);
    assertRoleSkills(request, lesson.graph, '화면 검증 Skill', 'frontend-ui-engineering');
    const role = /^역할: (.+)$/m.exec(request.instruction)?.[1];
    assert.ok(role === '기준 화면 검토자' || role === '연관 화면 검토자');
    checked.push(role);
    assert.match(request.context, /1,280px.*3건/);
    assert.match(request.context, /1,440px.*1건/);
    return evidence[role === '기준 화면 검토자' ? 0 : 1];
  });
  const run = {input: lesson.question, runId: 'rollout'};
  const waiting = await executeGraph(lesson.graph, run, adapters);
  assert.equal(waiting.status, 'waiting', waiting.error ?? waiting.status);
  assert.deepEqual(checked.sort(), ['기준 화면 검토자', '연관 화면 검토자']);
  for (const text of [impact, change, ...evidence]) assert.ok(waiting.wait!.prompt.includes(text), text);
  const decision = {'반영 범위': '공통 필터 반영 보류', '판단 근거': '반품에서 전체 2건이 복구되지 않았습니다.'};
  const result = await executeGraph(lesson.graph, {...run, checkpoint: waiting.checkpoint,
    reply: {waitId: waiting.wait!.id, value: JSON.stringify(decision)}}, adapters);
  assert.equal(result.status, 'completed', result.error ?? result.status);
  for (const text of [impact, change, ...evidence, ...Object.values(decision)]) assert.ok(result.output.includes(text), text);
  assert.equal(checked.length, 2, '반영 범위를 입력한 뒤 이미 수행한 검토를 반복하지 않습니다.');
});

test('설정·권한 대화상자의 닫기 동작을 맡기면 개발과 검토가 요청한 두 화면의 근거를 받는다', async () => {
  const request = '편집기의 설정과 권한 대화상자에서 Escape로 닫으면 포커스가 사라집니다. 공통 대화상자를 고쳐 연 버튼에 포커스를 돌려주세요.';
  const proposal = '설정과 권한을 연 버튼을 각각 기억하고 대화상자를 닫을 때 해당 버튼에 포커스를 돌려주는 변경 예시입니다.';
  const checks = '설정과 권한을 각각 키보드로 열고 Escape로 닫아, 각 화면에서 해당 버튼에 포커스가 있는지 확인하세요.';
  for (const lesson of webDesignTeamTemplates) {
    let reviews = 0;
    const servicesForDialogs = services(({instruction, context, input}) => {
      assert.doesNotMatch(instruction, /공통 필터 구현|필터의 선택 표시|키보드로 필터 해제|검색 결과 0건/,
        '실제 프로젝트에서 모든 역할이 필터를 만들거나 빈 목록을 시험하도록 고정하면 안 됩니다.');
      if (input === request && lesson.level === '전문가') return '기준은 설정, 연관 화면은 권한이며 공통 대화상자 닫기 코드가 두 화면에 영향을 줍니다.';
      if (input !== proposal) return proposal;
      assert.ok(context.includes(request), '검토자가 원래 요청의 두 화면과 조작을 확인할 수 있습니다.');
      reviews++;
      return checks;
    });
    const run = await executeGraph(lesson.graph, {input: request, runId: lesson.id + '-dialogs'}, servicesForDialogs);
    assert.equal(run.status, lesson.level === '고급' ? 'completed' : 'waiting', run.error ?? run.status);
    assert.equal(reviews, lesson.level === '고급' ? 1 : 2);
    const report = run.wait?.prompt ?? run.output;
    assert.ok(report.includes(proposal) && report.includes(checks));
    assert.doesNotMatch(report, /ORD-1002|RET-2001/);
  }
});
