import assert from 'node:assert/strict';
import test from 'node:test';
import {templates, validateGraph} from '../src/domain';
import {executeGraph, type EngineResult, type EngineServices, type ModelInput} from '../src/engine';
import {completedRunFiles} from '../src/engine/legacy-files';
import {scopeModel} from './scope-fixture';
import {domainModelingSource, originalSkill, questionnaireSource} from './web-design-skill-fixture';

const caseList = [
  '회의실 마이크 세 건의 반납 상태와 재대여 가능 여부를 판정해 주세요.',
  'M1은 수령 서명과 소독 기록이 모두 있습니다.',
  'M2는 수령 서명이 있고 소독 기록 칸이 비어 있습니다.',
  'M3는 수령 서명이 있고 소독 기록 칸이 비어 있습니다.',
].join('\n');
const documents = {
  '중급 용어집':'# 용어집\n인수 서명은 장비 인수자가 종이 인수증에 남긴 서명입니다.',
  '중급 판단 규칙표':'# 판단 규칙표\nR7 · 인수 서명이 있으면 반납 완료입니다.\nR8 · 소독을 마친 장비만 재대여 가능합니다.',
};
const tableHeader = '# 사례별 최종 판정표\n\n| 사례 | 판단 항목 | 최초 판정 | 최종 판정 | 근거 |\n| --- | --- | --- | --- | --- |';
function caseRows(id:string, initial:string, final:string, evidence:string) {
  return [
    '| ' + id + ' | 반납 상태 | 반납 완료 | 반납 완료 | R7 인수 서명 |',
    '| ' + [id,'재대여 가능 여부',initial,final,evidence].join(' | ') + ' |',
  ].join('\n');
}
const knownRows = caseRows('M1','재대여 가능','재대여 가능','R8 소독 기록');
const mixedTable = [tableHeader, knownRows, ...['M2','M3'].map(id => caseRows(id,'미확정','미확정','소독 사실 미확인'))].join('\n');
const unresolved = ['M2','M3'].map(id => ({
  caseIds:[id], axis:'재대여 가능 여부', kind:'사례 사실', missing:id + '의 소독 사실',
}));
const questionnaire = '# 장비 담당자 재질문지\n\nM2의 소독을 마쳤나요?\n>\n\nM3의 소독을 마쳤나요?\n>';
const finalName = '사례별-최종-판정표.md';
const questionName = 'to-questionnaire-equipment-return-cases.md';
const skillForRole = {'사례 판정 담당':domainModelingSource, '재질문 담당':questionnaireSource, '회신 반영 담당':domainModelingSource};
type Role = keyof typeof skillForRole;

function practice(model:(role:Role, request:ModelInput)=>string) {
  const lesson = templates.find(item => item.id === 'equipment-return-cases');
  assert.ok(lesson);
  const roles:Role[] = [];
  const services:EngineServices = {
    scopeModel, asset:originalSkill, tool:async name => {throw Error('예기치 않은 도구 호출 ' + name);},
    model:async request => {
      const role = (Object.keys(skillForRole) as Role[]).find(value => request.instruction.includes('역할: ' + value + '\n'));
      assert.ok(role, '예정된 담당자에게 역할을 위임해야 합니다.');
      roles.push(role);
      assert.ok(request.instruction.includes(skillForRole[role]), role);
      assert.equal(request.instruction.includes(questionnaireSource), role === '재질문 담당');
      assert.equal(request.instruction.includes(domainModelingSource), role !== '재질문 담당');
      return {text:model(role, request)};
    },
  };
  const start = {runId:'equipment-cases', input:caseList};
  const answer = (previous:EngineResult, fields:Record<string,string>) => {
    assert.equal(previous.status, 'waiting', previous.error ?? '');
    assert.ok(previous.wait);
    return executeGraph(lesson.graph, {...start, checkpoint:previous.checkpoint,
      reply:{waitId:previous.wait.id, value:JSON.stringify(fields)}}, services);
  };
  return {lesson, roles, begin:() => executeGraph(lesson.graph, start, services), answer,
    files:(result:EngineResult) => Object.fromEntries(completedRunFiles(lesson.graph, result.checkpoint).map(file => [file.fileName,file.content]))};
}

