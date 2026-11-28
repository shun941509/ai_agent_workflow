import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {chromium, expect, type BrowserContext, type Page} from '@playwright/test';
import {templates, type Graph} from '../src/domain';
import {registerBrowserAccount} from './browser-account';

const baseURL=process.env.STUDIO_TEST_URL;
assert.ok(baseURL, '격리 시험 서버 주소가 필요합니다.');
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(chrome)?chrome:undefined)});
const loan=templates.find(lesson=>lesson.id==='beginner')!;
const lost=templates.find(lesson=>lesson.id==='intermediate')!;
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
const panel=(page:Page)=>page.getByRole('tabpanel',{name:'실행 결과'});

async function api<T>(context:BrowserContext,action:string,data:object):Promise<T>{
  const response=await context.request.post('/api/studio',{data:{action,data}});
  const payload=await response.json();
  assert.ok(response.ok(),action+' '+payload.error);
  return payload.data;
}
function flow(from:string,to:string):Graph['edges'][number]{
  return {id:from+'-to-'+to,kind:'flow',from,to,out:'next',input:'in'};
}
function data(from:string,to:string):Graph['edges'][number]{
  return {id:from+'-value-'+to,kind:'data',from,to,out:'value',input:'input'};
}
type RecordSummary={id:string;conversation:string;state:string;output:string};
async function sourceAndConversation(context:BrowserContext,page:Page){
  // Pass the actual source to the lesson's file block in place of the model.
  const graph={nodes:loan.graph.nodes.filter(n=>['input','rules','file','output'].includes(n.id)),
    edges:[flow('input','file'),data('rules','file'),flow('file','output'),data('file','output')]};
  const {id}=await api<{id:string}>(context,'project.create',{lesson:loan.id,graph});
  const history=()=>api<RecordSummary[]>(context,'run.list',{id});
  await page.goto('/?edit='+id);
  await button(page,'시험 실행').click();
  const result=panel(page);
  const ask=async(limit:number)=>{
    const turn=result.locator('[data-run-turn]');
    const previous=await turn.count()?await turn.getAttribute('data-run-turn'):null;
    await result.getByRole('textbox',{name:/Agent에게 보낼 질문|같은 대화의 새 질문/}).fill(loan.question);
    await button(page,'질문 실행').click();
    if(previous)await expect(turn).not.toHaveAttribute('data-run-turn',previous);
    await expect(result.locator('.run-output')).toContainText(limit+'권',{timeout:15000});
    await expect(result.locator('.run-answer-meta')).toContainText('완료');
  };
  await ask(3);
  const [first]=await history();
  const openFirst=async()=>{
    await button(page,'실행 기록').click();
    await result.locator('.run-history').filter({hasText:/실행 1 ·/}).click();
  };
  await openFirst();
  await ask(3);
  await expect.poll(async()=>(await history()).length).toBe(2);
  assert.equal((await history())[0].conversation,first.conversation);
  await openFirst();
  await page.locator('[data-canvas-block="rules"]').click();
  const source=page.getByRole('textbox',{name:'자료 원문',exact:true});
  await source.fill((await source.inputValue()).replace('3권','5권'));
  await button(page,'변경 적용').click();
  await button(page,'시험 실행').click();
  await expect(result.getByRole('combobox',{name:'시험에 사용할 원문'})).toHaveValue('current');
  await ask(5);
  const [fresh]=await history();
  assert.notEqual(fresh.conversation,first.conversation);
  const pendingFile=page.waitForEvent('download');
  await button(page,'대출안내.txt 내려받기').click();
  assert.equal(await readFile(await (await pendingFile).path(),'utf8'),fresh.output);
  await openFirst();
  const sourceChoice=result.getByRole('combobox',{name:'시험에 사용할 원문'});
  await expect(sourceChoice).toHaveValue('current');
  await sourceChoice.selectOption('original');
  await ask(3);
  await expect.poll(async()=>(await history()).length).toBe(4);
  assert.equal((await history())[0].conversation,first.conversation);
}

async function resumeReply(context:BrowserContext,page:Page){
  // Reach the actual follow-up block directly, so this navigation check needs no model.
  const graph={nodes:lost.graph.nodes.filter(n=>['input','ask','after'].includes(n.id)),
    edges:[flow('input','ask'),data('input','ask'),flow('ask','after'),data('ask','after')]};
  const {id}=await api<{id:string}>(context,'project.create',{lesson:lost.id,graph});
  await page.goto('/?edit='+id);
  await button(page,'시험 실행').click();
  await button(page,'질문 실행').click();
  const result=panel(page), reply=result.getByRole('textbox',{name:'대기 중인 요청에 답하기'});
  await expect(reply).toBeVisible({timeout:15000});
  const [waiting]=await api<RecordSummary[]>(context,'run.list',{id});
  const draft='중앙점 안내문에는 분실물은 14일간 보관한다고 적혀 있습니다.';
  await reply.fill(draft);
  // A second waiting conversation must not replace the one this learner was editing.
  await api(context,'run.start',{id,mode:'test',input:'다른 지점의 분실물도 확인해 주세요.',requestKey:crypto.randomUUID()});
  for(const back of ['button','browser']){
    await button(page,'실습 안내').click();
    await expect(page.getByRole('heading',{name:'Workflow 설계 가이드'})).toBeVisible();
    if(back==='browser'){
      let firstAttempt=true;
      await page.route('**/api/studio',async route=>{
        const {action,data}=route.request().postDataJSON();
        if(firstAttempt && action==='run.get' && data.runId===waiting.id){
          firstAttempt=false;
          return route.fulfill({status:503,json:{error:'실행 기록에 다시 연결해 주세요.'}});
        }
        return route.fallback();
      });
    }
    if(back==='button')await button(page,'편집으로 돌아가기').click();
    else {
      await page.goBack();
      await expect(button(page,'질문 실행')).toBeDisabled();
      await button(page,'진행하던 실행 다시 열기').click();
    }
    await expect(reply).toHaveValue(draft);
    await expect(reply).toBeFocused();
    await expect(result.locator('[data-run-turn]')).toHaveAttribute('data-run-turn',waiting.id);
  }
  await button(page,'같은 실행 이어가기').click();
  await expect(result.locator('.run-output')).toHaveText(draft,{timeout:15000});
  const records=await api<RecordSummary[]>(context,'run.list',{id});
  assert.equal(records.length,2);
  assert.equal(records.find(r=>r.id===waiting.id)?.state,'completed');
  assert.equal(records.find(r=>r.id!==waiting.id)?.state,'waiting');
}

try{
  const width=1440;
  const context=await browser.newContext({baseURL,viewport:{width,height:940}});
  try{
    await registerBrowserAccount(context);
    const page=await context.newPage();
    await sourceAndConversation(context,page);
    await resumeReply(context,page);
    console.log('PASS '+width+'px · 초급 현재·이전 원문 시험, 중급 가이드 왕복 후 같은 회신 복원');
  }finally{await context.close();}
}finally{await browser.close();}
