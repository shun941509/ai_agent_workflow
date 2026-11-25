import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect, type Locator, type Page, type Route } from '@playwright/test';
import { templates, validateGraph, type Graph } from '../src/domain';
import { executeGraph } from '../src/engine';
import { propose } from '../src/server/model';
import { one } from '../src/server/db';
import { registerBrowserAccount } from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소를 지정하세요.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});
const intro = templates.find(item => item.id === 'intro')!;
async function capture(page: Page, name: string) {
  if (!process.env.STUDIO_SCREENSHOTS) return;
  mkdirSync(process.env.STUDIO_SCREENSHOTS, {recursive:true});
  await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS, name + '-' + page.viewportSize()!.width + '.png')});
}

// Complete a real proposal in the isolated database, then drop its first browser response.
// Only the upstream model is replaced. The retry goes through the normal studio HTTP handler.
type Intercept = (route:Route) => Promise<void>;
type TestApi = { modelReady:boolean; propose?:Intercept; create?:Intercept };
async function recoverProposal(page: Page, reload: boolean, service:TestApi) {
  if (!process.env.STUDIO_TEST_DATA_DIR) return;
  process.env.STUDIO_DATA_DIR = process.env.STUDIO_TEST_DATA_DIR;
  await page.getByLabel('만들고 싶은 Agent').waitFor();
  const { data: {user} } = await (await page.request.post('/api/studio', {data:{action:'bootstrap'}})).json();
  const broken = structuredClone(intro.graph);
  broken.nodes.find(node => node.id === 'rules')!.config.content = '';
  const issues = validateGraph(broken);
  assert.ok(issues.length > 0);
  let attempts = 0;
  const keys: string[] = [];
  service.propose = async route => {
    const {data} = route.request().postDataJSON();
    keys.push(data.requestKey);
    if (++attempts !== 1) return route.continue();
    process.env.OPENAI_MODEL = 'test-model';
    process.env.OPENAI_API_KEY = 'offline-test-only';
    const nativeFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => Response.json({output:[{type:'message',content:[
        {type:'output_text', text:JSON.stringify(broken)},
      ]}]});
      await propose(user, data);
    } finally { globalThis.fetch = nativeFetch; }
    await route.abort('failed');
  };
  const openRequest = async () => {
    await page.getByLabel('만들고 싶은 Agent').fill('안내 데스크의 대출 질문에 답해 줘');
    await page.getByRole('button', {name:'AI 설계 제안 열기'}).click();
  };
  await openRequest();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', {name:'초안 제안받기'}).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  const receipt = () => one<{result:string;attempt:string}>(
    'SELECT p.result, r.attempt FROM proposals p JOIN proposal_requests r USING(owner,id) WHERE p.owner=? AND p.id=?',
    user.id, keys[0],
  );
  const committed = receipt();
  assert.ok(committed && JSON.parse(committed.result).nodes.length, 'The first response was lost after the proposal was saved.');
  if (reload) {
    service.modelReady = false;
    await page.reload();
    await openRequest();
  }
  await dialog.getByRole('button', {name:reload ? '이전 요청 결과 확인' : '같은 요청 다시 시도'}).click();
  await expect(dialog.getByText('실행 전 수정 ' + issues.length + '곳')).toBeVisible();
  await expect(dialog.locator('.proposal-preview')).toContainText(issues[0].message);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.deepEqual(receipt(), committed, 'Retrying must reuse the original proposal and its attempt.');
  await capture(page, 'recovered-proposal');
  await dialog.getByRole('button', {name:'초안으로 열어 수정'}).click();
  await expect(page.locator('.ws-editor')).toBeVisible();
  await expect(page.getByRole('textbox', {name:'자료 원문'})).toBeFocused();
  await expect(page.locator('[data-canvas-block="rules"]').first()).toHaveAttribute('aria-pressed', 'true');
  await capture(page,'proposal-repair-field');
  delete service.propose;
  service.modelReady = true;
  await page.goto('/');
}

