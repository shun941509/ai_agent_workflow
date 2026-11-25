import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBlock, type Graph } from '../src/domain';
import { deleteAsset, listTrashedAssets, purgeExpiredAssets, purgeTrashedAssets, restoreAsset } from '../src/server/asset-trash';
import { assetList, assetShare, copyAsset, documentPreviews, grant, readAsset, writeAsset } from '../src/server/assets';
import { authenticate, type User } from '../src/server/auth';
import { legacyGuestSession } from './legacy-guest';
import { db, one, set } from '../src/server/db';
import { assetDeleteImpact, createProject, deleteProject, getVersion, openProject, projectCopy, publish, saveProject, snapshot } from '../src/server/projects';
import { runGet, startRun, workOne } from '../src/server/runs';

const dir = mkdtempSync(join(tmpdir(), 'studio-asset-trash-'));
process.env.STUDIO_DATA_DIR = dir;
after(() => { db().close(); rmSync(dir, {recursive:true, force:true}); });

function member(login:string) {
  return authenticate('signup', login, 'asset-trash-fixture', '').user;
}

function document(owner:User, content = '본문') {
  return writeAsset(owner, {kind:'document', name:'이용 규정', payload:{content}});
}

function reviewed(item:{id:string; revision?:number}) {
  assert.ok(item.revision);
  return {id:item.id, revision:item.revision};
}

function trash(owner:User, item:{id:string; revision?:number}) {
  assert.deepEqual(deleteAsset(owner, reviewed(item)), {id:item.id});
  const entry = listTrashedAssets(owner).find(row => row.id === item.id);
  assert.ok(entry);
  return entry;
}

function graphFor(assetId:string):Graph {
  return {
    nodes:[
      createBlock('input.user_request', {id:'question'}),
      createBlock('resource.context', {id:'source', config:{assetId, version:1}}),
      createBlock('output.answer', {id:'answer'}),
    ],
    edges:[
      {id:'next', from:'question', out:'next', to:'answer', input:'in', kind:'flow'},
      {id:'text', from:'source', out:'value', to:'answer', input:'input', kind:'data'},
    ],
  };
}

async function execute(user:User, id:string, mode:'test'|'live') {
  const job = startRun(user, {id, mode, requestKey:crypto.randomUUID(), input:'대출 한도'});
  assert.equal(await workOne(), true);
  const result = runGet(user, job.id);
  assert.equal(result.state, 'completed', result.error);
  return result;
}

test('deletion impact finds nested historical pins and lists each owned active project once', () => {
  const owner = member('trash-impact-author'), other = legacyGuestSession().user;
  const source = document(owner);
  const shared = assetShare(owner, source.id, 'public', false);
  const referenced = graphFor(source.id);
  const historical = createProject(owner, {
    title:'처음 저장한 이름',
    graph:{nodes:[createBlock('agent.team', {graph:referenced})], edges:[]},
  });
  snapshot(owner, {id:historical.id, revision:historical.revision});
  saveProject(owner, {...historical, graph:{nodes:[], edges:[]}, title:'과거 판에서 사용'});
  const current = createProject(owner, {title:'현재 사용', graph:referenced});
  snapshot(owner, {id:current.id, revision:current.revision});
  snapshot(owner, {id:current.id, revision:current.revision});
  createProject(other, {title:'다른 사람의 초안', graph:referenced});
  const removed = createProject(owner, {title:'휴지통의 Agent', graph:referenced});
  snapshot(owner, {id:removed.id, revision:removed.revision});
  deleteProject(owner, reviewed(removed));
  createProject(owner, {title:'본문만 일치', graph:{
    nodes:[createBlock('resource.context', {config:{content:source.id}})], edges:[],
  }});
  assert.deepEqual(assetDeleteImpact(owner, source.id), {projectTitles:['과거 판에서 사용', '현재 사용']});
  assert.throws(() => assetDeleteImpact(other, source.id), {status:403});
  trash(owner, shared);
  assert.throws(() => assetDeleteImpact(owner, source.id), {status:404});
});

