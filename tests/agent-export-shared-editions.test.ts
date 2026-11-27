import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, test} from 'node:test';
import {strFromU8, unzipSync} from 'fflate';
import {connectBlocks, createBlock, validateGraph, type Block, type Graph} from '../src/domain';
import {activeExportPreparation,type ExportResource} from '../src/domain/agent-export';
import {prepareAgentExport, previewAgentExport} from '../src/server/agent-export';
import {buildAgentZip} from '../src/server/agent-zip';
import {writeAsset} from '../src/server/assets';
import {authenticate} from '../src/server/auth';
import {db, set} from '../src/server/db';
import {createProject, snapshot} from '../src/server/projects';
import {resolveWorkflowRefs} from '../src/server/workflow-refs';
import {executeGraph} from '../src/engine';

const directory=mkdtempSync(join(tmpdir(),'studio-shared-editions-'));
process.env.STUDIO_DATA_DIR=directory;
assert.equal(db().location(),join(directory,'studio.sqlite'));
after(()=>{db().close();rmSync(directory,{recursive:true,force:true});});
const user=authenticate('signup','shared-editions-test','test-only-passphrase','').user;
const project=createProject(user,{title:'내보낼 설계'});

function chain(nodes:Block[]):Graph {
  const graph:Graph={nodes,edges:[]};
  for(let i=1;i<nodes.length;i++)graph.edges.push(...connectBlocks(graph,nodes[i-1].id,nodes[i].id));
  return graph;
}

function steps(count:number) {
  return chain([createBlock('input.user_request',{id:'entry'}),
    ...Array.from({length:count-2},(_,i)=>createBlock('data.transform',{id:'field-'+i,config:{operation:'text'}})),
    createBlock('output.answer',{id:'answer'})]);
}

function call(id:string,workflowId:string,version=1){
  return createBlock('workflow.call',{id,title:id,config:{workflowId,version}});
}

function archive(graph:Graph,include:boolean|((resource:ExportResource)=>boolean)=true) {
  const req={id:project.id,title:'내보낼 설계',graph};
  const preview=previewAgentExport(user,req);
  const selected=preview.resources.filter(r=>r.available&&(typeof include==='function'?include(r):include)).map(r=>r.key);
  const pkg=prepareAgentExport(user,{...req,selected,previewId:preview.previewId});
  const files=Object.fromEntries(Object.entries(unzipSync(buildAgentZip(pkg))).map(([k,v])=>[k,strFromU8(v)]));
  return {pkg,files,active:activeExportPreparation(preview.preparation,selected)};
}

test('A saved edition used twice has one body, two return sites and no duplicate node cost',()=>{
  const graph=steps(249);
  const child=createProject(user,{title:'공유 업무',graph});
  snapshot(user,{id:child.id,revision:child.revision});
  const parent=chain([createBlock('input.user_request',{id:'begin'}),call('first',child.id),call('second',child.id),
    createBlock('output.answer',{id:'end'})]);
  assert.deepEqual(validateGraph(graph),[]);
  assert.deepEqual(validateGraph(parent),[]);
  assert.throws(()=>resolveWorkflowRefs(parent,user,project.id,{expand:true}),{status:422});
  const {files,pkg,active}=archive(parent);
  assert.deepEqual(active,[]);
  const [first,second]=pkg.graph.nodes.slice(1,3);
  assert.equal(first.graph?.nodes.length,249);
  assert.equal(second.graph,undefined);
  assert.equal(first.config.exportSharedEdition,second.config.exportSharedEdition);
  const edition=first.config.exportSharedEdition+'.md';
  const pages=Object.entries(files).filter(([path])=>/^workflow\/step-\d+\.md$/.test(path));
  assert.equal(pages.length,253);
  assert.equal(Object.keys(files).filter(path=>path.startsWith('workflow/edition-')).length,1);
  assert.equal(pages.filter(([,text])=>text.includes(']('+edition+')')).length,2);
  for(const [,match] of files['workflow/'+edition].matchAll(/\]\((step-\d+\.md)\)/g))assert.ok(files['workflow/'+match]);
  const terminal=pages.find(([,body])=>body.includes('답변 전달 · answer'))![1];
  assert.match(terminal,/현재 호출 기록의 복귀 위치/);
  assert.doesNotMatch(terminal,/first|second/);
});

