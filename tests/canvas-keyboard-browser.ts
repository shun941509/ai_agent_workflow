import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});

async function api(context:BrowserContext, action:string, data:object = {}) {
  const response = await context.request.post('/api/studio', {data:{action,data}});
  const result = await response.json();
  assert.ok(response.ok(), result.error);
  return result.data;
}

// Navigation starts from the current keyboard focus. No intermediate item is activated.
async function navigateGroup(page:Page, items:Locator) {
  assert.ok(await items.count() >= 3);
  await items.first().focus();
  await page.keyboard.press('PageDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('PageUp');
  await expect(items.nth(-2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('PageUp');
  await expect(items.first()).toBeFocused();
}

async function screenshot(page:Page, name:string) {
  const folder = process.env.STUDIO_SCREENSHOTS;
  if (!folder) return;
  mkdirSync(folder,{recursive:true});
  await page.screenshot({path:join(folder,name+'-'+page.viewportSize()!.width+'.png')});
}

async function check(width:number) {
  const context = await browser.newContext({baseURL, viewport:{width,height:900}});
  try {
    await registerBrowserAccount(context);
    const {id} = await api(context,'project.create',{lesson:'intermediate'});
    const snapshot = () => api(context,'project.open',{id});
    const before = await snapshot();
    const page = await context.newPage();
    const errors:string[] = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.goto('/?edit='+id);
    const canvas = page.locator('.ws-canvas');
    const blocks = canvas.locator('[data-canvas-block]');
    const wires = canvas.locator('[data-canvas-wire]');
    const button = (name:string) => page.getByRole('button',{name,exact:true});
    const help = page.getByRole('dialog',{name:'키보드 단축키',exact:true});
    const sourceBlock = canvas.locator('[data-canvas-block="hours"]');
    const search = page.getByRole('searchbox',{name:'현재 블록 찾기'});
    const enterCanvas = async () => {
      await canvas.waitFor();
      await page.keyboard.press('Tab');
      await expect(button('캔버스로 바로 가기')).toBeFocused();
      await page.keyboard.press('Enter');
    };
    await enterCanvas();
    await expect(canvas.locator('[data-canvas-block][aria-pressed="true"]')).toBeFocused();
    for (const list of [false,true]) {
      if (list) await button(list ? '목록으로 편집' : '캔버스로 보기').press('Enter');
      await blocks.first().focus();
      const selectedBlock = canvas.locator('[data-canvas-block][aria-pressed="true"]');
      const selected = await selectedBlock.getAttribute('data-canvas-block');
      await navigateGroup(page,blocks);
      await page.keyboard.press('End');
      await expect(selectedBlock).toHaveAttribute('data-canvas-block',selected!);
      await expect(blocks.last()).toBeFocused();
      await expect(blocks.last()).toBeInViewport();
      for (const [key,surface] of [['?',help],['/',search]] as const) {
        await page.keyboard.press(key);
        await expect(surface).toBeVisible();
        if (key === '/') await expect(surface).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(blocks.last()).toBeFocused();
        await expect(selectedBlock).toHaveAttribute('data-canvas-block',selected!);
      }
      const activeId = await blocks.last().getAttribute('data-canvas-block');
      await page.keyboard.press('Control+ArrowDown');
      const paths = page.getByRole('dialog',{name:'따라갈 연결선 선택'});
      if (await paths.isVisible()) await paths.locator('.ws-wire-choices button').first().press('Enter');
      if (!list) {
        const wire = canvas.locator('[data-canvas-wire]:focus');
        assert.ok([await wire.getAttribute('data-from'),await wire.getAttribute('data-to')].includes(activeId));
        const destination = await wire.getAttribute('data-to');
        await page.keyboard.press('Control+ArrowUp');
        await expect(canvas.locator('[data-canvas-block="'+destination+'"]')).toBeFocused();
      } else {
        await expect(canvas.locator('[data-canvas-wire]:focus')).toHaveCount(1);
      }
      await navigateGroup(page,wires);
      await page.keyboard.press('End');
      await page.keyboard.press('Control+ArrowDown');
      await expect(wires.last()).toBeFocused();
      await page.keyboard.press('Home');
      await expect(wires.first()).toBeFocused();
      if (!list) await screenshot(page,'canvas-wire-focus');
      await page.keyboard.press('?');
      await expect(help).toBeVisible();
      await expect(help).toContainText(/Page\s*Down/i);
      await page.keyboard.press('PageDown');
      await expect.poll(() => help.evaluate(el => el.contains(document.activeElement))).toBe(true);
      if (!list) await screenshot(page,'canvas-shortcuts');
      await page.keyboard.press('Escape');
      await expect(wires.first()).toBeFocused();
      const wireCount = await wires.count(), blockCount = await blocks.count();
      await page.keyboard.press('Delete');
      await expect(wires).toHaveCount(wireCount);
      await expect(blocks).toHaveCount(blockCount);
      await page.keyboard.press('Tab');
      await expect(wires.first()).not.toBeFocused();

      await wires.first().focus();
      await page.keyboard.press('/');
      await expect(search).toBeFocused();
      await search.fill('검색 결과 없음 721');
      await page.keyboard.press('Enter');
      await expect(search).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(wires.first()).toBeFocused();
      await page.keyboard.press('/');
      await expect(search).toBeFocused();
      await expect.poll(() => search.evaluate(el => {
        const input = el as HTMLInputElement;
        return input.selectionStart === 0 && input.selectionEnd === input.value.length;
      })).toBe(true);
      await search.fill('운영 안내');
      await page.keyboard.press('Enter');
      await expect(sourceBlock).toBeFocused();
      await expect(sourceBlock).toHaveAttribute('aria-pressed','true');
      await page.keyboard.press('Space');
      const source = page.getByRole('textbox',{name:'자료 원문',exact:true});
      await expect(source).toBeVisible();
      await expect.poll(() => page.locator('.ws-inspector').evaluate(el => el.contains(document.activeElement))).toBe(true);
      await source.focus();
      const original = await source.inputValue();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('?');
      await expect(source).toHaveValue(original+'?');
      await expect(help).toHaveCount(0);
      await page.keyboard.press('Backspace');
      await expect(source).toHaveValue(original);
      await page.keyboard.press('Escape');
      await expect(sourceBlock).toBeFocused();
      if (!list) {
        const position = () => sourceBlock.evaluate(el => (el.closest('[data-workflow-node]') as HTMLElement).style.cssText);
        const originalPosition = await position();
        await page.keyboard.press('Alt+ArrowDown');
        await sourceBlock.dispatchEvent('keydown',{key:'ArrowRight',isComposing:true});
        await sourceBlock.dispatchEvent('keydown',{key:'?',isComposing:true});
        await expect(help).toHaveCount(0);
        assert.equal(await position(), originalPosition);
        await page.keyboard.press('Tab');
        const port = canvas.locator('[data-workflow-node="hours"] .ws-port-out');
        await expect(port).toBeFocused();
        await expect(port).toBeInViewport();
        await page.keyboard.press('Enter');
        const connect = page.getByRole('dialog',{name:'연결 추가'});
        await expect(connect).toBeVisible();
        await page.keyboard.press('?');
        await expect(help).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(port).toBeFocused();
      }
    }
    const helpButton = button('키보드 단축키');
    await helpButton.press('Enter');
    await expect(help).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(helpButton).toBeFocused();
    await page.keyboard.press('Control+s');
    await expect(page.locator('.ws-footer')).toContainText('최신 설계를 저장했습니다.');
    const after = await snapshot();
    assert.deepEqual(after.graph,before.graph);
    assert.equal(after.revision,before.revision);
    const empty = await api(context,'project.create',{title:'빈 캔버스 탐색',graph:{nodes:[],edges:[]}});
    await page.goto('/?edit='+empty.id);
    await enterCanvas();
    await expect(button('블록 선택')).toBeFocused();
    assert.deepEqual(errors,[]);
  } finally {
    await context.close();
  }
}

try {
  await check(1440);
  console.log('PASS desktop canvas and list keyboard traversal, focus return, shortcut help, text editing and unchanged saved graph.');
} finally {
  await browser.close();
}
