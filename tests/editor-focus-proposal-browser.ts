import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium, expect, type BrowserContext} from '@playwright/test';
import type {Graph} from '../src/domain';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소가 필요합니다.');
const installed = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(installed) ? installed : undefined)});

async function api(context: BrowserContext, action: string, data = {}) {
  const response = await context.request.post('/api/studio', {data:{action,data}});
  const result = await response.json();
  assert.ok(response.ok(), action + ' ' + (result.error ?? ''));
  return result.data;
}

async function check(mobile: boolean) {
  const context = await browser.newContext({baseURL, viewport:mobile ? {width:390,height:844} : {width:1440,height:900}, isMobile:mobile, hasTouch:mobile});
  try {
    await registerBrowserAccount(context);
    const page = await context.newPage();
    const button = (name: string) => page.getByRole('button',{name,exact:true});
    const lesson = await api(context, 'project.create',{lesson:'intermediate'});
    await page.goto('/?edit=' + lesson.id);
    if (mobile) {
      await expect(page.locator('.ws-graph-list')).toBeVisible();
      await button('캔버스로 보기').click();
    }
    const canvas = page.locator('.ws-canvas');
    const selected = canvas.locator('.ws-node.ws-chosen');
    const scale = () => canvas.locator('.ws-world').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);
    await expect.poll(scale).toBeGreaterThanOrEqual(0.9);
    await expect(selected).toBeInViewport({ratio:0.98});
    const textSize = await selected.locator('strong').evaluate(el =>
      parseFloat(getComputedStyle(el).fontSize) * new DOMMatrix(getComputedStyle(el.closest('.ws-world')!).transform).a);
    assert.ok(textSize >= 12, 'Selected block label must be readable.');
    await button('전체 보기').click();
    await expect.poll(scale).toBeLessThan(0.8);

    const beginner = await api(context, 'project.create',{lesson:'beginner'});
    await page.goto('/?edit=' + beginner.id);
    const nodes = canvas.locator('button[data-canvas-block]');
    await expect(nodes).toHaveCount(beginner.graph.nodes.length);
    const first = nodes.first(), second = nodes.nth(1);
    const firstId = await first.getAttribute('data-canvas-block');
    const secondId = await second.getAttribute('data-canvas-block');
    await first.focus();
    for (let presses=0; presses<8 && !(await second.evaluate(el => el === document.activeElement)); presses++)
      await page.keyboard.press('Tab');
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute('aria-pressed','true');
    await page.keyboard.press('Delete');
    await expect(nodes).toHaveCount(beginner.graph.nodes.length-1);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => {
      const {graph} = await api(context,'project.open',{id:beginner.id}) as {graph:Graph};
      return graph.nodes.map(node => node.id);
    }).toEqual((beginner.graph as Graph).nodes.filter(n => n.id !== secondId).map(n => n.id));
    const saved = await api(context,'project.open',{id:beginner.id}) as {graph:Graph};
    assert.ok(saved.graph.nodes.some(node => node.id === firstId));
    assert.deepEqual(saved.graph.edges, (beginner.graph as Graph).edges.filter(e => e.from !== secondId && e.to !== secondId));
    await button('실행 취소').click();
    await expect(nodes).toHaveCount(beginner.graph.nodes.length);
    await first.focus();
    await button('설계 검사').focus();
    await page.keyboard.press('Delete');
    await expect(nodes).toHaveCount(beginner.graph.nodes.length);

    // Only the model is replaced. The editor still applies and saves through the real project API.
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const requests: string[] = [];
    await page.route('**/api/studio', async route => {
      const {action,data} = route.request().postDataJSON();
      if (action !== 'propose') return route.fallback();
      requests.push(data.prompt);
      if (data.prompt === '늦은 요청') await hold;
      const graph: Graph = data.graph;
      graph.nodes[0].title = data.prompt;
      await route.fulfill({json:{data:{graph}}});
    });
    await button('AI 설계').click();
    const dialog = page.getByRole('dialog',{name:'AI 설계 제안'});
    const prompt = dialog.getByRole('textbox',{name:'만들거나 바꿀 일'});
    const send = dialog.getByRole('button',{name:/변경 제안.*받기/});
    const apply = dialog.getByRole('button',{name:'캔버스에 적용'});
    await prompt.fill('월요일 휴관 안내');
    await send.click();
    await expect(apply).toBeEnabled();
    await prompt.fill('금요일 야간 개관 안내');
    await expect(apply).toHaveCount(0);
    await expect(button('변경 제안 다시 받기')).toBeEnabled();
    await prompt.fill('월요일 휴관 안내');
    await expect(apply).toHaveCount(0);
    await prompt.fill('늦은 요청');
    await send.click();
    await expect.poll(() => requests).toContain('늦은 요청');
    await prompt.fill('금요일 야간 개관 안내');
    await send.click();
    await expect(apply).toBeEnabled();
    const lateResponse = page.waitForResponse(response =>
      response.url().endsWith('/api/studio') && response.request().postDataJSON()?.data?.prompt === '늦은 요청');
    release();
    await lateResponse;
    await apply.click();
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await api(context,'project.open',{id:beginner.id})).graph.nodes[0].title)
      .toBe('금요일 야간 개관 안내');
    await button('AI 설계').click();
    await expect(apply).toHaveCount(0);
  } finally { await context.close(); }
}

try {
  await check(false);
  await check(true);
  console.log('PASS readable root canvas, overview, focused keyboard deletion and stale AI proposals on desktop and mobile.');
} finally { await browser.close(); }
