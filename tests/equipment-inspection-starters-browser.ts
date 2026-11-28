import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, rmdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium, expect, type Locator, type Page} from '@playwright/test';
import {inspectionStartersHtml} from '../src/domain/equipment-inspection-starters-example';
import type {StarterRecord} from '../src/domain/inspection-starters.mjs';
import {registerBrowserAccount} from './browser-account';

const address = '/examples/equipment-inspection-starters.html';
const lessons = [
  {id:'equipment-return-inventory', level:'입문', stage:'list', skill:'frontend-design', folder:'.agents/skills', field:'장비 반납 목록', file:'장비-반납-목록.json'},
  {id:'equipment-inspection-first', level:'초급', stage:'notify', skill:'webhook-handler-patterns', folder:'vendor/lesson-skills', field:'검수 알림 1회 기록', file:'검수-알림-1회-기록.json'},
  {id:'equipment-inspection-compare', level:'중급', stage:'check', skill:'test-driven-development', folder:'.agents/skills', field:'검수 알림 1회 기록', file:'검수-알림-전후-검증.md'},
] as const;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseURL = process.env.STUDIO_TEST_URL;
const runWorker = process.env.STUDIO_INSPECTION_STARTER_WORKER === '1';
const screenshots = process.env.STUDIO_SCREENSHOTS;

async function download(page:Page, button:Locator, name:string) {
  const pending = page.waitForEvent('download');
  await button.press('Enter');
  const file = await pending;
  assert.equal(file.suggestedFilename(),name);
  return readFile((await file.path())!,'utf8');
}

async function exercise(page:Page, url:string, width:number) {
  await page.goto(url+'#list');
  const target = width===1280 ? 'A-17' : 'B-08';
  const eventId = 'single-'+width;
  const button = (name:string) => page.getByRole('button',{name,exact:true});
  const field = (name:string) => page.getByRole('textbox',{name,exact:true});
  const save = (name:string) => download(page,button(name+' 내려받기'),name);
  await page.getByLabel('1행 장비 이름',{exact:true}).fill('창구 '+width+' 노트북');
  await button('장비 추가').press('Enter');
  await page.getByLabel('4행 장비 번호',{exact:true}).fill('R-'+width);
  await page.getByLabel('4행 장비 이름',{exact:true}).fill('창구 예비 스캐너');
  await button('반납 목록 만들기').press('Enter');
  const list = await save(lessons[0].file);
  const initial:StarterRecord = JSON.parse(list);
  assert.ok(initial.equipment.some(row=>row.name==='창구 '+width+' 노트북'));
  assert.ok(initial.equipment.some(row=>row.equipmentId==='R-'+width && row.name==='창구 예비 스캐너'));
  assert.deepEqual(initial.equipment,initial.initialEquipment);
  assert.deepEqual(initial.initialHistory,[]);
  assert.deepEqual(initial.deliveries,[]);
  assert.deepEqual(initial.history,[]);

  await page.goto(url+'#notify');
  await page.reload();
  await page.getByLabel('입문 반납 목록 파일',{exact:true}).setInputFiles({
    name:lessons[0].file, mimeType:'application/json', buffer:Buffer.from(list),
  });
  await expect(field('입문 반납 목록')).toHaveValue(new RegExp('창구 '+width+' 노트북'));
  await button('목록 불러오기').press('Enter');
  await page.setViewportSize({width:width/2,height:900});
  await page.getByRole('combobox',{name:'대상 장비',exact:true}).selectOption(target);
  await field('알림 ID').fill(eventId);
  const send = button('검수 알림 한 번 입력');
  await send.press('Enter');
  await expect(send).toBeDisabled();
  const proof = await save(lessons[1].file);
  const received:StarterRecord = JSON.parse(proof);
  const event = {eventId,equipmentId:target,type:'inspection.completed'};
  assert.deepEqual(received.initialEquipment,initial.equipment);
  assert.deepEqual(received.equipment,initial.equipment.map(row=>row.equipmentId===target ? {...row,inspectionStatus:'검수 완료'} : row));
  assert.deepEqual(received.history,[event]);
  assert.deepEqual(received.deliveries,[{...event,result:'applied'}]);

  await page.goto(url+'#check');
  await page.reload();
  const input = field('초급 수신 기록');
  const verify = button('전후 검증하기');
  const report = button(lessons[2].file+' 내려받기');
  await input.fill(proof);
  await verify.press('Enter');
  const markdown = await download(page,report,lessons[2].file);
  for (const term of [eventId,target,'검수 대기','검수 완료','재대여']) assert.ok(markdown.includes(term),term);
  const advanced = await field('고급 실습용 검수 알림').inputValue();
  assert.deepEqual(JSON.parse(advanced),event);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if (width===1440 && screenshots) {
    await mkdir(screenshots,{recursive:true});
    await page.setViewportSize({width,height:900});
    await page.screenshot({path:join(screenshots,'equipment-inspection-starters-check.png'),fullPage:true});
  }
  received.equipment.find(row=>row.equipmentId==='C-03')!.rentalApproval='보류';
  await input.fill(JSON.stringify(received));
  await expect(report).toBeDisabled();
  await verify.press('Enter');
  await expect(report).toBeDisabled();
  await expect(page.locator('#check-status')).toContainText('재대여 승인');
  if (width===1440) {
    await page.goto(url+'#notify');
    await field('입문 반납 목록').fill(list);
    await button('목록 불러오기').press('Enter');
    await page.getByRole('combobox',{name:'대상 장비',exact:true}).selectOption('R-1440');
    await field('알림 ID').fill('repair-scanner');
    await send.press('Enter');
    await page.goto(url+'#check');
    await verify.press('Enter');
    const scannerReport = await download(page,report,lessons[2].file);
    assert.ok(scannerReport.includes('R-1440') && scannerReport.includes('repair-scanner'));
    const exampleEvent = JSON.parse(await field('고급 실습용 검수 알림').inputValue());
    assert.equal(exampleEvent.equipmentId,'A-17');
    assert.notEqual(exampleEvent.eventId,'repair-scanner');
    await expect(page.locator('#handoff-hint')).toContainText('R-1440');
  }
  return {inputs:[list,proof,proof],event:advanced};
}

