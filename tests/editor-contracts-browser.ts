import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {createBlock,type Graph} from '../src/domain';
import {registerBrowserAccount} from './browser-account';

const baseURL=process.env.STUDIO_TEST_URL;
if(!baseURL)throw Error('격리 시험 서버 주소가 필요합니다.');
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(chrome)?chrome:undefined)});
const ctx=await browser.newContext({baseURL,viewport:{width:1500,height:970}});
ctx.setDefaultTimeout(18000);
try{
  const user=await registerBrowserAccount(ctx),page=await ctx.newPage();
  const api=async(action:string,data={})=>{
    const res=await ctx.request.post('/api/studio',{data:{action,data}}),payload=await res.json();assert.ok(res.ok(),action+' '+payload.error);return payload.data;
  };
  const button=(name:string)=>page.getByRole('button',{name,exact:true});
  const projectAction=async(name:string)=>{await page.getByLabel('프로젝트 메뉴',{exact:true}).click();await button(name).click();};
  const rename=async(name:string)=>{await page.getByTitle('이름 변경',{exact:true}).click();const dlg=page.getByRole('dialog',{name:'Agent 이름 변경'});await dlg.getByLabel('이름',{exact:true}).fill(name);await dlg.getByRole('button',{name:'적용',exact:true}).click();};
  const project=await api('project.create',{lesson:'beginner'}),id=project.id;
  await page.goto('/?edit='+id);
  await button('목록으로 편집').click();
  await page.locator('[data-canvas-block="rules"]').click();
  const source=page.getByRole('textbox',{name:'자료 원문',exact:true});
  const draft='보관할 미적용 자료 원문';
  await source.fill(draft);
  const sourceBlock=page.locator('[data-canvas-block="rules"]');
  await sourceBlock.press('Delete');
  await expect.poll(async()=>((await api('project.open',{id})).graph as Graph).nodes.some(n=>n.id==='rules')).toBe(false);
  await button('실행 취소').click();
  await sourceBlock.click();await expect(source).toHaveValue(draft);
  console.log('PASS #59 delete, autosave and undo restore the edited source text');
  await source.fill(project.graph.nodes.find((n:{id:string})=>n.id==='rules').config.content);
  await rename('현재 초안과 같은 버전');
  await expect.poll(async()=>(await api('project.open',{id})).title).toBe('현재 초안과 같은 버전');
  const saved=await api('project.open',{id});
  const v=await api('versions.save',{id,revision:saved.revision});
  await projectAction('버전');await button('초안으로 복원').click();
  await expect(page.getByRole('dialog',{name:'버전 및 복구'})).toHaveCount(0);
  await button('실행 취소').click();await expect(page.getByTitle('이름 변경')).toHaveText(project.title);
  await expect.poll(async()=>(await api('project.open',{id})).title).toBe(project.title);
  console.log('PASS #60 restoring the same version retains undo history');
  const fresh=await api('project.open',{id});
  await api('project.save',{...fresh,title:'다른 탭의 변경'});
  await projectAction('공유 설정');
  await page.getByRole('dialog').getByLabel('공유 범위').selectOption('public');
  await button('선택한 버전 게시').click();
  await expect.poll(async()=>(await api('project.open',{id})).publicVersion).toBe(v.number);
  await expect(page.getByRole('dialog',{name:'Agent 공유 설정'}).getByRole('button',{name:'닫기',exact:true})).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Agent 공유 설정'})).toHaveCount(0);
  const staleSave=page.waitForResponse(response=>response.url().endsWith('/api/studio') && response.request().postDataJSON()?.action==='project.save');
  await rename('이전 탭에서 덮어쓰기');
  await page.keyboard.press('Control+s');
  const rejected=await staleSave;
  assert.equal(rejected.status(),409,JSON.stringify({submitted:rejected.request().postDataJSON().data.revision,expected:fresh.revision}));
  await expect(page.getByText('저장 실패',{exact:true})).toBeVisible({timeout:12000});
  assert.equal((await api('project.open',{id})).title,'다른 탭의 변경');
  console.log('PASS #57 publishing from a stale editor preserves the other tab draft');

  const simple=await api('project.create',{title:'빈 캔버스'});
  await page.goto('/?edit='+simple.id);
  await button('설계 가져오기').click();
  const importer=page.getByRole('dialog',{name:'설계 가져오기'}),body='큰 설계의 본문 '.repeat(120000)+'끝';
  const graph:Graph={nodes:[createBlock('resource.context',{id:'big',config:{content:body}}),
    createBlock('agent.team',{id:'team',graph:{nodes:[createBlock('knowledge.search',{id:'rag',config:{storeKey:'참고 자료',version:5}})],edges:[]}})],edges:[]};
  const file=Buffer.from(JSON.stringify({title:'대용량 설계',graph},null,2));assert.ok(file.length>2_000_000);
  await importer.locator('input[type=file]').setInputFiles({name:'agent.json',mimeType:'application/json',buffer:file});
  await importer.getByRole('button',{name:'현재 초안에 적용'}).click();
  await expect(importer.getByRole('alert')).toContainText('참고 자료 · 5판');
  await importer.getByRole('button',{name:'자료 없이 현재 초안에 적용'}).click();
  await expect.poll(async()=>(await api('project.open',{id:simple.id})).title).toBe('대용량 설계');
  assert.equal((await api('project.open',{id:simple.id})).graph.nodes[0].config.content,body);
  console.log('PASS #65,#66 import a >2MB design and report a missing nested collection by name and edition');

  const proposal=await api('project.create',{lesson:'beginner'});
  const ending='새 규칙에서 반드시 확인해야 하는 마지막 문장';
  await page.route('**/api/studio',async route=>{
    const {action,data}=route.request().postDataJSON();
    if(action==='bootstrap'){const res=await route.fetch(),json=await res.json();json.data.modelReady=true;return route.fulfill({json});}
    if(action!=='propose')return route.continue();
    if(data.prompt==='안녕하세요'){
      assert.equal(data.newAgent,true);assert.notEqual(data.requestKey,'legacy-receipt-key');
      return route.fulfill({json:{data:{clarification:true}}});
    }
    const changed:Graph=data.graph;
    changed.nodes.find(n=>n.type==='agent.task'||n.type==='ai.single_task')!.config.instruction='검토 '.repeat(180)+ending;
    return route.fulfill({json:{data:{graph:changed}}});
  });
  await page.goto('/?edit='+proposal.id);await button('AI 설계').click();
  await page.getByRole('textbox',{name:'만들거나 바꿀 일'}).fill('긴 규정으로 수정');
  await button('변경 제안 받기').click();
  await page.locator('.ws-diff summary').filter({hasText:'전체 변경 보기'}).first().click();
  await expect(page.locator('.ws-diff details[open] p')).toContainText(ending);
  console.log('PASS #63 the full proposed rule is visible before applying it');
  await page.goto('/?view=projects');
  await page.evaluate(async userId=>{
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([userId,null,'안녕하세요',{nodes:[],edges:[]}])));
    const payload=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
    sessionStorage.setItem('studio.proposal.home',JSON.stringify({payload,key:'legacy-receipt-key'}));
  },user.id);
  await button('새 Agent').click();await page.getByRole('button',{name:/한 문장으로 시작/}).click();
  await page.getByLabel('맡길 일과 원하는 결과').fill('안녕하세요');await button('초안 제안받기').click();
  await expect(page.getByLabel('어떤 Agent를 만들고 싶으세요?')).toBeVisible();
  console.log('PASS #64 a legacy home request starts a clarified design request');

  const waitGraph:Graph={nodes:[createBlock('input.user_request',{id:'q'}),createBlock('control.wait',{id:'w',config:{prompt:'분류를 입력하세요.'}}),createBlock('output.answer',{id:'a'})],edges:[
    {id:'start',from:'q',to:'w',kind:'flow',out:'next',input:'in'},{id:'end',from:'w',to:'a',kind:'flow',out:'next',input:'in'},
    {id:'out',from:'w',to:'a',kind:'data',out:'value',input:'input'}]};
  const comp=await api('project.create',{title:'회신 비교',graph:waitGraph});
  await api('versions.save',{id:comp.id,revision:comp.revision});
  const testcase=await api('cases.save',{id:comp.id,title:'분류',input:'요청',expected:'분류명',fixture:{}});
  await page.goto('/?edit='+comp.id);await button('시험 실행').click();await button('실행 설정').click();await button('시험 사례').click();
  await page.getByLabel('시험 사례 선택').selectOption(testcase.id);await page.getByLabel('비교할 버전').selectOption('1');
  await button('같은 사례로 두 번 시험').click();
  const pair=page.locator('.run-comparison');
  await expect(pair.locator('article')).toHaveCount(2);
  const reply=page.getByLabel('대기 중인 요청에 답하기');
  await reply.fill('첫 분류');await button('같은 실행 이어가기').click();
  await expect(pair).toContainText('첫 분류',{timeout:20000});
  await button('이 비교 실행에 회신').click();await reply.fill('둘째 분류');await button('같은 실행 이어가기').click();
  await expect(pair).toContainText('둘째 분류',{timeout:20000});await expect(pair).toContainText('첫 분류');
  console.log('PASS #56 two human replies complete both sides of a comparison without losing either run');

  const dataGraph:Graph={nodes:[createBlock('input.user_request',{id:'q'}),createBlock('output.answer',{id:'a'}),createBlock('resource.context',{id:'rules',config:{content:'기본 3권'}})],edges:[
    {id:'flow',from:'q',to:'a',kind:'flow',out:'next',input:'in'},{id:'result',from:'rules',to:'a',kind:'data',out:'value',input:'input'}]};
  const materials=await api('project.create',{title:'같은 첨부로 다시 시험',graph:dataGraph});
  const original=await api('versions.save',{id:materials.id,revision:materials.revision});
  const archivedInput=JSON.stringify({fileName:'분관.txt',content:'서쪽 자료',question:'이번 주 대출 한도'});
  const sample=await api('cases.save',{id:materials.id,title:'서쪽 분관',input:archivedInput,expected:'7권',fixture:{documents:{rules:'7권'}}});
  await page.goto('/?edit='+materials.id);await button('시험 실행').click();await button('실행 설정').click();
  await page.getByLabel('실행할 설계 버전').selectOption(String(original.number));await button('시험 사례').click();
  await page.getByLabel('시험 사례 선택').selectOption(sample.id);await button('저장된 사례로 시험').click();
  const output=page.locator('.run-output');
  await expect(output).toHaveText('7권',{timeout:20000});
  await button('같은 질문·첨부·시험 자료로 현재 초안 다시 시험').click();
  await expect.poll(async()=>(await api('run.list',{id:materials.id})).length).toBe(2);
  await expect(output).toHaveText('7권',{timeout:20000});
  const [retest,baseline]=await api('run.list',{id:materials.id});
  assert.equal(retest.version,null);assert.equal(baseline.version,1);assert.equal(retest.input,archivedInput);
  assert.notEqual(retest.conversation,baseline.conversation);
  await projectAction('공유 설정');await page.getByText('v1 시험 질문과 답변',{exact:true}).click();
  const evidence=page.getByRole('dialog',{name:'Agent 공유 설정'}).locator('details[open]');
  await expect(evidence).toContainText('이번 주 대출 한도 · 분관.txt');await expect(evidence).toContainText('7권');
  await page.keyboard.press('Escape');
  await api('project.save',{...materials,title:'다른 화면에서 수정'});
  await button('같은 질문·첨부·시험 자료로 현재 초안 다시 시험').click();
  await expect(page.getByText(/현재 초안이 다른 화면에서 변경되었습니다/)).toBeVisible();
  assert.equal((await api('run.list',{id:materials.id})).length,2);
  console.log('PASS #53,#54,#58 rerun with the original file and fixture, inspect selected version Q&A, reject a stale editor test');
}finally{await ctx.close();await browser.close();}
