import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {createBlock,type Graph} from '../src/domain';
import {assetDto,assetList,assetRow,assetShare,copyAsset,pins,readAsset,readLibraryAsset,sharedAssetList,writeAsset} from '../src/server/assets';
import { authenticate, type User } from '../src/server/auth';
import { legacyGuestSession } from './legacy-guest';
import {createProject,deleteProject,openProject,projectCopy,projectSharedAccess,publish,revoke,saveProject,snapshot,caseSave} from '../src/server/projects';
import {inputFiles,lastTestSources,runGet,runList,startRun,stopRun,workOne,replyRun} from '../src/server/runs';
import {execFileSync} from 'node:child_process';
import {db,one,set} from '../src/server/db';

const dir=mkdtempSync(join(tmpdir(),'studio-sharing-'));
process.env.STUDIO_DATA_DIR=dir;
after(()=>{db().close();rmSync(dir,{recursive:true,force:true});});
const member=(name:string)=>authenticate('signup',name,'test-password-920','').user;
const graphFor=(assetId:string,version=1,wait=false):Graph=>{
  const nodes=[
    createBlock('input.user_request',{id:'input'}),
    createBlock('resource.context',{id:'rules',config:{assetId,version,content:'이전 편집본의 메모'}}),
    createBlock('output.answer',{id:'result'})
  ];
  if(wait)nodes.push(createBlock('input.form',{id:'consent',config:{prompt:'이어서 확인할까요?'}}));
  const edges:Graph['edges']=[
    {id:'next',from:'input',to:wait?'consent':'result',kind:'flow',out:'next',input:'in'},
    {id:'content',from:'rules',to:'result',kind:'data',out:'value',input:'input'}
  ];
  if(wait)edges.push({id:'after',from:'consent',to:'result',kind:'flow',out:'next',input:'in'});
  return {nodes,edges};
};
async function execute(user:User,id:string,key:string,more:Record<string,unknown>={}){
  const run=startRun(user,{id,input:'대출 규정',mode:'live',requestKey:key,...more});assert.equal(await workOne(),true);return runGet(user,run.id);
}

test('열린 공유 Agent의 접근 상태는 권한을 발급하지 않고 철회와 휴지통을 반영한다', () => {
  const owner = member('shared-access-owner'), reader = legacyGuestSession().user;
  const project = createProject(owner, {lesson:'intro'});
  const available = (token?: string, generation?: string) => projectSharedAccess(reader, project.id, token, generation).available;
  assert.equal(available(), false);
  assert.deepEqual(projectSharedAccess(reader, 'missing-project'), {available:false});
  const {number} = snapshot(owner, {id:project.id, revision:project.revision});
  const publishAs = (visibility: 'public' | 'link') => publish(owner, {id:project.id, version:number, visibility});
  publishAs('public');
  assert.equal(available(), true);
  const link = publishAs('link');
  assert.equal(available(link.token), true);
  assert.equal(available(), false);
  const opened = openProject(reader, project.id, link.token);
  assert.ok(opened.shareGeneration);
  assert.equal(opened.token, undefined);
  assert.notEqual(opened.shareGeneration, link.token);
  assert.equal(projectSharedAccess(legacyGuestSession().user, project.id, undefined, opened.shareGeneration).available, false);
  assert.equal(available(), true);
  assert.equal(openProject(reader, project.id).shareGeneration, opened.shareGeneration);
  publishAs('link');
  assert.equal(available(undefined, opened.shareGeneration), true);
  revoke(owner, project.id);
  assert.equal(available(), false);
  assert.equal(available(link.token), false);
  const updated = publishAs('link');
  assert.equal(available(link.token), false);
  assert.equal(available(updated.token), true);
  const reopened = openProject(reader, project.id, updated.token);
  assert.notEqual(reopened.shareGeneration, opened.shareGeneration);
  assert.equal(available(), true);
  assert.equal(available(link.token), false);
  assert.equal(available(undefined, opened.shareGeneration), false);
  assert.equal(available(updated.token, opened.shareGeneration), false);
  assert.equal(available(undefined, reopened.shareGeneration), true);
  assert.deepEqual(openProject(reader, project.id), reopened);
  assert.throws(() => openProject(reader, project.id, link.token), {status:403});
  assert.throws(() => projectCopy(reader, {id:project.id, published:true, shareGeneration:opened.shareGeneration}), {status:403});
  deleteProject(owner, {id:project.id, revision:updated.revision!});
  assert.equal(available(updated.token), false);
});