async function verifyReleaseDownload(page: Page, panel: Locator) {
  const project = new URL(page.url()).searchParams.get('edit');
  const opened = await page.request.post('/api/studio', {data:{action:'project.open', data:{id:project}}});
  assert.ok(opened.ok());
  const {data:{graph}} = await opened.json() as {data:{graph:Graph}};
  const caseId = await panel.getByLabel('시험 사례 선택').inputValue();
  const input = await panel.getByRole('textbox', {name:'Agent에게 보낼 질문'}).inputValue();
  const runId = crypto.randomUUID();
  const localRun = async (route: Route) => {
    const {action, data} = route.request().postDataJSON();
    if (data?.id !== project) return route.fallback();
    if (action === 'run.inputFiles' && data.conversation === runId)
      return route.fulfill({json:{data:{accept:null}}});
    if (action !== 'run.start') return route.fallback();
    assert.equal(data.caseId, caseId);
    const result = await executeGraph(graph, {input, runId}, {
      model: async request => {
        assert.match(request.instruction, /업데이트 안내 작성 Skill/);
        const rows = [...request.context.matchAll(/(할 일 제목 수정|완료 항목 숨기기|마감일 알림) \| (완료|예정) \| ([가-힣 ]+\.)/g)];
        assert.equal(rows.length, 3);
        const list = (status: string) => rows.filter(row => row[2] === status).map(row => '- ' + row[1] + ' — ' + row[3]);
        return {text:['## 이번 버전에 추가된 기능', ...list('완료'), '', '## 예정', ...list('예정')].join('\n')};
      },
      tool: async name => { throw Error('예상하지 않은 도구 호출 ' + name); },
    });
    const now = new Date().toISOString();
    await route.fulfill({json:{data:{id:runId, conversation:runId, runNumber:1, mode:'test', input,
      state:result.status, output:result.output, events:result.events, error:result.error, created:now, updated:now}}});
  };
  await page.route('**/api/studio', localRun);
  try {
    await panel.getByRole('button', {name:'저장된 사례로 시험', exact:true}).click();
    const answer = panel.locator('.run-output');
    await expect(answer).toContainText(/## 이번 버전에 추가된 기능.*할 일 제목 수정.*## 예정.*완료 항목 숨기기.*마감일 알림/s);
    const pending = page.waitForEvent('download');
    await panel.getByRole('button', {name:'업데이트안내.md 내려받기', exact:true}).click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), '업데이트안내.md');
    assert.deepEqual(await readFile(await download.path()), Buffer.from(await answer.textContent() ?? '', 'utf8'));
  } finally {
    await page.unroute('**/api/studio', localRun);
  }
}

async function verifySoftwareLessons(page: Page) {
  const software = templates.filter(lesson => lesson.id.startsWith('sw-'));
  assert.equal(software.length, 5);
  for (const lesson of software) {
    await page.goto('/?view=templates');
    await page.getByRole('button', {name:lesson.level, exact:true}).click();
    await page.locator('[data-lesson-trigger="'+lesson.id+'"]').click();
    const dialog = page.getByRole('dialog', {name:lesson.title, exact:true});
    await expect(dialog.getByText('할 일 앱 실습', {exact:true})).toBeVisible();
    await dialog.getByRole('button', {name:'내 사본으로 시작', exact:true}).click();
    await expect(page).toHaveURL(url => url.searchParams.has('edit'));
    await page.getByRole('button', {name:'시험 실행', exact:true}).click();
    const panel = page.getByRole('tabpanel', {name:'실행 결과'});
    await expect(panel.getByRole('textbox', {name:'Agent에게 보낼 질문'})).toHaveValue(lesson.question);
    const settings = panel.getByRole('button', {name:'실행 설정'});
    if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
    const cases = panel.getByRole('button', {name:'시험 사례', exact:true});
    if (await cases.getAttribute('aria-expanded') !== 'true') await cases.click();
    await panel.getByLabel('시험 사례 선택').selectOption({label:lesson.sampleCase!.title});
    await expect(panel.getByLabel('기대 결과')).toHaveValue(lesson.sampleCase!.expected);
    await expect(panel.getByRole('button', {name:'저장된 사례로 시험'})).toBeEnabled();
    if (lesson.id === 'sw-release-notes') await verifyReleaseDownload(page, panel);
  }
}

