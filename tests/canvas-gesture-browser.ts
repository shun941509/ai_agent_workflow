import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium, expect, type BrowserContext, type Locator, type Page} from '@playwright/test';
import {catalog, createBlock, type Graph} from '../src/domain';

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

async function expectFullTitle(block:Locator, title:string) {
  const label = block.locator('.ws-node-copy strong');
  await expect(label).toBeVisible();
  await expect(label).toHaveText(title);
  const overflow = await label.evaluate(el => {
    const text = el.getBoundingClientRect();
    // Compact labels can use the visible card up to the socket, even where the
    // output's larger invisible hit area starts. Respect each actual CSS clip.
    const canvas = el.closest('.ws-canvas')!.getBoundingClientRect();
    const clip = {left:canvas.left, right:canvas.right, top:canvas.top, bottom:canvas.bottom};
    for (let parent:Element|null = el; parent && !parent.classList.contains('ws-canvas'); parent = parent.parentElement) {
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
      if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, box.left);
        clip.right = Math.min(clip.right, box.right);
      }
      if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, box.top);
        clip.bottom = Math.min(clip.bottom, box.bottom);
      }
    }
    // Lay out an unclamped copy at the exact same width, font and fit scale.
    const full = el.cloneNode(true) as HTMLElement;
    Object.assign(full.style, {position:'absolute', visibility:'hidden', display:'block',
      width:getComputedStyle(el).width, height:'auto', maxHeight:'none', webkitLineClamp:'unset'});
    el.after(full);
    try {
      const range = document.createRange();
      range.selectNodeContents(full);
      return Math.max(full.getBoundingClientRect().height - text.height,
        ...Array.from(range.getClientRects(), line => line.width - text.width),
        clip.left - text.left, text.right - clip.right, clip.top - text.top, text.bottom - clip.bottom);
    } finally {
      full.remove();
    }
  });
  assert.ok(overflow <= 0.5, title + ' 제목이 전체 보기에서 ' + overflow.toFixed(1) + 'px 잘렸습니다.');
}

