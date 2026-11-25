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
  await page.getByRole('button',{name:'자동 시작',exact:true}).click();
  await page.getByLabel('시작할 때 전달할 입력').fill('도착한 문서');
  await page.getByRole('button',{name:'게시한 버전으로 활성화'}).click();
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
  const input=createBlock('input.user_request',{id:'entry',title:'질문',x:30,y:30});
  const childGraph={...graph,nodes:[input,graph.nodes[1]]};
  const child=await api('project.create',{title:'재사용할 개인 설계',graph:childGraph});
  const cv=await api('versions.save',{id:child.id,revision:child.revision});
  const call=createBlock('workflow.call',{id:'call',title:'개인 설계 호출',x:270,y:30});
  const callerGraph:Graph={nodes:[input,call,{...graph.nodes[1],x:540}],edges:[...graph.edges.map(e=>({...e,id:e.id+'1',to:'call'})),...graph.edges.map(e=>({...e,id:e.id+'2',from:'call'}))]};
  const caller=await api('project.create',{title:'상위 설계',graph:callerGraph});
  await page.goto('/?edit='+caller.id);await page.getByRole('button',{name:'개인 설계 호출 블록 속성',exact:true}).click();
  await page.getByLabel('호출할 Workflow').selectOption(child.id);
  await page.getByLabel('Workflow 버전').selectOption(String(cv.number));
  await expect.poll(async()=>(await api('project.open',{id:caller.id})).graph.nodes[1].config.version).toBe(String(cv.number));
  await page.getByRole('button',{name:'시험 실행',exact:true}).click();
  await page.getByLabel('Agent에게 보낼 질문').fill('하위 Workflow에 전달한 문장');await page.getByRole('button',{name:'질문 실행',exact:true}).click();
  await expect(page.locator('.run-output')).toHaveText('하위 Workflow에 전달한 문장',{timeout:20000});
  console.log('PASS owner event setup, authenticated/idempotent HTTP delivery, worker + revoke, one-shot schedule, nested version picker and real run.');
}finally{await context.close();await browser.close();}
