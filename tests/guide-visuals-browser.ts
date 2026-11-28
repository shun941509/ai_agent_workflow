import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { registerBrowserAccount } from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리 시험용 작업실 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined),
});

function figure(guide: Locator, title: string) {
  return guide.getByRole('figure', {name: title, exact: true});
}

async function verifyImages(visual: Locator, names?: string[]) {
  const images = visual.getByRole('img');
  if (names) await expect(images).toHaveCount(names.length);
  for (const [i, img] of (await images.all()).entries()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    assert.match(await img.getAttribute('alt') ?? '', /[가-힣]/);
    if (names) assert.ok((await img.getAttribute('src'))?.endsWith('/' + names[i]));
  }
}

async function verifyDialog(page: Page, visual: Locator, title: string, exit: 'escape' | 'close') {
  const name = title + ' 크게 보기';
  const opener = visual.getByRole('button', {name, exact: true});
  await opener.press('Enter');
  const dialog = page.getByRole('dialog', {name, exact: true});
  const close = dialog.getByRole('button', {name: '닫기', exact: true});
  await expect(close).toBeFocused();
  await expect(dialog).toHaveAccessibleDescription(/[가-힣]/);
  const viewport = dialog.getByRole('region', {name: title + ' 상세 그림', exact: true});
  const zoom = dialog.getByRole('button', {name: '1.5배 확대', exact: true});
  await expect(zoom).toHaveAttribute('aria-pressed', 'false');
  await zoom.press('Enter');
  await expect(zoom).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(viewport).toBeFocused();
  const bounds = await dialog.boundingBox();
  const width = page.viewportSize()!.width;
  assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1, title + ' 확대 창 너비');
  if (exit === 'escape') await page.keyboard.press('Escape');
  else await close.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
}

const faq = [
  {question:'질문을 어디에 입력하나요?', title:'질문 실행이 막힌 화면 비교', control:'설계 검사', files:['help-inspect.webp','quick-question.webp']},
  {question:'답에 나온 준비물을 어떻게 확인하나요?', title:'자료 원문 적용 전후', control:'변경 적용', files:['help-empty-source.webp','help-source-line.webp']},
  {question:'작업 지시를 바꿨는데 답이 그대로예요.', title:'이전 답변과 새 대화의 답변', control:'＋ 새 대화', files:['quick-answer.webp','help-quoted-answer.webp']},
];
const modelFAQ = {question:'모델 설정 필요가 보이면 무엇을 할 수 있나요?', title:'모델 연결 전후의 상태', control:'모델 설정됨', files:['help-model-status.webp']};

async function verifyLanding(page: Page, guide: Locator, modelReady: boolean) {
  const quick = guide.getByRole('region', {name:'예제를 연 뒤 따라 할 세 단계'});
  for (const [title, file] of [
    ['시험 실행 열기','quick-open.webp'], ['질문 보내기','quick-question.webp'], ['답변 확인하기','quick-answer.webp'],
  ]) {
    const item = figure(quick, title);
    await verifyImages(item, [file]);
    await verifyDialog(page, item, title, 'escape');
    await expect(quick.getByRole('link', {name:title, exact:true})).toBeVisible();
  }
  await guide.locator('summary').filter({hasText:'Agent와 일반 채팅은 어떻게 다른가요?'}).press('Enter');
  const title = '도서관 안내원이 답을 찾는 과정';
  const concept = figure(guide, title);
  await expect(concept).toContainText('일반 채팅의 예');
  await expect(concept).toContainText('도서관');
  await verifyImages(concept, ['request-to-answer.webp']);
  await verifyDialog(page, concept, title, 'close');
  const result = guide.locator('details').filter({has:page.locator('summary').filter({hasText:'이 질문의 실제 실행 결과 보기'})});
  const resultToggle = result.locator('summary');
  await resultToggle.press('Enter');
  await verifyImages(result, ['04-answer.png']);
  const screenshot = result.getByRole('button', {name:'첫 실행의 답변 확대'});
  await screenshot.press('Enter');
  const enlarged = page.getByRole('dialog', {name:'첫 실행의 답변 확대'});
  await expect(enlarged).toHaveAccessibleDescription(/[가-힣]/);
  await page.keyboard.press('Escape');
  await expect(screenshot).toBeFocused();
  await resultToggle.press('Enter');

  const questions = guide.getByRole('region', {name:'첫 실습에서 자주 묻는 질문'});
  const available = modelReady ? faq : [...faq, modelFAQ];
  for (const item of available) {
    await questions.locator('summary').filter({hasText:item.question}).press('Enter');
    const detail = figure(questions, item.title);
    await expect(detail).toContainText(item.control);
    await verifyImages(detail, item.files);
    await verifyDialog(page, detail, item.title, 'escape');
  }
  if (modelReady) await expect(questions.locator('summary').filter({hasText:modelFAQ.question})).toHaveCount(0);
}

