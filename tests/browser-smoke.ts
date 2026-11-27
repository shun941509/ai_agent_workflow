import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test';
import { createBlock, templates, type Edge, type Graph } from '../src/domain';
import { registerBrowserAccount } from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL)
  throw Error(
    '실제 서비스와 분리된 시험용 Studio 주소를 STUDIO_TEST_URL로 지정하세요.'
  );
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (existsSync(chrome) ? chrome : undefined),
});
const desktop = await browser.newContext({
  baseURL,
  viewport: { width: 1500, height: 940 },
});
const mobile = await browser.newContext({
  baseURL,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const errors: string[] = [];
const stamp = crypto.randomUUID().slice(0, 8);
const artifacts = process.env.STUDIO_SCREENSHOTS;
if (artifacts) mkdirSync(artifacts, { recursive: true });
async function shot(page: Page, name: string) {
  if (artifacts)
    await page.screenshot({ path: resolve(artifacts, name + '.png') });
}
async function api(
  ctx: BrowserContext,
  action: string,
  data: unknown = {},
  status = 200
) {
  const res = await ctx.request.post('/api/studio', { data: { action, data } });
  const result = await res.json();
  assert.equal(
    res.status(),
    status,
    action + ' ' + JSON.stringify(result.error)
  );
  return result.data;
}
async function newPage(ctx: BrowserContext) {
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  p.on('pageerror', (e) => errors.push(e.message));
  return p;
}
async function openProjectAction(page: Page, name: string) {
  await page.getByLabel('프로젝트 메뉴', { exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function noOverflow(p: Page) {
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    ),
    'unexpected horizontal overflow'
  );
}
async function signUpFromLogin(page: Page, login: string) {
  await expect(page.getByRole('heading', { name: '로그인', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '계정 만들기', exact: true }).click();
  const form = page.locator('form');
  await form.getByLabel('아이디', { exact: true }).fill(login);
  await form.getByLabel('비밀번호', { exact: true }).fill('Q!' + crypto.randomUUID());
  await form.getByRole('button', { name: '계정 만들기', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === '/');
}

async function checkLoginRequired(small: boolean) {
  const publisher = await browser.newContext({ baseURL });
  const reader = await browser.newContext({
    baseURL, viewport: small ? {width:390,height:844} : {width:1440,height:900}, isMobile:small, hasTouch:small,
  });
  const registeredReader = await browser.newContext({baseURL});
  const credentials = {login:'signin-' + crypto.randomUUID().slice(0, 12), password:crypto.randomUUID()};
  try {
    await registerBrowserAccount(publisher);
    await registerBrowserAccount(registeredReader, credentials);
    const project = await api(publisher, 'project.create', {title:'로그인 후 여는 자료 안내', graph:policyGraph(3)});
    const version = await api(publisher, 'versions.save', {id:project.id, revision:project.revision});
    const release = await api(publisher, 'versions.publish', {id:project.id, version:version.number, visibility:'link'});
    const address = '/?agent=' + project.id + '&token=' + release.token + '#details';
    const page = await newPage(reader);
    const heading = page.getByRole('heading', {name:'로그인', exact:true});
    const form = page.locator('form');
    async function expectLoginPage() {
      await expect(page).toHaveURL(url => url.pathname === '/login');
      await expect(heading).toBeVisible();
      await expect(page.getByRole('navigation', {name:'작업 화면'})).toHaveCount(0);
      await noOverflow(page);
    }

    await page.goto('/');
    await expectLoginPage();
    await api(reader, 'bootstrap', {}, 401);
    await api(reader, 'project.create', {title:'보호된 작업실'}, 401);
    await api(reader, 'project.open', {id:project.id, token:release.token}, 401);
    assert.equal((await reader.cookies()).some(cookie => cookie.name === 'studio_session'), false);

    await page.goto(address);
    await expectLoginPage();
    await form.getByLabel('아이디', {exact:true}).fill(credentials.login);
    await form.getByLabel('비밀번호', {exact:true}).fill('invalid-test-password');
    await page.route('**/api/studio', route => route.abort('internetdisconnected'), {times:1});
    await form.getByRole('button', {name:'로그인', exact:true}).click();
    await expect(form.getByRole('alert')).toContainText('네트워크 연결과 작업실 서버 상태를 확인하세요.');
    await expect(form.getByLabel('아이디', {exact:true})).toHaveValue(credentials.login);
    await expect(form.getByLabel('비밀번호', {exact:true})).toHaveValue('invalid-test-password');
    await form.getByRole('button', {name:'로그인', exact:true}).click();
    await expect(form.getByRole('alert')).toContainText('아이디 또는 비밀번호');
    await expectLoginPage();
    await form.getByLabel('비밀번호', {exact:true}).fill(credentials.password);
    await form.getByLabel('비밀번호', {exact:true}).press('Enter');
    const detail = page.getByRole('dialog', {name:project.title, exact:true});
    await expect(detail.getByRole('button', {name:'Agent 사용', exact:true})).toBeEnabled();
    await expect(page).toHaveURL(url => url.pathname === '/' && url.searchParams.get('agent') === project.id && url.searchParams.get('token') === release.token && url.hash === '#details');
    const otherTab = await newPage(reader);
    await otherTab.goto('/?view=projects');
    await expect(otherTab.getByRole('heading', {name:'내 Agent', exact:true})).toBeVisible();
    await page.bringToFront();
    await page.goto('/?view=projects');
    if (small) await page.getByRole('button', {name:'메뉴 열기', exact:true}).click();
    await page.getByRole('button', {name:'로그아웃', exact:true}).click();
    await expectLoginPage();
    await page.goBack();
    await expectLoginPage();
    await expect(detail).toHaveCount(0);
    await api(reader, 'project.list', {}, 401);
    await otherTab.bringToFront();
    await expect(otherTab.getByRole('heading', {name:'로그인', exact:true})).toBeVisible();
    await otherTab.goto(address);
    await signUpFromLogin(otherTab, 'invite-' + crypto.randomUUID().slice(0, 12));
    await expect(otherTab.getByRole('dialog', {name:project.title, exact:true})
      .getByRole('button', {name:'Agent 사용', exact:true})).toBeEnabled();
  } finally {
    await Promise.all([publisher.close(), registeredReader.close(), reader.close()]);
  }
}

async function checkLegacyGuestLogin(directory: string) {
  process.env.STUDIO_DATA_DIR = directory;
  const { legacyGuestSession } = await import('./legacy-guest');
  const { createProject } = await import('../src/server/projects');
  const { set } = await import('../src/server/db');
  const guest = legacyGuestSession();
  const project = createProject(guest.user, {title: '이전 작업실에 남겨 둔 Agent', lesson: 'beginner'});
  const credentials = {login:'migration-' + crypto.randomUUID().slice(0,12), password:crypto.randomUUID()};
  const member = await browser.newContext({baseURL});
  const previous = await browser.newContext({baseURL});
  try {
    await registerBrowserAccount(member, credentials);
    const value = guest.cookie.split(';')[0].replace('studio_session=', '');
    await previous.addCookies([{name:'studio_session', value, url:baseURL!, httpOnly:true}]);
    await api(previous, 'project.open', {id:project.id}, 401);
    const page = await newPage(previous);
    await page.goto('/');
    const form = page.locator('form');
    async function logIn(choice: RegExp) {
      await expect(page.getByRole('heading', {name:'로그인', exact:true})).toBeVisible();
      await form.getByLabel('아이디', {exact:true}).fill(credentials.login);
      await form.getByLabel('비밀번호', {exact:true}).fill(credentials.password);
      await form.getByRole('radio', {name:choice}).check();
      await form.getByRole('button', {name:'로그인', exact:true}).click();
      await expect(page.getByRole('button', {name:'로그아웃', exact:true})).toBeVisible();
    }
    await logIn(/이 브라우저에 보관/);
    await api(previous, 'project.open', {id:project.id}, 403);
    await page.getByRole('button', {name:'로그아웃', exact:true}).click();
    await expect(page.getByRole('heading', {name:'로그인', exact:true})).toBeVisible();
    await api(previous, 'project.open', {id:project.id}, 401);
    await logIn(/계정으로 가져오기/);
    assert.equal((await api(member, 'project.open', {id:project.id})).mine, true);

    const expired = legacyGuestSession();
    createProject(expired.user, {title:'만료된 게스트 작업'});
    set('UPDATE sessions SET expires=? WHERE owner=?', Date.now() - 1000, expired.user.id);
    await previous.addCookies([{name:'studio_session', value:expired.cookie.slice('studio_session='.length), url:baseURL!, httpOnly:true}]);
    await api(previous, 'bootstrap', {}, 401);
    await page.goto('/');
    await expect(page.getByRole('heading', {name:'로그인', exact:true})).toBeVisible();
    await expect(form.getByRole('radio')).toHaveCount(0);
  } finally {
    await Promise.all([member.close(), previous.close()]);
  }
}

function policyGraph(limit: number): Graph {
  const input = createBlock('input.user_request', {
    id: 'question',
    title: '질문',
    x: 40,
    y: 50,
  });
  const stop = createBlock('control.terminate', {
    id: 'answer',
    title: '대출 안내',
    x: 300,
    y: 50,
    config: { message: '대출 한도는 ' + limit + '권입니다.' },
  });
  const edges: Edge[] = [
    {
      id: 'next',
      from: input.id,
      to: stop.id,
      kind: 'flow',
      out: 'next',
      input: 'in',
    },
  ];
  return { nodes: [input, stop], edges };
}
async function verifyAnswer(
  ctx: BrowserContext,
  id: string,
  token: string | undefined,
  expected: string,
  conversation?: string
) {
  const run = await api(ctx, 'run.start', {
    id,
    token,
    conversation,
    input: '대출 한도를 알려 주세요.',
    mode: 'live',
    requestKey: crypto.randomUUID(),
  });
  let result = run;
  await expect
    .poll(
      async () => {
        result = await api(ctx, 'run.get', { runId: run.id });
        return result.state;
      },
      { timeout: 25000 }
    )
    .toBe('completed');
  assert.equal(result.output, expected);
  return result;
}

async function verifyMobileSourceRun(ctx: BrowserContext) {
  // Running the source directly through an output exercises the worker without a model provider.
  const original = '대출 한도는 3권입니다. 다음 날에도 반납할 수 있습니다.';
  const changed = original.replace('3권', '5권');
  const graph: Graph = {
    nodes: [
      createBlock('input.user_request', { id: 'ask', title: '규정 질문', x: 20, y: 20 }),
      createBlock('resource.context', { id: 'rule', title: '검증용 대출 규정', x: 20, y: 160, config: { content: original } }),
      createBlock('output.answer', { id: 'answer', title: '규정 원문 전달', x: 280, y: 100 }),
    ],
    edges: [
      { id: 'start', from: 'ask', to: 'answer', kind: 'flow', out: 'next', input: 'in' },
      { id: 'text', from: 'rule', to: 'answer', kind: 'data', out: 'value', input: 'input' },
    ],
  };
  const project = await api(ctx, 'project.create', { title: '원문 답변 검증', graph });
  const page = await newPage(ctx);
  try {
    await page.goto('/?edit=' + project.id);
    await expect(page.locator('.ws-graph-list [data-canvas-block="rule"]')).toContainText('대출 한도는 3권입니다.');
    await page.getByRole('button', {name:'캔버스로 보기',exact:true}).click();
    const rule = page.getByRole('button', { name: '검증용 대출 규정 블록 속성', exact: true });
    await expect(rule).toContainText('대출 한도는 3권입니다.');
    await expect(rule).not.toContainText('다음 날');
    await rule.press('Enter');
    const source = page.getByLabel('자료 원문', { exact: true });
    const propertiesTab = page.getByRole('tab', { name: '속성', exact: true });
    const resultsTab = page.getByRole('tab', { name: '실행 결과', exact: true });
    const results = page.getByRole('tabpanel', { name: '실행 결과', exact: true });
    await expect(propertiesTab).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('.ws-inspector').evaluate(panel => panel.contains(document.activeElement)), true);
    await source.focus();
    await source.press('Escape');
    await expect(rule).toBeFocused();
    await rule.press('Enter');
    await expect(propertiesTab).toBeFocused();
    const question = '오늘의 대출 한도와 반납 규정을 알려 주세요.';
    const questionField = results.getByLabel('Agent에게 보낼 질문');
    const submit = results.getByRole('button', { name: '질문 실행', exact: true });
    await source.fill(changed);
    await resultsTab.click();
    assert.deepEqual(await api(ctx, 'run.list', { id: project.id }), []);
    await results.getByRole('button', {name:'현재 적용된 원문으로 시험', exact:true}).click();
    await questionField.fill(question);
    await submit.click();
    await expect(results.locator('.run-output')).toHaveText(original, { timeout: 20000 });
    await propertiesTab.click();
    await expect(source).toHaveValue(changed);
    await page.getByRole('button', { name: '변경 적용', exact: true }).click();
    await page.getByRole('button', { name: '속성 닫기', exact: true }).click();
    await expect(rule).toContainText('대출 한도는 5권입니다.');

    await page.getByRole('button', { name: '시험 실행', exact: true }).click();
    await expect(resultsTab).toHaveAttribute('aria-selected', 'true');
    await expect(results).toBeInViewport();
    await expect(questionField).toHaveValue(question);
    await submit.click();
    await expect(results.locator('.run-question')).toHaveText(question);
    await expect(results.locator('.run-output')).toHaveText(changed, { timeout: 20000 });
    const records = await api(ctx, 'run.list', { id: project.id });
    assert.equal(records.length, 2);
    const [record] = records;
    assert.deepEqual([record.input, record.output, record.state], [question, changed, 'completed']);
    await noOverflow(page);
    await shot(page, 'editor-mobile-run-result');
    await propertiesTab.click();
    await expect(source).toHaveValue(changed);
    await resultsTab.click();
    await expect(results.locator('.run-output')).toHaveText(changed);

    await page.getByRole('button', { name: '실행 화면 닫기', exact: true }).click();
    await page.getByRole('button', { name: '규정 원문 전달 블록 속성', exact: true }).click();
    await page.getByRole('button', { name: '블록 삭제', exact: true }).click();
    await page.getByRole('button', { name: '속성 닫기', exact: true }).click();
    await page.getByRole('button', { name: '시험 실행', exact: true }).click();
    await expect(results.getByRole('alert')).toContainText('답변 전달 블록을 추가하세요');
    await expect(results.locator('.run-output')).toBeHidden();
    await questionField.fill(question);
    await expect(submit).toBeDisabled();
    await results.getByRole('button', { name: '설계 검사', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '설계 검사' })).toBeVisible();
    assert.equal((await api(ctx, 'run.list', { id: project.id })).length, 2);
  } finally { await page.close(); }
}

async function verifyEvidenceRepair(page: Page) {
  const graph: Graph = {
    nodes: [
      createBlock('input.user_request', { id:'ask', x:20, y:80 }),
      createBlock('resource.context', { id:'rules', x:20, y:220, config:{content:'대출 한도는 5권입니다.'} }),
      createBlock('quality.evidence', { id:'check', x:400, y:80 }),
      createBlock('output.answer', { id:'end', x:640, y:80 }),
    ],
    edges: [
      {id:'start',from:'ask',to:'check',kind:'flow',out:'next',input:'in'},
      {id:'question',from:'ask',to:'check',kind:'data',out:'value',input:'input'},
      {id:'source',from:'rules',to:'check',kind:'reference',out:'ref',input:'context'},
      ...['verified','insufficient','conflicting'].map(out => ({
        id:out,from:'check',to:'end',kind:'flow' as const,out,input:'in',
      })),
      {id:'answer',from:'check',to:'end',kind:'data',out:'value',input:'input'},
    ],
  };
  const ctx = page.context();
  const project = await api(ctx, 'project.create', {title:'원문 근거 연결 확인',graph});
  await page.goto('/?edit='+project.id);
  await page.getByRole('button', {name:'설계 검사',exact:true}).click();
  const issues = page.getByRole('dialog', {name:'설계 검사'});
  await issues.getByRole('button', {name:/자료 검색.*검색된 구절/}).click();
  await page.getByRole('button', {name:'자료 검색 추가',exact:true}).click();
  await expect(page.getByLabel('검색어 또는 질의')).toBeVisible();
  await openProjectAction(page, '저장');
  await expect.poll(async () => (await api(ctx,'project.open',{id:project.id})).graph.nodes.length).toBe(5);
  await page.reload();
  await page.getByRole('button', {name:'설계 검사',exact:true}).click();
  await expect(issues).toContainText('현재 설계가 실행 조건을 충족합니다.');
  await issues.getByRole('button', {name:'닫기'}).click();
  await page.getByRole('button', {name:'시험 실행',exact:true}).click();
  const panel = page.getByRole('tabpanel', {name:'실행 결과',exact:true});
  await panel.getByLabel('Agent에게 보낼 질문').fill('망원경');
  await panel.getByRole('button', {name:'질문 실행',exact:true}).click();
  await expect(panel.locator('.run-output')).toContainText('insufficient', {timeout:20000});
  const [run] = await api(ctx,'run.list',{id:project.id});
  const detail = await api(ctx,'run.get',{runId:run.id});
  assert.ok(detail.events.some((e:{kind:string; title:string}) => e.kind==='lookup' && e.title==='자료 검색'));
}

async function chooseDynamicPolicy(page: Page) {
  await page.getByRole('button', {name: '전체 보기'}).click();
  await page.getByRole('button', {name: '전문가', exact: true}).click();
  await page.locator('.lesson-tile').filter({hasText: /지점/}).click();
  const dialog = page.getByRole('dialog');
  const start = dialog.getByRole('button', {name: '내 사본으로 시작'});
  const total = dialog.getByLabel('총 생성 한도');
  const concurrency = dialog.getByLabel('동시 실행 한도');
  const policy = dialog.getByLabel('지점 조사 실패 시');
  await expect(start).toBeDisabled();
  await total.selectOption('4');
  await concurrency.selectOption('2');
  await expect(start).toBeDisabled();
  await total.selectOption('1');
  await expect(concurrency).toHaveValue('');
  await total.selectOption('3');
  await concurrency.selectOption('1');
  await policy.selectOption('stop');
  await start.click();
  await expect(page.locator('.ws-editor')).toBeVisible();
  const id = new URL(page.url()).searchParams.get('edit');
  const graph = (await api(desktop, 'project.open', {id})).graph as Graph;
  const spawn = graph.nodes.find(node => node.type === 'agent.create_dynamic')!;
  assert.deepEqual([spawn.config.maxCreatedAgents, spawn.config.maxInFlightAgents, spawn.config.failurePolicy], [3, 1, 'stop']);
}

async function verifyEditorLessonGuides() {
  const context = await browser.newContext({baseURL});
  try {
    await api(context, 'auth.signup', {login:'guides-'+stamp, password:'Q!'+crypto.randomUUID()});
    const page = await newPage(context);
    async function checkGuide(id: string, steps: string[], criterion: string, intro = false) {
      await page.goto('/?edit='+id);
      await page.getByRole('button', {name:'실습 안내', exact:true}).click();
      const guide = page.getByRole('main');
      await expect(page).toHaveURL(/[?&]view=guide/);
      if (intro) {
        await guide.getByRole('navigation', {name:'첫 실습 단계'}).getByRole('button', {name:/지시 바꾸기/}).click();
        for (const step of steps) await expect(guide).toContainText(step);
        await expect(guide).toContainText(criterion);
      } else {
        const order = guide.getByRole('heading',{level:3,name:/실습 안내$/}).locator('xpath=following-sibling::ol[1]');
        for (const step of steps) await expect(order).toContainText(step);
        await guide.getByText('제공된 예시와 완료 기준 보기', {exact:true}).click();
        await expect(guide.getByRole('list').filter({hasText:criterion}).first()).toBeVisible();
      }
      await guide.getByRole('button', {name:/돌아가기$/}).click();
      await expect(page).toHaveURL(url => url.searchParams.get('edit') === id);
    }
    const lessons = [
      {id:'intro', steps:['작업 지시','새 대화'], criterion:'신분증'},
      {id:'beginner', steps:['3권','5권','대출안내.txt'], criterion:'대출안내.txt'},
      {id:'intermediate', steps:['추가 안내문 받기','같은 실행 이어가기','내 예약 조회'], criterion:'지점명'},
      {id:'parallel', steps:['회원증 담당 안내문 → 회원증 담당 자료 검색','연결선 삭제'], criterion:'미확인'},
      {id:'dynamic', steps:['중앙도서관','강변도서관'], criterion:'선택 제외는 0곳'},
      {id:'peer-review', steps:['초안','검토자'], criterion:'수정 전후'},
      {id:'release', steps:['같은 사례로 두 번 시험','비밀 링크','이전 판으로 복구'], criterion:'기존 대화'},
    ];
    for (const lesson of lessons) {
      const project = await api(context, 'project.create', {lesson:lesson.id});
      await checkGuide(project.id, lesson.steps, lesson.criterion, lesson.id === 'intro');
      if (lesson.id !== 'beginner' && lesson.id !== 'peer-review') continue;

      // Restore the previous layout, which connected the agent or each reviewer directly to its successor.
      const graph: Graph = project.graph;
      const beginner = lesson.id === 'beginner';
      const target = beginner ? graph : graph.nodes.find(node => node.type === 'agent.team')!.graph!;
      const predecessors = new Map<string,string>(beginner ? [['file','agent']] :
        [['record-facts','review-facts'],['record-clarity','review-clarity'],['report','revise']]);
      target.nodes = target.nodes.filter(node => !predecessors.has(node.id));
      target.edges = target.edges.filter(edge => !predecessors.has(edge.to)).map(edge => {
        const from = predecessors.get(edge.from);
        return from ? {...edge, from, id:[from,edge.out,edge.to,edge.input].join('/')} : edge;
      });
      const old = await api(context, 'project.create', {lesson:lesson.id, title:project.title+' 이전 사본', graph});
      if (beginner) {
        await page.goto('/?edit='+old.id);
        const task = page.locator('.ws-task');
        await expect(task).toContainText('5권');
        await expect(task).not.toContainText('내려받');
        await checkGuide(old.id, ['5권','수준별 템플릿'], '인용');
      }
      else await checkGuide(old.id, ['입출력 보기','수준별 템플릿'], '초안');
      assert.deepEqual((await api(context, 'project.open', {id:old.id})).graph, graph);
    }
  } finally { await context.close(); }
}

async function verifyReleaseCopyGuide(context: BrowserContext) {
  const original = await api(context, 'project.create', {lesson:'release'});
  const copy = await api(context, 'project.copy', {id:original.id});
  const page = await newPage(context);
  try {
    await page.goto('/?edit='+copy.id);
    await expect(page.locator('.ws-task')).toContainText('첫 버전');
    await page.getByRole('button', {name:'실습 안내', exact:true}).click();
    const guide = page.getByRole('main');
    const order=guide.getByRole('heading',{level:3,name:/실습 안내$/}).locator('xpath=following-sibling::ol[1]');
    await expect(order).toContainText('현재 초안 버전 저장');
    await guide.getByRole('button', {name:'기준판·후보판이 준비된 실습 열기'}).click();
    const dialog = page.getByRole('dialog', {name:'규정 변경 검증·게시·복구'});
    await dialog.getByRole('button', {name:'내 사본으로 시작'}).click();
    await expect(page).toHaveURL(url => url.searchParams.has('edit') && url.searchParams.get('edit') !== copy.id);
    await page.getByRole('button', {name:'시험 실행', exact:true}).click();
    await expect(page.getByLabel('실행할 설계 버전')).toHaveValue('1');
    await expect(page.getByLabel('비교할 버전')).toHaveValue('2');
    await expect(page.getByLabel('시험 사례 선택').locator('option')).toHaveCount(4);
  } finally { await page.close(); }
}

async function chooseReleaseDecision(page: Page) {
  await page.getByRole('button', {name: '작업실 홈', exact: true}).click();
  await page.getByRole('button', {name: '전체 보기'}).click();
  await page.getByRole('button', {name: '전문가', exact: true}).click();
  await page.locator('.lesson-tile').filter({hasText: /규정 변경/}).click();
  await page.getByRole('button', {name: '내 사본으로 시작'}).click();
  await expect(page.locator('.ws-editor')).toBeVisible();
  const id = new URL(page.url()).searchParams.get('edit');
  await page.getByRole('button', {name: '시험 실행'}).click();
  await expect(page.getByLabel('실행할 설계 버전')).toHaveValue('1');
  await expect(page.getByLabel('비교할 버전')).toHaveValue('2');
  await expect(page.getByLabel('비교할 버전')).toBeVisible();
  const cases = page.getByLabel('시험 사례 선택');
  await expect(cases.locator('option')).toHaveCount(4);
  await cases.selectOption({label:'일요일 운영 규정'});
  await expect(page.getByLabel('기대 결과')).toHaveValue(/휴관/);
  await expect(page.getByRole('button', {name:'같은 사례로 두 번 시험'})).toBeEnabled();
  await page.getByRole('tab', {name:'속성', exact:true}).click();
  await openProjectAction(page, '공유 설정');
  const dialog = page.getByRole('dialog', {name: 'Agent 공유 설정'});
  const version = dialog.getByLabel('대상 버전');
  const decision = dialog.getByRole('combobox', {name: '게시 판단', exact: true});
  const reason = dialog.getByLabel('판단 근거');
  const submit = dialog.getByRole('button', {name: '판단 적용 및 기록'});
  await expect(submit).toBeDisabled();
  async function record(target: string, action: string, why: string, count: number) {
    await version.selectOption(target);
    await decision.selectOption(action);
    await expect(submit).toBeDisabled();
    await reason.fill(why);
    await submit.click();
    await expect(dialog.getByText('판단 기록 ('+count+'건)', {exact:true})).toBeVisible();
  }
  const whyHold = '일요일 휴관과 다른 답변이 있어 운영 정보를 다시 확인합니다.';
  await version.selectOption('2');
  await decision.selectOption('hold');
  await reason.fill(whyHold);
  let resumeDecision!: () => void;
  const holdRequest = new Promise<void>(resolve => { resumeDecision = resolve; });
  const delayDecision = async (route: Route) => {
    if (route.request().postDataJSON()?.action === 'versions.decide') await holdRequest;
    await route.fallback();
  };
  await page.route('**/api/studio', delayDecision);
  try {
    await submit.click();
    await expect(decision).toBeDisabled();
    await expect(reason).not.toBeEditable();
  } finally { resumeDecision(); }
  await expect(dialog.getByText('판단 기록 (1건)', {exact:true})).toBeVisible();
  await page.unroute('**/api/studio', delayDecision);
  const held = await api(desktop, 'project.open', {id});
  assert.equal(held.visibility, 'private');
  assert.equal(held.publicVersion, null);
  await dialog.getByLabel('공유 범위').selectOption('link');
  await record('2', 'publish', '게시된 후보판에서 문제가 보고됐을 때의 대응을 시험합니다.', 2);
  const audience = dialog.getByLabel('공유 범위');
  await audience.selectOption('public');
  await decision.selectOption('publish');
  await reason.fill('공개 범위를 검토하던 중 작성한 근거');
  await audience.selectOption('link');
  await expect(decision).toHaveValue('');
  await expect(reason).toHaveValue('공개 범위를 검토하던 중 작성한 근거');
  await expect(submit).toBeDisabled();
  await record('1', 'rollback', '일요일 운영 안내에 오류가 있어 이전 기준판으로 복구합니다.', 3);
  await dialog.getByRole('button', {name:'닫기', exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await openProjectAction(page, '공유 설정');
  await dialog.getByText('판단 기록 (3건)', {exact:true}).click();
  await expect(dialog.getByText(whyHold, {exact:true})).toBeVisible();
  await expect(dialog.getByText('현재 게시 버전 v1', {exact:true})).toBeVisible();
  const after = await api(desktop, 'project.open', {id});
  assert.equal(after.visibility, 'link');
  assert.deepEqual(after.releaseExercise.decisions.map((d: {action: string}) => d.action), ['rollback','publish','hold']);
  await page.keyboard.press('Escape');
}

async function verifyTrashSelection(page: Page) {
  const ctx = page.context();
  const titles = ['정리 대상 A', '정리 대상 B', '보관할 Agent'].map(name => name+' '+stamp);
  for (const title of titles) {
    const project = await api(ctx, 'project.create', {title});
    await api(ctx, 'project.delete', {id:project.id, revision:project.revision});
  }
  await page.goto('/?view=projects&folder=trash');
  const search = page.getByRole('textbox', {name:'휴지통에서 Agent 이름 검색'});
  const purge = page.getByRole('button', {name:'선택 항목 영구 삭제'});
  const rowCheck = (title:string) => page.getByRole('checkbox', {name:title+' 선택', exact:true});
  await expect(rowCheck(titles[2])).not.toBeChecked();
  await expect(purge).toBeDisabled();
  await expect(page.getByText(/자동 삭제 예정/).first()).toBeVisible();
  await noOverflow(page);
  await rowCheck(titles[2]).check();
  await expect(purge).toBeEnabled();
  await search.fill('정리 대상');
  await expect(purge).toBeDisabled();
  await page.getByRole('checkbox', {name:'표시된 프로젝트 전체 선택'}).check();
  await expect(rowCheck(titles[0])).toBeChecked();
  await expect(rowCheck(titles[1])).toBeChecked();
  await purge.click();
  const dialog = page.getByRole('dialog', {name:'프로젝트 영구 삭제'});
  for (const title of titles.slice(0, 2)) await expect(dialog.getByText(title, {exact:true})).toBeVisible();
  await expect(dialog.getByText(titles[2], {exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('button', {name:'취소'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  assert.equal((await api(ctx, 'project.trash')).length, 3);

  await purge.click();
  await dialog.getByRole('button', {name:'영구 삭제', exact:true}).click();
  await expect(page.getByText('프로젝트 2개를 영구 삭제했습니다.', {exact:true})).toBeVisible();
  await page.reload();
  await expect(rowCheck(titles[0])).toHaveCount(0);
  await expect(rowCheck(titles[1])).toHaveCount(0);
  await expect(rowCheck(titles[2])).not.toBeChecked();
  await expect(purge).toBeDisabled();
  await page.getByRole('button', {name:titles[2]+' 복구', exact:true}).click();
  await expect(page.getByRole('button', {name:titles[2]+' 삭제', exact:true})).toBeVisible();
}

async function verifyConnections(page: Page) {
  const input = createBlock('input.user_request', {
    id: 'in',
    title: '받을 질문',
    x: 40,
    y: 70,
  });
  const output = createBlock('output.answer', {
    id: 'out',
    title: '전달할 답변',
    x: 390,
    y: 70,
  });
  const agent = await api(desktop, 'project.create', {
    title: '연결 편집 ' + stamp,
    graph: { nodes: [input, output], edges: [] },
  });
  await page.goto('/?edit=' + agent.id);
  const port = page.getByRole('button', { name: '받을 질문에서 연결 추가' });
  const target = page.getByRole('button', { name: '전달할 답변 블록 속성' });
  const sourceCard = page.locator('[data-workflow-node="in"]');
  const targetCard = page.locator('[data-workflow-node="out"]');
  const endpoints = page.locator('.ws-wire-endpoint');
  await expect(port).toBeVisible();
  await expect(sourceCard.locator('.ws-port-out')).toHaveCount(1);
  await expect(sourceCard.locator('.ws-port-in')).toHaveCount(0);
  await expect(targetCard.locator('.ws-port-in')).toHaveCount(1);
  await expect(targetCard.locator('.ws-port-out')).toHaveCount(0);
  await expect(endpoints).toHaveCount(0);
  const from = await port.boundingBox(),
    to = await target.boundingBox();
  assert.ok(from && to);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 9,
  });
  await page.mouse.up();
  const wire = page.locator('.ws-wires [role="button"]');
  await expect(wire).toHaveCount(1);
  await expect(wire.locator('path[marker-end]')).toHaveCount(1);
  await wire.focus();
  await page.keyboard.press('Enter');
  await expect(endpoints).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(endpoints).toHaveCount(0);
  await wire.press('Enter');
  await expect(sourceCard.locator('.ws-port-in')).toHaveCount(0);
  await expect(targetCard.locator('.ws-port-in')).toHaveCount(1);
  await expect(page.getByRole('region', { name: '실행 순서', exact: true })).toContainText('받을 질문');
  const values = page.getByRole('region', { name: '전달할 값', exact: true });
  await expect(values).toContainText('받을 질문');
  await expect(values).toContainText('전달할 답변');
  const notes = page.getByRole('textbox',{ name:/선 설명$/ });
  await expect(notes).toHaveCount(2);
  await notes.last().fill('원래 질문 전달');
  await page.keyboard.press('Control+s');
  await expect
    .poll(async () => {
      const graph = (await api(desktop, 'project.open', { id: agent.id }))
        .graph as Graph;
      return graph.edges.find((e) => e.kind === 'data')?.label;
    })
    .toBe('원래 질문 전달');
  const phone = await browser.newContext({
    baseURL,
    storageState: await desktop.storageState(),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const small = await newPage(phone);
    await small.goto('/?edit=' + agent.id);
    const openPalette = small.locator('.ws-mobile-palette');
    await openPalette.click();
    const palette = small.getByRole('dialog', {name:'블록 팔레트'});
    await expect(palette.getByRole('searchbox')).toBeFocused();
    await palette.getByRole('button', {name:'블록 목록 닫기'}).focus();
    await small.keyboard.press('Shift+Tab');
    assert.ok(await palette.evaluate(el => el.contains(document.activeElement)));
    await palette.getByRole('searchbox').press('Escape');
    await expect(palette).toBeHidden();
    await expect(openPalette).toBeFocused();
    await small.getByRole('button', { name: '목록으로 편집' }).click();
    const listEdge = small.locator('.ws-graph-list').getByRole('button', { name: /받을 질문 → 전달할 답변/ });
    await listEdge.press('Enter');
    await expect(small.getByRole('tab', {name:'속성', exact:true})).toBeFocused();
    await small.getByRole('button', {name:'속성 닫기'}).click();
    await expect(listEdge).toBeFocused();
    await listEdge.press('Enter');
    await expect(
      small.getByRole('textbox',{ name:/선 설명$/ }).last()
    ).toHaveValue('원래 질문 전달');
    await small.getByRole('button', { name: '전달할 값 연결 삭제' }).click();
    await expect(
      small.getByRole('button', { name: '전달할 값 연결 삭제' })
    ).toHaveCount(0);
    await small.getByRole('button', { name: '전달 항목 추가' }).click();
    const link = small.getByRole('dialog', { name: '전달 항목 추가' });
    await link.getByRole('checkbox').check();
    await link.getByRole('button', { name: '연결 적용' }).click();
    await expect(
      small.getByRole('button', { name: '전달할 값 연결 삭제' })
    ).toBeVisible();
    await expect
      .poll(async () =>
        (
          (await api(phone, 'project.open', { id: agent.id })).graph as Graph
        ).edges
          .map((e) => [e.kind, e.out, e.input])
          .sort()
      )
      .toEqual([
        ['data', 'value', 'input'],
        ['flow', 'next', 'in'],
      ]);
    await noOverflow(small);
  } finally {
    await phone.close();
  }
}

async function verifyCopyPlacementAndTeamView(page: Page) {
  const beginner = await api(desktop, 'project.create', {lesson:'beginner'});
  await page.goto('/?edit=' + beginner.id);
  const agent = page.locator('[data-workflow-node="agent"] .ws-node-body');
  for (let i = 0; i < 2; i++) {
    await agent.click();
    await page.getByRole('button', {name:'블록 복제', exact:true}).click();
  }
  const copies = page.locator('.ws-node').filter({hasText:'도서관 안내 Agent 사본'});
  await expect(copies).toHaveCount(2);
  await expect(page.locator('.ws-node.ws-chosen')).toContainText('도서관 안내 Agent 사본');
  const cards = await page.locator('[data-workflow-node]').evaluateAll(nodes =>
    nodes.map(node => ({id:node.getAttribute('data-workflow-node'), rect:node.getBoundingClientRect().toJSON()})));
  for (const [index, {id, rect}] of cards.entries()) {
    for (const next of cards.slice(index + 1)) {
      assert.ok(rect.right <= next.rect.left || rect.left >= next.rect.right ||
        rect.bottom <= next.rect.top || rect.top >= next.rect.bottom, id + ' overlaps ' + next.id);
    }
  }
  const peer = await api(desktop, 'project.create', {lesson:'peer-review'});
  const originalViewport = page.viewportSize();
  await page.setViewportSize({width:1440, height:900});
  const parallel = await api(desktop, 'project.create', {lesson:'parallel'});
  await page.goto('/?edit=' + parallel.id);
  await page.getByRole('button', {name:'목록으로 편집'}).click();
  const firstEntry = page.locator('.ws-graph-list button').first();
  await firstEntry.press('Enter');
  await expect(page.getByRole('tab', {name:'속성', exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(firstEntry).toBeFocused();
  await page.getByRole('button', {name:'캔버스로 보기'}).click();
  await page.locator('[data-workflow-node="team"] .ws-node-body').click();
  await page.getByRole('button', {name:'팀 열기', exact:true}).click();
  const member = page.getByRole('button', {name:'회원증 담당 블록 속성', exact:true});
  await member.click();
  await page.getByRole('button', {name:'내부 Workflow 열기', exact:true}).click();
  await expect(page.locator('.ws-canvas-empty')).toBeVisible();
  await page.getByRole('button', {name:'상위 Workflow로'}).click();
  await page.getByRole('button', {name:'설계 검사', exact:true}).click();
  await expect(page.getByRole('dialog', {name:'설계 검사'})).toContainText('현재 설계가 실행 조건을 충족합니다.');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('최신 설계를 저장했습니다.')).toBeVisible();
  assert.deepEqual((await api(desktop,'project.open',{id:parallel.id})).graph,parallel.graph);
  await member.click();
  await page.getByRole('button', {name:'내부 Workflow 열기', exact:true}).click();
  await page.locator('.ws-canvas-empty button').click();
  await page.getByRole('button', {name:'사용자 입력 추가',exact:true}).click();
  await expect.poll(async () => {
    const graph: Graph = (await api(desktop,'project.open',{id:parallel.id})).graph;
    return graph.nodes.find(n => n.id === 'team')?.graph?.nodes.find(n => n.id === 'membership')?.graph?.nodes.map(n => n.type);
  }).toEqual(['input.user_request']);
  await page.goto('/?edit=' + peer.id);
  await page.locator('[data-workflow-node="team"] .ws-node-body').click();
  await page.getByRole('button', {name:'팀 열기',exact:true}).click();
  await expect(page.locator('[data-workflow-node]')).toHaveCount(15);
  const scale = () => page.locator('.ws-world').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);
  await expect.poll(scale).toBeGreaterThanOrEqual(0.85);
  await expect(page.locator('[data-workflow-node="input"]')).toBeInViewport();
  await shot(page, 'peer-team-entry');
  const caption = (from: string, to: string) =>
    page.locator(`.ws-wire[data-from="${from}"][data-to="${to}"] .ws-wire-label`);
  const facts = caption('clarity','review-facts'), clarity = caption('facts','review-clarity');
  await expect(facts).toHaveCount(0);
  await page.locator('.ws-palette').getByRole('button', {name:'사실 검토 담당의 동료 검토',exact:true}).click();
  await expect(facts).toHaveText('안내문 편집 담당 초안');
  await expect(clarity).toHaveCount(0);
  await expect(page.locator('[data-workflow-node="review-facts"]')).toBeInViewport();
  await shot(page, 'peer-team-data');
  await page.locator('.ws-palette').getByRole('button', {name:'안내문 편집 담당의 동료 검토',exact:true}).click();
  await expect(clarity).toHaveText('사실 검토 담당 초안');
  await expect(facts).toHaveCount(0);
  await page.getByRole('button', {name:'캔버스에 맞추기',exact:true}).click();
  await expect.poll(scale).toBeLessThan(0.6);
  if (originalViewport) await page.setViewportSize(originalViewport);
}

async function verifyTeamSkillSelection(page:Page){
  const ctx=page.context();
  const name='회원증 발급 지침';
  const skill=await api(ctx,'asset.save',{name,kind:'skill',payload:{content:'신분증을 확인하세요.'}});
  const project=await api(ctx,'project.create',{lesson:'parallel'});
  const team=(project.graph as Graph).nodes.find(node=>node.type==='agent.team')!;
  const open=async()=>{
    await page.goto('/?edit='+project.id);
    await page.locator('.ws-canvas').first().waitFor();
    const up=page.getByRole('button',{name:'상위 Workflow로',exact:true});
    if(await up.isVisible())await up.click();
    await page.getByRole('button',{name:team.title+' 블록 속성',exact:true}).click();
  };
  const member=(title:string)=>page.locator('.ws-palette').getByRole('button',{name:title,exact:true});
  await open();
  await page.locator('summary').filter({hasText:'도구 및 자료'}).click();
  await page.getByLabel('팀에 연결할 Skill').selectOption(skill.id);
  await page.getByRole('button',{name:'이 판 연결',exact:true}).click();
  await page.getByRole('button',{name:'팀 열기',exact:true}).click();
  await member('회원증 담당').click();
  const instruction=page.getByRole('group',{name:'이 블록이 받는 지침',exact:true});
  const choice=instruction.getByRole('checkbox',{name:name+' · 1판'});
  await expect(instruction).toContainText(team.config.goal);
  await expect(choice).not.toBeChecked();
  await choice.check();
  await member('운영시간 담당').click();
  await expect(choice).not.toBeChecked();
  await expect.poll(async()=>{
    const saved=await api(ctx,'project.open',{id:project.id});
    return (saved.graph as Graph).nodes.find(node=>node.id===team.id)?.graph?.nodes.find(node=>node.title==='회원증 담당')?.config.inheritedSkillIds?.length;
  }).toBe(1);
  await open();
  await page.getByRole('button',{name:'팀 열기',exact:true}).click();
  await member('회원증 담당').click();
  await expect(choice).toBeChecked();
}

async function verifyRecommendedBlocks(page: Page) {
  const context = page.context();
  const project = await api(context, 'project.create', {title: '수준별 추천 확인 ' + stamp});
  const palette = page.locator('.ws-palette');
  const menuNames = palette.locator('.ws-palette-add strong');
  const addTask = palette.getByRole('button', {name: 'AI 작업 추가', exact: true});
  const inspector = page.locator('.ws-inspector');
  const mode = inspector.getByRole('combobox', {name: '작업 방식', exact: true});
  const name = inspector.getByRole('textbox', {name: '이름', exact: true});

  const tiers = [
    {level: '입문', count: 4, moves: []},
    {level: '초급', count: 8, moves: ['파일 만들기']},
    {level: '중급', count: 18, moves: ['오류 처리', '민감정보 검사·처리']},
    {level: '고급', count: 29, moves: ['담당자·작업 선택', '결과 평가']},
    {level: '전문가', count: 32, moves: []},
  ];
  const moved = tiers.flatMap(tier => tier.moves);
  for (const [index, tier] of tiers.entries()) {
    const lesson = templates.find(item => item.level === tier.level)!;
    const copy = index === 0 ? project : await api(context, 'project.create', {lesson:lesson.id});
    await page.goto('/?edit=' + copy.id);
    await palette.getByRole('button', {name:'블록 추가', exact:true}).click();
    await expect(page.getByRole('combobox', {name:'추천 블록 수준'})).toHaveCount(0);
    await expect(menuNames).toHaveCount(tier.count);
    const visible = await menuNames.allTextContents();
    assert.deepEqual(
      moved.filter(menu => visible.includes(menu)),
      tiers.slice(0, index + 1).flatMap(t => t.moves),
      tier.level + ' 추천 메뉴'
    );
    await addTask.click();
    await expect(mode).toHaveValue(index === 0 ? 'ai.single_task' : 'agent.task');
    if (index === 0) {
      await expect(mode.locator('option')).toHaveText(['한 번 답하기', '목표까지 반복']);
      await name.fill('입문 추천으로 추가');
    }
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await api(context, 'project.open', {id:copy.id})).graph.nodes.length)
      .toBe(copy.graph.nodes.length + 1);
  }

  await page.goto('/?edit=' + project.id);
  const search = palette.getByRole('searchbox', {name: '블록 이름 검색'});
  await search.fill('목표까지 반복');
  await addTask.click();
  await expect(mode).toHaveValue('agent.task');
  await name.fill('반복 방식으로 검색');
  await search.fill('');

  await palette.getByRole('button', {name: '전체 32종', exact: true}).click();
  await addTask.click();
  await expect(mode).toHaveValue('agent.task');
  const star = palette.getByRole('button', {name: 'AI 작업 즐겨찾기', exact: true});
  if (await star.getAttribute('aria-pressed') !== 'true') await star.click();
  await palette.getByRole('button', {name: '즐겨찾기 블록'}).click();
  await addTask.click();
  await expect(mode).toHaveValue('agent.task');

  await page.keyboard.press('Control+s');
  await expect.poll(async () => {
    const {graph} = await api(context, 'project.open', {id: project.id}) as {graph: Graph};
    return graph.nodes.length;
  }).toBe(4);
  await page.reload();
  await page.getByRole('button', {name: '반복 방식으로 검색 블록 속성', exact: true}).click();
  await expect(mode).toHaveValue('agent.task');
  await page.getByRole('button', {name: '입문 추천으로 추가 블록 속성', exact: true}).click();
  await expect(mode).toHaveValue('ai.single_task');
}

async function verifyMergedBlockMenus(page: Page) {
  const graph: Graph = {
    nodes: [
      {id:'pick', type:'agent.select_candidate', title:'상담 담당 결정', x:40, y:50, config:{candidates:['도서','대출'], criterion:'문의 분야'}},
      {id:'order', type:'agent.coordinate', title:'처리 순서 결정', x:260, y:50, config:{tasks:['조회','확인'], goal:'조회 후 확인', maxSteps:2}},
      {id:'undo', type:'error.compensate', title:'지점 예약 철회', x:40, y:185, config:{tool:'reservations.cancel', args:{reservationId:'R-17'}}},
    ],
    edges: [
      {id:'original-flow', from:'pick', to:'order', kind:'flow', out:'next', input:'in'},
      {id:'original-data', from:'pick', to:'order', kind:'data', out:'value', input:'input', label:'선택한 담당자'},
    ],
  };
  const project = await api(page.context(), 'project.create', {title:'이전 형식 설계 '+stamp, lesson:'intermediate', graph});
  await page.evaluate(() => localStorage.setItem('studio.editor.stars', JSON.stringify([
    'error.compensate', 'tool.invoke', 'agent.coordinate', 'agent.select_candidate', 'control.wait', 'input.form',
    'control.terminate',
  ])));
  await page.goto('/?edit='+project.id);
  const panel = page.locator('.ws-inspector');
  const mode = panel.getByLabel('작업 방식');
  const palette = page.locator('.ws-palette');
  const addTool = palette.getByRole('button', {name:'도구 사용 추가', exact:true});
  const addSelection = palette.getByRole('button', {name:'담당자·작업 선택 추가', exact:true});
  const search = palette.getByRole('searchbox', {name:'블록 이름 검색'});

  await palette.getByRole('button', {name:'블록 추가', exact:true}).click();
  await palette.getByRole('button', {name:'즐겨찾기 블록'}).click();
  await expect(palette.locator('.ws-palette-row')).toHaveCount(4);
  await expect(addTool).toBeVisible();
  await expect(addSelection).toBeVisible();
  await expect(palette.getByRole('button', {name:'입력 양식·추가 질문 추가', exact:true})).toBeVisible();
  await expect(palette.getByRole('button', {name:'답변 전달 즐겨찾기', exact:true})).toHaveAttribute('aria-pressed', 'true');
  for (const node of graph.nodes) {
    await page.getByRole('button', {name:node.title+' 블록 속성', exact:true}).click();
    await expect(mode).toHaveValue(node.type);
  }
  await expect(panel.locator('[data-field-key="args"] textarea')).toHaveValue(/R-17/);
  await palette.getByRole('button', {name:'추천', exact:true}).click();
  await expect(addSelection).toHaveCount(0);
  await addTool.click();
  await expect(panel.locator('[data-field-key="tool"] input')).toBeVisible();
  await expect(mode.locator('option[value="error.compensate"]')).toHaveCount(0);
  await palette.getByRole('button', {name:'전체 32종', exact:true}).click();
  await expect(palette.locator('.ws-palette-row')).toHaveCount(32);
  const category = palette.getByRole('combobox', {name:'블록 카테고리'});
  await search.fill('보상 작업');
  for (const group of ['resource', 'error']) {
    await category.selectOption(group);
    await expect(addTool).toBeVisible();
  }
  await category.selectOption('');
  await search.fill('');
  await expect(mode).toHaveValue('tool.invoke');
  await mode.selectOption('error.compensate');
  await panel.locator('[data-field-key="tool"] input').fill('reservations.cancel');
  await expect(page.getByRole('button', {name:'예약 취소 블록 속성', exact:true})).toBeVisible();
  for (const oldName of ['작업 조정', '후보 탐색·선택']) {
    await search.fill(oldName);
    await expect(addSelection).toBeVisible();
  }
  await search.fill('');
  await addSelection.click();
  await expect(mode).toHaveValue('agent.select_candidate');
  await mode.selectOption({label:'작업 순서 정하기'});
  await expect(mode).toHaveValue('agent.coordinate');
  const task = panel.locator('[data-field-key="tasks"] input');
  await task.fill('재고 조회');
  await task.press('Enter');
  await panel.locator('[data-field-key="goal"] textarea').fill('재고를 먼저 확인');
  await page.keyboard.press('Control+s');
  const savedGraph = async () => (await api(page.context(), 'project.open', {id:project.id})).graph as Graph;
  await expect.poll(async () => (await savedGraph()).nodes.some(n =>
    n.id !== 'order' && n.type === 'agent.coordinate' && n.config.goal === '재고를 먼저 확인')).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', {name:'지점 예약 철회 블록 속성', exact:true})).toBeVisible();
  const saved = await savedGraph();
  assert.deepEqual(saved.nodes.slice(0, graph.nodes.length), graph.nodes);
  assert.deepEqual(saved.edges, graph.edges);
  assert.equal(saved.nodes.length, graph.nodes.length + 2);
  assert.ok(saved.nodes.some(n => n.id !== 'undo' && n.type === 'error.compensate' && n.config.tool === 'reservations.cancel'));
  assert.ok(saved.nodes.some(n => n.id !== 'order' && n.type === 'agent.coordinate' && n.config.tasks.includes('재고 조회')));
}

async function verifyQuestionDeadlines(page: Page) {
  const context = page.context();
  const legacy = {
    id:'wait', type:'control.wait', title:'기존 수령 확인', x:40, y:50,
    config:{prompt:'수령 지점을 입력해 주세요.', timeoutMinutes:45, event:'옛 설정'},
  };
  const graph: Graph = {
    nodes:[legacy, createBlock('output.answer', {id:'out', x:280, y:50})],
    edges:[
      {id:'original-flow', from:'wait', to:'out', kind:'flow', out:'next', input:'in'},
      {id:'original-data', from:'wait', to:'out', kind:'data', out:'value', input:'input', label:'기존 회신'},
    ],
  };
  const project = await api(context, 'project.create', {title:'회신 기한 시험 '+stamp, graph});
  const savedGraph = async (): Promise<Graph> => (await api(context, 'project.open', {id:project.id})).graph;
  await page.goto('/?edit='+project.id);
  const palette = page.locator('.ws-palette');
  const inspector = page.locator('.ws-inspector');
  const add = palette.getByRole('button', {name:'입력 양식·추가 질문 추가', exact:true});
  const toggle = inspector.getByRole('checkbox', {name:'회신 기한 사용'});
  const minutes = inspector.getByRole('spinbutton', {name:'회신 기한(분)'});
  const fields = inspector.getByRole('textbox',{name:'입력 항목 새 항목'});
  const requiredBranch = inspector.getByRole('checkbox',{name:'지점 필수'});
  const title = '방문 지점 회신';
  const question = page.getByRole('button', {name:title+' 블록 속성', exact:true});

  await page.getByRole('button', {name:legacy.title+' 블록 속성', exact:true}).click();
  await expect(toggle).toBeChecked();
  await expect(minutes).toHaveValue('45');
  await palette.getByRole('button', {name:'전체 32종', exact:true}).click();
  await add.click();
  await expect(toggle).not.toBeChecked();
  await expect(minutes).toHaveCount(0);
  await inspector.getByRole('textbox', {name:'이름', exact:true}).fill(title);
  await inspector.locator('[data-field-key="prompt"] textarea').fill('방문할 지점을 입력하세요.');
  await fields.fill('지점');
  await fields.press('Enter');
  await expect(requiredBranch).toBeChecked();
  await toggle.check();
  await expect(minutes).toHaveValue('60');
  await minutes.fill('30');
  await minutes.press('Tab');
  await expect(question).toHaveAttribute('title', /30분/);
  await page.keyboard.press('Control+s');
  const savedQuestion = async () => (await savedGraph()).nodes.find(node => node.title === title);
  await expect.poll(async () => (await savedQuestion())?.config).toMatchObject({
    fields:['지점'], replyTimeoutMinutes:30,
  });
  await page.reload();
  await question.click();
  await expect(toggle).toBeChecked();
  await expect(minutes).toHaveValue('30');
  await expect(requiredBranch).toBeChecked();
  await toggle.uncheck();
  await expect(question).not.toHaveAttribute('title', /30분/);
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await savedQuestion())?.config.replyTimeoutMinutes ?? 0).toBe(0);
  await page.reload();
  await question.click();
  await expect(toggle).not.toBeChecked();
  await expect(minutes).toHaveCount(0);
  await expect(requiredBranch).toBeChecked();

  await palette.getByRole('button', {name:'전체 32종', exact:true}).click();
  const search = palette.getByRole('searchbox', {name:'블록 이름 검색'});
  for (const alias of ['조건 기다리기', '회신 기다리기']) {
    await search.fill(alias);
    await expect(palette.locator('.ws-palette-row')).toHaveCount(1);
    await expect(add).toBeVisible();
  }
  await add.click();
  await expect(toggle).toBeChecked();
  await expect(minutes).toHaveValue('60');
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await savedGraph()).nodes.some(node =>
    node.type === 'input.form' && node.config.replyTimeoutMinutes === 60)).toBe(true);
  const saved = await savedGraph();
  assert.deepEqual(saved.nodes.slice(0, graph.nodes.length), graph.nodes);
  assert.deepEqual(saved.edges, graph.edges);
}

async function verifyLeavingSharedCopy() {
  const reader = await browser.newContext({baseURL, viewport:{width:1440,height:900}});
  try {
    await registerBrowserAccount(reader);
    const project = await api(desktop, 'project.create', {title:'공유 사본 이동 확인 ' + stamp, graph:policyGraph(3)});
    const version = await api(desktop, 'versions.save', {id:project.id, revision:project.revision});
    await api(desktop, 'versions.publish', {id:project.id, version:version.number, visibility:'public'});
    const page = await newPage(reader);
    await page.goto('/?view=projects');
    const nav = page.getByRole('navigation', {name:'작업 화면'});
    for (const succeeds of [false, true]) {
      await nav.getByRole('button', {name:'공유 Agent', exact:true}).click();
      await page.locator('[data-project-id="' + project.id + '"]').click();
      const dialog = page.getByRole('dialog', {name:project.title});
      let resume!: () => void;
      const held = new Promise<void>(resolve => { resume = resolve; });
      const delay = async (route: Route) => {
        if (route.request().postDataJSON()?.action !== 'project.copy') return route.continue();
        await held;
        if (succeeds) return route.continue();
        return route.fulfill({status:503, json:{error:'사본 생성 응답 확인용 오류'}});
      };
      await page.route('**/api/studio', delay);
      try {
        const requested = page.waitForRequest(req => req.url().endsWith('/api/studio') && req.postDataJSON()?.action === 'project.copy');
        await dialog.getByRole('button', {name:'내 사본 만들기'}).click();
        await requested;
        await expect(dialog.getByRole('button', {name:'닫기', exact:true})).toBeDisabled();
        await page.goBack();
        await expect(page.getByRole('heading', {name:'내 Agent', exact:true})).toBeVisible();
        const result = page.waitForResponse(res => res.url().endsWith('/api/studio') && res.request().postDataJSON()?.action === 'project.copy');
        resume();
        assert.equal((await result).status(), succeeds ? 200 : 503);
        // The busy state clears after the application consumes the response.
        await expect(nav.getByRole('button', {name:'Workflow 편집기', exact:true})).toBeEnabled();
        await expect(page).toHaveURL(url => url.search === '?view=projects');
        await expect(page.getByRole('alert').filter({hasText:'사본 생성 응답 확인용 오류'})).toHaveCount(0);
        if (succeeds) {
          await expect(page.getByText(project.title + ' 사본', {exact:true})).toBeVisible();
          const copies = (await api(reader, 'project.list')).filter((p: {title:string; mine:boolean}) => p.mine && p.title === project.title + ' 사본');
          assert.equal(copies.length, 1);
        }
      } finally {
        resume();
        await page.unroute('**/api/studio', delay);
      }
    }
  } finally {
    await reader.close();
  }
}

async function verifyTerminalAndErrorSettings(page: Page) {
  const graph: Graph = {
    nodes: [
      createBlock('input.user_request', {id:'in', title:'요청', x:40, y:50}),
      {id:'success', type:'control.terminate', title:'완료 알림', x:270, y:50, config:{message:'처리했습니다.'}},
      {id:'cancel', type:'control.terminate', title:'예약 중지', x:490, y:50, config:{status:'cancelled', message:'예약을 중지했습니다.'}},
      {id:'fail', type:'control.terminate', title:'접수 실패', x:40, y:180, config:{status:'failed', message:'접수에 실패했습니다.'}},
      {id:'report', type:'error.handle', title:'기존 오류 안내', x:270, y:180, config:{strategy:'report', message:'오류를 안내합니다.'}},
      {id:'fallback', type:'error.handle', title:'기존 대체 경로', x:490, y:180, config:{strategy:'fallback', message:'다음 단계가 처리합니다.'}},
    ],
    edges: [
      {id:'keep-flow', from:'in', to:'cancel', kind:'flow', out:'next', input:'in'},
      {id:'keep-data', from:'in', to:'cancel', kind:'data', out:'value', input:'input', label:'예약 정보'},
    ],
  };
  const ctx = page.context();
  const project = await api(ctx, 'project.create', {title:'종료 및 오류 처리 시험 '+stamp, graph});
  const savedGraph = async (): Promise<Graph> => (await api(ctx, 'project.open', {id:project.id})).graph;
  const selectNode = (title: string) => page.getByRole('button', {name:title+' 블록 속성', exact:true}).click();
  const panel = page.locator('.ws-inspector');
  const palette = page.locator('.ws-palette');
  const mode = panel.getByRole('combobox', {name:'종료 방식', exact:true});
  const format = panel.getByRole('combobox',{name:'표시 형식',exact:true});
  const message = panel.getByLabel('종료 안내', {exact:true});
  const strategy = panel.getByRole('combobox', {name:'처리 방식', exact:true});
  await page.goto('/?edit='+project.id);

  for (const node of graph.nodes.filter(node => node.type === 'control.terminate')) {
    await selectNode(node.title);
    await expect(mode).toHaveValue(node.config.status ?? 'success');
    await expect(message).toHaveValue(node.config.message);
  }
  for (const node of graph.nodes.filter(node => node.type === 'error.handle')) {
    await selectNode(node.title);
    await expect(strategy.locator('option')).toHaveText(['후속 단계로 계속', '중단']);
    await expect(strategy).toHaveValue('continue');
    await expect(panel.getByRole('textbox', {name:'이용자 안내', exact:true})).toHaveValue(node.config.message);
  }

  await palette.getByRole('button', {name:'전체 32종', exact:true}).click();
  const search = palette.getByRole('searchbox', {name:'블록 이름 검색'});
  const add = palette.getByRole('button', {name:'답변 전달 추가', exact:true});
  for (const alias of ['답변 전달', '종료·중단', 'control.terminate']) {
    await search.fill(alias);
    await expect(palette.locator('.ws-palette-row')).toHaveCount(1);
    await expect(add).toBeVisible();
  }
  await add.click();
  await expect(mode).toHaveValue('answer');
  await expect(mode.locator('option')).toHaveText(['답변 반환', '완료 안내', '실행 중지', '실패 처리']);
  await expect(format).toHaveValue('text');
  await expect(message).toHaveCount(0);
  const addedTitle = '새 접수 결과';
  await panel.getByRole('textbox', {name:'이름', exact:true}).fill(addedTitle);
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await savedGraph()).nodes.find(node => node.title === addedTitle)?.type).toBe('output.answer');
  const untouched = await savedGraph();
  assert.deepEqual(untouched.nodes.slice(0, graph.nodes.length), graph.nodes);
  assert.deepEqual(untouched.edges, graph.edges);
  await mode.selectOption({label:'완료 안내'});
  await message.fill('새 접수 안내입니다.');
  await search.fill('오류 처리');
  await palette.getByRole('button', {name:'오류 처리 추가', exact:true}).click();
  await expect(strategy).toHaveValue('continue');
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await savedGraph()).nodes.find(node => node.title === '오류 처리')?.config.strategy).toBe('continue');
  await page.reload();
  await selectNode(addedTitle);
  await expect(mode).toHaveValue('success');
  await expect(message).toHaveValue('새 접수 안내입니다.');
  await selectNode('예약 중지');
  await expect(mode).toHaveValue('cancelled');
  await expect(message).toHaveValue('예약을 중지했습니다.');
  await expect(page.locator('.ws-wires [role="button"]')).toHaveCount(1);

  // Change the wired legacy node through all four choices and reopen the resulting answer.
  for (const status of ['failed', 'success', 'cancelled']) {
    await mode.selectOption(status);
    await expect(format).toHaveCount(0);
    await expect(message).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await savedGraph()).nodes.find(node => node.id === 'cancel'))
      .toMatchObject({type:'control.terminate', config:{status, message:'예약을 중지했습니다.'}});
  }
  await mode.selectOption({label:'답변 반환'});
  await format.selectOption('markdown');
  await selectNode('기존 대체 경로');
  await strategy.selectOption('stop');
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await savedGraph()).nodes.find(node => node.id === 'fallback')?.config.strategy).toBe('stop');
  await page.reload();
  await selectNode('예약 중지');
  await expect(mode).toHaveValue('answer');
  await expect(format).toHaveValue('markdown');
  await expect(message).toHaveCount(0);
  await selectNode('기존 대체 경로');
  await expect(strategy).toHaveValue('stop');
  await strategy.selectOption('continue');
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await savedGraph()).nodes.find(node => node.id === 'fallback')?.config.strategy).toBe('continue');
  const edited = await savedGraph();
  assert.deepEqual(edited.edges, graph.edges);
  assert.deepEqual(edited.nodes.find(node => node.id === 'report'), graph.nodes.find(node => node.id === 'report'));
  assert.equal(edited.nodes.find(node => node.id === 'cancel')?.type, 'output.answer');
}

