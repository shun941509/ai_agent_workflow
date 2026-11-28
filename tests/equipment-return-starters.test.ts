import assert from 'node:assert/strict';
import test from 'node:test';
import {templates, validateGraph} from '../src/domain';
import {executeGraph, type EngineResult, type EngineServices, type ModelInput} from '../src/engine';
import {completedRunFiles} from '../src/engine/legacy-files';
import {scopeModel} from './scope-fixture';
import {domainModelingSource, grillingSource, originalSkill, questionnaireSource} from './web-design-skill-fixture';

const counterRecord = '4월 8일 스캐너 창구 기록에는 “회수”라고 적혀 있습니다. 본체를 받았고 거치대 수령란은 비어 있습니다.';
const candidateMemo = [
  '# 용어 후보 메모',
  '원문 표현 — “회수”',
  '확인한 사실 — 스캐너 본체를 받았습니다. 거치대 수령란은 비어 있습니다.',
  '열린 해석 — “회수”가 본체 인수인지, 구성품 확인까지 마쳤다는 뜻인지 확인해야 합니다.',
].join('\n');

function getLesson(id:string) {
  const found = templates.find(lesson => lesson.id === id);
  assert.ok(found,id);
  assert.deepEqual(validateGraph(found.graph),[],id);
  return found;
}

function practice(id:string, input:string, respond:(request:ModelInput)=>string) {
  const lesson = getLesson(id);
  const request = {input, runId:id + '-practice'};
  const calls:ModelInput[] = [];
  const services:EngineServices = {
    scopeModel, asset:originalSkill, tool:async name => {throw Error('예상하지 않은 도구 호출 ' + name);},
    model:async item => {calls.push(item); return {text:respond(item)};},
  };
  return {
    lesson, calls,
    start:()=>executeGraph(lesson.graph,request,services),
    reply:(pending:EngineResult, fields:Record<string,string>) => {
      assert.equal(pending.status,'waiting',pending.error ?? '');
      assert.ok(pending.wait);
      return executeGraph(lesson.graph,{...request, checkpoint:pending.checkpoint,
        reply:{waitId:pending.wait.id,value:JSON.stringify(fields)}},services);
    },
    files:(result:EngineResult)=>Object.fromEntries(completedRunFiles(lesson.graph,result.checkpoint)
      .map(file=>[file.fileName,file.content])),
  };
}

function received(request:ModelInput,...texts:string[]) {
  const input = request.input + '\n' + request.context;
  for (const text of texts) {
    for (const line of text.split('\n').filter(Boolean)) assert.ok(input.includes(line), '다음 단계에 필요한 원문 ' + line);
  }
}

function skillTargets(id:string) {
  return getLesson(id).skills?.map(skill => [skill.title,skill.bundled,skill.targets.map(target=>target.id).sort()]);
}

async function readCounterRecord() {
  const run = practice('equipment-return-memo',counterRecord,request => {
    assert.equal(request.input,counterRecord);
    assert.ok(request.instruction.includes(domainModelingSource));
    assert.ok(!request.instruction.includes(grillingSource));
    return candidateMemo;
  });
  const result = await run.start();
  assert.equal(result.status,'completed',result.error ?? '');
  assert.equal(result.output,candidateMemo);
  assert.equal(run.calls.length,1);
  return result.output;
}

test('입문은 직접 입력한 창구 기록을 원본 Skill로 읽고 용어 후보 메모를 반환한다', async () => {
  const intro = getLesson('equipment-return-memo');
  assert.equal(intro.title,'창구 기록의 ‘반납’은 무슨 뜻일까?');
  assert.equal(intro.level,'입문');
  assert.equal(intro.topic,'업무 용어와 판단 기준 정리');
  assert.deepEqual(skillTargets(intro.id),[['domain-modeling',true,['memo']]]);
  await readCounterRecord();
});

const firstQuestions = '1. 창구에서 먼저 내려야 할 결정은 무엇인가요?\n2. 이 결정을 확인해 줄 사람은 누구인가요?';
const scenarios = [
  {
    first:'오늘 창구에 어떤 상태를 적을지 먼저 결정하고 싶어요. 수신인은 아직 고르지 못했어요.',
    followup:'창구 기록을 먼저 정한다는 뜻이군요. 그 기록을 검토하는 분의 역할은 무엇인가요?',
    confirmation:'장비 회수 기록을 관리하는 창구 책임자에게 묻겠습니다.',
    handoff:'창구 책임자에게 오늘 스캐너 반납 상태를 어떻게 기록할지 확인해 주세요. 기록에는 “회수”라고 적혀 있고 거치대 수령란은 비어 있습니다. 본체만 받은 날 창구에는 어떤 상태를 적나요?',
  },
  {
    first:'다음 팀이 스캐너를 쓸 수 있는지 먼저 결정해야 합니다. 검사 담당자에게 묻겠습니다.',
    followup:'다른 팀에 대여할 조건을 검사 담당자에게 먼저 물으려는 것이 맞나요?',
    confirmation:'대여 승인 권한은 검사 담당자가 아니라 운영 책임자에게 있습니다. 운영 책임자에게 물어 주세요.',
    handoff:'운영 책임자에게 스캐너를 다음 팀에 빌려줄 수 있는지 확인해 주세요. 기록에는 “회수”라고 적혀 있고 거치대 수령란은 비어 있습니다. 거치대 수령 여부가 불분명할 때 재대여를 승인하는 기준은 무엇인가요?',
  },
  {
    first:'거치대 수령란이 비어 있는 경우를 먼저 물어보고 싶지만 누가 회신할지는 모릅니다.',
    followup:'거치대 수령란을 확인할 분이 정해졌나요?',
    confirmation:'아직 누가 이 기록을 확인하는지 모르겠습니다.',
    handoff:'질문지 초안입니다. 스캐너 창구 기록에는 “회수”라고 적혀 있고 거치대 수령란은 비어 있습니다. 빈 칸만으로 거치대의 상태를 판단할 수 있나요? 수신인 역할은 학습자 추가 확인 필요로 표시해 주세요.',
  },
];

