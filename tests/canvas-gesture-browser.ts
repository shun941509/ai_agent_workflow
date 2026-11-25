import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium, expect, type BrowserContext, type Locator} from '@playwright/test';
import {createBlock} from '../src/domain';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소가 필요합니다.');
const installed = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(installed) ? installed : undefined)});

async function api(context:BrowserContext, action:string, data = {}) {
  const response = await context.request.post('/api/studio',{data:{action,data}});
  const result = await response.json();
  assert.ok(response.ok(),action + ' ' + (result.error ?? ''));
  return result.data;
}
async function center(target:Locator) {
  const box = await target.boundingBox();
  assert.ok(box);
  return {x:box.x + box.width / 2, y:box.y + box.height / 2};
}
async function verify(width:number) {
  const mobile = width < 1000;
  const context = await browser.newContext({baseURL,viewport:{width,height:mobile ? 844 : 900},hasTouch:mobile,isMobile:mobile});
  try {
    await registerBrowserAccount(context);
    const graph = {nodes:[createBlock('input.user_request',{id:'ask',x:20,y:20}),createBlock('output.answer',{id:'answer',x:20,y:200})],edges:[]};
    const project = await api(context,'project.create',{title:'캔버스 조작 시험',graph});
    const page = await context.newPage();
    await page.goto('/?edit=' + project.id);
    const block = page.locator('[data-canvas-block="ask"]');
    const output = page.locator('[data-workflow-node="ask"] .ws-port-out');
    const target = page.locator('[data-canvas-block="answer"]');
    await expect(output).toBeVisible();
    const undo = page.getByRole('button',{name:'실행 취소',exact:true});
    const state = () => api(context,'project.open',{id:project.id});
    const unchanged = async () => {
      await expect(undo).toBeDisabled();
      await expect(page.locator('.ws-save-badge')).toHaveText('저장됨');
      await expect(page.locator('dialog:modal')).toHaveCount(0);
      const saved = await state();
      assert.deepEqual(saved.graph,project.graph);
      assert.equal(saved.revision,project.revision);
    };
    if (mobile) {
      const cdp = await context.newCDPSession(page);
      const camera = () => page.locator('.ws-world').evaluate(el => {
        const m = new DOMMatrix(getComputedStyle(el).transform);
        return {zoom:m.a, x:m.e, y:m.f};
      });
      for (const first of [block,output]) {
        const old = await camera();
        const a = {...await center(first),id:1};
        const b = {x:a.x - 22,y:a.y + 55,id:2};
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,y:a.y + 6}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,y:a.y + 6},b]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,y:a.y - 14},{...b,y:b.y + 9}]});
        await expect.poll(async () => (await camera()).zoom).toBeGreaterThan(old.zoom);
        const pinched = await camera();
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,x:a.x - 18,y:a.y - 14},{...b,x:b.x - 18,y:b.y + 9}]});
        await expect.poll(async () => Math.round((await camera()).x - pinched.x)).toBe(-18);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await unchanged();
        await expect(page.locator('.ws-editor')).toHaveAttribute('data-pane','canvas');
        await page.getByRole('button',{name:'전체 보기'}).click();
      }
      const start = {...await center(block),id:1};
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...start,y:start.y + 22}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await expect(undo).toBeEnabled();
      await page.keyboard.press('Control+s');
      await expect.poll(async () => (await state()).graph.nodes[0].y).toBeGreaterThan(20);
      await block.tap();
      if (width === 390) await expect(page.getByRole('dialog',{name:'속성 패널'})).toBeVisible();
    } else {
      for (const dragSource of [block, output]) {
        const from = await center(dragSource), to = await center(target);
        await page.mouse.move(from.x,from.y);
        await page.mouse.down();
        await page.mouse.move(to.x,to.y,{steps:5});
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await unchanged();
      }
      await output.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog',{name:'연결 추가'})).toBeVisible();
      await page.keyboard.press('Escape');
      const from = await center(output), to = await center(target);
      await page.mouse.move(from.x,from.y);
      await page.mouse.down();
      await page.mouse.move(to.x,to.y,{steps:5});
      await page.mouse.up();
      await page.keyboard.press('Control+s');
      await expect.poll(async () => (await state()).graph.edges.length).toBeGreaterThan(0);
    }
  } finally { await context.close(); }
}
try {
  await verify(390);
  await verify(768);
  await verify(1440);
  console.log('PASS two-finger pinch and pan preserve the saved graph, Escape discards block and wire drags, normal tap and drop work.');
} finally { await browser.close(); }
