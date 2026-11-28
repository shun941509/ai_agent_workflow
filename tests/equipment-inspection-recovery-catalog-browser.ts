import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect, type BrowserContext, type Page} from '@playwright/test';
import {applyInspectionDelivery, createInspectionSession, makeInspectionReceipt} from '../src/domain/inspection-receiver.mjs';
import {recoveryScenarios, verifyRecoveryRecord} from '../src/domain/inspection-recovery.mjs';
import {registerBrowserAccount} from './browser-account';
import type {Run} from './live-service';

const baseURL = process.env.STUDIO_TEST_URL;
assert.ok(baseURL, '격리된 작업실 주소를 지정하세요.');
const useWorker = process.env.STUDIO_RECOVERY_WEB_RUN === '1';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});
const titles = {lesson:'검수 알림이 뒤늦게 오거나 다시 오면 무엇이 남아야 할까?', report:'시도별-검증-보고서.md', skill:'SKILL.md'};

async function advancedFiles(context:BrowserContext) {
  async function api<T>(action:string,data:object):Promise<T> {
    const response = await context.request.post('/api/studio',{data:{action,data}});
    const body = await response.json();
    assert.equal(response.status(),200,body.error);
    return body.data;
  }
  async function waitFor(run:Run,state:string) {
    await expect.poll(async () => {
      run = await api<Run>('run.get',{runId:run.id});
      assert.notEqual(run.state,'failed',run.error ?? '작업실 실행 실패');
      return run.state;
    },{timeout:45000}).toBe(state);
    return run;
  }
  const {id} = await api<{id:string}>('project.create',{lesson:'equipment-inspection-web'});
  const started = await api<Run>('run.start',{id,mode:'test',input:'검수 알림을 두 번 수신한 기록으로 개발 보고서와 점검 Skill을 작성해 주세요.',requestKey:crypto.randomUUID()});
  const pending = await waitFor(started,'waiting');
  const session = createInspectionSession();
  const event = {eventId:'advanced-to-expert',equipmentId:'B-08',type:'inspection.completed'};
  applyInspectionDelivery(session,event);
  applyInspectionDelivery(session,event);
  const value = JSON.stringify({'검증 기록':JSON.stringify(makeInspectionReceipt(session))});
  const done = await waitFor(await api<Run>('run.reply',{runId:pending.id,waitId:pending.prompt!.id,value}),'completed');
  const report = done.files?.find(file=>file.fileName==='검수-알림-개발-보고서.md')?.content;
  const skill = done.files?.find(file=>file.fileName==='SKILL.md')?.content;
  assert.ok(report?.includes('advanced-to-expert'));
  assert.ok(skill?.includes('inspect-equipment-sync'));
  return {report:report!,skill:skill!};
}

async function runScenarios(example:Page,docs:{report:string;skill:string},equipmentId:string) {
  await example.getByRole('textbox',{name:'고급 개발 보고서',exact:true}).fill(docs.report);
  await example.getByRole('textbox',{name:'고급 점검 Skill',exact:true}).fill(docs.skill);
  await example.getByRole('combobox',{name:'대상 장비',exact:true}).selectOption(equipmentId);
  const select = example.getByRole('combobox',{name:'시나리오',exact:true});
  const next = example.getByRole('button',{name:'다음 알림 보내기',exact:true});
  for (const {id} of recoveryScenarios) {
    await select.selectOption(id);
    await next.press('Enter');
    await next.press('Enter');
  }
  await example.getByText('시도별 검증 기록 보기',{exact:true}).click();
  const receipt = await example.getByRole('textbox',{name:'시도별 검증 기록',exact:true}).inputValue();
  await example.getByRole('button',{name:'검증 기록 복사'}).click();
  await expect(example.locator('#copy-note')).toHaveText('검증 기록을 복사했습니다.');
  assert.ok(verifyRecoveryRecord(JSON.parse(receipt)));
  return receipt;
}

