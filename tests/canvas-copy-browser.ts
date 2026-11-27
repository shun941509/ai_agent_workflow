import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium, expect, type BrowserContext} from '@playwright/test';
import {createBlock, type Graph} from '../src/domain';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});
async function api(ctx:BrowserContext, action:string, data = {}) {
  const response = await ctx.request.post('/api/studio',{data:{action,data}});
  const result = await response.json();
  assert.ok(response.ok(), result.error);
  return result.data;
}

async function exercise(width:number) {
  const mobile = width === 390;
  const ctx = await browser.newContext({baseURL,viewport:{width,height:mobile ? 844 : 900},hasTouch:mobile,isMobile:mobile});
  try {
    await registerBrowserAccount(ctx);
    const applied = '일주일 동안 3권을 빌릴 수 있습니다.';
    const edited = applied.replace('3권','7권');
    const rules = createBlock('resource.context',{id:'rules',title:'대출 규정',x:36,y:48,config:{content:applied}});
    const graph:Graph = {nodes:[
      {...rules, config:{content:'상위 설계의 원문'}},
      {...createBlock('agent.team',{id:'team',title:'도서관 팀'}),graph:{nodes:[rules],edges:[]}},
    ],edges:[]};
    const project = await api(ctx,'project.create',{title:'사본 배치 연습',graph});
    const saved = async ():Promise<Graph> => (await api(ctx,'project.open',{id:project.id})).graph;
    const child = async () => (await saved()).nodes.find(n => n.id === 'team')!.graph!;
    const page = await ctx.newPage();
    const errors:string[] = [];
    page.on('pageerror',error => errors.push(error.message));
    const button = (name:string) => page.getByRole('button',{name,exact:true});
    const block = (id:string) => page.locator('[data-canvas-block="' + id + '"]');
    const source = page.getByRole('textbox',{name:'자료 원문',exact:true});
    const choice = page.getByRole('dialog',{name:'복제할 원문 선택'});
    const sourceCopy = page.locator('[data-canvas-block]').filter({hasText:'대출 규정 사본'});
    const left = (id:string) => block(id).evaluate(el => parseFloat((el.closest('[data-workflow-node]') as HTMLElement).style.left));
    await page.goto('/?edit='+project.id);
    if (mobile) await button('캔버스로 보기').click();
    await block('team').press('Enter');
    await button('팀 열기').press('Enter');
    await expect(block('team')).toHaveCount(0);

    // A clean copy is immediately ready for placement. Undo/redo restore the two distinct focus targets.
    await block('rules').press('Enter');
    await button('블록 복제').press('Enter');
    await expect(choice).toHaveCount(0);
    await expect(sourceCopy).toBeFocused();
    await expect(sourceCopy).toHaveAttribute('aria-pressed','true');
    const id = (await sourceCopy.getAttribute('data-canvas-block'))!;
    const copyX = await left(id);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => left(id)).toBe(copyX+8);
    assert.equal(await left('rules'),rules.x);
    await page.keyboard.press('Control+z');
    await expect.poll(() => left(id)).toBe(copyX);
    await page.keyboard.press('Control+z');
    await expect(sourceCopy).toHaveCount(0);
    await expect(block('rules')).toBeFocused();
    await page.keyboard.press('Control+Shift+z');
    await expect(block(id)).toBeFocused();
    await page.keyboard.press('Control+z');

    // The same block ID also exists in the outer graph. Only the child copy receives the chosen text.
    await button('목록으로 편집').press('Enter');
    await block('rules').press('Enter');
    await expect(source).toHaveValue(applied);
    await source.fill(edited);
    await button('블록 복제').press('Enter');
    await expect(choice).toBeVisible();
    const folder = process.env.STUDIO_SCREENSHOTS;
    if (folder) {
      mkdirSync(folder,{recursive:true});
      await page.screenshot({path:join(folder,'source-copy-choice-'+width+'.png')});
    }
    await page.keyboard.press('Escape');
    await expect(button('블록 복제')).toBeFocused();
    await expect(sourceCopy).toHaveCount(0);
    await expect(source).toHaveValue(edited);
    for (const [name,content] of [['편집 중인 원문으로 복제',edited],['마지막으로 적용한 원문으로 복제',applied]]) {
      await button('블록 복제').press('Enter');
      await choice.getByRole('button',{name,exact:true}).press('Enter');
      await expect(sourceCopy).toBeFocused();
      await expect(sourceCopy).toBeInViewport();
      const copy = await sourceCopy.getAttribute('data-canvas-block');
      await expect.poll(async () => (await child()).nodes.find(n => n.id === copy)?.config.content).toBe(content);
      assert.equal((await child()).nodes.find(n=>n.id==='rules')!.config.content,applied);
      assert.equal((await saved()).nodes.find(n=>n.id==='rules')!.config.content,'상위 설계의 원문');
      await page.keyboard.press('Control+z');
      await expect(block('rules')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(source).toHaveValue(edited);
    }

    await expect.poll(async () => (await child()).nodes.length).toBe(1);
    const empty = await api(ctx,'project.create',{title:'새 블록 위치',graph:{nodes:[],edges:[]}});
    const emptyPage = await ctx.newPage();
    emptyPage.on('pageerror',error => errors.push(error.message));
    await emptyPage.goto('/?edit='+empty.id);
    const addFirst = emptyPage.getByRole('button',{name:'블록 선택',exact:true});
    await addFirst.press('Enter');
    await emptyPage.getByRole('button',{name:'사용자 입력 추가',exact:true}).press('Enter');
    await expect(emptyPage.getByRole('tab',{name:'속성',exact:true})).toBeFocused();
    await emptyPage.keyboard.press('Escape');
    const added = emptyPage.locator('[data-canvas-block]');
    await expect(added).toBeFocused();
    const addedId = (await added.getAttribute('data-canvas-block'))!;
    await emptyPage.keyboard.press('Control+z');
    await expect(addFirst).toBeFocused();
    await emptyPage.keyboard.press('Control+Shift+z');
    await expect(added).toHaveAttribute('data-canvas-block',addedId);
    await expect(added).toBeFocused();
    assert.deepEqual(errors,[]);
  } finally { await ctx.close(); }
}
try {
  for (const width of [1440,390]) await exercise(width);
  console.log('PASS desktop/mobile placed copies, add and copy undo/redo focus, nested draft copy choices and keyboard list return.');
} finally { await browser.close(); }
