import assert from 'node:assert/strict';
import test from 'node:test';
import {templates, validateGraph} from '../src/domain';
import {savedSkillLesson} from '../src/domain/lesson-skills';
import {executeGraph, type EngineServices} from '../src/engine';
import {completedRunFiles} from '../src/engine/legacy-files';
import {scopeModel} from './scope-fixture';
import {domainModelingSource, originalSkill, questionnaireSource} from './web-design-skill-fixture';

const questionnaire = '# 장비 담당자 질문지\n본체를 받은 날과 구성품을 점검한 날 중 언제 반납을 완료하나요?\n>\n충전기가 없으면 재대여할 수 있나요?\n>';
const scenarios = [
  {reply:'본체를 받으면 접수하고, 구성품 점검 뒤 완료합니다. 충전기가 없을 때 재대여할 수 있는지는 모릅니다.',
    glossary:'# 용어집\n반납 접수 — 본체를 받은 상태. 반납 완료 — 구성품 점검을 마친 상태.',
    rules:'# 판단 규칙표\n| 조건 | 판단 | 근거 |\n| --- | --- | --- |\n| 충전기 없음 | 재대여 미확정 | 담당자가 모른다고 회신 |'},
  {reply:'본체를 받으면 반납 완료입니다. 충전기가 없으면 재대여를 보류합니다.',
    glossary:'# 용어집\n반납 완료 — 본체를 받은 상태.',
    rules:'# 판단 규칙표\n| 조건 | 판단 | 근거 |\n| --- | --- | --- |\n| 충전기 없음 | 재대여 보류 | 충전기가 없으면 재대여를 보류합니다 |'},
];

for (const scenario of scenarios) {
  test('장비 반납 질문지로 기다렸다가 실제 회신을 두 문서에 전달한다 · ' + scenario.reply, async () => {
    const lesson = templates.find(item => item.id === 'equipment-return-terms');
    assert.ok(lesson);
    assert.equal(lesson.topic, '업무 용어와 판단 기준 정리');
    assert.equal(lesson.level, '중급');
    assert.deepEqual(validateGraph(lesson.graph), []);
    assert.deepEqual(lesson.skills?.map(skill => [skill.title, skill.targets.map(target => target.id)]), [
      ['to-questionnaire',['writer']], ['domain-modeling',['modeler']],
    ]);
    const roles: string[] = [];
    const services: EngineServices = {
      scopeModel, asset:originalSkill, tool:async name => {throw Error('예기치 않은 도구 호출 ' + name);},
      model:async request => {
        assert.ok(request.context.includes(lesson.graph.nodes.find(node => node.id === 'case')!.config.content));
        if (request.instruction.includes('역할: 질문지 작성 담당')) {
          roles.push('writer');
          assert.equal(request.input, lesson.question);
          assert.ok(request.instruction.includes(questionnaireSource));
          assert.ok(!request.instruction.includes(domainModelingSource));
          return {text:questionnaire};
        }
        assert.ok(request.instruction.includes('역할: 용어 정리 담당'));
        roles.push('modeler');
        assert.ok(request.instruction.includes(domainModelingSource));
        assert.ok(!request.instruction.includes(questionnaireSource));
        assert.ok(request.context.includes(lesson.question));
        assert.ok(request.input.includes(questionnaire));
        assert.ok(request.input.includes(scenario.reply));
        return {text:JSON.stringify({glossary:scenario.glossary, rules:scenario.rules})};
      },
    };
    const start = {runId:'equipment-return', input:lesson.question};
    const waiting = await executeGraph(lesson.graph, start, services);
    assert.equal(waiting.status, 'waiting', waiting.error ?? '');
    assert.deepEqual(roles, ['writer']);
    assert.equal(waiting.wait?.prompt, questionnaire);
    assert.equal(waiting.wait.questionFileName, 'to-questionnaire-equipment-return.md');
    assert.deepEqual(waiting.wait!.fields, [{name:'장비 담당자 회신', required:true}]);
    const resume = (answer:string) => executeGraph(lesson.graph, {...start, checkpoint:waiting.checkpoint,
      reply:{waitId:waiting.wait!.id, value:JSON.stringify({'장비 담당자 회신':answer})}}, services);
    const empty = await resume('  ');
    assert.equal(empty.status, 'waiting');
    assert.deepEqual(roles, ['writer']);
    const done = await resume(scenario.reply);
    assert.equal(done.status, 'completed', done.error ?? '');
    assert.deepEqual(roles, ['writer','modeler']);
    for (const part of [scenario.glossary, scenario.rules]) assert.ok(done.output.includes(part));
    assert.deepEqual(Object.fromEntries(completedRunFiles(lesson.graph, done.checkpoint).map(file => [file.fileName,file.content])), {
      'to-questionnaire-equipment-return.md':questionnaire, 'GLOSSARY.md':scenario.glossary, '판단-규칙표.md':scenario.rules,
    });
  });
}

