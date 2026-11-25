import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlock, type Graph } from '../src/domain';
import {encodeRunQuestion} from '../src/domain/run-input';

// Each test file runs in its own Node process and never shares production SQLite data.
process.env.STUDIO_DATA_DIR = mkdtempSync(
  join(tmpdir(), 'studio-engine-integration-')
);
const { authenticate, usage } = await import('../src/server/auth');
const { legacyGuestSession } = await import('./legacy-guest');
const { one, set } = await import('../src/server/db');
const { createProject, project, caseList, caseSave, snapshot, publish } =
  await import('../src/server/projects');
const { startRun, workOne, runGet, runList, replyRun, stopRun, inputFiles } =
  await import('../src/server/runs');
function lessonGraph(): Graph {
  const nodes = [
    createBlock('input.user_request', { id: 'entry', title: '입력' }),
    createBlock('input.form', {
      id: 'wait',
      title: '확인',
      config: { prompt: '답할 내용' },
    }),
    createBlock('file.create', {
      id: 'file',
      title: '문서',
      config: { fileName: '답변.md', format: 'markdown' },
    }),
    createBlock('output.answer', { id: 'answer', title: '결과' }),
  ];
  return {
    nodes,
    edges: nodes.slice(1).flatMap((n, i) =>
      ['flow', 'data'].map((kind) => ({
        id: i + kind,
        from: nodes[i].id,
        to: n.id,
        kind: kind as 'flow' | 'data',
        out: kind === 'flow' ? 'next' : 'value',
        input: kind === 'flow' ? 'in' : 'input',
      }))
    ),
  };
}

test('게시된 파일 입력은 첨부를 기다리고 같은 실행에서 이용자의 파일만 읽는다', async () => {
  const author = authenticate('signup','file-sample-author','a-test-password','').user, reader = legacyGuestSession().user;
  const graph = lessonGraph();
  graph.nodes[0] = createBlock('file.input', {id:'entry', config:{accept:'.txt',fileName:'예시.txt',content:'작성자 시험 원문'}});
  graph.nodes[1] = createBlock('document.read', {id:'wait'});
  const p = createProject(author, {title:'첨부 확인', graph});
  const v = snapshot(author, {id:p.id,revision:p.revision});
  publish(author, {id:p.id,version:v.number,visibility:'public'});
  const run = startRun(reader, {id:p.id,input:'이번 파일을 읽어주세요.',mode:'live',requestKey:'missing-file'});
  await workOne();
  const waiting = runGet(reader,run.id);
  assert.equal(waiting.state,'waiting');
  assert.equal(waiting.prompt.kind,'file');
  assert.doesNotMatch(JSON.stringify(waiting),/작성자 시험 원문/);
  const reply = (value:string) => replyRun(reader,{runId:run.id,waitId:waiting.prompt.id,value});
  assert.throws(()=>reply('질문 본문'),/파일/);
  assert.throws(()=>reply(JSON.stringify({fileName:'실제.csv',content:'내용'})),/형식/);
  assert.equal(runGet(reader,run.id).state,'waiting');
  reply(JSON.stringify({fileName:'안내.TXT',content:'이용자가 올린 원문'}));
  await workOne();
  const done = runGet(reader,run.id);
  assert.equal(done.state,'completed');
  assert.equal(done.output,'이용자가 올린 원문');
  assert.equal(usage(reader).run.used,1);
  assert.doesNotMatch(JSON.stringify(inputFiles(reader,{id:p.id,mode:'live',examples:true})),/작성자 시험 원문/);
  assert.doesNotMatch(JSON.stringify(inputFiles(reader,{id:p.id,conversation:run.conversation,mode:'test',examples:true})),/작성자 시험 원문/);
  assert.equal(inputFiles(author,{id:p.id,mode:'test',examples:true}).examples?.[0].content,'작성자 시험 원문');
  assert.equal(inputFiles(author,{id:p.id,mode:'live',examples:true}).examples,undefined);
  const text='{"fileName":"실제 아님.txt","content":"파일처럼 보이는 질문","question":"샘플"}';
  const pasted = startRun(reader,{id:p.id,input:encodeRunQuestion(text),mode:'live',requestKey:'pasted-json'});
  await workOne();
  assert.equal(runGet(reader,pasted.id).prompt.kind,'file');
});