async function verifyCreation(page: Page, guide: Locator) {
  const section = guide.getByRole('region', {name:'내 이름으로 Agent 만들기'});
  for (const [title, file, control] of [
    ['내 Agent에서 생성 시작','create-entry.webp','새 Agent'],
    ['이름과 시작 방법 설정','create-name.webp','Agent 이름'],
    ['입문 템플릿 선택','create-lesson.webp','질문에서 답변까지'],
    ['내 이름으로 사본 만들기','create-copy.webp','도서관 회원증 안내'],
    ['사본의 작업 지시 확인','create-instruction.webp','작업 지시'],
  ]) {
    const visual = figure(section, title);
    await expect(visual).toContainText(control);
    await verifyImages(visual, [file]);
    await verifyDialog(page, visual, title, 'close');
  }
}

async function verifyCases(page: Page, guide: Locator) {
  const cases = guide.getByRole('region', {name:'네 가지 Agent 활용 사례'});
  const topics = [
    ['업무 도우미','사용자 요청을 개발 업무로 바꾸기','끝낸 일을 목록에 다시 표시','sw-requirements'],
    ['문서 정리','회의 메모에서 확정한 일 골라내기','안내문 12부 인쇄','meeting-report'],
    ['정보 조사','방문 전 운영시간과 예약 함께 알아보기','어린 왕자','library-visit'],
    ['반복 업무','매번 들어오는 측정표에서 기준 초과 찾기','범위를 벗어났고','manufacturing-report'],
  ];
  const first = cases.getByRole('radio', {name:topics[0][0]});
  await first.focus();
  for (const [i, [label,title,result,template]] of topics.entries()) {
    if (i > 0) await page.keyboard.press('ArrowRight');
    const radio = cases.getByRole('radio', {name:label, exact:true});
    await expect(radio).toBeChecked();
    const visual = figure(cases, title);
    for (const text of ['받는 내용','맡기는 일','예상 결과',result]) await expect(visual).toContainText(text);
    const previewLink = cases.getByRole('link', {name:/미리보기/});
    const href = await previewLink.getAttribute('href');
    assert.equal(new URL(href!, baseURL).searchParams.get('template'), template);
    await verifyDialog(page, visual, title, 'close');
    if (template === 'meeting-report' || template === 'manufacturing-report') {
      const previewTitle = template === 'meeting-report' ? '회의록·업무 보고' : '반도체·제조 보고';
      await Promise.all([
        page.waitForURL(url => url.searchParams.get('template') === template),
        previewLink.press('Enter'),
      ]);
      await expect(guide.getByRole('heading', {name:previewTitle, exact:true})).toBeFocused();
      await page.goBack();
      await expect(page).toHaveURL(url => url.searchParams.get('section') === 'goals' && !url.searchParams.has('template'));
      await expect(radio).toBeChecked();
      await expect(previewLink).toBeFocused();
    }
    await radio.focus();
  }
}

async function verifyNarrowTemplatePicker(page: Page, guide: Locator) {
  await page.setViewportSize({width:390,height:780});
  await page.goto('/?view=guide&section=goals&step=1&template=beginner');
  const picker = guide.getByRole('combobox', {name:'만들고 싶은 결과', exact:true});
  await expect(picker).toHaveValue('beginner');
  await expect(guide.getByRole('radio', {name:'내 자료로 안내하기', exact:true})).toHaveCount(0);
  assert.ok((await picker.boundingBox())!.height >= 44);
  await picker.press('ArrowUp');
  await expect(picker).toHaveValue('intro');
  await expect(guide.getByRole('heading', {name:'질문에서 답변까지', exact:true})).toBeVisible();
  await picker.press('ArrowDown');
  await expect(picker).toHaveValue('beginner');
  await expect(guide.getByRole('heading', {name:'내 자료로 안내하기', exact:true})).toBeVisible();
}

try {
  for (const [width,height] of [[1280,800],[1440,900]]) {
    const context = await browser.newContext({baseURL, viewport:{width,height}});
    try {
      await registerBrowserAccount(context);
      const response = await context.request.post('/api/studio',{data:{action:'bootstrap', data:{}}});
      const {data:{modelReady}} = await response.json();
      assert.equal(typeof modelReady,'boolean');
      const page = await context.newPage();
      const errors:string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const guide = page.getByRole('article', {name:'Workflow 설계 가이드'});
      for (const [section,step] of [['start',1],['start',2],['terms',1],['goals',1]] as const) {
        await page.goto('/?view=guide&section='+section+'&step='+step);
        if (section === 'start' && step === 1) await verifyLanding(page, guide, modelReady);
        if (section === 'start' && step === 2) await verifyCreation(page, guide);
        if (section === 'terms') {
          const title = '설계부터 공유까지, 어디에서 무엇을 할까요?';
          const visual = figure(guide, title);
          for (const area of ['Workflow 편집기','도구 및 자료','시험 실행','버전과 공유']) await expect(visual).toContainText(area);
          await verifyDialog(page, visual, title, 'escape');
        }
        if (section === 'goals') await verifyCases(page, guide);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), section+' 본문 가로 넘침');
      }
      if (width === 1440) await verifyNarrowTemplatePicker(page, guide);
      assert.deepEqual(errors, []);
      console.log('가이드 시각 자료와 확대 검증 통과 · '+width+'px');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
