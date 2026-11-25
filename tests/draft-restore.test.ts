import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBlock } from '../src/domain';
import { legacyGuestSession } from './legacy-guest';
import { db } from '../src/server/db';
import { createProject, draftArchiveList, openProject, restore, saveProject, snapshot, versionList } from '../src/server/projects';

const dir = mkdtempSync(join(tmpdir(), 'studio-draft-restore-'));
process.env.STUDIO_DATA_DIR = dir;
after(() => { db().close(); rmSync(dir, { recursive: true, force: true }); });

test('restore preserves the exact displaced draft, even with incomplete references, and can reopen it', () => {
  const owner = legacyGuestSession().user, other = legacyGuestSession().user;
  const initial = createProject(owner, {lesson:'release'});
  const {id} = initial;
  const originalVersions = versionList(owner, id);
  const unfinished = {nodes:[createBlock('workflow.call', {config:{workflowId:'missing'}})], edges:[]};
  const draft = saveProject(owner, {...initial, title:'수정 중인 규정', graph:unfinished});
  assert.throws(() => snapshot(owner, draft));
  assert.throws(() => restore(owner, {id, version:1, revision:initial.revision}), {status:409});
  assert.deepEqual(draftArchiveList(owner, id), []);

  const restored = restore(owner, {id, version:1, revision:draft.revision});
  assert.equal(restored.archivedRevision, draft.revision);
  assert.deepEqual(versionList(owner, id), originalVersions);
  assert.throws(() => draftArchiveList(other, id), {status:403});
  assert.throws(() => restore(other, {id, archive:draft.revision, revision:restored.revision}), {status:403});

  const same = restore(owner, {id, version:1, revision:restored.revision});
  assert.equal(same.archivedRevision, null);
  assert.equal(same.revision, restored.revision);
  const differentTitle = saveProject(owner, {...same, title:'제목만 변경'});
  const reopened = restore(owner, {id, archive:draft.revision, revision:differentTitle.revision});
  assert.equal(reopened.title, draft.title);
  assert.deepEqual(reopened.graph, unfinished);
  assert.deepEqual(draftArchiveList(owner, id).map(archive => archive.title), [differentTitle.title, draft.title]);
  assert.equal(openProject(owner, id).publicVersion, initial.publicVersion);
  const renamed = saveProject(owner, {...reopened, title:'다른 이름'});
  assert.equal(restore(owner, {id, archive:draft.revision, revision:renamed.revision}).archivedRevision, renamed.revision);
});
