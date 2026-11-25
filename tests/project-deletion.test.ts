import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlock, type Block, type Graph } from '../src/domain';
import { authenticate } from '../src/server/auth';
import { legacyGuestSession } from './legacy-guest';
import { db, one, set } from '../src/server/db';
import { caseList, caseSave, createProject, deleteProject, getVersion, listProjects, listTrashedProjects, openProject, projectCopy, publish, restoreProject, saveProject, snapshot, versionList } from '../src/server/projects';
import { replyRun, runGet, startRun, workOne } from '../src/server/runs';
import { recordEditorVisit, resumeWorkspace } from '../src/server/projects';
import { acceptEvent, dispatchDue, enableTrigger, triggerList } from '../src/server/triggers';

const dir = mkdtempSync(join(tmpdir(), 'studio-project-deletion-'));
process.env.STUDIO_DATA_DIR = dir;
after(() => { db().close(); rmSync(dir, { recursive: true, force: true }); });

const member = (name: string) => authenticate('signup', name, 'delete-fixture-password', '').user;

test('retrying a creation after a lost response opens the same named release practice', () => {
  const owner = legacyGuestSession().user;
  const request = {title:'야간 개관 알림', lesson:'release', requestKey:crypto.randomUUID()};
  const first = createProject(owner, request);
  assert.equal(createProject(owner, request).id, first.id);
  assert.equal(listProjects(owner).filter(project => project.mine).length, 1);
  assert.equal(versionList(owner, first.id).length, 2);
  assert.throws(() => createProject(owner, {...request, title:'다른 작업'}), {status:409});
  assert.notEqual(createProject(legacyGuestSession().user, request).id, first.id);
});

test('home resumes the last owned, active editor including its nested canvas', () => {
  const owner = legacyGuestSession().user, visitor = legacyGuestSession().user;
  const child = createBlock('agent.task', {id:'child'});
  const team = createBlock('agent.team', {id:'team',graph:{nodes:[child],edges:[]}});
  const a = createProject(owner, {graph:{nodes:[team],edges:[]},title:'팀 프로젝트'});
  const b = createProject(owner, {lesson:'beginner'});
  const focus = {path:['team'],selection:{kind:'node',id:'child'}};
  assert.equal(resumeWorkspace(owner), null);
  const legacy = saveProject(owner, {...a,title:'기존 작업'});
  assert.equal(resumeWorkspace(owner)?.id, a.id);
  recordEditorVisit(owner, a.id, focus);
  recordEditorVisit(owner, b.id, {path:[],selection:null});
  assert.equal(resumeWorkspace(owner)?.id, b.id);
  assert.throws(() => recordEditorVisit(visitor, a.id, focus), {status:403});
  assert.equal(resumeWorkspace(visitor), null);
  const edited = saveProject(owner, {...legacy,title:'다시 작업한 팀'});
  assert.equal(resumeWorkspace(owner)?.id, a.id);
  assert.deepEqual(resumeWorkspace(owner)?.editorFocus, focus);
  saveProject(owner, {...edited,graph:{nodes:[],edges:[]}});
  assert.deepEqual(resumeWorkspace(owner)?.editorFocus, {path:[],selection:null});
  const latest = resumeWorkspace(owner)!;
  deleteProject(owner, {id:a.id,revision:latest.revision!});
  assert.equal(resumeWorkspace(owner)?.id, b.id);
  assert.throws(() => recordEditorVisit(owner, a.id, focus), {status:404});
});
function chain(nodes: Block[]): Graph {
  const edges = nodes.slice(1).flatMap((node, index) => {
    const from = nodes[index].id, to = node.id;
    return [
      { id: from+'-order', from, to, kind:'flow' as const, out:'next', input:'in' },
      { id: from+'-value', from, to, kind:'data' as const, out:'value', input:'input' },
    ];
  });
  return { nodes, edges };
}

