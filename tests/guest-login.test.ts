import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticate, logOut, lookupSession } from '../src/server/auth';
import { legacyGuestSession } from './legacy-guest';
import { db } from '../src/server/db';
import { createProject, deleteProject, listTrashedProjects, openProject, snapshot, versionList } from '../src/server/projects';
import { assetShare, grant, readAsset, writeAsset } from '../src/server/assets';
import { runGet, runList, startRun, workOne } from '../src/server/runs';
import { createBlock } from '../src/domain';
import { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/studio/route';

const directory = mkdtempSync(join(tmpdir(), 'studio-guest-login-'));
process.env.STUDIO_DATA_DIR = directory;
after(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });
const password = 'guest-login-regression';

function request(action: string, data = {}, cookie = '') {
  return POST(new NextRequest('http://localhost/api/studio', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ action, data }),
  }));
}

test('the workspace requires a registered account before opening shared or private content', async () => {
  const legacy = legacyGuestSession();
  for (const cookie of ['', 'studio_session=unrecognized', legacy.cookie]) {
    const pageData = await GET(new NextRequest('http://localhost/api/studio', { headers: {cookie} }));
    assert.equal(pageData.status, 401);
    for (const action of ['auth.session', 'bootstrap', 'project.list', 'project.create', 'project.open', 'asset.read', 'run.start']) {
      const response = await request(action, {}, cookie);
      assert.equal(response.status, 401, action);
      assert.equal(response.headers.get('set-cookie'), null);
    }
  }
});

test('new accounts can sign up, log out and log back in without a guest session', async () => {
  const credentials = { login: 'web-sign-in', password };
  const signup = await request('auth.signup', credentials);
  assert.equal(signup.status, 200);
  const cookie = signup.headers.get('set-cookie')!;
  const account = (await signup.json()).data;
  const first = await request('bootstrap', {}, cookie);
  assert.deepEqual((await first.json()).data.user, account);
  const logout = await request('auth.logout', {}, cookie);
  assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
  assert.equal((await request('auth.session', {}, cookie)).status, 401);
  const failure = await request('auth.login', { ...credentials, password: 'incorrect-credentials' });
  assert.equal(failure.status, 401);
  assert.equal(failure.headers.get('set-cookie'), null);
  const login = await request('auth.login', credentials);
  const resumed = await request('auth.session', {}, login.headers.get('set-cookie')!);
  assert.deepEqual((await resumed.json()).data, account);
});

test('explicit import moves guest Agents, versions, trash, and pinned material to the authenticated account', () => {
  const member = authenticate('signup', 'guest-import-owner', password, '').user;
  const guest = legacyGuestSession();
  const asset = writeAsset(guest.user, { kind: 'document', name: '규정', payload: { content: '3권' } });
  const project = createProject(guest.user, { lesson: 'beginner' });
  const version = snapshot(guest.user, { id: project.id, revision: project.revision });
  const discarded = createProject(guest.user, { title: '휴지통 사본' });
  deleteProject(guest.user, { id: discarded.id, revision: discarded.revision! });
  assert.throws(() => authenticate('login', member.login, 'wrong-password', guest.cookie, true), { status: 401 });
  assert.ok(openProject(guest.user, project.id).mine);
  const login = authenticate('login', member.login, password, guest.cookie, true);
  assert.equal(login.user.id, member.id);
  assert.ok(openProject(login.user, project.id).mine);
  assert.equal(versionList(login.user, project.id)[0].number, version.number);
  assert.equal(readAsset(login.user, asset.id, 1).payload.content, '3권');
  assert.ok(listTrashedProjects(login.user).some(item => item.id === discarded.id));
  assert.throws(() => openProject(guest.user, project.id), { status: 403 });
});

