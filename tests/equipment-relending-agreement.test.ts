import assert from 'node:assert/strict';
import test from 'node:test';
import {templates, validateGraph} from '../src/domain';
import {executeGraph, type EngineResult, type EngineServices, type ModelInput} from '../src/engine';
import {completedRunFiles} from '../src/engine/legacy-files';
import {scopeModel} from './scope-fixture';
import {domainModelingSource, originalSkill, questionnaireSource} from './web-design-skill-fixture';

const sources = {
  '중급 용어집':'# 용어집\n\n수령 서명은 측정기를 인수한 담당자의 서명이다.\n',
  '중급 판단 규칙표':'# 판단 규칙표\n\n| 조건 | 결정 |\n| --- | --- |\n| 수령 서명 | 반납 완료 |\n| 재대여 | 기준 미합의 |\n',
  '고급 최종 판정표':'# 최종 판정표\nG1은 수령 서명이 있고 검사 성적서가 적합이다. 반납 완료, 재대여 미확정.\nG2는 수령 서명이 있고 점검을 마쳤으나 성적서 결과가 없다. 반납 완료, 재대여 미확정.',
  '새 장비 사례':'N8은 수령 서명이 있고 성적서가 적합이다.\nN9는 수령 서명이 있고 검사 결과는 알 수 없다.',
};
const gap = {caseIds:['G1','G2'], missing:'재대여에 필요한 검사 성적서 판정과 그 예외'};
const questionnaire = '# 측정기 재대여 기준 확인\n성적서에서 어떤 판정을 확인해야 재대여할 수 있나요?\n>\n\n해당 조건의 예외가 있나요?\n>';
const filenames = {glossary:'갱신-용어집.md', rules:'갱신-판단-규칙표.md', table:'기존-신규-사례-재판정표.md'};
const roles = {question:'합의 질문 담당', revise:'기준 갱신 담당', assess:'사례 재판정 담당'} as const;
type Role = typeof roles[keyof typeof roles];

function decisionTable(decisions:string[], grounds:string[]) {
  const lines = ['# 기존·신규 사례 재판정표', '', '| 구분 | 사례 | 판단 항목 | 이전 판정 | 재판정 | 근거 |',
    '| --- | --- | --- | --- | --- | --- |'];
  for (const [index,id] of ['G1','G2','N8','N9'].entries()) {
    const existing = id.startsWith('G');
    const prefix = '| ' + (existing ? '기존' : '신규') + ' | ' + id + ' | ';
    lines.push(prefix + '반납 상태 | ' + (existing ? '반납 완료' : '첫 판정') + ' | 반납 완료 | 수령 서명 |',
      prefix + '재대여 가능 여부 | ' + (existing ? '미확정' : '첫 판정') + ' | ' + decisions[index] + ' | ' + grounds[index] + ' |');
  }
  return lines.join('\n');
}

function lesson() {
  const found = templates.find(item => item.id === 'equipment-relending-agreement');
  assert.ok(found, '재대여 기준 합의 전문가 예제');
  return found;
}

function practice(respond:(role:Role, request:ModelInput)=>string) {
  const example = lesson();
  const calls:Role[] = [];
  const services:EngineServices = {
    scopeModel, asset:originalSkill, tool:async name => {throw Error('예기치 않은 도구 호출 ' + name);},
    model:async request => {
      const role = Object.values(roles).find(role => request.instruction.includes('역할: ' + role + '\n'));
      assert.ok(role, '담당자 이름과 연결된 Skill을 확인할 수 있어야 합니다.');
      calls.push(role);
      assert.equal(request.instruction.includes(questionnaireSource), role === roles.question);
      assert.equal(request.instruction.includes(domainModelingSource), role !== roles.question);
      return {text:respond(role,request)};
    },
  };
  const request = {runId:'relending-agreement', input:example.question};
  return {
    calls, begin:()=>executeGraph(example.graph,request,services),
    answer:(previous:EngineResult, fields:Record<string,string>) => {
      assert.equal(previous.status, 'waiting', previous.error ?? '');
      assert.ok(previous.wait);
      return executeGraph(example.graph, {...request, checkpoint:previous.checkpoint,
        reply:{waitId:previous.wait.id,value:JSON.stringify(fields)}}, services);
    },
    files:(result:EngineResult)=>Object.fromEntries(completedRunFiles(example.graph,result.checkpoint).map(file=>[file.fileName,file.content])),
  };
}

