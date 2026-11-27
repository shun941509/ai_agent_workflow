import assert from 'node:assert/strict';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium, expect, type BrowserContext, type Locator, type Page} from '@playwright/test';
import {createBlock, templates} from '../src/domain';
import {workDocumentGraph, workDocuments} from '../src/domain/work-documents';
import {StudioError} from '../src/server/errors';
import {propose} from '../src/server/model';
import {registerBrowserAccount} from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 Studio 시험 서버 주소를 지정하세요.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});
const intro = templates.find(lesson => lesson.id === 'intro')!;

async function api(context: BrowserContext, action: string, data: unknown = {}) {
  const response = await context.request.post('/api/studio', {data:{action,data}});
  const body = await response.json();
  assert.ok(response.ok(), action + ' ' + (body.error ?? response.status()));
  return body.data;
}

async function ownerDraftAndSharingRecovery() {
  const context = await browser.newContext({baseURL, viewport:{width:390,height:844}});
  try {
    await registerBrowserAccount(context);
    const project = await api(context, 'project.create', {title:'미게시 업무 안내',graph:intro.graph});
    const page = await context.newPage();
    const address = '/?agent=' + project.id;
    await page.goto(address);
    await page.getByRole('button', {name:'초안 시험'}).click();
    await expect(page.getByLabel('실행 환경')).toHaveValue('test');
    await expect(page.getByLabel('실행할 설계 버전')).toBeVisible();
    await expect(page.locator('.ws-workbench')).toHaveCount(0);
    await page.getByRole('button', {name:'실행 화면 닫기'}).click();
    await expect(page).toHaveURL(/\?view=shared$/);
    await expect(page).toHaveTitle(/공유 Agent/);
    await page.goto(address);
    await page.getByRole('button', {name:'내 사본 만들기'}).click();
    await expect(page).toHaveURL(/\?edit=/);
    const copyId = new URL(page.url()).searchParams.get('edit');
    assert.notEqual(copyId, project.id);
    const copy = await api(context, 'project.open', {id:copyId});
    assert.deepEqual(copy.graph.nodes.map((n: {type:string}) => n.type), project.graph.nodes.map((n: {type:string}) => n.type));

    await api(context, 'versions.save', {id:project.id,revision:project.revision});
    await page.goto('/?view=projects');
    await expect(page).toHaveTitle(/내 Agent/);
    let failOpen = true, failEdition = true;
    await page.route('**/api/studio', route => {
      const req = route.request().postDataJSON();
      const firstOpen = failOpen && req.action === 'project.open';
      const edition = failEdition && req.action === 'run.lastTestSources' && req.data.version === 1;
      if (!firstOpen && !edition) return route.continue();
      if (firstOpen) failOpen = false;
      return route.fulfill({status:503,json:{error:'시험 연결을 잠시 사용할 수 없습니다.'}});
    });
    await page.getByRole('button',{name:project.title + ' 공유 설정',exact:true}).click();
    const dialog = page.getByRole('dialog',{name:'Agent 공유 설정'});
    await dialog.getByRole('button',{name:'공유 설정 다시 불러오기'}).press('Enter');
    const retryEdition = dialog.getByRole('button',{name:'시험 기록 다시 불러오기'});
    await expect(retryEdition).toBeVisible();
    failEdition = false;
    await retryEdition.press('Enter');
    await expect(dialog.getByLabel('대상 버전')).toBeFocused();
    await expect(dialog).toContainText('시험 기록 없음');
  } finally { await context.close(); }
}

