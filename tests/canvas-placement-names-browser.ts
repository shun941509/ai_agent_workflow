import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { createBlock, type Graph } from '../src/domain';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 편집기 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});

async function tabTo(page:Page, target:Locator) {
  for (let i=0; i<45; i++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function exercise(width:number) {
  const session = await browser.newContext({baseURL, viewport:{width,height:900}});
  try {
    async function api(action:string,data:object={}) {
      const response = await session.request.post('/api/studio',{data:{action,data}});
      const result = await response.json();
      assert.ok(response.ok(),result.error);
      return result.data;
    }
    await registerBrowserAccount(session);
    const graph:Graph = {nodes:[
      createBlock('input.user_request',{id:'source',title:'질문',x:30,y:80}),
      createBlock('output.answer',{id:'first',title:'답변 보내기',x:460,y:40}),
      createBlock('output.answer',{id:'second',title:'답변 보내기',x:460,y:180}),
    ],edges:[]};
    const {id} = await api('project.create',{title:'같은 이름의 두 답변',graph});
    const read = async ():Promise<Graph> => (await api('project.open',{id})).graph;
    const page = await session.newPage();
    const errors:string[] = [];
    page.on('pageerror',e => errors.push(e.message));
    await page.goto('/?edit='+id);
    const canvas = page.locator('.ws-canvas');
    const block = (id:string) => canvas.locator('[data-canvas-block="'+id+'"]');
    const x = () => block('source').evaluate(el => parseFloat((el.closest('[data-workflow-node]') as HTMLElement).style.left));
    await canvas.waitFor();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button',{name:'캔버스로 바로 가기'})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(block('source')).toBeFocused();
    await expect(block('first')).toHaveText('1번 · 답변 보내기');
    await expect(block('second')).toHaveText('2번 · 답변 보내기');
    await page.keyboard.press('ArrowRight');
    await expect.poll(x).toBe(38);
    for (let i=0; i<74; i++) await page.keyboard.down('ArrowRight');
    await page.keyboard.up('ArrowRight');
    await expect.poll(x).toBe(630);
    await page.keyboard.press('Control+s');
    await expect.poll(async ()=>(await read()).nodes[0].x).toBe(630);
    await page.keyboard.press('Control+z');
    await expect.poll(x).toBe(38);
    await page.keyboard.press('Control+z');
    await expect.poll(x).toBe(30);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(x).toBe(38);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(x).toBe(630);
    await page.keyboard.press('Tab');
    const port = page.getByRole('button',{name:'질문에서 연결 추가'});
    await expect(port).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog',{name:'연결 추가'});
    const target = dialog.getByRole('combobox',{name:'도착 블록'});
    await tabTo(page,target);
    await expect(target.getByRole('option',{name:'1번 · 답변 보내기',exact:true})).toHaveCount(1);
    await expect(target.getByRole('option',{name:'2번 · 답변 보내기',exact:true})).toHaveCount(1);
    await page.keyboard.press('End');
    await expect(target).toHaveValue('second');
    await tabTo(page,dialog.getByRole('button',{name:'연결 적용'}));
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect.poll(async ()=>(await read()).edges.map(edge=>edge.to)).toEqual(['second','second']);
    await page.keyboard.press('/');
    const search = page.getByRole('searchbox',{name:'현재 블록 찾기'});
    await expect(search).toBeFocused();
    await page.keyboard.insertText('2번 · 답변 보내기');
    await expect(page.locator('.ws-current-nodes button')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(block('second')).toBeFocused();
    assert.deepEqual((await read()).nodes.map(n=>n.title),['질문','답변 보내기','답변 보내기']);
    assert.deepEqual(errors,[]);
  } finally { await session.close(); }
}

try {
  await exercise(1440);
  console.log('PASS keyboard hold undo/redo, numbered same-name blocks, search and saved destination on desktop.');
} finally { await browser.close(); }