async function verify(mobile: boolean) {
  const context = await browser.newContext({baseURL, viewport:mobile ? {width:390,height:844} : {width:1440,height:900},
    isMobile:mobile, hasTouch:mobile});
  try {
    await registerBrowserAccount(context);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    const dialog = page.getByRole('dialog');
    await page.goto('/');
    if (process.env.STUDIO_TEST_DATA_DIR) {
      await page.getByLabel('만들고 싶은 Agent').fill('모델 연결 전 안내자');
      await page.getByRole('button', {name:'AI 설계 제안 열기'}).click();
      await expect(dialog.getByRole('status')).toContainText('작업실 운영자가 모델을 연결');
      await expect(dialog.getByRole('button',{name:'초안 제안받기'})).toHaveCount(0);
      await capture(page,'model-setup-alternatives');
      await dialog.getByRole('button',{name:'수준별 템플릿 보기'}).click();
      await expect(page.locator('.lesson-tile').first()).toBeVisible();
      await page.goto('/');
      await page.getByLabel('만들고 싶은 Agent').fill('모델 연결 전 안내자');
      await page.getByRole('button', {name:'AI 설계 제안 열기'}).click();
      await dialog.getByRole('button',{name:'빈 캔버스에서 시작'}).click();
      await expect(page.locator('.ws-editor')).toBeVisible();
    }
    const service:TestApi = {modelReady:true};
    await page.route('**/api/studio', async route => {
      const action = route.request().postDataJSON()?.action;
      if (action === 'propose' && service.propose) return service.propose(route);
      if (action === 'project.create' && service.create) return service.create(route);
      if (action !== 'bootstrap') return route.continue();
      const response = await route.fetch();
      const json = await response.json();
      json.data.modelReady = service.modelReady;
      await route.fulfill({response, json});
    });
    await page.goto('/');
    if (process.env.STUDIO_TEST_DATA_DIR) {
      await page.getByLabel('만들고 싶은 Agent').fill('연결이 끊긴 모델로 설계');
      await page.getByRole('button', {name:'AI 설계 제안 열기'}).click();
      await dialog.getByRole('button',{name:'초안 제안받기'}).click();
      await expect(dialog.getByRole('button',{name:'빈 캔버스에서 시작'})).toBeFocused();
      await expect(dialog.getByRole('button',{name:'같은 요청 다시 시도'})).toHaveCount(0);
      await dialog.getByRole('button',{name:'닫기',exact:true}).click();
      service.modelReady = false;
      await page.reload();
      await page.getByLabel('만들고 싶은 Agent').fill('연결이 끊긴 모델로 설계');
      await page.getByRole('button', {name:'AI 설계 제안 열기'}).click();
      await expect(dialog.getByRole('status')).toContainText('작업실 운영자');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('studio.proposal.home')),null);
      service.modelReady = true;
      await page.goto('/');
    }
    await recoverProposal(page, mobile, service);
    const prompt = page.getByLabel('만들고 싶은 Agent');
    const open = page.getByRole('button', {name:'AI 설계 제안 열기'});
    await prompt.fill('지난주 도서관 공지를 정리해 줘');
    const releases: Array<() => void> = [];
    service.propose = async route => {
      const text = route.request().postDataJSON().data.prompt;
      await new Promise<void>(resolve => releases.push(resolve));
      const graph = structuredClone(intro.graph);
      graph.nodes[0].title = text;
      // Chrome may have already disconnected this cancelled request.
      await route.fulfill({json:{data:{graph}}}).catch(() => {});
    };
    for (const [index, cancel] of ['button','header','escape'].entries()) {
      await open.click();
      await expect(dialog.getByRole('textbox')).toHaveValue('지난주 도서관 공지를 정리해 줘');
      await dialog.getByRole('button', {name:'초안 제안받기'}).click();
      await expect.poll(() => releases.length).toBe(index + 1);
      await expect(dialog.getByText('설계 제안을 작성하고 있습니다.')).toBeVisible();
      if (index === 0) await capture(page, 'cancellable-home-proposal');
      if (cancel === 'escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', {name:cancel === 'header' ? '닫기' : '요청 취소하고 닫기',exact:true}).click();
      await expect(dialog).toHaveCount(0);
      await expect(prompt).toHaveValue('지난주 도서관 공지를 정리해 줘');
      if (index > 0) releases[index]();
    }
    await open.click();
    const latest = '이번 주 야간 개관 시간을 정리해 줘';
    await dialog.getByRole('textbox').fill(latest);
    await dialog.getByRole('button', {name:'초안 제안받기'}).click();
    await expect.poll(() => releases.length).toBe(4);
    releases[3]();
    await expect(dialog.locator('.proposal-preview')).toContainText(latest);
    await expect(dialog.getByRole('status')).toContainText('설계 제안이 준비');
    await expect(dialog.getByRole('button',{name:'캔버스에 적용'})).toBeFocused();
    releases[0]();
    await dialog.getByRole('button', {name:'캔버스에 적용'}).click();
    await expect(page.locator('.ws-editor')).toBeVisible();
    const id = new URL(page.url()).searchParams.get('edit');
    const saved = await context.request.post('/api/studio',{data:{action:'project.open',data:{id}}});
    assert.equal((await saved.json()).data.graph.nodes[0].title,latest);

    await page.goto('/?view=templates');
    const filter = page.getByRole('button',{name:'전문가',exact:true});
    await filter.click();
    const card = page.locator('[data-lesson-trigger="dynamic"]');
    await card.scrollIntoViewIfNeeded();
    await card.focus();
    const listY = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Enter');
    const total = dialog.getByLabel('총 생성 한도');
    const parallel = dialog.getByLabel('동시 실행 한도');
    const failure = dialog.getByLabel('지점 조사 실패 시');
    const start = dialog.getByRole('button',{name:'내 사본으로 시작'});
    await expect(failure).toBeInViewport();
    await expect(start).toBeInViewport();
    await expect(start).toBeDisabled();
    await total.selectOption('4');
    await parallel.selectOption('2');
    await failure.selectOption('stop');
    await expect(start).toBeEnabled();
    const criteria = dialog.getByRole('region', {name:'선택한 정책의 완료 기준'});
    await expect(criteria).toContainText('선택 제외는 0곳');
    await expect(criteria).toContainText('‘지점별 결과 정리’는 실행되지 않습니다.');
    await total.selectOption('1');
    await expect(start).toBeDisabled();
    await expect(parallel).toHaveAccessibleDescription(/총 생성 한도가 1명.*다시 선택/);
    await parallel.selectOption('1');
    await failure.selectOption('collect');
    await expect(criteria).toContainText('강변만 고르면 확인된 지점이 0곳');
    await capture(page, 'expert-reselect-limit');
    await total.selectOption('3');
    await parallel.selectOption('1');
    await failure.selectOption('stop');
    await capture(page, 'expert-decisions');
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await expect(filter).toHaveAttribute('aria-pressed','true');
    await expect(card).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(listY,-1);
    await page.goForward();
    await expect(total).toHaveValue('3');
    await page.reload();
    await expect(parallel).toHaveValue('1');
    await expect(failure).toHaveValue('stop');
    await dialog.getByRole('button',{name:'닫기',exact:true}).click();
    await expect(card).toBeFocused();
    await card.click();
    await expect(total).toHaveValue('3');
    await expect(failure).toHaveValue('stop');
    const requestKeys:string[] = [];
    let committedProject = '';
    service.create = async route => {
      const body = route.request().postDataJSON();
      if (body.data.lesson !== 'dynamic') return route.continue();
      requestKeys.push(body.data.requestKey);
      if (requestKeys.length > 1) return route.continue();
      const response = await route.fetch();
      assert.ok(response.ok());
      committedProject = (await response.json()).data.id;
      await route.abort('failed');
    };
    await start.click();
    await expect(dialog.getByRole('alert')).toContainText('같은 설정');
    await page.reload();
    await expect(total).toHaveValue('3');
    await start.click();
    await expect(page.locator('.ws-editor')).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get('edit'), committedProject);
    assert.equal(requestKeys.length, 2);
    assert.equal(requestKeys[0], requestKeys[1]);
    await page.goBack();
    await expect(card).toBeFocused();
    await expect(dialog).toHaveCount(0);
    await verifySoftwareLessons(page);
    assert.deepEqual(pageErrors,[]);
  } finally { await context.close(); }
}
try {
  await verify(false);
  await verify(true);
  console.log('PASS desktop/mobile proposal retry, expert policy, catalog history and five ready-to-run SW lesson copies with saved cases.');
} finally { await browser.close(); }
