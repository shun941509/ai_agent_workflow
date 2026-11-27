import assert from 'node:assert/strict';
import { registerBrowserAccount } from './browser-account';
import {existsSync} from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {createBlock,type Graph} from '../src/domain';

const baseURL=process.env.STUDIO_TEST_URL;
if(!baseURL)throw new Error('격리 시험 서버 주소 STUDIO_TEST_URL이 필요합니다.');
const installed='C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(installed)?installed:undefined)});
const context=await browser.newContext({baseURL,viewport:{width:1500,height:960}});
async function api(action:string,data:object={}){
  const response=await context.request.post('/api/studio',{data:{action,data}});
  const payload=await response.json();assert.ok(response.ok(),action+' '+response.status()+' '+payload.error);return payload.data;
}
try{
  await registerBrowserAccount(context);
  const eventNode=createBlock('control.trigger',{id:'entry',title:'새 도착',config:{trigger:'event',event:'upload'}});
  const graph:Graph={nodes:[eventNode,createBlock('output.answer',{id:'result',title:'처리 결과',x:320,y:20})],edges:[
    {id:'f',from:'entry',to:'result',kind:'flow',input:'in',out:'next'},{id:'d',from:'entry',to:'result',kind:'data',input:'input',out:'value'}]};
  const project=await api('project.create',{title:'이벤트 브라우저 검증',graph});
  const {number}=await api('versions.save',{id:project.id,revision:project.revision});
  await api('versions.publish',{id:project.id,version:number,visibility:'private'});
  const page=await context.newPage();await page.goto('/?edit='+project.id);
  await page.getByRole('button',{name:'시험 실행',exact:true}).click({timeout:60000});
  const results=page.getByRole('tabpanel',{name:'실행 결과'});
  await results.getByRole('button',{name:'실행 설정',exact:true}).click();
  let failedRead='trigger.list';
  await page.route('**/api/studio',route=>route.request().postDataJSON().action===failedRead
    ? route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'설정을 읽을 수 없습니다.'})})
    : route.fallback());
  await page.getByRole('button',{name:'자동 시작',exact:true}).click();
  await expect(results.getByRole('alert')).toContainText('설정을 읽을 수 없습니다.');
  failedRead='';await results.getByRole('button',{name:'자동 시작 설정 다시 불러오기'}).press('Enter');
  await page.getByLabel('시작할 때 전달할 입력').fill('도착한 문서');
  await page.getByRole('button',{name:'게시한 버전으로 활성화'}).click();
  const tokenField=page.getByLabel('이벤트 토큰',{exact:false});
  const copyToken=page.getByRole('button',{name:'토큰 복사',exact:true});
  const copySuccess=results.getByText('토큰을 복사했습니다.',{exact:true});
  const showToken=results.getByRole('button',{name:'토큰 표시',exact:true});
  type ClipboardTestWindow=Window&{tokenWrite?:{resolve:()=>void;reject:()=>void};manualCopies?:number};
  await page.evaluate(()=>{
    const state=window as ClipboardTestWindow;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
      writeText(){return new Promise<void>((resolve,reject)=>{state.tokenWrite={resolve,reject};});},
    }});
  });
  const address=await page.getByLabel('이벤트 주소').inputValue();
  for(const outcome of ['resolve','reject'] as const){
    const previous=await tokenField.inputValue();
    await copyToken.click();
    await page.getByRole('button',{name:'자동 시작 해제'}).click();
    await page.getByRole('button',{name:'게시한 버전으로 활성화'}).click();
    await expect(tokenField).toBeVisible();
    assert.ok(await tokenField.inputValue()!==previous,'재활성화 시 토큰을 교체해야 합니다.');
    assert.equal(await page.getByLabel('이벤트 주소').inputValue(),address);
    await page.evaluate(async key=>{
      (window as ClipboardTestWindow).tokenWrite![key]();
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    },outcome);
    await expect(copySuccess).toHaveCount(0);
    await expect(showToken).toHaveCount(0);
    await expect(tokenField).toHaveAttribute('type','password');
  }
  await copyToken.click();
  await page.evaluate(()=>(window as ClipboardTestWindow).tokenWrite!.reject());
  await expect(showToken).toBeVisible();
  await expect(tokenField).toHaveAttribute('type','password');
  await showToken.click();
  await expect(tokenField).toHaveAttribute('type','text');
  await expect(tokenField).toBeFocused();
  assert.ok(await tokenField.evaluate((input:HTMLInputElement)=>input.selectionStart===0&&input.selectionEnd===input.value.length));
  await tokenField.evaluate(input=>{
    const state=window as ClipboardTestWindow;
    state.manualCopies=0;
    input.addEventListener('copy',event=>{event.preventDefault();state.manualCopies=(state.manualCopies??0)+1;},{once:true});
  });
  await tokenField.press('Control+c');
  assert.equal(await page.evaluate(()=>(window as ClipboardTestWindow).manualCopies),1);
  await results.getByRole('button',{name:'토큰 숨기기',exact:true}).click();
  await expect(tokenField).toHaveAttribute('type','password');
  await copyToken.click();
  await page.evaluate(()=>(window as ClipboardTestWindow).tokenWrite!.resolve());
  await expect(copySuccess).toBeVisible();
  const url=await page.getByLabel('이벤트 주소').inputValue(),token=await page.getByLabel('이벤트 토큰',{exact:false}).inputValue();
  assert.ok((await context.request.post(url,{data:{eventId:'untrusted'}})).status()===403);
  for(const attempt of [1,2]){
    const delivery=await context.request.post(url,{headers:{authorization:'Bearer '+token},data:{eventId:'delivery-44',input:'인계 문서'}});
    assert.equal(delivery.status(),202,'event delivery '+attempt);assert.ok((await delivery.json()).runId);
  }
  await expect.poll(async()=>{const runs=await api('run.list',{id:project.id});return runs.length===1?runs[0].output:'';},{timeout:20000}).toBe('인계 문서');
  await page.getByRole('button',{name:'기본 입력으로 이벤트 보내기'}).click();
  await expect(page.locator('.run-output')).toHaveText('도착한 문서',{timeout:20000});
  await page.getByRole('button',{name:'자동 시작',exact:true}).click();
  await page.getByRole('button',{name:'자동 시작 해제',exact:true}).click();await expect(page.getByRole('button',{name:'게시한 버전으로 활성화'})).toBeVisible();
  assert.equal((await context.request.post(url,{headers:{authorization:'Bearer '+token},data:{eventId:'late'}})).status(),403);
  const at=new Date(Date.now()+8500).toISOString();
  const scheduleGraph=structuredClone(graph);
  scheduleGraph.nodes[0].config={trigger:'schedule',schedule:at};
  const scheduler=await api('project.create',{title:'예약 시작 검증',graph:scheduleGraph});
  const sv=await api('versions.save',{id:scheduler.id,revision:scheduler.revision});
  await api('versions.publish',{id:scheduler.id,version:sv.number,visibility:'private'});
  await api('trigger.enable',{id:scheduler.id,version:sv.number,node:'entry',input:'예약한 문서'});
  await expect.poll(async()=>{const runs=await api('run.list',{id:scheduler.id});return runs.length===1?runs[0].output:'';},{timeout:30000}).toBe('예약한 문서');
  assert.equal((await api('trigger.list',{id:scheduler.id})).registrations[0].enabled,false);
  const recurring=structuredClone(scheduleGraph);
  recurring.nodes[0].config.schedule='매 60분';
  const timer=await api('project.create',{title:'예약 재개 검증',graph:recurring});
  const first=await api('versions.save',{id:timer.id,revision:timer.revision});
  const second=await api('versions.save',{id:timer.id,revision:timer.revision});
  const publishTimer=(version:number,expectedPublicVersion:number|null)=>api('versions.publish',{
    id:timer.id,version,visibility:'private',expectedVisibility:'private',expectedPublicVersion,
  });
  await publishTimer(first.number,null);
  await api('trigger.enable',{id:timer.id,node:'entry',input:'점검',version:first.number});
  await publishTimer(second.number,first.number);
  await publishTimer(first.number,second.number);
  await page.goto('/?edit='+timer.id);
  await page.getByRole('button',{name:'시험 실행',exact:true}).click();
  await results.getByRole('button',{name:'실행 설정',exact:true}).click();
  await page.getByRole('button',{name:'자동 시작',exact:true}).click();
  await expect(page.getByText(/지금 재개하면 첫 예약은/)).toBeVisible();
  await page.getByRole('button',{name:'게시한 버전으로 예약 재개'}).click();
  await expect(page.getByText(/다음 실행 .*한국 시각/)).toBeVisible();
  await page.getByRole('button',{name:'자동 시작 해제',exact:true}).click();
  const input=createBlock('input.user_request',{id:'entry',title:'질문',x:30,y:30});
  const childGraph={...graph,nodes:[input,graph.nodes[1]]};
  const child=await api('project.create',{title:'재사용할 개인 설계',graph:childGraph});
  const cv=await api('versions.save',{id:child.id,revision:child.revision});
  const call=createBlock('workflow.call',{id:'call',title:'개인 설계 호출',x:270,y:30});
  const callerGraph:Graph={nodes:[input,call,{...graph.nodes[1],x:540}],edges:[...graph.edges.map(e=>({...e,id:e.id+'1',to:'call'})),...graph.edges.map(e=>({...e,id:e.id+'2',from:'call'}))]};
  const caller=await api('project.create',{title:'상위 설계',graph:callerGraph});
  await page.goto('/?edit='+caller.id);await page.getByRole('button',{name:'개인 설계 호출 블록 속성',exact:true}).click();
  failedRead='versions.list';
  await page.getByLabel('호출할 Workflow').selectOption(child.id);
  await expect(page.getByRole('alert').filter({hasText:'설정을 읽을 수 없습니다.'})).toBeVisible();
  failedRead='';await page.getByRole('button',{name:'버전 다시 불러오기'}).press('Enter');
  await page.getByLabel('Workflow 버전').selectOption(String(cv.number));
  await expect.poll(async()=>(await api('project.open',{id:caller.id})).graph.nodes[1].config.version).toBe(String(cv.number));
  await page.getByRole('button',{name:'시험 실행',exact:true}).click();
  await page.getByLabel('Agent에게 보낼 질문').fill('하위 Workflow에 전달한 문장');await page.getByRole('button',{name:'질문 실행',exact:true}).click();
  await expect(page.locator('.run-output')).toHaveText('하위 Workflow에 전달한 문장',{timeout:20000});
  console.log('PASS owner event setup, authenticated/idempotent HTTP delivery, worker + revoke, one-shot schedule, nested version picker and real run.');
}finally{await context.close();await browser.close();}
