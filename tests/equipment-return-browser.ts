import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {chromium, expect, type Locator, type Page} from '@playwright/test';
import {unzipSync} from 'fflate';
import {registerBrowserAccount} from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소를 지정하세요.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined),
});
const topic = '업무 용어와 판단 기준 정리';
const title = '장비를 돌려받으면 반납이 끝난 걸까?';
const assignments = [
  {skill:'to-questionnaire', role:'질문지 작성 담당'},
  {skill:'domain-modeling', role:'용어 정리 담당'},
];
const questionnaireFile = 'to-questionnaire-equipment-return.md';

async function saveFromControl(page: Page, control: Locator, filename: string) {
  await control.focus();
  await expect(control).toBeInViewport();
  const downloading = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const download = await downloading;
  assert.equal(download.suggestedFilename(), filename);
  return readFile((await download.path())!, 'utf8');
}

// Run this section against the isolated worker with a test model (or a live, configured provider).
async function answerQuestionnaire(page: Page, width: number) {
  const projectId = new URL(page.url()).searchParams.get('edit')!;
  const api = async (action: string, data: Record<string, unknown>) => {
    const response = await page.request.post('/api/studio', {data:{action, data}});
    const body = await response.json();
    assert.ok(response.ok(), body.error ?? action);
    return body.data;
  };
  await page.getByRole('button', {name:'시험 실행', exact:true}).click();
  const panel = page.getByRole('tabpanel', {name:'실행 결과'});
  await panel.getByRole('button', {name:'질문 실행', exact:true}).click();
  const waitForm = panel.locator('.run-wait');
  const replyBox = waitForm.getByRole('textbox', {name:'장비 담당자 회신 필수'});
  await expect(replyBox).toBeVisible({timeout:60_000});
  const [run] = await api('run.list', {id:projectId});
  const waiting = await api('run.get', {runId:run.id});
  assert.equal(waiting.state, 'waiting');
  const text = waiting.events.find((event: {nodeId:string;kind:string}) => event.nodeId === 'writer' && event.kind === 'result').data.value;
  assert.ok(!waiting.events.some((event: {nodeId:string;kind:string}) => event.nodeId === 'modeler' && event.kind === 'start'));
  await expect(waitForm).toContainText(text);
  await page.setViewportSize({width:width/2, height:900});
  assert.equal(await saveFromControl(page, waitForm.getByRole('button', {name:/^질문지 내려받기/}), questionnaireFile), text);
  assert.equal((await api('run.get', {runId:run.id})).state, 'waiting');
  const reply = width === 1440
    ? '1. 본체를 받으면 반납을 접수합니다.\n2. 구성품 점검 뒤 반납을 완료합니다.\n\n3. 충전기 누락 시 재대여 가능 여부는 아직 결정하지 않았습니다.'
    : '본체를 받으면 반납을 접수합니다. 구성품 점검 뒤 반납을 완료합니다. 충전기가 없으면 재대여를 보류합니다.';
  await replyBox.focus();
  await page.keyboard.insertText(reply);
  await expect(replyBox).toHaveValue(reply);
  if (width === 1440 && process.env.STUDIO_EQUIPMENT_QUESTION_SCREENSHOT) {
    await page.setViewportSize({width, height:900});
    await waitForm.scrollIntoViewIfNeeded();
    await page.screenshot({path:process.env.STUDIO_EQUIPMENT_QUESTION_SCREENSHOT});
    await page.setViewportSize({width:width/2, height:900});
  }
  await replyBox.focus();
  await page.keyboard.press('Tab');
  await expect(waitForm.getByRole('button', {name:'같은 실행 이어가기'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel.locator('.run-answer-meta .run-state')).toHaveText('완료', {timeout:60_000});
  const done = await api('run.get', {runId:run.id});
  assert.equal(done.id, waiting.id);
  assert.equal(done.state, 'completed', done.error);
  const submitted = done.events.find((event: {nodeId:string;kind:string}) => event.nodeId === 'reply' && event.kind === 'result').data.value;
  const fields = typeof submitted === 'string' ? JSON.parse(submitted) : submitted;
  assert.equal(fields['장비 담당자 회신'], reply);
  assert.equal((await api('run.list', {id:projectId})).length, 1);
  const ruleTable = panel.getByRole('table', {name:'판단 규칙표'});
  await expect(ruleTable.getByRole('columnheader').first()).toBeVisible();
  await expect(ruleTable.getByRole('row').filter({hasText:'충전기'})).toContainText(width===1440 ? '미확정' : '보류');
  const scrollArea = ruleTable.locator('..');
  await scrollArea.focus();
  await expect(scrollArea).toBeFocused();
  assert.ok(await scrollArea.evaluate(element => getComputedStyle(element).overflowX==='auto'
    && element.getBoundingClientRect().width <= innerWidth));
  const results = panel.getByRole('region', {name:'결과 파일'});
  await expect(results.getByRole('button', {name:/내려받기/})).toHaveCount(3);
  const downloaded = async (name:string) => saveFromControl(page, results.getByRole('button', {name:name + ' 내려받기'}), name);
  assert.equal(await downloaded(questionnaireFile), text);
  assert.match(await downloaded('GLOSSARY.md'), /반납 접수/);
  const rules = await downloaded('판단-규칙표.md');
  assert.match(rules, /충전기/);
  assert.match(rules, width === 1440 ? /미확정/ : /보류/);
  if (width === 1440 && process.env.STUDIO_EQUIPMENT_RESULT_SCREENSHOT) {
    await page.setViewportSize({width, height:900});
    await ruleTable.scrollIntoViewIfNeeded();
    await page.screenshot({path:process.env.STUDIO_EQUIPMENT_RESULT_SCREENSHOT});
  }
}

try {
  for (const width of [1280, 1440]) {
    const context = await browser.newContext({baseURL, viewport:{width, height:900}});
    try {
      await registerBrowserAccount(context);
      const page = await context.newPage();
      await page.goto('/?view=templates');
      await page.getByRole('combobox', {name:'실습 주제', exact:true}).selectOption({label:topic});
      const level = page.getByRole('combobox', {name:'실습 수준', exact:true});
      await level.selectOption({label:'중급'});
      await expect(page.locator('[data-lesson-trigger]')).toHaveCount(1);
      const card = page.locator('[data-lesson-trigger="equipment-return-terms"]');
      await expect(card).toContainText(title);
      await card.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', {name:title, exact:true});
      await expect(dialog.getByText(topic, {exact:true})).toBeVisible();
      await expect(dialog.getByRole('link', {name:/주문 예제|주문 관리 예제/})).toHaveCount(0);
      const preview = dialog.getByRole('region', {name:'연결된 Skill'});
      for (const {skill, role} of assignments) {
        const entry = preview.getByText(skill, {exact:true}).locator('..');
        await expect(entry).toContainText(role);
        await expect(entry).toContainText('원본 Skill');
      }
      await page.setViewportSize({width:width/2, height:900});
      const start = dialog.getByRole('button', {name:'내 사본으로 시작', exact:true});
      await start.focus();
      await expect(start).toBeInViewport();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(url => url.searchParams.has('edit'));
      await page.setViewportSize({width, height:900});
      const list = page.getByRole('button', {name:'목록으로 편집', exact:true});
      if (await list.getAttribute('aria-pressed') !== 'true') await list.click();
      for (const {skill, role} of assignments) {
        await page.locator('[data-canvas-block="skill-' + skill + '"]').press('Enter');
        const property = page.getByRole('tabpanel', {name:'속성', exact:true});
        await expect(property.getByRole('button', {name:skill + ' → ' + role, exact:true})).toBeVisible();
        const source = await readFile('.agents/skills/' + skill + '/SKILL.md', 'utf8');
        const edition = property.getByRole('region', {name:'연결된 SKILL.md 지침'});
        await expect(edition.locator('.ws-picker-text')).toHaveText(source);
      }
      await page.getByRole('button', {name:'Agent 내보내기', exact:true}).click();
      const exported = page.getByRole('dialog', {name:'Agent 내보내기'});
      const pendingDownload = page.waitForEvent('download');
      await exported.getByRole('button', {name:'ZIP 내려받기'}).click();
      const download = await pendingDownload;
      if (width === 1440 && process.env.STUDIO_EQUIPMENT_ZIP) await download.saveAs(process.env.STUDIO_EQUIPMENT_ZIP);
      const files = unzipSync(await readFile((await download.path())!));
      for (const {skill} of assignments) {
        const path = '.agents/skills/' + skill + '/SKILL.md';
        assert.deepEqual(Buffer.from(files[path]), await readFile(path));
      }
      if (process.env.STUDIO_EQUIPMENT_RUN === '1') {
        await expect(exported).toHaveCount(0);
        await answerQuestionnaire(page, width);
      }
    } finally {
      await context.close();
    }
  }
  console.log('PASS equipment return catalog, role Skills, keyboard copy and ZIP at Windows desktop and split widths.');
} finally {
  await browser.close();
}
