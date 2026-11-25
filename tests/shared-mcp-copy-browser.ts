import assert from 'node:assert/strict';
import { registerBrowserAccount } from './browser-account';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {chromium, expect, type BrowserContext} from '@playwright/test';
import {createBlock, type Graph} from '../src/domain';

const baseURL=process.env.STUDIO_TEST_URL;
const testDir=process.env.STUDIO_TEST_DATA_DIR;
if (!baseURL || !testDir) throw Error('격리된 시험 서버 주소와 같은 서버의 임시 DB 경로가 필요합니다.');
process.env.STUDIO_DATA_DIR=testDir;
const {db,one}=await import('../src/server/db');
const {writeAsset}=await import('../src/server/assets');
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome)?chrome:undefined)});
const calls:{path:string;tool:string}[]=[];
const fixtureCredential=process.env.STUDIO_CONNECTOR_GALLERY_FIXTURE;
const rejected:string[]=[];
const service=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];
  for await (const chunk of req) chunks.push(chunk);
  const {method,id,params}=JSON.parse(Buffer.concat(chunks).toString());
  const path=req.url??'';
  if (path.startsWith('/protected/') && (!fixtureCredential || req.headers.authorization!=='Bearer '+fixtureCredential)) {
    rejected.push(path); res.writeHead(401).end(); return;
  }
  if (method==='notifications/initialized') { res.writeHead(202).end(); return; }
  let result;
  if (method==='initialize') result={protocolVersion:'2025-03-26'};
  else if (method==='tools/call' && params.name===(path.endsWith('/v1')?'lookup.original':'lookup.revised')) {
    calls.push({path,tool:params.name});
    result={structuredContent:{edition:path.endsWith('/v1')?'초판':'개정판',tool:params.name}};
  } else { res.writeHead(400).end(); return; }
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id,result}));
});
service.listen(0,'127.0.0.1');
await once(service,'listening');
const address=service.address();
assert.ok(address && typeof address==='object');
const endpoint='http://127.0.0.1:'+address.port;

