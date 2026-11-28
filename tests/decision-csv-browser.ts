import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createBlock,type Graph} from '../src/domain';

const baseURL=process.env.STUDIO_TEST_URL;
if(!baseURL)throw new Error('격리 시험 서버의 STUDIO_TEST_URL을 지정하세요.');
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(chrome)?chrome:undefined)});
const ctx=await browser.newContext({baseURL,viewport:{width:1440,height:900}});
const page=await ctx.newPage();
async function api(action:string,data:unknown={}){
  const response=await ctx.request.post('/api/studio',{data:{action,data}}),body=await response.json();
  assert.ok(response.ok(),action+' '+(body.error||response.status()));
  return body.data;
}
function flow(from:string,to:string,out='next'):Graph['edges'][number]{
  return {id:[from,out,to].join('-'),from,to,out,input:'in',kind:'flow'};
}
function data(from:string,to:string):Graph['edges'][number]{
  return {id:[from,'value',to].join('-'),from,to,out:'value',input:'input',kind:'data'};
}
const button=(name:string)=>page.getByRole('button',{name,exact:true});
try{
  await registerBrowserAccount(ctx);
  const draft='토요일에는 오후 4시에 닫습니다.';
  const notice='예약을 취소하면 대기 순번을 복구할 수 없습니다.';
  const graph:Graph={
    nodes:[
      createBlock('input.user_request',{id:'start',x:10,y:10}),
      createBlock('resource.context',{id:'draft',x:10,y:150,config:{content:draft}}),
      createBlock('review.human',{id:'review',x:240,y:10,config:{prompt:'토요일 마감 시각을 확인하세요.'}}),
      createBlock('approval.action',{id:'consent',title:'예약 취소 확인',x:460,y:10,config:{tool:'reservations.cancel',args:{reservationId:'R-501'}}}),
      createBlock('output.answer',{id:'end',x:680,y:10}),
    ],
    edges:[flow('start','review'),data('draft','review'),flow('review','consent'),data('review','consent'),
      flow('consent','end','approved'),flow('consent','end','rejected'),data('consent','end')],
  };
  const project=await api('project.create',{title:'검토와 예약 승인',graph});
  await page.goto('/?edit='+project.id);
  await button('목록으로 편집').click();
  const approvalBlock = page.locator('.ws-graph-list [data-canvas-block="consent"]');
  await expect(approvalBlock).toContainText('예약 취소 확인');
  await approvalBlock.click();
  await page.getByLabel('승인 안내',{exact:true}).fill(notice);
  await page.keyboard.press('Control+s');
  await expect.poll(async()=>((await api('project.open',{id:project.id})).graph as Graph).nodes.find(n=>n.id==='consent')?.config.prompt).toBe(notice);
  await page.reload();
  await button('시험 실행').click();
  await page.getByRole('textbox',{name:'Agent에게 보낼 질문'}).fill('주말 공지를 확인해 주세요.');
  await button('질문 실행').click();
  const card=page.locator('.run-wait');
  await expect(card.getByText('검토할 초안',{exact:true})).toBeVisible({timeout:15000});
  await expect(card.getByText(draft,{exact:true})).toBeVisible();
  await expect(card.getByText('토요일 마감 시각을 확인하세요.',{exact:true})).toBeVisible();
  await card.getByRole('textbox',{name:'검토 의견'}).fill('시각을 확인했습니다.');
  async function reopenWait(question:string){
    await page.reload();
    const results=page.getByRole('tabpanel',{name:'실행 결과'});
    await expect(results).toBeVisible();
    await results.getByRole('button',{name:'실행 기록',exact:true}).click();
    await page.locator('.run-sidebar').getByRole('region',{name:'응답 필요'}).getByRole('button',{name:new RegExp(question)}).click();
  }
  await reopenWait('주말 공지');
  await expect(card.getByRole('textbox',{name:'검토 의견'})).toHaveValue('시각을 확인했습니다.');
  await button('같은 실행 이어가기').click();
  await expect(card.getByText('예약 취소 작업을 승인할까요?',{exact:true})).toBeVisible({timeout:15000});
  await expect(card.getByText('R-501',{exact:true})).toBeVisible();
  await expect(card.getByText(notice,{exact:true})).toBeVisible();
  await button('거절').click();
  await expect(page.locator('.run-output')).toContainText('"approved": false',{timeout:15000});
  console.log('PASS saved approval notice, connected review draft, feedback and rejection through the worker');

  const child={nodes:[createBlock('input.user_request',{id:'source'}),createBlock('output.answer',{id:'result'})],
    edges:[flow('source','result'),data('source','result')]};
  const choice=await api('project.create',{title:'조사 지점 두 곳',graph:{
    nodes:[createBlock('input.user_request',{id:'branches'}),createBlock('agent.create_dynamic',{id:'pick',
      config:{role:'조사 담당',instruction:'선택한 지점의 이름을 반환합니다.',maxCreatedAgents:2,maxInFlightAgents:1},graph:child}),
      createBlock('output.answer',{id:'chosen'})],
    edges:[flow('branches','pick'),data('branches','pick'),flow('pick','chosen'),data('pick','chosen')],
  }});
  await page.goto('/?edit='+choice.id);await button('시험 실행').click();
  await page.getByRole('textbox',{name:'Agent에게 보낼 질문'}).fill('북쪽,남쪽,동쪽');
  await button('질문 실행').click();
  const north=card.getByRole('checkbox',{name:'북쪽',exact:true});
  await north.check();await reopenWait('북쪽,남쪽,동쪽');
  await expect(north).toBeChecked();
  await expect(card.getByRole('checkbox',{name:'남쪽',exact:true})).not.toBeChecked();
  await card.getByRole('checkbox',{name:'동쪽',exact:true}).check();
  await button('같은 실행 이어가기').click();
  await expect(page.locator('.run-answer-meta span')).toHaveText('완료',{timeout:15000});
  assert.deepEqual(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('studio.wait-draft.'))),[]);
  console.log('PASS reopened review and dynamic-agent selection drafts and cleared accepted replies');

  const table:Graph={
    nodes:[
      createBlock('file.input',{id:'file',x:0,y:0,config:{accept:'.csv'}}),
      createBlock('document.read',{id:'read',x:200,y:0}),
      createBlock('file.create',{id:'copy',x:400,y:0,config:{format:'csv',fileName:'운영표.csv'}}),
      createBlock('output.answer',{id:'out',x:600,y:0}),
    ],
    edges:[flow('file','read'),data('file','read'),flow('read','copy'),data('read','copy'),flow('copy','out'),data('copy','out')],
  };
  const sheet=await api('project.create',{title:'도서관 운영표 복사',graph:table});
  await page.goto('/?edit='+sheet.id);
  await button('시험 실행').click();
  const csv='지점,운영 안내\r\n"중앙,본관","1층 ""안내""\n데스크"';
  await page.getByLabel(/^입력 파일/).setInputFiles({name:'운영표.CSV',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.getByRole('textbox',{name:'Agent에게 보낼 질문'}).fill('표를 저장해 주세요.');
  await button('질문 실행').click();
  const download=page.waitForEvent('download');
  await button('운영표.csv 내려받기').click({timeout:15000});
  const file=await download;
  assert.equal(file.suggestedFilename(),'운영표.csv');
  assert.equal(await readFile(await file.path(),'utf8'),'"지점","운영 안내"\r\n"중앙,본관","1층 ""안내""\n데스크"');
  console.log('PASS uppercase CSV upload, automatic format selection and downloaded cells including comma, quotes and newline');
}finally{
  await browser.close();
}
