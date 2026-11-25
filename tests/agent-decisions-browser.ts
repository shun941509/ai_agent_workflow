import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {createBlock,connectBlocks,type Graph} from '../src/domain';
import {reviewProposal} from '../src/server/proposal';
import {registerBrowserAccount} from './browser-account';

const baseURL=process.env.STUDIO_TEST_URL;
assert.ok(baseURL,'격리 시험 서버가 필요합니다.');
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(chrome)?chrome:undefined)});
try{
  const ctx=await browser.newContext({baseURL,viewport:{width:1440,height:900}});
  await registerBrowserAccount(ctx);
  const api=async(action:string,data:object={})=>{
    const response=await ctx.request.post('/api/studio',{data:{action,data}});
    const body=await response.json();
    assert.ok(response.ok(),body.error);return body.data;
  };
  function linear(nodes:Graph['nodes']){
    const graph:Graph={nodes,edges:[]};
    nodes.slice(1).forEach((node,i)=>graph.edges.push(...connectBlocks(graph,nodes[i].id,node.id)));
    return graph;
  }
  const start=createBlock('input.user_request',{id:'question'}),end=createBlock('output.answer',{id:'result'});
  const proposed=linear([start,createBlock('agent.task',{id:'lookup',title:'예약 확인 담당',config:{goal:'내 예약을 조회',allowedTools:['reservations.list']}}),end]);
  const draft=reviewProposal(proposed,{nodes:[],edges:[]});
  const page=await ctx.newPage(),bootstrap=await api('bootstrap');
  await page.route('**/api/studio',async route=>{
    const {action}=route.request().postDataJSON();
    if(action==='bootstrap')return route.fulfill({json:{data:{...bootstrap,modelReady:true}}});
    if(action==='propose')return route.fulfill({json:{data:{graph:draft}}});
    return route.continue();
  });
  await page.goto('/');
  await page.getByLabel('만들고 싶은 Agent').fill('내 예약을 조회하는 Agent를 만들어 줘');
  await page.getByRole('button',{name:'AI 설계 제안 열기'}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'초안 제안받기'}).click();
  await expect(dialog.locator('.proposal-preview')).toContainText('도구 연결 필요 · reservations.list');
  await dialog.getByRole('button',{name:'초안으로 열어 수정'}).click();
  await expect(page.locator('[data-canvas-block="lookup"]').first()).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.ws-missing').getByText('도구 연결 필요 · reservations.list',{exact:true})).toBeVisible();
  await page.unroute('**/api/studio');
  const graph=linear([start,createBlock('tool.invoke',{id:'reserve',config:{tool:'reservations.create',args:{book:'브라우저 영수증 시험',branch:'중앙'}}}),
    createBlock('data.transform',{id:'after',config:{path:'없는 항목'}}),end]);
  const project=await api('project.create',{title:'승인 후 영수증',graph});
  await page.goto('/?edit='+project.id);
  await page.getByRole('button',{name:'시험 실행',exact:true}).click();
  const panel=page.getByRole('tabpanel',{name:'실행 결과'});
  await panel.getByLabel('Agent에게 보낼 질문').fill('테스트 도서를 예약해 주세요.');
  await panel.getByRole('button',{name:'질문 실행',exact:true}).click();
  await expect(panel.locator('.run-wait')).toContainText('브라우저 영수증 시험',{timeout:20000});
  await panel.getByRole('button',{name:'이 작업 승인',exact:true}).click();
  await expect(panel.locator('.run-output')).toContainText('처리가 확인된 작업',{timeout:20000});
  await expect(panel.locator('.run-output')).toContainText(/reservationId[\s\S]+[0-9a-f-]{36}/);
  await expect(panel.locator('.run-error')).toContainText('없는 항목');
  console.log('PASS 8 AI 제안에서 도구 연결 필요 표시와 편집 대상 이동, 11 실행 실패 답변에 승인한 작업 영수증 표시');
}finally{await browser.close();}
