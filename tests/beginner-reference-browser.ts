import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import type { Graph } from '../src/domain';
import { executeGraph } from '../src/engine';
import { completedRunFiles } from '../src/engine/legacy-files';
import { registerBrowserAccount } from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
assert.ok(baseURL, '격리 시험용 작업실 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});
const loanQuestion = '책을 몇 권까지 빌릴 수 있나요?';
type Asset = {id:string; name:string; mine:boolean; kind:string; visibility:string; version:number};

async function api<T>(context: BrowserContext, action: string, data: unknown = {}): Promise<T> {
  const response = await context.request.post('/api/studio', {data:{action, data}});
  const result = await response.json();
  assert.equal(response.status(), 200, action + ' ' + (result.error ?? response.status()));
  return result.data;
}

// Exercise the saved graph, its real private asset editions, and the file block with a local model.
async function answerLoanQuestion(page: Page, project: string, expectedLimit: 3 | 5) {
  const rule = '한 사람의 대출 한도는 ' + expectedLimit + '권입니다.';
  const expected = expectedLimit + '권까지 빌릴 수 있습니다.\n“' + rule + '”';
  const runId = crypto.randomUUID();
  await page.route('**/api/studio', async route => {
    const {action, data} = route.request().postDataJSON();
    if (data?.id !== project) return route.fallback();
    if (action === 'run.inputFiles' && data.conversation === runId)
      return route.fulfill({json:{data:{accept:null}}});
    if (action !== 'run.start') return route.fallback();
    const {graph} = await api<{graph:Graph}>(page.context(), 'project.open', {id:project});
    const result = await executeGraph(graph, {input:data.input, runId}, {
      scopeModel: async () => ({text:'{"status":"in_scope"}'}),
      asset: async (id, version) => {
        const edition = await api<{asset:Asset; version:number; payload:{content:string}}>(page.context(), 'asset.read', {id,version});
        return {id, title:edition.asset.name, version:String(edition.version), content:edition.payload.content};
      },
      model: async request => {
        const quote = request.context.match(/한 사람의 대출 한도는 (\d+)권입니다\./);
        if (request.input !== loanQuestion || !quote) return {text:'확인할 수 없습니다.'};
        return {text:quote[1] + '권까지 빌릴 수 있습니다.\n“' + quote[0] + '”'};
      },
      tool: async () => { throw Error('초급 실습은 외부 도구를 호출하지 않습니다.'); },
    });
    const now = new Date().toISOString();
    const files=result.status==='completed'?completedRunFiles(graph,result.checkpoint):[];
    await route.fulfill({json:{data:{id:runId, mode:'test', conversation:runId, input:data.input,
      state:result.status, output:result.output, files, events:result.events, error:result.error, created:now, updated:now}}});
  });
  await page.getByRole('button', {name:'시험 실행', exact:true}).click();
  const panel = page.getByRole('tabpanel', {name:'실행 결과'});
  await panel.getByRole('textbox', {name:'Agent에게 보낼 질문'}).fill(loanQuestion);
  await panel.getByRole('button', {name:'질문 실행', exact:true}).click();
  await expect(panel.locator('.run-output')).toHaveText(expected);
  const pending = page.waitForEvent('download');
  await panel.getByRole('button', {name:'대출안내.txt 내려받기', exact:true}).click();
  const file = await pending;
  assert.equal(file.suggestedFilename(), '대출안내.txt');
  assert.equal(await readFile(await file.path(), 'utf8'), expected);
}

try {
  for (const width of [1440, 390]) {
    const mobile = width === 390;
    const context = await browser.newContext({baseURL, viewport:{width, height: mobile ? 844 : 900}, isMobile:mobile, hasTouch:mobile});
    try {
      await registerBrowserAccount(context);
      const page = await context.newPage();
      async function newBeginnerCopy() {
        await page.goto('/?view=templates');
        await page.getByRole('button', {name:'초급', exact:true}).click();
        await page.getByRole('button', {name:/내 자료로 안내하기/}).click();
        const detail = page.getByRole('dialog');
        await expect(detail.getByRole('heading', {name:'선택 실습', exact:true})).toBeVisible();
        await expect(detail).toContainText('이름·자료판 설정');
        await detail.getByRole('button', {name:'내 사본으로 시작', exact:true}).click();
        await expect(page).toHaveURL(url => url.searchParams.has('edit'));
        return new URL(page.url()).searchParams.get('edit')!;
      }
      const openRules = () => page.locator('[data-canvas-block="rules"]').click();
      const closeSheet = async () => {
        const close = page.getByRole('dialog', {name:'속성 패널'}).getByRole('button',{name:'속성 닫기'});
        if (await close.isVisible()) await close.click();
      };
      await newBeginnerCopy();
      await openRules();
      const source = page.getByRole('textbox', {name:'자료 원문', exact:true});
      const original = await source.inputValue();
      assert.match(original, /한 사람의 대출 한도는 3권입니다\./);
      const edited = original.replace('3권', '5권');
      await source.fill(edited);
      const save = page.getByRole('button', {name:'내 참고 자료로 저장', exact:true});
      await expect(save).toBeVisible();
      await expect(page.getByRole('textbox', {name:'자료 이름', exact:true})).toHaveValue('도서관 이용규정');
      const list = async () => (await api<Asset[]>(context, 'asset.list')).filter(asset => asset.mine);
      assert.deepEqual(await list(), []);
      if (!mobile) {
        // Lose one response after the real server has committed the reference.
        let loseResponse = true;
        await page.route('**/api/studio', async route => {
          if (!loseResponse || route.request().postDataJSON().action !== 'asset.save') return route.fallback();
          loseResponse = false;
          const accepted = await route.fetch();
          assert.ok(accepted.ok());
          await route.fulfill({status:503, json:{error:'저장 응답을 받지 못했습니다.'}});
        });
        await save.click();
        await expect(page.getByRole('alert').filter({hasText:'저장 응답을 받지 못했습니다.'})).toBeVisible();
        await expect(source).toHaveValue(edited);
      }
      await save.press('Enter');
      await expect(page.getByRole('status').filter({hasText:'내 비공개 참고 자료로 저장했습니다'})).toBeVisible();
      await expect(save).toBeDisabled();
      await expect(save).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', {name:/저장한 참고 자료 열기/})).toBeFocused();
      await expect.poll(async () => (await list()).length).toBe(1);
      const [asset] = await list();
      assert.equal(asset.visibility, 'private');
      assert.equal(asset.kind, 'document');
      assert.equal(asset.version, 1);
      await expect(source).toHaveValue(edited);
      const edition = await api<{payload:{content:string}}>(context, 'asset.read', {id:asset.id, version:1});
      assert.equal(edition.payload.content, edited);
      const materialSettings = page.getByText('이름·자료판 설정', {exact:true});
      const picker = page.getByRole('combobox', {name:'연결할 자료', exact:true});
      await materialSettings.click();
      await expect(picker).toHaveValue('');
      await expect(picker.getByRole('option', {name:/도서관 이용규정.*내 자료.*1판/})).toHaveAttribute('value', asset.id);
      await materialSettings.click();
      await page.getByRole('button', {name:'변경 적용', exact:true}).click();
      await expect(page.getByRole('button', {name:'변경 적용', exact:true})).toBeDisabled();
      const libraryPage = await context.newPage();
      await libraryPage.goto('/?view=assets');
      const library = libraryPage.getByRole('region', {name:'도구 및 자료'});
      await library.getByRole('button', {name:'내 자료', exact:true}).click();
      const entry = library.getByRole('button', {name:/도서관 이용규정.*참고 자료/});
      await expect(entry).toContainText('나만 사용');
      await entry.click();
      await expect(library.locator('.rl-source')).toHaveText(edited);
      await libraryPage.close();

      const decoy = await api<Asset>(context, 'asset.save', {kind:'document', name:asset.name, payload:{content:original}});
      const reused = await newBeginnerCopy();
      await openRules();
      await expect(source).toHaveValue(original);
      await materialSettings.click();
      const choices = picker.getByRole('option', {name:/도서관 이용규정.*내 자료.*1판/});
      await expect(choices).toHaveCount(2);
      assert.equal(new Set(await choices.allTextContents()).size, 2);
      await picker.selectOption(decoy.id);
      const preview = page.getByRole('region', {name:'연결 전 원문'});
      await expect(preview).toContainText('한 사람의 대출 한도는 3권입니다.');
      await picker.selectOption(asset.id);
      await expect(preview).toContainText('한 사람의 대출 한도는 5권입니다.');
      await expect(source).toHaveValue(original);
      await expect(page.getByRole('link', {name:/연결한 자료 원문 열기/})).toHaveCount(0);
      await page.getByRole('button', {name:'이 판 연결', exact:true}).click();
      await expect(page.getByRole('link', {name:/연결한 자료 원문 열기/})).toBeVisible();
      await closeSheet();
      await page.getByLabel('프로젝트 메뉴', {exact:true}).click();
      await page.getByRole('button', {name:'저장', exact:true}).click();
      await expect.poll(async () => {
        const {graph} = await api<{graph:Graph}>(context, 'project.open', {id:reused});
        const reference = graph.nodes.find(node => node.id === 'rules')!.config;
        return [reference.assetId, String(reference.version)];
      }).toEqual([asset.id, '1']);
      await answerLoanQuestion(page, reused, 5);

      const fresh = await newBeginnerCopy();
      await answerLoanQuestion(page, fresh, 3);
      assert.equal((await list()).length, 2);
      console.log('PASS ' + width + 'px · 편집 원문 비공개 1판 저장, 다른 사본으로 연결, 각각 5권·3권 답변과 대출안내.txt 검증');
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
