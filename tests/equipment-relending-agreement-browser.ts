import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect, type Locator, type Page} from '@playwright/test';
import {registerBrowserAccount} from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
assert.ok(baseURL, '격리된 작업실 주소를 지정하세요.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined),
});
const title = '재대여 기준을 합의하면 어떤 판정이 달라질까?';
const glossary = '# 용어집\n\n봉인 검수는 스캐너의 보안 봉인을 확인하는 절차입니다.';
const partialReply = '봉인 정상 기록이 있으면 재대여 승인입니다.\n\n봉인 훼손 시 처리 기준은 아직 합의하지 않았습니다.';
const files = ['갱신-용어집.md','갱신-판단-규칙표.md','기존-신규-사례-재판정표.md'];
const questionFileName = 'to-questionnaire-equipment-relending.md';
function documents(partial:boolean) {
  const rules = '# 판단 규칙표\n| 조건 | 결정 |\n| --- | --- |\n| 본체 수령 | 반납 접수 |\n' +
    (partial ? '| 봉인 확인 | 재대여 기준 미확정 |'
      : '| 봉인 정상 기록 | 재대여 승인 |\n| 봉인 훼손 | 재대여 보류 |');
  const previous = '# 고급 최종 판정표\n| 사례 | 반납 상태 | 재대여 | 근거 |\n| --- | --- | --- | --- |\n' +
    '| K7 | 반납 접수 | ' + (partial ? '미확정' : '재대여 승인') + ' | 본체 수령, 봉인 정상 기록 |';
  return {'중급 용어집':glossary,'중급 판단 규칙표':rules,'고급 최종 판정표':previous,
    '새 장비 사례':'N8 · 본체 수령, 봉인 정상 기록\nN9 · 본체 수령, 봉인 훼손'};
}
async function download(page:Page, button:Locator, name:string) {
  const pending = page.waitForEvent('download');
  await button.press('Enter');
  const result = await pending;
  assert.equal(result.suggestedFilename(), name);
  return readFile((await result.path())!, 'utf8');
}
async function screenshot(page:Page, name:string) {
  if (process.env.STUDIO_SCREENSHOTS) await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS, name+'.png')});
}
type RunEvent = {nodeId:string; kind:string; data:{value?:unknown}};
function formValue(events:RunEvent[], id:string) {
  const event = events.find(item => item.nodeId===id && item.kind==='result');
  assert.ok(event,id);
  const data = event.data.value;
  return typeof data==='string' ? JSON.parse(data) : data;
}
async function tryAgreement(page:Page, width:number) {
  const partial = width===1440;
  const sources = documents(partial);
  const api = async(action:string,data:object) => {
    const response = await page.request.post('/api/studio',{data:{action,data}});
    const result = await response.json();
    assert.ok(response.ok(),result.error ?? action);
    return result.data;
  };
  const projectId = new URL(page.url()).searchParams.get('edit');
  await page.getByRole('button',{name:'시험 실행',exact:true}).click();
  const panel = page.getByRole('tabpanel',{name:'실행 결과'});
  await panel.getByRole('button',{name:'질문 실행',exact:true}).click();
  const form = panel.locator('.run-wait');
  await expect(form.getByRole('textbox')).toHaveCount(4,{timeout:30_000});
  const [start] = await api('run.list',{id:projectId});
  const getRun = () => api('run.get',{runId:start.id});
  await page.setViewportSize({width:width/2,height:900});
  for (const [name,value] of Object.entries(sources)) {
    const field = form.getByRole('textbox',{name:name+' 필수',exact:true});
    await expect(field).toHaveValue('');
    assert.equal(await field.evaluate(el => el.tagName), 'TEXTAREA');
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }
  const resume = form.getByRole('button',{name:'같은 실행 이어가기'});
  await resume.press('Enter');
  if (partial) {
    const reply = form.getByRole('textbox',{name:'장비 담당자 회신 필수'});
    await expect(reply).toBeVisible({timeout:30_000});
    const waiting = await getRun();
    assert.equal(waiting.state,'waiting');
    const questionnaire = await download(page,form.getByRole('button',{name:/^질문지 내려받기/}),questionFileName);
    assert.equal(questionnaire,waiting.prompt.prompt);
    assert.match(questionnaire,/봉인 정상/);
    assert.match(questionnaire,/봉인 훼손/);
    assert.doesNotMatch(questionnaire,/본체 수령/);
    assert.ok(!waiting.events.some((event:RunEvent) => event.nodeId==='modeler' && event.kind==='start'));
    await reply.fill(partialReply);
    await expect(reply).toHaveValue(partialReply);
    await page.setViewportSize({width,height:900});
    await reply.scrollIntoViewIfNeeded();
    await screenshot(page,'equipment-relending-agreement-questions');
    await page.setViewportSize({width:width/2,height:900});
    await resume.press('Enter');
  }
  await expect(panel.locator('.run-answer-meta .run-state')).toHaveText('완료',{timeout:30_000});
  const result = await getRun();
  assert.equal(result.state,'completed',result.error ?? '');
  assert.deepEqual(formValue(result.events,'sources'),sources);
  assert.equal(result.events.some((event:RunEvent) => event.nodeId==='modeler' && event.kind==='start'),partial);
  assert.equal(result.events.some((event:RunEvent) => event.nodeId==='reply' && event.kind==='wait'),partial);
  if (partial) assert.deepEqual(formValue(result.events,'reply'),{'장비 담당자 회신':partialReply});
  assert.equal((await api('run.list',{id:projectId})).length,1);
  const downloads = panel.getByRole('region',{name:'결과 파일'});
  await expect(downloads.getByRole('button',{name:/내려받기/})).toHaveCount(3);
  const texts = [];
  for (const name of files) {
    const content = await download(page,downloads.getByRole('button',{name:name+' 내려받기',exact:true}),name);
    assert.equal(content,result.files.find((entry:{fileName:string}) => entry.fileName===name).content);
    assert.ok(result.output.includes(content),name);
    texts.push(content);
  }
  if (partial) {
    assert.match(texts[0],/재대여 승인/);
    assert.match(texts[1],/봉인 정상 기록이 있으면 재대여 승인/);
    assert.match(texts[1],/봉인 훼손.*미확정/);
    assert.match(texts[2],/K7.*미확정.*재대여 승인/);
  } else {
    assert.equal(texts[0],sources['중급 용어집']);
    assert.equal(texts[1],sources['중급 판단 규칙표']);
  }
  assert.match(texts[2],/N8.*재대여 승인/);
  assert.match(texts[2],partial ? /N9.*미확정/ : /N9.*재대여 보류/);
  const table = panel.locator('.run-output table').filter({has:page.getByRole('cell',{name:'N8',exact:true})});
  await expect(table).toHaveCount(1);
  await expect(table.getByRole('columnheader')).toHaveText(['구분','사례','판단 항목','이전 판정','재판정','근거']);
  const newApproval = table.getByRole('row').filter({hasText:'N8'}).filter({hasText:'재대여 가능 여부'});
  await expect(newApproval.getByRole('cell').nth(3)).toHaveText('신규');
  const scroller = table.locator('..');
  await scroller.focus();
  await expect(scroller).toBeFocused();
  assert.ok(await scroller.evaluate(el => getComputedStyle(el).overflowX==='auto' && el.getBoundingClientRect().width<=innerWidth));
  if (partial) {
    await page.setViewportSize({width,height:900});
    await table.scrollIntoViewIfNeeded();
    await screenshot(page,'equipment-relending-agreement-results');
  }
}
try {
  for (const width of [1280,1440]) {
    const context = await browser.newContext({baseURL,viewport:{width,height:900}});
    try {
      await registerBrowserAccount(context);
      const page = await context.newPage();
      await page.goto('/?view=templates');
      await page.getByRole('combobox',{name:'실습 주제'}).selectOption({label:'업무 용어와 판단 기준 정리'});
      await page.getByRole('combobox',{name:'실습 수준'}).selectOption({label:'전문가'});
      const card = page.locator('[data-lesson-trigger="equipment-relending-agreement"]');
      await expect(card).toContainText(title);
      await card.press('Enter');
      const dialog = page.getByRole('dialog',{name:title,exact:true});
      const skills = dialog.getByRole('region',{name:'연결된 Skill'});
      const modeling = skills.getByText('domain-modeling',{exact:true}).locator('..');
      await expect(modeling).toContainText('기준 갱신 담당');
      await expect(modeling).toContainText('사례 재판정 담당');
      await expect(skills.getByText('to-questionnaire',{exact:true}).locator('..')).toContainText('합의 질문 담당');
      await page.setViewportSize({width:width/2,height:900});
      const copy = dialog.getByRole('button',{name:'내 사본으로 시작',exact:true});
      await copy.focus();
      await expect(copy).toBeInViewport();
      await copy.press('Enter');
      await expect(page).toHaveURL(url => url.searchParams.has('edit'));
      await page.setViewportSize({width,height:900});
      const list = page.getByRole('button',{name:'목록으로 편집',exact:true});
      if (await list.getAttribute('aria-pressed')!=='true') await list.click();
      await page.locator('[data-canvas-block="sources"]').press('Enter');
      const inspector = page.getByRole('tabpanel',{name:'속성',exact:true});
      for (const name of Object.keys(documents(false))) {
        await expect(inspector.getByRole('checkbox',{name:name+' 필수'})).toBeChecked();
        await expect(inspector.getByRole('checkbox',{name:name+' 여러 줄'})).toBeChecked();
      }
      if (process.env.STUDIO_RELENDING_AGREEMENT_RUN==='1') await tryAgreement(page,width);
    } finally {
      await context.close();
    }
  }
  console.log('PASS 재대여 전문가 예제 선택·사본·네 입력칸·역할별 Skill' +
    (process.env.STUDIO_RELENDING_AGREEMENT_RUN==='1' ? ', 기준 합의·부분 회신·질문 생략·세 결과 파일' : ''));
} finally {
  await browser.close();
}
