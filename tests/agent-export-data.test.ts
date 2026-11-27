import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,posix} from 'node:path';
import {strFromU8,unzipSync} from 'fflate';
import {after,test} from 'node:test';
import {connectBlocks,createBlock,type Graph} from '../src/domain';
import {activeExportPreparation} from '../src/domain/agent-export';
import {token} from '../src/engine/session';
import {executeGraph,type Passage} from '../src/engine';
import {prepareAgentExport,previewAgentExport} from '../src/server/agent-export';
import {exportMcp,mcpConfigFiles} from '../src/server/agent-mcp-export';
import {buildAgentZip} from '../src/server/agent-zip';
import {assetShare,createLibraryLookupConnection,writeAsset} from '../src/server/assets';
import {authenticate} from '../src/server/auth';
import {db,set} from '../src/server/db';
import {createProject,openProject} from '../src/server/projects';
import {resolveWorkflowRefs} from '../src/server/workflow-refs';

const scratch=mkdtempSync(join(tmpdir(),'agent-export-'));
process.env.STUDIO_DATA_DIR=scratch;
after(()=>{db().close();rmSync(scratch,{recursive:true,force:true});});
const account=(name:string)=>authenticate('signup',name,'export-test-passphrase','').user;
const b64=(text:string)=>Buffer.from(text).toString('base64');

test('등록 자료와 직접 입력 원문의 1판을 7판 색인에서 찾아 등록 자료의 assetId만 읽는다',async()=>{
  const user=account('index-edition'),project=createProject(user,{title:'원문 판'});
  const asset=writeAsset(user,{name:'원문',kind:'document',payload:{content:'반납 기한'}});
  for(const registered of [true,false]){
    const graph:Graph={nodes:[createBlock('input.user_request',{id:'in'}),createBlock('knowledge.manage',{id:'index',config:{operation:'index',version:'7'}}),
      createBlock('knowledge.search',{id:'search',config:{query:'반납'}}),createBlock('data.transform',{id:'pick',config:{operation:'select',path:'0.assetId'}}),
      createBlock('output.answer',{id:'out'}),createBlock('resource.context',{id:'source',title:'원문',config:{version:'1',...(registered?{assetId:asset.id}:{content:'반납 기한'})}})],edges:[]};
    for(const [from,to] of [['in','index'],['index','search'],['search','pick'],['pick','out'],['source','index']])
      graph.edges.push(...connectBlocks(graph,from,to));
    const result=await executeGraph(graph,{runId:'index-'+registered,input:'반납'},{asset:async()=>({id:asset.id,title:'원문',version:'1',content:'반납 기한'}),
      model:async()=>{throw Error('unexpected model');},tool:async()=>{throw Error('unexpected tool');}});
    const passage=(result.checkpoint.steps['root/search'].values.value as Passage[])[0];
    assert.deepEqual([passage.id,passage.version,passage.indexVersion,passage.assetId],[registered?asset.id:'source','1','7',registered?asset.id:undefined]);
    if(registered){assert.equal(result.status,'completed',result.error??'');assert.equal(result.output,asset.id);}
    else{assert.equal(result.status,'failed');assert.match(result.error??'',/0.assetId/);}
    for(const split of [false,true]){
      if(split)graph.agentScope={mode:'dedicated',purpose:'원문 확인 '.repeat(1800)};
      const req={id:project.id,title:'원문',graph},preview=previewAgentExport(user,req);
      const zip=unzipSync(buildAgentZip(prepareAgentExport(user,{...req,previewId:preview.previewId,selected:preview.resources.filter(r=>r.available).map(r=>r.key)})));
      const instructions=Object.values(zip).map(bytes=>strFromU8(bytes)).join('\n');
      assert.ok(instructions.includes('indexVersion')&&instructions.includes('원문 판 version'));
      assert.equal(instructions.includes('assetId='+JSON.stringify(asset.id)),registered);
    }
  }
});

test('비밀 인자의 실제 값은 환경에서 채우고 연결된 요청식과 인자 필드는 두 ZIP 배치에 보존한다',()=>{
  const user=account('secret-placeholders'),project=createProject(user,{title:'승인'});
  const graph:Graph={nodes:[createBlock('approval.action',{id:'approve',title:'변경 승인',config:{tool:'write',
    args:{query:'page',filter:{token:'test-sensitive-value',password:'{{input.pass}}'}}}})],edges:[]};
  for(const split of [false,true]){
    if(split)graph.agentScope={mode:'dedicated',purpose:'변경 승인 '.repeat(1800)};
    const req={id:project.id,title:'승인',graph},preview=previewAgentExport(user,req);
    const pkg=prepareAgentExport(user,{...req,previewId:preview.previewId,selected:[]});
    assert.deepEqual(pkg.graph.nodes[0].config.args,{query:'page',filter:{token:'<실행 환경에서 입력>',password:'{{input.pass}}'}});
    const zip=unzipSync(buildAgentZip(pkg)),texts=Object.values(zip).map(bytes=>strFromU8(bytes)).join('\n');
    assert.ok(!texts.includes('test-sensitive-value')&&texts.includes('{{input.pass}}'));
    assert.ok(strFromU8(zip['README.md']).includes('filter.token'));
    assert.ok(!strFromU8(zip['README.md']).includes('filter.password'));
  }
});