async function shareFromProjectList(context: BrowserContext, page: Page, mobile: boolean) {
  const first = await api(context, 'project.create', {title:'지점 안내 · 대출',graph:intro.graph});
  const second = await api(context, 'project.create', {title:'지점 안내 · 반납',graph:intro.graph});
  await api(context, 'versions.save', {id:second.id,revision:second.revision});
  await api(context, 'versions.save', {id:second.id,revision:second.revision});
  await api(context, 'editor.visit', {id:first.id,focus:{path:[],selection:null}});
  await page.goto('/?view=projects');
  if (mobile) await page.getByRole('button', {name:'메뉴 열기'}).click();
  const navigation = page.getByRole('navigation', {name:'작업 화면'});
  await expect(navigation.getByRole('button', {name:'공유 Agent',exact:true})).toBeVisible();
  await expect(navigation.getByRole('button', {name:'내 공유 설정',exact:true})).toHaveCount(0);
  if (mobile) await page.getByRole('button', {name:'메뉴 닫기'}).click();

  const search = page.getByRole('textbox', {name:'Agent 이름 검색'});
  await search.fill('지점 안내');
  const share = page.getByRole('dialog', {name:'Agent 공유 설정'});
  const current = share.getByRole('region', {name:'현재 공유 상태'});
  const settings = (title: string) => page.getByRole('button', {name:title + ' 공유 설정',exact:true});
  const row = (id: string) => page.locator('[data-project-id="' + id + '"]');
  async function open(title: string) {
    if (mobile) await settings(title).tap();
    else await settings(title).press('Enter');
    await expect(share.getByText(title, {exact:true})).toBeVisible();
    await expect(page).toHaveURL(/\?view=projects$/);
  }
  async function close(title: string, escape: boolean) {
    await expect(share.getByLabel('공유 범위')).toBeEnabled();
    if (escape) await page.keyboard.press('Escape');
    else await share.getByRole('button', {name:'닫기',exact:true}).click();
    await expect(share).toBeHidden();
    await expect(settings(title)).toBeFocused();
    await expect(search).toHaveValue('지점 안내');
  }

  await open(first.title);
  await share.getByLabel('공유 범위').selectOption('link');
  await share.getByRole('button', {name:'선택한 버전 게시'}).click();
  await expect(current).toContainText('비밀 링크');
  await close(first.title, true);
  await expect(row(first.id)).toContainText('게시 v1');
  await expect(row(first.id)).toContainText('비밀 링크');
  await expect(row(second.id)).toContainText('나만 사용');
  const firstState = await api(context, 'versions.state', {id:first.id});

  await open(second.title);
  await share.getByLabel('대상 버전').selectOption('1');
  await share.getByLabel('공유 범위').selectOption('public');
  await share.getByRole('button', {name:'선택한 버전 게시'}).click();
  await expect(current).toContainText('모두에게 공개');
  await close(second.title, false);
  await expect(row(second.id)).toContainText('게시 v1');
  await expect(row(second.id)).toContainText('모두에게 공개');
  await open(second.title);
  await share.getByRole('button', {name:'공유 철회',exact:true}).click();
  await expect(current).toContainText('나만 사용');
  await close(second.title, true);
  await expect(row(second.id)).toContainText('나만 사용');
  assert.equal((await api(context, 'versions.state', {id:second.id})).visibility, 'private');
  assert.deepEqual(await api(context, 'versions.state', {id:first.id}), firstState);
  assert.equal((await api(context, 'bootstrap')).resume.id, first.id);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await search.fill('');
}