for (const [index,scenario] of scenarios.entries()) {
  test('초급은 학습자와 두 번 문답한 결과를 중급의 실제 질문지 작성 담당에게 전달한다 · ' + (index+1), async () => {
    const memo = await readCounterRecord();
    const beginner = getLesson('equipment-return-questions');
    assert.equal(beginner.title,'장비 담당자에게 무엇부터 물을까?');
    assert.equal(beginner.level,'초급');
    assert.equal(beginner.topic,'업무 용어와 판단 기준 정리');
    assert.deepEqual(skillTargets(beginner.id),[['grilling',true,['confirm','handoff','interviewer']]]);
    const run = practice(beginner.id,beginner.question,request => {
      assert.ok(request.instruction.includes(grillingSource));
      assert.ok(!request.instruction.includes(domainModelingSource));
      received(request,memo);
      if (run.calls.length===1) return firstQuestions;
      received(request,scenario.first,firstQuestions);
      if (run.calls.length===2) return scenario.followup;
      received(request,scenario.followup,scenario.confirmation);
      assert.match(request.instruction,/학습자 추가 확인 필요/);
      assert.equal(run.calls.length,3);
      return scenario.handoff;
    });

    const source = await run.start();
    assert.deepEqual(source.wait?.fields,[{name:'입문 용어 후보 메모',required:true,multiline:true}]);
    const empty = await run.reply(source,{'입문 용어 후보 메모':'  \n '});
    assert.equal(empty.wait?.id,source.wait!.id);
    assert.equal(run.calls.length,0);

    const asked = await run.reply(empty,{'입문 용어 후보 메모':memo});
    assert.equal(asked.wait?.prompt,firstQuestions,asked.error ?? '');
    assert.equal(run.calls.length,1);
    const unanswered = await run.reply(asked,{'학습자 답변':''});
    assert.equal(unanswered.wait?.id,asked.wait!.id);
    const confirm = await run.reply(unanswered,{'학습자 답변':scenario.first});
    assert.equal(confirm.wait?.prompt,scenario.followup,confirm.error ?? '');
    const pending = await run.reply(confirm,{'학습자 확인·보완 답변':'  '});
    assert.equal(pending.wait?.id,confirm.wait!.id);
    assert.equal(run.calls.length,2);
    assert.deepEqual(run.files(pending),{});

    const done = await run.reply(pending,{'학습자 확인·보완 답변':scenario.confirmation});
    assert.equal(done.status,'completed',done.error ?? '');
    assert.equal(done.output,scenario.handoff);
    assert.deepEqual(run.files(done),{'중급-담당자-확인-질문.md':scenario.handoff});
    const middleQuestionnaire = '# 장비 담당자 질문지\n\n' + scenario.handoff;
    const middle = practice('equipment-return-terms',done.output, request => {
      assert.ok(request.instruction.includes('역할: 질문지 작성 담당'));
      assert.ok(request.instruction.includes(questionnaireSource));
      assert.equal(request.input,scenario.handoff);
      return middleQuestionnaire;
    });
    const waitingForStaff = await middle.start();
    assert.equal(waitingForStaff.status,'waiting',waitingForStaff.error ?? '');
    assert.equal(waitingForStaff.wait?.prompt,middleQuestionnaire);
    assert.deepEqual(waitingForStaff.wait.fields?.map(field=>field.name),['장비 담당자 회신']);
    assert.equal(middle.calls.length,1);
  });
}

test('마지막 질문 정리가 실패하면 중급에 넘겨 쓸 문서를 내보내지 않는다', async () => {
  const lesson = getLesson('equipment-return-questions');
  const run = practice(lesson.id,lesson.question,() => {
    if (run.calls.length===1) return firstQuestions;
    if (run.calls.length===2) return scenarios[0].followup;
    throw new Error('연습용 모델 응답 실패');
  });
  const asked = await run.reply(await run.start(),{'입문 용어 후보 메모':candidateMemo});
  const confirm = await run.reply(asked,{'학습자 답변':scenarios[0].first});
  const failed = await run.reply(confirm,{'학습자 확인·보완 답변':scenarios[0].confirmation});
  assert.equal(failed.status,'failed');
  assert.deepEqual(run.files(failed),{});
});