test('두 ZIP 배치에서 원문 링크와 Skill 이름을 보존하고 사용 단계에 누락 부속 파일을 표시한다',()=>{
  const user=account('material-links'),p=createProject(user,{title:'자료'});
  const body='---\nname: check-edition\ndescription: 판 확인\n---\n[예시](references/yes.md) [양식](references/missing.md)';
  const skill=writeAsset(user,{name:'Department guide',kind:'skill',payload:{files:[
    {path:'SKILL.md',data:b64(body)},{path:'references/yes.md',data:b64('예시')},
  ]}});
  const graph:Graph={nodes:[createBlock('input.user_request',{id:'q'}),createBlock('ai.single_task',{id:'a',title:'검토',config:{goal:'자료를 읽기'}}),
    createBlock('ai.single_task',{id:'b',title:'검토',config:{goal:'확인'}}),createBlock('output.answer',{id:'out'}),
    createBlock('resource.context',{id:'g',title:'Guide.md',config:{content:'[부록](appendix.md#day)'}}),
    createBlock('resource.context',{id:'d',title:'appendix.md',config:{content:'# Day'}}),
    createBlock('resource.context',{id:'d1',title:'규정',config:{content:'월요일'}}),
    createBlock('resource.context',{id:'d2',title:'규정',config:{content:'금요일'}}),
    createBlock('instruction.skill',{id:'s',config:{assetId:skill.id,version:1}})],edges:[]};
  for(const [from,to] of [['q','a'],['a','b'],['b','out'],['s','b'],['g','a'],['d','b'],['d1','a'],['d2','b']]){
    graph.edges.push(...connectBlocks(graph,from,to));
  }
  for(const split of [false,true]){
    if(split)graph.agentScope={mode:'dedicated',purpose:'자료 업무 '.repeat(1800)};
    const req={id:p.id,title:'자료',graph},preview=previewAgentExport(user,req);
    const rules=preview.resources.filter(r=>r.name==='규정');
    assert.ok(rules[0].steps.includes('검토 (1)')&&rules[1].steps.includes('검토 (2)'));
    const guide=preview.resources.find(r=>r.name==='Guide.md')!,appendix=preview.resources.find(r=>r.name==='appendix.md')!;
    const keys=preview.resources.map(r=>r.key);
    const archive=(selected:string[])=>{
      const pkg=prepareAgentExport(user,{...req,selected,previewId:preview.previewId});
      return {pkg,zip:unzipSync(buildAgentZip(pkg)),prep:activeExportPreparation(preview.preparation,selected)};
    };
    const all=archive(keys);
    assert.equal(Boolean(all.zip['workflow/index.md']),split);
    const guidePath=all.pkg.resources.find(r=>r.key===guide.key)!.files[0];
    assert.equal(strFromU8(all.zip[guidePath]),'[부록](appendix.md#day)');
    assert.equal(strFromU8(all.zip[posix.join(posix.dirname(guidePath),'appendix.md')]),'# Day');
    assert.ok(all.zip['.agents/skills/check-edition/references/yes.md']);
    assert.ok(all.prep.some(x=>x.step==='검토 (2)'&&x.action.includes('references/missing.md')));
    assert.ok(!all.prep.some(x=>x.action.includes('appendix.md')||x.action.includes('references/yes.md')));
    const except=archive(keys.filter(k=>k!==appendix.key&&k!==preview.resources.find(r=>r.kind==='skill')!.key));
    assert.ok(except.prep.some(x=>x.step==='검토 (1)'&&x.action.includes('appendix.md')));
    assert.ok(!except.prep.some(x=>x.action.includes('references/missing.md')));
    assert.ok(!except.zip['.agents/skills/check-edition/SKILL.md']);
    assert.ok(Object.values(except.zip).some(bytes=>strFromU8(bytes).includes('.agents/skills/check-edition/SKILL.md')));
  }
});