async function checkRoutingWires(context: BrowserContext, page: Page) {
  const graph = structuredClone(templates.find(lesson => lesson.id === 'intermediate')!.graph);
  // Also exercise a data-only output on a classifier: the source alone does not make it a branch.
  graph.edges.find(edge => edge.to === 'followup' && edge.input === 'question')!.from = 'intent';
  const project = await api(context, 'project.create', { lesson: 'intermediate', graph });
  await page.goto('/?edit=' + project.id);
  const canvas = page.locator('.ws-wires');
  const wire = (from: string, to: string) => canvas.locator(`[role="button"][data-from="${from}"][data-to="${to}"]`);
  const when = page.getByRole('region', { name: '실행 순서', exact: true });
  const values = page.getByRole('region', { name: '전달할 값', exact: true });
  const searchRoute = wire('intent', 'search');
  const searchBlock = page.locator('[data-workflow-node="search"]');
  await expect(searchBlock.locator('.ws-port-in')).toHaveCount(1);
  await expect(searchBlock.locator('.ws-port-out')).toHaveCount(1);
  await expect(searchRoute.locator('path[marker-end]')).toHaveCount(1);
  await expect(searchRoute.locator('text')).toHaveText(/규정.*미분류/);
  await expect(wire('intent', 'lookup').locator('text')).toHaveText('예약');
  await expect(wire('intent', 'followup').locator('text')).toHaveCount(0);
  await searchRoute.press('Enter');
  const endpoints = page.locator('.ws-wire-endpoint');
  await expect(endpoints).toHaveCount(3);
  await expect(page.locator('.ws-wire-endpoint[data-endpoint="source"][data-node-id="intent"]')).toHaveCount(2);
  await expect(page.locator('.ws-wire-endpoint[data-endpoint="target"][data-node-id="search"]')).toHaveCount(1);
  await expect(when).toContainText('규정');
  await expect(when).toContainText('미분류');
  await expect(values).toContainText('전달할 값이 없습니다');

  const questionData = wire('input', 'search');
  const dataStroke = questionData.locator('path[marker-end]');
  await expect(dataStroke).toHaveAttribute('data-kind', 'data');
  await expect(dataStroke).toHaveAttribute('stroke-dasharray', /\d/);
  await questionData.press('Enter');
  await expect(endpoints).toHaveCount(2);
  await expect(page.locator('.ws-wire-endpoint[data-node-id="intent"]')).toHaveCount(0);
  await expect(when).toContainText('규정과 개인 예약 구분');
  await expect(values).toContainText('도서관 질문');
  await expect(values).toContainText('규정과 지점 안내문 검색');
  await expect(values).toContainText('결과');
  await expect(values).toContainText('입력값');
  const dataPath = await dataStroke.getAttribute('d');
  const routePath = await searchRoute.locator('path[marker-end]').getAttribute('d');
  assert.ok(dataPath && routePath && dataPath !== routePath);
  assert.deepEqual((await api(context, 'project.open', { id: project.id })).graph.edges, project.graph.edges);

  await page.getByRole('button', { name: '작업실 홈', exact: true }).click();
  const saved = page.locator('[data-home-canvas="saved"]');
  await expect(saved.getByRole('button', { name: /출발.*도서관 질문/ })).toBeVisible();
  await expect(saved.getByRole('button', { name: /도착.*규정과 지점 안내문 검색/ })).toBeVisible();
  await saved.getByRole('button', { name: '전체 배치 보기' }).click();
  await expect(saved.locator('path[data-from="input"][data-to="search"]')).toHaveAttribute('d', dataPath);
  await expect(saved.locator('path[data-from="intent"][data-to="search"]')).toHaveAttribute('d', routePath);
  await expect(saved.locator('text').filter({ hasText: /규정.*미분류/ })).toHaveCount(1);
  await expect(saved.locator('figcaption')).toContainText('도서관 질문 → 규정과 지점 안내문 검색');
}

