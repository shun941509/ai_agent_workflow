/** Opt-in. Uses the production model adapter, the run worker and a disposable library MCP. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {createBlock,connectBlocks,type Graph} from '../src/domain';
import {port,provider,stop} from './library-provider';

const {studioEnvironment}=await import(new URL('../scripts/runtime-env.mjs',import.meta.url).href);
const settings=studioEnvironment(fileURLToPath(new URL('../',import.meta.url)));
assert.ok(settings.OPENAI_API_KEY&&settings.OPENAI_MODEL,'실제 모델 설정이 필요합니다.');
process.env.OPENAI_API_KEY=settings.OPENAI_API_KEY;
process.env.OPENAI_MODEL=settings.OPENAI_MODEL;
process.env.STUDIO_MCP_PORT=await port();
process.env.STUDIO_MCP_TOKEN=randomBytes(32).toString('hex');
const dataDir=mkdtempSync(join(tmpdir(),'studio-live-approval-'));
process.env.STUDIO_DATA_DIR=dataDir;
let service:Awaited<ReturnType<typeof provider>>|undefined;
let studioDb:DatabaseSync|undefined;
try{
  service=await provider();
  const database=await import('../src/server/db');
  studioDb=database.db();
  const {authenticate}=await import('../src/server/auth');
  const {createProject,snapshot,publish}=await import('../src/server/projects');
  const {startRun,workOne,runGet,replyRun}=await import('../src/server/runs');
  const user=authenticate('signup','live-booking',randomUUID(),'').user;
  const book='달빛 산책',branch='호수관';
  const agent=createBlock('agent.task',{id:'agent',config:{
    goal:'도서관 이용자의 예약 요청을 처리하세요.',
    instruction:'요청에 맞는 도구를 선택하세요. 책과 지점은 사용자가 보낸 이름 그대로 사용하세요. 성공 영수증이 있으면 그 결과로 답변을 마치세요.',
    criterion:'예약 결과의 도서명, 수령 지점, 예약 번호를 이용자에게 알려 주세요.',
    maxSteps:4,allowedTools:['reservations.list','reservations.cancel','reservations.create'],
  }});
  const graph:Graph={nodes:[createBlock('input.user_request',{id:'input'}),agent,createBlock('output.answer',{id:'out'})],edges:[]};
  graph.edges.push(...connectBlocks(graph,'input','agent'),...connectBlocks(graph,'agent','out'));
  const project=createProject(user,{graph,title:'예약 확인 시험'});
  const version=snapshot(user,{id:project.id,revision:project.revision});
  publish(user,{id:project.id,version:version.number,visibility:'private'});
  const db=new DatabaseSync(join(process.env.STUDIO_DATA_DIR,'library.sqlite'),{readOnly:true});
  try{
    const reservations=()=>db.prepare("SELECT book,branch,status,id FROM reservations WHERE owner=? AND scope='live'").all(user.id);
    const receiptCount=()=>db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE owner=? AND scope='live'").get(user.id)!.n;
    async function request(){
      const run=startRun(user,{id:project.id,mode:'live',input:'도서 «'+book+'» 한 권을 '+branch+'에서 받을 수 있게 예약해 주세요.',requestKey:randomUUID()});
      assert.equal(await workOne(),true);
      const waiting=runGet(user,run.id);
      assert.equal(waiting.state,'waiting',waiting.error||waiting.output);
      assert.equal(waiting.prompt?.kind,'approval');
      assert.equal(waiting.prompt.operation.tool,'reservations.create');
      assert.deepEqual(waiting.prompt.operation.args,{book,branch});
      assert.deepEqual(waiting.operations,[]);
      return {runId:run.id,waitId:waiting.prompt.id};
    }
    const approval=await request();
    assert.equal(reservations().length,0);
    assert.equal(receiptCount(),0);
    console.log('승인 전 · 실제 모델 선택 reservations.create · 도서와 수령 지점 일치 · 예약 0건');
    const yes={...approval,value:'',approved:true};
    replyRun(user,yes);
    replyRun(user,yes);
    assert.deepEqual((await Promise.all([workOne(),workOne()])).sort(),[false,true]);
    const done=runGet(user,approval.runId);
    assert.equal(done.state,'completed',done.error||done.prompt?.prompt);
    const rows=reservations();
    assert.equal(rows.length,1);
    assert.deepEqual([rows[0].book,rows[0].branch,rows[0].status],[book,branch,'confirmed']);
    assert.equal(receiptCount(),1);
    assert.equal(done.operations.length,1);
    assert.equal(done.operations[0].status,'confirmed');
    assert.equal(done.operations[0].result.reservationId,rows[0].id);
    assert.ok(done.output.includes(book)&&done.output.includes(branch),'최종 답변에 실제 예약 도서와 지점이 필요합니다.');
    assert.ok(done.output.includes(String(rows[0].id)),'최종 답변의 예약 번호가 실제 예약과 일치해야 합니다.');
    replyRun(user,yes);
    assert.equal(await workOne(),false);
    assert.equal(reservations().length,1);
    console.log('승인 후 · 중복 회신 및 워커 경합 · 예약 1건 · 영수증 1건 · 최종 답변 확인');

    const denial=await request();
    replyRun(user,{...denial,value:'',approved:false});
    assert.equal(await workOne(),true);
    const rejected=runGet(user,denial.runId);
    assert.equal(rejected.state,'failed');
    assert.match(rejected.error,/승인하지 않았/);
    assert.deepEqual(rejected.operations,[]);
    assert.equal(reservations().length,1);
    assert.equal(receiptCount(),1);
    console.log('거절 후 · 추가 예약 0건 · 추가 영수증 0건');
  }finally{db.close();}
}finally{
  if(service)await stop(service);
  studioDb?.close();
  const target=realpathSync(dataDir);
  assert.ok(dirname(target)===realpathSync(tmpdir())&&basename(target).startsWith('studio-live-approval-'));
  rmSync(target,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