test('공유 목록은 소유자에게도 게시한 판을 표시하고 받은 링크의 현재 권한을 따른다',()=>{
  const owner=member('gallery-owner'), reader=legacyGuestSession().user, visitor=legacyGuestSession().user;
  const asset=writeAsset(owner,{name:'도서관 규정',kind:'document',payload:{content:'세 권'}});
  assetShare(owner,asset.id,'public',false,1);
  writeAsset(owner,{id:asset.id,baseVersion:1,name:'편집 중인 규정',payload:{content:'다섯 권'}});
  const lookup=(user:User)=>sharedAssetList(user).find(item=>item.id===asset.id);
  for(const user of [owner,reader]){
    assert.deepEqual(lookup(user),{id:asset.id,name:'도서관 규정',kind:'document',version:1,publicVersion:1,mine:user===owner,visibility:'public'});
    const detail=readLibraryAsset(user,asset.id,undefined,undefined,true);
    assert.equal(detail.version,1);assert.equal(detail.asset.version,1);
    assert.equal(detail.payload.content,'세 권');assert.deepEqual(detail.asset.releasedVersions,[1]);
    assert.throws(()=>readLibraryAsset(user,asset.id,2,undefined,true),{status:403});
    assert.throws(()=>copyAsset(user,asset.id,2,undefined,undefined,true),{status:403});
  }
  assert.equal(readLibraryAsset(owner,asset.id).version,2);
  const shared=assetShare(owner,asset.id,'link',false,1);
  assert.equal(lookup(owner),undefined);assert.equal(lookup(reader),undefined);
  readLibraryAsset(reader,asset.id,1,shared.token,true);
  assert.equal(lookup(reader)?.name,'도서관 규정');assert.equal(lookup(visitor),undefined);
  const copy=copyAsset(reader,asset.id,1,undefined,'gallery-copy',true);
  assetShare(owner,asset.id,'link',true);
  assert.equal(lookup(reader),undefined);
  assert.throws(()=>readLibraryAsset(reader,asset.id,1,undefined,true),{status:403});
  assert.throws(()=>copyAsset(reader,asset.id,1,shared.token,undefined,true),{status:403});
  assert.equal(copyAsset(reader,asset.id,1,undefined,'gallery-copy',true).id,copy.id);
  assert.equal(readLibraryAsset(reader,copy.id).payload.content,'세 권');
  assetShare(owner,asset.id,'private',false);
  assert.throws(()=>readLibraryAsset(owner,asset.id,1,undefined,true),{status:403});
});

test('selected immutable release controls asset text, title, exposed history and audience',()=>{
  const owner=member('release-asset-owner'),peer=member('release-asset-peer'),guest=legacyGuestSession().user;
  const asset=writeAsset(owner,{name:'지점 전용 규정',kind:'document',payload:{content:'지점 자료'}});
  const first=assetShare(owner,asset.id,'link',false,1);
  const second=writeAsset(owner,{id:asset.id,baseVersion:1,name:'공개 이용규정',payload:{content:'공개 자료'}});
  assert.equal(readAsset(peer,asset.id,undefined,first.token).asset.name,'지점 전용 규정');
  assert.throws(()=>readAsset(peer,asset.id,2,first.token),/공유/);
  assert.throws(()=>assetShare(owner,asset.id,'public',false,22),/찾을 수/);
  const current=assetShare(owner,second.id,'public',false,2);
  assert.equal(current.publicVersion,2);assert.deepEqual(assetDto(assetRow(asset.id),guest).releasedVersions,[2]);
  assert.throws(()=>readAsset(guest,asset.id,1),/공유/);
  assert.throws(()=>readAsset(guest,asset.id,1,first.token),/공유/);
  assert.equal(readAsset(guest,asset.id).payload.content,'공개 자료');
  writeAsset(owner,{id:asset.id,baseVersion:2,name:'새 비공개 제목',payload:{content:'미공개 초안'}});
  assert.equal(assetList(guest).find(a=>a.id===asset.id)?.name,'공개 이용규정');
  assert.throws(()=>readAsset(guest,asset.id,3),/공유/);
  const restored=assetShare(owner,asset.id,'public',false,1);
  assert.equal(restored.token,current.token);assert.equal(readAsset(guest,asset.id).asset.name,'지점 전용 규정');
  assert.deepEqual(assetDto(assetRow(asset.id),guest).releasedVersions,[2,1]);
  assert.throws(()=>assetShare(owner,asset.id,'public',false,[1] as never),/정수/);
  assetShare(owner,asset.id,'private',false);assetShare(owner,asset.id,'public',false,2);
  assert.deepEqual(assetDto(assetRow(asset.id),guest).releasedVersions,[2]);
});