test('only the owner can delete the reviewed revision; deletion revokes shared access, stops work and preserves independent copies', async () => {
  const owner = member('deletion-owner'), reader = member('deletion-reader');
  const graph = chain([
    createBlock('input.user_request', { id:'input' }),
    createBlock('input.form', { id:'wait', config:{ prompt:'답을 입력하세요.' } }),
    createBlock('output.answer', { id:'answer' }),
  ]);
  const project = createProject(owner, { title:'같은 이름', graph });
  const sibling = createProject(owner, { title:project.title, graph });
  const version = snapshot(owner, { id:project.id, revision:project.revision }).number;
  const linked = publish(owner, { id:project.id, version, visibility:'link' });
  assert.throws(() => deleteProject(owner, {
    id:project.id, revision:project.revision!, expectedVisibility:'private', expectedPublicVersion:null,
  }), { status:409 });
  openProject(reader, project.id, linked.token);
  const copy = projectCopy(reader, { id:project.id, token:linked.token });
  assert.ok(listProjects(reader).some(item => item.id === project.id));
  assert.throws(() => deleteProject(reader, { id:project.id, revision:project.revision! }), { status:403 });

  const edited = saveProject(owner, { ...project, title:'수정된 이름' });
  assert.throws(() => deleteProject(owner, { id:project.id, revision:project.revision! }), { status:409 });
  assert.equal(openProject(owner, project.id).title, edited.title);
  const previous = startRun(reader, { id:project.id, mode:'live', input:'첫 실행', requestKey:'waiting' });
  assert.equal(await workOne(), true);
  const waiting = runGet(reader, previous.id);
  assert.equal(waiting.state, 'waiting');
  const queued = startRun(owner, { id:project.id, mode:'test', input:'다음 실행', requestKey:'queued' });
  const deletion = { id:project.id, revision:edited.revision! };
  assert.deepEqual(deleteProject(owner, deletion), { id:project.id });
  assert.deepEqual(deleteProject(owner, deletion), { id:project.id });

  for (const user of [owner, reader]) {
    assert.ok(!listProjects(user).some(item => item.id === project.id));
    assert.throws(() => openProject(user, project.id, linked.token), { status:404 });
  }
  assert.throws(() => saveProject(owner, { ...edited, title:'지연된 저장' }), { status:404 });
  assert.throws(() => publish(owner, { id:project.id, version, visibility:'public' }), { status:404 });
  assert.throws(() => startRun(reader, { id:project.id, conversation:previous.conversation, input:'다시', requestKey:'new' }), { status:404 });
  assert.throws(() => runGet(reader, previous.id), { status:404 });
  assert.throws(() => runGet(owner, queued.id), { status:404 });
  assert.throws(() => replyRun(reader, { runId:waiting.id, waitId:waiting.prompt.id, value:'응답' }), { status:404 });
  assert.equal(await workOne(), false);
  assert.equal(openProject(owner, sibling.id).title, sibling.title);
  assert.equal(openProject(reader, copy.id).mine, true);
  const independent = startRun(reader, { id:copy.id, mode:'test', input:'독립 실행', requestKey:'copy' });
  assert.equal(await workOne(), true);
  assert.equal(runGet(reader, independent.id).state, 'waiting');

  const [inTrash] = listTrashedProjects(owner);
  assert.equal(inTrash.id, project.id);
  assert.deepEqual(listTrashedProjects(reader), []);
  assert.throws(() => restoreProject(reader, inTrash), { status:404 });
  const restored = restoreProject(owner, inTrash);
  assert.equal(restored.visibility, 'private');
  assert.equal(restored.publicVersion, null);
  assert.notEqual(openProject(owner, project.id).token, linked.token);
  assert.throws(() => openProject(reader, project.id, linked.token), { status:403 });
  assert.equal(runGet(owner, queued.id).state, 'stopped');
  assert.equal(runGet(reader, previous.id).output, '');
  assert.equal(runGet(reader, previous.id).prompt, null);
  assert.throws(() => replyRun(reader, { runId:waiting.id, waitId:waiting.prompt.id, value:'이전 승인' }), { status:403 });
  assert.equal(await workOne(), false);
  assert.equal(openProject(reader, copy.id).id, copy.id);
  const newLink = publish(owner, { id:project.id, version, visibility:'link' });
  assert.notEqual(newLink.token, linked.token);
  assert.throws(() => openProject(reader, project.id, linked.token), { status:403 });
  assert.throws(() => startRun(reader, { id:project.id, conversation:previous.conversation, input:'예전 링크', requestKey:'stale-link' }), { status:403 });
  const repeated = restoreProject(owner, inTrash);
  assert.equal(repeated.visibility, 'link', 'a delayed restore retry cannot revoke a new sharing decision');
  assert.equal(repeated.token, newLink.token);
});

test('deleting an Agent disables its webhook and due schedule and also works for a guest-owned draft', () => {
  const guest = legacyGuestSession().user;
  const draft = createProject(guest, { title:'게스트 초안' });
  deleteProject(guest, { id:draft.id, revision:draft.revision! });
  assert.equal(listProjects(guest).length, 0);

  const owner = member('delete-automation');
  const webhook = chain([
    createBlock('control.trigger', { id:'event', config:{ trigger:'event', event:'open' } }),
    createBlock('output.answer', { id:'event-output' }),
  ]);
  const schedule = chain([
    createBlock('control.trigger', { id:'clock', config:{ trigger:'schedule', schedule:'매 15분' } }),
    createBlock('output.answer', { id:'clock-output' }),
  ]);
  const project = createProject(owner, { graph:{ nodes:[...webhook.nodes, ...schedule.nodes], edges:[...webhook.edges, ...schedule.edges] } });
  const version = snapshot(owner, { id:project.id, revision:project.revision }).number;
  publish(owner, { id:project.id, version, visibility:'public' });
  assert.ok(listProjects(guest).some(item => item.id === project.id));
  const hook = enableTrigger(owner, { id:project.id, version, node:'event', input:'event' });
  const clock = enableTrigger(owner, { id:project.id, version, node:'clock', input:'clock' });
  deleteProject(owner, { id:project.id, revision:project.revision! });
  assert.ok(!listProjects(guest).some(item => item.id === project.id));
  assert.throws(() => acceptEvent(hook.id, hook.secret!, { eventId:'later' }));
  assert.equal(dispatchDue(Date.parse(clock.nextAt!)), false);
  restoreProject(owner, listTrashedProjects(owner)[0]);
  assert.ok(triggerList(owner, project.id).registrations.every(registration => !registration.enabled));
  assert.throws(() => acceptEvent(hook.id, hook.secret!, { eventId:'after-recovery' }));
  assert.equal(dispatchDue(Date.parse(clock.nextAt!)), false);
});