test('용어집과 규칙표 본문을 모두 확인한 후에만 다운로드 파일을 전달한다', async () => {
  const lesson = templates.find(item => item.id === 'equipment-return-terms')!;
  const run = {runId:'equipment-return-invalid', input:lesson.question};
  const services: EngineServices = {scopeModel, asset:originalSkill, model:async () => ({text:questionnaire}),
    tool:async name => {throw Error('예기치 않은 도구 호출 ' + name);}};
  const waiting = await executeGraph(lesson.graph, run, services);
  assert.equal(waiting.status, 'waiting');
  const reply = {waitId:waiting.wait!.id, value:JSON.stringify({'장비 담당자 회신':scenarios[0].reply})};
  for (const invalid of [
    JSON.stringify({glossary:'# 용어집'}), JSON.stringify({glossary:'  ',rules:'# 판단 규칙표'}),
    JSON.stringify({glossary:'# 용어집',rules:{}}), '아직 규칙을 확인하지 못했습니다.',
    '```json\n' + JSON.stringify({glossary:'# 용어집',rules:'# 판단 규칙표'}) + '\n```',
  ]) {
    const done = await executeGraph(lesson.graph, {...run, checkpoint:waiting.checkpoint, reply},
      {...services, model:async () => ({text:invalid})});
    assert.equal(done.status, 'failed', invalid);
    assert.match(done.error ?? '', /입력 검증 실패/);
    assert.deepEqual(completedRunFiles(lesson.graph, done.checkpoint), []);
  }
});

test('저장한 사본에서는 담당자에게 연결된 지침을 확인할 수 있을 때만 해당 실습 단계를 안내한다', () => {
  const lesson = templates.find(item => item.id === 'equipment-return-terms')!;
  const graph = structuredClone(lesson.graph);
  const writerSkill = graph.nodes.find(node => node.id === 'skill-to-questionnaire')!;
  for (const skill of graph.nodes.filter(node => node.config.bundledSkill)) {
    skill.config.assetId = 'owner-asset-' + skill.id;
    skill.config.version = 1;
  }
  const showsOriginals = () => savedSkillLesson(lesson, graph).steps.some(step => step.includes('to-questionnaire'));
  assert.equal(showsOriginals(), true);
  const edge = graph.edges.find(item => item.from === writerSkill.id)!;
  edge.to = 'modeler';
  assert.equal(showsOriginals(), false);
  edge.to = 'writer';
  writerSkill.config.version = 2;
  assert.equal(showsOriginals(), false);
  writerSkill.config.version = 1;
  writerSkill.config.bundledSkill = 'domain-modeling';
  assert.equal(showsOriginals(), false);

  const mixed = templates.find(item => item.id === 'web-design-component')!;
  const older = structuredClone(mixed.graph);
  older.nodes = older.nodes.filter(node => !node.config.bundledSkill);
  older.edges = older.edges.filter(edge => older.nodes.some(node => node.id === edge.from));
  assert.ok(savedSkillLesson(mixed, older).steps.some(step => step.includes('컴포넌트 개선 Skill')));
});