test('library sharing addresses follow the published edition or pin an authorized edition',()=>{
  const owner=member('asset-link-owner'),reader=legacyGuestSession().user,other=legacyGuestSession().user;
  const {id}=writeAsset(owner,{kind:'document',name:'대출 규정',payload:{content:'3권'}});
  const secret=assetShare(owner,id,'link',false,1).token;
  assert.equal(readLibraryAsset(reader,id,'published',secret).version,1);
  writeAsset(owner,{id,baseVersion:1,name:'대출 규정',payload:{content:'5권'}});
  assert.equal(readLibraryAsset(owner,id).version,2);
  assert.equal(readLibraryAsset(owner,id,'published').payload.content,'3권');
  assert.throws(()=>readLibraryAsset(reader,id,2,secret),/공유/);
  assetShare(owner,id,'link',false,2);
  assert.equal(readLibraryAsset(reader,id,'published').payload.content,'5권');
  assert.equal(readLibraryAsset(reader,id,'1',secret).payload.content,'3권');
  assert.equal(readLibraryAsset(reader,id).asset.token,secret);
  assert.throws(()=>readLibraryAsset(other,id,1),/권한/);
  assert.throws(()=>readLibraryAsset(reader,id,'invalid',secret),/정수/);
  const rotated=assetShare(owner,id,'link',true,2).token;
  assert.throws(()=>readLibraryAsset(reader,id,'published',secret),/공유/);
  assert.equal(readLibraryAsset(reader,id,1,rotated).version,1);
  assert.throws(()=>readLibraryAsset(reader,id,1,secret),/공유/);
  assetShare(owner,id,'public',false,2);
  assert.deepEqual(readLibraryAsset(other,id,'published').asset.releasedVersions,[2]);
  assert.throws(()=>readLibraryAsset(other,id,1),/공유/);
  assert.equal(readLibraryAsset(other,id,2).asset.token,undefined);
  assetShare(owner,id,'private',false);
  assert.throws(()=>readLibraryAsset(owner,id,'published'),/게시/);
  assert.throws(()=>readLibraryAsset(other,id,2),/권한/);
});

