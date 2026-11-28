import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, expect, type BrowserContext } from '@playwright/test';
import type { Graph } from '../src/domain';
import type { EngineEvent } from '../src/engine/types';
import { registerBrowserAccount } from './browser-account';
import { checkVisitAnswer, checkVisitResources, visitCaseName } from './library-visit-checks';

const baseURL = process.env.STUDIO_TEST_URL;
assert.ok(baseURL && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname),
  '격리한 로컬 작업실 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});

async function api<T>(ctx: BrowserContext, action: string, data: unknown = {}): Promise<T> {
  const response = await ctx.request.post('/api/studio', {data:{action, data}});
  const payload = await response.json();
  assert.equal(response.status(), 200, action + ' ' + (payload.error ?? response.status()));
  return payload.data;
}
type VisitRun = {id: string; conversation: string; state: string; input: string; output: string; error: string; events: EngineEvent[]};

async function verify() {
  const width = 1440;
  const ctx = await browser.newContext({baseURL, viewport:{width, height:900}});
  try {
    await registerBrowserAccount(ctx);
    const {modelReady} = await api<{modelReady: boolean}>(ctx, 'bootstrap');
    const page = await ctx.newPage();
    await page.goto('/?view=templates');
    await page.getByRole('combobox', {name:'실습 수준', exact:true}).selectOption({label:'중급'});
    await page.getByRole('button', {name:/도서관 방문 준비하기/}).click();
    await page.getByRole('dialog').getByRole('button', {name:'내 사본으로 시작', exact:true}).click();
    await expect(page).toHaveURL(url => url.searchParams.has('edit'));
    const id = new URL(page.url()).searchParams.get('edit')!;
    const readGraph = async () => (await api<{graph: Graph}>(ctx, 'project.open', {id})).graph;
    if(!modelReady){
      // The dedicated template checks scope with the model before reading any resources.
      // Exercise the real search and MCP paths offline in this account's test copy.
      const draft=await api<{title:string;revision:number;graph:Graph}>(ctx,'project.open',{id});
      await api(ctx,'project.save',{id,title:draft.title,revision:draft.revision,graph:{
        ...draft.graph,agentScope:{mode:'general',purpose:''},
      }});
      await page.reload();
    }
    const before = await readGraph();
    const panel = page.getByRole('tabpanel', {name:'실행 결과'});
    const project = await api<{revision:number}>(ctx, 'project.open', {id});
    for (let n = 0; n < 2; n++) await api(ctx, 'versions.save', {id, revision:project.revision});
    await page.getByRole('button', {name:'시험 실행', exact:true}).click();
    await panel.getByRole('button', {name:'실행 설정'}).click();
    await panel.getByRole('button', {name:'시험 사례', exact:true}).click();
    const design = panel.getByLabel('실행할 설계 버전');
    const compare = panel.getByLabel('비교할 버전');
    const sample = panel.getByLabel('시험 사례 선택');
    const question = panel.getByLabel('Agent에게 보낼 질문');
    await sample.selectOption({label:visitCaseName});
    const selectedCase = await sample.inputValue();
    const savedQuestion = await question.inputValue();
    await design.selectOption('1');
    await compare.selectOption('2');
    await question.fill('저장 후에도 남아야 하는 질문');
    await page.getByLabel('프로젝트 메뉴', {exact:true}).click();
    await page.getByRole('button', {name:'버전',exact:true}).click();
    const versionDialog = page.getByRole('dialog', {name:'버전 및 복구'});
    await versionDialog.getByRole('button', {name:'현재 초안 버전 저장'}).click();
    await expect(versionDialog.getByLabel('대상 버전')).toHaveValue('3');
    await page.keyboard.press('Escape');
    await expect(design.locator('option[value="3"]')).toHaveCount(1);
    await expect(compare.locator('option[value="3"]')).toHaveCount(1);
    await expect(design).toHaveValue('1');
    await expect(compare).toHaveValue('2');
    await expect(sample).toHaveValue(selectedCase);
    await expect(question).toHaveValue('저장 후에도 남아야 하는 질문');
    await design.selectOption('');
    await compare.selectOption('');
    await question.fill(savedQuestion);
    async function testEdition(version: number) {
      await page.getByRole('button', {name:'시험 실행', exact:true}).click();
      const settings = panel.getByRole('button', {name:'실행 설정'});
      if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
      const cases = panel.getByRole('button', {name:'시험 사례', exact:true});
      if (await cases.getAttribute('aria-expanded') !== 'true') await cases.click();
      await panel.getByLabel('시험 사례 선택').selectOption({label:visitCaseName});
      const started = page.waitForResponse(res => res.url().endsWith('/api/studio') && res.request().postDataJSON()?.action === 'run.start');
      await panel.getByRole('button', {name:'저장된 사례로 시험', exact:true}).click();
      const start = await started;
      assert.equal(start.status(), 200);
      const {data: {id: runId}} = await start.json();
      const read = () => api<VisitRun>(ctx, 'run.get', {id, runId});
      await expect.poll(async () => (await read()).state, {timeout: modelReady ? 160000 : 20000})
        .not.toMatch(/^(queued|running)$/);
      const run = await read();
      checkVisitResources(await readGraph(), run.events, version);
      const turn = panel.locator('[data-run-turn="' + runId + '"]');
      await expect(turn.locator('.run-question')).toHaveText(run.input);
      if (modelReady) {
        assert.equal(run.state, 'completed', run.error);
        await expect(turn.locator('.run-output')).toHaveText(run.output);
        return {run, stable:checkVisitAnswer(run.output, version)};
      }
      // The offline suite still exercises the real search, fixed document, Skill and read-only MCP.
      assert.equal(run.state, 'failed');
      assert.match(run.error, /모델 설정|OPENAI_API_KEY/);
      await expect(turn.locator('.run-error')).toHaveText(run.error);
      return {run, stable:null};
    }
    const first = await testEdition(1);
    await page.locator('[data-canvas-block="pickup"]').click();
    const edition = page.getByRole('combobox', {name:'고정할 자료 버전', exact:true});
    await expect(edition).toHaveValue('1');
    await edition.selectOption({label:'2판'});
    await page.getByLabel('프로젝트 메뉴', {exact:true}).click();
    await page.getByRole('button', {name:'저장', exact:true}).click();
    const expected = structuredClone(before);
    expected.nodes.find(node => node.id === 'pickup')!.config.version = '2';
    await expect.poll(readGraph).toEqual(expected);
    const second = await testEdition(2);
    assert.equal(first.run.input, second.run.input);
    assert.notEqual(first.run.conversation, second.run.conversation);
    assert.deepEqual(first.stable, second.stable);
    await panel.getByRole('button', {name:'실행 기록', exact:true}).click();
    const older = panel.locator('.run-history:not([aria-current="true"])');
    const newer = panel.locator('.run-history[aria-current="true"]');
    await expect(newer).toContainText('실행 2');
    await expect(newer).toContainText('수령 규정 2판');
    await expect(older).toHaveCount(1);
    await expect(older).toContainText('실행 1');
    await expect(older).toContainText('수령 규정 1판');
    await expect(older).not.toContainText('수령 규정 2판');
    await older.click();
    const original = panel.locator('[data-run-turn="' + first.run.id + '"]');
    await expect(original.locator('.run-question')).toHaveText(first.run.input);
    await expect(original).toContainText('수령 규정 1판');
    if (modelReady) await expect(original.locator('.run-output')).toHaveText(first.run.output);
    console.log('PASS ' + width + 'px · 수령 규정 1→2판, 동일한 시험 질문과 예약 조회 · ' +
      (modelReady ? '두 답변의 준비물만 변경' : '모델 미설정 안내까지 확인'));
  } finally { await ctx.close(); }
}
try { await verify(); }
finally { await browser.close(); }
