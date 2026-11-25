import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after,test} from 'node:test';
import {strToU8,zipSync} from 'fflate';
import {assetList,assetShare,copyAsset,documentPreviews,grant,pins,readAsset,skillFiles,writeAsset} from '../src/server/assets';
import { authenticate } from '../src/server/auth';
import {db} from '../src/server/db';
import {createBlock} from '../src/domain';

const scratch=mkdtempSync(join(tmpdir(),'studio-asset-tests-'));
process.env.STUDIO_DATA_DIR=scratch;
after(()=>{db().close();rmSync(scratch,{recursive:true,force:true});});
function user(login:string){
  return authenticate('signup',login,'test-pass-resource-924','').user;
}
test('Skill upload preserves relative paths, scripts, and binary assets without evaluation',()=>{
  const zipped=Buffer.from(zipSync({'folder/SKILL.md':strToU8('# 지침'),'folder/scripts/example.ts':strToU8('const value=42;'),'folder/assets/pixel.bin':Uint8Array.from([0,255,1])})).toString('base64');
  const bundle=skillFiles([],zipped);
  assert.deepEqual(bundle.map(f=>f.path),['SKILL.md','scripts/example.ts','assets/pixel.bin']);
  assert.deepEqual(Buffer.from(bundle[2].data,'base64'),Buffer.from([0,255,1]));
  assert.throws(()=>skillFiles([{path:'../SKILL.md',data:'QQ=='}]),/경로/);
  assert.throws(()=>skillFiles([{path:'SKILL.md',data:'QQ=='},{path:'SKILL.md',data:'QQ=='}]),/중복/);
  assert.throws(()=>skillFiles([{path:'scripts/example.ts',data:'QQ=='}]),/SKILL.md/);
});

test('only shared versions can be opened, and revocation invalidates a previous visitor grant',()=>{
  const owner=user('asset-owner-a'),peer=user('asset-user-a');
  const item=writeAsset(owner,{kind:'document',name:'도서관 대출',payload:{content:'대출은 3권'}});
  assert.throws(()=>readAsset(peer,item.id),/권한/);
  const pub=assetShare(owner,item.id,'link',false);
  assert.equal(readAsset(peer,item.id,1,pub.token).payload.content,'대출은 3권');
  grant(peer,'asset',item.id,pub.token!);
  writeAsset(owner,{id:item.id,baseVersion:1,name:'도서관 대출',payload:{content:'대출은 5권'}});
  assert.equal(readAsset(peer,item.id).version,1);
  assert.throws(()=>readAsset(peer,item.id,2),/공유/);
  const independent=copyAsset(peer,item.id,1);
  assetShare(owner,item.id,'link',true);
  assert.throws(()=>readAsset(peer,item.id,1,pub.token),/권한/);
  assert.ok(!assetList(peer).some(a=>a.id===item.id));
  assert.equal(readAsset(peer,independent.id).payload.content,'대출은 3권');
});

test('private and required-script dependencies block publication; published references pin a version',()=>{
  const owner=user('asset-owner-b');
  const source=writeAsset(owner,{kind:'document',name:'내 규정',payload:{content:'자료'}});
  const g={nodes:[createBlock('resource.context',{config:{assetId:source.id}})],edges:[]};
  assert.throws(()=>pins(g,owner,'public'),/공개/);
  assetShare(owner,source.id,'public',false);
  assert.equal(Number(pins(g,owner,'public').nodes[0].config.version),1);
  const skill=writeAsset(owner,{kind:'skill',name:'변환',payload:{content:'# 변환',requiresScripts:true}});
  assert.throws(()=>pins({nodes:[createBlock('instruction.skill',{config:{assetId:skill.id}})],edges:[]},owner),/스크립트/);
});