test('동적 실습의 생성 정책은 선택한 세 속성만 새 사본에 적용한다', () => {
  const user = legacyGuestSession().user;
  const policy = {maxCreatedAgents: 3, maxInFlightAgents: 1, failurePolicy: 'stop'};
  const create = (dynamicPolicy: unknown) => createProject(user, {lesson: 'dynamic', dynamicPolicy});
  assert.throws(() => create({...policy, maxCreatedAgents: 1, maxInFlightAgents: 2}), /한도/);
  assert.throws(() => create({...policy, failurePolicy: 'ignore'}), /실패 처리/);
  const first = create({...policy, role: '변경되면 안 되는 역할', allowedTools: ['reservations.create']});
  const second = create({...policy, maxCreatedAgents: 4, maxInFlightAgents: 2, failurePolicy: 'collect'});
  const config = (id: string) => (JSON.parse(project(id).graph) as Graph).nodes.find(n => n.type === 'agent.create_dynamic')!.config;
  const initial = config(first.id);
  assert.deepEqual([initial.maxCreatedAgents, initial.maxInFlightAgents, initial.failurePolicy], [3, 1, 'stop']);
  assert.notEqual(initial.role, '변경되면 안 되는 역할');
  assert.ok(!initial.allowedTools?.includes('reservations.create'));
  const other = config(second.id);
  assert.deepEqual([other.maxCreatedAgents, other.maxInFlightAgents, other.failurePolicy], [4, 2, 'collect']);
});

test('SQLite 큐와 실제 실행기가 게스트의 중지·재개·횟수·타인 기록 접근·게시판 실행을 처리한다', async () => {
  const legacy = legacyGuestSession();
  const guest = legacy.user,
    third = legacyGuestSession().user;
  const draft = createProject(guest, {
    title: '게스트 문서',
    graph: lessonGraph(),
  });
  const r = startRun(guest, {
    id: draft.id,
    mode: 'test',
    input: '요청',
    requestKey: 'run-1',
  });
  assert.equal(
    startRun(guest, {
      id: draft.id,
      mode: 'test',
      input: '요청',
      requestKey: 'run-1',
    }).id,
    r.id
  );
  assert.equal(usage(guest).run.used, 1);
  assert.equal(await workOne(), true);
  const waiting = runGet(guest, r.id);
  assert.equal(waiting.state, 'waiting');
  assert.equal(waiting.prompt.kind, 'question');
  assert.throws(() => runGet(third, r.id));
  assert.deepEqual(runList(third, draft.id), []);
  replyRun(guest, {
    runId: r.id,
    waitId: waiting.prompt.id,
    value: '23일 보관',
  });
  await workOne();
  const done = runGet(guest, r.id);
  assert.equal(done.state, 'completed');
  assert.equal(done.output, '23일 보관');
  assert.equal(usage(guest).run.used, 1);
  const next = startRun(guest, {
    id: draft.id,
    input: '다음 질문',
    conversation: r.conversation,
    requestKey: 'run-2',
  });
  await workOne();
  assert.equal(usage(guest).run.used, 2);
  const originalPrompt = runGet(guest, next.id).prompt;
  assert.ok(originalPrompt);
  stopRun(guest, next.id);
  assert.throws(() =>
    replyRun(guest, {
      runId: next.id,
      waitId: originalPrompt.id,
      value: '불가',
    })
  );
  const owner = authenticate(
    'signup',
    'runner-account',
    'a-test-password',
    legacy.cookie
  ).user;
  assert.equal(project(draft.id).owner, owner.id);
  const tc = caseSave(owner, {
    id: draft.id,
    title: '문서 시험',
    input: '입력',
    expected: '23일 보관',
    fixture: {},
  });
  assert.ok(tc.id);
  const v = snapshot(owner, { id: draft.id, revision: draft.revision });
  publish(owner, { id: draft.id, version: v.number, visibility: 'public' });
  const publicRun = startRun(third, {
    id: draft.id,
    mode: 'live',
    input: '게시된 Agent 사용',
    requestKey: 'visitor-run',
  });
  await workOne();
  assert.equal(runGet(third, publicRun.id).state, 'waiting');
  assert.equal(runGet(third, publicRun.id).version, v.number);
  assert.throws(() => runGet(owner, publicRun.id));
});

