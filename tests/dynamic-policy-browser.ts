import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { registerBrowserAccount } from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
assert.ok(baseURL && ['localhost','127.0.0.1','[::1]'].includes(new URL(baseURL).hostname));
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});
try {
  const width = 1440;
  const context = await browser.newContext({baseURL, viewport:{width,height:900}});
  try {
    await registerBrowserAccount(context);
    const page = await context.newPage();
    await page.goto('/?view=templates&lesson=dynamic');
    const setup = page.getByRole('dialog');
    await setup.getByLabel('총 생성 한도').selectOption('2');
    await setup.getByLabel('동시 실행 한도').selectOption('1');
    await setup.getByLabel('지점 조사 실패 시').selectOption('stop');
    await setup.getByRole('button',{name:'내 사본으로 시작',exact:true}).click();
    // Exercise the selection and failure policy on this disposable copy, including on a model-free server.
    await page.getByLabel('프로젝트 메뉴',{exact:true}).click();
    await page.getByRole('button',{name:'Agent 업무 범위',exact:true}).click();
    const scope=page.getByRole('dialog',{name:'Agent 업무 범위'});
    await scope.getByLabel('응답 범위').selectOption('general');
    await scope.getByRole('button',{name:'적용',exact:true}).click();
    await page.getByRole('button',{name:'시험 실행',exact:true}).click();
    const panel = page.getByRole('tabpanel',{name:'실행 결과'});
    await panel.getByRole('button',{name:'질문 실행',exact:true}).click();
    const choices = panel.getByRole('group',{name:'이번 실행에 포함할 항목'});
    const central = choices.getByRole('checkbox',{name:'중앙도서관'});
    await central.check();
    await choices.getByRole('checkbox',{name:'강변도서관'}).check();
    await expect(choices.getByRole('listitem')).toHaveText(['1차 · 중앙도서관','2차 · 강변도서관']);
    await central.uncheck();
    await central.check();
    await expect(choices.getByRole('listitem')).toHaveText(['1차 · 강변도서관','2차 · 중앙도서관']);
    await panel.getByRole('button',{name:'같은 실행 이어가기'}).click();
    await expect(panel.locator('.run-error')).toHaveText(/중단 정책.*1차.*강변도서관.*근거 부족/);
    await page.reload();
    await expect(page.locator('.ws-editor')).toBeVisible();
    if (!(await panel.isVisible())) await page.getByRole('button',{name:'시험 실행',exact:true}).click();
    await panel.getByRole('button',{name:'실행 기록',exact:true}).click();
    await panel.getByRole('button',{name:/실행 1 · 실패/}).click();
    await panel.locator('summary').filter({hasText:'실행 경로'}).click();
    await expect(panel.getByText('선택 후 미시작 · 중앙도서관',{exact:true})).toBeVisible();
    await expect(panel.getByText('선택 제외 · 호수도서관, 숲도서관',{exact:true})).toBeVisible();
    await page.locator('[data-canvas-block="spawn"]').click();
    const settings = page.getByRole('tabpanel',{name:'속성'});
    await settings.getByText('고급 설정',{exact:true}).click();
    const total = settings.getByLabel('전체 생성 상한');
    const concurrency = settings.getByLabel('동시 실행 상한');
    await total.fill('4');
    await concurrency.fill('3');
    await expect(settings.getByText(/자유 실험 · 현재 전체 4명, 동시 3명/)).toContainText('‘동시 실행 상한’을 2명');
    await expect(concurrency).toHaveValue('3');
    await page.getByRole('button',{name:'실습 안내',exact:true}).click();
    await page.getByText('제공된 예시와 완료 기준 보기',{exact:true}).click();
    await expect(page.getByRole('listitem').filter({hasText:'자유 실험 · 현재 전체 4명, 동시 3명'})).toBeVisible();
    await page.getByRole('button',{name:'편집으로 돌아가기',exact:true}).click();
    await page.locator('[data-canvas-block="spawn"]').click();
    if (!(await concurrency.isVisible())) await settings.getByText('고급 설정',{exact:true}).click();
    await expect(concurrency).toHaveValue('3');
    await concurrency.fill('2');
    await expect(settings.getByText(/자유 실험 ·/)).toHaveCount(0);
    console.log(width+'px · 지점 선택 순서 변경, 중단 이력 재열기, 자유 실험과 기본 범위 복귀');
  } finally { await context.close(); }
} finally { await browser.close(); }