test('a used asset can be trashed, restored privately at every original edition, and resolved by its existing pins', async () => {
  const owner = member('trash-author'), reader = member('trash-reader');
  const source = document(owner, '대출 한도는 3권입니다.');
  assetShare(owner, source.id, 'public', false, 1);
  const graph = graphFor(source.id);
  const agent = createProject(owner, {title:'규정 안내', graph});
  const edition = snapshot(owner, {id:agent.id, revision:agent.revision}).number;
  publish(owner, {id:agent.id, version:edition, visibility:'public'});
  const stored = getVersion(agent.id, edition).graph;
  const sharedRun = await execute(reader, agent.id, 'live');
  assert.equal(sharedRun.output, '대출 한도는 3권입니다.');
  const independent = projectCopy(reader, {id:agent.id});
  const newer = writeAsset(owner, {id:source.id, baseVersion:1, name:'새 규정', payload:{content:'대출 한도는 5권입니다.'}});
  assert.equal(newer.version, 2);
  const entry = trash(owner, newer);

  for (const user of [owner, reader]) {
    assert.ok(!assetList(user).some(item => item.id === source.id));
    assert.throws(() => readAsset(user, source.id, 1), {status:404});
    assert.throws(() => copyAsset(user, source.id), {status:404});
    assert.deepEqual(documentPreviews(user, [{id:source.id, version:1}]), ['']);
  }
  assert.throws(() => snapshot(owner, {id:agent.id, revision:agent.revision}), {status:404});
  assert.throws(() => startRun(owner, {id:agent.id, mode:'test', input:'규정', requestKey:'missing-source'}), {status:404});
  assert.equal(runGet(reader, sharedRun.id).output, '');
  assert.deepEqual(openProject(owner, agent.id).graph, graph);
  assert.equal(getVersion(agent.id, edition).graph, stored);
  assert.equal((await execute(reader, independent.id, 'test')).output, '대출 한도는 3권입니다.');

  const restored = restoreAsset(owner, entry);
  assert.equal(restored.id, source.id);
  assert.equal(restored.visibility, 'private');
  assert.deepEqual(restored.releasedVersions, []);
  assert.equal(restored.version, 2);
  assert.equal(readAsset(owner, source.id).payload.content, '대출 한도는 5권입니다.');
  assert.equal(readAsset(owner, source.id, 1).asset.name, source.name);
  assert.equal(readAsset(owner, source.id, 2).asset.name, newer.name);
  assert.equal((await execute(owner, agent.id, 'test')).output, '대출 한도는 3권입니다.');
  assert.deepEqual(openProject(owner, agent.id).graph, graph);
  assert.equal(getVersion(agent.id, edition).graph, stored);
  assert.throws(() => openProject(reader, agent.id), {status:403});
  assert.equal(runGet(reader, sharedRun.id).output, '');
});