test('Over-budget and deeper-than-supported calls remain downloadable with exact preparation locations',()=>{
  const large=createProject(user,{title:'큰 저장판',graph:steps(497)});
  snapshot(user,{id:large.id,revision:large.revision});
  const parent=chain([createBlock('input.user_request',{id:'begin'}),call('초과 호출',large.id),
    createBlock('data.transform',{id:'another'}),createBlock('output.answer',{id:'end'})]);
  // A two-node inline root can also contain a chain of valid individual saved editions.
  let child=createProject(user,{title:'잎',graph:steps(2)});
  snapshot(user,{id:child.id,revision:child.revision});
  for(let i=0;i<7;i++){
    const g=chain([createBlock('input.user_request',{id:'start'}),call('depth-'+i,child.id),createBlock('output.answer',{id:'done'})]);
    child=createProject(user,{title:'저장판 '+i});
    set('INSERT INTO versions(project,number,title,graph,created) VALUES(?,?,?,?,?)',child.id,1,'저장판',JSON.stringify(g),new Date().toISOString());
  }
  for(const [graph,name] of [[parent,'초과 호출'],[chain([createBlock('input.user_request',{id:'start'}),call('깊은 설계',child.id),
    createBlock('output.answer',{id:'done'})]),'depth-0']] as const){
    const {files,active}=archive(graph);
    const limit=active.find(row=>row.reason.includes('깊이 또는 전체 블록 수'));
    assert.ok(limit && limit.step.endsWith(name),JSON.stringify(active));
    assert.match(files['README.md'],/하위 설계를 별도로 준비/);
    const anchor='prep-'+limit.stepPath!.join('-');
    assert.ok(files['README.md'].includes('id="'+anchor+'"'));
    assert.ok(Object.values(files).some(body=>body.includes('README.md#'+anchor)));
  }
});

test('Distinct pins retain separate bodies and an untrusted block cannot forge an edition link',()=>{
  const child=createProject(user,{title:'두 판',graph:steps(2)});
  snapshot(user,{id:child.id,revision:child.revision});
  set('INSERT INTO versions VALUES(?,?,?,?,?)',child.id,2,'다음판',JSON.stringify(steps(3)),new Date().toISOString());
  const forged=createBlock('workflow.call',{id:'forged',config:{exportSharedEdition:'../../private',workflowId:'missing'}});
  const {pkg,files}=archive(chain([createBlock('input.user_request',{id:'start'}),call('one',child.id),
    call('two',child.id,2),call('one-again',child.id),call('two-again',child.id,2),forged,createBlock('output.answer',{id:'finish'})]));
  assert.equal(Object.keys(files).filter(path=>path.startsWith('workflow/edition-')).length,2);
  assert.notEqual(pkg.graph.nodes[1].config.exportSharedEdition,pkg.graph.nodes[2].config.exportSharedEdition);
  assert.equal(pkg.graph.nodes[5].config.exportSharedEdition,undefined);
  assert.ok(!Object.values(files).join('').includes('../../private'));
});

