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
const intro = {level:'입문',id:'equipment-return-memo',title:'창구 기록의 ‘반납’은 무슨 뜻일까?',
  skill:'domain-modeling',targets:['용어 후보 메모 작성']};
const beginner = {level:'초급',id:'equipment-return-questions',title:'장비 담당자에게 무엇부터 물을까?',
  skill:'grilling',targets:['학습자에게 확인할 질문 만들기','답변을 되짚고 확인하기','중급에 보낼 질문 정리']};
const intermediate = {level:'중급',id:'equipment-return-terms',title:'장비를 돌려받으면 반납이 끝난 걸까?',
  skill:'to-questionnaire',targets:['질문지 작성 담당']};
const record = '야간 창구 기록 — “S-7 스캐너 회수”. 스캐너 본체는 수령했고 충전 거치대는 아직 도착하지 않았습니다.';
const runWorker = process.env.STUDIO_EQUIPMENT_STARTERS_RUN === '1';

async function openLesson(page:Page, lesson:typeof intro, width:number) {
  await page.setViewportSize({width,height:900});
  await page.goto('/?view=templates');
  await page.getByRole('combobox',{name:'실습 주제'}).selectOption({label:'업무 용어와 판단 기준 정리'});
  await page.getByRole('combobox',{name:'실습 수준'}).selectOption({label:lesson.level});
  const card = page.locator('[data-lesson-trigger="'+lesson.id+'"]');
  await expect(card).toContainText(lesson.title);
  await card.press('Enter');
  const dialog = page.getByRole('dialog',{name:lesson.title,exact:true});
  const preview = dialog.getByRole('region',{name:'연결된 Skill'})
    .getByText(lesson.skill,{exact:true}).locator('..');
  await expect(preview).toContainText('원본 Skill');
  for (const target of lesson.targets) await expect(preview).toContainText(target);
  await page.setViewportSize({width:width/2,height:900});
  const copy = dialog.getByRole('button',{name:'내 사본으로 시작',exact:true});
  await copy.focus();
  await expect(copy).toBeInViewport();
  await copy.press('Enter');
  await expect(page).toHaveURL(url=>url.searchParams.has('edit'));
  await page.setViewportSize({width,height:900});
  const list = page.getByRole('button',{name:'목록으로 편집',exact:true});
  if (await list.getAttribute('aria-pressed') !== 'true') await list.click();
  await page.locator('[data-canvas-block="skill-'+lesson.skill+'"]').press('Enter');
  const inspector = page.getByRole('tabpanel',{name:'속성',exact:true});
  for (const target of lesson.targets) {
    await expect(inspector.getByRole('button',{name:lesson.skill+' → '+target,exact:true})).toBeVisible();
  }
  const skill = inspector.getByRole('region',{name:'연결된 SKILL.md 지침'});
  await expect(skill.locator('.ws-picker-text')).toHaveText(await readFile('.agents/skills/'+lesson.skill+'/SKILL.md','utf8'));
}

async function start(page:Page, input?:string) {
  await page.getByRole('button',{name:'시험 실행',exact:true}).click();
  const panel = page.getByRole('tabpanel',{name:'실행 결과'});
  if (input) {
    const question = panel.getByLabel('Agent에게 보낼 질문');
    await page.evaluate(text=>navigator.clipboard.writeText(text),input);
    await question.focus();
    await question.press('Control+a');
    await question.press('Control+v');
    await expect(question).toHaveValue(input);
  }
  await panel.getByRole('button',{name:'질문 실행',exact:true}).click();
  return panel;
}
async function capture(page:Page, name:string) {
  if (process.env.STUDIO_SCREENSHOTS) await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,name+'.png')});
}

