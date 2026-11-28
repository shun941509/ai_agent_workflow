import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {templates, validateGraph} from '../src/domain';
import {executeGraph, type EngineServices} from '../src/engine';
import {scopeModel} from './scope-fixture';
import {codeReviewSource, originalSkill, tddSource} from './web-design-skill-fixture';

function lessonForTest() {
  const lesson = templates.find(item => item.id === 'web-design-tdd-review');
  assert.ok(lesson);
  assert.deepEqual(validateGraph(lesson.graph), []);
  return lesson;
}

const scenarios = [
  {reply:'동의', development:'주문 예제에서 선택 표시가 사라진 실패와 표시 추가 후 통과를 비교합니다.'},
  {reply:'저장한 이름이 비어 있으면 오류 문구가 이름 입력란 아래에 보여야 합니다.', development:'프로필 수정본과 테스트 실행 기록을 받으면 실패·통과를 대조할 수 있습니다.'},
];

for (const [index, scenario] of scenarios.entries()) {
  test('확정한 범위와 같은 변경 기록으로 TDD 개발 후 두 축을 병렬 검토한다 · ' + scenario.reply, async () => {
    const lesson = lessonForTest();
    const graph = structuredClone(lesson.graph);
    const evidence = graph.nodes.find(node => node.id === 'evidence')!;
    const rules = graph.nodes.find(node => node.id === 'rules')!;
    const criterion = index === 0 ? lesson.question : '프로필 화면에서 이름 저장 오류를 알 수 있어야 합니다.';
    if (index === 1) {
      evidence.config.content = '프로필 화면 작업 사본의 변경 차이와 실행 기록이 아직 제출되지 않았습니다.';
      rules.config.content = '프로필 편집기는 오류 문구에 필드 이름을 사용합니다.';
    }
    const destinations = (id: string) => graph.edges.filter(edge => edge.from === id && edge.kind === 'reference').map(edge => edge.to).sort();
    assert.deepEqual(destinations('evidence'), ['developer','spec','standards']);
    assert.deepEqual(destinations('rules'), ['developer','standards']);
    assert.deepEqual(destinations('skill-tdd'), ['developer']);
    assert.deepEqual(destinations('skill-code-review'), ['spec','standards']);
    const roles: string[] = [];
    const reviewInputs: string[] = [];
    let pendingReviews = 0;
    let concurrent = false;
    const reviewReports = {standards:'규칙 검토에서 확인한 근거', spec:'개선 기준 검토에서 확인한 근거'};
    const services: EngineServices = {
      scopeModel, asset:originalSkill, tool:async name => { throw Error('예기치 않은 도구 호출 ' + name); },
      model:async request => {
        const role = graph.nodes.find(node => node.type === 'agent.delegate' && request.instruction.includes('역할: ' + node.config.role + '\n'))!;
        assert.ok(role);
        roles.push(role.id);
        const developing = role.id === 'developer';
        assert.equal(request.instruction.includes(tddSource), developing);
        assert.equal(request.instruction.includes(codeReviewSource), !developing);
        for (const line of evidence.config.content.split('\n').filter(Boolean)) assert.ok(request.context.includes(line));
        for (const line of rules.config.content.split('\n').filter(Boolean)) assert.equal(request.context.includes(line), role.id !== 'spec');
        if (developing) {
          assert.ok(request.context.includes(criterion));
          assert.ok(request.input.includes(scenario.reply));
          return {text:scenario.development};
        }
        assert.ok(request.input.includes(scenario.development));
        reviewInputs.push(request.input);
        assert.ok(!request.input.includes(reviewReports.standards) && !request.input.includes(reviewReports.spec));
        if (role.id === 'spec') {
          assert.ok(request.input.includes(scenario.reply));
          assert.ok(request.context.includes(criterion));
        }
        pendingReviews++;
        if (pendingReviews === 2) concurrent = true;
        await nextTurn();
        pendingReviews--;
        return {text:reviewReports[role.id as keyof typeof reviewReports]};
      },
    };
    const start = {runId:'tdd-review-' + index, input:criterion};
    const waiting = await executeGraph(graph, start, services);
    assert.equal(waiting.status, 'waiting', waiting.error ?? '');
    assert.deepEqual(roles, []);
    assert.ok(waiting.wait?.prompt.includes(criterion));
    assert.deepEqual(waiting.wait!.fields, [{name:'확정한 테스트 범위', required:true}]);
    const resumed = await executeGraph(graph, {...start, checkpoint:waiting.checkpoint,
      reply:{waitId:waiting.wait!.id, value:JSON.stringify({'확정한 테스트 범위':scenario.reply})}}, services);
    assert.equal(resumed.status, 'completed', resumed.error ?? '');
    assert.deepEqual([...roles].sort(), ['developer','spec','standards']);
    assert.equal(roles[0], 'developer');
    assert.ok(concurrent);
    assert.equal(reviewInputs[0], reviewInputs[1]);
    for (const [section, result] of [
      ['TDD 개발 기록',scenario.development], ['Standards · 코딩 규칙 검토',reviewReports.standards], ['Spec · 개선 기준 검토',reviewReports.spec],
    ]) assert.ok(resumed.output.includes(section + '\n' + result), section);
  });
}

test('검토 하나가 실패하면 완성된 두 축의 검토 보고서를 내보내지 않는다', async () => {
  const lesson = lessonForTest();
  const services: EngineServices = {
    scopeModel, asset:originalSkill, tool:async name => { throw Error('예기치 않은 도구 호출 ' + name); },
    model:async request => {
      if (request.instruction.includes('역할: 코딩 규칙 검토 담당\n')) throw Error('규칙 검토 중 연결 끊김');
      return {text:'이 담당자의 기록'};
    },
  };
  const start = {runId:'tdd-review-failure', input:lesson.question};
  const waiting = await executeGraph(lesson.graph, start, services);
  assert.ok(waiting.wait);
  const result = await executeGraph(lesson.graph, {...start, checkpoint:waiting.checkpoint,
    reply:{waitId:waiting.wait.id, value:JSON.stringify({'확정한 테스트 범위':'동의'})}}, services);
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /규칙 검토 중 연결 끊김/);
  assert.ok(!result.output.includes('Standards · 코딩 규칙 검토'));
});
