import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium, expect, type BrowserContext, type Locator, type Page} from '@playwright/test';
import {connectionOptions, connectBlocks, createBlock, type Graph} from '../src/domain';
import {groupKey} from '../src/ui/editor/graph';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});

async function api(context:BrowserContext, action:string, data:object = {}) {
  const response = await context.request.post('/api/studio',{data:{action,data}});
  const result = await response.json();
  assert.ok(response.ok(),result.error);
  return result.data;
}
async function activate(page:Page, button:Locator) {
  await expect(button).toBeVisible();
  for (let count=0; count<160; count++) {
    if (await button.evaluate(el => el === document.activeElement)) {
      await page.keyboard.press('Enter');
      return;
    }
    const backward=await button.evaluate(el => document.activeElement &&
      (document.activeElement.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING));
    await page.keyboard.press(backward?'Shift+Tab':'Tab');
  }
  throw Error('Tab으로 버튼에 도달할 수 없습니다: ' + await button.innerText());
}
function link(graph:Graph, from:string, to:string, out:string) {
  const options = connectionOptions(graph,from,to).filter(o => (o.kind === 'flow' && o.out === out) || (o.kind === 'data' && o.input === 'input'));
  graph.edges.push(...connectBlocks(graph,from,to,options));
}
async function verify(width:number) {
  const context = await browser.newContext({baseURL,viewport:{width,height:width === 390 ? 844 : 900},isMobile:width === 390,hasTouch:width === 390});
  try {
    await registerBrowserAccount(context);
    const graph:Graph={nodes:[
      createBlock('input.user_request',{id:'q',title:'질문',x:20,y:80}),
      createBlock('control.branch',{id:'gate',title:'A인지 검사',x:250,y:80,config:{operator:'equals',expected:'A'}}),
      createBlock('output.answer',{id:'a',title:'A 답변',x:480,y:20}),
      createBlock('output.answer',{id:'b',title:'다른 답변',x:480,y:180}),
    ],edges:[]};
    link(graph,'q','gate','next');
    link(graph,'gate','a','yes');
    link(graph,'gate','b','no');
    const {id} = await api(context,'project.create',{title:'두 가지 답변',graph});
    const saved = async ():Promise<Graph> => (await api(context,'project.open',{id})).graph;
    const original = await saved();
    async function outputs(key:string) {
      const run = await api(context,'run.start',{id,input:'B',mode:'test',requestKey:key});
      const read=() => api(context,'run.get',{runId:run.id});
      await expect.poll(async () => (await read()).state,{timeout:20000}).toBe('completed');
      const {events}:{events:{kind:string;title:string}[]} = await read();
      return events.filter(e=>e.kind==='result' && e.title.endsWith('답변')).map(e=>e.title).sort();
    }
    assert.deepEqual(await outputs('start'),['다른 답변']);
    const page=await context.newPage();
    await page.goto('/?edit='+id);
    const wire = (from:string,to:string) => page.locator('[data-canvas-wire="'+groupKey(from,to).replaceAll('"','\\"')+'"]');
    const panel=page.locator('.ws-inspector');
    const add=panel.getByRole('button',{name:'전달 항목 추가',exact:true});
    const edit=panel.getByRole('button',{name:'실행 조건 변경',exact:true});
    const transfer=page.getByRole('dialog',{name:'전달 항목 추가',exact:true});
    const apply=transfer.getByRole('button',{name:'연결 적용'});
    const conditions=page.getByRole('dialog',{name:'실행 조건 변경',exact:true});
    await wire('gate','a').press('Enter');
    await expect(panel.getByRole('tab',{name:'속성',exact:true})).toBeFocused();
    await activate(page,add);
    await expect(transfer).toBeVisible();
    await expect(transfer.getByRole('checkbox')).toHaveCount(0);
    await expect(apply).toBeDisabled();
    await page.keyboard.press('Escape');
    assert.deepEqual((await saved()).edges,original.edges);

    await activate(page,panel.getByRole('button',{name:/입력값.*데이터 연결 삭제/}));
    await expect(panel.getByRole('textbox',{name:/맞음.*선 설명/})).toBeFocused();
    await activate(page,add);
    const value=transfer.getByRole('checkbox',{name:'결과 → 입력값'});
    await expect(transfer.getByRole('combobox',{name:'도착 블록'})).toBeDisabled();
    await expect(transfer.getByRole('checkbox')).toHaveCount(1);
    await expect(value).not.toBeChecked();
    await expect(apply).toBeDisabled();
    await value.press('Space');
    await activate(page,apply);
    await expect(transfer).toHaveCount(0);
    await page.keyboard.press('Control+s');
    const oldId=original.edges.find(e=>e.kind==='data' && e.to==='a')!.id;
    await expect.poll(async () => (await saved()).edges.some(e=>e.kind==='data' && e.to==='a' && e.id!==oldId)).toBe(true);
    const beforeFlowEdit=(await saved()).edges;
    assert.ok(beforeFlowEdit.some(e=>e.kind==='data' && e.to==='a'));
    assert.deepEqual(beforeFlowEdit.filter(e=>e.kind==='flow'),original.edges.filter(e=>e.kind==='flow'));
    assert.deepEqual(await outputs('after-transfer'),['다른 답변']);

    await activate(page,edit);
    const yes=conditions.getByRole('checkbox',{name:'맞음 → 실행 시작'});
    const no=conditions.getByRole('checkbox',{name:'그 밖의 경우 → 실행 시작'});
    const applyConditions=conditions.getByRole('button',{name:'실행 조건 적용'});
    await expect(yes).toBeChecked();
    await expect(no).not.toBeChecked();
    await expect(applyConditions).toBeDisabled();
    await no.press('Space');
    await page.keyboard.press('Escape');
    assert.deepEqual((await saved()).edges,beforeFlowEdit);
    await activate(page,edit);
    await expect(no).not.toBeChecked();
    await no.press('Space');
    await activate(page,applyConditions);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await saved()).edges.length).toBe(beforeFlowEdit.length+1);
    const afterFlowEdit=(await saved()).edges;
    assert.deepEqual(afterFlowEdit.filter(e=>beforeFlowEdit.some(old=>old.id===e.id)),beforeFlowEdit);
    assert.deepEqual(await outputs('after-route'),['A 답변','다른 답변']);
    await activate(page,edit);
    await yes.press('Space');
    await activate(page,applyConditions);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await saved()).edges).toEqual(afterFlowEdit.filter(e=>!(e.from==='gate' && e.to==='a' && e.out==='yes')));

    const refs:Graph={nodes:[
      createBlock('resource.context',{id:'rules',title:'이용규정',x:20,y:80,config:{content:'도서관 안내'}}),
      createBlock('agent.task',{id:'agent',title:'안내',x:250,y:80}),
    ],edges:[]};
    refs.edges=connectBlocks(refs,'rules','agent',connectionOptions(refs,'rules','agent').filter(o=>o.kind==='data' && o.input==='question'));
    const refProject=await api(context,'project.create',{title:'자료 연결',graph:refs});
    await page.goto('/?edit='+refProject.id);
    await wire('rules','agent').press('Enter');
    await expect(panel.getByRole('tab',{name:'속성',exact:true})).toBeFocused();
    await activate(page,add);
    const refOption=transfer.getByRole('group',{name:'참조'}).getByRole('checkbox');
    await refOption.press('Space');
    await activate(page,apply);
    await expect(panel.getByRole('button',{name:/참고 자료.*참조 연결 삭제/})).toBeVisible();
    await activate(page,panel.getByRole('button',{name:/원래 질문.*데이터 연결 삭제/}));
    const last=panel.getByRole('button',{name:/참고 자료.*참조 연결 삭제/});
    await expect(last).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(wire('rules','agent')).toHaveCount(0);
    const destination=page.locator('[data-canvas-block="agent"]');
    await expect(destination).toBeFocused();
    await expect(destination).toHaveAttribute('aria-pressed','true');
    await page.keyboard.press('Control+z');
    await expect(wire('rules','agent')).toBeFocused();

    const categories:Graph={nodes:[
      createBlock('ai.classify',{id:'classify',x:20,y:80,config:{categories:['규정','예약']}}),
      createBlock('output.answer',{id:'answer',x:250,y:80}),
    ],edges:[]};
    categories.edges=connectBlocks(categories,'classify','answer',[{kind:'flow',out:'category:규정',input:'in'}]);
    const lesson=await api(context,'project.create',{title:'분류 경로 선택',graph:categories});
    await page.goto('/?edit='+lesson.id);
    await wire('classify','answer').press('Enter');
    await expect(panel.getByRole('tab',{name:'속성',exact:true})).toBeFocused();
    await activate(page,edit);
    await conditions.getByRole('checkbox',{name:'규정 → 실행 시작'}).press('Space');
    await conditions.getByRole('checkbox',{name:'예약 → 실행 시작'}).press('Space');
    await activate(page,applyConditions);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await api(context,'project.open',{id:lesson.id})).graph.edges.map((e:Graph['edges'][number])=>e.out)).toEqual(['category:예약']);
    await activate(page,edit);
    await conditions.getByRole('checkbox',{name:'예약 → 실행 시작'}).press('Space');
    await activate(page,applyConditions);
    await expect(wire('classify','answer')).toHaveCount(0);
    await expect(page.locator('[data-canvas-block="answer"]')).toBeFocused();
  } finally { await context.close(); }
}
try {
  await verify(1440);
  await verify(390);
  console.log('PASS desktop/mobile explicit data and reference mappings, separate branch editing, worker results and deletion focus.');
} finally { await browser.close(); }
