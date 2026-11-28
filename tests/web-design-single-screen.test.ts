import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {templates, validateGraph} from '../src/domain';
import {executeGraph, type EngineServices} from '../src/engine';
import {scopeModel} from './scope-fixture';
import {designSource, engineeringSource, originalSkill} from './web-design-skill-fixture';

const names = {visual:'시각 디자인 담당', accessibility:'접근성 검토 담당', developer:'UI 개발 담당', qa:'화면 검증 담당'} as const;
type Role = keyof typeof names;

function readLesson() {
  const lesson = templates.find(item => item.id === 'web-design-single-screen');
  assert.ok(lesson);
  assert.deepEqual(validateGraph(lesson.graph), []);
  return lesson;
}

function services(model: EngineServices['model']): EngineServices {
  return {model, scopeModel, asset:originalSkill, tool: async name => { throw Error('예기치 않은 도구 호출 ' + name); }};
}

function roleOf(instruction: string): Role {
  const role = /^역할: (.+)$/m.exec(instruction)?.[1];
  const id = (Object.keys(names) as Role[]).find(key => names[key] === role);
  assert.ok(id, '예제에 등록된 역할 ' + role);
  return id;
}

test('네 담당자가 주문 목록 동작 설명 하나를 받아 병렬 검토와 개발·검증 결과를 전달한다', async () => {
  const lesson = readLesson();
  const resources = lesson.graph.nodes.filter(node => node.type === 'resource.context');
  assert.deepEqual(resources.map(node => node.title), ['주문 목록 동작 설명']);
  const [description] = resources;
  const recipients = lesson.graph.edges.filter(edge => edge.from === description.id && edge.kind === 'reference' && edge.input === 'context');
  assert.deepEqual(recipients.map(edge => edge.to).sort(), Object.keys(names).sort());
  const behavior: string = description.config.content;
  assert.match(behavior, /배송 중/);
  assert.match(behavior, /Tab|키보드/);
  assert.match(behavior, /전체/);
  assert.doesNotMatch(behavior, /<button\b|renderOrders|orderStatus|\.filter-button/);
  const results = {visual:'선택한 배송 중 버튼에 체크 표시를 붙입니다.', accessibility:'키보드 초점 테두리와 눌림 상태를 구분합니다.',
    developer:'기존 상태 버튼에 체크 표시와 aria-pressed를 함께 적용합니다.', qa:'배송 중에서 한 건, 전체로 돌아가면 세 건을 확인합니다.'};
  const reviews = new Set<Role>();
  const completed: Role[] = [];
  let parallelReviews = false;
  const run = await executeGraph(lesson.graph, {input:lesson.question, runId:'single-screen'}, services(async request => {
    const role = roleOf(request.instruction);
    assert.equal(request.instruction.includes(designSource), role === 'visual' || role === 'developer', names[role]);
    assert.equal(request.instruction.includes(engineeringSource), role !== 'visual', names[role]);
    for (const line of behavior.split('\n').filter(Boolean)) assert.ok(request.context.includes(line), names[role]);
    if (role === 'visual' || role === 'accessibility') {
      assert.equal(request.input, lesson.question);
      reviews.add(role);
      if (reviews.size === 2) parallelReviews = true;
      await nextTurn();
      reviews.delete(role);
    } else {
      assert.ok(request.context.includes(lesson.question), names[role]);
      if (role === 'developer') {
        for (const reviewer of ['visual', 'accessibility'] as const) {
          assert.ok(completed.includes(reviewer));
          assert.ok(request.input.includes(names[reviewer]) && request.input.includes(results[reviewer]));
        }
      } else {
        assert.ok(completed.includes('developer'));
        assert.ok(request.input.includes(results.developer));
      }
    }
    completed.push(role);
    return {text:results[role]};
  }));
  assert.equal(run.status, 'completed', run.error ?? run.status);
  assert.ok(parallelReviews, '두 검토 요청이 동시에 실행됩니다.');
  assert.equal(completed.length, 4);
  for (const role of completed) assert.ok(run.output.includes(names[role] + '\n' + results[role]), names[role]);
});

test('사본에서 동작 설명 하나를 프로필 편집 사례로 바꾸면 네 담당자가 새 설명을 받는다', async () => {
  const graph = structuredClone(readLesson().graph);
  const behavior = graph.nodes.find(node => node.id === 'behavior' && node.type === 'resource.context');
  assert.ok(behavior);
  const previousLine = behavior.config.content.trim().split('\n').find((line: string) => line.includes('배송 중'));
  assert.ok(previousLine);
  const newBehavior = '이름을 비우고 저장하면 테두리만 빨갛게 표시되고 초점은 저장 버튼에 남습니다. 오류 문구와 함께 이름 입력란으로 초점을 옮겨 주세요.';
  behavior.config.content = newBehavior;
  const question = '프로필 편집 화면에서 이름 입력 오류가 색으로만 보입니다. 저장을 누르면 이름 필드 아래에 오류를 표시하고 포커스를 돌려주세요.';
  const seen = new Set<Role>();
  const run = await executeGraph(graph, {input:question, runId:'profile-screen'}, services(async request => {
    const role = roleOf(request.instruction);
    seen.add(role);
    assert.ok(request.context.includes(newBehavior), names[role]);
    assert.ok(!request.context.includes(previousLine), names[role]);
    if (role === 'visual' || role === 'accessibility') assert.equal(request.input, question);
    else assert.ok(request.context.includes(question), names[role]);
    return {text:names[role] + ' — 프로필 편집의 이름 오류와 포커스를 확인합니다.'};
  }));
  assert.equal(run.status, 'completed', run.error ?? run.status);
  assert.equal(seen.size, 4);
});

test('한 검토가 실패하면 개발과 화면 검증을 시작하지 않는다', async () => {
  const lesson = readLesson();
  const called: Role[] = [];
  const run = await executeGraph(lesson.graph, {input:lesson.question, runId:'missing-review'}, services(async request => {
    const role = roleOf(request.instruction);
    called.push(role);
    if (role === 'accessibility') throw Error('접근성 검토에 실패했습니다.');
    return {text:'선택한 버튼의 글자 굵기를 바꿉니다.'};
  }));
  assert.equal(run.status, 'failed');
  assert.ok(called.includes('accessibility'));
  assert.ok(!called.includes('developer') && !called.includes('qa'));
});