test('trash recovers a legacy deletion with its original graph, editions and personal cases', t => {
  t.mock.timers.enable({ apis:['Date'], now:new Date('2025-01-04T04:05:06.000Z') });
  const guest = legacyGuestSession().user;
  const project = createProject(guest, { title:'예전 템플릿', lesson:'intro' });
  const version = snapshot(guest, { id:project.id, revision:project.revision }).number;
  const testCase = caseSave(guest, { id:project.id, title:'첫 시험', input:'사용자 질문', expected:'자료에 있는 사실' });
  const graph = structuredClone(project.graph!);
  graph.nodes[0].x += 45;
  const draft = saveProject(guest, { id:project.id, revision:project.revision, graph, title:'이전 작업' });
  // Exact tombstone columns used by Studio before the trash UI shipped.
  const deletedAt = '2025-01-03T04:05:06.000Z';
  set('UPDATE projects SET revision=revision+1, updated=? WHERE id=?', deletedAt, project.id);
  set('INSERT INTO deleted_projects(project,deleted) VALUES(?,?)', project.id, deletedAt);
  const [entry] = listTrashedProjects(guest);
  assert.deepEqual({ ...entry }, { id:project.id, title:draft.title, deletedAt, expiresAt:'2025-01-06T04:05:06.000Z', revision:draft.revision!+1 });
  assert.throws(() => restoreProject(legacyGuestSession().user, entry), { status:404 });
  restoreProject(guest, entry);
  assert.deepEqual(listTrashedProjects(guest), []);
  const recovered = openProject(guest, project.id);
  assert.deepEqual(recovered.graph, draft.graph);
  assert.equal(recovered.lesson, draft.lesson);
  assert.equal(recovered.title, draft.title);
  assert.deepEqual(versionList(guest, project.id).map(v => v.number), [version]);
  assert.deepEqual(JSON.parse(getVersion(project.id, version).graph), project.graph);
  assert.deepEqual(caseList(guest, project.id).map(c => c.id), [testCase.id]);
});

test('restore retries are idempotent and stale requests cannot alter a later trash cycle', () => {
  const owner = legacyGuestSession().user;
  const project = createProject(owner, { title:'첫 삭제' });
  const removeFirst = { id:project.id, revision:project.revision! };
  assert.throws(() => restoreProject(owner, removeFirst), { status:409 });
  deleteProject(owner, removeFirst);
  const firstEntry = listTrashedProjects(owner)[0];
  const restored = restoreProject(owner, firstEntry);
  assert.equal(restoreProject(owner, firstEntry).id, restored.id);
  assert.equal(openProject(owner, restored.id).revision, restored.revision);
  assert.throws(() => deleteProject(owner, removeFirst), { status:409 });
  deleteProject(owner, { id:project.id, revision:restored.revision! });
  const secondEntry = listTrashedProjects(owner)[0];
  assert.ok(secondEntry.revision > firstEntry.revision);
  assert.throws(() => restoreProject(owner, firstEntry), { status:409 });
  assert.throws(() => openProject(owner, project.id), { status:404 });
  assert.equal(restoreProject(owner, secondEntry).id, project.id);
  assert.equal(listProjects(owner).filter(p => p.id === project.id).length, 1);
});

test('a late model reply cannot restart a deleted Agent or invoke its next block', async t => {
  const owner = member('delete-active');
  const graph = chain([
    createBlock('input.user_request', { id:'input' }),
    createBlock('ai.single_task', { id:'in-flight', config:{ goal:'첫 처리' } }),
    createBlock('ai.single_task', { id:'next-call', config:{ goal:'후속 처리' } }),
    createBlock('output.answer', { id:'answer' }),
  ]);
  const project = createProject(owner, { graph });
  const run = startRun(owner, { id:project.id, mode:'test', requestKey:'in-flight', input:'입력' });
  const key = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'test-only';
  process.env.OPENAI_MODEL = 'offline';
  try {
    const request = t.mock.method(globalThis, 'fetch', async () => {
      assert.equal(runGet(owner, run.id).state, 'running');
      deleteProject(owner, { id:project.id, revision:project.revision! });
      return Response.json({ output:[{ type:'message', content:[{ type:'output_text', text:'늦게 반환된 답변' }] }] });
    });
    assert.equal(await workOne(), true);
    assert.equal(request.mock.callCount(), 1);
    const stored = one<{state:string; output:string}>('SELECT state,output FROM runs WHERE id=?', run.id);
    assert.equal(stored?.state, 'stopped');
    assert.equal(stored.output, '');
    assert.throws(() => runGet(owner, run.id), { status:404 });
    assert.equal(await workOne(), false);
  } finally {
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
    if (model === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = model;
  }
});
