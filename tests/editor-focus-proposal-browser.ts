import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium, expect, type BrowserContext} from '@playwright/test';
import {connectBlocks, connectionOptions, createBlock, validateGraph, type Graph} from '../src/domain';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소가 필요합니다.');
const installed = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(installed) ? installed : undefined)});

async function api(context: BrowserContext, action: string, data = {}) {
  const response = await context.request.post('/api/studio', {data:{action,data}});
  const result = await response.json();
  assert.ok(response.ok(), action + ' ' + (result.error ?? ''));
  return result.data;
}

function reviewTeams(): Graph {
  const inner: Graph = {nodes:[
    createBlock('input.user_request', {id:'source', title:'전달받은 구절'}),
    createBlock('quality.evidence', {id:'review', title:'구절 검토', x:320}),
    createBlock('output.answer', {id:'result', title:'검토 결과', x:590}),
  ], edges:[]};
  inner.edges.push(...connectBlocks(inner, 'source', 'review'),
    ...connectBlocks(inner, 'review', 'result', connectionOptions(inner, 'review', 'result')));
  const graph: Graph = {nodes:[
    createBlock('input.user_request', {id:'question', title:'원래 질문'}),
    createBlock('agent.team', {id:'first', title:'첫 검토 팀', x:320, config:{goal:'원문 검토'}, graph:inner}),
    createBlock('agent.team', {id:'second', title:'다음 검토 팀', x:590, config:{goal:'이중 검토'}, graph:inner}),
    createBlock('output.answer', {id:'reply', title:'최종 답변', x:860}),
  ], edges:[]};
  graph.edges.push(...connectBlocks(graph,'question','first'), ...connectBlocks(graph,'first','second'),
    ...connectBlocks(graph,'second','reply'));
  assert.deepEqual(validateGraph(graph), []);
  assert.ok(validateGraph(inner).length, '내부에서만 유효한 근거 전달 경로를 시험합니다.');
  return graph;
}