test('Each caller keeps its own Skill, MCP pin, input and return site',async t=>{
  const admins=process.env.STUDIO_ADMIN_IDS;
  process.env.STUDIO_ADMIN_IDS=user.id;
  t.after(()=>{if(admins===undefined)delete process.env.STUDIO_ADMIN_IDS;else process.env.STUDIO_ADMIN_IDS=admins;});
  const server=writeAsset(user,{name:'Lookup',kind:'mcp',payload:{url:'https://lookup.example.org/mcp',tools:['lookup','status']}});
  writeAsset(user,{id:server.id,name:'Lookup',baseVersion:1,payload:{url:'https://lookup.example.org/v2',tools:['lookup','status']}});
  const lookup='mcp.'+server.id+'.lookup';
  const child=createProject(user,{title:'조회 공통판',graph:chain([
    createBlock('input.user_request',{id:'q'}),createBlock('agent.task',{id:'read',config:{goal:'조회',allowedTools:[lookup]}}),
    createBlock('output.answer',{id:'z'})])});
  snapshot(user,{id:child.id,revision:child.revision});
  function role(name:string,version:number){
    return createBlock('agent.delegate',{id:name,title:name,config:{role:name,instruction:'확인',allowedTools:[version===1?lookup:'mcp.'+server.id+'.status']},
      graph:chain([createBlock('input.user_request',{id:'input'}),call('call-'+name,child.id),createBlock('output.answer',{id:'return'})])});
  }
  const root=chain([createBlock('input.user_request',{id:'request'}),role('Alpha',1),role('Beta',2),createBlock('output.answer',{id:'out'})]);
  for(const [i,name] of ['Alpha','Beta'].entries()){
    const skill=createBlock('instruction.skill',{id:'s'+i,title:'Rule-'+name,config:{content:'Rule for '+name}});
    const mcp=createBlock('connection.mcp',{id:'m'+i,config:{assetId:server.id,version:i+1}});
    root.nodes.push(skill,mcp);
    root.edges.push(...connectBlocks(root,skill.id,name),...connectBlocks(root,mcp.id,name));
  }
  const {files}=archive(root);
  const seen:{instruction:string;tools:string[]}[]=[];
  const observedPins:number[]=[];
  const childGraph=child.graph;
  assert.ok(childGraph);
  const run=await executeGraph(root,{runId:'shared-permissions',input:'자료를 확인하세요.'},{
    workflow:async()=>childGraph,tool:async()=>assert.fail('모델의 도구 선택 없음'),
    toolDefinition:async(name,connector)=>{if(name===lookup)observedPins.push(connector!.version);return undefined;},
    model:async request=>{
      if(request.instruction.includes('완료 판정:'))return {text:JSON.stringify({status:'met',reason:'확인 완료'})};
      seen.push({instruction:request.instruction,tools:request.tools});return {text:'자료 확인 완료'};
    },
  });
  assert.equal(run.status,'completed',run.error??'');
  assert.deepEqual(observedPins,[1]);
  assert.deepEqual(seen.map(request=>request.tools),[[lookup],[]]);
  assert.match(seen[0].instruction,/Rule for Alpha/);assert.doesNotMatch(seen[0].instruction,/Rule for Beta/);
  assert.match(seen[1].instruction,/Rule for Beta/);assert.doesNotMatch(seen[1].instruction,/Rule for Alpha/);
  const shared=Object.entries(files).find(([path])=>path.startsWith('workflow/edition-'))!;
  assert.ok(shared[0]);
  const pages=Object.entries(files).filter(([path])=>/^workflow\/step-\d+\.md$/.test(path)).map(([,body])=>body);
  const read=pages.find(body=>body.includes('AI 작업 · read'))!;
  assert.ok(read);
  assert.doesNotMatch(read,/Rule-Alpha|Rule-Beta|call-Alpha|call-Beta/);
  for(const name of ['Alpha','Beta']){
    const site=pages.find(body=>body.includes('Workflow 재사용 · call-'+name))!;
    const pin=name==='Alpha'?1:2;
    assert.ok(site.includes('.agents/skills/rule-'+name.toLowerCase()+'/SKILL.md')&&site.includes('Lookup '+pin+'판')&&site.includes('종료값을 이 호출 단계'),site);
    assert.ok(site.includes(']('+shared[0].split('/')[1]+')'));
    assert.ok(!site.includes('Lookup '+(3-pin)+'판'));
  }
  const omitted=archive(root,false).active.filter(row=>row.step.includes('공유 하위 Workflow')&&row.step.endsWith('AI 작업'));
  const mcpNotes=omitted.filter(row=>row.reason.includes('MCP 연결 설정'));
  assert.ok(mcpNotes.some(row=>row.action.includes('Alpha')));
  assert.ok(!mcpNotes.some(row=>row.action.includes('Beta')));
});

test('A small design stays inline and links each call to one standalone Markdown edition',()=>{
  const child=createProject(user,{title:'두 단계',graph:steps(2)});
  snapshot(user,{id:child.id,revision:child.revision});
  const {files}=archive(chain([createBlock('input.user_request',{id:'start'}),call('a',child.id),call('b',child.id),createBlock('output.answer',{id:'done'})]));
  const [path,body]=Object.entries(files).find(([name])=>name.startsWith('workflow/edition-'))!;
  assert.equal(files['workflow/index.md'],undefined);
  assert.equal(files['AGENTS.md'].split(']('+path+')').length-1,2);
  assert.equal(Object.keys(files).filter(name=>name.startsWith('workflow/')).length,1);
  assert.match(body,/사용자 입력 · entry/);
  assert.match(body,/현재 호출 기록의 복귀 위치/);
  assert.doesNotMatch(files['AGENTS.md'],/사용자 입력 · entry/);
});