test('delete verifies the reviewed state and permanently revokes previous link grants', () => {
  const owner = member('trash-links'), reader = legacyGuestSession().user;
  const asset = document(owner);
  const shared = assetShare(owner, asset.id, 'link', false, 1);
  grant(reader, 'asset', asset.id, shared.token!);
  assert.equal(readAsset(reader, asset.id).version, 1);
  assert.throws(() => deleteAsset(owner, reviewed(asset)), {status:409});
  assert.throws(() => deleteAsset(reader, reviewed(shared)), {status:403});
  const updated = writeAsset(owner, {id:asset.id, baseVersion:1, name:asset.name, payload:{content:'두 번째 판'}});
  assert.throws(() => deleteAsset(owner, reviewed(shared)), {status:409});
  const entry = trash(owner, updated);
  assert.deepEqual(deleteAsset(owner, reviewed(updated)), {id:asset.id});
  grant(reader, 'asset', asset.id, shared.token!);
  assert.equal(one("SELECT 1 FROM grants WHERE kind='asset' AND target=?", asset.id), undefined);
  assert.deepEqual(listTrashedAssets(reader), []);
  assert.throws(() => restoreAsset(reader, entry), {status:404});
  assert.throws(() => assetShare(owner, asset.id, 'public', false), {status:404});
  assert.throws(() => writeAsset(owner, {id:asset.id, baseVersion:2, name:'늦은 편집', payload:{content:'메모'}}), {status:404});

  const restored = restoreAsset(owner, entry);
  assert.notEqual(restored.token, shared.token);
  assert.throws(() => deleteAsset(owner, reviewed(updated)), {status:409});
  for (const version of [1, 2]) {
    assert.throws(() => readAsset(reader, asset.id, version, shared.token), {status:403});
  }
  const reshared = assetShare(owner, asset.id, 'link', false, 2);
  assert.notEqual(reshared.token, shared.token);
  assert.throws(() => readAsset(reader, asset.id), {status:403});
  assert.throws(() => readAsset(reader, asset.id, 1, reshared.token), {status:403});
  assert.throws(() => readAsset(reader, asset.id, 2, shared.token), {status:403});
  assert.equal(readAsset(reader, asset.id, 2, reshared.token).payload.content, '두 번째 판');
  assert.deepEqual(restoreAsset(owner, entry), reshared, 'retrying a restore must preserve a newer sharing decision');
  const secondEntry = trash(owner, reshared);
  assert.throws(() => deleteAsset(owner, reviewed(updated)), {status:409});
  assert.throws(() => restoreAsset(owner, entry), {status:409});
  assert.equal(listTrashedAssets(owner)[0].revision, secondEntry.revision);
});

test('batch purge validates every owner, active state and deletion revision, across all resource kinds', t => {
  const owner = member('trash-operator'), other = legacyGuestSession().user;
  const oldAdmins = process.env.STUDIO_ADMIN_IDS;
  process.env.STUDIO_ADMIN_IDS = owner.id;
  t.after(() => {
    if (oldAdmins === undefined) delete process.env.STUDIO_ADMIN_IDS;
    else process.env.STUDIO_ADMIN_IDS = oldAdmins;
  });
  const assets = [
    document(owner),
    writeAsset(owner, {kind:'knowledge', name:'규정집', payload:{content:'검색할 규정'}}),
    writeAsset(owner, {kind:'skill', name:'작성 지침', payload:{content:'# 출처 작성'}}),
    writeAsset(owner, {kind:'mcp', name:'도서관 연결', payload:{url:'https://example.test/mcp', tools:['lookup']}}),
  ];
  const entries = assets.map(asset => trash(owner, asset));
  const active = document(owner), outsider = trash(other, document(other));
  const [first, previous] = entries;
  const current = trash(owner, restoreAsset(owner, previous));
  entries[1] = current;
  assert.notEqual(current.revision, previous.revision);
  assert.equal(current.version, previous.version);
  assert.throws(() => restoreAsset(owner, previous), {status:409});
  assert.throws(() => purgeTrashedAssets(owner, {items:[first, outsider]}), {status:404});
  assert.throws(() => purgeTrashedAssets(owner, {items:[first, reviewed(active)]}), {status:409});
  assert.throws(() => purgeTrashedAssets(owner, {items:[first, previous]}), {status:409});
  assert.throws(() => purgeTrashedAssets(owner, {items:[first, first]}), {status:400});
  assert.deepEqual(listTrashedAssets(owner).map(item => item.id).sort(), entries.map(item => item.id).sort());
  assert.deepEqual(listTrashedAssets(owner).map(item => item.kind).sort(), ['document', 'knowledge', 'mcp', 'skill']);
  assert.deepEqual(purgeTrashedAssets(owner, {items:entries}), {ids:entries.map(item => item.id)});
  for (const {id, revision} of entries) {
    assert.throws(() => restoreAsset(owner, {id, revision}), {status:404});
    assert.equal(one('SELECT 1 FROM assets WHERE id=?', id), undefined);
    for (const table of ['asset_versions', 'asset_edition_names', 'deleted_assets'])
      assert.equal(one('SELECT 1 FROM '+table+' WHERE asset=?', id), undefined, table);
  }
  assert.equal(readAsset(owner, active.id).asset.id, active.id);
  assert.equal(restoreAsset(other, outsider).id, outsider.id);
  assert.equal(one('PRAGMA foreign_key_check'), undefined);
});