test('a public link returns 3→5→3 in new conversations and pins old facts in an existing conversation',async()=>{
  const owner=member('release-agent-owner'),peer=member('release-agent-peer'),guest=legacyGuestSession().user;
  const source=writeAsset(owner,{kind:'document',name:'대출 규정',payload:{content:'3권'}});
  assetShare(owner,source.id,'public',false,1);
  const first=createProject(owner,{title:'대출 안내',graph:graphFor(source.id)});
  const v1=snapshot(owner,{id:first.id,revision:first.revision});
  const url1=publish(owner,{id:first.id,visibility:'public',version:v1.number});
  const old=await execute(peer,first.id,'first');assert.equal(old.state,'completed');assert.equal(old.output,'3권');
  writeAsset(owner,{id:source.id,baseVersion:1,name:'대출 규정',payload:{content:'5권'}});
  assetShare(owner,source.id,'public',false,2);
  const updated=saveProject(owner,{id:first.id,revision:first.revision,title:'대출 안내',graph:graphFor(source.id,2)});
  const v2=snapshot(owner,{id:first.id,revision:updated.revision});
  assert.equal((await execute(guest,first.id,'before-publish')).output,'3권');
  const url2=publish(owner,{id:first.id,visibility:'public',version:v2.number});
  assert.equal(url1.id,url2.id);assert.equal(url1.token,url2.token);
  assert.equal((await execute(guest,first.id,'after-publish')).output,'5권');
  assert.equal((await execute(peer,first.id,'follow-up',{conversation:old.conversation})).output,'3권');
  assert.equal(JSON.stringify(openProject(peer,first.id)).includes('이전 편집본'),false);
  const independent=projectCopy(peer,{id:first.id});
  publish(owner,{id:first.id,visibility:'public',version:v1.number});
  assert.equal((await execute(guest,first.id,'after-rollback')).output,'3권');
  const copySource=independent.graph!.nodes.find(n=>n.id==='rules')!.config.assetId;
  assert.notEqual(copySource,source.id);assert.equal(readAsset(peer,copySource).payload.content,'5권');
  assert.throws(()=>readAsset(owner,copySource),/권한/);
  const tc=caseSave(owner,{id:first.id,title:'분리된 시험',input:'규정',expected:'시험 전용',fixture:{documents:{rules:'시험 전용'}}});
  const testRun=await execute(owner,first.id,'fixture',{mode:'test',caseId:tc.id,version:v1.number});
  assert.equal(testRun.output,'시험 전용');
  const lastTest=lastTestSources(owner,first.id);
  assert.equal(lastTest?.version,v1.number);
  assert.equal(lastTest?.runId,testRun.id);
  assert.equal(lastTest?.sources?.['["rules"]'].text,'시험 전용');
  assert.throws(()=>lastTestSources(peer,first.id),{status:403});
  assert.equal((await execute(peer,first.id,'clean-public')).output,'3권');
  assert.equal(lastTestSources(owner,first.id)?.runId,testRun.id);
});

test('실행 번호와 읽은 자료판은 본인의 프로젝트 기록에 고정되고 자료 철회 후에는 판도 가린다',async()=>{
  const author=member('history-source-author'), reader=member('history-source-reader');
  const asset=writeAsset(author,{kind:'document',name:'수령 규정',payload:{content:'회원증이 필요합니다.'}});
  const graph=graphFor(asset.id);
  graph.nodes[1].title='수령 규정';
  const project=createProject(author,{title:'수령 안내',graph});
  const id=project.id;
  function release(version:number, revision:number|undefined) {
    assert.ok(revision);
    assetShare(author,asset.id,'public',false,version);
    const edition=snapshot(author,{id,revision});
    publish(author,{id,visibility:'public',version:edition.number});
  }
  release(1,project.revision);
  const first=await execute(reader,id,'first-edition');
  await execute(author,id,'author-run');
  const cancelled=startRun(reader,{id,input:'대출 규정',mode:'live',requestKey:'cancelled'});
  stopRun(reader,cancelled.id);
  writeAsset(author,{id:asset.id,baseVersion:1,name:'수령 규정',payload:{content:'등록된 학생증도 가능합니다.'}});
  graph.nodes[1].config.version=2;
  const saved=saveProject(author,{id,revision:project.revision,title:project.title,graph});
  release(2,saved.revision);
  const last=await execute(reader,id,'second-edition');
  assert.deepEqual(runList(reader,id).map(run=>[run.runNumber,run.output,run.usedEditions]),[
    [3,'등록된 학생증도 가능합니다.',[{title:'수령 규정',version:2}]],
    [2,'',[]],
    [1,'회원증이 필요합니다.',[{title:'수령 규정',version:1}]],
  ]);
  assert.equal(runGet(reader,first.id).runNumber,1);
  assert.deepEqual(runGet(reader,last.id).usedEditions,[{title:'수령 규정',version:2}]);
  assert.deepEqual(runList(author,id).map(run=>run.runNumber),[1]);
  const fixture=await execute(author,id,'substitution',{mode:'test',caseFixture:{documents:{rules:'별도 지점 안내'}}});
  assert.deepEqual(fixture.usedEditions,[]);
  assetShare(author,asset.id,'private',false);
  assert.ok(runList(reader,id).every(run=>!run.input&&!run.output&&!run.usedEditions.length));
  assert.deepEqual(runGet(reader,first.id).usedEditions,[]);
});