function assertSourceText(request:ModelInput, docs:typeof documents) {
  const received = request.input + '\n' + request.context;
  for (const body of [caseList, ...Object.values(docs)])
    for (const line of body.split('\n')) assert.ok(received.includes(line), '누락된 입력 ' + line);
}

test('두 문서를 직접 입력해야 판정을 시작하고, 주어진 규칙으로 모두 판정하면 재질문 없이 표를 내려받는다', async () => {
  const updated = {...documents, '중급 판단 규칙표':'# 판단 규칙표\nR7 · 인수 서명이 있으면 반납 완료입니다.\nR12 · 서명한 마이크는 소독 기록과 관계없이 즉시 재대여할 수 있습니다.'};
  const doneTable = [tableHeader,...['M1','M2','M3'].map(id => caseRows(id,'재대여 가능','재대여 가능','R12 인수 서명'))].join('\n');
  const run = practice((role,request) => {
    assert.equal(role, '사례 판정 담당');
    assertSourceText(request, updated);
    return JSON.stringify({table:doneTable, unresolved:[]});
  });
  assert.equal(run.lesson.title, '이 장비는 반납 완료일까, 다시 물어봐야 할까?');
  assert.equal(run.lesson.topic, '업무 용어와 판단 기준 정리');
  assert.equal(run.lesson.level, '고급');
  assert.deepEqual(validateGraph(run.lesson.graph), []);
  const input = await run.begin();
  assert.equal(input.status, 'waiting', input.error ?? '');
  assert.deepEqual(input.wait?.fields, Object.keys(documents).map(name => ({name,required:true,multiline:true})));
  for (const key of Object.keys(documents)) {
    const missing = await run.answer(input, {...updated, [key]:' \n '});
    assert.equal(missing.status, 'waiting');
    assert.equal(missing.wait?.id, input.wait!.id);
    assert.ok(missing.wait?.fieldError?.includes(key));
  }
  assert.deepEqual(run.roles, []);
  const done = await run.answer(input, updated);
  assert.equal(done.status, 'completed', done.error ?? '');
  assert.deepEqual(run.roles, ['사례 판정 담당']);
  assert.ok(done.output.includes(doneTable));
  assert.deepEqual(run.files(done), {[finalName]:doneTable});
});

for (const [title, reply, m2Decision] of [
  ['일부 회신', 'M2의 소독은 어제 완료했습니다.\nM3는 아직 확인하지 못했습니다.', '재대여 가능'],
  ['상충하는 회신', 'M2 소독 기록 두 건이 완료와 미실시로 엇갈립니다.\nM3는 모릅니다.', '미확정'],
]) {
  test('미확정 항목만 질문하고 실제 회신으로 해당 판정을 갱신한다 · ' + title, async () => {
    const final = [tableHeader, knownRows, caseRows('M2','미확정',m2Decision,reply.split('\n')[0]),
      caseRows('M3','미확정','미확정',reply.split('\n')[1])].join('\n');
    const run = practice((role,request) => {
      if (role === '사례 판정 담당') {
        assertSourceText(request, documents);
        return JSON.stringify({table:mixedTable, unresolved});
      }
      if (role === '재질문 담당') {
        for (const gap of unresolved) assert.ok(request.input.includes(gap.missing));
        assert.doesNotMatch(request.input, /M1|인수 서명|반납 완료/);
        return questionnaire;
      }
      assertSourceText(request, documents);
      const evidence = request.input + '\n' + request.context;
      for (const line of [...mixedTable.split('\n'), ...questionnaire.split('\n'), ...reply.split('\n')])
        if (line.trim()) assert.ok(evidence.includes(line), '누락된 재판정 근거 ' + line);
      return JSON.stringify({table:final});
    });
    const entered = await run.begin();
    const pending = await run.answer(entered, documents);
    assert.equal(pending.status, 'waiting', pending.error ?? '');
    assert.equal(pending.wait?.prompt, questionnaire);
    assert.equal(pending.wait?.questionFileName, questionName);
    assert.deepEqual(pending.wait?.fields?.map(({name,required}) => [name,required]), [['장비 담당자 회신',true]]);
    const empty = await run.answer(pending, {'장비 담당자 회신':' '});
    assert.equal(empty.status, 'waiting');
    assert.equal(empty.wait?.id, pending.wait!.id);
    assert.deepEqual(run.roles, ['사례 판정 담당','재질문 담당']);
    const done = await run.answer(empty, {'장비 담당자 회신':reply});
    assert.equal(done.status, 'completed', done.error ?? '');
    assert.deepEqual(run.roles, ['사례 판정 담당','재질문 담당','회신 반영 담당']);
    assert.equal(run.files(done)[finalName], final);
    assert.ok(done.output.includes(final));
  });
}

