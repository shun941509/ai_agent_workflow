import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { orderManagementHtml, reviewFollowupHtml } from '../src/domain/web-design-example';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined),
});
const directory = await mkdtemp(join(tmpdir(), 'studio-order-management-'));
const file = join(directory, 'order-management.html');
const followupFile = join(directory, 'order-review-followup.html');
try {
  await writeFile(file, orderManagementHtml, 'utf8');
  await writeFile(followupFile, reviewFollowupHtml, 'utf8');

  for (const width of [1280, 1440]) {
    const context = await browser.newContext({ offline: true, viewport: { width, height: 900 } });
    const page = await context.newPage();
    const unexpectedRequests: string[] = [];
    page.on('request', request => {
      if (/^https?:/.test(request.url())) unexpectedRequests.push(request.url());
    });
    await page.goto(pathToFileURL(file).href);
    const rows = page.getByRole('table').locator('tbody tr');
    await expect(rows).toHaveCount(3);
    const shipping = page.getByRole('button', { name: '배송 중', exact: true });
    await shipping.click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(['ORD-1002']);
    const search = page.getByRole('textbox', { name: '주문 검색' });
    await search.fill('없는상품');
    await expect(rows).toHaveCount(0);
    await expect(shipping).not.toHaveAttribute('aria-pressed', /.+/);
    await search.fill('');
    await expect(rows).toHaveCount(1);
    await page.getByRole('button', { name: '전체', exact: true }).press('Enter');
    await expect(rows).toHaveCount(3);

    await page.getByRole('button', { name: '반품 목록' }).press('Enter');
    await expect(rows).toHaveCount(2);
    await page.getByRole('button', { name: '접수', exact: true }).press('Space');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(['RET-2001']);
    await page.getByRole('button', { name: '환불 완료', exact: true }).click();
    await expect(rows).toContainText(['RET-2002']);
    await page.getByRole('button', { name: '전체', exact: true }).press('Enter');
    await expect(rows).toHaveCount(2);
    await page.getByRole('textbox', { name: '반품 검색' }).fill('없는상품');
    await expect(rows).toHaveCount(0);
    await page.getByRole('button', { name: '주문 목록' }).click();
    await expect(rows).toHaveCount(3);
    await page.setViewportSize({ width: width / 2, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await expect(page.getByRole('button', { name: '반품 목록' })).toBeInViewport();

    await page.goto(pathToFileURL(followupFile).href);
    const all = page.getByRole('button', {name:'전체', exact:true});
    await shipping.click();
    await expect(rows).toContainText(['ORD-1002']);
    await page.keyboard.press('Shift+Tab');
    await expect(all).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(rows).toHaveCount(3);
    // The expert starter must reproduce the finding that learners will fix.
    await expect(shipping).toHaveAttribute('aria-pressed', 'true');
    await expect(all).toHaveAttribute('aria-pressed', 'false');
    assert.deepEqual(unexpectedRequests, []);
    await context.close();
  }
  console.log('PASS order and return examples and the expert starter’s outstanding selection finding in Windows desktop and split views.');
} finally {
  await browser.close();
  if (existsSync(file)) await unlink(file);
  if (existsSync(followupFile)) await unlink(followupFile);
  await rmdir(directory);
}