async function verifyDenseOverview(context:BrowserContext, page:Page) {
  const nodes = catalog.map((definition, i) => createBlock(definition.type, {
    id:'node-'+i, title:definition.name, x:40 + (i % 5) * 210, y:40 + Math.floor(i / 5) * 120,
  }));
  const material = nodes.find(node => node.type === 'resource.context')!;
  const task = nodes.find(node => node.type === 'ai.single_task')!;
  const file = nodes.find(node => node.type === 'file.input')!;
  const graph:Graph = {nodes, edges:[{id:'reference', kind:'reference', from:material.id, out:'ref', to:task.id, input:'context'}]};
  const project = await api(context,'project.create',{title:'모든 블록의 이름과 연결',graph});
  await page.goto('/?edit='+project.id);
  const button = (name:string) => page.getByRole('button',{name,exact:true});
  const world = page.locator('.ws-canvas .ws-world');
  const inspector = page.getByRole('complementary',{name:'속성 패널'});
  await button('전체 보기').click();
  await expect(world.locator('.ws-node-body')).toHaveCount(nodes.length);
  for (const node of nodes) await expectFullTitle(world.locator('[data-canvas-block="'+node.id+'"]'),node.title);

  const wire = world.locator('.ws-wire[data-from="'+material.id+'"][data-to="'+task.id+'"]');
  await wire.press('Enter');
  await expect(inspector).toContainText(material.title+' → '+task.title);
  await expect(button('전체 보기')).toBeVisible();
  await button('전체 보기').click();
  const fileBlock = world.locator('[data-canvas-block="'+file.id+'"]');
  await fileBlock.locator('strong').click();
  await expect(fileBlock).toHaveAttribute('aria-pressed','true');
  await fileBlock.press('Enter');
  await expect(inspector.getByLabel('이름',{exact:true})).toHaveValue(file.title);
  await button('전체 보기').click();
  const port = world.locator('[data-workflow-node="'+file.id+'"] .ws-port-out').first();
  await port.click();
  const connection = page.getByRole('dialog',{name:'연결 추가'});
  await expect(connection.getByText('출발 블록 · '+file.title,{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(connection).toBeHidden();
  await expect(button('실행 취소')).toBeDisabled();
  const saved = await api(context,'project.open',{id:project.id});
  assert.deepEqual(saved.graph,project.graph);
  assert.equal(saved.revision,project.revision);
}

async function verifySmallDesktop(context:BrowserContext, page:Page) {
  const project = await api(context,'project.create',{lesson:'beginner'});
  await page.setViewportSize({width:712,height:437});
  await page.goto('/?edit='+project.id);
  const rules = page.locator('.ws-canvas [data-canvas-block="rules"]');
  await expect(rules).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await rules.click();
  await rules.press('/');
  await expect(page.getByRole('searchbox',{name:'현재 블록 찾기'})).toBeFocused();
}

async function workbenchBounds(page:Page) {
  const bounds = await Promise.all(['.ws-palette','.ws-canvas','.ws-inspector'].map(selector =>
    page.locator(selector).boundingBox()));
  const [palette, canvas, inspector] = bounds;
  assert.ok(palette && canvas && inspector);
  return {palette, canvas, inspector};
}

async function verifyWideWorkbench(page:Page) {
  const {palette,canvas,inspector} = await workbenchBounds(page);
  assert.ok(palette.x + palette.width <= canvas.x + 1 && canvas.x + canvas.width <= inspector.x + 1);
  assert.ok(palette.y < canvas.y + canvas.height && inspector.y < canvas.y + canvas.height);
}

async function verify(width:number) {
  const context = await browser.newContext({baseURL,viewport:{width,height:900}});
  try {
    await registerBrowserAccount(context);
    const graph = {nodes:[createBlock('input.user_request',{id:'ask',x:20,y:20}),createBlock('output.answer',{id:'answer',x:20,y:200})],edges:[]};
    const project = await api(context,'project.create',{title:'캔버스 조작 시험',graph});
    const page = await context.newPage();
    await page.goto('/?edit=' + project.id);
    const canvasView = page.getByRole('button',{name:'캔버스로 보기',exact:true});
    await expect(canvasView).toHaveAttribute('aria-pressed','true',{timeout:30000});
    await verifyWideWorkbench(page);
    if (width === 1280) {
      await canvasView.focus();
      await page.setViewportSize({width:900,height:700});
      await expect(canvasView).toBeFocused();
      await expect.poll(() => page.evaluate(() => {
        const root = document.documentElement;
        const board = document.querySelector('.ws-workbench')!;
        return {document:root.scrollWidth - root.clientWidth, workbench:board.scrollWidth - board.clientWidth};
      })).toEqual({document:0,workbench:0});
      const {palette,canvas,inspector} = await workbenchBounds(page);
      assert.ok(palette.x + palette.width <= canvas.x + 1 && palette.y < canvas.y + canvas.height);
      assert.ok(inspector.y >= canvas.y + canvas.height - 1);
      assert.ok([palette,canvas,inspector].every(pane => pane.x >= 0 && pane.x + pane.width <= 901));
      const ask = page.locator('.ws-canvas [data-canvas-block="ask"]');
      await ask.press('/');
      await expect(page.getByRole('searchbox',{name:'현재 블록 찾기'})).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(ask).toBeFocused();
      await ask.press('Enter');
      await expect(page.getByRole('tab',{name:'속성',exact:true})).toBeFocused();
      const name = page.getByRole('tabpanel',{name:'속성',exact:true}).getByLabel('이름',{exact:true});
      for (let i = 0; i < 8 && !await name.evaluate(el => el === document.activeElement); i++) {
        await page.keyboard.press('Tab');
      }
      await expect(name).toBeFocused();
      await expect(name).toBeInViewport({ratio:1});
      await expect(canvasView).toHaveAttribute('aria-pressed','true');
      await page.setViewportSize({width,height:900});
      await verifyWideWorkbench(page);
    }
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
    await verifyDenseOverview(context,page);
    if (width === 1280) await verifySmallDesktop(context,page);
  } finally { await context.close(); }
}
try {
  for (const width of [1280,1440]) await verify(width);
  console.log('PASS desktop Escape discards block and wire drags, Enter opens connection options, and normal mouse drop saves a connection. All catalog labels fit the overview and its reference, file and output open the correct controls.');
} finally { await browser.close(); }