async function verifySharingAudience(owner: BrowserContext, ownerPage: Page, mobile: boolean) {
  const title = '공개 범위 확인 ' + crypto.randomUUID().slice(0,8);
  const project = await api(owner, 'project.create', {title, graph:{
    nodes:[createBlock('input.user_request', {id:'ask'}), createBlock('output.answer', {id:'answer'})],
    edges:[
      {id:'next',kind:'flow',from:'ask',out:'next',to:'answer',input:'in'},
      {id:'value',kind:'data',from:'ask',out:'value',to:'answer',input:'input'},
    ],
  }});
  const options = {baseURL, viewport:ownerPage.viewportSize(), isMobile:mobile, hasTouch:mobile};
  const received = await browser.newContext(options);
  const other = await browser.newContext(options);
  const activate = (button: Locator) => mobile ? button.tap() : button.click();
  try {
    const [recipient, observer] = await Promise.all([received, other].map(async context => {
      await registerBrowserAccount(context);
      return context.newPage();
    }));
    const galleryRow = (page: Page) => page.getByRole('button').filter({has:page.getByText(title, {exact:true})});
    async function searchGallery(page: Page, visible: boolean) {
      await page.goto('/?view=shared');
      await expect(page.getByRole('heading', {name:'공유 Agent', exact:true})).toBeVisible();
      await page.getByRole('textbox', {name:'Agent 이름 검색'}).fill(title);
      const row = galleryRow(page);
      if (visible) await expect(row).toBeVisible();
      else {
        await expect(page.getByText('검색 결과가 없습니다.', {exact:true})).toBeVisible();
        await expect(row).toHaveCount(0);
      }
      return row;
    }
    async function expectOpen(page: Page, scope: string) {
      const detail = page.getByRole('dialog', {name:title, exact:true});
      await expect(detail).toContainText('게시 버전 1 · ' + scope);
      await expect(detail.getByRole('button', {name:'Agent 사용', exact:true})).toBeEnabled();
    }
    async function expectDenied(page: Page, address: string) {
      await page.goto(address);
      await expect(page.getByRole('alert').filter({hasText:'공유 권한이 없습니다.'})).toBeVisible();
      await expect(page.getByRole('dialog', {name:title, exact:true})).toHaveCount(0);
    }
    async function openHistory(page: Page) {
      const run = page.locator('.studio-run-panel');
      if (!mobile) return run.locator('.run-sidebar');
      await activate(run.getByRole('button', {name:'실행 기록', exact:true}));
      return page.getByRole('dialog', {name:'실행 기록', exact:true});
    }
    await ownerPage.goto('/?view=projects');
    await activate(ownerPage.getByRole('button', {name:title + ' 공유 설정', exact:true}));
    const settings = ownerPage.getByRole('dialog', {name:'Agent 공유 설정'});
    const state = settings.getByRole('region', {name:'현재 공유 상태'});
    const scope = settings.getByLabel('공유 범위');
    // Capture exactly what the copy button writes, without changing the system clipboard.
    const enableTestClipboard = () => ownerPage.evaluate(() => {
      let text = '';
      Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{
        async writeText(value: string) { text = value; }, async readText() { return text; },
      }});
    });
    async function copyAddress() {
      await activate(state.getByRole('button', {name:'현재 공유 주소 복사'}));
      return ownerPage.evaluate(() => navigator.clipboard.readText());
    }

    await enableTestClipboard();
    const addressField = state.getByRole('textbox', {name:'현재 공유 주소', exact:true});
    await scope.selectOption('public');
    await activate(settings.getByRole('button', {name:'선택한 버전 게시'}));
    await expect(state).toContainText('모두에게 공개');
    const publicAddress = await copyAddress();
    await expect(addressField).toHaveValue(publicAddress);
    for (const page of [recipient, observer]) {
      await activate(await searchGallery(page, true));
      await expectOpen(page, '모두에게 공개');
    }

    await scope.selectOption('link');
    await activate(settings.getByRole('button', {name:'공유 설정 적용'}));
    await expect(state).toContainText('비밀 링크');
    const secretAddress = await copyAddress();
    assert.ok(publicAddress !== secretAddress);
    await ownerPage.evaluate(denied => {
      Object.defineProperty(navigator, 'clipboard', {configurable:true, value:denied ? {
        async writeText() { throw new DOMException('Permission denied', 'NotAllowedError'); },
      } : undefined});
    }, mobile);
    await activate(state.getByRole('button', {name:'현재 공유 주소 복사'}));
    await expect(settings.getByRole('alert')).toContainText('선택된 주소를 직접 복사하세요.');
    await expect(addressField).toBeFocused();
    await expect(addressField).toHaveValue(secretAddress);
    assert.ok(await addressField.evaluate((field:HTMLInputElement) =>
      field.readOnly && field.selectionStart === 0 && field.selectionEnd === field.value.length));
    await enableTestClipboard();
    for (const page of [recipient, observer]) {
      await searchGallery(page, false);
      await expectDenied(page, publicAddress);
    }
    await recipient.goto(secretAddress);
    await expectOpen(recipient, '비밀 링크');
    const linkDocument = await recipient.evaluate(() => performance.timeOrigin);
    await activate(recipient.getByRole('dialog', {name:title, exact:true}).getByRole('button', {name:'닫기', exact:true}));
    await expect(recipient.getByRole('heading', {name:'공유 Agent', exact:true})).toBeVisible();
    await expect(galleryRow(recipient)).toBeVisible();
    assert.equal(await recipient.evaluate(() => performance.timeOrigin), linkDocument, '받은 Agent는 문서를 새로 고치지 않아도 목록에 표시되어야 합니다.');
    await activate(galleryRow(recipient));
    await expectOpen(recipient, '비밀 링크');
    await searchGallery(observer, false);
    await expectDenied(observer, publicAddress);
    await observer.goto(secretAddress);
    await expectOpen(observer, '비밀 링크');
    const detail = observer.getByRole('dialog', {name:title, exact:true});
    const detailDocument = await observer.evaluate(() => performance.timeOrigin);
    const gallery = await other.newPage();
    await searchGallery(gallery, true);
    const galleryDocument = await gallery.evaluate(() => performance.timeOrigin);

    await recipient.goto(secretAddress);
    await activate(recipient.getByRole('button', {name:'Agent 사용', exact:true}));
    const panel = recipient.locator('.studio-run-panel');
    const send = panel.getByRole('button', {name:'질문 실행', exact:true});
    const firstQuestion = '철회 전에 받은 답변';
    await panel.getByRole('textbox', {name:'Agent에게 보낼 질문'}).fill(firstQuestion);
    await activate(send);
    await expect(panel.locator('.run-output')).toHaveText(firstQuestion, {timeout:20000});
    const draft = panel.getByRole('textbox', {name:'같은 대화의 새 질문'});
    const followup = '보내기 전에 작성하던 질문';
    await draft.fill(followup);
    await expect(send).toBeEnabled();
    const conversationDocument = await recipient.evaluate(() => performance.timeOrigin);
    const runsBefore = await api(owner, 'project.stats', {id:project.id});
    assert.deepEqual(runsBefore, [{state:'completed', n:1}]);

    // Enter from the gallery so this tab has no invitation token in its URL.
    const background = await received.newPage();
    await activate(await searchGallery(background, true));
    await activate(background.getByRole('button', {name:'Agent 사용', exact:true}));
    const oldHistory = await openHistory(background);
    await activate(oldHistory.getByRole('button').filter({has:background.getByText(firstQuestion, {exact:true})}));
    const backgroundPanel = background.locator('.studio-run-panel');
    await expect(backgroundPanel.locator('.run-output')).toHaveText(firstQuestion);
    const backgroundDraft = backgroundPanel.getByRole('textbox', {name:'같은 대화의 새 질문'});
    await backgroundDraft.fill(followup);
    const backgroundSend = backgroundPanel.getByRole('button', {name:'질문 실행', exact:true});
    await expect(backgroundSend).toBeEnabled();
    const backgroundDocument = await background.evaluate(() => performance.timeOrigin);
    // Headless Chromium keeps every page visible. Hold the normal hidden-tab state across both changes.
    await background.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable:true, value:true});
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // The browser may leave clipboard permission undecided while the owner withdraws the link.
    await ownerPage.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{
        writeText() {
          return new Promise<void>((_, reject) => {
            window.addEventListener('test:deny-old-copy', () => reject(new DOMException('Permission denied', 'NotAllowedError')), {once:true});
          });
        },
      }});
    });
    await activate(state.getByRole('button', {name:'현재 공유 주소 복사'}));
    await expect(settings.getByRole('button', {name:'닫기'})).toBeEnabled();
    await activate(settings.getByRole('button', {name:'공유 철회'}));
    await expect(state).toContainText('나만 사용');
    await expect(addressField).toHaveCount(0);
    const revoked = /^게시자가 공유를 철회했습니다\.?$/;
    await Promise.all([
      expect(detail.getByText(revoked)).toBeVisible({timeout:15000}),
      expect(panel.getByText(revoked)).toBeVisible({timeout:15000}),
    ]);
    await expect(detail.getByRole('button', {name:'Agent 사용', exact:true})).toBeDisabled();
    await expect(send).toBeDisabled();
    await expect(draft).toHaveValue(followup);
    await expect(panel.locator('.run-output')).toHaveText(firstQuestion);
    assert.equal(await observer.evaluate(() => performance.timeOrigin), detailDocument);
    assert.equal(await recipient.evaluate(() => performance.timeOrigin), conversationDocument);
    assert.deepEqual(await api(owner, 'project.stats', {id:project.id}), runsBefore);

    // Headless Chromium keeps its tabs visible. Deliver the event a returning tab receives.
    await gallery.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(galleryRow(gallery)).toHaveCount(0);
    await expect(gallery.getByText('검색 결과가 없습니다.', {exact:true})).toBeVisible();
    await expect(gallery.getByRole('textbox', {name:'Agent 이름 검색'})).toHaveValue(title);
    assert.equal(await gallery.evaluate(() => performance.timeOrigin), galleryDocument, '목록 탭으로 돌아오면 현재 문서에서 공유 상태를 갱신해야 합니다.');
    const priorLinkPage = await received.newPage();
    for (const page of [priorLinkPage, gallery]) {
      await searchGallery(page, false);
      await expectDenied(page, publicAddress);
      await expectDenied(page, secretAddress);
    }

    await scope.selectOption('link');
    await activate(settings.getByRole('button', {name:'공유 설정 적용'}));
    await expect(state).toContainText('비밀 링크');
    await enableTestClipboard();
    const reissuedAddress = await copyAddress();
    assert.notEqual(reissuedAddress, secretAddress);
    await expect(addressField).toHaveValue(reissuedAddress);
    await ownerPage.evaluate(() => window.dispatchEvent(new Event('test:deny-old-copy')));
    await expect(state.getByRole('status')).toHaveText('현재 공유 주소를 복사했습니다.');
    await expect(settings.getByRole('alert')).toHaveCount(0);
    await expect(addressField).not.toBeFocused();
    for (const page of [priorLinkPage, gallery]) {
      await searchGallery(page, false);
      await expectDenied(page, secretAddress);
    }
    await gallery.goto(reissuedAddress);
    await expectOpen(gallery, '비밀 링크');
    await activate(gallery.getByRole('button', {name:'Agent 사용', exact:true}));
    const newPanel = gallery.locator('.studio-run-panel');
    const newQuestion = '재공유 뒤 새 링크로 보낸 질문';
    await newPanel.getByRole('textbox', {name:'Agent에게 보낼 질문'}).fill(newQuestion);
    await activate(newPanel.getByRole('button', {name:'질문 실행', exact:true}));
    await expect(newPanel.locator('.run-output')).toHaveText(newQuestion, {timeout:20000});
    await expect(detail.getByText(revoked)).toBeVisible();
    await expect(detail.getByRole('button', {name:'Agent 사용', exact:true})).toBeDisabled();
    await expect(panel.getByText(revoked)).toBeVisible();
    await expect(send).toBeDisabled();
    await expect(draft).toHaveValue(followup);
    await expect(panel.locator('.run-output')).toHaveText(firstQuestion);
    assert.equal(await observer.evaluate(() => performance.timeOrigin), detailDocument);
    assert.equal(await recipient.evaluate(() => performance.timeOrigin), conversationDocument);
    await searchGallery(priorLinkPage, false);
    await expectDenied(priorLinkPage, secretAddress);
    assert.deepEqual(await api(owner, 'project.stats', {id:project.id}), [{state:'completed', n:2}]);

    // Give the original conversation owner access again using the new invitation.
    await priorLinkPage.goto(reissuedAddress);
    await expectOpen(priorLinkPage, '비밀 링크');
    await expectDenied(await received.newPage(), secretAddress);
    await expect(send).toBeDisabled();
    await background.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(backgroundPanel.getByText(revoked)).toBeVisible();
    await expect(backgroundSend).toBeDisabled();
    await expect(backgroundDraft).toHaveValue(followup);
    await expect(backgroundPanel.locator('.run-output')).toHaveText(firstQuestion);
    assert.equal(await background.evaluate(() => performance.timeOrigin), backgroundDocument);

    await activate(priorLinkPage.getByRole('button', {name:'Agent 사용', exact:true}));
    const renewedPanel = priorLinkPage.locator('.studio-run-panel');
    const renewedHistory = await openHistory(priorLinkPage);
    const expiredConversation = renewedHistory.getByRole('button').filter({has:priorLinkPage.getByText('공유가 종료된 대화', {exact:true})});
    await expect(expiredConversation).toBeDisabled();
    if (mobile) await activate(renewedHistory.getByRole('button', {name:'기록 닫기', exact:true}));
    assert.deepEqual(await api(owner, 'project.stats', {id:project.id}), [{state:'completed', n:2}]);

    const question = '새 주소로 다시 받은 날의 첫 질문';
    const nextQuestion = '새 대화의 후속 질문';
    const renewedSend = renewedPanel.getByRole('button', {name:'질문 실행', exact:true});
    await renewedPanel.getByRole('textbox', {name:'Agent에게 보낼 질문'}).fill(question);
    await activate(renewedSend);
    await expect(renewedPanel.locator('.run-output')).toHaveText([question], {timeout:20000});
    await renewedPanel.getByRole('textbox', {name:'같은 대화의 새 질문'}).fill(nextQuestion);
    await activate(renewedSend);
    await expect(renewedPanel.locator('.run-output')).toHaveText([question, nextQuestion], {timeout:20000});
    assert.deepEqual(await api(owner, 'project.stats', {id:project.id}), [{state:'completed', n:4}]);
    await expect(send).toBeDisabled();
    await expect(draft).toHaveValue(followup);
    console.log((mobile ? 'Mobile' : 'Desktop') + ' passed reissued invitation checks for old URLs, tabs, history and new conversations.');
  } finally {
    await Promise.all([received.close(), other.close()]);
  }
}

