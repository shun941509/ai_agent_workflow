import assert from 'node:assert/strict';
import test from 'node:test';
import {templates, validateGraph} from '../src/domain';
import {executeGraph, type EngineServices} from '../src/engine';
import {scopeModel} from './scope-fixture';
import {domainModelingSource, grillingSource, originalSkill} from './web-design-skill-fixture';

const cases = [
  {reply:'한 건 그대로예요. 배송 중 표시만 사라져요.', criterion:'주문 한 건을 유지하면서 배송 중 선택 표시가 남아야 합니다.'},
  {reply:'세 건이 다시 보여요. 배송 중만 보이게 유지하고 싶어요.', criterion:'Tab을 누른 뒤에도 필터가 유지되어 배송 중 주문 한 건만 보여야 합니다.'},
];

for (const scenario of cases) {
  test('개선 기준을 정하기 전에 같은 실행에서 사용자 답변을 받는다 · ' + scenario.reply, async () => {
    const lesson = templates.find(item => item.id === 'web-design-questions');
    assert.ok(lesson);
    assert.deepEqual(validateGraph(lesson.graph), []);
    const documents = lesson.graph.nodes.filter(node => node.type === 'resource.context');
    assert.deepEqual(documents.map(node => node.title), ['화면 동작 설명']);
    const roles = ['interviewer', 'modeler'];
    const targets = (id: string, port: string) => lesson.graph.edges.filter(e =>
      e.from === id && e.kind === 'reference' && e.input === port).map(e => e.to).sort();
    assert.deepEqual(targets(documents[0].id, 'context'), roles);
    assert.deepEqual(targets('skill-grilling', 'skill'), ['interviewer']);
    assert.deepEqual(targets('skill-domain-modeling', 'skill'), ['modeler']);

    const question = 'Tab을 누른 뒤 주문은 몇 건이고 배송 중 버튼에는 어떤 표시가 남나요?';
    const calls: string[] = [];
    const services: EngineServices = {
      scopeModel, asset:originalSkill, tool:async name => {throw Error('예기치 않은 도구 호출 ' + name);},
      model:async request => {
        assert.ok(request.context.includes(documents[0].config.content));
        if (request.instruction.includes('역할: 요구사항 확인 담당')) {
          calls.push('interviewer');
          assert.equal(request.input, lesson.question);
          assert.ok(request.instruction.includes(grillingSource));
          assert.ok(!request.instruction.includes(domainModelingSource));
          return {text:question};
        }
        assert.ok(request.instruction.includes('역할: 용어 정리 담당'));
        calls.push('modeler');
        assert.ok(request.instruction.includes(domainModelingSource));
        assert.ok(!request.instruction.includes(grillingSource));
        assert.ok(request.context.includes(lesson.question));
        assert.ok(request.input.includes(question));
        assert.ok(request.input.includes(scenario.reply));
        assert.ok(!request.input.includes(cases.find(other => other !== scenario)!.reply));
        return {text:scenario.criterion};
      },
    };
    const run = {runId:'question-practice', input:lesson.question};
    const waiting = await executeGraph(lesson.graph, run, services);
    assert.equal(waiting.status, 'waiting', waiting.error ?? waiting.status);
    assert.deepEqual(calls, ['interviewer']);
    assert.ok(waiting.wait);
    assert.equal(waiting.wait.prompt, question);
    assert.deepEqual(waiting.wait.fields, [{name:'사용자 답변', required:true}]);
    const resumed = await executeGraph(lesson.graph, {...run, checkpoint:waiting.checkpoint,
      reply:{waitId:waiting.wait.id, value:JSON.stringify({'사용자 답변':scenario.reply})}}, services);
    assert.equal(resumed.status, 'completed', resumed.error ?? resumed.status);
    assert.deepEqual(calls, roles);
    assert.equal(resumed.output, scenario.criterion);
  });
}
