import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {createBlock,connectBlocks,type Graph} from '../src/domain';
import {registerBrowserAccount} from './browser-account';

const baseURL=process.env.STUDIO_TEST_URL;
assert.ok(baseURL,'격리 시험 서버가 필요합니다.');
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(chrome)?chrome:undefined)});
try{
  const ctx=await browser.newContext({baseURL,viewport:{width:1440,height:900}});
  await registerBrowserAccount(ctx);
  const api=async(action:string,data:unknown)=>{
    const response=await ctx.request.post('/api/studio',{data:{action,data}});
    const payload=await response.json();assert.ok(response.ok(),action+' '+payload.error);return payload.data;
  };
  const graph:Graph={nodes:[createBlock('file.input',{id:'file',config:{accept:'.md'}}),
    createBlock('document.read',{id:'read'}),createBlock('output.answer',{id:'answer',config:{format:'markdown'}})],edges:[]};
  graph.edges.push(...connectBlocks(graph,'file','read'),...connectBlocks(graph,'read','answer'));
  const project=await api('project.create',{title:'전송 복구 시험',graph});
  const v=await api('versions.save',{id:project.id,revision:project.revision});
  await api('versions.publish',{id:project.id,version:v.number,visibility:'public'});
  const viewer=await browser.newContext({baseURL,viewport:{width:1440,height:900}});
  await registerBrowserAccount(viewer);
  const page=await viewer.newPage();
  const open=async()=>{await page.goto('/?agent='+project.id);await page.getByRole('button',{name:'Agent 사용',exact:true}).click();};
  await open();
  const panel=page.getByRole('dialog',{name:project.title}),field=panel.locator('.run-compose textarea');
  async function draft(name:string){
    await field.fill(name+' 질문');
    await panel.getByLabel(/^입력 파일/).setInputFiles({name:name+'.md',mimeType:'text/markdown',buffer:Buffer.from('# '+name+' 결과\n\n**확인됨**')});
    await expect(panel.getByRole('button',{name:name+'.md 첨부 해제'})).toBeVisible();
  }
  let release!:()=>void,start!:()=>void;
  const delay=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>start=resolve);
  let failed=false,firstKey='';
  await page.route('**/api/studio',async route=>{
    const body=route.request().postDataJSON();
    if(body.action==='run.start'&&!failed){
      failed=true;firstKey=body.data.requestKey;start();await delay;
      await route.fulfill({status:503,json:{error:'시험용 접수 실패'}});return;
    }
    await route.continue();
  });
  await draft('첫째');await panel.getByRole('button',{name:'질문 실행',exact:true}).click();await started;
  await draft('둘째');release();
  await expect(panel.getByRole('button',{name:'이 질문 다시 보내기'})).toBeVisible();
  await open();
  await expect(field).toHaveValue('둘째 질문');
  await expect(panel.getByRole('button',{name:'둘째.md 첨부 해제'})).toBeVisible();
  await expect(panel.locator('.run-submission')).toContainText('첫째.md');
  const retried=page.waitForRequest(req=>req.url().endsWith('/api/studio')&&req.postDataJSON()?.action==='run.start');
  await panel.getByRole('button',{name:'이 질문 다시 보내기'}).click();
  assert.equal((await retried).postDataJSON().data.requestKey,firstKey);
  await expect(panel.locator('.run-output').getByRole('heading',{name:'첫째 결과'})).toBeVisible({timeout:20000});
  await expect(panel.locator('.run-output strong')).toHaveText('확인됨');
  await expect(field).toHaveValue('둘째 질문');
  await expect(panel.locator('.run-submission')).toHaveCount(0);
  console.log('PASS 35 실패한 첫 질문·첨부와 다음 초안이 새로고침 후 독립적으로 복구되고 동일한 접수 번호로 재전송됨');
  console.log('PASS 51 Markdown 답변의 제목과 강조를 브라우저에서 확인');
  const prompts:Graph={nodes:[
    createBlock('input.user_request',{id:'start'}),createBlock('control.parallel',{id:'split'}),
    createBlock('input.form',{id:'untimed',config:{prompt:'일반 질문'}}),
    createBlock('input.form',{id:'timed',config:{prompt:'기한 질문',replyTimeoutMinutes:10}}),
    createBlock('output.answer',{id:'a'}),createBlock('output.answer',{id:'b'}),
  ],edges:[]};
  for(const [from,to] of [['start','split'],['split','untimed'],['split','timed'],['untimed','a'],['timed','b']])
    prompts.edges.push(...connectBlocks(prompts,from,to));
  const questions=await api('project.create',{title:'병렬 회신 화면',graph:prompts});
  const edition=await api('versions.save',{id:questions.id,revision:questions.revision});
  await api('versions.publish',{id:questions.id,version:edition.number,visibility:'public'});
  await page.goto('/?agent='+questions.id);
  await page.getByRole('button',{name:'Agent 사용',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:questions.title}),cards=dialog.locator('.run-wait');
  await dialog.getByLabel('Agent에게 보낼 질문').fill('질문 시작');
  await dialog.getByRole('button',{name:'질문 실행',exact:true}).click();
  await expect(cards).toHaveCount(2,{timeout:20000});
  await expect(cards.filter({hasText:'일반 질문'}).locator('time')).toHaveCount(0);
  const timed=cards.filter({hasText:'기한 질문'});
  await expect(timed.locator('time')).toBeVisible();
  await timed.getByRole('textbox').fill('먼저 회신');
  await timed.getByRole('button',{name:'같은 실행 이어가기'}).click();
  await expect(cards).toHaveCount(1,{timeout:20000});
  await cards.getByRole('textbox').fill('나중 회신');
  await cards.getByRole('button',{name:'같은 실행 이어가기'}).click();
  await expect(dialog.locator('.run-output')).toContainText('먼저 회신',{timeout:20000});
  await expect(dialog.locator('.run-output')).toContainText('나중 회신');
  console.log('PASS 36 두 질문의 개별 마감 표시 및 시간 제한 질문부터 회신');
}finally{await browser.close();}