async function exercise(mobile: boolean) {
  const context = await browser.newContext({
    baseURL, viewport:mobile ? {width:390,height:844} : {width:1440,height:900}, isMobile:mobile, hasTouch:mobile,
  });
  try {
    const user = await registerBrowserAccount(context);
    const page = await context.newPage();
    await shareFromProjectList(context, page, mobile);
    await verifySharingAudience(context, page, mobile);
    const dialog = page.getByRole('dialog');
    async function namedChooser(title: string) {
      await page.goto('/?view=projects');
      await page.getByRole('button', {name:'새 Agent',exact:true}).click();
      await dialog.getByLabel('Agent 이름').fill(title);
    }
    async function created(title: string) {
      await expect(page.locator('.ws-editor')).toBeVisible();
      const id = new URL(page.url()).searchParams.get('edit');
      const saved = await api(context, 'project.open', {id});
      assert.equal(saved.title,title);
      return saved;
    }
    const blankTitle = '금요일 야간 개관 알림';
    const meetingRequest = '회의 메모에서 결정 사항을 뽑아 줘';
    const meetingPurpose = '회의 메모를 입력받아 확정된 결정 사항을 추출합니다.';
    const meetingGraph = workDocumentGraph(workDocuments.find(doc => doc.id === 'meeting-report')!, meetingRequest);
    const proposals: Array<{prompt:string; clarificationAnswer?:string}> = [];
    let lostAnswerKey: string | undefined;
    let attempts = 0;
    await page.route('**/api/studio', async route => {
      const {action,data} = route.request().postDataJSON();
      if (action === 'bootstrap') {
        const response = await route.fetch();
        const json = await response.json();
        json.data.modelReady = true;
        await route.fulfill({response,json});
        return;
      }
      if (action === 'propose') {
        assert.equal(data.newAgent, true);
        proposals.push({prompt:data.prompt, clarificationAnswer:data.clarificationAnswer});
        if (!process.env.STUDIO_TEST_DATA_DIR) {
          await route.fulfill({json:{data:{graph:meetingGraph}}});
          return;
        }
        if (data.clarificationAnswer === meetingRequest && lostAnswerKey) {
          assert.equal(data.requestKey, lostAnswerKey);
          await route.continue();
          return;
        }
        process.env.STUDIO_DATA_DIR = process.env.STUDIO_TEST_DATA_DIR;
        process.env.OPENAI_MODEL = 'test-model';
        process.env.OPENAI_API_KEY = 'offline-test-only';
        const nativeFetch = globalThis.fetch;
        try {
          globalThis.fetch = async (_url, options) => {
            const input = JSON.parse(JSON.parse(String(options?.body)).input);
            const result = (input.clarificationAnswer ?? input.request) === meetingRequest
              ? {...meetingGraph, purpose:meetingPurpose} : {clarification:true};
            return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
          };
          const result = await propose(user, data);
          if (data.clarificationAnswer === meetingRequest) {
            assert.ok('graph' in result);
            lostAnswerKey = data.requestKey;
            await route.abort('failed');
          } else {
            await route.fulfill({json:{data:result}});
          }
        } catch (error) {
          if (!(error instanceof StudioError)) throw error;
          await route.fulfill({status:error.status,json:{error:error.message}});
        } finally {
          globalThis.fetch = nativeFetch;
        }
        return;
      }
      if (action === 'project.create' && data.title === blankTitle && ++attempts === 1) {
        const committed = await route.fetch();
        assert.ok(committed.ok());
        await new Promise(resolve => setTimeout(resolve, 250));
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await namedChooser(blankTitle);
    const blank = dialog.getByRole('button', {name:/빈 캔버스에서 시작/});
    await expect(blank).toContainText(blankTitle);
    await blank.dblclick();
    await expect(dialog.getByRole('alert')).toBeVisible();
    assert.equal(attempts,1);
    await blank.focus();
    await page.keyboard.press('Enter');
    await created(blankTitle);
    const mine = await api(context, 'project.list');
    assert.equal(mine.filter((p:{title:string}) => p.title === blankTitle).length,1);

    const importTitle = '금요일 운영 자료 가져오기';
    await namedChooser(importTitle);
    await dialog.locator('input[type=file]').setInputFiles({
      name:'incomplete.json',mimeType:'application/json',buffer:Buffer.from('{'),
    });
    await dialog.getByRole('button', {name:'‘' + importTitle + '’ 만들기', exact:true}).click();
    await expect(dialog.getByRole('alert')).toContainText('내보낸 설계 JSON 파일을 다시 선택하세요');
    await dialog.locator('input[type=file]').setInputFiles({
      name:'rules.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({title:'파일 안의 이름',graph:intro.graph})),
    });
    await dialog.getByRole('button', {name:'‘' + importTitle + '’ 만들기', exact:true}).click();
    await created(importTitle);

    const aiTitle = '회의 결정 사항 정리';
    const projectCount = (await api(context,'project.list')).length;
    const question = dialog.getByRole('textbox', {name:'어떤 Agent를 만들고 싶으세요?',exact:true});
    const preview = dialog.getByRole('heading', {name:'제안된 Workflow',exact:true});
    await namedChooser(aiTitle);
    await dialog.getByRole('button', {name:/한 문장으로 시작/}).click();
    await dialog.getByLabel('맡길 일과 원하는 결과').fill(meetingRequest);
    await dialog.getByRole('button',{name:'초안 제안받기',exact:true}).click();
    await expect(preview).toBeVisible();
    await expect(question).toHaveCount(0);
    const connections = dialog.locator('.proposal-preview details');
    const flow = connections.getByRole('listitem').filter({hasText:'회의 메모 → 회의록·업무 보고 작성'});
    await expect(connections.locator('summary')).toHaveText('연결 설정 5개');
    await expect(flow).toBeHidden();
    await connections.locator('summary').click();
    await expect(flow).toContainText('진행·데이터');
    await expect(connections.getByRole('listitem').filter({hasText:'회의록 작성 Skill → 회의록·업무 보고 작성'})).toContainText('참조');
    assert.equal((await api(context,'project.list')).length,projectCount);
    assert.deepEqual(proposals,[{prompt:meetingRequest,clarificationAnswer:undefined}]);
    await dialog.getByRole('button',{name:'‘' + aiTitle + '’ 만들기'}).click();
    assert.deepEqual((await created(aiTitle)).graph.agentScope, {mode:'dedicated', purpose:meetingRequest});

    if (process.env.STUDIO_TEST_DATA_DIR) {
      await namedChooser('');
      await dialog.getByRole('button', {name:/한 문장으로 시작/}).click();
      const initialPrompt = mobile ? '프랑스의 수도는 어디인가요?' : '안녕하세요';
      await dialog.getByLabel('맡길 일과 원하는 결과').fill(initialPrompt);
      await dialog.getByRole('button',{name:'초안 제안받기',exact:true}).click();
      await expect(question).toBeFocused();
      await expect(preview).toHaveCount(0);
      const submitAnswer = dialog.getByRole('button',{name:'답변으로 초안 제안받기',exact:true});
      await expect(submitAnswer).toBeDisabled();
      const factualQuestion = '그러면 이탈리아의 수도는 어디인가요?';
      await question.fill(factualQuestion);
      await submitAnswer.click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(question).toHaveCount(1);
      await expect(preview).toHaveCount(0);
      await question.fill(meetingRequest);
      await submitAnswer.click();
      await expect(dialog.getByRole('alert')).toContainText('응답을 받지 못했습니다.');
      await dialog.getByRole('button',{name:'닫기',exact:true}).click();
      await page.getByRole('button',{name:'새 Agent',exact:true}).click();
      await dialog.getByRole('button', {name:/한 문장으로 시작/}).click();
      await expect(dialog.getByLabel('맡길 일과 원하는 결과')).toHaveValue(initialPrompt);
      await expect(question).toHaveValue(meetingRequest);
      await submitAnswer.click();
      await expect(preview).toBeVisible();
      await expect(dialog.locator('.proposal-preview')).toContainText('담당 업무 ' + meetingPurpose);
      await expect(question).toHaveValue(meetingRequest);
      assert.deepEqual(proposals.slice(1),[undefined,factualQuestion,meetingRequest,meetingRequest].map(clarificationAnswer => ({prompt:initialPrompt,clarificationAnswer})));
      assert.equal((await api(context,'project.list')).length,projectCount + 1);
      await dialog.getByRole('button',{name:'캔버스에 적용',exact:true}).click();
      assert.deepEqual((await created(meetingRequest)).graph.agentScope, {mode:'dedicated', purpose:meetingPurpose});
    }

    const lesson = templates.find(item => item.id === (mobile?'dynamic':'release'))!;
    const name = lesson.title + ' 사서 연습';
    await namedChooser(name);
    await dialog.getByRole('button', {name:/수준별 템플릿에서 시작/}).click();
    await page.reload();
    await page.locator('.lesson-tile').filter({hasText:lesson.title}).click();
    if (lesson.id === 'dynamic') {
      await dialog.getByLabel('총 생성 한도').selectOption('3');
      await dialog.getByLabel('동시 실행 한도').selectOption('1');
      await dialog.getByLabel('지점 조사 실패 시').selectOption('stop');
    }
    await dialog.getByRole('button', {name:'‘' + name + '’ 만들기'}).click();
    assert.equal((await created(name)).lesson, lesson.id);
    await page.goto('/?view=templates');
    await page.locator('.lesson-tile').filter({hasText:intro.title}).click();
    await expect(dialog.getByRole('button',{name:'내 사본으로 시작',exact:true})).toBeEnabled();

    const longTitle = '금요일야간개관시간확인'.repeat(9);
    const shared = await api(context, 'project.create', {graph:intro.graph,title:longTitle});
    const version = await api(context, 'versions.save', {id:shared.id,revision:shared.revision});
    await api(context, 'versions.publish', {id:shared.id,version:version.number,visibility:'public'});
    await page.goto('/?edit=' + shared.id);
    await page.getByLabel('프로젝트 메뉴', {exact:true}).click();
    await page.getByRole('button', {name:'공유 설정',exact:true}).click();
    const current = dialog.getByRole('region', {name:'현재 공유 상태'});
    await expect(current.getByText('모두에게 공개',{exact:true})).toBeVisible();
    await dialog.getByLabel('공유 범위').selectOption('link');
    const other=await context.newPage();
    await other.goto('/?edit='+shared.id);
    await other.getByLabel('프로젝트 메뉴',{exact:true}).click();
    await other.getByRole('button',{name:'공유 설정',exact:true}).click();
    await other.getByRole('button',{name:'공유 철회',exact:true}).click();
    await expect(other.getByRole('region',{name:'현재 공유 상태'})).toContainText('나만 사용');
    await other.close();
    await dialog.getByRole('button',{name:'공유 설정 적용'}).click();
    await expect(dialog.getByRole('alert')).toContainText('공유 상태가 변경');
    await expect(current).toContainText('나만 사용');
    await expect(dialog.getByText('나만 사용 → 비밀 링크')).toBeVisible();
    assert.equal((await api(context,'project.open',{id:shared.id})).visibility,'private');
    if (process.env.STUDIO_SCREENSHOTS) {
      mkdirSync(process.env.STUDIO_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,'revoked-agent-stale-window-' + (mobile?'mobile':'desktop') + '.png')});
    }
    await dialog.getByLabel('공유 범위').selectOption('public');
    await dialog.getByRole('button',{name:'공유 설정 적용'}).click();
    await expect(current.getByText('모두에게 공개',{exact:true})).toBeVisible();
    await dialog.getByLabel('공유 범위').selectOption('private');
    await expect(dialog.getByText('모두에게 공개 → 나만 사용')).toBeVisible();
    await expect(current.getByRole('button',{name:'현재 공유 주소 복사'})).toBeVisible();
    if (process.env.STUDIO_SCREENSHOTS) {
      mkdirSync(process.env.STUDIO_SCREENSHOTS, {recursive:true});
      await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS, 'sharing-before-apply-' + (mobile?'mobile':'desktop') + '.png')});
    }
    assert.equal((await api(context, 'project.open',{id:shared.id})).visibility, 'public');
    await dialog.getByRole('button', {name:'공유 설정 적용'}).click();
    await expect(current.getByText('나만 사용',{exact:true})).toBeVisible();
    await expect(dialog.getByText('적용 전 변경')).toHaveCount(0);
    await expect(current.getByRole('button',{name:/주소 복사/})).toHaveCount(0);
    assert.equal((await api(context,'project.open',{id:shared.id})).visibility, 'private');
    await page.goto('/?view=projects');
    const row = page.getByRole('button',{name:new RegExp(longTitle)}).filter({has:page.getByText('나만 사용')});
    await expect(row.getByText('나만 사용')).toBeVisible();
    await expect(row.getByText(/게시 v1/)).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const asset = await api(context,'asset.save',{kind:'document',name:longTitle,payload:{content:'안내 본문'}});
    await api(context,'asset.share',{id:asset.id,version:1,visibility:'link'});
    await page.goto('/?view=assets');
    const resource = page.getByRole('button',{name:new RegExp(longTitle)}).filter({has:page.getByText('비밀 링크')});
    await expect(resource.getByText('비밀 링크')).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  } finally {
    await context.close();
  }
}
async function shareAndResume(mobile: boolean) {
  const viewport = mobile ? {width:390,height:844} : {width:1440,height:900};
  const ctx = await browser.newContext({baseURL, viewport, isMobile:mobile, hasTouch:mobile});
  try {
    await registerBrowserAccount(ctx);
    const title = '야간 개관과 휴관일에 접수된 이용자 문의를 중앙도서관과 분관의 운영 규정에서 찾아 출처를 표시하고, 예외 사항은 당직 사서에게 확인받아 회신하는 지역 도서관 안내 Agent';
    const project = await api(ctx, 'project.create', {title, lesson:'intro'});
    await api(ctx, 'versions.save', {id:project.id, revision:project.revision});
    await api(ctx, 'versions.save', {id:project.id, revision:project.revision});
    await api(ctx, 'editor.visit', {id:project.id, focus:{path:[], selection:null}});
    if (mobile) {
      // Put newer projects ahead of the project selected from the full list.
      for (let index = 1; index <= 12; index++) {
        await api(ctx, 'project.create', {title:'분관 신규 안내 ' + index,graph:intro.graph});
      }
    }
    const page = await ctx.newPage();
    const listShare = page.getByRole('button', {name:title + ' 공유 설정',exact:true});
    await page.goto('/');
    const name = page.getByRole('heading', {name:title, exact:true});
    const expand = page.getByRole('button',{name:'전체 이름 보기'});
    const open = page.getByRole('button',{name:'편집기 다시 열기'});
    await expect(expand).toBeVisible();
    await expect(open).toBeInViewport({ratio:1});
    await expect(page.locator('.lh-mini-selected')).toBeInViewport();
    const limited = (await name.boundingBox())!.height;
    await expand.click();
    assert.ok((await name.boundingBox())!.height > limited);
    await page.getByRole('button',{name:'이름 접기'}).click();
    await expect(expand).toHaveAttribute('aria-expanded','false');
    if (process.env.STUDIO_SCREENSHOTS) {
      mkdirSync(process.env.STUDIO_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,'resume-long-name-' + (mobile?'mobile':'desktop') + '.png')});
    }
    await open.click();
    if (mobile) {
      await page.goto('/?view=projects');
      await listShare.tap();
    } else {
      await page.getByLabel('프로젝트 메뉴',{exact:true}).click();
      await page.getByRole('button',{name:'공유 설정',exact:true}).click();
    }
    const share = page.getByRole('dialog',{name:'Agent 공유 설정'});
    await share.getByLabel('대상 버전').selectOption('1');
    await share.getByLabel('공유 범위').selectOption('link');
    await expect(share.getByLabel('대상 버전')).toHaveValue('1');
    assert.equal((await api(ctx,'project.open',{id:project.id})).visibility, 'private');
    if (mobile) {
      await expect(share.getByLabel('공유 범위')).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(listShare).toBeFocused();
      await expect(listShare).toBeInViewport({ratio:1});
      await listShare.tap();
      await share.getByLabel('대상 버전').selectOption('1');
      await share.getByLabel('공유 범위').selectOption('link');
    }
    await share.getByRole('button',{name:'선택한 버전 게시'}).click();
    await expect(share.getByRole('region',{name:'현재 공유 상태'})).toContainText('비밀 링크');
    assert.equal((await api(ctx,'project.open',{id:project.id})).publicVersion,1);
    if (mobile) {
      await expect(share.getByLabel('공유 범위')).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(listShare).toBeFocused();
      await expect(listShare).toBeInViewport({ratio:1});
      await expect(page).toHaveURL(/\?view=projects$/);
    }
  } finally { await ctx.close(); }
}
async function resourceSharing(mobile: boolean) {
  const ctx = await browser.newContext({baseURL, viewport:mobile?{width:390,height:844}:{width:1440,height:900}, isMobile:mobile, hasTouch:mobile});
  try {
    await registerBrowserAccount(ctx);
    const asset = await api(ctx,'asset.save',{kind:'document',name:'야간 개관 시간',payload:{content:'오후 8시까지'}});
    await api(ctx,'asset.save',{id:asset.id,baseVersion:1,name:asset.name,payload:{content:'오후 9시까지'}});
    const page = await ctx.newPage();
    const edition = mobile ? 1 : 2;
    const url = '/?asset=' + asset.id + (mobile?'&edition=1':'');
    const lib = page.getByRole('region',{name:'도구 및 자료'});
    await page.goto(url);
    await lib.getByLabel('공유 범위').selectOption('link');
    await expect(lib.getByLabel('자료 버전')).toHaveValue(String(edition));
    await expect(lib.getByLabel('공유 범위')).toHaveValue('link');
    const apply = lib.getByRole('button',{name:edition + '판 공유',exact:true});
    await expect(apply).toBeEnabled();
    assert.equal((await api(ctx,'asset.read',{id:asset.id})).asset.visibility,'private');
    await apply.click();
    await expect(lib.getByRole('textbox',{name:'최신 게시판 주소'})).toBeVisible();
    assert.equal((await api(ctx,'asset.read',{id:asset.id})).asset.publicVersion,edition);
  } finally { await ctx.close(); }
}
try {
  await ownerDraftAndSharingRecovery();
  await resourceSharing(false);
  await resourceSharing(true);
  await shareAndResume(false);
  await shareAndResume(true);
  await exercise(false);
  await exercise(true);
  console.log('Desktop and mobile creation, retry, import, sharing and list visibility passed.');
} finally {
  await browser.close();
}
