import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {templates, validateGraph} from '../src/domain';
import {executeGraph, type EngineServices} from '../src/engine';
import {scopeModel} from './scope-fixture';
import {codeReviewSource, originalSkill, tddSource} from './web-design-skill-fixture';

const fields = ['코딩 규칙 검토 결과', '개선 기준 검토 결과', '확정한 테스트 범위'];
const criterion = '프로필의 이름을 비우고 저장하면 이름 입력란에 오류가 나타나야 합니다.';
const development = '프로필 수정본 B · 같은 오류 표시 테스트의 수정 전 실패와 수정 후 통과를 확인했습니다.';
const reviews = {standards:'이름 규칙을 다시 확인한 근거', spec:'오류 표시 기준을 다시 확인한 근거'};

function setup() {
  const lesson = templates.find(item => item.id === 'web-design-review-followup');
  assert.ok(lesson);
  const graph = structuredClone(lesson.graph);
  assert.deepEqual(validateGraph(graph), []);
  return graph;
}

async function start(graph: ReturnType<typeof setup>, services: EngineServices) {
  const request = {runId:'expert-review', input:criterion};
  const waiting = await executeGraph(graph, request, services);
  assert.equal(waiting.status, 'waiting', waiting.error ?? '');
  assert.ok(waiting.wait);
  assert.ok(waiting.wait.prompt.includes(criterion));
  assert.deepEqual(waiting.wait.fields, fields.map(name => ({name, required:true})));
  return (answers: string[]) => executeGraph(graph, {...request, checkpoint:waiting.checkpoint,
    reply:{waitId:waiting.wait!.id, value:JSON.stringify(Object.fromEntries(fields.map((key,i) => [key, answers[i]])))}}, services);
}

for (const [standard, spec] of [
  ['규칙 1 · 상태 값을 두 곳에 보관합니다.', '기준 1 · 이름 입력란에 오류가 나타나지 않습니다.'],
  ['지적 없음', '자료 미제출 · 오류 표시 기록은 미검증입니다.'],
  ['지적 0건, 미검증 항목 1건', '0건'],
]) {
  test('입력한 두 검토 결과를 같은 수정 기록으로 재검토한다 · ' + standard + '/' + spec, async () => {
    const graph = setup();
    const reply = [standard, spec, '이름을 비우고 저장한 뒤 입력란의 오류 표시를 확인합니다.'];
    const evidence = '프로필 변경 설명과 테스트 실행 기록';
    graph.nodes.find(node => node.id === 'evidence')!.config.content = evidence;
    const posted: string[] = [];
    const simultaneous: string[] = [];
    const reviewerInputs: string[] = [];
    let activeReviews = 0;
    const services: EngineServices = {scopeModel, asset:originalSkill, tool:async () => {throw Error('도구 호출');},
      model:async request => {
        const node = graph.nodes.find(n => n.type === 'agent.delegate' && request.instruction.includes('역할: ' + n.config.role + '\n'));
        assert.ok(node);
        posted.push(node.id);
        assert.ok(request.context.includes(evidence));
        assert.ok((request.input + request.context).includes(criterion));
        for (const value of reply) assert.ok(request.input.includes(value), value);
        assert.equal(request.instruction.includes(tddSource), node.id === 'developer');
        assert.equal(request.instruction.includes(codeReviewSource), node.id !== 'developer');
        if (node.id === 'developer') return {text:development};
        assert.ok(request.input.includes(development));
        reviewerInputs.push(request.input);
        assert.ok(!request.input.includes(reviews.standards) && !request.input.includes(reviews.spec));
        activeReviews++;
        if (activeReviews === 2) simultaneous.push(node.id);
        await nextTurn();
        activeReviews--;
        return {text:reviews[node.id as keyof typeof reviews]};
      }};
    const resume = await start(graph, services);
    assert.deepEqual(posted, []);
    const result = await resume(reply);
    assert.equal(result.status, 'completed', result.error ?? '');
    assert.equal(posted[0], 'developer');
    assert.deepEqual(posted.sort(), ['developer','spec','standards']);
    assert.equal(simultaneous.length, 1);
    assert.equal(reviewerInputs[0], reviewerInputs[1]);
    for (const [heading, body] of [['TDD 수정 기록',development],['Standards · 코딩 규칙 재검토',reviews.standards],['Spec · 개선 기준 재검토',reviews.spec]]) {
      assert.ok(result.output.includes(heading + '\n' + body), heading);
    }
  });
}

test('명시된 양쪽 0건은 수정 없이 끝나며 빈 검토 결과는 같은 회신에서 보완한다', async () => {
  const graph = setup();
  const services: EngineServices = {scopeModel, asset:originalSkill, tool:async () => {throw Error('도구 호출');},
    model:async () => {throw Error('지적 없는 실행에서 담당자를 호출했습니다.');}};
  const resume = await start(graph, services);
  for (const value of ['지적 없음', '0건', '지적 0건']) {
    const done = await resume(['0건', value, '동의']);
    assert.equal(done.status, 'completed', done.error ?? '');
    assert.match(done.output, /지적 없음/);
  }
  const missing = await resume(['', '지적 없음', '동의']);
  assert.equal(missing.status, 'waiting');
  assert.match(missing.wait?.fieldError ?? '', /코딩 규칙 검토 결과/);
});