async function api(ctx:BrowserContext,action:string,data:unknown={}) {
  const res=await ctx.request.post('/api/studio',{data:{action,data}});
  const body=await res.json();
  assert.ok(res.ok(), action+' '+res.status()+' '+(body.error??''));
  return body.data;
}
function graphFor(tool:string):Graph {
  return {nodes:[
    createBlock('input.user_request',{id:'input',title:'조회 요청',x:0,y:0}),
    createBlock('tool.invoke',{id:'lookup',title:'판별 조회',config:{tool},x:350,y:0}),
    createBlock('output.answer',{id:'answer',title:'조회 결과',x:700,y:0}),
  ],edges:[
    {id:'start',from:'input',to:'lookup',out:'next',input:'in',kind:'flow'},
    {id:'request',from:'input',to:'lookup',out:'value',input:'input',kind:'data'},
    {id:'end',from:'lookup',to:'answer',out:'next',input:'in',kind:'flow'},
    {id:'reply',from:'lookup',to:'answer',out:'value',input:'input',kind:'data'},
  ]};
}
async function execute(ctx:BrowserContext,projectId:string,mode:'test'|'live') {
  const started=await api(ctx,'run.start',{id:projectId,mode,input:'자료 조회',requestKey:crypto.randomUUID()});
  await expect.poll(async()=>(await api(ctx,'run.get',{runId:started.id})).state,{timeout:20000}).toMatch(/^(completed|failed)$/);
  return api(ctx,'run.get',{runId:started.id});
}
async function publishPrivately(ctx:BrowserContext,id:string) {
  const project=await api(ctx,'project.open',{id});
  const version=await api(ctx,'versions.save',{id,revision:project.revision});
  return api(ctx,'versions.publish',{id,visibility:'private',version:version.number});
}
function pinnedGraph(id:string,version:number) {
  const graph=graphFor('mcp.'+id+'.lookup.original');
  graph.nodes.push(createBlock('connection.mcp',{id:'pin',config:{assetId:id,version}}));
  graph.edges.push({id:'link',from:'pin',out:'ref',to:'lookup',input:'mcp',kind:'reference'});
  return graph;
}
async function verifyCredentialCopy(owner:BrowserContext,reader:BrowserContext,title:string) {
  const {user:publisher}=await api(owner,'bootstrap');
  const payload={url:endpoint+'/protected/live/v1',testUrl:endpoint+'/protected/test/v1',tools:['lookup.original'],readOnlyTools:['lookup.original'],
    credentialEnv:'STUDIO_CONNECTOR_GALLERY_FIXTURE'};
  const asset=writeAsset(publisher,{kind:'mcp',name:title,payload});
  await api(owner,'asset.share',{id:asset.id,version:1,visibility:'public'});
  const original=await api(reader,'project.create',{title,graph:pinnedGraph(asset.id,1)});
  const success=await execute(reader,original.id,'test');
  assert.equal(success.state,'completed',success.error);
  const page=await reader.newPage();
  try {
    await page.goto('/?view=shared-assets&asset='+asset.id+'&edition=1');
    await page.getByRole('button',{name:'내 사본 만들기',exact:true}).click();
    await expect(page.getByRole('heading',{name:title+' 사본',exact:true})).toBeVisible();
    const id=new URL(page.url()).searchParams.get('asset');
    assert.ok(id && id!==asset.id);
    await api(owner,'asset.share',{id:asset.id,visibility:'private'});
    const snapshot=await api(reader,'asset.read',{id});
    assert.equal(snapshot.payload.credentialEnv,undefined);
    assert.equal(snapshot.payload.testUrl,undefined);
    const privateWorkflow=await api(reader,'project.create',{title:'인증 사본 검증',graph:pinnedGraph(id,1)});
    await publishPrivately(reader,privateWorkflow.id);
    const rejectedBefore=rejected.length;
    const failed=await execute(reader,privateWorkflow.id,'live');
    assert.equal(failed.state,'failed');
    assert.match(failed.error,/외부 MCP 연결/);
    assert.deepEqual(rejected.slice(rejectedBefore),['/protected/live/v1']);
    const reset=await reader.request.post('/api/studio',{data:{action:'asset.save',data:{id,baseVersion:1,name:title+' 사본',payload}}});
    assert.equal(reset.status(),403);
    assert.match((await reset.json()).error,/운영자/);
    console.log('PASS protected MCP: original used fixture credential; post-withdrawal private copy withheld credential, received HTTP 401 from service; ordinary owner reconfiguration refused (403).');
  } finally { await page.close(); }
}
async function check(width:number) {
  const desktop=width>600;
  const owner=await browser.newContext({baseURL});
  const reader=await browser.newContext({baseURL,viewport:{width,height:desktop?900:844},isMobile:!desktop,hasTouch:!desktop});
  try {
    const tag=crypto.randomUUID().slice(0,8);
    const user=await registerBrowserAccount(owner);
    await registerBrowserAccount(reader);
    // Match the fixture account to the isolated server before registering a connector.
    assert.ok(one('SELECT 1 FROM people WHERE id=? AND login=?',user.id,user.login));
    process.env.STUDIO_ADMIN_IDS=user.id;
    const title='조회 MCP '+tag;
    const edition=(version:number)=>{
      const tool=version===1?'lookup.original':'lookup.revised';
      return {url:endpoint+'/live/v'+version,testUrl:endpoint+'/test/v'+version,tools:[tool],readOnlyTools:[tool]};
    };
    const item=writeAsset(user,{kind:'mcp',name:title+' 초판',payload:edition(1)});
    await api(owner,'asset.share',{id:item.id,version:1,visibility:'link'});
    writeAsset(user,{id:item.id,baseVersion:1,name:title+' 개정판',payload:edition(2)});
    const shared=await api(owner,'asset.share',{id:item.id,version:2,visibility:'link'});
    const page=await reader.newPage();
    await page.goto('/?asset='+item.id+'&edition=published&token='+shared.token);
    await expect(page.getByRole('heading',{name:title+' 개정판',exact:true})).toBeVisible();
    await page.goto('/?view=shared-assets');
    await page.getByRole('tab',{name:'직접 받은 자료'}).click();
    await page.getByRole('button',{name:new RegExp(title+' 개정판')}).click();
    await page.getByLabel('자료 버전').selectOption('1');
    await expect(page.getByRole('heading',{name:title+' 초판',exact:true})).toBeVisible();
    await expect(page.getByLabel('lookup.original 도구 식별자')).toHaveValue('mcp.'+item.id+'.lookup.original');
    const editionURL=page.url();
    const original=await api(reader,'project.create',{title:'공유 조회 '+tag,graph:graphFor('mcp.'+item.id+'.lookup.original')});
    await page.getByRole('button',{name:'내 Workflow에 연결'}).click();
    await page.getByRole('dialog',{name:'프로젝트 선택'}).getByRole('button',{name:original.title,exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'자료를 연결할 블록'});
    await dialog.getByLabel('연결할 블록').selectOption('lookup');
    await dialog.getByRole('button',{name:'선택한 판 연결'}).click();
    await expect(dialog).toHaveCount(0);
    const hasPin=async(projectId:string,assetId:string)=>{
      const graph:Graph=(await api(reader,'project.open',{id:projectId})).graph;
      const source=graph.nodes.find(n=>n.type==='connection.mcp'&&n.config.assetId===assetId&&Number(n.config.version)===1);
      return !!source&&graph.edges.some(e=>e.from===source.id&&e.to==='lookup'&&e.kind==='reference'&&e.out==='ref'&&e.input==='mcp');
    };
    await expect.poll(()=>hasPin(original.id,item.id)).toBe(true);
    const before=calls.length;
    const originalRun=await execute(reader,original.id,'test');
    assert.equal(originalRun.state,'completed',originalRun.error);
    assert.match(originalRun.output,/초판/);
    assert.deepEqual(calls.slice(before),[{path:'/test/v1',tool:'lookup.original'}]);

    await page.goto(editionURL);
    await page.getByRole('button',{name:'내 사본 만들기',exact:true}).click();
    await expect(page.getByRole('heading',{name:title+' 초판 사본',exact:true})).toBeVisible();
    const copyId=new URL(page.url()).searchParams.get('asset');
    assert.ok(copyId&&copyId!==item.id);
    await api(owner,'asset.share',{id:item.id,visibility:'private'});
    const denied=await reader.request.post('/api/studio',{data:{action:'run.start',data:{id:original.id,mode:'test',input:'조회',requestKey:crypto.randomUUID()}}});
    assert.equal(denied.status(),403,await denied.text());
    const copy=await api(reader,'asset.read',{id:copyId});
    assert.ok(copy.asset.mine&&copy.asset.visibility==='private');
    assert.equal(copy.payload.url,edition(1).url);
    assert.deepEqual(copy.payload.tools,['lookup.original']);
    assert.deepEqual(copy.payload.readOnlyTools,['lookup.original']);
    assert.equal(copy.payload.testUrl,undefined);
    const independent=await api(reader,'project.create',{title:'사본 조회 '+tag,graph:graphFor('mcp.'+copyId+'.lookup.original')});
    await page.goto('/?edit='+independent.id);
    const lookup=page.locator('[data-canvas-block="lookup"]');
    await lookup.focus(); await lookup.press('Enter');
    const panel=page.locator('.ws-inspector');
    await panel.locator('summary').filter({hasText:'도구 및 자료'}).click();
    await panel.getByLabel('허용할 MCP').selectOption(copyId);
    await expect.poll(()=>hasPin(independent.id,copyId)).toBe(true);
    const withoutSandbox=await execute(reader,independent.id,'test');
    assert.equal(withoutSandbox.state,'failed');
    assert.match(withoutSandbox.error,/격리 시험 환경/);
    assert.equal(calls.length,before+1);
    await publishPrivately(reader,independent.id);
    const actual=await execute(reader,independent.id,'live');
    assert.equal(actual.state,'completed',actual.error);
    assert.match(actual.output,/초판/);
    assert.deepEqual(calls.slice(before),[{path:'/test/v1',tool:'lookup.original'},{path:'/live/v1',tool:'lookup.original'}]);
    console.log('PASS '+width+'px: received MCP edition 1 ran through /test/v1; after withdrawal original denied, private copy ran lookup.original through /live/v1, isolated-test endpoint stayed private.');
    if(fixtureCredential) await verifyCredentialCopy(owner,reader,'인증 MCP '+tag);
  } finally { await reader.close(); await owner.close(); }
}
try {
  await check(1440);
  await check(390);
} finally {
  await browser.close();
  service.closeAllConnections();
  await new Promise<void>(resolve=>service.close(()=>resolve()));
  db().close();
}