function receives(request:ModelInput, texts:string[]) {
  const received = request.input + '\n' + request.context;
  for (const text of texts) {
    for (const line of text.split('\n').filter(Boolean)) assert.ok(received.includes(line), '누락된 원문 ' + line);
  }
}

test('전문가 예제는 네 원문을 필수로 받고 입력이 부족하면 어느 담당자도 시작하지 않는다', async () => {
  const example = lesson();
  assert.equal(example.level, '전문가');
  assert.equal(example.topic, '업무 용어와 판단 기준 정리');
  assert.equal(example.title, '재대여 기준을 합의하면 어떤 판정이 달라질까?');
  assert.deepEqual(validateGraph(example.graph), []);
  const services:EngineServices = {scopeModel, asset:originalSkill,
    tool:async name => {throw Error(name);}, model:async () => {throw Error('원문 확인 전 모델 호출');}};
  const request = {runId:'missing-agreement-inputs', input:example.question};
  const start = await executeGraph(example.graph, request, services);
  assert.equal(start.status, 'waiting', start.error ?? '');
  assert.ok(start.wait);
  const fields = start.wait.fields!;
  assert.deepEqual(fields.map(field => field.name), Object.keys(sources));
  for (const field of fields) {
    assert.ok(field.required && field.multiline, field.name);
    const values = Object.fromEntries(fields.map(other => [other.name, other.name === field.name ? ' \n ' : '문서 내용']));
    const incomplete = await executeGraph(example.graph, {...request, checkpoint:start.checkpoint,
      reply:{waitId:start.wait.id, value:JSON.stringify(values)}}, services);
    assert.equal(incomplete.status, 'waiting', incomplete.error ?? '');
    assert.equal(incomplete.wait?.id, start.wait.id);
    assert.ok(incomplete.wait?.fieldError?.includes(field.name));
  }
});

test('기준이 이미 합의됐으면 추가 회신 없이 두 원문을 보존하고 개별 사실이 부족한 사례도 재판정한다', async () => {
  const agreed = {...sources, '중급 판단 규칙표':'# 판단 규칙표\n\n| 조건 | 결정 |\n| --- | --- |\n| 수령 서명 | 반납 완료 |\n| 성적서 적합 | 재대여 가능 |\n| 성적서 없음 | 추가 확인 |\n'};
  const table = decisionTable(['가능','추가 확인','가능','추가 확인'],
    ['성적서 적합','점검을 마쳤으나 성적서 없음','성적서 적합','검사 결과 미확인']);
  const run = practice((role,request) => {
    receives(request,Object.values(agreed));
    if (role === roles.question) return JSON.stringify({unresolved:[],questionnaire:''});
    assert.equal(role,roles.assess);
    return JSON.stringify({table});
  });
  const done = await run.answer(await run.begin(),agreed);
  assert.equal(done.status,'completed',done.error ?? '');
  assert.deepEqual(run.calls,[roles.question,roles.assess]);
  assert.deepEqual(run.files(done),{
    [filenames.glossary]:agreed['중급 용어집'], [filenames.rules]:agreed['중급 판단 규칙표'], [filenames.table]:table,
  });
});