async function verifyNamedOutputs(page: Page) {
  const context = page.context();
  const gate = createBlock('control.branch', {
    id: 'gate', title: '신청 확인', x: 40, y: 35, config: { yesLabel: '접수됨', noLabel: '다시 확인' },
  });
  const classify = createBlock('ai.classify', {
    id: 'classify', title: '질문 분류', x: 40, y: 240, config: { categories: ['대출', '예약', '도서관 행사'] },
  });
  const receipt = createBlock('output.answer', { id: 'receipt', title: '접수 안내', x: 340, y: 35 });
  const booking = createBlock('output.answer', { id: 'booking', title: '예약 안내', x: 340, y: 240 });
  const project = await api(context, 'project.create', {
    title: '출력 경로 연결', graph: { nodes: [gate, classify, receipt, booking], edges: [] },
  });
  await page.goto('/?edit=' + project.id);
  const card = (id: string) => page.locator(`[data-workflow-node="${id}"]`);
  const route = (id: string, out: string) => card(id).locator(`button[data-output-port="${out}"]`);
  const chooser = page.getByRole('dialog', { name: '연결 추가' });
  const wire = (from: string, to: string) => page.locator(`.ws-wire[data-from="${from}"][data-to="${to}"]`);
  await expect(card(gate.id).locator('[data-output-port]')).toHaveText(['접수됨', '다시 확인']);
  await expect(card(classify.id).locator('[data-output-port]')).toHaveText(['대출', '예약', '도서관 행사', '미분류']);
  await expect(route(gate.id, 'yes')).toHaveAccessibleName(/접수됨/);
  await expect(route(classify.id, 'category:예약')).toHaveAccessibleName(/예약/);

  await page.getByRole('button',{name:'설계 검사',exact:true}).click();
  await page.getByRole('dialog',{name:'설계 검사'}).getByRole('button',{name:/도서관 행사.*다음 블록/}).click();
  await chooser.getByLabel('도착 블록').selectOption(receipt.id);
  await expect(chooser.getByRole('checkbox',{name:/도서관 행사/})).toBeChecked();
  await expect(chooser.getByRole('checkbox',{name:/예약|미분류/})).toHaveCount(0);
  await chooser.getByRole('button',{name:'취소'}).click();

  await route(gate.id, 'yes').press('Enter');
  await chooser.getByLabel('도착 블록').selectOption(receipt.id);
  await expect(chooser.getByRole('checkbox', { name: /다시 확인/ })).toHaveCount(0);
  await chooser.getByRole('button', { name: '연결 적용' }).click();
  await expect(wire(gate.id, receipt.id)).toBeVisible();
  await route(classify.id, 'category:예약').dragTo(card(booking.id).getByRole('button', { name: '예약 안내 블록 속성' }));
  await expect(chooser.getByText('출발 블록 · 질문 분류 · 예약 경로', { exact: true })).toBeVisible();
  await expect(chooser.getByLabel('도착 블록')).toHaveValue(booking.id);
  await expect(chooser.getByRole('checkbox', { name: '예약 → 실행 시작', exact: true })).toBeChecked();
  await expect(chooser.getByRole('checkbox', { name: '결과 → 입력값', exact: true })).toBeChecked();
  await expect(chooser.getByRole('checkbox', { name: '선택한 범주 → 입력값', exact: true })).not.toBeChecked();
  await chooser.getByRole('button', { name: '연결 적용', exact: true }).click();
  await expect(wire(classify.id, booking.id)).toBeVisible();

  // A second logical route may intentionally lead to the same block and share its arrow.
  await route(classify.id, 'other').click();
  await chooser.getByLabel('도착 블록').selectOption(booking.id);
  await chooser.getByRole('button', { name: '연결 적용' }).click();
  await expect(wire(classify.id, booking.id).locator('path[marker-end]')).toHaveCount(1);
  await expect(wire(classify.id, booking.id).locator('.ws-wire-label')).toHaveText(/예약.*미분류|미분류.*예약/);
  await wire(gate.id, receipt.id).press('Enter');
  const endpoints = page.locator('.ws-wire-endpoint');
  await expect(endpoints).toHaveCount(2);
  const dot = await route(gate.id, 'yes').locator('.ws-output-dot').boundingBox();
  const sourceRing = await page.locator('.ws-wire-endpoint[data-endpoint="source"]').boundingBox();
  assert.ok(dot && sourceRing);
  assert.ok(Math.hypot(
    (dot.x + dot.width / 2) - (sourceRing.x + sourceRing.width / 2),
    (dot.y + dot.height / 2) - (sourceRing.y + sourceRing.height / 2),
  ) <= 2, '선택한 연결선의 출발점이 해당 경로의 표시점과 일치해야 합니다.');
  await card(gate.id).getByRole('button', { name: '신청 확인 블록 속성' }).click();
  await expect(endpoints).toHaveCount(0);
  await page.keyboard.press('Control+s');
  await expect.poll(async () => {
    const { graph }: { graph: Graph } = await api(context, 'project.open', { id: project.id });
    return graph.edges.filter(edge => edge.kind === 'flow').map(edge => [edge.from, edge.out, edge.to]).sort();
  }).toEqual([
    [classify.id, 'category:예약', booking.id], [classify.id, 'other', booking.id], [gate.id, 'yes', receipt.id],
  ]);

  const desktopSize = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await route(classify.id, 'other').click();
    await expect(chooser).toBeVisible();
    await chooser.getByRole('button', { name: '취소' }).click();
    await page.getByRole('button', { name: '목록으로 편집' }).click();
    await page.locator('.ws-graph-list').getByRole('button', { name: /질문 분류 → 예약 안내/ }).click();
    const conditions = page.getByRole('region', { name: '실행 순서', exact: true });
    await expect(conditions).toContainText('예약');
    await expect(conditions).toContainText('미분류');
    await noOverflow(page);
  } finally {
    await page.setViewportSize(desktopSize);
  }
}

