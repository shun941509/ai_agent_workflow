import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium, expect} from '@playwright/test';
import {createBlock, type Graph} from '../src/domain';
import {executeGraph} from '../src/engine';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw new Error('격리 시험 서버 주소가 필요합니다.');
const installed = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(installed) ? installed : undefined)});
const context = await browser.newContext({baseURL, viewport:{width:1440,height:920}});
async function api(action: string, data: object = {}) {
  const response = await context.request.post('/api/studio', {data:{action,data}});
  const payload = await response.json();
  assert.ok(response.ok(), action + ' ' + (payload.error || response.status()));
  return payload.data;
}
const page = await context.newPage();
const button = (name: string) => page.getByRole('button', {name,exact:true});
const read = async (id: string): Promise<Graph> => (await api('project.open',{id})).graph;
try {
  await registerBrowserAccount(context);
  const project = await api('project.create',{lesson:'intermediate'});
  const original: Graph = project.graph;
  const route = original.edges.find(e => e.out === 'category:규정')!;
  assert.ok(route);
  await page.goto('/?edit=' + project.id);
  await button('전체 보기').click();
  await button('규정과 개인 예약 구분 블록 속성').click();
  await button('규정 이름 변경').click();
  const renamed = page.getByRole('textbox', {name:'새 범주 이름',exact:true});
  await renamed.fill('예약');
  await expect(button('이름 적용')).toBeDisabled();
  await renamed.fill('이용 규정');
  await renamed.press('Enter');
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await read(project.id)).edges.find(e => e.id === route.id)?.out).toBe('category:이용 규정');
  await page.reload();
  await button('규정과 개인 예약 구분 블록 속성').click();
  await button('설계 검사').click();
  await expect(page.getByRole('dialog',{name:'설계 검사'})).toContainText('현재 설계가 실행 조건을 충족합니다.');
  await page.keyboard.press('Escape');
  const result = await read(project.id);
  assert.equal(result.edges.length, original.edges.length);
  assert.equal(result.edges.find(e => e.id === route.id)?.to, route.to);
  const classified = await executeGraph(result,{input:'도서 대출 규정',runId:'renamed-category'},{
    scopeModel:async () => ({text:'{"status":"in_scope"}'}),
    model:async request => ({text:request.instruction.includes('범주') ? '{"category":"이용 규정"}' : '{"status":"insufficient","references":[]}'}),
    tool:async () => {throw new Error('규정 문의에서 예약 도구를 호출했습니다.');},
  });
  assert.deepEqual(classified.checkpoint.steps['root/intent'].routes,['category:이용 규정']);
  assert.equal(classified.checkpoint.steps['root/search'].state,'done');
  await button('이용 규정 삭제').click();
  const removal = page.getByRole('dialog',{name:'분류 범주 삭제'});
  await expect(removal).toContainText('규정과 지점 안내문 검색');
  await expect(removal).toContainText('1개');
  await removal.getByRole('button',{name:'취소'}).click();
  await expect(button('이용 규정 삭제')).toBeFocused();
  await button('이용 규정 삭제').click();
  await removal.getByRole('button',{name:'범주 삭제',exact:true}).click();
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await read(project.id)).edges.map(e => e.id)).not.toContain(route.id);
  assert.deepEqual((await read(project.id)).edges, original.edges.filter(e => e.id !== route.id));
  await page.reload();
  await button('규정과 개인 예약 구분 블록 속성').click();
  await expect(button('이용 규정 이름 변경')).toHaveCount(0);

  for (const width of [1440,390]) {
    const draft = await api('project.create',{title:'첫 입력 연결', graph:{nodes:[createBlock('output.answer',{id:'answer',title:'질문 돌려주기'})],edges:[]}});
    await page.setViewportSize({width,height:880});
    await page.goto('/?edit=' + draft.id);
    const node = button('질문 돌려주기 블록 속성');
    await node.focus();
    await node.press('Enter');
    const receive = button('입력값 받기');
    const modal = page.getByRole('dialog',{name:'연결 추가'});
    await receive.press('Enter');
    await expect(modal).toContainText('입력값을 보낼 블록이 없습니다.');
    await page.keyboard.press('Escape');
    await expect(receive).toBeFocused();
    await receive.press('Enter');
    await modal.getByRole('button',{name:'취소',exact:true}).click();
    await expect(receive).toBeFocused();
    if (width === 1440) {
      await button('설계 검사').click();
      await page.getByRole('dialog',{name:'설계 검사'}).getByRole('button',{name:/입력값에 전달할 값을 연결/}).click();
      await expect(modal).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(receive).toBeFocused();
    }
    await receive.press('Enter');
    await modal.getByRole('button',{name:'사용자 입력 추가 및 연결',exact:true}).click();
    await expect(modal).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await read(draft.id)).edges.length).toBe(2);
    await page.reload();
    await page.setViewportSize({width:1440,height:880});
    await button('시험 실행').click();
    await page.getByRole('textbox',{name:'Agent에게 보낼 질문',exact:true}).fill('연결 확인');
    await button('질문 실행').click();
    await expect(page.locator('.run-output')).toHaveText('연결 확인',{timeout:20000});
  }
  console.log('분류 범주 이름 변경·삭제·취소와 입력 블록 연결을 데스크톱·모바일에서 검증했습니다.');
} finally {
  await browser.close();
}