test('중첩 폴더와 한글·공백 파일 링크는 원문 그대로 열리고 대소문자 오류와 누락은 소비 단계에 표시된다',()=>{
  const user=account('nested-file-links'),project=createProject(user,{title:'부속 문서'});
  const annotated='[부록](../%EC%9E%90%EB%A3%8C%20%EB%AA%A8%EC%9D%8C/Appendix.MD#part)\r\n'+
    '[철자](<../자료 모음/appendix.md>) [누락](<누락 파일.md>)\r\n`[예시](fake.md)`';
  const graph:Graph={nodes:[createBlock('resource.context',{id:'guide',title:'manual/지침/Guide.md',config:{content:annotated}}),
    createBlock('resource.context',{id:'note',title:'manual/자료 모음/Appendix.MD',config:{content:'# part'}}),
    createBlock('ai.single_task',{id:'check',title:'서식 확인',config:{goal:'파일을 확인'}})],edges:[]};
  graph.edges.push(...connectBlocks(graph,'guide','check'));
  for(const split of [false,true]){
    if(split)graph.agentScope={mode:'dedicated',purpose:'부속 문서 '.repeat(1800)};
    const req={id:project.id,title:'부속 문서',graph},preview=previewAgentExport(user,req);
    const keys=preview.resources.map(r=>r.key),guide=preview.resources.find(r=>r.name.endsWith('Guide.md'))!;
    const pkg=prepareAgentExport(user,{...req,selected:keys,previewId:preview.previewId}),zip=unzipSync(buildAgentZip(pkg));
    const path=pkg.resources.find(r=>r.key===guide.key)!.files[0];
    assert.equal(strFromU8(zip[path]),annotated);
    const relative=decodeURIComponent(annotated.match(/\[부록\]\(([^#]+)/)![1]);
    assert.equal(strFromU8(zip[posix.join(posix.dirname(path),relative)]),'# part');
    const links=(selected:string[])=>activeExportPreparation(preview.preparation,selected).filter(x=>x.reason.includes('로컬 파일'));
    assert.equal(links(keys).length,2);
    assert.ok(links(keys).every(x=>x.step==='서식 확인'));
    assert.ok(links(keys).some(x=>x.action.includes('appendix.md')&&x.action.includes('Appendix.MD')));
    assert.ok(links(keys).some(x=>x.action.includes('누락 파일.md')));
    assert.equal(links([guide.key]).length,3);
    assert.equal(links(keys.filter(k=>k!==guide.key)).length,0);
  }
});

test('draft exports preserve a broken connection and recursive call as actionable preparation in the preview and README',()=>{
  const owner=account('unfinished-export'), project=createProject(owner,{title:'작성 중'});
  const graph:Graph={nodes:[
    createBlock('input.user_request',{id:'start',title:'문의 접수'}),
    createBlock('workflow.call',{id:'cycle',title:'자기 설계 호출',config:{workflowId:project.id}}),
  ],edges:[{id:'broken',from:'start',to:'missing',out:'next',input:'in',kind:'flow'}]};
  const request={id:project.id,title:'',graph};
  assert.throws(()=>resolveWorkflowRefs(graph,owner,project.id,{expand:true,onUnavailable:()=>assert.fail()}),{status:422});
  const preview=previewAgentExport(owner,request);
  const expected=activeExportPreparation(preview.preparation,[]);
  assert.ok(expected.some(item=>item.step==='문의 접수'&&item.reason.includes('연결할 블록')));
  assert.ok(expected.some(item=>item.step==='자기 설계 호출'&&item.reason.includes('상위 Workflow')));
  assert.ok(expected.every(item=>item.action&&item.reason));
  const pkg=prepareAgentExport(owner,{...request,selected:[],previewId:preview.previewId});
  const zip=unzipSync(buildAgentZip(pkg));
  const readme=strFromU8(zip['README.md']);
  for(const item of expected) assert.ok(readme.includes(item.step)&&readme.includes(item.action)&&readme.includes(item.reason));
  assert.ok(!readme.includes(project.id));
  assert.ok(zip['AGENTS.md']);
});

test('a complete question-to-answer graph exports without a preparation notice',()=>{
  const owner=account('ready-export'), project=createProject(owner,{title:'응답'});
  const graph:Graph={nodes:[createBlock('input.user_request',{id:'start'}),createBlock('output.answer',{id:'out'})],edges:[
    {id:'flow',from:'start',to:'out',out:'next',input:'in',kind:'flow'},
    {id:'data',from:'start',to:'out',out:'value',input:'input',kind:'data'},
  ]};
  const request={id:project.id,title:'바로 응답',graph}, preview=previewAgentExport(owner,request);
  assert.deepEqual(preview.preparation,[]);
  const zip=unzipSync(buildAgentZip(prepareAgentExport(owner,{...request,selected:[],previewId:preview.previewId})));
  assert.doesNotMatch(strFromU8(zip['README.md']),/## 실행 준비/);
});

test('preparation checks the resolved MCP edition and keeps missing tool names out of the ZIP',()=>{
  const owner=account('readiness-mcp-version'), project=createProject(owner,{title:'도구 준비'});
  const connection=createLibraryLookupConnection(owner,'도서관');
  const tool=createBlock('tool.invoke',{id:'lookup',title:'예약 확인',config:{tool:'mcp.'+connection.id+'.reservations.list'}});
  const graph:Graph={nodes:[
    createBlock('input.user_request',{id:'start'}),tool,createBlock('output.answer',{id:'out'}),
    createBlock('connection.mcp',{id:'mcp',config:{assetId:connection.id,version:''}}),
  ],edges:[
    {id:'start',from:'start',to:'lookup',kind:'flow',out:'next',input:'in'},
    {id:'input',from:'start',to:'lookup',kind:'data',out:'value',input:'input'},
    {id:'done',from:'lookup',to:'out',kind:'flow',out:'next',input:'in'},
    {id:'output',from:'lookup',to:'out',kind:'data',out:'value',input:'input'},
    {id:'pin',from:'mcp',to:'lookup',kind:'reference',out:'ref',input:'mcp'},
  ]};
  const request={id:project.id,title:'도구 준비',graph};
  const good=previewAgentExport(owner,request);
  assert.ok(!good.preparation.some(item=>!item.when&&item.step==='예약 확인'));
  tool.config.tool='mcp.'+connection.id+'.missing-private-operation';
  const bad=previewAgentExport(owner,request);
  const issue=bad.preparation.find(item=>!item.when&&item.step==='예약 확인');
  assert.ok(issue);
  const zip=unzipSync(buildAgentZip(prepareAgentExport(owner,{...request,previewId:bad.previewId,selected:[]})));
  const readme=strFromU8(zip['README.md']);
  assert.ok(readme.includes(issue.reason));
  assert.ok(!readme.includes(connection.id)&&!readme.includes('missing-private-operation'));
});

test('export rechecks pinned MCP access and emits host settings for selected remote editions only',()=>{
  const owner=account('mcp-export-owner'),peer=account('mcp-export-peer');
  const project=createProject(peer,{title:'선택한 MCP'});
  const oldAdmins=process.env.STUDIO_ADMIN_IDS;
  process.env.STUDIO_ADMIN_IDS=owner.id;
  const remote=(name:string,url:string,tool:string)=>writeAsset(owner,{name,kind:'mcp',
    payload:{url,tools:[tool],testUrl:'http://localhost:45100/test-only',credentialEnv:'STUDIO_CONNECTOR_OWNER_SETTING'}});
  try{
    const pub=remote('Catalog','https://catalog.example.org/mcp','catalog.lookup');
    const omitted=remote('Catalog','https://omitted.example.org/mcp','tool.omitted');
    const local=remote('LAN','http://192.168.1.41/mcp','inventory.read');
    const denied=remote('Private asset','https://denied.example.org/mcp','tool.secret');
    const builtin=createLibraryLookupConnection(peer,'도서관');
    for(const asset of [pub,omitted,local])assetShare(owner,asset.id,'public',false,1);
    const mcp=(id:string,assetId:string)=>createBlock('connection.mcp',{id,config:{assetId,version:1}});
    const graph={nodes:[mcp('one',pub.id),mcp('duplicate',pub.id),mcp('omit',omitted.id),mcp('private',denied.id),
      mcp('lan',local.id),mcp('builtin',builtin.id),createBlock('connection.mcp',{id:'named',config:{server:'library'}})],edges:[]};
    const request={id:project.id,title:'선택한 MCP',graph};
    const {resources,previewId}=previewAgentExport(peer,request);
    assert.equal(resources.length,6);
    const picked=resources.find(r=>r.mcpUrl==='https://catalog.example.org/mcp')!;
    assert.equal(picked.mcpMode,'remote');
    assert.equal(resources.filter(r=>r.mcpMode==='manual'&&r.available).length,3);
    assert.doesNotMatch(JSON.stringify(resources),/STUDIO_CONNECTOR|localhost|192\.168|denied\.example|test-only|tool\.secret/);
    const selected=[picked.key,...resources.filter(r=>r.mcpMode==='manual').map(r=>r.key)];
    const decisions={...request,previewId,selected};
    const pkg=prepareAgentExport(peer,decisions);
    assert.deepEqual(pkg.files,[]);
    assert.doesNotMatch(JSON.stringify(pkg),/omitted\.example|tool\.omitted|192\.168|STUDIO_CONNECTOR|test-only|denied\.example/);
    const {id,tokenEnv}=pkg.resources.find(r=>r.key===picked.key)!.mcp!;
    assert.match(tokenEnv!,/^MCP_[A-Z0-9_]+_TOKEN$/);
    assert.deepEqual(pkg.resources.find(r=>r.name==='도서관')!.mcp!.tools,['reservations.list']);
    const config=mcpConfigFiles(pkg.resources);
    assert.deepEqual(Object.keys(config).sort(),['.codex/config.toml','.mcp.json','opencode.json']);
    const claude=JSON.parse(config['.mcp.json']).mcpServers,opencode=JSON.parse(config['opencode.json']).mcp;
    assert.deepEqual(Object.keys(claude),[id]);
    assert.deepEqual(claude[id],{type:'http',url:picked.mcpUrl,headers:{Authorization:'Bearer $'+'{'+tokenEnv+'}'}});
    assert.deepEqual(Object.keys(opencode),[id]);
    assert.deepEqual(opencode[id],{type:'remote',url:picked.mcpUrl,oauth:false,headers:{Authorization:'Bearer {env:'+tokenEnv+'}'}});
    assert.ok(config['.codex/config.toml'].includes('url = "'+picked.mcpUrl+'"'));
    assert.ok(config['.codex/config.toml'].includes('bearer_token_env_var = "'+tokenEnv+'"'));
    assert.ok(config['.codex/config.toml'].includes('enabled_tools = ["catalog.lookup"]'));
    assert.deepEqual(mcpConfigFiles(prepareAgentExport(peer,{...decisions,selected:[]}).resources),{});
    const archive=unzipSync(buildAgentZip(pkg));
    for(const [path,expected] of Object.entries(config))assert.equal(strFromU8(archive[path]),expected);
    const text=Object.values(archive).map(bytes=>strFromU8(bytes)).join('\n');
    assert.doesNotMatch(text,/omitted\.example|tool\.omitted|denied\.example|tool\.secret|STUDIO_CONNECTOR|test-only|192\.168|localhost/);
    assert.match(strFromU8(archive['README.md']),/inventory\.read/);
    assetShare(owner,pub.id,'private',false);
    assert.throws(()=>prepareAgentExport(peer,decisions),{status:409});
  }finally{
    if(oldAdmins===undefined)delete process.env.STUDIO_ADMIN_IDS;
    else process.env.STUDIO_ADMIN_IDS=oldAdmins;
  }
});

test('machine-local MCP endpoints and URLs containing credentials are manual connections',()=>{
  for(const url of [
    'http://localhost:4490/mcp','http://host.localhost/mcp','http://host.local/mcp','http://mcp-server/mcp',
    'http://[::1]/mcp','http://[fc00::1]/mcp','http://[::ffff:127.0.0.1]/mcp','http://127.1/mcp',
    'http://169.254.169.254/mcp','http://172.16.33.7/mcp','http://100.64.0.1/mcp',
    'https://mcp.example.org/source?token=secret','https://user:secret@mcp.example.org/mcp',
  ]){
    const mcp=exportMcp('r-123456789abc','외부 조회',{content:'',url,tools:['read'],credentialEnv:'STUDIO_CONNECTOR_PRIVATE'});
    assert.deepEqual(mcp,{id:'mcp-123456789abc',tools:['read'],tokenEnv:'MCP_MCP_123456789ABC_TOKEN'},url);
  }
  const connection=exportMcp('r-123456789abc','공개 조회',{content:'',url:'https://mcp.example.org',tools:['search']});
  assert.deepEqual(connection,{id:'mcp-123456789abc',url:'https://mcp.example.org/',tools:['search']});
});

test('current canvas and pinned editions export only the selected originals and safe Skill paths',()=>{
  const user=account('agent-export-data');
  const project=createProject(user,{title:'저장한 설계'});
  const skill=writeAsset(user,{name:'작성법',kind:'skill',payload:{files:[
    {path:'SKILL.md',data:b64('# 판 1')},{path:'examples/example.txt',data:b64('예시')},{path:'.env',data:b64('비밀 설정')},
  ]}});
  writeAsset(user,{id:skill.id,baseVersion:1,name:'다른 이름',payload:{content:'# 판 2'}});
  const child={nodes:[createBlock('instruction.skill',{id:'skill',config:{assetId:skill.id,version:1,assetGrant:'secret-grant'}})],edges:[]};
  const graph={nodes:[
    createBlock('agent.team',{id:'team',title:'검토팀',graph:child}),
    createBlock('resource.context',{id:'source',title:'내부 규정',config:{content:'공유하지 않는 원문'}}),
    createBlock('file.input',{id:'file',config:{content:'공유하지 않는 시험 파일'}}),
    createBlock('tool.invoke',{id:'tool',config:{args:{authorization:'secret-header',book:'A'}}}),
    createBlock('quality.validate',{id:'schema',config:{types:{password:'string'}}}),
  ],edges:[]};
  const request={id:project.id,title:'지금 캔버스',graph};
  const {resources,previewId}=previewAgentExport(user,request);
  assert.equal(resources.length,3);
  assert.doesNotMatch(JSON.stringify(resources),/공유하지 않는|secret-|판 1/);
  const picked=resources.find(r=>r.kind==='skill')!;
  assert.equal(picked.version,'1');
  assert.deepEqual(picked.steps,['검토팀 › 작업 지침·Skill']);
  const pkg=prepareAgentExport(user,{...request,previewId,selected:[picked.key]});
  assert.equal(pkg.title,'지금 캔버스');
  assert.deepEqual(pkg.files.map(f=>f.path),['resources/'+picked.key+'/SKILL.md','resources/'+picked.key+'/examples/example.txt']);
  assert.equal(Buffer.from(pkg.files[0].data,'base64').toString(),'# 판 1');
  assert.doesNotMatch(JSON.stringify(pkg),/공유하지 않는|secret-|\.env|assetGrant/);
  assert.deepEqual(pkg.graph.nodes[4].config.types,{password:'string'});
  assert.equal(openProject(user,project.id).graph!.nodes.length,0);
  assert.throws(()=>prepareAgentExport(user,{...request,selected:['bogus']}),{status:409});
});

test('read permissions are checked per pinned child and material again at download',()=>{
  const who=account('agent-export-owner'),peer=account('agent-export-peer');
  const root=createProject(who,{title:'부모'}),privateChild=createProject(peer,{title:'닫힌 Agent'});
  const doc=writeAsset(peer,{kind:'document',name:'공유 자료',payload:{content:'외부 원문'}});
  const share=assetShare(peer,doc.id,'link',false,1);
  const graph={nodes:[
    createBlock('resource.context',{id:'linked',config:{assetId:doc.id,version:1,assetGrant:share.token}}),
    createBlock('workflow.call',{id:'nested',config:{workflowId:privateChild.id,version:1},graph:{
      nodes:[createBlock('resource.context',{id:'fake',config:{content:'옛 사본'}})],edges:[],
    }}),
  ],edges:[]};
  const request={id:root.id,title:'부모',graph},preview=previewAgentExport(who,request);
  const selected=preview.resources.filter(r=>r.available).map(r=>r.key);
  assert.equal(selected.length,1);
  assert.equal(preview.resources.find(r=>r.kind==='workflow')?.available,false);
  const pkg=prepareAgentExport(who,{...request,previewId:preview.previewId,selected});
  assert.equal(pkg.graph.nodes[1].graph,undefined);
  assert.match(pkg.resources.find(r=>r.kind==='workflow')!.files[0],/^resources\/[^/]+\/AGENTS\.md$/);
  assert.doesNotMatch(JSON.stringify(pkg),/옛 사본/);
  assert.throws(()=>previewAgentExport(peer,request),{status:403});
  assetShare(peer,doc.id,'private',false);
  assert.throws(()=>prepareAgentExport(who,{...request,previewId:preview.previewId,selected}),{status:409});
  const omitted=prepareAgentExport(who,{...request,previewId:previewAgentExport(who,request).previewId,selected:[]});
  assert.equal(omitted.files.length,0);
  assert.doesNotMatch(JSON.stringify(omitted),/외부 원문|공유 자료|옛 사본/);
});

test('linked Workflow exports its pinned edition and missing collections identify steps to reconnect',()=>{
  const user=account('agent-export-child');
  const root=createProject(user,{title:'부모'}),child=createProject(user,{title:'하위 설계'});
  for(const version of [1,2]){
    const childGraph={nodes:[createBlock('resource.context',{id:'doc',title:'하위 자료',config:{content:'하위 원문 '+version}})],edges:[]};
    set('INSERT INTO versions(project,number,title,graph,created) VALUES(?,?,?,?,?)',child.id,version,'하위 설계',JSON.stringify(childGraph),new Date().toISOString());
  }
  const graph={nodes:[
    createBlock('workflow.call',{id:'nested',title:'하위 호출',config:{workflowId:child.id,version:1}}),
    createBlock('knowledge.search',{id:'external',title:'외부 자료 검색',config:{storeKey:'외부 자료집',version:'1'}}),
    createBlock('knowledge.search',{id:'internal',config:{storeKey:'생성할 자료집',version:'1'}}),
    createBlock('knowledge.manage',{id:'publish',config:{operation:'publish',storeKey:'생성할 자료집',version:'1'}}),
    createBlock('knowledge.manage',{id:'index',config:{operation:'index',storeKey:'생성할 자료집',version:'1'}}),
  ],edges:[]};
  const request={id:root.id,title:'부모',graph};
  const preview=previewAgentExport(user,request);
  assert.equal(preview.resources.length,4);
  const selected=preview.resources.filter(r=>r.available).map(r=>r.key);
  const pkg=prepareAgentExport(user,{...request,previewId:preview.previewId,selected});
  assert.equal(pkg.graph.nodes[0].config.workflowId,undefined);
  assert.equal(pkg.graph.nodes[0].graph?.nodes[0].config.exportResource,selected[0]);
  assert.equal(Buffer.from(pkg.files[0].data,'base64').toString(),'하위 원문 1');
  assert.deepEqual(pkg.graph.nodes[1].config.exportCollection,[pkg.resources.find(r=>r.name==='외부 자료집')!.key]);
  assert.equal(pkg.graph.nodes[2].config.exportCollection.length,1);
  assert.equal(pkg.graph.nodes[3].config.exportIndex.length,1);
  const connected={...graph,edges:[
    {id:'indexed',kind:'flow' as const,from:'index',to:'publish',out:'next',input:'in'},
    {id:'published',kind:'flow' as const,from:'publish',to:'internal',out:'next',input:'in'},
  ]};
  const ordered=previewAgentExport(user,{...request,graph:connected});
  assert.equal(ordered.resources.length,2);
});

test('published collection and direct references share one selection and enforce source permissions',()=>{
  const user=account('agent-export-rag'),other=account('agent-export-rag-peer');
  const p=createProject(user,{title:'RAG'});
  const asset=writeAsset(other,{name:'규정',kind:'document',payload:{content:'원본 판'}});
  const share=assetShare(other,asset.id,'link',false,1);
  const docs=[{id:asset.id,assetId:asset.id,title:'규정',version:'1',content:'원본 판'}];
  const hash='snapshot-edition',prefix='knowledge:'+token('규정집')+':';
  function store(key:string,value:string){
    set('INSERT INTO memory VALUES (?,?,?,?,?)',user.id,p.id,'live',prefix+key,value);
  }
  store('release:1',hash);
  store('snapshot:'+hash,JSON.stringify({documents:docs,version:'1',index:[]}));
  store('sources:'+hash,JSON.stringify([{assetId:asset.id,version:'1',assetGrant:share.token}]));
  const graph={nodes:[
    createBlock('knowledge.search',{id:'lookup',config:{storeKey:'규정집',version:'1'}}),
    createBlock('resource.context',{id:'doc',config:{assetId:asset.id,assetGrant:share.token,version:1}}),
  ],edges:[]};
  const request={id:p.id,title:'RAG',graph};
  const {resources,previewId}=previewAgentExport(user,request);
  assert.equal(resources.length,1);
  const pkg=prepareAgentExport(user,{...request,previewId,selected:[resources[0].key]});
  assert.deepEqual(pkg.graph.nodes[0].config.exportCollection,[pkg.graph.nodes[1].config.exportResource]);
  assert.equal(pkg.files.length,1);
  const instructions=strFromU8(unzipSync(buildAgentZip(pkg))['AGENTS.md']);
  assert.ok(instructions.includes(JSON.stringify({id:asset.id,version:'1'})) && instructions.includes(pkg.files[0].path));
  const omitted=prepareAgentExport(user,{...request,previewId,selected:[]});
  assert.equal(omitted.files.length,0);
  assert.ok(!Object.values(unzipSync(buildAgentZip(omitted))).some(body=>strFromU8(body).includes(asset.id)));

  const excerpt={...docs[0],location:'2행',content:'발췌 구절'};
  set("UPDATE memory SET value=? WHERE owner=? AND project=? AND scope='live' AND name=?",
    JSON.stringify({documents:[excerpt],version:'1',index:[]}),user.id,p.id,prefix+'snapshot:'+hash);
  const withExcerpt=previewAgentExport(user,request);
  const both=prepareAgentExport(user,{...request,previewId:withExcerpt.previewId,selected:withExcerpt.resources.map(r=>r.key)});
  const exported=unzipSync(buildAgentZip(both));
  const excerptKey=both.graph.nodes[0].config.exportCollection[0];
  assert.notEqual(excerptKey,both.graph.nodes[1].config.exportResource);
  assert.equal(strFromU8(exported[both.resources.find(r=>r.key===excerptKey)!.files[0]]),'발췌 구절');
  assert.match(strFromU8(exported['AGENTS.md']),/발췌 위치 2행/);

  set("UPDATE memory SET value=? WHERE owner=? AND project=? AND scope='live' AND name=?",
    JSON.stringify({documents:[{...docs[0],content:'입력으로 바뀐 후보 문구'}],version:'1',index:[]}),user.id,p.id,prefix+'snapshot:'+hash);
  const changed=previewAgentExport(user,request);
  const changedPkg=prepareAgentExport(user,{...request,previewId:changed.previewId,selected:changed.resources.map(r=>r.key)});
  assert.equal(changedPkg.resources.filter(r=>r.source?.candidateOnly).length,1);
  assert.equal(changedPkg.files.length,2);
  assert.match(strFromU8(unzipSync(buildAgentZip(changedPkg))['AGENTS.md']),/자료판의 후보 문구/);
  assetShare(other,asset.id,'private',false);
  assert.throws(()=>prepareAgentExport(user,{...request,previewId,selected:[resources[0].key]}),{status:409});
  assert.doesNotMatch(JSON.stringify(previewAgentExport(user,request)),/원본 판/);
});

test('a newer unpinned child invalidates the preview even with no selected resources',()=>{
  const user=account('agent-export-preview'),p=createProject(user,{title:'부모'}),child=createProject(user,{title:'자식'});
  function addVersion(n:number){
    const graph={nodes:[createBlock('control.terminate',{id:'end',config:{message:'결과 '+n}})],edges:[]};
    set('INSERT INTO versions(project,number,title,graph,created) VALUES(?,?,?,?,?)',child.id,n,'자식',JSON.stringify(graph),new Date().toISOString());
  }
  addVersion(1);
  const graph={nodes:[createBlock('workflow.call',{config:{workflowId:child.id,version:''}})],edges:[]};
  const request={id:p.id,title:'부모',graph};
  const original=previewAgentExport(user,request);
  assert.equal(original.resources.length,0);
  addVersion(2);
  assert.throws(()=>prepareAgentExport(user,{...request,previewId:original.previewId,selected:[]}),{status:409});
  const refreshed=previewAgentExport(user,request);
  const pkg=prepareAgentExport(user,{...request,previewId:refreshed.previewId,selected:[]});
  assert.equal(pkg.graph.nodes[0].graph?.nodes[0].config.message,'결과 2');
});

test('a withdrawal design carries its published source and workflow instructions into the native folder',async()=>{
  const user=account('agent-export-withdraw'),p=createProject(user,{title:'자료집 철회'});
  const docs=[{id:'sourceA',title:'규정',version:'1',content:'연결할 규정 원문'}];
  const prefix='knowledge:'+token('규정집')+':';
  const store=(key:string,value:string)=>set('INSERT INTO memory VALUES (?,?,?,?,?)',user.id,p.id,'live',prefix+key,value);
  store('release:1','stored-snapshot');
  store('snapshot:stored-snapshot',JSON.stringify({documents:docs,version:'1',index:[]}));
  store('draft:1',JSON.stringify([{...docs[0],title:'다음 초안',content:'아직 발행하지 않은 자료'}]));
  const graph:Graph={nodes:[
    createBlock('input.user_request',{id:'start'}),
    createBlock('knowledge.manage',{id:'withdraw',config:{operation:'withdraw',storeKey:'규정집',version:'1'}}),
    createBlock('control.terminate',{id:'done',config:{status:'success',message:'철회 완료'}}),
  ],edges:[
    {id:'a',kind:'flow',from:'start',to:'withdraw',out:'next',input:'in'},
    {id:'b',kind:'data',from:'start',to:'withdraw',out:'value',input:'input'},
    {id:'c',kind:'flow',from:'withdraw',to:'done',out:'next',input:'in'},
  ]};
  const request={id:p.id,title:'자료집 철회',graph};
  const {resources,previewId}=previewAgentExport(user,request);
  assert.equal(resources.length,1);
  const selected=resources.map(r=>r.key);
  assert.equal(prepareAgentExport(user,{...request,previewId,selected:[]}).files.length,0);
  const pkg=prepareAgentExport(user,{...request,previewId,selected});
  assert.deepEqual(pkg.graph.nodes[1].config.exportCollection,selected);
  const files=unzipSync(await buildAgentZip(pkg));
  assert.equal(strFromU8(files[pkg.resources[0].files[0]]),'연결할 규정 원문');
  assert.match(strFromU8(files['AGENTS.md']),/자료집 철회/);
  assert.doesNotMatch(Object.keys(files).join('\n'),/^(?:runtime\/|workflow\.json|run\.mjs)/m);
});

test('staged publish data stays private to the project owner and checks pinned input permissions',()=>{
  const owner=account('agent-export-stage'),peer=account('agent-export-stage-peer');
  const project=createProject(owner,{title:'새 자료판 발행'}),p=createProject(peer,{title:'다른 프로젝트'});
  const asset=writeAsset(peer,{name:'발행할 규정',kind:'document',payload:{content:'색인한 자료 원문'}});
  const grant=assetShare(peer,asset.id,'link',false);
  const refs=[{assetId:asset.id,version:'1',assetGrant:grant.token}];
  const docs=[{id:asset.id,assetId:asset.id,title:'발행할 규정',version:'1',content:'색인한 자료 원문'}];
  const node=createBlock('knowledge.manage',{id:'publish',config:{operation:'publish',storeKey:'미발행',version:'2'}});
  const graph={nodes:[node],edges:[]},request={id:project.id,title:'발행',graph};
  const store=(key:string,value:string)=>set('INSERT INTO memory VALUES (?,?,?,?,?)',owner.id,project.id,'live','knowledge:'+token('미발행')+':'+key,value);
  store('draft:2',JSON.stringify(docs));store('sources-draft:2',JSON.stringify(refs));
  store('index:2','index-digest');store('snapshot:index-digest',JSON.stringify({documents:docs,version:'2',index:[]}));
  store('sources:index-digest',JSON.stringify(refs));
  const preview=previewAgentExport(owner,request);
  assert.equal(preview.resources.length,1);
  const keys=preview.resources.map(r=>r.key);
  const pkg=prepareAgentExport(owner,{...request,previewId:preview.previewId,selected:keys});
  assert.equal(pkg.graph.nodes[0].config.exportDraft,undefined);
  assert.deepEqual(pkg.graph.nodes[0].config.exportIndex,keys);
  assert.equal(pkg.graph.nodes[0].config.exportCollection,undefined);
  assert.equal(pkg.graph.nodes[0].config.exportPublished,undefined);
  store('release:2','previous-release');store('published-digest:2','previous-release');
  store('snapshot:previous-release',JSON.stringify({documents:[{id:'old',title:'과거 원문',version:'4',content:'이전 문서 본문'}],version:'2',index:[]}));
  const changed=previewAgentExport(owner,request);
  assert.equal(changed.resources.length,1);
  const changedPkg=prepareAgentExport(owner,{...request,previewId:changed.previewId,selected:keys});
  assert.equal(changedPkg.graph.nodes[0].config.exportPublication,'different-edition');
  const pages=Object.values(unzipSync(buildAgentZip(changedPkg))).map(bytes=>strFromU8(bytes)).join('\n');
  assert.ok(pages.includes('이 판에서 처음 발행한 스냅숏과 다릅니다')&&!pages.includes('이전 문서 본문'));
  const stamp=new Date().toISOString();
  set('INSERT INTO versions VALUES(?,?,?,?,?)',project.id,1,'발행',JSON.stringify(graph),stamp);
  set("UPDATE projects SET visibility='public',public_version=1 WHERE id=?",project.id);
  set('INSERT INTO project_releases VALUES(?,?)',project.id,1);
  set('INSERT INTO project_public_releases VALUES(?,?)',project.id,1);
  const ref={id:p.id,title:'읽기',graph:{nodes:[createBlock('workflow.call',{config:{workflowId:project.id,version:1}})],edges:[]}};
  assert.ok(previewAgentExport(peer,ref).resources.every(r=>!r.available));
  assetShare(peer,asset.id,'private',false);
  assert.throws(()=>prepareAgentExport(owner,{...request,previewId:preview.previewId,selected:keys}),{status:409});
});