async function reviewInStudio(page:Page,lesson:typeof lessons[number],value:string,width:number) {
  await page.setViewportSize({width,height:900});
  await page.goto('/?view=templates');
  await page.getByRole('combobox',{name:'실습 주제'}).selectOption({label:'웹 개발'});
  await page.getByRole('combobox',{name:'실습 수준'}).selectOption({label:lesson.level});
  await page.locator('[data-lesson-trigger="'+lesson.id+'"]').press('Enter');
  const guide = page.getByRole('dialog');
  const assignment = guide.getByRole('region',{name:'연결된 Skill'});
  await expect(assignment.getByText(lesson.skill,{exact:true})).toBeVisible();
  await page.setViewportSize({width:width/2,height:900});
  const opening = page.context().waitForEvent('page');
  await guide.getByRole('link',{name:'장비 반납 기초 실습 열기 (새 창)'}).press('Enter');
  const standalone = await opening;
  await expect(standalone).toHaveURL(url=>url.pathname===address && url.hash==='#'+lesson.stage);
  await standalone.close();
  await guide.getByRole('button',{name:'내 사본으로 시작',exact:true}).press('Enter');
  await expect(page).toHaveURL(url=>url.searchParams.has('edit'));
  await page.setViewportSize({width,height:900});
  const listButton = page.getByRole('button',{name:'목록으로 편집',exact:true});
  if (await listButton.getAttribute('aria-pressed')!=='true') await listButton.click();
  await page.locator('[data-canvas-block="skill-'+lesson.skill+'"]').press('Enter');
  const skill = page.getByRole('region',{name:'연결된 SKILL.md 지침'});
  await expect(skill.locator('.ws-picker-text')).toHaveText(await readFile(join(lesson.folder,lesson.skill,'SKILL.md'),'utf8'));
  if (!runWorker) return;
  await page.getByRole('button',{name:'시험 실행',exact:true}).click();
  const panel = page.getByRole('tabpanel',{name:'실행 결과'});
  await panel.getByRole('button',{name:'질문 실행',exact:true}).click();
  const wait = panel.locator('.run-wait');
  const input = wait.getByRole('textbox',{name:lesson.field+' 필수',exact:true});
  await expect(input).toBeVisible({timeout:30000});
  await page.setViewportSize({width:width/2,height:900});
  await input.fill(value);
  await wait.getByRole('button',{name:'같은 실행 이어가기'}).press('Enter');
  await expect(panel.locator('.run-answer-meta .run-state')).toHaveText('완료',{timeout:45000});
  const file = await download(page,panel.getByRole('button',{name:lesson.file+' 내려받기',exact:true}),lesson.file);
  if (lesson.stage==='check') {
    const receipt:StarterRecord = JSON.parse(value);
    assert.ok(file.includes(receipt.history[0].eventId));
    assert.ok(file.includes(receipt.history[0].equipmentId));
  } else assert.deepEqual(JSON.parse(file),JSON.parse(value));
}

const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome)?chrome:undefined)});
const temporary = await mkdtemp(join(tmpdir(),'inspection-starter-browser-'));
const html = join(temporary,'equipment-inspection-starters.html');
try {
  await writeFile(html,inspectionStartersHtml);
  for (const width of [1280,1440]) {
    const context = await browser.newContext({baseURL,viewport:{width,height:900}});
    try {
      const page = await context.newPage();
      const errors:string[]=[];
      page.on('pageerror',error=>errors.push(error.message));
      await context.setOffline(true);
      const sample = await exercise(page,pathToFileURL(html).href,width);
      assert.deepEqual(errors,[]);
      if (!baseURL) continue;
      await context.setOffline(false);
      const response = await context.request.get(address);
      assert.equal(response.status(),200);
      assert.equal(await response.text(),inspectionStartersHtml);
      await registerBrowserAccount(context);
      for (const [index,lesson] of lessons.entries()) await reviewInStudio(page,lesson,sample.inputs[index],width);
      await page.goto('/examples/equipment-inspection.html');
      await page.getByRole('textbox',{name:'검수 알림',exact:true}).fill(sample.event);
      const send = page.getByRole('button',{name:'알림 입력',exact:true});
      await send.press('Enter');
      await send.press('Enter');
      await page.getByText('검증 기록 보기',{exact:true}).click();
      const advanced = JSON.parse(await page.getByRole('textbox',{name:'검증 기록',exact:true}).inputValue());
      assert.equal(advanced.verified,true);
      assert.deepEqual(advanced.history,[JSON.parse(sample.event)]);
      assert.deepEqual(errors,[]);
    } finally {await context.close();}
  }
  console.log('PASS 웹 개발 입문·초급·중급 · 인터넷 없이 사용자 목록 작성, 알림 한 건, 전후 판정'+(baseURL?' · 고급에서 재사용, 작업실 사본과 원본 Skill':''));
} finally {
  await browser.close();
  await rm(html,{force:true});
  await rmdir(temporary);
}