test('미확정 목록이나 판정표가 잘못된 모델 응답을 최종 판정으로 전달하지 않는다', async () => {
  for (const invalid of [{table:mixedTable}, {table:mixedTable, unresolved:'없음'}, {table:' ',unresolved:[]}]) {
    const run = practice(role => {
      assert.equal(role, '사례 판정 담당');
      return JSON.stringify(invalid);
    });
    const done = await run.answer(await run.begin(), documents);
    assert.equal(done.status, 'failed', JSON.stringify(invalid));
    assert.deepEqual(run.roles, ['사례 판정 담당']);
    assert.deepEqual(run.files(done), {});
  }
  const missingFinal = practice(role => {
    if (role === '사례 판정 담당') return JSON.stringify({table:mixedTable, unresolved});
    if (role === '재질문 담당') return questionnaire;
    return JSON.stringify({table:' '});
  });
  const pending = await missingFinal.answer(await missingFinal.begin(), documents);
  const failed = await missingFinal.answer(pending, {'장비 담당자 회신':'M2와 M3의 소독을 확인했습니다.'});
  assert.equal(failed.status, 'failed');
  assert.deepEqual(missingFinal.files(failed), {});
});

test('여러 사례에 걸친 같은 규칙 공백은 한 질문으로 묻고 회신을 해당 사례들과 함께 전달한다', async () => {
  const originalDocs = {...documents, '중급 판단 규칙표':'R7 · 인수 서명이 있으면 반납 완료입니다.\nR9 · 소독 기록이 있으면 재대여 가능합니다. 기록이 없을 때 처리할 기준은 미확정입니다.'};
  const gap = {caseIds:['M2','M3'],axis:'재대여 가능 여부',kind:'공통 규칙',missing:'소독 기록 누락 시 적용할 재대여 기준'};
  const question = '# 장비 담당자 질문지\nM2와 M3처럼 소독 기록이 비어 있는 장비의 재대여 기준은 무엇인가요?\n>';
  const reply = '앞으로 소독 기록이 비어 있는 마이크는 모두 재대여 보류로 기록합니다.';
  const known = caseRows('M1','재대여 가능','재대여 가능','R9 소독 기록');
  const before = [tableHeader,known,...gap.caseIds.map(id => caseRows(id,'미확정','미확정','R9 기록 누락 시 기준 미확정'))].join('\n');
  const after = [tableHeader,known,...gap.caseIds.map(id => caseRows(id,'미확정','재대여 보류',reply))].join('\n');
  const run = practice((role,request) => {
    if (role === '사례 판정 담당') {
      assertSourceText(request, originalDocs);
      return JSON.stringify({table:before, unresolved:[gap]});
    }
    if (role === '재질문 담당') {
      for (const value of [...gap.caseIds,gap.missing,gap.kind]) assert.ok(request.input.includes(value), value);
      assert.doesNotMatch(request.input, /M1|인수 서명/);
      return question;
    }
    const evidence = request.input + '\n' + request.context;
    for (const value of [reply, gap.missing, ...before.split('\n')])
      if (value) assert.ok(evidence.includes(value), value);
    return JSON.stringify({table:after});
  });
  const pending = await run.answer(await run.begin(), originalDocs);
  assert.equal(pending.wait?.prompt, question, pending.error ?? '');
  const done = await run.answer(pending, {'장비 담당자 회신':reply});
  assert.equal(done.status, 'completed', done.error ?? '');
  assert.deepEqual(run.roles, ['사례 판정 담당','재질문 담당','회신 반영 담당']);
  assert.equal(run.files(done)[finalName], after);
});