async function makeMemo(page:Page, width:number) {
  const panel = await start(page,record);
  await page.setViewportSize({width:width/2,height:900});
  const answer = panel.locator('.run-output');
  await expect(answer).toContainText('S-7 스캐너 회수',{timeout:30000});
  await expect(answer).toContainText('거치대');
  if (width===1440) {
    await page.setViewportSize({width,height:900});
    await answer.scrollIntoViewIfNeeded();
    await capture(page,'equipment-return-memo');
  }
  await answer.evaluate(element=>{
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press('Control+c');
  const memo = (await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n');
  assert.ok(memo.includes('S-7') && memo.includes('거치대'));
  return memo;
}

async function makeHandoff(page:Page, memo:string, width:number) {
  const panel = await start(page);
  const form = panel.locator('.run-wait');
  const field = form.getByRole('textbox',{name:'입문 용어 후보 메모 필수'});
  await expect(field).toBeVisible({timeout:30000});
  await page.setViewportSize({width:width/2,height:900});
  await field.focus();
  await page.keyboard.press('Control+v');
  await expect(field).toHaveValue(memo);
  const resume = form.getByRole('button',{name:'같은 실행 이어가기'});
  await resume.press('Enter');
  const answer = form.getByRole('textbox',{name:'학습자 답변 필수'});
  await expect(answer).toBeVisible({timeout:30000});
  await expect(form).toContainText('S-7');
  const partial = width===1440;
  const first = partial ? '다음 작업조에 S-7을 빌려줘도 되는지 먼저 알고 싶습니다.'
    : '창구에 남길 상태 기록이 우선입니다. 재고 담당자에게 확인할게요.';
  await answer.fill(first);
  await resume.press('Enter');
  const confirmation = form.getByRole('textbox',{name:'학습자 확인·보완 답변 필수'});
  await expect(confirmation).toBeVisible({timeout:30000});
  await expect(form).toContainText(partial ? '누구' : '재고 담당자');
  await expect(panel.getByRole('region',{name:'결과 파일'})).toHaveCount(0);
  if (partial) {
    await page.setViewportSize({width,height:900});
    await form.scrollIntoViewIfNeeded();
    await capture(page,'equipment-return-learner-questions');
    await page.setViewportSize({width:width/2,height:900});
  }
  await confirmation.fill(partial ? '장비 대여 승인자에게 묻겠습니다. 이 기준으로 질문을 정리해 주세요.' : '예. 그 순서로 질문을 정리해 주세요.');
  await resume.press('Enter');
  await expect(panel.locator('.run-answer-meta .run-state')).toHaveText('완료',{timeout:30000});
  const filename = '중급-담당자-확인-질문.md';
  const downloading = page.waitForEvent('download');
  await panel.getByRole('button',{name:filename+' 내려받기',exact:true}).press('Enter');
  const file = await downloading;
  assert.equal(file.suggestedFilename(),filename);
  const text = await readFile((await file.path())!,'utf8');
  const recipient = partial ? '장비 대여 승인자' : '재고 담당자';
  assert.ok(text.includes(recipient) && text.includes('S-7') && text.includes('거치대'));
  assert.match(text.split('\n').find(line=>line.startsWith('1.')) ?? '',partial ? /대여/ : /기록/);
  await expect(panel.locator('.run-output')).toContainText(recipient);
  return text;
}

try {
  for (const width of [1280,1440]) {
    const context = await browser.newContext({baseURL,viewport:{width,height:900}});
    try {
      await registerBrowserAccount(context);
      if (runWorker) await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(baseURL).origin});
      const page = await context.newPage();
      await openLesson(page,intro,width);
      const memo = runWorker ? await makeMemo(page,width) : '';
      await openLesson(page,beginner,width);
      if (runWorker) {
        const handoff = await makeHandoff(page,memo,width);
        await openLesson(page,intermediate,width);
        const panel = await start(page,handoff);
        const waiting = panel.locator('.run-wait');
        await expect(waiting.getByRole('textbox',{name:'장비 담당자 회신 필수'})).toBeVisible({timeout:30000});
        await expect(waiting).toContainText(width===1440 ? '장비 대여 승인자' : '재고 담당자');
        await expect(waiting).toContainText('S-7');
      }
    } finally {
      await context.close();
    }
  }
  console.log('PASS 장비 입문·초급 예제 사본과 원본 Skill' + (runWorker?' · 실제 메모, 학습자 답변과 중급 질문 인계':''));
} finally {
  await browser.close();
}