test('revoked dependency or retired link-only project edition cannot resume and stays recoverable for the owner',async()=>{
  const owner=member('revocation-owner'),peer=member('revocation-peer');
  const doc=writeAsset(owner,{kind:'document',name:'지점용 안내',payload:{content:'3권'}});
  assetShare(owner,doc.id,'link',false,1);
  const draft=createProject(owner,{title:'지점 문의',graph:graphFor(doc.id,1,true)});
  const v1=snapshot(owner,{id:draft.id,revision:draft.revision});
  const link=publish(owner,{id:draft.id,version:v1.number,visibility:'link'});
  const publicGraph=openProject(peer,draft.id,link.token).graph!;
  assert.equal(publicGraph.nodes.find(n=>n.id==='rules')!.config.assetGrant,undefined);
  const waiting=await execute(peer,draft.id,'wait',{token:link.token});assert.equal(waiting.state,'waiting');
  // Restore a historical trace shape that once included the full callable workflow.
  const checkpoint=JSON.parse(one<{checkpoint:string}>('SELECT checkpoint FROM runs WHERE id=?',waiting.id)!.checkpoint);
  checkpoint.events.push({data:{workflow:{graph:{nodes:[{config:{assetId:doc.id,assetGrant:'historical-test-grant',workflowGrant:'historical-test-grant'}}]}}}});
  set('UPDATE runs SET checkpoint=? WHERE id=?',JSON.stringify(checkpoint),waiting.id);
  assert.ok(!JSON.stringify(runGet(peer,waiting.id).events).includes('historical-test-grant'));
  assetShare(owner,doc.id,'link',true,1);
  const hiddenByDocument=runGet(peer,waiting.id);
  assert.equal('projectAccessRevoked' in hiddenByDocument,false);
  assert.equal(hiddenByDocument.input,'');
  assert.equal(hiddenByDocument.output,'');
  assert.equal(hiddenByDocument.prompt,null);
  assert.deepEqual(hiddenByDocument.events,[]);
  assert.deepEqual(hiddenByDocument.operations,[]);
  assert.throws(()=>replyRun(peer,{runId:waiting.id,waitId:waiting.prompt.id,value:'예'}),/권한/);
  assert.throws(()=>openProject(peer,draft.id,link.token),/권한/);
  assert.throws(()=>publish(owner,{id:draft.id,version:v1.number,visibility:'link'}),/참조/);
  assert.equal(openProject(owner,draft.id).graph?.nodes.length,4);
  revoke(owner,draft.id);
  assert.deepEqual(runGet(peer,waiting.id),{...hiddenByDocument,projectAccessRevoked:true});
  const updated=saveProject(owner,{id:draft.id,revision:draft.revision,title:'공개판',graph:graphFor(doc.id)});
  assetShare(owner,doc.id,'public',false,1);
  const v2=snapshot(owner,{id:draft.id,revision:updated.revision});publish(owner,{id:draft.id,version:v2.number,visibility:'public'});
  assert.throws(()=>replyRun(peer,{runId:waiting.id,waitId:waiting.prompt.id,value:'예'}),/권한/);
});