async function checkWorkspace(page:Page,docs:{report:string;skill:string},receipt:string,width:number) {
  await page.getByRole('button',{name:'시험 실행',exact:true}).click();
  const panel = page.getByRole('tabpanel',{name:'실행 결과'});
  await panel.getByRole('button',{name:'질문 실행',exact:true}).click();
  const form = panel.locator('.run-wait');
  await expect(form).toBeVisible({timeout:30000});
  await page.setViewportSize({width:width/2,height:900});
  await form.getByRole('textbox',{name:'고급 개발 보고서 필수'}).fill(docs.report);
  await form.getByRole('textbox',{name:'고급 점검 Skill 필수'}).fill(docs.skill);
  const field = form.getByRole('textbox',{name:'시도별 검증 기록 필수'});
  await field.press('Control+v');
  await expect(field).toHaveValue(receipt);
  await form.getByRole('button',{name:'같은 실행 이어가기'}).press('Enter');
  await expect(panel.locator('.run-answer-meta .run-state')).toHaveText('완료',{timeout:45000});
  const files = panel.getByRole('region',{name:'결과 파일'});
  for (const name of [titles.report,titles.skill]) {
    const download = page.waitForEvent('download');
    await files.getByRole('button',{name:name+' 내려받기',exact:true}).press('Enter');
    const saved = await download;
    assert.equal(saved.suggestedFilename(),name);
    const body = await readFile((await saved.path())!,'utf8');
    if (name===titles.skill) {
      assert.ok(body.startsWith(docs.skill.trimEnd()));
      assert.ok(body.includes('재전송'));
    } else {
      assert.ok(body.includes('저장 후 응답 유실'));
      assert.ok(body.includes('저장 직전 실패'));
      assert.ok(body.includes('역순 도착'));
    }
  }
  if (width===1440 && process.env.STUDIO_SCREENSHOTS) {
    await page.setViewportSize({width,height:900});
    await files.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,'equipment-inspection-recovery-workspace.png')});
  }
}

try {
  for (const width of [1280,1440]) {
    const context = await browser.newContext({baseURL,viewport:{width,height:900}});
    try {
      const origin = new URL(baseURL).origin;
      await context.route(/^https?:\/\//,route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
      const publicPage = await context.request.get('/examples/equipment-inspection-recovery.html');
      assert.equal(publicPage.status(),200);
      assert.match(await publicPage.text(),/고급 점검 Skill/);
      await registerBrowserAccount(context);
      if (useWorker) await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
      const docs = useWorker ? await advancedFiles(context) : undefined;
      const page = await context.newPage();
      await page.goto('/?view=templates');
      await page.getByRole('combobox',{name:'실습 주제'}).selectOption({label:'웹 개발'});
      await page.getByRole('combobox',{name:'실습 수준'}).selectOption({label:'전문가'});
      await page.locator('[data-lesson-trigger="equipment-inspection-recovery"]').press('Enter');
      const guide = page.getByRole('dialog',{name:titles.lesson});
      await expect(guide.getByRole('region',{name:'연결된 Skill'}).locator('dt')).toHaveCount(6);
      await page.setViewportSize({width:width/2,height:900});
      const opened = context.waitForEvent('page');
      await guide.getByRole('link',{name:'검수 알림 복구 실습 열기 (새 창)'}).press('Enter');
      const example = await opened;
      const receipt = docs ? await runScenarios(example,docs,width === 1280 ? 'A-17' : 'B-08') : '';
      await expect(example.getByRole('textbox',{name:'고급 개발 보고서',exact:true})).toBeVisible();
      await example.close();
      await guide.getByRole('button',{name:'내 사본으로 시작',exact:true}).press('Enter');
      await expect(page).toHaveURL(url=>url.searchParams.has('edit'));
      await page.setViewportSize({width,height:900});
      if (docs) await checkWorkspace(page,docs,receipt,width);
    } finally { await context.close(); }
  }
  console.log('PASS 웹 개발 전문가 사본과 독립 실습 열기' + (useWorker?' · 고급의 실제 두 파일과 여섯 시도의 기록을 전문가 결과로 전달':''));
} finally { await browser.close(); }