test('parked legacy work stays locked after logout and can be imported on the next login', async () => {
  const account = authenticate('signup', 'guest-keep-owner', password, '');
  const guest = legacyGuestSession();
  const project = createProject(guest.user, { title: '브라우저에 보관한 작업' });
  const login = authenticate('login', account.user.login, password, guest.cookie, false);
  assert.throws(() => openProject(login.user, project.id), { status: 403 });
  const otherDevice = logOut(account.cookie!);
  assert.equal(lookupSession(otherDevice!), null);
  // A client may retry login if the workspace refresh failed after the session cookie was set.
  const retried = authenticate('login', account.user.login, password, login.cookie!);
  const recoveryCookie = logOut(retried.cookie!)!;
  assert.equal(lookupSession(recoveryCookie)?.user.id, guest.user.id);
  assert.equal((await request('project.open', { id: project.id }, recoveryCookie)).status, 401);
  assert.equal(lookupSession(guest.cookie), null);
  const imported = authenticate('login', account.user.login, password, recoveryCookie, true);
  assert.ok(openProject(imported.user, project.id).mine);
});

test('queued guest runs continue to use the exact linked resource version after import', async () => {
  const account = authenticate('signup', 'guest-history-owner', password, '').user;
  const guest = legacyGuestSession();
  const asset = writeAsset(guest.user, { kind: 'document', name: '도서관 규정', payload: { content: '3권' } });
  const nodes = [
    createBlock('input.user_request', { id: 'question' }),
    createBlock('resource.context', { id: 'rules', config: { assetId: asset.id, version: 1 } }),
    createBlock('output.answer', { id: 'answer' }),
  ];
  const graph = { nodes, edges: [
    { id: 'run', kind: 'flow', from: 'question', to: 'answer', out: 'next', input: 'in' },
    { id: 'quote', kind: 'data', from: 'rules', to: 'answer', out: 'value', input: 'input' },
  ] };
  const project = createProject(guest.user, { title: '원문 읽기', graph });
  const run = startRun(guest.user, { id: project.id, mode: 'test', input: '몇 권?', requestKey: 'loan-rule' });
  writeAsset(guest.user, { id: asset.id, baseVersion: 1, name: '규정', payload: { content: '5권' } });
  authenticate('login', account.login, password, guest.cookie, true);
  assert.equal(runList(account, project.id)[0].id, run.id);
  await workOne();
  assert.equal(runGet(account, run.id).output, '3권');
});

test('an executing guest run finishes under its original identity before import is retried', async () => {
  const member = authenticate('signup', 'guest-running-owner', password, '').user;
  const guest = legacyGuestSession();
  const project = createProject(guest.user, { title: '작업 중', graph: {
    nodes: [createBlock('input.user_request', { id: 'in' }), createBlock('control.terminate', { id: 'out', config: { message: '완료' } })],
    edges: [{ id: 'flow', from: 'in', to: 'out', kind: 'flow', out: 'next', input: 'in' }],
  } });
  const run = startRun(guest.user, { id: project.id, mode: 'test', input: '시작', requestKey: 'send' });
  const running = workOne();
  assert.throws(() => authenticate('login', member.login, password, guest.cookie, true), { status: 409 });
  assert.equal(lookupSession(guest.cookie)?.user.id, guest.user.id);
  await running;
  authenticate('login', member.login, password, guest.cookie, true);
  assert.equal(runGet(member, run.id).output, '완료');
});

test('import preserves valid shared access without replacing the account’s renewed link', () => {
  const contributor = authenticate('signup', 'guest-link-author', password, '').user;
  const member = authenticate('signup', 'guest-link-reader', password, '').user;
  const guest = legacyGuestSession();
  const first = writeAsset(contributor, { kind: 'document', name: '공유 규정', payload: { content: '대출' } });
  const second = writeAsset(contributor, { kind: 'document', name: '새 주소', payload: { content: '반납' } });
  for (const source of [first, second]) {
    const linked = assetShare(contributor, source.id, 'link', false, 1);
    grant(guest.user, 'asset', source.id, linked.token!);
  }
  const renewed = assetShare(contributor, second.id, 'link', true, 1);
  grant(member, 'asset', second.id, renewed.token!);
  authenticate('login', member.login, password, guest.cookie, true);
  assert.equal(readAsset(member, first.id, 1).payload.content, '대출');
  assert.equal(readAsset(member, second.id, 1).payload.content, '반납');
  assert.throws(() => readAsset(guest.user, first.id, 1), { status: 403 });
});