test('목표형 호출자에 직접 연결한 Skill은 공통 저장판의 독립 위임 역할에 넘어가지 않는다',async()=>{
  const body=chain([createBlock('input.user_request',{id:'in'}),createBlock('agent.delegate',{
    id:'review',config:{role:'검토자',instruction:'수신 범위 확인',allowedTools:['reservations.list']}}),createBlock('output.answer',{id:'end'})]);
  const project=createProject(user,{title:'위임 검토 저장판',graph:body});
  snapshot(user,{id:project.id,revision:project.revision});
  const callers=['Alpha','Beta'].map(id=>createBlock('agent.task',{id,title:id,config:{goal:id,allowedTools:['workflow.inspect'],maxSteps:2}}));
  const root=chain([createBlock('input.user_request',{id:'q'}),...callers,createBlock('output.answer',{id:'z'})]);
  const tool=createBlock('workflow.tool',{id:'inspect',config:{name:'inspect',workflowId:project.id,version:1}});
  root.nodes.push(tool);
  callers.forEach(caller=>{
    const skill=createBlock('instruction.skill',{id:'skill-'+caller.id,config:{content:'Direct-'+caller.id}});
    root.nodes.push(skill);
    root.edges.push(...connectBlocks(root,skill.id,caller.id),...connectBlocks(root,tool.id,caller.id));
  });
  const roles:string[]=[];
  const result=await executeGraph(root,{input:'반납 요약',runId:'tool-scope'},{
    workflow:async()=>body,tool:async()=>assert.fail('외부 호출 없음'),model:async req=>{
      if(req.instruction.includes('완료 판정:'))return {text:'{"status":"met","reason":"완료"}'};
      if(req.tools.includes('workflow.inspect')){
        assert.match(req.instruction,/Direct-(Alpha|Beta)/);
        return req.context.includes('검토 결과')?{text:'작성 완료'}:{text:'',tool:{name:'workflow.inspect',args:{question:'요약'}}};
      }
      roles.push(req.instruction);
      assert.deepEqual(req.tools,[]);return {text:'검토 결과'};
    }});
  assert.equal(result.status,'completed',result.error??'');
  assert.equal(roles.length,2);
  assert.doesNotMatch(roles.join('\n'),/Direct-Alpha|Direct-Beta/);
  for(const split of [false,true]){
    if(split)root.nodes[0].config.question='긴 입력\n'.repeat(205);
    const {files}=archive(root);
    const role=Object.entries(files).find(([path])=>path.startsWith('agents/'))![1];
    assert.match(role,/이 배정의 단일 응답에서 호출할 도구 — 없음/);
    assert.doesNotMatch(role,/Direct-Alpha|Direct-Beta|reservations\.list/);
    assert.match(Object.values(files).join('\n'),/목표형 AI 작업에 직접 연결한 Skill은 그 작업의 판단에만/);
  }
});

test('One stored body can return to a sequential call or to the invoking Agent decision',()=>{
  const childGraph=chain([createBlock('input.user_request',{id:'query'}),
    createBlock('ai.single_task',{id:'inspect',config:{goal:'원문에서 찾기'}}),createBlock('output.answer',{id:'result'})]);
  childGraph.nodes.push(createBlock('resource.context',{id:'manual',title:'안내서',config:{content:'받은 질문의 답을 확인하세요.'}}));
  childGraph.edges.push(...connectBlocks(childGraph,'manual','inspect'));
  const child=createProject(user,{title:'재사용 가능 조회',graph:childGraph});
  snapshot(user,{id:child.id,revision:child.revision});
  const root=chain([createBlock('input.user_request',{id:'request'}),call('direct',child.id),
    createBlock('agent.task',{id:'choose',config:{goal:'필요 시 도구 선택',allowedTools:['workflow.inspect']}}),
    createBlock('output.answer',{id:'done'})]);
  const tool=createBlock('workflow.tool',{id:'callable',config:{name:'inspect',description:'내용을 확인',workflowId:child.id,version:1}});
  root.nodes.push(tool);
  root.edges.push(...connectBlocks(root,tool.id,'choose'));
  const {files,pkg}=archive(root);
  const [path,body]=Object.entries(files).find(([name])=>name.startsWith('workflow/edition-'))!;
  const main=files['AGENTS.md'];
  assert.equal(main.split(']('+path+')').length-1,3);
  assert.match(main.split('Workflow 재사용 · direct')[1].split('### ')[0],/호출 단계의 다음 경로/);
  assert.match(main.split('호출 가능한 Workflow · callable')[1].split('### ')[0],/그 Agent의 다음 판단/);
  assert.match(main.split('AI 작업 · choose')[1].split('### ')[0],/이번 호출 인자와 이 담당자의 범위/);
  assert.match(body,/현재 호출 기록의 복귀 위치/);
  const labels=pkg.resources.find(r=>r.name==='안내서')!.steps;
  assert.ok(labels.length && labels.every(step=>step.startsWith('공유 하위 Workflow 1판')&&!step.includes('direct')));
  assert.ok(files['AGENTS.md'].includes(labels[0])&&body.includes(labels[0].split(' › ')[0]));
});

