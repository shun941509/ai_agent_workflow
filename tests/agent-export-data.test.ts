import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {strFromU8,unzipSync} from 'fflate';
import {after,test} from 'node:test';
import {createBlock,type Graph} from '../src/domain';
import {token} from '../src/engine/session';
import {prepareAgentExport,previewAgentExport} from '../src/server/agent-export';
import {exportMcp,mcpConfigFiles} from '../src/server/agent-mcp-export';
import {buildAgentZip} from '../src/server/agent-zip';
import {assetShare,createLibraryLookupConnection,writeAsset} from '../src/server/assets';
import {authenticate} from '../src/server/auth';
import {db,set} from '../src/server/db';
import {createProject,openProject} from '../src/server/projects';

const scratch=mkdtempSync(join(tmpdir(),'agent-export-'));
process.env.STUDIO_DATA_DIR=scratch;
after(()=>{db().close();rmSync(scratch,{recursive:true,force:true});});
const account=(name:string)=>authenticate('signup',name,'export-test-passphrase','').user;
const b64=(text:string)=>Buffer.from(text).toString('base64');

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
    assert.deepEqual(mcp,{id:'mcp-123456789abc',tools:['read']},url);
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
  assert.equal(preview.resources.length,2);
  const selected=preview.resources.filter(r=>r.available).map(r=>r.key);
  const pkg=prepareAgentExport(user,{...request,previewId:preview.previewId,selected});
  assert.equal(pkg.graph.nodes[0].config.workflowId,undefined);
  assert.equal(pkg.graph.nodes[0].graph?.nodes[0].config.exportResource,selected[0]);
  assert.equal(Buffer.from(pkg.files[0].data,'base64').toString(),'하위 원문 1');
  assert.deepEqual(pkg.graph.nodes[1].config.exportCollection,[pkg.resources.find(r=>r.name==='외부 자료집')!.key]);
  assert.equal(pkg.graph.nodes[2].config.exportCollection,undefined);
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
  assert.equal(prepareAgentExport(user,{...request,previewId,selected:[]}).files.length,0);
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
  assert.deepEqual(pkg.graph.nodes[0].config.exportDraft,keys);
  assert.deepEqual(pkg.graph.nodes[0].config.exportIndex,keys);
  assert.equal(pkg.graph.nodes[0].config.exportCollection,undefined);
  assert.equal(pkg.graph.nodes[0].config.exportPublished,undefined);
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