test('an old link rotation leaves the current published edition and visibility intact',()=>{
  const owner=user('share-revision-owner');
  const item=writeAsset(owner,{kind:'document',name:'규정',payload:{content:'3권'}});
  const first=assetShare(owner,item.id,'link',false,1);
  writeAsset(owner,{id:item.id,baseVersion:1,name:'규정',payload:{content:'5권'}});
  const second=assetShare(owner,item.id,'link',false,2);
  assert.throws(()=>assetShare(owner,item.id,'link',true,1,first.revision),{status:409});
  assert.equal(assetList(owner).find(asset=>asset.id===item.id)?.publicVersion,2);
  const rotated=assetShare(owner,item.id,'link',true,undefined,second.revision);
  assert.equal(rotated.publicVersion,2);
  assert.deepEqual(rotated.releasedVersions,[2,1]);
  assert.notEqual(rotated.token,second.token);
  assetShare(owner,item.id,'private',false);
  assert.throws(()=>assetShare(owner,item.id,'link',true,2,rotated.revision),{status:409});
  assert.equal(assetList(owner).find(asset=>asset.id===item.id)?.visibility,'private');
});

test('a replay recovers the same private copy of either an edition or a conflicted draft',()=>{
  const owner=user('retry-copy-owner');
  const original=writeAsset(owner,{kind:'document',name:'규정',payload:{content:'3권'}});
  const draft={kind:'document',name:'규정 사본',payload:{content:'7권'},requestKey:'retry-draft-copy'};
  const saved=writeAsset(owner,draft);
  assert.equal(writeAsset(owner,draft).id,saved.id);
  writeAsset(owner,{id:saved.id,baseVersion:1,name:'새 규정',payload:{content:'9권'}});
  const receipt=writeAsset(owner,draft);
  assert.equal(receipt.version,1);
  assert.equal(receipt.name,draft.name);
  assert.equal(readAsset(owner,receipt.id,receipt.version).payload.content,'7권');
  assert.throws(()=>writeAsset(owner,{...draft,payload:{content:'9권'}}),{status:409});
  const copy=copyAsset(owner,original.id,1,undefined,'retry-edition-copy');
  assert.equal(copyAsset(owner,original.id,1,undefined,'retry-edition-copy').id,copy.id);
  assert.equal(assetList(owner).filter(item=>item.mine).length,3);
});

test('retrying an edition save returns that edition even after another edit',()=>{
  const owner=user('retry-edition-owner');
  const original=writeAsset(owner,{kind:'document',name:'규정',payload:{content:'3권'}});
  const edit={id:original.id,baseVersion:1,name:'둘째 판 규정',payload:{content:'5권'},requestKey:'retry-existing-edition'};
  assert.equal(writeAsset(owner,edit).version,2);
  writeAsset(owner,{...edit,baseVersion:2,name:'셋째 판 규정',payload:{content:'7권'},requestKey:'different-edition'});
  const replay=writeAsset(owner,edit);
  assert.equal(replay.version,2);
  assert.equal(replay.name,edit.name);
  assert.equal(readAsset(owner,original.id).version,3);
  assert.throws(()=>writeAsset(owner,{...edit,requestKey:'stale-save'}),{status:409});
  assert.throws(()=>writeAsset(owner,{...edit,baseVersion:3}),{status:409});
});

test('canvas excerpts show only the requested readable document edition',()=>{
  const owner=user('preview-owner'),peer=user('preview-reader');
  const source=writeAsset(owner,{kind:'document',name:'이용규정',payload:{content:'대출 한도는 3권입니다. 다음 문장입니다.'}});
  const shared=assetShare(owner,source.id,'link',false);
  writeAsset(owner,{id:source.id,baseVersion:1,name:'이용규정',payload:{content:'대출 한도는 5권입니다.'}});
  const first={id:source.id,version:1,token:shared.token};
  const second={...first,version:2};
  const skill=writeAsset(owner,{kind:'skill',name:'지침',payload:{content:'내부 지침'}});
  assert.deepEqual(documentPreviews(owner,[first,second,{id:skill.id}]),['대출 한도는 3권입니다.','대출 한도는 5권입니다.','']);
  assert.deepEqual(documentPreviews(peer,[first,second,{id:'missing'}]),['대출 한도는 3권입니다.','','']);
  assetShare(owner,source.id,'link',true);
  assert.deepEqual(documentPreviews(peer,[first]),['']);
});