test('Two Agents using one saved tool definition only prepare MCP editions permitted for that invocation',t=>{
  const admins=process.env.STUDIO_ADMIN_IDS;
  process.env.STUDIO_ADMIN_IDS=user.id;
  t.after(()=>{if(admins===undefined)delete process.env.STUDIO_ADMIN_IDS;else process.env.STUDIO_ADMIN_IDS=admins;});
  const server=writeAsset(user,{name:'Catalog',kind:'mcp',payload:{url:'https://catalog.example.org/1',tools:['lookup','status']}});
  writeAsset(user,{id:server.id,name:'Catalog',baseVersion:1,payload:{url:'https://catalog.example.org/2',tools:['lookup','status']}});
  const prefix='mcp.'+server.id+'.';
  const child=createProject(user,{title:'공유 조회 도구',graph:chain([createBlock('input.user_request',{id:'entry'}),
    createBlock('agent.task',{id:'lookup',title:'조회 판단',config:{goal:'조회',allowedTools:[prefix+'lookup']}}),createBlock('output.answer',{id:'done'})])});
  snapshot(user,{id:child.id,revision:child.revision});
  function agent(id:string,tool:string){return createBlock('agent.task',{id,title:id,config:{goal:'판단',allowedTools:[prefix+tool,'workflow.inspect']}});}
  const root=chain([createBlock('input.user_request',{id:'begin'}),agent('Agent-A','lookup'),agent('Agent-B','status'),createBlock('output.answer',{id:'finish'})]);
  const callable=createBlock('workflow.tool',{id:'single-tool',config:{workflowId:child.id,version:1,name:'inspect',description:'필요할 때 조회'}});
  root.nodes.push(callable);
  for(const [i,id] of ['Agent-A','Agent-B'].entries()){
    const mcp=createBlock('connection.mcp',{id:'pin-'+i,config:{assetId:server.id,version:i+1}});
    root.nodes.push(mcp);
    root.edges.push(...connectBlocks(root,mcp.id,id),...connectBlocks(root,callable.id,id));
  }
  assert.deepEqual(validateGraph(root),[]);
  for(const mode of ['compact','split']){
    if(mode==='split')root.agentScope={mode:'dedicated',purpose:'긴 업무 '.repeat(1500)};
    const {active,files}=archive(root,r=>r.kind!=='mcp'||r.version==='1');
    const shared=Object.keys(files).filter(path=>path.startsWith('workflow/edition-'));
    assert.equal(shared.length,1);
    assert.ok(!active.some(item=>item.step.endsWith('조회 판단')&&item.reason.includes('MCP 연결 설정')),JSON.stringify(active));
    for(const id of ['Agent-A','Agent-B']){
      const page=Object.values(files).find(text=>text.includes('AI 작업 · '+id))!;
      const section=page.split('AI 작업 · '+id)[1].split('### ')[0];
      assert.match(section,/이번 호출 인자와 이 담당자의 범위/);
      assert.ok(section.includes(shared[0].split('/')[1]));
    }
    const none=archive(root,false).active.filter(item=>item.step.endsWith('조회 판단')&&item.reason.includes('MCP 연결 설정'));
    assert.ok(none.some(item=>item.action.includes('Agent-A'))&&!none.some(item=>item.action.includes('Agent-B')));
  }
});

test('A deep call listed before a shallow call cannot truncate the copy the shallow call can use',()=>{
  const leaf=createProject(user,{title:'마지막 설계',graph:steps(2)});
  snapshot(user,{id:leaf.id,revision:leaf.revision});
  const reusable=createProject(user,{title:'공유 설계',graph:chain([createBlock('input.user_request',{id:'start'}),call('leaf-site',leaf.id),
    createBlock('output.answer',{id:'finish'})])});
  snapshot(user,{id:reusable.id,revision:reusable.revision});
  let nested=chain([createBlock('input.user_request',{id:'start'}),call('deep-site',reusable.id),createBlock('output.answer',{id:'done'})]);
  for(let i=0;i<5;i++)nested=chain([createBlock('input.user_request',{id:'start'}),createBlock('agent.team',{id:'team'+i,config:{goal:'검토'},graph:nested}),createBlock('output.answer',{id:'done'})]);
  const root=chain([createBlock('input.user_request',{id:'root'}),createBlock('agent.team',{id:'deep',config:{goal:'검토'},graph:nested}),
    call('shallow-site',reusable.id),createBlock('output.answer',{id:'end'})]);
  const {pkg,active}=archive(root);
  assert.ok(pkg.graph.nodes[2].graph!.nodes[1].graph?.nodes.length);
  const limit=active.filter(row=>row.reason.includes('깊이 또는 전체 블록 수'));
  assert.equal(limit.length,1);
  assert.ok(limit[0].step.endsWith('deep-site'),limit[0].step);
});