async function check() {
  const context = await browser.newContext({baseURL, viewport:{width:1440,height:900}});
  try {
    await registerBrowserAccount(context);
    const page = await context.newPage();
    const button = (name: string) => page.getByRole('button',{name,exact:true});
    const lesson = await api(context, 'project.create',{lesson:'intermediate'});
    await page.goto('/?edit=' + lesson.id);
    const canvas = page.locator('.ws-canvas');
    const selected = canvas.locator('.ws-node.ws-chosen');
    const scale = () => canvas.locator('.ws-world').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);
    await expect.poll(scale).toBeGreaterThanOrEqual(0.9);
    await expect(selected).toBeInViewport({ratio:0.98});
    const textSize = await selected.locator('strong').evaluate(el =>
      parseFloat(getComputedStyle(el).fontSize) * new DOMMatrix(getComputedStyle(el.closest('.ws-world')!).transform).a);
    assert.ok(textSize >= 12, 'Selected block label must be readable.');
    await button('캔버스에 맞추기').click();
    await expect.poll(scale).toBeLessThan(0.8);

    const beginner = await api(context, 'project.create',{lesson:'beginner'});
    await page.goto('/?edit=' + beginner.id);
    const nodes = canvas.locator('button[data-canvas-block]');
    await expect(nodes).toHaveCount(beginner.graph.nodes.length);
    const first = nodes.first(), second = nodes.nth(1);
    const firstId = await first.getAttribute('data-canvas-block');
    const secondId = await second.getAttribute('data-canvas-block');
    await first.focus();
    for (let presses=0; presses<8 && !(await second.evaluate(el => el === document.activeElement)); presses++)
      await page.keyboard.press('Tab');
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute('aria-pressed','true');
    await page.keyboard.press('Delete');
    await expect(nodes).toHaveCount(beginner.graph.nodes.length-1);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => {
      const {graph} = await api(context,'project.open',{id:beginner.id}) as {graph:Graph};
      return graph.nodes.map(node => node.id);
    }).toEqual((beginner.graph as Graph).nodes.filter(n => n.id !== secondId).map(n => n.id));
    const saved = await api(context,'project.open',{id:beginner.id}) as {graph:Graph};
    assert.ok(saved.graph.nodes.some(node => node.id === firstId));
    assert.deepEqual(saved.graph.edges, (beginner.graph as Graph).edges.filter(e => e.from !== secondId && e.to !== secondId));
    await button('실행 취소').click();
    await expect(nodes).toHaveCount(beginner.graph.nodes.length);
    await first.focus();
    await button('설계 검사').focus();
    await page.keyboard.press('Delete');
    await expect(nodes).toHaveCount(beginner.graph.nodes.length);

    // Simulate model availability and proposal responses. Project reads and writes still use the real API.
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    let releaseGuide!: () => void;
    const guideHold = new Promise<void>(resolve => { releaseGuide = resolve; });
    const requests: string[] = [];
    const change = '담당자가 없는 항목은 미정으로 표시해 줘';
    const unrelated = '프랑스의 수도는 어디인가요?';
    const material = '회의 메모: 금요일에 결과를 공유한다.';
    const guideBootstrap = {...await api(context, 'bootstrap'), modelReady:true};
    await page.route('**/api/studio', async route => {
      const {action,data} = route.request().postDataJSON();
      const isGuide = new URL(page.url()).searchParams.get('view') === 'guide';
      if (action === 'bootstrap' && isGuide) return route.fulfill({json:{data:guideBootstrap}});
      if (action !== 'propose') return route.fallback();
      requests.push(data.prompt);
      assert.equal(data.changeContext, isGuide ? 'meeting-report' : 'editor');
      assert.ok(!JSON.stringify(data).includes(material));
      if (isGuide && data.prompt === unrelated && !data.clarificationAnswer) await guideHold;
      if ((data.prompt === '안녕하세요' || data.prompt === unrelated) && !data.clarificationAnswer)
        return route.fulfill({json:{data:{clarification:true}}});
      if (data.clarificationAnswer === '네')
        return route.fulfill({status:422, json:{error:'보충 답변에 바꿀 일을 구체적으로 적어 주세요.'}});
      if (data.prompt === '늦은 요청') await hold;
      const graph: Graph = data.graph;
      graph.nodes[0].title = data.clarificationAnswer ?? data.prompt;
      if (data.prompt === '연결 오류가 있는 제안') graph.edges.push({
        id:'broken', from:'missing', to:'review', kind:'flow', out:'next', input:'in',
      });
      await route.fulfill({json:{data:{graph}}});
    });
    await button('AI 설계').click();
    const dialog = page.getByRole('dialog',{name:'AI 설계 제안'});
    const prompt = dialog.getByRole('textbox',{name:'만들거나 바꿀 일'});
    const send = dialog.getByRole('button',{name:/변경 제안.*받기/});
    const apply = dialog.getByRole('button',{name:'캔버스에 적용'});
    const height = () => prompt.evaluate(el => el.clientHeight);
    const initialHeight = await height();
    const longPrompt = Array.from({length:40}, (_, n) => (n+1) + '. 회의 메모에서 담당자와 기한을 정리해 줘').join('\n');
    await prompt.fill(longPrompt);
    await expect.poll(height).toBeGreaterThan(initialHeight);
    const expand = dialog.getByRole('button', {name:'만들거나 바꿀 일 넓게 쓰기'});
    await expand.click();
    const writing = page.getByRole('dialog', {name:'만들거나 바꿀 일', exact:true});
    const expandedField = writing.getByRole('textbox');
    await expect(expandedField).toBeFocused();
    await expect(expandedField).toHaveValue(longPrompt);
    await expandedField.press('Control+End');
    await expandedField.press('Enter');
    await page.keyboard.insertText('미정인 날짜는 비워 둬');
    await expandedField.press('Escape');
    await expect(writing).toHaveCount(0);
    await expect(expand).toBeFocused();
    await expect(prompt).toHaveValue(longPrompt + '\n미정인 날짜는 비워 둬');
    assert.equal(requests.length, 0);
    await prompt.fill('안녕하세요');
    await expect.poll(height).toBe(initialHeight);
    await send.click();
    const answer = dialog.getByRole('textbox',{name:'현재 설계에서 무엇을 바꾸고 싶으세요?'});
    await expect(answer).toBeFocused();
    await expect(send).toBeDisabled();
    await answer.fill('네');
    await send.click();
    await expect(dialog.getByRole('alert')).toContainText('구체적으로');
    await expect(answer).toHaveCount(1);
    await expect(apply).toHaveCount(0);
    await answer.fill(change);
    await send.click();
    await expect(apply).toBeEnabled();
    await expect(first).not.toContainText(change);
    await prompt.fill('월요일 휴관 안내');
    await expect(answer).toHaveCount(0);
    await send.click();
    await expect(apply).toBeEnabled();
    await prompt.fill('금요일 야간 개관 안내');
    await expect(apply).toHaveCount(0);
    await expect(button('변경 제안 다시 받기')).toBeEnabled();
    await prompt.fill('월요일 휴관 안내');
    await expect(apply).toHaveCount(0);
    await prompt.fill('늦은 요청');
    await send.click();
    await expect.poll(() => requests).toContain('늦은 요청');
    await prompt.fill('금요일 야간 개관 안내');
    await send.click();
    await expect(apply).toBeEnabled();
    const lateResponse = page.waitForResponse(response =>
      response.url().endsWith('/api/studio') && response.request().postDataJSON()?.data?.prompt === '늦은 요청');
    release();
    await lateResponse;
    await apply.click();
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await api(context,'project.open',{id:beginner.id})).graph.nodes[0].title)
      .toBe('금요일 야간 개관 안내');
    await button('AI 설계').click();
    await expect(apply).toHaveCount(0);

    const teams = reviewTeams();
    const nested = await api(context, 'project.create', {title:'내부 설계 변경', graph:teams});
    await page.goto('/?edit=' + nested.id);
    await button('첫 검토 팀 블록 속성').press('Enter');
    await button('팀 열기').click();
    const teamHeading = page.getByRole('heading', {name:'첫 검토 팀', exact:true});
    await expect(teamHeading).toBeVisible();
    await button('AI 설계').click();
    await prompt.fill('연결 오류가 있는 제안');
    await send.click();
    const warning = dialog.getByRole('status');
    await expect(warning).toContainText('실행 전 수정 1곳');
    await expect(warning).toContainText('첫 검토 팀 › 구절 검토');
    await expect(warning).toContainText('연결할 블록을 찾을 수 없습니다.');
    await dialog.getByRole('button',{name:'취소', exact:true}).click();
    const originalNode = button('전달받은 구절 블록 속성');
    await expect(originalNode).toBeVisible();
    await button('AI 설계').click();
    await prompt.fill('검증할 원문 구절');
    await send.click();
    await expect(apply).toBeEnabled();
    await expect(warning).toHaveCount(0);
    await expect(originalNode).toBeVisible();
    await apply.click();
    await expect(teamHeading).toBeVisible();
    await expect(button('검증할 원문 구절 블록 속성')).toBeVisible();
    await page.keyboard.press('Control+s');
    const expected = structuredClone(teams);
    expected.nodes[1].graph!.nodes[0].title = '검증할 원문 구절';
    const savedTeams = async () => (await api(context,'project.open',{id:nested.id})).graph;
    await expect.poll(savedTeams).toEqual(expected);
    await button('실행 취소').click();
    await expect(teamHeading).toBeVisible();
    await expect(originalNode).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect.poll(savedTeams).toEqual(teams);

    await page.goto('/?view=guide&section=goals&step=1&template=meeting-report');
    const startGuide = button('이 업무로 설계하기');
    await startGuide.click();
    const guide = page.getByRole('dialog',{name:'회의록·업무 보고 설계하기'});
    const guidePrompt = guide.getByRole('textbox',{name:'맡길 일과 원하는 결과'});
    const guideAnswer = guide.getByRole('textbox',{name:'회의록·업무 보고 설계에서 무엇을 바꾸고 싶으세요?'});
    const notes = guide.getByRole('textbox',{name:/회의 메모/});
    const preview = guide.getByRole('heading',{name:'제안된 Workflow'});
    const propose = guide.getByRole('button',{name:'초안 제안받기',exact:true});
    const followUp = guide.getByRole('button',{name:'답변으로 초안 제안받기'});
    const projectCount = (await api(context,'project.list')).length;
    await propose.click();
    await expect(preview).toBeVisible();
    await expect(guideAnswer).toHaveCount(0);
    await guidePrompt.fill(unrelated);
    await propose.click();
    await expect.poll(() => requests).toContain(unrelated);
    await notes.fill(material);
    releaseGuide();
    await expect(guideAnswer).toBeFocused();
    await expect(notes).toHaveValue(material);
    await expect(preview).toHaveCount(0);
    await guideAnswer.fill('네');
    await followUp.click();
    await expect(guide.getByRole('alert')).toContainText('구체적으로');
    await expect(guideAnswer).toHaveCount(1);
    await guideAnswer.fill(change);
    await guide.getByRole('button',{name:'닫기',exact:true}).click();
    await startGuide.click();
    await expect(guideAnswer).toHaveValue(change);
    await expect(notes).toHaveValue(material);
    await followUp.click();
    await expect(preview).toBeVisible();
    assert.equal((await api(context,'project.list')).length, projectCount);
  } finally { await context.close(); }
}

try {
  await check();
  console.log('PASS desktop canvas controls, editor and guide clarification, stale proposals, and scoped team changes with validation and undo.');
} finally { await browser.close(); }