test('같은 판을 재공유해도 새 링크에서는 새 대화만 실행한다',async()=>{
  const owner=member('share-epoch-owner'), reader=member('share-epoch-reader');
  const doc=writeAsset(owner,{kind:'document',name:'대화 확인',payload:{content:'응답'}});
  assetShare(owner,doc.id,'public',false,1);
  const p=createProject(owner,{title:'재공유 대화',graph:graphFor(doc.id,1,true)});
  const version=snapshot(owner,{id:p.id,revision:p.revision}).number;
  const firstLink=publish(owner,{id:p.id,version,visibility:'link'});
  const firstView=openProject(reader,p.id,firstLink.token).shareGeneration;
  const oldRequest={id:p.id,mode:'live',input:'첫 질문',requestKey:'old-request',shareGeneration:firstView};
  const waiting=startRun(reader,oldRequest); // From the gallery, using the account's grant.
  assert.equal(await workOne(),true);
  const prompt=runGet(reader,waiting.id).prompt;
  const stopped=stopRun(reader,startRun(reader,{...oldRequest,requestKey:'old-stopped',token:firstLink.token}).id);
  revoke(owner,p.id);
  const link=publish(owner,{id:p.id,version,visibility:'link'});
  const nextView=openProject(reader,p.id,link.token).shareGeneration;
  assert.notEqual(firstView,nextView);
  const freshArgs={id:p.id,mode:'live',input:'새 질문',requestKey:'fresh',shareGeneration:nextView};
  assert.throws(()=>startRun(reader,{...freshArgs,shareGeneration:firstView}),{status:403});
  assert.throws(()=>startRun(reader,{...oldRequest,shareGeneration:nextView}),{status:403});
  assert.throws(()=>inputFiles(reader,{...freshArgs,conversation:waiting.conversation}),{status:403});
  assert.throws(()=>startRun(reader,{...freshArgs,conversation:waiting.conversation}),{status:403});
  assert.throws(()=>replyRun(reader,{runId:waiting.id,waitId:prompt.id,value:'예',shareGeneration:nextView}),{status:403});
  assert.throws(()=>startRun(reader,{...freshArgs,input:stopped.input,retryOf:stopped.id}),{status:403});
  const fresh=startRun(reader,freshArgs);
  assert.notEqual(fresh.conversation,waiting.conversation);
  assert.equal(startRun(reader,freshArgs).id,fresh.id);
  assert.equal(await workOne(),true);
  replyRun(reader,{runId:fresh.id,waitId:runGet(reader,fresh.id).prompt.id,value:'새 응답'});
  assert.equal(await workOne(),true);
  assert.equal(runGet(reader,fresh.id).state,'completed');
  const records=runList(reader,p.id,undefined,{shareGeneration:nextView});
  assert.equal(records.length,3);
  assert.equal(records.filter(r=>'projectAccessRevoked' in r).length,2);
  for(const record of records.filter(r=>r.id!==fresh.id)){
    assert.equal(record.input,'');assert.equal(record.output,'');assert.equal(record.prompt,null);
  }
  assert.throws(()=>runList(reader,p.id,undefined,{shareGeneration:firstView}),{status:403});
  assert.throws(()=>runGet(reader,fresh.id,{shareGeneration:firstView}),{status:403});
});

test('기존 토큰 없는 대화는 업그레이드에서 확인 가능한 공유 세대로 한 번만 고정한다',()=>{
  const owner=member('legacy-epoch-owner'),reader=member('legacy-epoch-reader');
  const make=(visibility:'link'|'public')=>{
    const p=createProject(owner,{lesson:'intro'});
    const version=snapshot(owner,{id:p.id,revision:p.revision}).number;
    const shared=publish(owner,{id:p.id,version,visibility});
    openProject(reader,p.id,shared.token);
    return p;
  };
  const secret=make('link'),publicAgent=make('public');
  function legacy(p:{id:string},created:string){
    const run=startRun(reader,{id:p.id,mode:'live',input:'이전 대화',requestKey:crypto.randomUUID()});
    stopRun(reader,run.id);
    set('UPDATE conversations SET link_token=NULL,created=? WHERE id=?',created,run.conversation);
    return run;
  }
  const older='2020-01-01T00:00:00.000Z',changed='2020-01-02T00:00:00.000Z',newer='2020-01-03T00:00:00.000Z';
  const unknown=legacy(secret,older),confirmed=legacy(secret,newer),publicRun=legacy(publicAgent,older);
  set('UPDATE projects SET updated=? WHERE id IN (?,?)',changed,secret.id,publicAgent.id);
  db().exec('PRAGMA user_version=0');
  // Run the same database initializer used by an upgraded process on a pre-existing file.
  execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',
    'import {db} from "./src/server/db.ts"; db().close();']);
  assert.equal(one<{user_version:number}>('PRAGMA user_version')!.user_version,2);
  assert.equal(runGet(reader,unknown.id).input,'');
  assert.equal(runGet(reader,confirmed.id).input,'이전 대화');
  const publicV2=snapshot(owner,{id:publicAgent.id,revision:publicAgent.revision}).number;
  publish(owner,{id:publicAgent.id,version:publicV2,visibility:'public'});
  assert.equal(runGet(reader,publicRun.id).input,'이전 대화');
  revoke(owner,secret.id);
  const next=publish(owner,{id:secret.id,version:1,visibility:'link'});
  openProject(reader,secret.id,next.token);
  for(const run of [unknown,confirmed]){
    assert.throws(()=>inputFiles(reader,{id:secret.id,conversation:run.conversation}),{status:403});
  }
});

