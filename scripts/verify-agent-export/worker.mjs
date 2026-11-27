/** Run through Studio's SQLite queue. Only the provider response is a fixture. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,posix,resolve} from 'node:path';
import {unzipSync,strFromU8,zipSync} from 'fflate';
import {catalog,connectBlocks,createBlock,palette,templates,validateGraph} from '../../src/domain/index.ts';
import {activeExportPreparation} from '../../src/domain/agent-export.ts';
import {authenticate} from '../../src/server/auth.ts';
import {createLibraryLookupConnection} from '../../src/server/assets.ts';
import {db,one} from '../../src/server/db.ts';
import {createProject} from '../../src/server/projects.ts';
import {startRun,replyRun,runGet,workOne} from '../../src/server/runs.ts';
import {prepareAgentExport,previewAgentExport} from '../../src/server/agent-export.ts';
import {buildAgentZip} from '../../src/server/agent-zip.ts';
import {prepareAgentSkills} from '../../src/server/agent-skill-export.ts';
import {workerCases} from './worker-cases.mjs';
import {sourceFingerprint} from './source.mjs';

const originalFetch=globalThis.fetch;
const dataDir=mkdtempSync(join(tmpdir(),'studio-export-acceptance-'));
const outputDir=resolve('artifacts/agent-zip-audit');
const writeOutput=process.argv.includes('--write');
const source=sourceFingerprint();
const archived={}, checks=[], observed=new Map();
let workerEntries=0, replies=0, downloads=0, links=0, preparations=0, modelCalls=0;
let library, libraryExit, usedWorkflowTool=false;

function provider(body){
  modelCalls++;
  const workflowTool=body.tools?.find(tool=>tool.name.startsWith('workflow_review_'));
  if(workflowTool&&!usedWorkflowTool){
    usedWorkflowTool=true;
    return [{type:'function_call',name:workflowTool.name,arguments:'{"q":1}'}];
  }
  const instruction=body.instructions;
  let value='확인됨';
  if(instruction.includes('업무 범위 판정:'))value={status:'in_scope'};
  else if(instruction.includes('완료 판정:'))value={status:'met',reason:'완료'};
  else if(instruction.includes('분류할 수 없으면'))value={category:'일정'};
  else if(instruction.includes('choices'))value={choices:['B','A']};
  else if(instruction.includes('references')&&instruction.includes('conflicting'))
    value={status:'verified',reason:'같은 행',references:[{index:0,quote:'연장 2회'}]};
  else if(instruction.includes('자 안으로 요약'))value='점수 72';
  else if(instruction.includes('score'))value={score:72,reason:'추가 확인'};
  return [{type:'message',content:[{type:'output_text',text:typeof value==='string'?value:JSON.stringify(value)}]}];
}

// The same author design can cross the 16 KiB layout boundary using a longer edge caption.
function expanded(graph){
  const copy=structuredClone(graph);
  copy.edges[0].label='설계 검토용 연결 설명 '.repeat(820);
  return copy;
}
function allNodes(graph){
  return graph.nodes.flatMap(node=>[node,...(node.graph?allNodes(node.graph):[])]);
}
function draftFor(type,connector){
  const config={
    'resource.context':{content:'공통 원문'},'instruction.skill':{content:'공통 지침'},
    'connection.mcp':{assetId:connector.id,version:connector.version,server:connector.name},
    'file.input':{fileName:'시험.csv',content:'A,B'},
    'agent.delegate':{role:'검토자',instruction:'자료 검토'},'agent.handoff':{role:'편집자',instruction:'편집'},
    'agent.create_dynamic':{role:'조사자',instruction:'대상별 조사'},
  };
  const nodes=[createBlock('input.user_request',{id:'start'}),createBlock(type,{id:'focus',config:config[type]}),createBlock('output.answer',{id:'end'})];
  const graph={nodes,edges:[]};
  for(const [from,to] of [['start','focus'],['focus','end']])graph.edges.push(...connectBlocks(graph,from,to));
  return graph;
}
function checkPackage(author,project,graph,selection){
  const request={id:project.id,title:project.title,graph};
  const preview=previewAgentExport(author,request);
  const selected=preview.resources.filter(r=>r.available&&(selection==='all'||selection==='default'&&r.kind!=='mcp')).map(r=>r.key);
  const pkg=prepareAgentExport(author,{...request,selected,previewId:preview.previewId});
  const bytes=buildAgentZip(pkg);
  const files=unzipSync(bytes);
  const read=path=>strFromU8(files[path]);
  for(const path of Object.keys(files)){
    assert.ok(!path.includes('\\') && !path.startsWith('/') && !path.split('/').includes('..'),path);
    assert.ok(!path.startsWith('runtime/'),path);
  }
  assert.equal(read('CLAUDE.md'),'@AGENTS.md\n');
  const split=Object.hasOwn(files,'workflow/index.md');
  const bodies=Object.keys(files).filter(path=>split?/^workflow\/step-\d+\.md$/.test(path):path==='AGENTS.md')
    .flatMap(path=>read(path).split('\n'));
  for(const node of allNodes(pkg.graph)){
    if(node.type==='connection.mcp'&&!pkg.resources.some(r=>r.key===node.config.exportResource&&r.included))continue;
    assert.ok(bodies.includes(catalog.find(def=>def.type===node.type).name+' · '+node.id),node.id);
  }
  for(const file of prepareAgentSkills(pkg).files){
    assert.ok(Object.hasOwn(files,file.path),file.path);
    assert.deepEqual(Buffer.from(files[file.path]),Buffer.from(file.data,'base64'),file.path);
  }
  for(const path of Object.keys(files).filter(path=>/^(AGENTS\.md|README\.md|workflow\/.*\.md|agents\/.*\.md)$/.test(path))){
    for(const [,href] of read(path).matchAll(/\]\(([^)\s]+)\)/g)){
      if(/^[a-z][a-z0-9+.-]*:/i.test(href))continue;
      const [relative,anchor]=href.split('#'),target=relative?posix.normalize(posix.join(posix.dirname(path),relative)):path;
      assert.ok(Object.hasOwn(files,target),path+' → '+href);
      if(anchor)assert.ok(read(target).includes('id="'+anchor+'"'),path+' → '+href);
      links++;
    }
    if(path.startsWith('agents/')){
      const id=posix.basename(path,'.md');
      for(const [dir,ext] of [['.claude','md'],['.opencode','md'],['.codex','toml']])
        assert.ok(read(dir+'/agents/'+id+'.'+ext).includes(path),path);
    }
  }
  const ready=activeExportPreparation(preview.preparation,selected);
  const readme=read('README.md');
  const markdownText=text=>text.replace(/[\r\n]+/g,' ').trim().replace(/[\\`*_\[\]<>]/g,'\\$&');
  for(const note of ready){
    const id=note.stepPath?.length?'prep-'+note.stepPath.join('-'):'prep-workflow';
    const section=readme.split('<a id="'+id+'"></a>')[1]?.split(/<a id=|\n## /)[0];
    assert.ok(section?.includes('- '+markdownText(note.action)+' '+markdownText(note.reason)),note.step);
  }
  preparations+=ready.length;
  downloads++;
  return {bytes,split};
}

try{
  process.env.STUDIO_DATA_DIR=dataDir;
  process.env.OPENAI_API_KEY='local-acceptance-fixture';
  process.env.OPENAI_MODEL='local-acceptance-fixture';
  process.env.STUDIO_MCP_TOKEN=randomUUID();
  const socket=createServer();
  socket.listen(0,'127.0.0.1');
  await once(socket,'listening');
  process.env.STUDIO_MCP_PORT=String(socket.address().port);
  await new Promise(resolve=>socket.close(resolve));
  const localMcp='http://127.0.0.1:'+process.env.STUDIO_MCP_PORT+'/mcp';
  library=spawn(process.execPath,['--import','tsx','src/mcp/server.ts'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  libraryExit=once(library,'exit');
  await Promise.race([once(library.stdout,'data'),libraryExit.then(()=>{throw Error('도서관 시험 서비스 시작 실패');})]);
  globalThis.fetch=async (url,init)=>{
    if(String(url)===localMcp)return originalFetch(url,init);
    assert.equal(String(url),'https://api.openai.com/v1/responses','Unexpected network request');
    return Response.json({output:provider(JSON.parse(init.body))});
  };
  assert.equal(db().location(),join(dataDir,'studio.sqlite'));
  const author=authenticate('signup','audit-user','local-acceptance-only','').user;
  const connector=createLibraryLookupConnection(author,'시험 도서관');
  for(const fixture of workerCases(connector)){
    const project=createProject(author,{graph:fixture.graph,title:fixture.title});
    for(const [layout,graph] of [['compact',fixture.graph],['expanded',expanded(fixture.graph)]]){
      assert.deepEqual(validateGraph(graph),[],fixture.id);
      const saved=layout==='compact'?project:createProject(author,{graph,title:fixture.title+' 단계별'});
      const exported=checkPackage(author,saved,graph,'all');
      if(layout==='expanded')assert.equal(exported.split,true,fixture.id);
      if(layout==='compact')archived[fixture.id+'.zip']=exported.bytes;
      usedWorkflowTool=false;
      const queued=startRun(author,{id:saved.id,mode:'test',input:fixture.input,requestKey:randomUUID()});
      let result;
      for(let attempt=0;attempt<10;attempt++){
        assert.equal(await workOne(),true,fixture.id);
        workerEntries++;
        result=runGet(author,queued.id);
        if(result.state!=='waiting')break;
        const {kind,id}=result.prompt;
        const value=kind==='question'?'{"city":"서울"}':kind==='review'?'좋습니다':'yes';
        replyRun(author,{runId:queued.id,waitId:id,value,approved:true});
        replies++;
      }
      assert.equal(result.state,'completed',fixture.id+' ('+layout+'): '+result.error);
      const checkpoint=JSON.parse(one('SELECT checkpoint FROM runs WHERE id=?',queued.id).checkpoint);
      fixture.check({...result,checkpoint});
      for(const event of checkpoint.events)if(event.kind==='result'&&event.blockType){
        const cases=observed.get(event.blockType)??new Set();
        cases.add(fixture.id);
        observed.set(event.blockType,cases);
      }
      checks.push({case:fixture.id,layout:exported.split?'split':'inline',modelCalls:checkpoint.counts.modelCalls});
    }
  }
  assert.deepEqual(catalog.map(d=>d.type).filter(type=>!observed.has(type)),[]);
  const drafts=createProject(author,{title:'미완성 설계 내보내기 검증'});
  for(const definition of catalog){
    const graph=draftFor(definition.type,connector);
    checkPackage(author,drafts,graph,'all');
    const large=structuredClone(graph);
    large.agentScope={mode:'dedicated',purpose:'설계 자료 대조 '.repeat(1000)};
    assert.ok(checkPackage(author,drafts,large,'all').split,definition.type);
  }
  const splitLessons=new Map();
  for(const template of templates){
    const project=createProject(author,{lesson:template.id});
    for(const selection of ['all','default','none']){
      const exported=checkPackage(author,project,project.graph,selection);
      if(exported.split&&selection==='default')splitLessons.set(template.id,{title:template.title,bytes:exported.bytes});
    }
  }
  const lessonId=['sw-code-review','parallel','peer-review',...splitLessons.keys()].find(id=>splitLessons.has(id));
  assert.ok(lessonId,'기본 템플릿에서 실제 단계별 ZIP을 찾을 수 없습니다.');
  const lesson=splitLessons.get(lessonId);
  const blocks=palette.map(block=>({name:block.name,type:block.type,variants:catalog.filter(def=>def.menuType===block.type)
    .map(def=>({type:def.type,cases:[...observed.get(def.type)]}))}));
  assert.equal(sourceFingerprint(),source,'검증 중 제품 소스가 변경되었습니다. 새 작업본으로 재검증하세요.');
  const summary={source,palette:palette.length,types:observed.size,workerEntries,replies,modelCalls,downloads,links,preparations,checks,blocks,
    splitExample:{lesson:lessonId,title:lesson.title,file:'step-workflow.zip'}};
  if(writeOutput){
    mkdirSync(outputDir,{recursive:true});
    for(const [name,bytes] of Object.entries(archived))writeFileSync(join(outputDir,name),bytes);
    const bundle=zipSync(archived,{level:0});
    writeFileSync(join(outputDir,'verified-workflows.zip'),bundle);
    writeFileSync(join(outputDir,summary.splitExample.file),lesson.bytes);
    summary.files=Object.fromEntries(Object.entries({...archived,'verified-workflows.zip':bundle,[summary.splitExample.file]:lesson.bytes}).map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')]));
    writeFileSync(join(outputDir,'worker-results.json'),JSON.stringify(summary,null,2)+'\n');
  }
  console.log(JSON.stringify(summary));
}finally{
  globalThis.fetch=originalFetch;
  if(library&&library.exitCode===null){library.kill();await libraryExit;}
  try{db().close();}finally{rmSync(dataDir,{recursive:true,force:true,maxRetries:4,retryDelay:200});}
}
