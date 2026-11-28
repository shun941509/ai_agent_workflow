import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect, type Page} from '@playwright/test';
import {registerBrowserAccount} from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
assert.ok(baseURL, '격리된 작업실 주소를 지정하세요.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined),
});
const title = '이 장비는 반납 완료일까, 다시 물어봐야 할까?';
const cases = [
  'A. 초록 라벨, 기능 점검 완료. 오늘 다른 부서가 대여를 요청함.',
  'B. 황색 라벨, 기능 점검 기록이 비어 있음. 오늘 다른 부서가 대여를 요청함.',
  'C. 황색 라벨, 기능 점검 완료. 오늘 다른 부서가 대여를 요청함.',
].join('\n');
const glossary = '# 용어집\n\n창구 인수는 본체를 접수한 상태입니다.\n검수 종결은 기능 점검이 끝난 상태입니다.';
const commonRules = [
  '# 판단 규칙표',
  '| 조건 | 반납 상태 또는 재대여 가능 여부 |',
  '| --- | --- |',
  '| 기능 점검 완료 | 검수 종결 |',
  '| 초록 라벨과 기능 점검 완료 | 당일 재대여 가능 |',
].join('\n');
const reply = 'B의 기능 점검은 끝났습니다.\n\n황색 라벨 장비의 재대여는 아직 합의하지 않았습니다.';

async function screenshot(page:Page, filename:string) {
  if (process.env.STUDIO_SCREENSHOTS) {
    await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS, filename + '.png')});
  }
}

type RunEvent = {nodeId:string; kind:string; data:{value?:unknown}};
function formData(events:RunEvent[], id:string) {
  const event = events.find(item => item.nodeId===id && item.kind==='result');
  assert.ok(event, '완료된 응답 양식 ' + id);
  const data = event.data.value;
  return typeof data==='string' ? JSON.parse(data) : data;
}

async function runCases(page:Page, width:number) {
  const partial = width===1440;
  const rules = commonRules + (partial
    ? '\n| 황색 라벨 | 당일 재대여 미확정 |'
    : '\n| 점검 기록 없음 | 창구 인수 |\n| 황색 라벨 | 당일 재대여 보류 |');
  const project = new URL(page.url()).searchParams.get('edit');
  const api = async(action:string, data:object) => {
    const response = await page.request.post('/api/studio', {data:{action, data}});
    const body = await response.json();
    assert.ok(response.ok(), body.error);
    return body.data;
  };
  await page.getByRole('button', {name:'시험 실행', exact:true}).click();
  const panel = page.getByRole('tabpanel', {name:'실행 결과'});
  await panel.getByLabel('Agent에게 보낼 질문').fill(cases);
  await panel.getByRole('button', {name:'질문 실행', exact:true}).click();
  const form = panel.locator('.run-wait');
  const glossaryField = form.getByRole('textbox', {name:'중급 용어집 필수'});
  const rulesField = form.getByRole('textbox', {name:'중급 판단 규칙표 필수'});
  await expect(glossaryField).toBeVisible({timeout:30_000});
  await expect(glossaryField).toHaveValue('');
  await expect(rulesField).toHaveValue('');
  const [run] = await api('run.list', {id:project});
  const getRun = () => api('run.get', {runId:run.id});
  assert.equal((await getRun()).state, 'waiting');
  await page.setViewportSize({width:width/2, height:900});
  await glossaryField.fill(glossary);
  await rulesField.focus();
  await page.keyboard.insertText(rules);
  await expect(glossaryField).toHaveValue(glossary);
  await expect(rulesField).toHaveValue(rules);
  const resume = form.getByRole('button', {name:'같은 실행 이어가기'});
  await resume.press('Enter');

  if (partial) {
    const replyField = form.getByRole('textbox', {name:'장비 담당자 회신 필수'});
    await expect(replyField).toBeVisible({timeout:30_000});
    const waiting = await getRun();
    const questionFile = form.getByRole('button', {name:/^질문지 내려받기/});
    const downloading = page.waitForEvent('download');
    await questionFile.press('Enter');
    const file = await downloading;
    assert.equal(file.suggestedFilename(), 'to-questionnaire-equipment-return-cases.md');
    const questionnaire = await readFile((await file.path())!, 'utf8');
    assert.equal(questionnaire, waiting.events.find((e:RunEvent) => e.nodeId==='writer' && e.kind==='result').data.value);
    assert.match(questionnaire, /B.*기능 점검/);
    assert.match(questionnaire, /황색 라벨.*재대여/);
    assert.doesNotMatch(questionnaire, /초록 라벨/);
    await expect(form).toContainText(questionnaire);
    assert.ok(!waiting.events.some((e:RunEvent) => e.nodeId==='rejudge' && e.kind==='start'));
    await replyField.fill(reply);
    await expect(replyField).toHaveValue(reply);
    if (process.env.STUDIO_SCREENSHOTS) {
      await page.setViewportSize({width, height:900});
      await form.scrollIntoViewIfNeeded();
      await screenshot(page, 'equipment-return-cases-follow-up');
      await page.setViewportSize({width:width/2, height:900});
    }
    await resume.press('Enter');
  }
  await expect(panel.locator('.run-answer-meta .run-state')).toHaveText('완료', {timeout:30_000});
  const result = await getRun();
  assert.equal(result.state, 'completed', result.error);
  assert.deepEqual(formData(result.events, 'sources'), {'중급 용어집':glossary, '중급 판단 규칙표':rules});
  assert.equal(result.events.some((e:RunEvent) => e.nodeId==='writer' && e.kind==='start'), partial);
  assert.equal(result.events.some((e:RunEvent) => e.nodeId==='rejudge' && e.kind==='start'), partial);
  if (partial) assert.deepEqual(formData(result.events, 'reply'), {'장비 담당자 회신':reply});
  assert.equal((await api('run.list', {id:project})).length, 1);

  const table = panel.locator('.run-output table').first();
  const rows = table.getByRole('row');
  await expect(table.getByRole('columnheader')).toHaveText(['사례','판단 항목','최초 판정','최종 판정','근거']);
  const decisions = (id:string, axis:string) => rows.filter({has:page.getByRole('cell', {name:id, exact:true})})
    .filter({has:page.getByRole('cell', {name:axis, exact:true})}).getByRole('cell');
  await expect(decisions('A','반납 상태').nth(3)).toHaveText('검수 종결');
  await expect(decisions('A','재대여 가능 여부').nth(3)).toHaveText('당일 재대여 가능');
  await expect(decisions('B','반납 상태').nth(2)).toHaveText(partial ? '미확정' : '창구 인수');
  await expect(decisions('B','반납 상태').nth(3)).toHaveText(partial ? '검수 종결' : '창구 인수');
  await expect(decisions('B','재대여 가능 여부').nth(3)).toHaveText(partial ? '미확정' : '당일 재대여 보류');
  await expect(decisions('C','반납 상태').nth(3)).toHaveText('검수 종결');
  await expect(decisions('C','재대여 가능 여부').nth(3)).toHaveText(partial ? '미확정' : '당일 재대여 보류');
  const scroller = table.locator('..');
  await scroller.focus();
  await expect(scroller).toBeFocused();
  assert.ok(await scroller.evaluate(el => getComputedStyle(el).overflowX==='auto' && el.getBoundingClientRect().width<=innerWidth));
  const downloadTable = panel.getByRole('button', {name:'사례별-최종-판정표.md 내려받기', exact:true});
  const downloading = page.waitForEvent('download');
  await downloadTable.press('Enter');
  const file = await downloading;
  assert.equal(file.suggestedFilename(), '사례별-최종-판정표.md');
  const text = await readFile((await file.path())!, 'utf8');
  assert.equal(text.trim(), result.output.trim());
  if (partial) {
    assert.match(text, /B의 기능 점검은 끝났습니다/);
    await page.setViewportSize({width, height:900});
    await table.scrollIntoViewIfNeeded();
    await screenshot(page, 'equipment-return-cases-results');
  }
}