test('copied Skill and MCP metadata omit operator credentials and hidden test endpoints; binding types are checked',()=>{
  const operator=member('asset-operator'),peer=member('connector-peer');
  process.env.STUDIO_ADMIN_IDS=operator.id;
  const mcp=writeAsset(operator,{name:'연결',kind:'mcp',payload:{url:'https://example.test/library',testUrl:'https://example.test/sandbox',tools:['lookup'],readOnlyTools:['lookup'],credentialEnv:'STUDIO_CONNECTOR_LIBRARY'}});
  assetShare(operator,mcp.id,'public',false,1);
  const catalog=readLibraryAsset(operator,mcp.id,1,undefined,true);
  assert.equal(catalog.payload.credentialEnv,undefined);assert.equal(catalog.payload.testUrl,undefined);
  const ownCatalogCopy=copyAsset(operator,mcp.id,1,undefined,undefined,true);
  assert.equal(readAsset(operator,ownCatalogCopy.id).payload.testUrl,undefined);
  assert.equal(readLibraryAsset(operator,mcp.id).payload.testUrl,'https://example.test/sandbox');
  assert.throws(()=>writeAsset(peer,{name:'내 연결',kind:'mcp',payload:{url:'https://example.test/peer',tools:['anything']}}),/운영자/);
  const copy=copyAsset(peer,mcp.id);const payload=readAsset(peer,copy.id).payload;
  assert.equal(payload.credentialEnv,undefined);assert.equal(payload.testUrl,undefined);assert.deepEqual(payload.tools,['lookup']);
  assert.throws(()=>writeAsset(peer,{id:copy.id,name:'변경',baseVersion:1,payload:{url:'https://example.test/other',tools:['lookup'],credentialEnv:'STUDIO_CONNECTOR_LIBRARY'}}),/운영자/);
  const badRef=createBlock('resource.context',{config:{assetId:mcp.id,version:1}});
  assert.throws(()=>pins({nodes:[createBlock('agent.team',{graph:{nodes:[badRef],edges:[]}})],edges:[]},operator),/유형/);
  const skill=writeAsset(operator,{name:'근거 쓰기',kind:'skill',payload:{content:'# 출처를 적으세요'}});
  assetShare(operator,skill.id,'public',false,1);
  const copied=copyAsset(peer,skill.id,1);
  writeAsset(peer,{id:copied.id,baseVersion:1,name:'내 지침',payload:{content:'# 제목과 위치 쓰기'}});
  assert.equal(readAsset(operator,skill.id,1).payload.content,'# 출처를 적으세요');
});

