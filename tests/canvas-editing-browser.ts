import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium, expect, type BrowserContext, type Locator, type Page} from '@playwright/test';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});

async function api(ctx:BrowserContext, action:string, data = {}) {
  const response = await ctx.request.post('/api/studio',{data:{action,data}});
  const result = await response.json();
  assert.ok(response.ok(), result.error);
  return result.data;
}
async function visibleInCanvas(block:Locator) {
  return block.evaluate(el => {
    const box = el.getBoundingClientRect();
    const frame = el.closest('.ws-canvas')!.getBoundingClientRect();
    return box.left >= frame.left && box.right <= frame.right && box.top >= frame.top && box.bottom <= frame.bottom;
  });
}
async function capture(page:Page, name:string) {
  const folder = process.env.STUDIO_SCREENSHOTS;
  if (!folder) return;
  mkdirSync(folder,{recursive:true});
  await page.screenshot({path:join(folder,name+'-'+page.viewportSize()!.width+'.png')});
}
async function exercise(width:number) {
  const mobile = width === 390;
  const context = await browser.newContext({baseURL,viewport:{width,height:mobile?844:width===768?1024:900},isMobile:width<=768,hasTouch:width<=768});
  try {
    await registerBrowserAccount(context);
    const project = await api(context,'project.create',{lesson:'intermediate'});
    const page = await context.newPage();
    const button = (name:string) => page.getByRole('button',{name,exact:true});
    await page.goto('/?edit='+project.id);
    const canvas = page.locator('.ws-canvas');
    if (mobile) await button('캔버스로 보기').click();
    const edited = canvas.locator('[data-canvas-block="answer"]');
    await expect(edited).toHaveAttribute('aria-pressed','true');
    const zoom = () => canvas.locator('.ws-world').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);
    await expect.poll(zoom).toBeGreaterThanOrEqual(0.9);
    const beforeZoom = await zoom();
    await button('자동 정렬').click();
    await expect(edited).toHaveAttribute('aria-pressed','true');
    await expect.poll(() => visibleInCanvas(edited)).toBe(true);
    await expect.poll(zoom).toBe(beforeZoom);
    await capture(page,'arranged-readable');
    await button('전체 보기').click();
    await expect.poll(zoom).toBeLessThan(beforeZoom);

    if (width === 1440) {
      const bounds = (await canvas.boundingBox())!;
      await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
      await page.mouse.wheel(2400,1000);
      await expect.poll(() => visibleInCanvas(edited)).toBe(false);
      await page.locator('.ws-current-nodes').getByRole('button',{name:'근거로 안내',exact:true}).click();
      await expect.poll(() => visibleInCanvas(edited)).toBe(true);
    }
    await button('목록으로 편집').click();
    const list = canvas.locator('.ws-graph-list');
    const edge = list.locator('[data-canvas-wire]').last();
    await edge.click();
    if (mobile) await page.keyboard.press('Escape');
    await expect(edge).toHaveAttribute('aria-pressed','true');
    const scroll = () => list.evaluate(el => el.scrollTop);
    await expect.poll(scroll).toBeGreaterThan(100);
    const offset = await scroll();
    await button('캔버스로 보기').click();
    await button('목록으로 편집').click();
    await expect.poll(scroll).toBeCloseTo(offset,0);
    await expect.poll(() => visibleInCanvas(edge)).toBe(true);

    const parallel = await api(context,'project.create',{lesson:'parallel'});
    await page.goto('/?edit='+parallel.id);
    if (!mobile) await button('목록으로 편집').click();
    const team = canvas.locator('[data-canvas-block="team"]');
    const enterTeam = async () => {
      await team.click();
      await button('팀 열기').click();
      await expect(canvas.locator('[data-canvas-block="split"]')).toBeVisible();
    };
    await enterTeam();
    const childWire = list.locator('[data-canvas-wire]').last();
    await childWire.click();
    if (mobile) await page.keyboard.press('Escape');
    const childOffset = await scroll();
    await button('상위 Workflow로').click();
    await expect(team).toBeFocused();
    await enterTeam();
    await expect(childWire).toHaveAttribute('aria-pressed','true');
    await expect.poll(scroll).toBeCloseTo(childOffset,0);

    const beginner = await api(context,'project.create',{lesson:'beginner'});
    await page.goto('/?edit='+beginner.id);
    if (mobile) await button('캔버스로 보기').click();
    const output = canvas.locator('[data-canvas-block="output"]');
    await output.focus();
    const start = await output.evaluate(el=>parseFloat((el.closest('[data-workflow-node]') as HTMLElement).style.left));
    for (let step=0; step<12; step++) await output.press('Shift+ArrowRight');
    await expect.poll(() => output.evaluate(el=>parseFloat((el.closest('[data-workflow-node]') as HTMLElement).style.left))).toBe(start+12*24);
    await expect.poll(() => visibleInCanvas(output)).toBe(true);
    const rules = canvas.locator('[data-canvas-block="rules"]');
    const nodes = canvas.locator('[data-canvas-block]');
    const wires = canvas.locator('[data-canvas-wire]');
    const nodeCount = await nodes.count(), wireCount = await wires.count();
    await rules.focus();
    await rules.press('Delete');
    await expect(nodes).toHaveCount(nodeCount-1);
    await page.keyboard.press('Control+z');
    await expect(rules).toBeFocused();
    await expect(rules).toHaveAttribute('aria-pressed','true');
    await expect(wires).toHaveCount(wireCount);
    await expect(page.locator('.ws-footer')).toContainText(/도서관 이용규정.*복구/);
    await capture(page,'undo-restored-block');
    await page.keyboard.press('Control+Shift+z');
    await expect(nodes).toHaveCount(nodeCount-1);
    await expect(page.locator('.ws-footer')).toContainText(/도서관 이용규정.*다시 삭제/);
    await page.keyboard.press('Control+z');
    await expect(rules).toBeFocused();
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await api(context,'project.open',{id:beginner.id})).graph.nodes.find((n:{id:string})=>n.id==='output').x).toBe(start+12*24);
  } finally { await context.close(); }
}
try {
  await exercise(1440);
  await exercise(768);
  await exercise(390);
  console.log('PASS 1440/768/390px canvas arrangement, palette reveal, keyboard panning, list return and deletion undo/redo.');
} finally { await browser.close(); }
