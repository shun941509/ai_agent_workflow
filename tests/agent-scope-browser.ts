import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, expect, type BrowserContext } from '@playwright/test';
import { registerBrowserAccount } from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw new Error('격리된 작업실 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined),
});

async function project(context: BrowserContext, action: string, data: object) {
  const response = await context.request.post('/api/studio', {data:{action, data}});
  const body = await response.json();
  assert.ok(response.ok(), body.error);
  return body.data;
}

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({baseURL, viewport:{width, height:850}});
    try {
      await registerBrowserAccount(context);
      const { id } = await project(context, 'project.create', {lesson:'intro'});
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      await page.goto('/?edit=' + id);
      const openSettings = async () => {
        await page.getByLabel('프로젝트 메뉴', {exact:true}).click();
        await page.getByRole('button', {name:'Agent 업무 범위', exact:true}).click();
        return page.getByRole('dialog', {name:'Agent 업무 범위'});
      };
      let settings = await openSettings();
      const originalPurpose = await settings.getByLabel('맡길 업무').inputValue();
      assert.ok(originalPurpose.trim());
      await expect(settings.getByLabel('응답 범위')).toHaveValue('dedicated');
      await settings.getByLabel('맡길 업무').fill(' ');
      await expect(settings.getByRole('button', {name:'적용'})).toBeDisabled();
      await settings.getByRole('button', {name:'닫기'}).click();
      settings = await openSettings();
      await expect(settings.getByLabel('맡길 업무')).toHaveValue(originalPurpose);
      await settings.getByLabel('응답 범위').selectOption('general');
      await settings.getByRole('button', {name:'적용'}).click();
      const readScope = async () => (await project(context, 'project.open', {id})).graph.agentScope;
      await expect.poll(async () => (await readScope())?.mode).toBe('general');
      await page.reload();
      settings = await openSettings();
      await expect(settings.getByLabel('응답 범위')).toHaveValue('general');
      await settings.getByLabel('응답 범위').selectOption('dedicated');
      await settings.getByLabel('맡길 업무').fill('도서관 운영시간과 대출 기간을 안내합니다.');
      await settings.getByRole('button', {name:'적용'}).click();
      await expect.poll(readScope).toEqual({mode:'dedicated', purpose:'도서관 운영시간과 대출 기간을 안내합니다.'});
      console.log('PASS Agent scope settings at ' + width + 'px');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