const timedReplies = [
  { title:'이전 회신 기다리기', type:'control.wait', config:{timeoutMinutes:1}, kind:'event', reply:'정상 접수' },
  { title:'기한이 있는 입력 양식', type:'input.form', config:{replyTimeoutMinutes:1, fields:['지점']}, kind:'question', reply:'{"지점":"중앙"}' },
];
test('필수 항목이 빠진 회신은 같은 대기 요청에서 수정할 수 있다', async () => {
  const user = legacyGuestSession().user;
  const graph = lessonGraph();
  graph.nodes[1].config.fields = ['지점', {key:'권수', required:true}, {name:'비고', required:false}];
  const p = createProject(user, {graph});
  const run = startRun(user, {id:p.id, mode:'test', input:'도서 신청', requestKey:'structured-form'});
  await workOne();
  const waiting = runGet(user,run.id);
  assert.deepEqual(waiting.prompt.fields, [
    {name:'지점',required:true}, {name:'권수',required:true}, {name:'비고',required:false},
  ]);
  const reply = (value:string) => replyRun(user,{runId:run.id,waitId:waiting.prompt.id,value});
  assert.throws(() => reply('{"지점":"중앙점","권수":" "}'), /필수 항목.*권수/);
  assert.equal(runGet(user,run.id).state,'waiting');
  assert.equal(runGet(user,run.id).prompt.id,waiting.prompt.id);
  reply('{"지점":"중앙점","권수":2}');
  await workOne();
  const done = runGet(user,run.id);
  assert.equal(done.state,'completed');
  assert.deepEqual(JSON.parse(done.output),{지점:'중앙점',권수:2});
});
test('업데이트 전에 대기 중이던 양식도 같은 회신 번호와 기한으로 항목을 받는다', async () => {
  const user=legacyGuestSession().user, graph=lessonGraph();
  graph.nodes[1].config={prompt:'지점을 알려주세요.',fields:['지점'],replyTimeoutMinutes:30};
  const project=createProject(user,{graph});
  const run=startRun(user,{id:project.id,mode:'test',input:'도서 신청',requestKey:'legacy-pending-form'});
  await workOne();
  const {prompt}=runGet(user,run.id);
  const stored=one<{checkpoint:string}>('SELECT checkpoint FROM runs WHERE id=?',run.id)!;
  const checkpoint=JSON.parse(stored.checkpoint);
  delete prompt.fields;
  delete checkpoint.waits[prompt.id].fields;
  set('UPDATE runs SET checkpoint=?,prompt=? WHERE id=?',JSON.stringify(checkpoint),JSON.stringify(prompt),run.id);
  assert.equal(await workOne(),true);
  const refreshed=runGet(user,run.id).prompt;
  assert.equal(refreshed.id,prompt.id);
  assert.equal(refreshed.expiresAt,prompt.expiresAt);
  assert.deepEqual(refreshed.fields,[{name:'지점',required:true}]);
  assert.equal(await workOne(),false);
  replyRun(user,{runId:run.id,waitId:prompt.id,value:'{"지점":"중앙점"}'});
  await workOne();
  assert.equal(runGet(user,run.id).state,'completed');
});
test('업데이트 전에 대기한 검토 카드에 초안을 복구하고 기존 회신 번호로 한 번만 이어간다',async()=>{
  const user=legacyGuestSession().user,graph=lessonGraph();
  graph.nodes[1]=createBlock('review.human',{id:'wait',config:{prompt:'마감 시각을 확인하세요.'}});
  const project=createProject(user,{graph});
  const draft='토요일에는 오후 4시까지 운영합니다.';
  const run=startRun(user,{id:project.id,mode:'test',input:draft,requestKey:'legacy-review'});
  await workOne();
  const {prompt}=runGet(user,run.id);
  const checkpoint=JSON.parse(one<{checkpoint:string}>('SELECT checkpoint FROM runs WHERE id=?',run.id)!.checkpoint);
  delete prompt.reviewDraft;
  delete checkpoint.waits[prompt.id].reviewDraft;
  set('UPDATE runs SET checkpoint=?,prompt=? WHERE id=?',JSON.stringify(checkpoint),JSON.stringify(prompt),run.id);
  assert.equal(await workOne(),true);
  const updated=runGet(user,run.id).prompt;
  assert.equal(updated.id,prompt.id);
  assert.equal(updated.reviewDraft,draft);
  assert.equal(await workOne(),false);
  replyRun(user,{runId:run.id,waitId:prompt.id,value:'마감 시각 확인'});
  await workOne();
  assert.equal(runGet(user,run.id).output,'마감 시각 확인');
});