test('중첩 공유판의 도구 준비에는 바깥 호출과 빠진 판을 선택한 안쪽 담당자가 모두 남는다',async t=>{
  const original=process.env.STUDIO_ADMIN_IDS;
  process.env.STUDIO_ADMIN_IDS=user.id;
  t.after(()=>{if(original===undefined)delete process.env.STUDIO_ADMIN_IDS;else process.env.STUDIO_ADMIN_IDS=original;});
  const payload={url:'https://lookup.example.org/mcp',tools:['lookup'],readOnlyTools:['lookup']};
  const server=writeAsset(user,{name:'자료 조회',kind:'mcp',payload});
  writeAsset(user,{id:server.id,baseVersion:1,name:'자료 조회',payload});
  const name='mcp.'+server.id+'.lookup';
  const leaf=createProject(user,{title:'자료 조회',graph:chain([createBlock('input.user_request',{id:'entry'}),
    createBlock('tool.invoke',{id:'lookup',title:'최종 조회',config:{tool:name}}),createBlock('output.answer',{id:'done'})])});
  snapshot(user,{id:leaf.id,revision:leaf.revision});
  const mid=chain([createBlock('input.user_request',{id:'entry'}),...['담당 A','담당 B'].map((title,i)=>createBlock('agent.task',{
    id:'role'+i,title,config:{goal:'조회',allowedTools:[name,'workflow.inspect']}})),createBlock('output.answer',{id:'done'})]);
  const tool=createBlock('workflow.tool',{id:'callable',config:{workflowId:leaf.id,version:1,name:'inspect',description:'조회'}});
  mid.nodes.push(tool);
  for(let i=0;i<2;i++){
    const mcp=createBlock('connection.mcp',{id:'pin'+i,config:{assetId:server.id,version:i+1}});
    mid.nodes.push(mcp);mid.edges.push(...connectBlocks(mid,mcp.id,'role'+i),...connectBlocks(mid,tool.id,'role'+i));
  }
  const middle=createProject(user,{title:'중간 업무',graph:mid});
  snapshot(user,{id:middle.id,revision:middle.revision});
  const root=chain([createBlock('input.user_request',{id:'entry'}),call('Outer-1',middle.id),call('Outer-2',middle.id),createBlock('output.answer',{id:'end'})]);
  const versions:number[]=[];
  const runtime=resolveWorkflowRefs(root,user,project.id,{expand:true});
  const result=await executeGraph(runtime,{runId:'nested-mcp',input:'조회'},{
    model:async r=>r.instruction.includes('완료 판정:')?{text:'{"status":"met","reason":"조회 완료"}'}:
      !r.context.includes('"tool": "workflow.inspect"')?{text:'',tool:{name:'workflow.inspect',args:{}}}:{text:'조회 완료'},
    isReadOnlyTool:()=>true,tool:async(_name,_args,action)=>{versions.push(Number(action.connector?.version));return '확인';},
  });
  assert.equal(result.status,'completed',result.error??'');assert.deepEqual(versions,[1,2,1,2]);
  for(const split of [false,true]){
    if(split)root.agentScope={mode:'dedicated',purpose:'자료 조회 '.repeat(1800)};
    const {files,active}=archive(root,r=>r.kind!=='mcp'||r.version==='1');
    const rows=active.filter(r=>r.step.endsWith('최종 조회')&&r.reason.includes('MCP 연결 설정'));
    assert.equal(rows.length,2,JSON.stringify(active));
    for(const name of ['Outer-1','Outer-2']){
      const row=rows.find(r=>r.action.includes(name))!;
      assert.ok(row.action.includes('담당 B')&&row.action.includes('2판')&&!row.action.includes('담당 A'));
      assert.ok(files['README.md'].includes(row.action));
    }
  }
});