test('MCP edition is scoped to each call, inherited by a delegate, bound to approval and preserved on copy',async t=>{
  const calls:string[]=[];
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk as Buffer);
    const rpc=JSON.parse(Buffer.concat(chunks).toString());
    if(rpc.method==='tools/call')calls.push(req.url!);
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:rpc.id,jsonrpc:'2.0',
      result:rpc.method==='initialize'?{protocolVersion:'2025-03-26'}:{structuredContent:req.url}}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  const operator=member('scope-operator'),peer=member('scope-reader'),guest=legacyGuestSession().user;
  process.env.STUDIO_ADMIN_IDS=operator.id;
  const mcp=writeAsset(operator,{name:'지점 연결 1판',kind:'mcp',payload:{tools:['check'],readOnlyTools:['check'],url:base+'/live1',testUrl:base+'/test1'}});
  assetShare(operator,mcp.id,'public',false,1);
  writeAsset(operator,{id:mcp.id,baseVersion:1,name:'지점 연결 2판',payload:{tools:['check'],url:base+'/live2',testUrl:base+'/test2'}});
  assetShare(operator,mcp.id,'public',false,2);
  const tool='mcp.'+mcp.id+'.check';
  const wire=(from:string,to:string,kind:Graph['edges'][number]['kind'],out:string,input:string)=>({id:[from,to,kind].join('-'),from,to,kind,out,input});
  function sequence(steps:Graph['nodes']):Graph{
    const nodes=[createBlock('input.user_request',{id:'begin'}),...steps,createBlock('output.answer',{id:'end'})];
    return {nodes,edges:nodes.slice(1).flatMap((n,i)=>[wire(nodes[i].id,n.id,'flow','next','in'),wire(nodes[i].id,n.id,'data','value','input')])};
  }
  const nested=sequence([createBlock('tool.invoke',{id:'update',config:{tool}})]);
  const graph=sequence([createBlock('tool.invoke',{id:'lookup',config:{tool}}),createBlock('agent.delegate',{id:'role',config:{role:'담당자',instruction:'예약 상태를 갱신하세요.'},graph:nested})]);
  const source=(id:string,version:number)=>createBlock('connection.mcp',{id,config:{assetId:mcp.id,version}});
  graph.nodes.push(source('two',2),source('one',1));
  graph.edges.push(wire('one','lookup','reference','ref','mcp'),wire('two','role','reference','ref','mcp'));
  const project=createProject(operator,{title:'서로 다른 연결판',graph});
  const v=snapshot(operator,{id:project.id,revision:project.revision});publish(operator,{id:project.id,version:v.number,visibility:'public'});
  const first=await execute(guest,project.id,'guest-editions');
  assert.equal(first.state,'waiting',first.error);assert.equal(first.prompt.operation.connector.version,2);
  assert.deepEqual(calls,['/test1']);
  replyRun(guest,{runId:first.id,waitId:first.prompt.id,approved:true});await workOne();
  assert.equal(runGet(guest,first.id).output,'/test2');assert.deepEqual(calls,['/test1','/test2']);
  const independent=projectCopy(peer,{id:project.id});
  const copyGraph=independent.graph!,one=copyGraph.nodes.find(n=>n.id==='one')!,two=copyGraph.nodes.find(n=>n.id==='two')!;
  assert.notEqual(one.config.assetId,mcp.id);assert.equal(one.config.assetId,two.config.assetId);
  assert.equal(readAsset(peer,one.config.assetId,one.config.version).payload.url,base+'/live1');
  assert.equal(readAsset(peer,two.config.assetId,two.config.version).payload.url,base+'/live2');
  assert.equal(readAsset(peer,two.config.assetId,two.config.version).payload.testUrl,undefined);
  assert.equal(copyGraph.nodes.find(n=>n.id==='lookup')!.config.tool,'mcp.'+one.config.assetId+'.check');
  assert.equal(copyGraph.nodes.find(n=>n.id==='role')!.graph!.nodes.find(n=>n.id==='update')!.config.tool,'mcp.'+one.config.assetId+'.check');
  const mismatched=structuredClone(graph),child=mismatched.nodes.find(n=>n.id==='role')!.graph!;
  child.nodes.push(source('unavailable',1));child.edges.push(wire('unavailable','update','reference','ref','mcp'));
  const broken=createProject(operator,{title:'상위 권한과 다른 연결판',graph:mismatched});
  assert.throws(()=>startRun(operator,{id:broken.id,mode:'test',input:'시험',requestKey:'mismatch-editions'}),/MCP 연결 버전/);
  const restricted=structuredClone(graph);restricted.nodes.find(n=>n.id==='role')!.config.allowedTools=[];
  const limited=createProject(operator,{title:'조회 전용 담당자',graph:restricted});
  assert.throws(()=>startRun(operator,{id:limited.id,mode:'test',input:'시험',requestKey:'restricted-role'}),/상위 역할/);
  const missing=structuredClone(graph);missing.edges=missing.edges.filter(e=>!(e.from==='one'&&e.to==='lookup'));
  const orphan=createProject(operator,{title:'연결 누락',graph:missing});
  assert.throws(()=>startRun(operator,{id:orphan.id,mode:'test',input:'시험',requestKey:'missing-editions'}),/MCP 연결 버전/);
  assert.deepEqual(calls,['/test1','/test2']);
});