for (const scenario of [
  {
    name:'공통 기준과 건별 예외를 합의한 회신',
    reply:'적합은 허용 오차 안이라는 뜻입니다. 성적서가 적합이면 재대여합니다.\nG2만 이번 대여에 한해 허용하며 다른 예외는 아직 합의하지 않았습니다.',
    glossaryEntry:'적합 · 측정값이 허용 오차 안에 있는 상태.',
    ruleEntry:'| 성적서 적합 | 재대여 가능 |\n| G2 | 이번 대여만 허용 |\n| 그 외 예외 | 미확정 |',
    decisions:['재대여 가능','이번 대여만 허용','재대여 가능','미확정'],
    grounds:['성적서 적합','G2만 이번 대여에 한해 허용','성적서 적합','검사 결과를 알 수 없음'],
  },
  {
    name:'상충하는 회신',
    reply:'성적서 적합일 때 승인한다는 의견과 보류한다는 의견이 엇갈렸습니다.\n그 외의 기준은 아직 모릅니다.',
    glossaryEntry:'적합의 업무상 의미 추가 확인.',
    ruleEntry:'| 성적서 적합 | 미확정 · 담당자 의견 상충 |',
    decisions:['미확정','미확정','미확정','미확정'],
    grounds:['적합 성적서에 대한 기준 상충','성적서 결과 없음','적합 성적서에 대한 기준 상충','검사 결과를 알 수 없음'],
  },
]) {
  test('실제 회신과 갱신 문서를 재판정에 사용하고 세 파일을 전달한다 · ' + scenario.name, async () => {
    const updated = {
      glossary:sources['중급 용어집'] + '\n' + scenario.glossaryEntry,
      rules:'# 판단 규칙표\n\n| 조건 | 결정 |\n| --- | --- |\n| 수령 서명 | 반납 완료 |\n' + scenario.ruleEntry + '\n\n회신 근거 · ' + scenario.reply,
    };
    const table = decisionTable(scenario.decisions,scenario.grounds);
    const run = practice((role,request) => {
      receives(request,Object.values(sources));
      if (role === roles.question) return JSON.stringify({unresolved:[gap],questionnaire});
      if (role === roles.revise) {
        receives(request,[questionnaire,scenario.reply]);
        return JSON.stringify(updated);
      }
      receives(request,[updated.glossary,updated.rules,scenario.reply]);
      return JSON.stringify({table});
    });
    const waiting = await run.answer(await run.begin(),sources);
    assert.equal(waiting.status,'waiting',waiting.error ?? '');
    assert.equal(waiting.wait?.prompt,questionnaire);
    assert.equal(waiting.wait?.questionFileName,'to-questionnaire-equipment-relending.md');
    assert.deepEqual(waiting.wait?.fields?.map(field=>field.name),['장비 담당자 회신']);
    const empty = await run.answer(waiting,{'장비 담당자 회신':' \n '});
    assert.equal(empty.status,'waiting');
    assert.equal(empty.wait?.id,waiting.wait?.id);
    assert.deepEqual(run.calls,[roles.question]);
    const done = await run.answer(empty,{'장비 담당자 회신':scenario.reply});
    assert.equal(done.status,'completed',done.error ?? '');
    assert.deepEqual(run.calls,[roles.question,roles.revise,roles.assess]);
    const expected = {[filenames.glossary]:updated.glossary,[filenames.rules]:updated.rules,[filenames.table]:table};
    assert.deepEqual(run.files(done),expected);
    for (const body of Object.values(expected)) assert.ok(done.output.includes(body));
  });
}

test('질문·갱신 문서·재판정표 출력이 불완전하면 성공 결과 파일이 없다', async () => {
  for (const invalid of [{questionnaire}, {unresolved:'없음',questionnaire}, {unresolved:[gap],questionnaire:' '}]) {
    const run = practice(role => {
      assert.equal(role,roles.question);
      return JSON.stringify(invalid);
    });
    const result = await run.answer(await run.begin(),sources);
    assert.equal(result.status,'failed',JSON.stringify(invalid));
    assert.deepEqual(run.files(result),{});
  }
  for (const invalidRole of [roles.revise,roles.assess]) {
    const run = practice(role => {
      if (role === roles.question) return JSON.stringify({unresolved:[gap],questionnaire});
      if (role === roles.revise) return JSON.stringify({glossary:sources['중급 용어집'],rules:invalidRole===role ? ' ' : sources['중급 판단 규칙표']});
      return JSON.stringify({table:''});
    });
    const pending = await run.answer(await run.begin(),sources);
    const failed = await run.answer(pending,{'장비 담당자 회신':'검사 성적서가 적합하면 승인합니다.'});
    assert.equal(failed.status,'failed',invalidRole);
    assert.deepEqual(run.files(failed),{});
  }
});
