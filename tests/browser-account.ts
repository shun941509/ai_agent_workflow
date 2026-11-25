import assert from 'node:assert/strict';
import type { BrowserContext } from '@playwright/test';

/** Register a disposable account on the isolated browser test server. */
export async function registerBrowserAccount(
  context: BrowserContext,
  credentials = { login: 'browser-' + crypto.randomUUID().slice(0, 18), password: crypto.randomUUID() }
): Promise<{ id: string; login: string }> {
  const response = await context.request.post('/api/studio', {
    data: { action: 'auth.signup', data: credentials },
  });
  const result = await response.json();
  assert.equal(response.status(), 200, '시험 계정 생성 실패: ' + (result.error ?? response.status()));
  return result.data;
}
