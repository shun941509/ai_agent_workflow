import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect, type Page} from '@playwright/test';
import {inspectionExampleHtml} from '../src/domain/equipment-inspection-example';
import {verifyInspectionReceipt} from '../src/domain/inspection-receiver.mjs';
import type {Graph} from '../src/domain/types';
import {registerBrowserAccount} from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
assert.ok(baseURL, '격리된 작업실 주소를 지정하세요.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});
const lesson = 'equipment-inspection-web';
const title = '검수가 끝나면 장비 반납 목록은 어떻게 바뀔까?';
const skills = ['test-driven-development', 'find-docs', 'frontend-design', 'web-artifacts-builder', 'webhook-handler-patterns', 'skill-creator'];
const roles = ['문서 담당','디자인 담당','개발 담당','UI 담당','백엔드 담당','도구 제작 담당'];
const runWorker = process.env.STUDIO_INSPECTION_WEB_RUN === '1';

async function copyEvidence(example:Page,width:number) {
  await example.setViewportSize({width:width/2,height:900});
  const input = example.getByRole('textbox',{name:'검수 알림',exact:true});
  const event = JSON.parse(await input.inputValue());
  if (width===1440) {
    event.equipmentId = 'B-08';
    event.eventId = 'inspection-browser-B08';
    await input.fill(JSON.stringify(event,null,2));
  }
  const submit = example.getByRole('button',{name:'알림 입력',exact:true});
  await submit.click();
  await submit.press('Enter');
  await expect(example.getByRole('status')).toContainText('중복 알림');
  await example.getByText('검증 기록 보기',{exact:true}).click();
  const receipt = await example.getByRole('textbox',{name:'검증 기록',exact:true}).inputValue();
  assert.equal(verifyInspectionReceipt(JSON.parse(receipt)),true);
  await example.getByRole('button',{name:'검증 기록 복사'}).press('Enter');
  await expect(example.locator('#copy-note')).toContainText('복사했습니다');
  return receipt;
}

async function completePractice(page:Page,receipt:string,width:number) {
  await page.getByRole('button',{name:'시험 실행',exact:true}).click();
  const panel = page.getByRole('tabpanel',{name:'실행 결과'});
  await panel.getByRole('button',{name:'질문 실행',exact:true}).click();
  const form = panel.locator('.run-wait');
  const input = form.getByRole('textbox',{name:'검증 기록 필수'});
  await expect(input).toBeVisible({timeout:30000});
  await page.setViewportSize({width:width/2,height:900});
  await input.focus();
  await page.keyboard.press('Control+v');
  await expect(input).toHaveValue(receipt);
  await form.getByRole('button',{name:'같은 실행 이어가기'}).press('Enter');
  await expect(panel.locator('.run-answer-meta .run-state')).toHaveText('완료',{timeout:45000});
  const files = panel.getByRole('region',{name:'결과 파일'});
  const readDownload = async (name:string) => {
    const downloading = page.waitForEvent('download');
    await files.getByRole('button',{name:name+' 내려받기',exact:true}).press('Enter');
    const downloaded = await downloading;
    assert.equal(downloaded.suggestedFilename(),name);
    return readFile((await downloaded.path())!,'utf8');
  };
  const report = await readDownload('검수-알림-개발-보고서.md');
  const skill = await readDownload('SKILL.md');
  assert.ok(report.includes(receipt));
  for (const role of roles) assert.ok(report.includes(role),role);
  assert.match(skill,/^---\r?\nname: inspect-equipment-sync\r?\n/);
  assert.ok(report.includes(skill));
  if (width===1440 && process.env.STUDIO_SCREENSHOTS) {
    await page.setViewportSize({width,height:900});
    await files.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,'equipment-inspection-workspace.png')});
  }
}

try {
  for (const width of [1280,1440]) {
    const context = await browser.newContext({baseURL, viewport:{width, height:900}});
    try {
      if (runWorker) {
        const origin = new URL(baseURL).origin;
        await context.grantPermissions(['clipboard-write','clipboard-read'],{origin});
        await context.route(/^https?:\/\//,route =>
          new URL(route.request().url()).origin===origin ? route.continue() : route.abort('blockedbyclient'));
      }
      const response = await context.request.get('/examples/equipment-inspection.html');
      assert.equal(response.status(), 200);
      assert.equal(await response.text(), inspectionExampleHtml, '작업실 로그인 없이 같은 독립 실습을 열 수 있어야 한다.');
      await registerBrowserAccount(context);
      const page = await context.newPage();
      await page.goto('/?view=templates');
      await page.getByRole('combobox',{name:'실습 주제'}).selectOption({label:'웹 개발'});
      await page.getByRole('combobox',{name:'실습 수준'}).selectOption({label:'고급'});
      await page.locator('[data-lesson-trigger="'+lesson+'"]').press('Enter');
      const guide = page.getByRole('dialog',{name:title});
      const assignments = guide.getByRole('region',{name:'연결된 Skill'});
      for (const skill of skills) await expect(assignments.getByText(skill,{exact:true})).toBeVisible();
      await page.setViewportSize({width:width/2, height:900});
      const open = guide.getByRole('link',{name:/검수 알림 실습 열기/});
      const opened = context.waitForEvent('page');
      await open.press('Enter');
      const example = await opened;
      await expect(example.getByRole('button',{name:'알림 입력',exact:true})).toBeVisible();
      const receipt = runWorker ? await copyEvidence(example,width) : '';
      await example.close();
      await guide.getByRole('button',{name:'내 사본으로 시작',exact:true}).press('Enter');
      await expect(page).toHaveURL(url=>url.searchParams.has('edit'));
      await page.setViewportSize({width,height:900});
      const projectId = new URL(page.url()).searchParams.get('edit');
      const info = await context.request.post('/api/studio',{data:{action:'project.open',data:{id:projectId}}});
      assert.equal(info.status(),200);
      const {data:project}: {data:{graph:Graph}} = await info.json();
      const attached = project.graph.nodes.filter(node=>node.type==='instruction.skill');
      assert.deepEqual(attached.map(node=>node.config.bundledSkill).sort(), [...skills].sort());
      for (const {config} of attached) {
        assert.ok(config.assetId && config.assetId !== config.bundledSkill, config.bundledSkill);
        assert.equal(config.version,1);
      }
      if (runWorker) await completePractice(page,receipt,width);
    } finally { await context.close(); }
  }
  console.log('PASS 웹 개발 고급 필터 · 원본 Skill 여섯 개 · 외부 계정 없는 검수 화면 · 작업실 사본'
    + (runWorker?' · 수신기 실측 기록 인계 · 여섯 담당의 보고서와 Skill 다운로드':''));
} finally { await browser.close(); }
