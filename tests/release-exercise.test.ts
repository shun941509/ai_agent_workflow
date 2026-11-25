import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { templates, type Graph } from '../src/domain';
import type { ReleaseAction } from '../src/domain/release-decision';
import { authenticate } from '../src/server/auth';
import { legacyGuestSession } from './legacy-guest';
import { db } from '../src/server/db';
import { caseList, createProject, decideRelease, getVersion, openProject, projectCopy, versionList } from '../src/server/projects';

const dir=mkdtempSync(join(tmpdir(),'studio-release-exercise-'));
process.env.STUDIO_DATA_DIR=dir;
after(()=>{db().close();rmSync(dir,{recursive:true,force:true});});
const content=(graph:Graph)=>String(graph.nodes.find(node=>node.id==='rules')!.config.content);

test('신규 게시 판단 실습만 두 비공개 버전과 실제 비교 사례로 시작한다',()=>{
  const owner=legacyGuestSession().user,visitor=legacyGuestSession().user;
  const fresh=createProject(owner,{lesson:'release'});
  assert.equal(fresh.publicVersion,null);
  assert.equal(fresh.visibility,'private');
  assert.deepEqual(fresh.releaseExercise?.decisions,[]);
  assert.deepEqual(versionList(owner,fresh.id).map(v=>v.number),[2,1]);
  const baseline=JSON.parse(getVersion(fresh.id,1).graph);
  const candidate=JSON.parse(getVersion(fresh.id,2).graph);
  assert.ok(fresh.graph);
  assert.deepEqual(candidate,fresh.graph);
  assert.match(content(baseline),/3권/);
  assert.match(content(baseline),/일요일은 휴관/);
  assert.match(content(candidate),/5권/);
  assert.match(content(candidate),/일요일에는 오전 10시부터 오후 4시까지/);
  assert.equal(caseList(owner,fresh.id).length,3);
  assert.throws(()=>openProject(visitor,fresh.id),/공유 권한/);

  const copy=projectCopy(owner,{id:fresh.id});
  const imported=createProject(owner,{lesson:'release',graph:templates.find(t=>t.id==='release')!.graph});
  for(const other of [copy,imported]){
    assert.equal(other.releaseExercise,undefined);
    assert.deepEqual(versionList(owner,other.id),[]);
    assert.deepEqual(caseList(owner,other.id),[]);
  }
});

test('판단과 게시 변경은 함께 저장되며 보류·유지·오래된 요청은 게시 상태를 바꾸지 않는다',()=>{
  const owner=authenticate('signup','release-decision-owner','demo-password-4242','').user;
  const reader=legacyGuestSession().user;
  let p=createProject(owner,{lesson:'release'});
  const decision=(action:ReleaseAction,version:number,reason:string,visibility='link')=>({
    id:p.id,action,version,reason,visibility,expectedVisibility:p.visibility,expectedPublicVersion:p.publicVersion,
    expectedDecision:p.releaseExercise!.decisions[0]?.number??0,
  });
  const obsolete=decision('publish',2,'후보 확인');
  p=decideRelease(owner,decision('hold',2,'일요일 운영 답변이 방문자에게 잘못된 시간을 안내한다.'));
  assert.equal(p.publicVersion,null);
  assert.equal(p.visibility,'private');
  assert.throws(()=>decideRelease(owner,obsolete),/변경/);
  assert.throws(()=>decideRelease(reader,decision('publish',2,'발행')),/내 Agent/);
  assert.throws(()=>decideRelease(owner,decision('publish',2,' ')),/판단 근거/);
  p=decideRelease(owner,decision('publish',2,'이미 게시된 후보의 운영 영향 실습'));
  const token=p.token;
  const view=openProject(reader,p.id,token);
  assert.equal(view.releaseExercise,undefined);
  assert.equal(view.publicVersion,2);
  p=decideRelease(owner,decision('keep',2,'영향 범위 확인 중','public'));
  assert.equal(p.publicVersion,2);
  assert.equal(p.visibility,'link');
  assert.equal(p.token,token);
  p=decideRelease(owner,decision('rollback',1,'기준판이 일요일 규정을 지켜 복구한다.','public'));
  assert.equal(p.visibility,'link');
  assert.equal(p.token,token);
  assert.equal(openProject(reader,p.id,token).publicVersion,1);
  assert.deepEqual(openProject(owner,p.id).releaseExercise!.decisions.map(d=>[d.action,d.previousVersion,d.resultVersion]),[
    ['rollback',2,1],['keep',2,2],['publish',null,2],['hold',null,null],
  ]);
});