for (const example of timedReplies) test(example.title+' · 만료 시각에 대기를 끝내고 기한 내 회신은 나중에도 처리한다', async (t) => {
  const guest = legacyGuestSession().user;
  const graph = lessonGraph();
  graph.nodes[1] = createBlock(example.type, {
    id: 'wait',
    config: { prompt: '회신해 주세요.', ...example.config },
  });
  const p = createProject(guest, { title: example.title, graph });
  const start = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now:start });
  const timedOut = startRun(guest, {
    id: p.id,
    mode: 'test',
    input: '기한 만료',
    requestKey: 'timer-expired',
  });
  const accepted = startRun(guest, {
    id: p.id,
    mode: 'test',
    input: '기한 내 접수',
    requestKey: 'timer-accepted',
  });
  await workOne();
  await workOne();
  const late = runGet(guest, timedOut.id).prompt;
  const early = runGet(guest, accepted.id).prompt;
  assert.equal(early.kind, example.kind);
  assert.equal(late.expiresAt,new Date(start+60_000).toISOString());
  assert.equal(early.expiresAt,late.expiresAt);
  t.mock.timers.setTime(start+59_999);
  replyRun(guest, { runId: accepted.id, waitId: early.id, value: example.reply });
  t.mock.timers.setTime(start+60_000);
  assert.throws(
    () =>
      replyRun(guest, {
        runId: timedOut.id,
        waitId: late.id,
        value: '늦은 회신',
      }),
    /기한/
  );
  await workOne();
  await workOne();
  const expired = runGet(guest, timedOut.id);
  assert.equal(expired.state, 'failed');
  assert.equal(expired.prompt, null);
  assert.match(expired.error, /기한/);
  const completed = runGet(guest, accepted.id);
  assert.equal(completed.state,'completed');
  if (example.type==='input.form') assert.deepEqual(JSON.parse(completed.output),{지점:'중앙'});
  else assert.equal(completed.output,example.reply);
  assert.equal(await workOne(), false);
});

test('같은 요청 번호는 선택한 시험을 고정하고 재시도는 최초 시험 자료를 사용한다', () => {
  const user = authenticate('signup', 'retry-fixture', 'test-password', '').user;
  const p = createProject(user, { graph: lessonGraph() });
  const fixture = { reservations: [{ book: '시험 도서', branch: '중앙' }] };
  const trial = caseSave(user, { id: p.id, title: '예약 검증', input: '대출 조회', expected: '시험 도서', fixture });
  const request = { id: p.id, input: '대출 조회', mode: 'test', requestKey: 'first-case', caseId: trial.id };
  const first = startRun(user, request);
  assert.equal(startRun(user, request).id, first.id);
  assert.throws(() => startRun(user, { ...request, caseId: null }), /요청 번호/);
  stopRun(user, first.id);
  const retry = { id: p.id, input: request.input, mode: 'test', requestKey: 'retry-case', retryOf: first.id };
  assert.throws(() => startRun(user, { ...retry, input: '새 입력' }), /원래 입력/);
  const resumed = startRun(user, retry);
  const originalFixture = storedFixture(first.conversation);
  assert.deepEqual(originalFixture, fixture);
  assert.deepEqual(storedFixture(resumed.conversation), originalFixture);
  stopRun(user, resumed.id);
});