test('purge removes the source search passages and keeps old conversation receipts closed', async () => {
  const owner = member('trash-index-owner');
  const source = document(owner, '사라질 색인 원문');
  const sibling = document(owner, '남아 있을 색인 원문');
  const graph:Graph = {
    nodes:[
      createBlock('input.user_request', {id:'question'}),
      createBlock('knowledge.search', {id:'search', config:{query:'원문'}}),
      createBlock('output.answer', {id:'answer'}),
      ...[source, sibling].map(asset => createBlock('resource.context', {id:asset.id, config:{assetId:asset.id, version:1}})),
    ],
    edges:[
      {id:'start', from:'question', out:'next', to:'search', input:'in', kind:'flow'},
      {id:'query', from:'question', out:'value', to:'search', input:'input', kind:'data'},
      {id:'next', from:'search', out:'next', to:'answer', input:'in', kind:'flow'},
      {id:'results', from:'search', out:'value', to:'answer', input:'input', kind:'data'},
      ...[source, sibling].map(asset => ({id:'ref-'+asset.id, from:asset.id, out:'ref', to:'search', input:'context', kind:'reference' as const})),
    ],
  };
  const agent = createProject(owner, {graph});
  const version = snapshot(owner, {id:agent.id, revision:agent.revision}).number;
  publish(owner, {id:agent.id, version, visibility:'private'});
  const cached = (text:string) => Boolean(one('SELECT 1 FROM knowledge_document_indexes WHERE instr(entries,?)>0', text));
  assert.ok(cached('사라질 색인 원문'));
  assert.ok(cached('남아 있을 색인 원문'));

  const independent = createProject(owner, {graph:graphFor(sibling.id)});
  const oldRun = await execute(owner, independent.id, 'test');
  // Collection runs can have source receipts even when their graph only names the collection.
  set('INSERT INTO knowledge_source_reads VALUES(?,?,?,?)', oldRun.conversation, source.id, '1', null);
  assert.equal(runGet(owner, oldRun.id).output, '남아 있을 색인 원문');
  const entry = trash(owner, source);
  assert.equal(runGet(owner, oldRun.id).output, '');
  purgeTrashedAssets(owner, {items:[entry]});
  assert.equal(cached('사라질 색인 원문'), false);
  assert.ok(cached('남아 있을 색인 원문'));
  assert.equal(runGet(owner, oldRun.id).output, '');
  assert.deepEqual(runGet(owner, oldRun.id).events, []);
  assert.equal((await execute(owner, independent.id, 'test')).output, '남아 있을 색인 원문');
  assert.deepEqual(openProject(owner, agent.id).graph, graph);
});

test('expired assets are unrecoverable at exactly 72 hours and can be swept without their owner opening trash', t => {
  const start = Date.parse('2030-10-01T20:48:30.456Z');
  const deadline = start + 72 * 60 * 60 * 1000;
  t.mock.timers.enable({apis:['Date'], now:start});
  const owner = legacyGuestSession().user, other = legacyGuestSession().user;
  const early = trash(owner, document(owner)), late = trash(owner, document(owner));
  const unattended = trash(other, document(other));
  t.mock.timers.setTime(start + 1);
  const newer = trash(other, document(other));
  assert.equal(late.expiresAt, new Date(deadline).toISOString());
  t.mock.timers.setTime(deadline - 1);
  assert.equal(restoreAsset(owner, early).id, early.id);
  purgeExpiredAssets();
  assert.ok(listTrashedAssets(owner).some(row => row.id === late.id));
  t.mock.timers.setTime(deadline);
  assert.throws(() => restoreAsset(owner, late), {status:404});
  assert.throws(() => purgeTrashedAssets(other, {items:[newer, unattended]}), {status:404});
  purgeExpiredAssets();
  for (const entry of [late, unattended])
    assert.equal(one('SELECT 1 FROM assets WHERE id=?', entry.id), undefined);
  assert.equal(restoreAsset(other, newer).id, newer.id);
  assert.equal(purgeExpiredAssets(), 0);
});
