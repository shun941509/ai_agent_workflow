import assert from 'node:assert/strict';
import {isIntroExampleAnswer} from '../src/domain/intro-example-answer';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, type Locator, type Page, type Request } from '@playwright/test';
import { levels, palette, type Graph } from '../src/domain';
import { executeGraph, type EngineResult, type ModelInput } from '../src/engine';
import { registerBrowserAccount } from './browser-account';
import { guideHelp, guideSteps, libraryQuestion as question } from '../src/ui/guide/content';
import { templateOutcomes } from '../src/ui/guide/template-outcomes';
import { libraryTemplates as templates } from '../src/domain/templates';
import {workDocuments} from '../src/domain/work-documents';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리 시험용 작업실 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined),
});
const answer = '회원증을 만들 때는 본인 신분증만 있으면 됩니다.';
const optionalId = '신분증 지참은 선택 사항입니다.';
const citation = '회원증을 처음 만들 때는 신분증을 가져오세요.';
const changedInstruction = '답을 쓰고 다음 줄에 안내문의 근거 문장을 그대로 인용하세요.';

async function verifyTemplatePreviews(page: Page, guide: Locator, mobile: boolean) {
  const field = '만들고 싶은 결과';
  const optionCount = templates.length + workDocuments.length + 1; // 할 일 앱 요구사항
  const list = guide.getByRole('combobox', { name: field, exact: true });
  const options = guide.getByRole('group', { name: field, exact: true });
  const select = async (lesson: typeof templates[number]) => {
    if (await list.isVisible()) await list.selectOption(lesson.id);
    else await options.getByRole('radio', { name: lesson.title, exact: true }).check();
  };
  const getProjects = async () => {
    const result = await page.request.post('/api/studio', { data: { action: 'project.list', data: {} } });
    assert.ok(result.ok());
    return (await result.json()).data;
  };
  const projectsBefore = await getProjects();
  const writes: string[] = [];
  const observeWrites = (request: Request) => {
    if (request.method() !== 'POST' || !request.url().endsWith('/api/studio')) return;
    const { action } = request.postDataJSON();
    if (/^(project\.(create|copy|save)|versions\.(decide|publish|save|restore)|run\.start)$/.test(action)) writes.push(action);
  };
  page.on('request', observeWrites);
  try {
    if (mobile) {
      await expect(list).toBeVisible();
      await expect(list.locator('option')).toHaveCount(optionCount);
    } else {
      await expect(options.getByRole('radio')).toHaveCount(optionCount);
      await select(templates[0]);
      await options.getByRole('radio', { name: templates[0].title, exact: true }).focus();
    }
    for (const lesson of templates) {
      const radio = options.getByRole('radio', { name: lesson.title, exact: true });
      if (mobile) await list.selectOption(lesson.id);
      else await expect(radio).toBeChecked();
      const preview = guide.getByRole('region', { name: lesson.title + ' 미리보기', exact: true });
      await expect(preview).toBeVisible();
      await expect(page).toHaveURL(url => url.searchParams.get('section') === 'goals' && !url.searchParams.has('edit'));
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(preview).toContainText(lesson.question);
      await expect(preview).toContainText('예상 결과');
      const outcome = templateOutcomes[lesson.id];
      await expect(preview.getByText(outcome.layout, { exact: true })).toBeVisible();
      await expect(preview.getByText(outcome.condition, { exact: true })).toBeVisible();
      await expect(preview.getByText(outcome.result, { exact: true })).toBeVisible();
      if (lesson.id === 'peer-review' || lesson.id === 'dynamic') {
        const material = lesson.id === 'peer-review' ? '교정 사유 표시 Skill' : '강변도서관 보완 안내문';
        const comparison = lesson.id === 'peer-review' ? '사실 검토 담당의 기록에만' : '평일 오전 11시에 엽니다.';
        await expect(preview.getByText('선택 실습', { exact:true })).toBeVisible();
        await expect(preview.getByRole('listitem').filter({hasText:material})).toBeVisible();
        await expect(preview.getByRole('listitem').filter({hasText:comparison})).toBeVisible();
      }
      const figures = preview.getByRole('figure');
      await expect(figures).toHaveCount(1);
      const outer = figures.first().getByRole('img');
      await outer.scrollIntoViewIfNeeded();
      await expect(outer).toHaveAccessibleName(/\S/);
      await expect.poll(() => outer.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      const topImage = lesson.id === 'intro' ? 'terms-workflow' : 'goal-' + lesson.id;
      await expect(outer).toHaveAttribute('src', '/guide/captures/' + topImage + '.png');
      const team = lesson.graph.nodes.some(node => node.graph);
      const childLayout = preview.getByText('내부 블록 배치 보기', { exact: true });
      if (team) {
        await childLayout.press('Enter');
        await expect(figures).toHaveCount(2);
        const inner = figures.nth(1).getByRole('img');
        await inner.scrollIntoViewIfNeeded();
        await expect.poll(() => inner.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
        const innerSource = '/guide/captures/goal-' + lesson.id + '-team.png';
        await expect(inner).toHaveAttribute('src', innerSource);
        if (lesson.id === 'dynamic') {
          const enlarge = figures.nth(1).getByRole('button', { name: /확대$/ });
          await enlarge.press('Enter');
          const dialog = page.getByRole('dialog');
          await expect(dialog.getByRole('img')).toHaveAttribute('src', innerSource);
          await dialog.getByRole('button', { name: '2배로 확대', exact: true }).press('Enter');
          await expect.poll(() => dialog.getByRole('img').evaluate((image: HTMLImageElement) =>
            image.clientWidth / image.naturalWidth)).toBeCloseTo(2, 1);
          await page.keyboard.press('Escape');
          await expect(enlarge).toBeFocused();
        }
        await childLayout.press('Enter');
        await expect(figures).toHaveCount(1);
      } else await expect(childLayout).toHaveCount(0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      if (!mobile) await radio.press('ArrowRight');
    }
    if (mobile) {
      await page.setViewportSize({ width: 320, height: 568 });
      await list.selectOption('dynamic');
      const preview = guide.getByRole('region', { name: /생성 한도와 실패 처리 설계 미리보기/ });
      await expect(preview.getByText('내부 블록 배치 보기', { exact: true })).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.setViewportSize({ width: 390, height: 844 });
    }
    assert.deepEqual(writes, []);
    assert.deepEqual(await getProjects(), projectsBefore);
    await select(templates.find(lesson => lesson.id === 'library-visit')!);
  } finally {
    page.off('request', observeWrites);
  }
}

async function exercise(mobile: boolean) {
  const width = mobile ? 390 : 1440;
  const context = await browser.newContext({
    baseURL, viewport: { width, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile,
  });
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(baseURL!).origin });
    await registerBrowserAccount(context);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    const dialog = (name: string) => page.getByRole('dialog', { name, exact: true });
    const editor = page.locator('.ws-editor');
    const canvas = editor.locator('.ws-canvas');
    const block = (id: string) => canvas.locator('[data-canvas-block=' + JSON.stringify(id) + ']');
    const guide = page.getByRole('article', { name: 'Workflow 설계 가이드' });
    const sections = guide.getByRole('navigation', { name: '가이드 메뉴', exact: true });
    const steps = guide.getByRole('navigation', { name: '첫 실습 단계' });
    const section = (name: string) => sections.getByRole('link', { name, exact: true });
    const menuLabels = ['처음 시작하기', '목적별로 만들기', '기능·용어', '문제 해결', '블록·자료 찾아보기', '메뉴별 사용법'];
    const verifyGuideMenu = async (active: string) => {
      await expect(sections.getByRole('link')).toHaveText(menuLabels);
      await expect(sections.getByRole('button')).toHaveCount(0);
      await expect(sections.locator('a[aria-current="page"]')).toHaveText([active]);
      await expect(guide.getByRole('navigation', { name: '가이드 참고 탭', exact: true })).toHaveCount(0);
    };
    const goToStep = (name: string) => steps.getByRole('button', { name: new RegExp(name) }).press('Enter');
    const coach = page.getByRole('region', { name: '현재 실습 안내', exact: true });
    const coachButton = (name: string) => coach.getByRole('button', { name, exact: true });
    const verifyStep = async (title: string) => {
      await expect(coach.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(coach.getByText('완료 기준', { exact: true })).toBeVisible();
    };
    const nav = page.getByRole('navigation', { name: '작업 화면' });

    const openGuide = async () => {
      if (mobile) await button('메뉴 열기').click();
      await nav.getByRole('button', { name: '가이드', exact: true }).click();
      await expect(guide).toBeVisible();
      await expect(page).toHaveURL(url => url.searchParams.get('view') === 'guide');
      await expect(dialog('Workflow 설계 가이드')).toHaveCount(0);
    };
    const capture = async (name: string, captureWidth = width) => {
      const directory = process.env.STUDIO_SCREENSHOTS;
      if (!directory) return;
      mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: join(directory, `workflow-guide-${name}-${captureWidth}.png`) });
    };
    const readGraph = async (id: string): Promise<Graph> => {
      const response = await context.request.post('/api/studio', { data: { action: 'project.open', data: { id } } });
      assert.ok(response.ok(), await response.text());
      return (await response.json()).data.graph;
    };
    const projectId = async () => {
      await expect(editor).toBeVisible();
      await expect(page).toHaveURL(/[?&]edit=[^&]+/);
      return new URL(page.url()).searchParams.get('edit')!;
    };

    if (mobile) await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await openGuide();
    const openExample = guide.getByRole('button', { name: '예제로 시작하기', exact: true });
    const startBlank = guide.getByRole('button', { name: '빈 설계 시작하기', exact: true });
    // Check the first viewport before a click or keyboard focus scrolls it.
    await expect(openExample).toBeInViewport({ ratio: 1 });
    await verifyGuideMenu('처음 시작하기');
    const destinations = await sections.getByRole('link').evaluateAll(links => links.map(link => {
      const url = new URL((link as HTMLAnchorElement).href);
      return [url.searchParams.get('view'), url.searchParams.get('section'), url.searchParams.get('step')];
    }));
    assert.deepEqual(destinations, ['start', 'goals', 'terms', 'help', 'blocks', 'menus'].map(id => ['guide', id, '1']));
    if (mobile) {
      const allLinksFit = () => sections.getByRole('link').evaluateAll(links => links.every(link => {
        const bounds = link.getBoundingClientRect();
        return bounds.width > 0 && bounds.left >= 0 && bounds.right <= window.innerWidth + 1;
      }));
      assert.ok(await allLinksFit());
      await capture('landing', 320);
      await page.setViewportSize({ width, height: 844 });
      await expect(openExample).toBeInViewport({ ratio: 1 });
      assert.ok(await allLinksFit());
    }
    await expect(guide.getByText('완성할 결과', { exact: true })).toBeVisible();
    await expect(guide.getByText('준비사항', { exact: true })).toBeVisible();
    await expect(guide.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(startBlank).toHaveCount(0);
    const overview = guide.getByRole('button', { name: '작업실에서 가이드를 여는 위치 확대' });
    await expect.poll(() => overview.evaluate(element => {
      const img = element.querySelector('img');
      return !!img && img.naturalWidth > 0 && img.clientWidth <= element.clientWidth + 1;
    })).toBe(true);
    await capture('landing');
    await goToStep('질문 실행');
    await expect(guide.getByRole('heading', { name: guideSteps[2].title })).toBeFocused();
    await expect(guide.getByRole('checkbox')).toHaveCount(0);
    const questionImage = guide.getByRole('img').first();
    await expect.poll(() => questionImage.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const zoom = guide.getByRole('button', { name: '시험 질문과 실행 버튼 확대' });
    await zoom.press('Enter');
    const enlarged = dialog('시험 질문과 실행 버튼 확대');
    await expect(enlarged.getByRole('img')).toBeVisible();
    await enlarged.getByRole('button', { name: /원본 크기로 보기|화면에 맞추기/ }).press('Enter');
    await enlarged.getByRole('button', { name: '2배로 확대', exact: true }).press('Enter');
    await expect.poll(() => enlarged.getByRole('img').evaluate((img: HTMLImageElement) => img.clientWidth / img.naturalWidth)).toBeCloseTo(2, 1);
    await page.keyboard.press('Escape');
    await expect(zoom).toBeFocused();
    await guide.getByRole('button', { name: '시험 질문 복사', exact: true }).press('Enter');
    await expect(guide.getByRole('status')).toContainText('복사했습니다');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), question);
    await expect(guide.getByRole('checkbox')).toHaveCount(0);
    await guide.getByRole('navigation', { name: '단계 이동' }).getByRole('button', { name: '다음 단계' }).press('Enter');
    await expect(guide.getByRole('heading', { name: guideSteps[3].title })).toBeFocused();
    await expect(page).toHaveURL(url => url.searchParams.get('step') === '4');
    await page.reload();
    await expect(guide.getByRole('heading', { name: guideSteps[3].title })).toBeVisible();
    await guide.getByText('비교할 규정 원문 보기', { exact: true }).press('Enter');
    await expect(guide.getByRole('button', { name: '도서관 이용규정의 자료 원문 확대' })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    for (const [index, step] of guideSteps.entries()) {
      const number = index + 1;
      await steps.getByRole('button').nth(index).press('Enter');
      const chapter = guide.getByRole('region', { name: step.title, exact: true });
      await expect(chapter.getByText('이 단계에서 막혔을 때', { exact: true })).toBeVisible();
      const tip = chapter.getByText(step.tip, { exact: true });
      await expect(tip).toBeVisible();
      if (number === 3) {
        await tip.scrollIntoViewIfNeeded();
        await capture('question-step-help');
      }
      const issue = guideHelp.find(item => item.id === step.helpId);
      assert.ok(issue, number + '단계의 문제 해결 항목을 찾을 수 있어야 합니다.');
      const triggers = [chapter.getByRole('button', { name: /^문제 해결( 열기)?$/ }), section('문제 해결')];
      const helpAddress = new URL(await triggers[1].evaluate(link => (link as HTMLAnchorElement).href));
      assert.equal(helpAddress.searchParams.get('step'), String(number));
      assert.equal(helpAddress.searchParams.get('issue'), issue.id);
      if (!mobile && number === 3) {
        const [helpTab] = await Promise.all([
          context.waitForEvent('page'), triggers[1].click({ modifiers: ['Control'] }),
        ]);
        try {
          await expect(helpTab).toHaveURL(helpAddress.href);
          await expect(helpTab.getByRole('heading', { name: issue.title, exact: true })).toBeVisible();
          await expect(chapter).toBeVisible();
        } finally {
          await helpTab.close();
        }
      }
      for (const [source, trigger] of triggers.entries()) {
        if (mobile) await trigger.tap();
        else await trigger.press('Enter');
        await expect(page).toHaveURL(url => url.searchParams.get('section') === 'help'
          && url.searchParams.get('step') === String(number) && url.searchParams.get('issue') === issue.id);
        const problem = guide.getByRole('region', { name: issue.title, exact: true });
        const heading = problem.getByRole('heading', { name: issue.title, exact: true });
        await expect(heading).toHaveAttribute('id', 'guide-help-' + issue.id);
        await expect(heading).toBeFocused();
        await expect(heading).toBeInViewport();
        if (index === 2 && source === 1) {
          await page.reload();
          await expect(heading).toBeFocused();
          await expect(heading).toBeInViewport();
          await expect.poll(() => problem.getByRole('img').evaluate((img: HTMLImageElement) =>
            img.complete && img.naturalWidth > 0)).toBe(true);
          await capture('question-troubleshooting');
          const failure = guide.getByRole('navigation', { name: '문제 상황 바로가기' }).getByRole('link', { name: '실행 실패', exact: true });
          const failureHeading = guide.locator('#guide-help-run');
          if (!mobile) {
            const [otherTab] = await Promise.all([context.waitForEvent('page'), failure.click({ modifiers: ['Control'] })]);
            try {
              await expect(otherTab.locator('#guide-help-run')).toBeFocused();
              await otherTab.getByRole('button', { name: '3단계로 돌아가기' }).press('Enter');
              await expect(otherTab.getByRole('heading', { name: guideSteps[2].title })).toBeFocused();
            } finally { await otherTab.close(); }
          }
          await failure.press('Enter');
          await page.reload();
          await expect(failureHeading).toBeFocused();
          await expect(problem.getByRole('button', { name: '3단계로 돌아가기' })).toHaveCount(0);
          await guide.getByRole('region', { name: await failureHeading.innerText() })
            .getByRole('button', { name: '3단계로 돌아가기' }).press('Enter');
          await expect(chapter.getByRole('heading', { name: step.title, exact: true })).toBeFocused();
          continue;
        }
        await problem.getByRole('button', { name: number + '단계로 돌아가기', exact: true }).press('Enter');
        await expect(page).toHaveURL(url => url.searchParams.get('section') === 'start'
          && url.searchParams.get('step') === String(number) && !url.searchParams.has('issue'));
        await expect(chapter.getByRole('heading', { name: step.title, exact: true })).toBeFocused();
      }
    }
    await goToStep('답변 확인');
    await section('기능·용어').press('Enter');
    await section('문제 해결').press('Enter');
    await expect(page).toHaveURL(url => url.searchParams.get('section') === 'help' && !url.searchParams.has('issue'));
    const helpNav = guide.getByRole('navigation', { name: '문제 상황 바로가기' });
    await verifyGuideMenu('문제 해결');
    assert.equal(guideHelp.length, 6);
    await expect(helpNav.getByRole('link')).toHaveCount(guideHelp.length);
    await expect(guide.getByRole('figure')).toHaveCount(guideHelp.length);
    await expect(guide.getByRole('heading', { name: '해결 확인', level: 4, exact: true })).toHaveCount(guideHelp.length);
    const helpHistory = await page.evaluate(() => window.history.length);
    await capture('troubleshooting');
    for (const item of guideHelp) {
      const region = guide.getByRole('region', { name: item.title, exact: true });
      const heading = region.getByRole('heading', { name: item.title, exact: true });
      const link = helpNav.getByRole('link', { name: item.shortLabel, exact: true });
      await expect(heading).toBeVisible();
      await expect(region.locator('ol li:visible')).toHaveText(item.actions);
      await expect(region.getByText(item.success, { exact: true })).toBeVisible();
      const targetId = 'guide-help-' + item.id;
      const address = new URL(await link.evaluate(element => (element as HTMLAnchorElement).href));
      assert.equal(address.searchParams.get('issue'), item.id);
      await expect(heading).toHaveAttribute('id', targetId);
      await expect(heading).toHaveAttribute('tabindex', '-1');
      if (mobile) await link.tap();
      else await link.press('Enter');
      await expect(heading).toBeFocused();
      await expect(heading).toBeInViewport();
      await expect(page).toHaveURL(address.href);
      await expect(guide.getByRole('button', { name: /단계로 돌아가기$/ })).toHaveCount(0);
      const figure = region.getByRole('figure');
      const image = figure.getByRole('img');
      const src = '/guide/captures/' + item.image + '.png';
      await expect(image).toHaveAttribute('src', src);
      await expect(image).toHaveAccessibleName(/\S/);
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      await expect(figure.locator('figcaption')).toContainText('실제 제품 화면');
      const enlarge = figure.getByRole('button', { name: /확대$/ });
      await enlarge.press('Enter');
      const expanded = page.getByRole('dialog');
      await expect(expanded.getByRole('img')).toHaveAttribute('src', src);
      await page.keyboard.press('Escape');
      await expect(enlarge).toBeFocused();
    }
    assert.equal(await page.evaluate(() => window.history.length), helpHistory);
    if (mobile) {
      await page.setViewportSize({ width: 320, height: 568 });
      const lastIssue = guideHelp[guideHelp.length - 1];
      await helpNav.getByRole('link', { name: lastIssue.shortLabel, exact: true }).tap();
      const heading = guide.getByRole('heading', { name: lastIssue.title, exact: true });
      await expect(heading).toBeFocused();
      await expect(heading).toBeInViewport();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.setViewportSize({ width, height: 844 });
    }
    await section('처음 시작하기').press('Enter');
    await expect(guide.getByRole('heading', { name: guideSteps[3].title })).toBeFocused();
    await section('기능·용어').press('Enter');
    await verifyGuideMenu('기능·용어');
    const glossary = guide.getByRole('group', { name: '그림으로 볼 용어', exact: true });
    const termImages = [
      ['Workflow', 'terms-workflow'], ['Agent', 'terms-agent'], ['블록', 'terms-block'],
      ['연결선', 'terms-connection'], ['자료', 'source-rule'], ['도구', 'terms-tool'],
    ];
    const termTitles = new Set<string>();
    await expect(glossary.getByRole('radio')).toHaveCount(termImages.length);
    const firstTerm = glossary.getByRole('radio', { name: 'Workflow', exact: true });
    const targetId = await firstTerm.getAttribute('aria-controls');
    assert.ok(targetId, '용어 선택이 설명 영역과 연결되어야 합니다.');
    const exampleRegion = guide.locator('[id=' + JSON.stringify(targetId) + ']');
    await firstTerm.focus();
    for (const [name, imageId] of termImages) {
      const term = glossary.getByRole('radio', { name, exact: true });
      await expect(term).toBeChecked();
      await expect(term).toBeFocused();
      await expect(term).toHaveAccessibleDescription(/\S/);
      await expect(term).toHaveAttribute('aria-controls', targetId);
      await expect(exampleRegion.getByRole('heading', { name: '화면에서 찾아보기', exact: true })).toBeVisible();
      const title = (await exampleRegion.getByRole('heading', { level: 3 }).innerText()).trim();
      assert.ok(title && !termTitles.has(title), name + '의 설명 제목을 확인하세요.');
      termTitles.add(title);
      const figure = exampleRegion.getByRole('figure');
      await expect(figure).toHaveCount(1);
      const image = figure.getByRole('img');
      const src = '/guide/captures/' + imageId + '.png';
      await expect(image).toHaveAttribute('src', src);
      await expect(image).toHaveAccessibleName(/\S/);
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((img: HTMLImageElement) =>
        img.complete && img.naturalWidth > 0 && img.clientWidth <= document.documentElement.clientWidth)).toBe(true);
      await expect(figure.locator('figcaption')).toContainText('실제 제품 화면');
      if (name === '연결선') {
        const location = exampleRegion.getByText('캔버스에서 이 선의 위치 보기', { exact: true });
        await location.press('Enter');
        await expect(figure).toHaveCount(2);
        await expect(figure.nth(1).getByRole('img')).toHaveAttribute('src', '/guide/captures/terms-workflow.png');
        await location.press('Enter');
        await expect(figure).toHaveCount(1);
      }
      if (name === '도구') {
        const enlarge = figure.getByRole('button', { name: /확대$/ });
        await enlarge.press('Enter');
        const enlargedTool = page.getByRole('dialog');
        await expect(enlargedTool.getByRole('img')).toHaveAttribute('src', src);
        await enlargedTool.getByRole('button', { name: '2배로 확대', exact: true }).press('Enter');
        await expect.poll(() => enlargedTool.getByRole('img').evaluate((img: HTMLImageElement) =>
          img.clientWidth / img.naturalWidth)).toBeCloseTo(2, 1);
        await page.keyboard.press('Escape');
        await expect(enlarge).toBeFocused();
      }
      await term.press('ArrowRight');
    }
    await expect(firstTerm).toBeChecked();
    await expect(firstTerm).toBeFocused();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await capture('glossary');
    if (mobile) {
      await page.setViewportSize({ width: 320, height: 568 });
      const tool = glossary.getByRole('radio', { name: '도구', exact: true });
      await tool.tap();
      await expect(tool).toBeChecked();
      await expect(exampleRegion.getByRole('figure').getByRole('img')).toHaveAccessibleName(/\S/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.setViewportSize({ width, height: 844 });
    }
    const linkedGallery = guide.getByRole('link', { name: '도서관 방문 준비하기에서 보기', exact: true });
    const toolTerm = glossary.getByRole('radio', { name: '도구', exact: true });
    await toolTerm.check();
    await linkedGallery.press('Enter');
    const libraryTitle = guide.getByRole('heading', { name: '도서관 방문 준비하기', exact: true });
    await expect(libraryTitle).toBeFocused();
    await guide.getByRole('button', { name: '도구 설명으로 돌아가기' }).press('Enter');
    await expect(toolTerm).toBeChecked();
    await expect(linkedGallery).toBeFocused();
    const referenceName = '블록·자료 찾아보기';
    const menuName = '메뉴별 사용법';
    const reference = guide.getByRole('region', { name: referenceName, exact: true });
    const menus = guide.getByRole('region', { name: menuName, exact: true });
    const openReference = async (name: string, target: Locator) => {
      const tab = section(name);
      if (mobile) await tab.tap();
      else await tab.press('Enter');
      const key = name === referenceName ? 'blocks' : 'menus';
      await expect(page).toHaveURL(url => url.searchParams.get('section') === key);
      await verifyGuideMenu(name);
      await expect(name === referenceName ? menus : reference).toBeHidden();
      await expect(glossary).toBeHidden();
      const heading = target.getByRole('heading', { name, level: 2, exact: true });
      await expect(heading).toBeFocused();
      await expect(heading).toBeInViewport();
    };
    await expect(menus).toBeHidden();
    await expect(reference).toBeHidden();
    await openReference(menuName, menus);
    const menuItems = menus.locator('dt');
    await expect(menuItems).toHaveText(['작업실 홈', 'Workflow 편집기', '내 Agent', '도구 및 자료', '공유 Agent',
      '공유 도구 및 자료', '수준별 템플릿', '설계 가져오기', '가이드']);
    await expect(menus.locator('dd')).toHaveCount(9);
    for (const description of await menus.locator('dd').all()) {
      await expect(description).toBeVisible();
      await expect(description).toContainText(/\S/);
    }
    await capture('menu-reference');
    await openReference(referenceName, reference);
    await page.reload();
    await verifyGuideMenu(referenceName);
    await expect(reference).toBeVisible();
    await capture('block-reference');
    const search = reference.getByRole('searchbox', { name: '블록·자료 이름 검색' });
    const status = reference.getByRole('status');
    const levelsFilter = reference.getByRole('group', { name: '블록 추천 수준', exact: true });
    const allLevels = levelsFilter.getByRole('radio', { name: '전체', exact: true });
    const grouped = reference.getByRole('heading', { level: 4 });
    const materials = ['참고 자료', 'Skill', '지식 저장소', 'MCP 연결'];
    const groupTitle = (level: typeof levels[number]) =>
      level + '부터 추천 · ' + palette.filter(block => block.level === level).length + '개';
    await expect(allLevels).toBeChecked();
    await expect(status).toContainText('설계 블록 32개');
    await expect(status).toContainText('자료 종류 4개');
    await expect(grouped).toHaveText(levels.map(groupTitle));
    await expect(reference.locator('dt:visible')).toHaveCount(materials.length + palette.length);
    let currentLevel = allLevels;
    for (const level of levels) {
      await currentLevel.press('ArrowRight');
      currentLevel = levelsFilter.getByRole('radio', { name: level, exact: true });
      await expect(currentLevel).toBeChecked();
      await expect(currentLevel).toBeFocused();
      await expect(grouped).toHaveText([groupTitle(level)]);
      await expect(status).toContainText('자료 종류 4개');
      const expected = palette.filter(block => block.level === level).map(block => block.name);
      await expect(reference.locator('dt:visible')).toHaveText([...expected, ...materials]);
    }
    await search.fill('내 예약 조회');
    await expect(reference.getByText('MCP 연결', { exact: true })).toBeVisible();
    await expect(reference.getByText('도서관 예약 조회 MCP', { exact: true })).toBeVisible();
    await expect(reference.getByText('내 예약 조회', { exact: true })).toBeVisible();
    await search.fill('MCP');
    const relatedBlock = reference.getByRole('button', { name: '사용하는 블록 · 도구 사용(중급)' });
    await relatedBlock.press('Enter');
    await expect(reference.getByRole('heading', { name: '도구 사용', exact: true })).toBeFocused();
    await reference.getByRole('button', { name: '검색 결과로 돌아가기', exact: true }).press('Enter');
    await expect(relatedBlock).toBeFocused();
    await linkedGallery.press('Enter');
    await page.reload();
    await expect(libraryTitle).toBeFocused();
    await guide.getByRole('button', { name: '블록·자료 검색 결과로 돌아가기' }).press('Enter');
    await expect(linkedGallery).toBeFocused();
    await expect(search).toHaveValue('MCP');
    await expect(levelsFilter.getByRole('radio', {name:'전문가'})).toBeChecked();
    await search.fill('조건 분기');
    await expect(reference.getByText('조건 분기', { exact: true })).toHaveCount(0);
    await allLevels.check();
    await expect(search).toHaveValue('조건 분기');
    await expect(reference.getByText('조건 분기', { exact: true })).toBeVisible();
    await expect(reference.getByText('조건 분기', { exact: true }).locator('.ws-block-icon')).toBeVisible();
    await search.fill('Skill');
    await expect(reference.getByText('Skill', { exact: true })).toBeVisible();
    await expect(reference.getByText('조건 분기', { exact: true })).toBeHidden();
    const expertLevel = levelsFilter.getByRole('radio', { name: '전문가', exact: true });
    await expertLevel.check();
    await openReference(menuName, menus);
    await section('기능·용어').press('Enter');
    await expect(menus).toBeHidden();
    await expect(reference).toBeHidden();
    const materialTerm = glossary.getByRole('radio', { name: '자료', exact: true });
    await materialTerm.check();
    await expect(materialTerm).toBeChecked();
    await openReference(referenceName, reference);
    await expect(search).toHaveValue('Skill');
    await expect(expertLevel).toBeChecked();
    await expect(reference.getByText('Skill', { exact: true })).toBeVisible();
    await search.fill('일치 항목 없음 확인');
    await expect(reference.getByRole('status')).toContainText('일치하는 항목이 없습니다');
    await search.fill('');
    await allLevels.check();
    await expect(grouped).toHaveText(levels.map(groupTitle));
    if (mobile) {
      await page.setViewportSize({ width: 320, height: 568 });
      await reference.getByRole('link', { name: '자료 설명으로 이동', exact: true }).press('Enter');
      const materialHeading = reference.getByRole('heading', { name: '도구 및 자료에서 등록하는 자료', level: 3 });
      await expect(materialHeading).toBeFocused();
      await expect(materialHeading).toBeInViewport();
      await levelsFilter.getByRole('radio', { name: '전문가', exact: true }).tap();
      await expect(grouped).toHaveText([groupTitle('전문가')]);
      await openReference(menuName, menus);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.setViewportSize({ width, height: 844 });
    }
    await section('목적별로 만들기').press('Enter');
    await verifyGuideMenu('목적별로 만들기');
    await verifyTemplatePreviews(page, guide, mobile);
    await capture('template-preview');
    await guide.getByRole('button', { name: '이 템플릿 열기', exact: true }).press('Enter');
    await expect(dialog('도서관 방문 준비하기')).toBeVisible();
    await expect(page).toHaveURL(url => url.searchParams.get('lesson') === 'library-visit');
    await page.reload();
    await expect(dialog('도서관 방문 준비하기')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog('도서관 방문 준비하기')).toBeHidden();
    await openGuide();
    await expect(guide.getByRole('button', { name: '읽던 4단계 이어 보기' })).toBeVisible();
    await section('블록·자료 찾아보기').press('Enter');
    await section('처음 시작하기').press('Enter');
    await page.reload();
    await guide.getByRole('button', { name: '읽던 4단계 이어 보기' }).press('Enter');
    await expect(guide.getByRole('heading', { name: guideSteps[3].title })).toBeFocused();
    await expect(guide.getByRole('checkbox')).toHaveCount(0);
    await guide.getByRole('button', { name: '처음부터 보기' }).press('Enter');
    await expect(guide.getByRole('heading', { name: guideSteps[0].title })).toBeFocused();
    await expect(guide.getByRole('button', { name: /읽던 .*단계 이어 보기/ })).toHaveCount(0);
    await openExample.click();
    const exampleId = await projectId();
    await expect(guide).toBeHidden();
    const original = await readGraph(exampleId);
    const originalInstruction = original.nodes.find(node => node.id === 'agent')?.config.instruction;
    assert.match(String(originalInstruction), /한 문장/);
    await verifyStep('첫 답변 읽기');
    await coachButton('전체 가이드').press('Enter');
    await expect(guide.getByRole('heading', { name: guideSteps[2].title })).toBeVisible();
    await goToStep('지시 바꾸기');
    const reopenExample = guide.getByRole('button', { name: '예제 편집기 열기', exact: true });
    await reopenExample.press('Enter');
    assert.equal(await projectId(), exampleId);
    await verifyStep('작업 지시 바꾸기');
    await expect(coach.getByText('비교할 첫 답변이 필요합니다', { exact: true })).toBeVisible();
    await coachButton('전체 가이드').press('Enter');
    await expect(page).toHaveURL(url => url.searchParams.get('view') === 'guide' && url.searchParams.get('step') === '5');
    await page.reload();
    await expect(guide.getByRole('heading', { name: guideSteps[4].title })).toBeVisible();
    await reopenExample.press('Enter');
    await coachButton('첫 답변 읽기로 이동').press('Enter');
    await verifyStep('첫 답변 읽기');
    if (mobile) {
      await block('rules').press('Enter');
      await expect(page.getByRole('textbox', { name: '자료 원문', exact: true })).toHaveValue(new RegExp(citation));
      await button('속성 닫기').click();
      await button('캔버스로 보기').click();
    }
    await expect(canvas).toBeInViewport();
    await capture('coach-example');

    const practiceIds = new Set([exampleId]);
    const attempts: { project: string; input: string; conversation?: string; instruction: unknown }[] = [];
    const modelCalls: ModelInput[] = [];
    const fixtureRun = (index: number, input: string, result: EngineResult, isExampleAnswer: boolean) => ({
      id: 'guide-run-' + index, conversation: 'guide-conversation-' + index, state: result.status, mode: 'test', input,
      output: result.output, events: result.events, error: result.error, isExampleAnswer,
      created: '2026-01-01T00:00:0' + index + '.000Z', updated: '2026-01-01T00:00:0' + index + '.000Z',
    });
    const runs: ReturnType<typeof fixtureRun>[] = [];
    // Run the saved graph through the engine with a deterministic model instead of the live worker.
    await page.route('**/api/studio', async route => {
      const { action, data } = route.request().postDataJSON();
      if (!practiceIds.has(data?.id)) return route.continue();
      if (action === 'run.get') return route.fulfill({ json: { data: runs.find(run => run.id === data.runId) } });
      if (action === 'run.inputFiles' && runs.some(run => run.conversation === data.conversation)) {
        return route.fulfill({ json: { data: { accept: null } } });
      }
      if (action !== 'run.start') return route.continue();
      const graph = await readGraph(data.id);
      const index = attempts.length;
      attempts.push({ project: data.id, input: data.input, conversation: data.conversation,
        instruction: graph.nodes.find(node => node.type === 'ai.single_task')?.config.instruction });
      const result = await executeGraph(graph, { runId: 'guide-run-' + index, input: data.input }, {
        scopeModel: async () => ({text:'{"status":"in_scope"}'}),
        model: async request => {
          modelCalls.push(request);
          const source = request.context.match(/회원증을 처음 만들 때는 신분증을 가져오세요\./)?.[0];
          if (request.input !== question || !source) return { text: '규정을 확인할 수 없습니다.' };
          if (index === 0) return { text: optionalId };
          return { text: request.instruction.includes(changedInstruction) ? answer + '\n' + source : answer };
        },
        tool: async () => { throw Error('가이드 예시는 외부 도구를 호출하지 않습니다.'); },
      });
      const run = fixtureRun(index, data.input, result, data.id === exampleId &&
        data.input === question && isIntroExampleAnswer(graph, result.output));
      runs.push(run);
      await route.fulfill({ json: { data: run } });
    });
    const results = page.getByRole('tabpanel', { name: '실행 결과' });
    const sendQuestion = async (expected: string) => {
      await results.getByRole('textbox', { name: 'Agent에게 보낼 질문' }).fill(question);
      await results.getByRole('button', { name: '질문 실행', exact: true }).click();
      await expect(results.locator('.run-question')).toHaveText(question);
      const answerText = results.locator('.run-output');
      await expect(answerText).toHaveText(expected);
      assert.equal(await answerText.textContent(), expected);
    };
    await button('시험 실행').click();
    await verifyStep('첫 답변 읽기');
    await expect(coach).toBeInViewport();
    await sendQuestion(optionalId);
    if (mobile) await button('실행 화면 닫기').click();
    await coachButton('다음 단계').click();
    await expect(coach.getByText('비교할 첫 답변이 필요합니다', { exact: true })).toBeVisible();
    await coachButton('첫 답변 읽기로 이동').click();
    if (mobile) await button('시험 실행').click();
    await results.getByRole('button', { name: '실행 기록', exact: true }).click();
    await results.getByRole('button', { name: '＋ 새 대화', exact: true }).click();
    await sendQuestion(answer);
    if (mobile) await button('실행 화면 닫기').click();
    await coachButton('다음 단계').click();
    await verifyStep('작업 지시 바꾸기');
    await expect(coach.getByText('비교할 첫 답변이 필요합니다', { exact: true })).toHaveCount(0);
    await coach.getByText('결과가 다를 때', { exact: true }).click();
    await expect(coach.locator('details[open]')).toContainText('도서관 안내 Agent');
    await coachButton('단계 안내 접기').click();
    await expect(coachButton('단계 안내 펼치기')).toBeFocused();
    await expect(coach.getByRole('heading', { name: '작업 지시 바꾸기', exact: true })).toBeHidden();
    await block('agent').click();
    await page.getByRole('textbox', { name: '작업 지시', exact: true }).fill(changedInstruction);
    if (mobile) await button('속성 닫기').click();
    await coachButton('단계 안내 펼치기').press('Enter');
    await verifyStep('작업 지시 바꾸기');
    await coachButton('다음 단계').click();
    await verifyStep('같은 질문으로 비교하기');
    await button('시험 실행').click();
    await results.getByRole('button', { name: '실행 기록', exact: true }).click();
    await results.getByRole('button', { name: '＋ 새 대화', exact: true }).click();
    await sendQuestion(answer + '\n' + citation);
    const history = results.locator('.run-sidebar');
    if (!(await history.isVisible())) await results.getByRole('button', { name: '실행 기록', exact: true }).click();
    const records = history.getByRole('button').filter({ has: page.getByText(question, { exact: true }) });
    await expect(records).toHaveCount(3);
    await records.nth(1).click();
    await expect(results.locator('.run-output')).toHaveText(answer);
    if (mobile) await button('실행 화면 닫기').click();

    await coachButton('단계 안내 접기').click();
    await page.reload();
    await expect(coachButton('단계 안내 펼치기')).toBeVisible();
    const editorHistoryIndex = await page.evaluate(() => window.navigation?.currentEntry?.index);
    await openGuide();
    await goToStep('답변 확인');
    const confirmed = guide.getByRole('checkbox', { name: '실제 편집기에서 직접 확인했어요' });
    await expect(confirmed).not.toBeChecked();
    await confirmed.check();
    await goToStep('지시 바꾸기');
    await expect(guide.getByRole('checkbox')).not.toBeChecked();
    await expect(guide.getByRole('heading', { name: '첫 답변', exact: true })).toBeVisible();
    await expect(guide.getByRole('heading', { name: '지시를 바꾼 답변', exact: true })).toBeVisible();
    await capture('compare');
    const copyInstruction = guide.getByRole('button', { name: '작업 지시 복사' });
    const copyQuestion = guide.getByRole('button', { name: '시험 질문 복사' });
    const copyFeedback = guide.getByRole('status').filter({ hasText: '복사했습니다' });
    for (const [control, sample, target] of [
      [copyInstruction, changedInstruction, '작업 지시를'], [copyQuestion, question, '시험 질문을'],
    ] as const) {
      await control.press('Enter');
      await expect(copyFeedback).toHaveText([target + ' 복사했습니다.']);
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), sample);
    }
    if (mobile) {
      const controls = [guide.getByRole('button', { name: '도서관 안내 Agent의 작업 지시 확대' }), copyInstruction,
        guide.getByRole('button', { name: '예제 편집기 열기' }), copyQuestion, guide.getByRole('heading', {name: '변경 전후 답변'})];
      const tops = await Promise.all(controls.map(control => control.evaluate(el => el.getBoundingClientRect().top)));
      assert.deepEqual(tops, [...tops].sort((a,b) => a-b), '모바일에서 수정, 복사, 재실행, 비교 순서로 읽습니다.');
    }
    await page.reload();
    await expect(guide.getByRole('heading', { name: guideSteps[4].title })).toBeVisible();
    const finalChapter = guide.getByRole('region', { name: guideSteps[4].title, exact: true });
    await finalChapter.getByRole('button', { name: /^문제 해결( 열기)?$/ }).press('Enter');
    await expect(page).toHaveURL(url => url.searchParams.get('issue') === guideSteps[4].helpId);
    await guide.getByRole('button', { name: '현재 단계로 돌아가기', exact: true }).press('Enter');
    assert.equal(await projectId(), exampleId);
    await verifyStep('같은 질문으로 비교하기');
    await expect(coach.getByRole('heading', { name: '같은 질문으로 비교하기' })).toBeFocused();
    await expect(dialog('작업실 메뉴')).toHaveCount(0);
    if (editorHistoryIndex !== undefined) {
      assert.equal(await page.evaluate(() => window.navigation?.currentEntry?.index), editorHistoryIndex);
    }
    await expect(guide).toBeHidden();
    await openGuide();
    await goToStep('답변 확인');
    await expect(confirmed).toBeChecked();
    await section('목적별로 만들기').press('Enter');
    const created = page.waitForResponse(response => response.url().endsWith('/api/studio') &&
      response.request().postDataJSON()?.action === 'project.create');
    await startBlank.click();
    const createdResponse = await created;
    assert.ok(createdResponse.ok(), await createdResponse.text());
    const requestedBlankId = (await createdResponse.json()).data.id;
    assert.notEqual(requestedBlankId, exampleId);
    await expect(page).toHaveURL(url => url.searchParams.get('edit') === requestedBlankId);
    const blankId = await projectId();
    assert.equal(blankId, requestedBlankId);
    practiceIds.add(blankId);
    await expect(guide).toBeHidden();
    await expect(editor.getByRole('heading', { name: '도서관 안내 설계 실습', exact: true })).toBeVisible();
    assert.deepEqual(await readGraph(blankId), { nodes: [], edges: [] });
    await verifyStep('블록 네 개 배치하기');
    await capture('coach-blank');

    const blocks = canvas.locator('[data-canvas-block]');
    async function add(name: string) {
      const next = await blocks.count();
      if (!next) await button('블록 선택').click();
      else if (mobile) await button('블록').click();
      if (mobile) await verifyStep('블록 네 개 배치하기');
      await button(name + ' 추가').click();
      if (mobile) await button('속성 닫기').click();
      await expect(blocks).toHaveCount(next + 1);
      return (await blocks.nth(next).getAttribute('data-canvas-block'))!;
    }
    async function configure(id: string, editProperties: () => Promise<void>) {
      await block(id).press('Enter');
      await editProperties();
      if (mobile) await button('속성 닫기').click();
    }
    const input = await add('사용자 입력');
    const agent = await add('AI 작업');
    const output = await add('답변 전달');
    const source = await add('자료 가져오기');
    await coachButton('다음 단계').click();
    await verifyStep('질문과 원문 준비하기');
    await configure(input, async () => {
      await page.getByRole('textbox', { name: '예시 질문', exact: true }).fill(question);
    });
    await configure(source, async () => {
      await page.getByRole('textbox', { name: '자료 원문', exact: true }).fill(citation);
      await button('변경 적용').click();
    });
    await coachButton('다음 단계').click();
    await verifyStep('AI 작업 지시하기');
    await configure(agent, async () => {
      await verifyStep('AI 작업 지시하기');
      await page.getByRole('combobox', { name: '작업 방식', exact: true }).selectOption({ label: '한 번 답하기' });
      await page.getByRole('textbox', { name: /맡길 일/ }).fill('도서관 규정에서 확인한 사실을 이용자에게 안내합니다.');
      await page.getByRole('textbox', { name: '작업 지시', exact: true }).fill(changedInstruction);
      await page.getByRole('textbox', { name: '원하는 결과', exact: true }).fill('질문에 대한 안내가 한눈에 보입니다.');
    });
    await configure(output, async () => {
      await expect(page.getByRole('combobox', { name: '종료 방식', exact: true })).toHaveValue('answer');
    });
    await coachButton('다음 단계').click();
    await verifyStep('실행 순서와 자료 연결하기');
    const connect = async (from: string, to: string, options: string[]) => {
      await block(from).press('Enter');
      await button('연결 추가').click();
      const connection = dialog('연결 추가');
      await connection.getByRole('combobox', { name: '도착 블록' }).selectOption({ label: to });
      for (const name of options) {
        await connection.getByRole('checkbox', { name, exact: true }).check();
      }
      await connection.getByRole('button', { name: '연결 적용', exact: true }).click();
      await expect(connection).toBeHidden();
      if (mobile && await button('속성 닫기').isVisible()) await button('속성 닫기').click();
    };
    const execution = ['작업 후 → 실행 시작', '결과 → 입력값'];
    await connect(input, 'AI 한 번 작업', execution);
    await connect(agent, '답변 전달', execution);
    await connect(source, 'AI 한 번 작업', ['참조 → 참고 자료']);
    await coachButton('다음 단계').click();
    await verifyStep('답과 근거 확인하기');
    await coach.getByText('결과가 다를 때', { exact: true }).click();
    await expect(coach.locator('details[open]')).toContainText('참조');
    await button('설계 검사').click();
    await expect(dialog('설계 검사')).toContainText('현재 설계가 실행 조건을 충족합니다.');
    await capture('connected');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await readGraph(blankId)).edges.map(edge => [edge.from, edge.to, edge.kind])).toEqual([
      [input, agent, 'flow'], [input, agent, 'data'], [agent, output, 'flow'], [agent, output, 'data'], [source, agent, 'reference'],
    ]);
    assert.equal((await readGraph(blankId)).nodes.find(node => node.id === source)?.config.content, citation);

    await button('시험 실행').click();
    await sendQuestion(answer + '\n' + citation);
    assert.deepEqual(attempts, [
      { project: exampleId, input: question, conversation: undefined, instruction: originalInstruction },
      { project: exampleId, input: question, conversation: undefined, instruction: originalInstruction },
      { project: exampleId, input: question, conversation: undefined, instruction: changedInstruction },
      { project: blankId, input: question, conversation: undefined, instruction: changedInstruction },
    ]);
    assert.equal(modelCalls.length, 4);
    assert.deepEqual(modelCalls.map(call => call.tools), [[], [], [], []]);
    await capture('blank-answer');
    if (mobile) await button('실행 화면 닫기').click();
    await coachButton('이전 단계').click();
    await verifyStep('실행 순서와 자료 연결하기');
    await coachButton('다음 단계').click();
    await coachButton('내 자료로 안내하기').click();
    await expect(dialog('내 자료로 안내하기')).toBeVisible();
    await expect(page).toHaveURL(url => url.searchParams.get('lesson') === 'beginner');
    await page.goto('/');
    await openGuide();
    await guide.getByRole('button', { name: '예제 편집기 열기', exact: true }).click();
    assert.equal(await projectId(), exampleId);
    await verifyStep('같은 질문으로 비교하기');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

try {
  await exercise(false);
  await exercise(true);
  console.log('PASS desktop/mobile first viewport, guide routing and keyboard focus, screenshot zoom, clipboard, manual checks and reading bookmarks, project reuse, template search, engine-backed sample comparison and hand-built workflow.');
} finally {
  await browser.close();
}
