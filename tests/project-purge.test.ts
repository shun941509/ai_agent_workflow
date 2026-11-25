import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { type User } from '../src/server/auth';
import { legacyGuestSession } from './legacy-guest';
import { db, one, set } from '../src/server/db';
import {
  createProject, deleteProject, listTrashedProjects, openProject, projectCopy,
  purgeExpiredProjects, purgeTrashedProjects, restoreProject,
} from '../src/server/projects';
import { runGet, startRun } from '../src/server/runs';

const dir = mkdtempSync(join(tmpdir(), 'studio-trash-retention-'));
process.env.STUDIO_DATA_DIR = dir;
after(() => { db().close(); rmSync(dir, { recursive:true, force:true }); });

function trash(owner:User, project:{id:string; revision?:number}) {
  deleteProject(owner, { id:project.id, revision:project.revision! });
  return listTrashedProjects(owner).find(item => item.id === project.id)!;
}

test('permanent deletion is atomic and checks each selected trash revision and owner', () => {
  const owner = legacyGuestSession().user, other = legacyGuestSession().user;
  const first = trash(owner, createProject(owner, {title:'같은 이름'}));
  const next = trash(owner, createProject(owner, {title:'같은 이름'}));
  const active = createProject(owner, {title:'같은 이름'});
  const outsider = trash(other, createProject(other, {title:'같은 이름'}));
  const restored = restoreProject(owner, next);
  const second = trash(owner, restored);
  const items = [first, second].map(({id, revision}) => ({id, revision}));

  assert.throws(() => purgeTrashedProjects(owner, {items:[first, outsider]}), {status:404});
  assert.throws(() => purgeTrashedProjects(owner, {items:[first, first]}), {status:400});
  assert.throws(() => purgeTrashedProjects(owner, {items:[first, next]}), {status:409});
  assert.throws(() => purgeTrashedProjects(owner, {items:[first, active]}), {status:409});
  assert.deepEqual(listTrashedProjects(owner).map(item => item.id).sort(), [first.id, second.id].sort());
  assert.deepEqual(purgeTrashedProjects(owner, {items}), {ids:[first.id, second.id]});
  assert.deepEqual(listTrashedProjects(owner), []);
  for (const item of items) {
    assert.equal(one('SELECT id FROM projects WHERE id=?', item.id), undefined);
    assert.throws(() => restoreProject(owner, item), {status:404});
  }
  assert.equal(openProject(owner, active.id).id, active.id);
  assert.equal(restoreProject(other, outsider).id, outsider.id);
});

test('purge removes versions, cases, conversation data and memory while preserving independent copies', () => {
  const owner = legacyGuestSession().user;
  const project = createProject(owner, {lesson:'release'});
  const copy = projectCopy(owner, {id:project.id});
  const run = startRun(owner, {id:project.id, mode:'test', input:'원본', requestKey:'before-purge'});
  const copyRun = startRun(owner, {id:copy.id, mode:'test', input:'사본', requestKey:'keep-copy'});
  // A conversation in a surviving project can contain historical results from another Agent.
  set('INSERT INTO knowledge_reads VALUES(?,?,?,?,?,?)', copyRun.conversation, project.id, 'live', '자료집', '1', '원본');
  set('INSERT INTO memory VALUES(?,?,?,?,?)', owner.id, project.id, 'live', '내용', '원본');
  set('INSERT INTO memory VALUES(?,?,?,?,?)', owner.id, copy.id, 'live', '내용', '독립');
  set('INSERT INTO replies VALUES(?,?,?)', run.id, '질문', '응답');

  const records = [
    ['projects','id',project.id], ['versions','project',project.id], ['cases','project',project.id],
    ['release_exercises','project',project.id], ['memory','project',project.id], ['knowledge_reads','project',project.id],
    ['conversations','project',project.id], ['runs','id',run.id], ['replies','run',run.id],
    ['run_intents','run',run.id], ['run_fixtures','conversation',run.conversation],
    ['deleted_projects','project',project.id],
  ];
  const entry = trash(owner, project);
  for (const [table, column, value] of records)
    assert.ok(one('SELECT 1 FROM '+table+' WHERE '+column+'=?', value), table+' fixture missing');
  purgeTrashedProjects(owner, {items:[entry]});
  for (const [table, column, value] of records)
    assert.equal(one('SELECT 1 FROM '+table+' WHERE '+column+'=?', value), undefined, table);

  assert.equal(one('PRAGMA foreign_key_check'), undefined);
  assert.throws(() => runGet(owner, run.id), {status:404});
  assert.equal(openProject(owner, copy.id).id, copy.id);
  assert.equal(one<{value:string}>('SELECT value FROM memory WHERE project=?', copy.id)?.value, '독립');
  assert.equal(runGet(owner, copyRun.id).input, '', 'past results depending on a purged source must stay inaccessible');
  const newRun = startRun(owner, {id:copy.id, mode:'test', input:'새 실행', requestKey:'after-purge'});
  assert.equal(runGet(owner, newRun.id).input, '새 실행');
});

test('recovery ends at exactly 72 hours and automatic cleanup works across owners without a trash visit', t => {
  const start = Date.parse('2030-04-30T15:12:34.567Z');
  const deadline = start + 72 * 60 * 60 * 1000;
  t.mock.timers.enable({ apis:['Date'], now:start });
  const owner = legacyGuestSession().user, other = legacyGuestSession().user;
  const early = trash(owner, createProject(owner, {title:'만료 직전 복구'}));
  const late = trash(owner, createProject(owner, {title:'만료 후 복구 시도'}));
  const unattended = trash(other, createProject(other, {title:'열지 않은 휴지통'}));
  t.mock.timers.setTime(start + 1);
  const newer = trash(other, createProject(other, {title:'1밀리초 더 보관'}));

  assert.equal(late.expiresAt, new Date(deadline).toISOString());
  t.mock.timers.setTime(deadline - 1);
  purgeExpiredProjects();
  assert.equal(restoreProject(owner, early).id, early.id);
  assert.ok(listTrashedProjects(owner).some(item => item.id === late.id));
  t.mock.timers.setTime(deadline);
  assert.throws(() => purgeTrashedProjects(other, {items:[newer, unattended]}), {status:404});
  assert.throws(() => restoreProject(owner, late), {status:404});
  assert.deepEqual(listTrashedProjects(owner), []);
  purgeExpiredProjects();
  purgeExpiredProjects();
  for (const item of [late, unattended])
    assert.equal(one('SELECT id FROM projects WHERE id=?', item.id), undefined);
  assert.equal(restoreProject(other, newer).id, newer.id);
  assert.equal(openProject(owner, early.id).id, early.id);
});
