import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, type Locator } from '@playwright/test';
import { createBlock, type Graph } from '../src/domain';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});

// The port dot or wire path identifies the point the user is actually following.
async function screenPoint(anchor: Locator) {
  return anchor.evaluate(el => {
    if (el instanceof SVGPathElement) {
      const p = el.getPointAtLength(el.getTotalLength() / 2).matrixTransform(el.getScreenCTM()!);
      return {x:p.x, y:p.y};
    }
    const rect = el.getBoundingClientRect();
    return {x:rect.x + rect.width / 2, y:rect.y + rect.height / 2};
  });
}
async function staysInPlace(anchor: Locator, action: () => Promise<void>) {
  const before = await screenPoint(anchor);
  await action();
  await expect.poll(async () => {
    const after = await screenPoint(anchor);
    return Math.hypot(after.x - before.x, after.y - before.y);
  }).toBeLessThan(2);
}

async function verify(width: number) {
  const mobile = width === 390;
  const context = await browser.newContext({baseURL,viewport:{width,height:mobile ? 844 : 900},isMobile:mobile,hasTouch:mobile});
  try {
    const api = async (action: string, data: object = {}) => {
      const response = await context.request.post('/api/studio',{data:{action,data}});
      const result = await response.json();
      assert.ok(response.ok(),result.error);
      return result.data;
    };
    await registerBrowserAccount(context);
    const graph: Graph = {nodes:[
      createBlock('input.user_request',{id:'ask',title:'질문 받기',x:24,y:20}),
      createBlock('output.answer',{id:'reply',title:'답변 전달',x:340,y:150}),
    ],edges:[]};
    const project = await api('project.create',{title:'키보드 배율과 연결',graph});
    const read = () => api('project.open',{id:project.id});
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.goto('/?edit=' + project.id);
    if (mobile) await page.getByRole('button',{name:'캔버스로 보기',exact:true}).click();
    const canvas = page.locator('.ws-canvas');
    const world = canvas.locator('.ws-world');
    const toolbar = canvas.getByRole('group',{name:'캔버스 배율'});
    const button = (name:string) => toolbar.getByRole('button',{name,exact:true});
    const reset = toolbar.getByRole('button',{name:/100%로/});
    const displayedZoom = () => world.evaluate(el => Math.round(new DOMMatrix(getComputedStyle(el).transform).a * 100));
    async function hasZoom(percent: number) {
      await expect.poll(displayedZoom).toBe(percent);
      await expect(reset).toHaveText(percent + '%');
    }
    const ask = canvas.locator('[data-canvas-block="ask"]');
    const port = canvas.locator('[data-workflow-node="ask"] .ws-port-out');
    const undo = page.getByRole('button',{name:'실행 취소',exact:true});
    await ask.press('0');
    await hasZoom(100);
    await staysInPlace(ask,async () => { await page.keyboard.press('='); await hasZoom(120); });
    await expect(ask).toBeFocused();
    const viewport = page.viewportSize()!;
    await page.setViewportSize({...viewport,width:mobile ? 500 : 1290});
    await hasZoom(120);
    await page.setViewportSize(viewport);
    await hasZoom(120);
    await page.keyboard.press('-');
    await hasZoom(100);
    await page.keyboard.press('Shift+Equal');
    await hasZoom(120);
    await page.keyboard.press('NumpadSubtract');
    await hasZoom(100);
    await page.keyboard.press('NumpadAdd');
    await hasZoom(120);
    // Playwright maps the physical Numpad0 code to Insert with Num Lock off.
    const cdp = await context.newCDPSession(page);
    for (const type of ['keyDown','keyUp'] as const) {
      await cdp.send('Input.dispatchKeyEvent',{type,key:'0',code:'Numpad0',windowsVirtualKeyCode:96,location:3,isKeypad:true});
    }
    await hasZoom(100);
    const passthrough = await ask.evaluate(el => [
      {ctrlKey:true}, {metaKey:true}, {altKey:true}, {isComposing:true}, {keyCode:229},
    ].map(options => el.dispatchEvent(new KeyboardEvent('keydown',{key:'=',bubbles:true,cancelable:true,...options}))));
    assert.ok(passthrough.every(Boolean),'수정키 조합과 한글 조합 입력은 브라우저에 전달됩니다.');
    await hasZoom(100);
    await page.keyboard.press('/');
    const search = page.getByRole('searchbox',{name:'현재 블록 찾기'});
    await expect(search).toBeFocused();
    await page.keyboard.type('+=-0');
    await expect(search).toHaveValue('+=-0');
    await hasZoom(100);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape');
    await expect(ask).toBeFocused();
    await staysInPlace(ask,async () => {
      if (mobile) await button('확대').tap();
      else await button('확대').click();
      await hasZoom(120);
    });
    if (mobile) await reset.tap();
    else await reset.press('Enter');
    await hasZoom(100);
    await ask.focus();
    for (let i=0; i<5; i++) await page.keyboard.press('=');
    await hasZoom(200);
    await expect(button('확대')).toBeDisabled();
    for (let i=0; i<15; i++) await page.keyboard.press('-');
    await hasZoom(17);
    await expect(button('축소')).toBeDisabled();
    await button('캔버스에 맞추기').press('Enter');
    await expect(ask).toBeInViewport({ratio:0.999});
    await expect(canvas.locator('[data-canvas-block="reply"]')).toBeInViewport({ratio:0.999});
    await expect(undo).toBeDisabled();
    await expect(page.locator('.ws-save-badge')).toHaveText('저장됨');
    const beforeEdit = await read();
    assert.equal(beforeEdit.revision,project.revision);
    assert.deepEqual(beforeEdit.graph,project.graph);

    await ask.press('0');
    await ask.press('ArrowRight');
    await page.keyboard.press('Tab');
    await expect(port).toBeFocused();
    await staysInPlace(port.locator('.ws-output-dot'),async () => {
      await page.keyboard.press('=');
      await hasZoom(120);
    });
    await expect(port).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog',{name:'연결 추가'});
    const destination = dialog.getByRole('combobox',{name:'도착 블록'});
    await expect(dialog.getByRole('button',{name:'닫기'})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(destination).toBeFocused();
    await page.keyboard.press('End');
    await expect(destination).toHaveValue('reply');
    await page.keyboard.press('0');
    await hasZoom(120);
    const apply = dialog.getByRole('button',{name:'연결 적용'});
    for (let step = 0; step < 10 && !await apply.evaluate(el => el === document.activeElement); step++) {
      await page.keyboard.press('Tab');
    }
    await expect(apply).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await button('캔버스에 맞추기').press('Enter');
    await ask.press('Control+ArrowDown');
    const wire = canvas.locator('[data-canvas-wire]');
    await expect(wire).toBeFocused();
    const fit = await displayedZoom();
    await staysInPlace(wire.locator('.ws-channel'),async () => {
      await page.keyboard.press('=');
      await expect.poll(displayedZoom).toBeGreaterThan(fit);
    });
    await expect(wire).toBeFocused();
    const shots = process.env.STUDIO_SCREENSHOTS;
    if (shots) {
      mkdirSync(shots,{recursive:true});
      await page.screenshot({path:join(shots,'canvas-zoom-wire-' + width + '.png')});
    }
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await read()).graph.edges.length).toBeGreaterThan(0);
    const saved: Graph = (await read()).graph;
    assert.equal(saved.nodes[0].x,graph.nodes[0].x + 8);
    assert.ok(saved.edges.every(e => e.from === 'ask' && e.to === 'reply'));
    await page.keyboard.press('Control+z');
    await expect(wire).toHaveCount(0);
    if (mobile) {
      const wide = await api('project.create',{title:'넓은 캔버스 전체 보기',graph:{
        nodes:[graph.nodes[0],{...graph.nodes[1],x:500_000}],edges:[],
      }});
      await page.goto('/?edit=' + wide.id);
      await page.getByRole('button',{name:'캔버스로 보기',exact:true}).click();
      const overview = button('캔버스에 맞추기');
      await overview.press('Enter');
      await expect(reset).toHaveText('<0.1%');
      await expect(button('축소')).toBeDisabled();
      const scale = () => world.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);
      const beforeResize = await scale();
      await overview.press('-');
      await page.setViewportSize({...viewport,width:width + 160});
      await expect.poll(scale).toBeGreaterThan(beforeResize);
      const frame = (await canvas.boundingBox())!;
      const left = await screenPoint(ask);
      const right = await screenPoint(canvas.locator('[data-canvas-block="reply"]'));
      assert.ok(left.x >= frame.x && right.x <= frame.x + frame.width);
      await expect(button('축소')).toBeDisabled();
    }
    assert.deepEqual(errors,[]);
  } finally {
    await context.close();
  }
}
try {
  for (const width of [1440,390]) await verify(width);
  console.log('PASS desktop/mobile keyboard zoom, stable block/port/wire anchors, zoom limits, native input and saved keyboard placement and connection.');
} finally {
  await browser.close();
}