async function checkCatalogAndProjectReturns(ctx: BrowserContext, small: boolean) {
  const page = await newPage(ctx);
  try {
    await page.goto('/?view=templates');
    await page.getByRole('button', {name:'전문가', exact:true}).click();
    await expect(page.locator('.lesson-tile')).toHaveCount(3);
    if (small) await page.getByRole('button', {name:'메뉴 열기'}).click();
    await page.getByRole('button', {name:'작업실 홈', exact:true}).click();
    const all = page.getByRole('button', {name:'전체 보기', exact:true});
    await all.scrollIntoViewIfNeeded();
    const homeY = await page.evaluate(() => window.scrollY);
    await all.click();
    await expect(page.locator('.lesson-tile')).toHaveCount(13);
    await expect(page.getByRole('button', {name:'전체', exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('heading', {name:'수준별 템플릿'})).toBeInViewport();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.goBack();
    await expect(all).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(homeY, -1);
    await page.goForward();
    const last = page.locator('.lesson-tile').last();
    await last.focus();
    const catalogY = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(last).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(catalogY, -1);
    await last.click();
    await page.getByRole('button',{name:'닫기',exact:true}).click();
    await expect(last).toBeFocused();

    const title = '목록 복귀 시험 ' + stamp;
    const project = await api(ctx,'project.create',{title});
    for (let i=0; i<13; i++) await api(ctx,'project.create',{title:title + ' ' + (i+1)});
    await page.goto('/?view=projects');
    const search = page.getByRole('textbox',{name:'Agent 이름 검색'});
    await search.fill(title);
    const trash = page.getByRole('link',{name:'휴지통',exact:true});
    await trash.click();
    await page.getByRole('link',{name:'내 Agent로 돌아가기'}).click();
    await expect(search).toHaveValue(title);
    await expect(trash).toBeFocused();
    const row = page.locator('.project-row').filter({has:page.getByText(title,{exact:true})});
    await row.scrollIntoViewIfNeeded();
    const listY = await page.evaluate(() => window.scrollY);
    assert.ok(listY > 100);
    await row.click();
    await expect(page.locator('.ws-editor')).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get('edit'),project.id);
    await page.goBack();
    await expect(search).toHaveValue(title);
    await expect(row).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(listY, -1);
    await page.reload();
    await expect(search).toHaveValue(title);
    await search.focus();
    await page.evaluate(() => window.scrollTo(0,0));
    await page.goForward();
    await expect(page.locator('.ws-editor')).toBeVisible();
    await page.goBack();
    await expect(search).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  } finally { await page.close(); }
}

async function checkEditorNavigation() {
  const context = await browser.newContext({ baseURL, viewport: { width: 900, height: 940 } });
  try {
    const user = await registerBrowserAccount(context);
    const page = await newPage(context);
    const nav = page.getByRole('navigation', { name: '작업 화면' });
    const guide = page.locator('main').filter({has:page.locator('#guide-page-title')});
    const picker = page.getByRole('dialog', { name: '프로젝트 선택', exact: true });
    const menu = (name: string) => nav.getByRole('button', { name, exact: true });
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    async function ownedProjects(): Promise<string[]> {
      const projects: { id: string; mine: boolean }[] = await api(context, 'project.list');
      return projects.filter(project => project.mine).map(project => project.id);
    }
    async function checkRail(current: string) {
      await expect(nav.getByRole('button')).toHaveText([
        '작업실 홈', 'Workflow 편집기', '내 Agent', '도구 및 자료',
        '공유 Agent', '공유 도구 및 자료', '수준별 템플릿', '설계 가져오기', '가이드',
      ]);
      await expect(nav.getByRole('group', { name: '공유', exact: true }).getByRole('button'))
        .toHaveText(['공유 Agent', '공유 도구 및 자료']);
      await expect(nav.getByRole('group', { name: '예제', exact: true }).getByRole('button'))
        .toHaveText(['수준별 템플릿']);
      await expect(nav.getByRole('group', { name: '설계 도구', exact: true }).getByRole('button'))
        .toHaveText(['설계 가져오기', '가이드']);
      await expect(nav.locator('[aria-current="page"]')).toHaveText(current);
      await expect(page.getByText(user.login, { exact: true })).toBeVisible();
      await expect(button('로그아웃')).toBeVisible();
    }
    async function checkBreakpoint(current: string) {
      await page.setViewportSize({ width: 800, height: 900 });
      await expect(button('메뉴 열기')).toBeVisible();
      await expect(nav).toBeHidden();
      await button('메뉴 열기').click();
      await checkRail(current);
      await expect(menu(current)).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(nav).toBeHidden();
      await page.setViewportSize({ width: 801, height: 900 });
      await expect(button('메뉴 열기')).toBeHidden();
      await expect(menu(current)).toBeInViewport();
      await page.setViewportSize({ width: 900, height: 940 });
      await checkRail(current);
    }
    async function checkChooser(existingProjects: string[] = []) {
      await expect(page).toHaveURL(/[?&]view=editor(?:&|$)/);
      for (const name of ['프로젝트 선택', '새 Agent 만들기', '도서관 실습 시작하기'])
        await expect(button(name)).toBeVisible();
      await checkRail('Workflow 편집기');
      assert.deepEqual(await ownedProjects(), existingProjects);
    }

    await page.goto('/');
    await expect(page.getByRole('heading', { name: '내 작업실', exact: true })).toBeVisible({ timeout: 60000 });
    await checkBreakpoint('작업실 홈');
    for (const label of ['작업실 홈', '내 Agent', '도구 및 자료', '수준별 템플릿', '공유 도구 및 자료', '공유 Agent']) {
      await menu(label).click();
      await checkRail(label);
      await menu('가이드').click();
      await expect(guide).toBeVisible();
      await expect(picker).toHaveCount(0);
      await checkRail('가이드');
      await guide.getByRole('button', {name:/돌아가기$/}).click();
      await expect(guide).toBeHidden();
      await expect(nav.locator('[aria-current="page"]')).toHaveText(label);
    }
    await menu('설계 가져오기').click();
    await expect(picker).toContainText('선택할 프로젝트가 없습니다.');
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    assert.deepEqual(await ownedProjects(), []);
    await menu('Workflow 편집기').click();
    await checkChooser();
    await checkBreakpoint('Workflow 편집기');
    await page.reload();
    await checkChooser();
    await page.goBack();
    await checkRail('공유 Agent');
    await page.goForward();
    await checkChooser();
    await page.goto('/?view=editor');
    await checkChooser();
    await button('프로젝트 선택').click();
    await checkRail('내 Agent');
    await menu('Workflow 편집기').click();
    await button('새 Agent 만들기').click();
    const create = page.getByRole('dialog', { name: '새 Agent 만들기' });
    await expect(create.getByRole('button', { name: /빈 캔버스에서 시작/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(create).toBeHidden();
    await checkChooser();

    await button('도서관 실습 시작하기').click();
    await expect(page.getByRole('button', { name: '도서관 이용규정 블록 속성' })).toBeVisible();
    await expect(page).toHaveURL(/[?&]edit=[^&]+/);
    const id = new URL(page.url()).searchParams.get('edit')!;
    assert.deepEqual(await ownedProjects(), [id]);
    assert.equal((await api(context, 'project.open', { id })).lesson, 'beginner');
    await page.goBack();
    await checkChooser([id]);
    await page.goForward();
    await expect(page).toHaveURL(url => url.searchParams.get('edit') === id);
    await checkBreakpoint('Workflow 편집기');
    await menu('가이드').click();
    await expect(guide).toBeVisible();
    await guide.getByRole('button', {name:/돌아가기$/}).click();
    await menu('설계 가져오기').click();
    await expect(page.getByRole('dialog', { name: '설계 가져오기' })).toBeVisible();
    await page.keyboard.press('Escape');
    await button('실습 안내').click();
    await expect(guide.getByRole('heading', { name: '내 자료로 안내하기 실습 안내' })).toBeVisible();
    await guide.getByRole('button', {name:/돌아가기$/}).click();

    await menu('도구 및 자료').click();
    await checkRail('도구 및 자료');
    await menu('Workflow 편집기').click();
    await expect(page).toHaveURL(url => url.searchParams.get('edit') === id);
    await checkRail('Workflow 편집기');
    await page.goto('/?view=editor');
    await expect(page).toHaveURL(url => url.searchParams.get('edit') === id);
    await expect(button('실습 안내')).toBeVisible();
    assert.deepEqual(await ownedProjects(), [id]);

    const other = await api(context, 'project.create', { title: '빈 캔버스 탐색' });
    await page.goto('/?edit=' + other.id);
    await menu('가이드').click();
    await expect(guide).toBeVisible();
    await menu('수준별 템플릿').click();
    await checkRail('수준별 템플릿');
    await menu('Workflow 편집기').click();
    await expect(page).toHaveURL(url => url.searchParams.get('edit') === other.id);
    await page.goto('/?edit=' + id);
    await expect(button('실습 안내')).toBeVisible();
    await menu('작업실 홈').click();
    await checkRail('작업실 홈');
    await menu('Workflow 편집기').click();
    await expect(page).toHaveURL(url => url.searchParams.get('edit') === id);
    assert.deepEqual((await ownedProjects()).sort(), [id, other.id].sort());

    await menu('내 Agent').click();
    const library = await api(context, 'project.open', { id });
    await api(context, 'project.delete', { id, revision: library.revision });
    await menu('Workflow 편집기').click();
    await expect(page).toHaveURL(url => url.searchParams.get('edit') === other.id);
    await expect(menu('가이드')).toBeVisible();
    await menu('내 Agent').click();
    await api(context, 'project.delete', { id: other.id, revision: other.revision });
    await menu('Workflow 편집기').click();
    await checkChooser();

    const unvisited = await api(context, 'project.create', { title: '처음 여는 프로젝트' });
    await page.reload();
    await checkChooser([unvisited.id]);
    await button('프로젝트 선택').click();
    await page.getByRole('button').filter({
      has: page.getByText(unvisited.title, { exact: true }),
    }).click();
    await expect(page).toHaveURL(url => url.searchParams.get('edit') === unvisited.id);
  } finally {
    await context.close();
  }
}

async function checkProjectMenuTargets() {
  const context = await browser.newContext({ baseURL, viewport: { width: 1250, height: 900 } });
  const contributor = await browser.newContext({ baseURL });
  try {
    await registerBrowserAccount(context);
    const first = await api(context, 'project.create', { title: '최근에 편집한 설계', graph: policyGraph(2) });
    const second = await api(context, 'project.create', { title: '목록에서 고를 설계', graph: policyGraph(7) });
    const discarded = await api(context, 'project.create', { title: '휴지통에 있는 설계' });
    await api(context, 'project.delete', { id: discarded.id, revision: discarded.revision });
    await api(contributor, 'auth.signup', { login: 'menu-' + stamp, password: 'Q!' + crypto.randomUUID() });
    const foreign = await api(contributor, 'project.create', { title: '공유받은 설계', graph: policyGraph(5) });
    const edition = await api(contributor, 'versions.save', { id: foreign.id, revision: foreign.revision });
    const shared = await api(contributor, 'versions.publish', { id: foreign.id, version: edition.number, visibility: 'link' });
    await api(context, 'project.open', { id: foreign.id, token: shared.token });
    const visible: { id: string; mine: boolean }[] = await api(context, 'project.list');
    assert.ok(visible.some(project => !project.mine && project.id === foreign.id));

    const page = await newPage(context);
    const nav = page.getByRole('navigation', { name: '작업 화면' });
    const menu = (name: string) => nav.getByRole('button', { name, exact: true });
    const picker = page.getByRole('dialog', { name: '프로젝트 선택', exact: true });
    const share = page.getByRole('dialog', { name: 'Agent 공유 설정' });
    const importer = page.getByRole('dialog', { name: '설계 가져오기' });
    async function checkPicker() {
      await expect(picker.getByRole('button', { name: first.title, exact: true })).toBeVisible();
      await expect(picker.getByRole('button', { name: second.title, exact: true })).toBeVisible();
      await expect(picker.getByText(discarded.title, { exact: true })).toHaveCount(0);
      await expect(picker.getByText(foreign.title, { exact: true })).toHaveCount(0);
      await expect(share).toHaveCount(0);
      await expect(importer).toHaveCount(0);
    }
    async function applyImport(title: string, limit: number) {
      await expect(importer).toContainText(title);
      await importer.getByRole('textbox', { name: '설계 내용' }).fill(JSON.stringify(policyGraph(limit)));
      await importer.getByRole('button', { name: '현재 초안에 적용' }).click();
      await expect(importer).toBeHidden();
    }
    const graph = async (id: string): Promise<Graph> => (await api(context, 'project.open', { id })).graph;
    const answer = async (id: string) => (await graph(id)).nodes.find(node => node.id === 'answer')?.config.message;

    await page.goto('/?edit=' + first.id);
    await expect(page.getByRole('heading', { name: first.title, exact: true })).toBeVisible();
    await menu('작업실 홈').click();
    await menu('설계 가져오기').click();
    await checkPicker();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(nav.locator('[aria-current="page"]')).toHaveText('작업실 홈');
    await menu('내 Agent').click();
    const shareButton = (title: string) => page.getByRole('button', { name: title + ' 공유 설정', exact: true });
    await expect(shareButton(first.title)).toBeVisible();
    await expect(shareButton(discarded.title)).toHaveCount(0);
    await expect(shareButton(foreign.title)).toHaveCount(0);
    await shareButton(second.title).click();
    await expect(picker).toHaveCount(0);
    await expect(page).toHaveURL(url => url.searchParams.get('view') === 'projects');
    await expect(share).toContainText(second.title);
    await share.getByRole('button', { name: '현재 초안 버전 저장' }).click();
    await expect(share.getByLabel('대상 버전')).toHaveValue('1');
    assert.equal((await api(context, 'versions.list', { id: second.id })).length, 1);
    assert.equal((await api(context, 'versions.list', { id: first.id })).length, 0);
    await page.keyboard.press('Escape');
    await expect(shareButton(second.title)).toBeFocused();

    await page.locator('.project-row').filter({ has: page.getByText(second.title, { exact: true }) }).click();
    await expect(page).toHaveURL(url => url.searchParams.get('edit') === second.id);
    await menu('설계 가져오기').click();
    await expect(picker).toHaveCount(0);
    await applyImport(second.title, 11);
    await openProjectAction(page, '공유 설정');
    await expect(share).toContainText(second.title);
    await expect(picker).toHaveCount(0);
    assert.equal(await answer(second.id), '대출 한도는 11권입니다.');
    assert.deepEqual(await graph(first.id), first.graph);
    await page.keyboard.press('Escape');

    await menu('공유 Agent').click();
    await page.setViewportSize({ width: 800, height: 900 });
    await page.getByRole('button', { name: '메뉴 열기' }).click();
    await menu('설계 가져오기').click();
    await checkPicker();
    await expect(nav).toBeHidden();
    await picker.getByRole('button', { name: first.title, exact: true }).click();
    await expect(page).toHaveURL(url => url.searchParams.get('edit') === first.id);
    await applyImport(first.title, 23);
    await page.getByRole('button', { name: '메뉴 열기' }).click();
    await menu('내 Agent').click();
    await expect(page.getByRole('heading', { name: '내 Agent', exact: true })).toBeVisible();
    assert.equal(await answer(first.id), '대출 한도는 23권입니다.');
    assert.equal(await answer(second.id), '대출 한도는 11권입니다.');
  } finally {
    await Promise.all([context.close(), contributor.close()]);
  }
}

async function checkResumeHome() {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 940 } });
  try {
    await registerBrowserAccount(context);
    const page = await newPage(context);
    await page.goto('/');
    const start = page.getByRole('region', {name:'작업 시작 방법'});
    await expect(start.getByRole('button', {name:'새 Agent 만들기'})).toBeInViewport();
    await expect(start.getByRole('button', {name:'예제로 배우기'})).toBeInViewport();
    await page.getByRole('button', { name: '입문 실습 보기' }).click();
    await expect(page.getByRole('dialog')).toContainText('입문');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '도서관 실습 시작하기', exact: true }).click();
    const rule = page.getByRole('button', { name: '도서관 이용규정 블록 속성', exact: true });
    await expect(rule).toHaveAttribute('aria-pressed', 'true');
    const id = new URL(page.url()).searchParams.get('edit');
    const original: Graph = (await api(context, 'project.open', { id })).graph;
    const source = page.getByLabel('자료 원문', { exact: true });
    const sentence = '한 사람의 대출 한도는 3권입니다.';
    await expect(rule).toContainText(sentence);
    for (const node of original.nodes.filter(node => node.id !== 'rules')) {
      const body = page.locator(`[data-workflow-node="${node.id}"] .ws-node-body`);
      await expect(body).toHaveText(node.title);
    }
    const menuButton = page.getByLabel('프로젝트 메뉴', { exact: true });
    const projectActions = ['버전', '공유 설정', '내보내기'].map(name => page.getByRole('button', { name, exact: true }));
    for (const action of projectActions) await expect(action).toBeHidden();
    await menuButton.click();
    for (const action of projectActions) await expect(action).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(projectActions[0]).toBeHidden();
    await expect(page.getByRole('button', { name: '시험 실행', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'AI 설계', exact: true })).toBeInViewport();
    const newSource = (await source.inputValue()).replace('3권', '5권');
    await source.fill(newSource);
    await page.getByRole('button', {name:'작업실 홈', exact:true}).click();
    await page.getByRole('button', {name:'편집기 다시 열기'}).click();
    await expect(source).toHaveValue(newSource);
    await page.reload();
    await expect(source).toHaveValue(newSource);
    const beforeApply = (await api(context, 'project.open', {id})).graph;
    assert.deepEqual(beforeApply, original);
    await expect(rule).toContainText(sentence);
    await page.getByRole('button', { name: '변경 적용', exact: true }).click();
    await expect(rule).toContainText(sentence.replace('3권', '5권'));
    await expect(rule).not.toContainText('일요일');
    await rule.focus();
    await rule.press('Shift+ArrowRight');
    await page.getByRole('button', { name: '작업실 홈', exact: true }).click();
    const preview = page.locator('[data-home-canvas="saved"]');
    const x = original.nodes.find(node => node.id === 'rules')!.x + 24;
    await expect(preview.locator('[data-node-id="rules"]')).toHaveAttribute('x', String(x));
    await expect(preview.getByRole('button', { name: /도서관 안내 Agent/ })).toBeVisible();
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 940 }]) {
      await page.setViewportSize(viewport);
      const readableLabel = preview.locator('[data-node-id="rules"] strong');
      await expect.poll(() => readableLabel.evaluate(el => {
        const svg = el.closest('svg')!;
        return parseFloat(getComputedStyle(el).fontSize) * svg.getScreenCTM()!.a;
      })).toBeGreaterThanOrEqual(12);
      await expect(readableLabel).toBeInViewport();
      await noOverflow(page);
    }
    await preview.getByRole('button', { name: '전체 배치 보기' }).click();
    await expect(preview.locator('path[marker-end]')).toHaveCount(5);
    await expect(preview.locator('path[data-from="agent"][data-to="file"]')).toHaveCount(1);
    assert.equal(original.edges.filter(edge => edge.from === 'agent' && edge.to === 'file').length, 2);
    await expect(preview.locator('figcaption')).toContainText('도서관 이용규정');
    await preview.getByRole('button', { name: '주변 블록 보기' }).click();
    await expect(page.getByText('현재 대출 한도 5권')).toBeVisible();
    await page.reload();
    await expect(preview.locator('[data-node-id="rules"]')).toHaveAttribute('x', String(x));
    await shot(page, 'workspace-resume');
    await page.getByRole('button', { name: '편집기 다시 열기' }).click();
    await expect(source).toHaveValue(newSource);
    assert.equal(new URL(page.url()).searchParams.get('edit'), id);
    await shot(page, 'workspace-library-editor');
    if (artifacts) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: '속성 열기', exact: true }).click();
      await shot(page, 'workspace-library-editor-mobile');
      await page.getByRole('button', { name: '속성 닫기', exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 940 });
    }
    const currentDraft = await api(context, 'project.open', {id});
    const edition = await api(context, 'versions.save', {id, revision:currentDraft.revision});
    const typedSource = newSource.replace('5권', '7권');
    await source.fill(typedSource);
    await openProjectAction(page, '버전');
    const history = page.getByRole('dialog', {name:'버전 및 복구'});
    await expect(history).toBeVisible();
    const viewing = (await api(context, 'project.open', {id})).graph as Graph;
    assert.equal(viewing.nodes.find(n => n.id === 'rules')?.config.content, newSource);
    await history.getByLabel('대상 버전').selectOption(String(edition.number));
    await history.getByRole('button', {name:'초안으로 복원'}).click();
    await expect(source).toHaveValue(newSource);
    await page.getByRole('button', {name:'직전 초안 다시 열기'}).click();
    await expect(source).toHaveValue(typedSource);
    // Back must wait for this edit before reading the saved canvas for the home page.
    let releaseSave!: () => void;
    const holdSave = new Promise<void>(resolve => { releaseSave = resolve; });
    const delaySave = async (route: import('@playwright/test').Route) => {
      if (route.request().postDataJSON()?.action === 'project.save') await holdSave;
      await route.fallback();
    };
    await page.route('**/api/studio', delaySave);
    const saving = page.waitForRequest(req => req.url().endsWith('/api/studio') && req.postDataJSON()?.action === 'project.save');
    await rule.focus();
    await rule.press('Shift+ArrowDown');
    try {
      await page.goBack();
      await saving;
      await expect(preview).toBeHidden();
    } finally { releaseSave(); }
    const y = original.nodes.find(node => node.id === 'rules')!.y + 24;
    await expect(preview.locator('[data-node-id="rules"]')).toHaveAttribute('y', String(y));
    await page.unroute('**/api/studio', delaySave);
    await page.reload();
    await expect(preview.locator('[data-node-id="rules"]')).toHaveAttribute('y', String(y));
    await checkRoutingWires(context, page);
    const teamProject = await api(context, 'project.create', { lesson: 'peer-review' });
    const team = (teamProject.graph as Graph).nodes.find(node => node.graph)!;
    await api(context, 'editor.visit', {
      id: teamProject.id, focus: { path: [team.id], selection: { kind: 'node', id: 'review-facts' } },
    });
    await page.goto('/');
    await expect(preview.locator('figcaption')).toContainText('사실 검토 담당의 동료 검토');
    for (const width of [390, 1440]) {
      await page.setViewportSize({width, height: 900});
      const inputs = preview.getByRole('group', {name: '주변 블록 위치 보기'});
      const source = inputs.getByRole('button', {name: '데이터 제공 검토할 안내 초안'});
      await source.click();
      const sourceLabel = preview.locator('[data-node-id="input"] strong');
      await expect.poll(() => sourceLabel.evaluate(el => {
        const svg = el.closest('svg')!, view = svg.getBoundingClientRect(), label = el.getBoundingClientRect();
        return label.left >= view.left && label.right <= view.right &&
          label.top >= view.top && label.bottom <= view.bottom &&
          parseFloat(getComputedStyle(el).fontSize) * svg.getScreenCTM()!.a >= 12;
      })).toBe(true);
      await inputs.getByRole('button', {name: '기준 사실 검토 담당의 동료 검토'}).click();
      if (artifacts) await preview.screenshot({path:resolve(artifacts, 'peer-review-home-' + width + '.png')});
      await preview.getByRole('button', {name: '전체 배치 보기'}).click();
      await expect(preview.locator('foreignObject')).toHaveCount(team.graph!.nodes.length);
      await preview.getByRole('button', {name: '주변 블록 보기'}).click();
      await noOverflow(page);
    }
  } finally {
    await context.close();
  }
}