function storedFixture(conversation: string) {
  const row = one<{data: string}>('SELECT data FROM run_fixtures WHERE conversation=?', conversation);
  assert.ok(row);
  return JSON.parse(row.data);
}

test('저장된 사례는 질문·첨부·자료·기대 결과를 한 판으로 실행하고 비교·이력·재시도에도 보존한다',()=>{
  const owner=authenticate('signup','case-snapshot','test-password','').user;
  const {id}=createProject(owner,{graph:lessonGraph()});
  const edition=(n:number)=>({title:n+'판',input:JSON.stringify({fileName:n+'.txt',content:n+'판 원문',question:n+'판 질문'}),
    expected:n+'권',fixture:{documents:{rules:n+'권'}}});
  const {id:caseId}=caseSave(owner,{id,...edition(1)});
  const [original]=caseList(owner,id);
  caseSave(owner,{id,caseId,original,...edition(2)});
  const args={id,caseId,mode:'test',requestKey:'saved-case'};
  const first=startRun(owner,args);
  const snapshot={caseId,title:'2판',expected:'2권',fixture:edition(2).fixture};
  assert.equal(first.input,edition(2).input);
  assert.deepEqual('testCase' in first&&first.testCase,snapshot);
  caseSave(owner,{id,caseId,original:caseList(owner,id)[0],...edition(3)});
  assert.equal(startRun(owner,args).id,first.id);
  const compared=startRun(owner,{id,mode:'test',caseFromRun:first.id,requestKey:'comparison'});
  stopRun(owner,first.id);
  const retry=startRun(owner,{id,mode:'test',retryOf:first.id,input:first.input,requestKey:'retry'});
  for(const run of [first,compared,retry]){
    const detail=runGet(owner,run.id);
    assert.equal(detail.input,edition(2).input);
    assert.deepEqual('testCase' in detail&&detail.testCase,snapshot);
    stopRun(owner,run.id);
  }
  assert.equal(startRun(owner,{...args,requestKey:'latest'}).input,edition(3).input);
});

test('편집한 시험 자료는 요청과 새 대화에 고정되고 사례 업데이트는 현재 판만 바꾼다',()=>{
  const owner=authenticate('signup','edit-case','test-password','').user;
  const project=createProject(owner,{graph:lessonGraph()});
  const id=project.id;
  const fields={title:'중앙점',input:'대출 한도',expected:'3권',fixture:{documents:{rules:'3권'}}};
  const {id:caseId}=caseSave(owner,{id,...fields});
  const [original]=caseList(owner,id);
  const edited={documents:{rules:'7권'}};
  const args={id,caseId,mode:'test',requestKey:'edited-case',input:fields.input,caseFixture:edited};
  const first=startRun(owner,args);
  assert.deepEqual(storedFixture(first.conversation),edited);
  assert.equal(startRun(owner,args).id,first.id);
  assert.throws(()=>startRun(owner,{...args,caseFixture:{}}),{status:409});
  assert.throws(()=>startRun(owner,{...args,requestKey:'live-edit',mode:'live'}),{status:400});
  assert.throws(()=>startRun(owner,{...args,requestKey:'edit-history',conversation:first.conversation}),{status:400});
  assert.deepEqual(caseList(owner,id),[original]);
  stopRun(owner,first.id);
  const update={id,caseId,original,...fields,expected:'7권',fixture:edited};
  assert.equal(caseSave(owner,update).id,caseId);
  assert.throws(()=>caseSave(owner,{...update,expected:'다른 편집'}),{status:409});
  const [updated]=caseList(owner,id);
  assert.equal(updated.expected,'7권');
  assert.deepEqual(updated.fixture,edited);
});
