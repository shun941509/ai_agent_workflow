import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, test} from 'node:test';
import {authenticate} from '../src/server/auth';
import {deleteAsset, listTrashedAssets, purgeTrashedAssets} from '../src/server/asset-trash';
import {assetList, assetShare, readAsset, readLibraryAsset, writeAsset} from '../src/server/assets';
import {db, set} from '../src/server/db';
import {createProject, openProject, projectCopy} from '../src/server/projects';

const directory = mkdtempSync(join(tmpdir(), 'studio-optional-materials-'));
process.env.STUDIO_DATA_DIR = directory;
after(() => { db().close(); rmSync(directory, {recursive:true, force:true}); });

const skillName = '교정 사유 표시 Skill';
const noticeName = '강변도서관 보완 안내문';

test('고급 실습 사본은 팀에 직접 연결할 비공개 교정 지침을 자료 목록에 한 번 제공한다', () => {
  const owner = authenticate('signup', 'optional-review', 'optional-password', '').user;
  const reader = authenticate('signup', 'optional-reader', 'optional-password', '').user;
  const personal = writeAsset(owner, {kind:'skill', name:skillName, payload:{content:'내가 쓴 지침'}});
  const project = createProject(owner, {lesson:'peer-review'});
  const skill = assetList(owner).find(item => item.id !== personal.id && item.name === skillName);
  assert.ok(skill, '팀에 연결할 교정 Skill을 자료 목록에서 고를 수 있다');
  assert.equal(skill.kind, 'skill');
  assert.equal(skill.visibility, 'private');
  assert.ok(skill.mine);
  assert.equal(skill.exampleLesson, 'peer-review');
  assert.equal(assetList(owner).find(item => item.id === personal.id)?.exampleLesson, undefined);
  const {payload} = readAsset(owner, skill.id, 1);
  assert.equal(payload.files?.[0].path, 'SKILL.md');
  assert.match(payload.content, /교정 사유/);
  assert.match(payload.content, /원문/);
  assert.match(payload.content, /한 줄/);
  assert.equal(readAsset(owner, personal.id).payload.content, '내가 쓴 지침');
  assert.doesNotMatch(JSON.stringify(openProject(owner, project.id).graph), new RegExp(skill.id));
  assert.deepEqual(assetList(reader), []);
  assert.throws(() => readAsset(reader, skill.id, 1), {status:403});
  writeAsset(owner, {id:skill.id, baseVersion:1, name:'내 교정 지침', payload:{content:'내가 바꾼 지침'}});
  projectCopy(owner, {id:project.id});
  createProject(owner, {lesson:'peer-review'});
  assert.equal(assetList(owner).length, 2);
  assert.equal(assetList(owner).find(item => item.id === skill.id)?.exampleLesson, 'peer-review');
  assert.equal(readAsset(owner, skill.id).payload.content, '내가 바꾼 지침');
});

test('전문가 실습은 기본 조사에서 빠진 지점의 원문을 사용자가 선택할 때 쓸 수 있게 제공한다', () => {
  const owner = authenticate('signup', 'optional-branch', 'optional-password', '').user;
  createProject(owner, {lesson:'intro'});
  assert.deepEqual(assetList(owner), []);
  const project = createProject(owner, {lesson:'dynamic'});
  const [notice] = assetList(owner);
  assert.equal(notice?.name, noticeName);
  assert.equal(notice.kind, 'document');
  assert.equal(notice.visibility, 'private');
  assert.equal(notice.exampleLesson, 'dynamic');
  const sentence = '강변도서관은 평일 오전 11시에 엽니다.';
  assert.equal(readAsset(owner, notice.id, 1).payload.content, sentence);
  assert.ok(!JSON.stringify(project.graph).includes(sentence));
  assert.ok(!JSON.stringify(project.graph).includes(notice.id));
  assert.ok(notice.revision);
  deleteAsset(owner, {id:notice.id, revision:notice.revision});
  const [trashed] = listTrashedAssets(owner);
  assert.equal(trashed.id, notice.id);
  assert.equal(trashed.exampleLesson, 'dynamic');
  purgeTrashedAssets(owner, {items:[trashed]});
  createProject(owner, {lesson:'dynamic'});
  assert.deepEqual(assetList(owner), []);
});

test('예제 ID를 기록하지 않은 이전 계정은 같은 이름과 원문을 직접 저장해도 예제로 표시하거나 재설치하지 않는다', () => {
  const owner = authenticate('signup', 'optional-old', 'optional-password', '').user;
  set('INSERT INTO installed_lesson_materials(owner,lesson) VALUES(?,?)', owner.id, 'dynamic');
  const personal = writeAsset(owner, {kind:'document', name:noticeName, payload:{content:'강변도서관은 평일 오전 11시에 엽니다.'}});
  createProject(owner, {lesson:'dynamic'});
  const items = assetList(owner);
  assert.deepEqual(items.map(item => [item.id, item.exampleLesson]), [[personal.id, undefined]]);
});

test('공유된 실습 자료의 미리보기는 소유자의 설치 정보와 미게시 판을 공개하지 않는다', () => {
  const owner = authenticate('signup', 'optional-sharing', 'optional-password', '').user;
  const reader = authenticate('signup', 'optional-shared-reader', 'optional-password', '').user;
  createProject(owner, {lesson:'dynamic'});
  const [notice] = assetList(owner);
  writeAsset(owner, {id:notice.id, baseVersion:1, name:'비공개 수정', payload:{content:'아직 공개하지 않은 문장'}});
  assetShare(owner, notice.id, 'public', false, 1);
  const [shared] = assetList(reader);
  assert.equal(shared.version, 1);
  assert.equal(shared.name, noticeName);
  assert.deepEqual(shared.releasedVersions, [1]);
  assert.equal(shared.exampleLesson, undefined);
  assert.equal(readLibraryAsset(reader, notice.id, 1).payload.content, '강변도서관은 평일 오전 11시에 엽니다.');
  assert.throws(() => readLibraryAsset(reader, notice.id, 2), {status:403});
});