try {
  for (const small of [false, true]) {
    const ctx = await browser.newContext({baseURL, viewport:small ? {width:390,height:844} : {width:1440,height:900}, isMobile:small, hasTouch:small});
    try {
      await checkLoginRequired(small);
      await registerBrowserAccount(ctx);
      await verifyReleaseCopyGuide(ctx);
      await checkCatalogAndProjectReturns(ctx, small);
    } finally { await ctx.close(); }
  }
  if (process.env.STUDIO_TEST_DATA_DIR) await checkLegacyGuestLogin(process.env.STUDIO_TEST_DATA_DIR);
  await checkEditorNavigation();
  await checkProjectMenuTargets();
  console.log('PASS workspace menu groups, direct guide, project selection and isolated share/import actions');
  await checkResumeHome();
  const p = await newPage(desktop);
  await p.goto('/');
  await signUpFromLogin(p, 'owner-' + stamp);
  await expect(p.getByRole('heading', { name: '내 작업실', exact: true })).toBeVisible(
    { timeout: 60000 }
  );
  await shot(p, 'workspace-desktop');
  await noOverflow(p);
  await p.getByRole('button', { name: '전체 보기' }).click();
  await expect(p.locator('.lesson-tile')).toHaveCount(13);
  await p.reload();
  await expect(p.locator('.lesson-tile')).toHaveCount(13);
  await p.goBack();
  await expect(
    p.getByRole('heading', { name: '내 작업실', exact: true })
  ).toBeVisible();
  await p.goForward();
  await expect(p.locator('.lesson-tile')).toHaveCount(13);
  const filter = p.getByRole('button', { name: '전문가', exact: true });
  await filter.focus();
  await p.keyboard.press('Enter');
  await expect(p.locator('.lesson-tile')).toHaveCount(3);
  await p.getByRole('button', { name: '입문', exact: true }).click();
  await p.locator('[data-lesson-trigger="intro"]').click();
  await p.getByRole('button', { name: '내 사본으로 시작' }).click();
  await expect(p.locator('.ws-node')).toHaveCount(4);
  const templateProject = new URL(p.url()).searchParams.get('edit')!;
  await p.getByRole('button', { name: '실습 안내' }).click();
  await expect(p.locator('#guide-page-title')).toBeVisible();
  await p.getByRole('main').getByRole('button', {name:'현재 단계로 돌아가기'}).click();
  await p.getByRole('button', { name: '목록으로 편집' }).click();
  await p.getByRole('button', { name: '캔버스로 보기' }).click();
  await shot(p, 'editor-desktop');
  await p.getByRole('button', { name: '작업실 홈', exact: true }).click();
  const owner = await api(desktop, 'bootstrap');
  assert.ok(
    owner.projects.some(
      (q: { id: string; mine: boolean }) => q.id === templateProject && q.mine
    ),
    'the account owns its template copy'
  );
  const visitor = await newPage(mobile);
  await visitor.goto('/');
  await signUpFromLogin(visitor, 'reader-' + stamp);
  await expect(
    visitor.getByRole('heading', { name: '내 작업실', exact: true })
  ).toBeVisible();
  await shot(visitor, 'workspace-mobile');
  await noOverflow(visitor);
  await api(mobile, 'project.open', { id: templateProject }, 403);
  await verifyMobileSourceRun(mobile);
  await chooseDynamicPolicy(p);
  await chooseReleaseDecision(p);

  let project = await api(desktop, 'project.create', {
    title: '공유 규정 ' + stamp,
    graph: policyGraph(3),
  });
  await p.goto('/?edit=' + project.id);
  await openProjectAction(p, '공유 설정');
  const dialog = p.getByRole('dialog', { name: 'Agent 공유 설정' });
  await dialog.getByLabel('공유 범위').selectOption('link');
  await dialog.getByRole('button', { name: '선택한 버전 게시' }).click();
  await expect(
    dialog.getByRole('button', { name: '공유 주소 복사' })
  ).toBeVisible();
  project = await api(desktop, 'project.open', { id: project.id });
  await api(mobile, 'project.open', { id: project.id }, 403);
  await visitor.goto('/?agent=' + project.id + '&token=' + project.token);
  const use = visitor.getByRole('dialog', { name: project.title });
  await expect(use.getByRole('button', { name: 'Agent 사용' })).toBeVisible();
  await noOverflow(visitor);
  const first = await verifyAnswer(
    mobile,
    project.id,
    project.token,
    '대출 한도는 3권입니다.'
  );
  await api(desktop, 'run.get', { runId: first.id }, 403);
  await use.getByRole('button', { name: '내 사본 만들기' }).click();
  await expect(visitor.locator('.ws-editor')).toBeVisible();
  await noOverflow(visitor);
  await shot(visitor, 'editor-mobile');
  const copied = new URL(visitor.url()).searchParams.get('edit');
  assert.notEqual(copied, project.id);
  const saved = await api(desktop, 'project.save', {
    id: project.id,
    revision: project.revision,
    title: project.title,
    graph: policyGraph(5),
  });
  const v2 = await api(desktop, 'versions.save', {
    id: project.id,
    revision: saved.revision,
  });
  await api(desktop, 'versions.publish', {
    id: project.id,
    version: v2.number,
    visibility: 'link',
    expectedVisibility: project.visibility,
    expectedPublicVersion: project.publicVersion,
    expectedToken:project.token,
  });
  await verifyAnswer(
    mobile,
    project.id,
    project.token,
    '대출 한도는 5권입니다.'
  );
  await verifyAnswer(
    mobile,
    project.id,
    project.token,
    '대출 한도는 3권입니다.',
    first.conversation
  );
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await openProjectAction(p, '버전');
  const history = p.getByRole('dialog', { name: '버전 및 복구' });
  const targetVersion = history.getByLabel('대상 버전');
  const restoreDraft = history.getByRole('button', { name: '초안으로 복원' });
  await expect(targetVersion).toHaveValue(String(v2.number));
  await targetVersion.selectOption('1');
  await restoreDraft.click();
  await expect(history.getByRole('alert')).toContainText('다른 화면에서 설계가 변경되었습니다');
  assert.deepEqual((await api(desktop, 'project.open', { id: project.id })).graph, saved.graph);

  await p.reload();
  await openProjectAction(p, '버전');
  await targetVersion.selectOption('1');
  await restoreDraft.click();
  await expect(history).toBeHidden();
  await p.getByRole('button', { name: '대출 안내 블록 속성', exact: true }).click();
  await expect(p.getByLabel('종료 안내', { exact: true })).toHaveValue('대출 한도는 3권입니다.');
  const reopenDraft = p.getByRole('button', {name:'직전 초안 다시 열기', exact:true});
  await reopenDraft.click();
  await p.getByRole('button', { name: '대출 안내 블록 속성', exact: true }).click();
  await expect(p.getByLabel('종료 안내', { exact: true })).toHaveValue('대출 한도는 5권입니다.');
  assert.equal((await api(desktop, 'project.open', {id:project.id})).publicVersion, v2.number);
  await p.reload();
  await openProjectAction(p, '버전');
  await history.locator('summary').filter({hasText:'복원 직전 초안'}).click();
  await history.getByRole('button', {name:'선택한 초안 다시 열기'}).click();
  await expect(history).toBeHidden();
  await p.getByRole('button', {name:'대출 안내 블록 속성', exact:true}).click();
  await expect(p.getByLabel('종료 안내', {exact:true})).toHaveValue('대출 한도는 3권입니다.');
  assert.deepEqual((await api(desktop, 'project.open', {id:project.id})).graph, project.graph);
  await openProjectAction(p, '버전');
  await targetVersion.selectOption('1');
  await history.getByRole('button', { name: '공유 설정' }).click();
  await expect(dialog.getByLabel('대상 버전')).toHaveValue('1');
  await dialog.getByRole('button', { name: '선택한 버전 게시' }).click();
  await expect(dialog.getByText('현재 게시 버전 v1', { exact: true })).toBeVisible();
  await verifyAnswer(
    mobile,
    project.id,
    project.token,
    '대출 한도는 3권입니다.'
  );
  await dialog.getByRole('button', { name: '공유 철회' }).click();
  await expect(dialog.getByLabel('공유 범위')).toHaveValue('private');
  await expect(dialog.getByRole('button', { name: '공유 주소 복사' })).toBeHidden();
  await api(
    mobile,
    'project.open',
    { id: project.id, token: project.token },
    403
  );
  const mobileCopy = await api(mobile, 'project.open', { id: copied });
  assert.equal(mobileCopy.mine, true);
  const sharedAgain = await api(desktop, 'versions.publish', {
    id:project.id, version:1, visibility:'link', expectedVisibility:'private', expectedPublicVersion:1,
  });
  await api(mobile, 'project.open', { id:project.id, token:sharedAgain.token });
  await api(mobile, 'project.delete', { id:project.id, revision:sharedAgain.revision }, 403);
  await p.goto('/?view=projects');
  const remove = p.getByRole('button', { name:project.title+' 삭제', exact:true });
  await remove.focus();
  await p.keyboard.press('Enter');
  const confirm = p.getByRole('dialog', { name:'Agent 프로젝트 삭제' });
  await expect(confirm.getByText(project.title, { exact:false }).first()).toBeVisible();
  await expect(confirm.getByText(/공유 주소/)).toBeVisible();
  await expect(confirm.getByText(/휴지통에서 복구/)).toBeVisible();
  await expect(confirm.getByRole('button', { name:'취소' })).toBeFocused();
  assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).overflowY), 'hidden');
  await p.keyboard.press('Shift+Tab');
  await expect(confirm.getByRole('button', { name:'닫기', exact:true })).toBeFocused();
  await p.keyboard.press('Shift+Tab');
  await expect(confirm.getByRole('button', { name:'프로젝트 삭제', exact:true })).toBeFocused();
  await p.keyboard.press('Tab');
  await expect(confirm.getByRole('button', { name:'닫기', exact:true })).toBeFocused();
  await p.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(remove).toBeFocused();
  assert.equal((await api(desktop, 'project.open', { id:project.id })).id, project.id);
  await remove.click();
  await confirm.getByRole('button', { name:'프로젝트 삭제', exact:true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(remove).toHaveCount(0);
  await expect(p.getByRole('textbox', { name:'Agent 이름 검색' })).toBeFocused();
  await p.reload();
  await expect(p.getByRole('textbox', { name:'Agent 이름 검색' })).toBeVisible();
  await expect(remove).toHaveCount(0);
  await api(desktop, 'project.open', { id:project.id }, 404);
  await api(mobile, 'project.open', { id:project.id, token:sharedAgain.token }, 404);
  assert.equal((await api(mobile, 'project.open', { id:copied })).id, copied);

  await p.getByRole('link', { name:'휴지통', exact:true }).click();
  await expect(p.getByRole('heading', {name:'휴지통', exact:true})).toBeVisible();
  const recover = p.getByRole('button', { name:project.title+' 복구', exact:true });
  await expect(recover).toBeEnabled();
  await p.reload();
  const trashSearch = p.getByRole('textbox', { name:'휴지통에서 Agent 이름 검색' });
  await trashSearch.fill('없는 프로젝트 '+stamp);
  await expect(recover).toHaveCount(0);
  await trashSearch.fill(project.title);
  await expect(recover).toBeVisible();

  await visitor.goto('/?view=projects&folder=trash');
  await expect(visitor.getByRole('heading', {name:'휴지통', exact:true})).toBeVisible();
  await expect(visitor.getByText('휴지통이 비어 있습니다.', {exact:true})).toBeVisible();
  await expect(visitor.getByRole('button', { name:project.title+' 복구', exact:true })).toHaveCount(0);
  await noOverflow(visitor);
  await recover.focus();
  await p.keyboard.press('Enter');
  await expect(remove).toBeVisible();
  await expect(p.getByRole('textbox', { name:'Agent 이름 검색' })).toHaveValue('');
  await p.reload();
  await expect(remove).toBeVisible();
  await p.locator('.project-row').filter({ has: p.getByText(project.title, { exact: true }) }).click();
  await expect(p.locator('.ws-editor')).toBeVisible();
  assert.equal(new URL(p.url()).searchParams.get('edit'), project.id);
  const recovered = await api(desktop, 'project.open', {id:project.id});
  assert.deepEqual(recovered.graph, project.graph);
  assert.equal(recovered.visibility, 'private');
  assert.equal(recovered.publicVersion, null);
  await api(mobile, 'project.open', { id:project.id, token:sharedAgain.token }, 403);
  assert.deepEqual((await api(desktop, 'versions.list', {id:project.id})).map((v:{number:number})=>v.number), [v2.number, 1]);
  await p.goto('/?view=projects&folder=trash');
  await expect(p.getByText('휴지통이 비어 있습니다.', {exact:true})).toBeVisible();
  await expect(recover).toHaveCount(0);
  await p.getByRole('link', {name:'내 Agent로 돌아가기'}).click();
  await expect(remove).toBeVisible();
  await verifyTrashSelection(visitor);
  await verifyConnections(p);
  await verifyEvidenceRepair(p);
  await verifyNamedOutputs(p);
  await verifyCopyPlacementAndTeamView(p);
  await verifyTeamSkillSelection(p);
  await verifyRecommendedBlocks(p);
  await verifyMergedBlockMenus(p);
  await verifyEditorLessonGuides();
  await verifyQuestionDeadlines(p);
  await verifyTerminalAndErrorSettings(p);
  await verifyLeavingSharedCopy();
  assert.deepEqual(errors, []);
  console.log(
    'PASS full Windows app: login gate, shared-link return, logout, signup, thirteen templates, desktop keyboard & mobile layout, two accounts, published versions 3→5→3, pinned conversation, link revocation, trash recovery and purge, independent copy, five recommendation levels, saved AI task modes, 32 block menus, optional question deadlines, legacy waits, four terminal modes and two error strategies'
  );
} finally {
  await browser.close();
}