try {
  for (const width of [1280, 1440]) {
    const context = await browser.newContext({baseURL, viewport:{width,height:900}});
    try {
      await registerBrowserAccount(context);
      const page = await context.newPage();
      await page.goto('/?view=templates');
      await page.getByRole('combobox', {name:'실습 주제'}).selectOption({label:'업무 용어와 판단 기준 정리'});
      await page.getByRole('combobox', {name:'실습 수준'}).selectOption({label:'고급'});
      const card = page.locator('[data-lesson-trigger="equipment-return-cases"]');
      await expect(card).toContainText(title);
      await card.press('Enter');
      const dialog = page.getByRole('dialog', {name:title, exact:true});
      const skills = dialog.getByRole('region', {name:'연결된 Skill'});
      const decision = skills.getByText('domain-modeling', {exact:true}).locator('..');
      await expect(decision).toContainText('사례 판정 담당');
      await expect(decision).toContainText('회신 반영 담당');
      await expect(skills.getByText('to-questionnaire', {exact:true}).locator('..')).toContainText('재질문 담당');
      await page.setViewportSize({width:width/2, height:900});
      const start = dialog.getByRole('button', {name:'내 사본으로 시작'});
      await start.focus();
      await expect(start).toBeInViewport();
      await start.press('Enter');
      await expect(page).toHaveURL(url => url.searchParams.has('edit'));
      await page.setViewportSize({width, height:900});
      const list = page.getByRole('button', {name:'목록으로 편집', exact:true});
      if (await list.getAttribute('aria-pressed')!=='true') await list.click();
      await page.locator('[data-canvas-block="sources"]').press('Enter');
      const inspector = page.getByRole('tabpanel', {name:'속성', exact:true});
      await expect(inspector.getByRole('checkbox', {name:'중급 용어집 여러 줄'})).toBeChecked();
      await expect(inspector.getByRole('checkbox', {name:'중급 판단 규칙표 여러 줄'})).toBeChecked();
      if (process.env.STUDIO_EQUIPMENT_CASES_RUN==='1') await runCases(page, width);
    } finally {
      await context.close();
    }
  }
  console.log('PASS 장비 반납 고급 예제 선택·사본 만들기' + (process.env.STUDIO_EQUIPMENT_CASES_RUN==='1' ? ', 문서 입력·즉시 판정·미확정 재질문·회신 후 최종 판정표' : ''));
} finally {
  await browser.close();
}

