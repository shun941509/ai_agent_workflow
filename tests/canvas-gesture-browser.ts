import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium, expect, type BrowserContext, type Locator, type Page} from '@playwright/test';
import {catalog, createBlock, portsFor, type Graph} from '../src/domain';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소가 필요합니다.');
const installed = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(installed) ? installed : undefined)});

async function api(context:BrowserContext, action:string, data = {}) {
  const response = await context.request.post('/api/studio',{data:{action,data}});
  const result = await response.json();
  assert.ok(response.ok(),action + ' ' + (result.error ?? ''));
  return result.data;
}
async function center(target:Locator) {
  const box = await target.boundingBox();
  assert.ok(box);
  return {x:box.x + box.width / 2, y:box.y + box.height / 2};
}

async function tapDirectTarget(page:Page, target:Locator, dx = 10, dy = 0) {
  await target.scrollIntoViewIfNeeded();
  // Screen coordinates include the diagram's fit transform. Test the touch surface,
  // including points away from the visible center that could land on a neighbour.
  const hit = await target.evaluate(el => {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const offsets = [[0, 0], [-10, 0], [10, 0], [0, -10], [0, 10]];
    const misses = offsets.filter(([dx, dy]) => !el.contains(document.elementFromPoint(x + dx, y + dy)));
    return {x, y, width:box.width, height:box.height, name:el.getAttribute('aria-label'), misses};
  });
  assert.ok(Math.min(hit.width, hit.height) >= 23.99, hit.name + ' ' + hit.width + ' × ' + hit.height);
  assert.deepEqual(hit.misses, [], hit.name + ' 터치 영역에 겹치거나 가려진 지점이 있습니다.');
  await page.touchscreen.tap(hit.x + dx, hit.y + dy);
}

async function expectFullTitle(block:Locator, title:string) {
  const label = block.locator('.ws-node-copy strong');
  await expect(label).toBeVisible();
  await expect(label).toHaveText(title);
  const overflow = await label.evaluate(el => {
    const text = el.getBoundingClientRect();
    // Compact labels can use the visible card up to the socket, even where the
    // output's larger invisible hit area starts. Respect each actual CSS clip.
    const canvas = el.closest('.ws-canvas')!.getBoundingClientRect();
    const clip = {left:canvas.left, right:canvas.right, top:canvas.top, bottom:canvas.bottom};
    for (let parent:Element|null = el; parent && !parent.classList.contains('ws-canvas'); parent = parent.parentElement) {
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
      if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, box.left);
        clip.right = Math.min(clip.right, box.right);
      }
      if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, box.top);
        clip.bottom = Math.min(clip.bottom, box.bottom);
      }
    }
    // Lay out an unclamped copy at the exact same width, font and fit scale.
    const full = el.cloneNode(true) as HTMLElement;
    Object.assign(full.style, {position:'absolute', visibility:'hidden', display:'block',
      width:getComputedStyle(el).width, height:'auto', maxHeight:'none', webkitLineClamp:'unset'});
    el.after(full);
    try {
      const range = document.createRange();
      range.selectNodeContents(full);
      return Math.max(full.getBoundingClientRect().height - text.height,
        ...Array.from(range.getClientRects(), line => line.width - text.width),
        clip.left - text.left, text.right - clip.right, clip.top - text.top, text.bottom - clip.bottom);
    } finally {
      full.remove();
    }
  });
  assert.ok(overflow <= 0.5, title + ' 제목이 전체 보기에서 ' + overflow.toFixed(1) + 'px 잘렸습니다.');
}

async function verifyOverviewTouch() {
  const context = await browser.newContext({baseURL, viewport:{width:320, height:568}, hasTouch:true, isMobile:true});
  try {
    await registerBrowserAccount(context);
    const project = await api(context, 'project.create', {lesson:'beginner'});
    const graph:Graph = project.graph;
    const page = await context.newPage();
    await page.goto('/?edit=' + project.id);
    const canvas = page.locator('.ws-canvas');
    const overview = page.getByRole('heading', {name:'연결도 전체 보기'});
    const inspector = page.getByRole('dialog', {name:'속성 패널'});
    const connection = page.getByRole('dialog', {name:'연결 추가'});
    const openOverview = async () => {
      if (!await overview.isVisible()) await page.getByRole('button', {name:'전체 보기', exact:true}).tap();
      await expect(overview).toBeVisible();
    };
    const closeConnectionFrom = async (title:string) => {
      await expect(connection).toBeVisible();
      await expect(connection.getByText('출발 블록 · ' + title, {exact:true})).toBeVisible();
      await connection.getByRole('button', {name:'닫기', exact:true}).tap();
    };
    for (const node of graph.nodes) {
      await openOverview();
      const block = canvas.getByRole('button', {name:node.title + ' 블록 속성', exact:true});
      await expectFullTitle(block, node.title);
      await tapDirectTarget(page, block);
      await expect(inspector).toBeVisible();
      await expect(inspector.getByLabel('이름', {exact:true})).toHaveValue(node.title);
      await inspector.getByRole('button', {name:'속성 닫기'}).tap();
      if (portsFor(node).outputs.length === 0) continue;
      await openOverview();
      const port = canvas.getByRole('button', {name:node.title + '에서 연결 추가', exact:true});
      await tapDirectTarget(page, port);
      await closeConnectionFrom(node.title);
      const dot = await center(port.locator('.ws-output-dot'));
      assert.ok(await port.evaluate((el, point) => el.contains(document.elementFromPoint(point.x, point.y)), dot),
        node.title + ' 연결점의 보이는 중심에 다른 조작이 겹쳤습니다.');
      await page.touchscreen.tap(dot.x, dot.y);
      await closeConnectionFrom(node.title);
    }
    if (await overview.isVisible()) await page.getByRole('button', {name:'편집기로 돌아가기'}).tap();
    await expect(page.getByRole('button', {name:'실행 취소', exact:true})).toBeDisabled();
    const saved = await api(context, 'project.open', {id:project.id});
    assert.deepEqual(saved.graph, graph);
    assert.equal(saved.revision, project.revision);
    console.log('PASS 320px 전체 보기에서 블록 제목 전체, 블록과 출력점의 실제 터치 영역과 점 중심, 정확한 속성과 연결 대화상자, 저장된 설계를 확인했습니다.');
  } finally {
    await context.close();
  }
}
async function verifyDenseOverviewTouch() {
  const context = await browser.newContext({baseURL, viewport:{width:320,height:740}, isMobile:true, hasTouch:true});
  try {
    await registerBrowserAccount(context);
    const graph:Graph = {nodes:catalog.map((def, i) => createBlock(def.type, {
      id:'node-'+i, title:def.name, x:40 + (i % 5) * 210, y:40 + Math.floor(i / 5) * 120,
    })), edges:[]};
    const project = await api(context,'project.create',{title:'밀집 도면', graph});
    const page = await context.newPage();
    const inspector = page.getByRole('dialog',{name:'속성 패널'});
    const connection = page.getByRole('dialog',{name:'연결 추가'});
    const overview = page.getByRole('heading',{name:'연결도 전체 보기'});
    const openOverview = async () => {
      if (!await overview.isVisible()) await page.getByRole('button',{name:'전체 보기',exact:true}).tap();
      await expect(overview).toBeVisible();
    };
    await page.goto('/?edit='+project.id);
    await page.locator('.ws-canvas').waitFor();
    await openOverview();
    const world = page.locator('.ws-canvas .ws-world');
    await expect(world.locator('.ws-node-body')).toHaveCount(graph.nodes.length);
    for (const node of graph.nodes) {
      await expectFullTitle(world.getByRole('button',{name:node.title+' 블록 속성',exact:true}),node.title);
    }
    const narrowLabels = [
      'input.form', 'agent.select_candidate', 'agent.delegate', 'agent.create_dynamic',
      'agent.handoff', 'resource.context', 'knowledge.manage', 'workflow.tool',
    ];
    for (const type of narrowLabels) {
      const node = graph.nodes.find(n => n.type === type)!;
      const block = world.getByRole('button',{name:node.title+' 블록 속성',exact:true});
      const label = block.locator('.ws-node-copy strong');
      await openOverview();
      const ink = await label.evaluate(el => {
        const text = el.firstChild;
        if (!(text instanceof Text)) throw Error('블록 제목에 표시할 글자가 없습니다.');
        const range = document.createRange();
        const characters = [];
        for (let index = 0; index < text.length; index++) {
          const char = text.data[index];
          if (!char.trim()) continue;
          range.setStart(text,index);
          range.setEnd(text,index+1);
          const bounds = range.getBoundingClientRect();
          const x = bounds.left+bounds.width/2, y = bounds.top+bounds.height/2;
          characters.push({char,x,y,body:document.elementFromPoint(x,y)?.closest('button') === el.closest('button')});
        }
        return characters;
      });
      assert.ok(ink.length > 0, node.title);
      assert.deepEqual(ink.filter(item => !item.body),[],node.title+' 글자 위에 다른 조작이 겹칩니다.');
      const printed = await center(label);
      // These two names previously painted their last character over the output button.
      const point = type === 'agent.delegate' || type === 'workflow.tool' ? ink[ink.length-1] : printed;
      await page.touchscreen.tap(point.x,point.y);
      await expect(inspector.getByLabel('이름',{exact:true})).toHaveValue(node.title);
      await inspector.getByRole('button',{name:'속성 닫기'}).tap();
      await openOverview();
      await block.focus();
      await page.keyboard.press('Enter');
      await expect(inspector.getByLabel('이름',{exact:true})).toHaveValue(node.title);
      await page.keyboard.press('Escape');
      await expect(inspector).toBeHidden();
    }
    for (const type of ['ai.classify','control.branch','workflow.tool','agent.create_dynamic']) {
      const node = graph.nodes.find(item => item.type === type)!;
      const body = type === 'ai.classify' || type === 'control.branch';
      if (await inspector.isVisible()) await inspector.getByRole('button',{name:'속성 닫기'}).tap();
      await openOverview();
      const control = page.locator('.ws-canvas').getByRole('button',{
        name:node.title+(body?' 블록 속성':'에서 연결 추가'),exact:true,
      });
      await tapDirectTarget(page,control,body ? 10 : -10,10);
      if (body) {
        await expect(inspector.getByLabel('이름',{exact:true})).toHaveValue(node.title);
        await inspector.getByRole('button',{name:'속성 닫기'}).tap();
      } else {
        await expect(connection).toContainText('출발 블록 · '+node.title);
        await connection.getByRole('button',{name:'닫기',exact:true}).tap();
      }
    }
    await page.setViewportSize({width:320,height:568});
    if (await overview.isVisible()) await page.getByRole('button',{name:'편집기로 돌아가기'}).tap();
    await openOverview();
    // Returning a short screen to fit used to clip these long names.
    for (const node of [graph.nodes.find(n => n.type === 'agent.create_dynamic')!,
      graph.nodes.find(n => n.type === 'workflow.tool')!, graph.nodes[graph.nodes.length-1]]) {
      const body = world.getByRole('button',{name:node.title+' 블록 속성',exact:true});
      await body.scrollIntoViewIfNeeded();
      await expectFullTitle(body,node.title);
    }
    const reader = page.getByRole('region',{name:'연결도 블록 탐색'});
    const choice = reader.getByLabel('살펴볼 블록');
    await reader.getByRole('button',{name:'다음 블록'}).focus();
    await page.keyboard.press('Tab');
    await expect(choice).toBeFocused();
    await page.keyboard.press('End');
    await expect(choice).toHaveValue(graph.nodes[graph.nodes.length-1].id);
    await page.keyboard.press('Tab');
    await expect(reader.getByRole('button',{name:'속성 열기'})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(inspector.getByLabel('이름',{exact:true})).toHaveValue(graph.nodes[graph.nodes.length-1].title);
    await page.keyboard.press('Escape');
    const saved = await api(context,'project.open',{id:project.id});
    assert.deepEqual(saved.graph,project.graph);
    assert.equal(saved.revision,project.revision);
    console.log('PASS 320px 밀집 도면 41개 제목 전체 표시, 좁았던 8개 카드의 도면 내 터치·키보드 속성 열기, 연결점·원본 배치 보존.');
  } finally { await context.close(); }
}

async function verify(width:number) {
  const mobile = width < 1000;
  const context = await browser.newContext({baseURL,viewport:{width,height:mobile ? 844 : 900},hasTouch:mobile,isMobile:mobile});
  try {
    await registerBrowserAccount(context);
    const graph = {nodes:[createBlock('input.user_request',{id:'ask',x:20,y:20}),createBlock('output.answer',{id:'answer',x:20,y:200})],edges:[]};
    const project = await api(context,'project.create',{title:'캔버스 조작 시험',graph});
    const page = await context.newPage();
    await page.goto('/?edit=' + project.id);
    await page.getByRole('button',{name:'캔버스로 보기',exact:true}).click();
    const block = page.locator('[data-canvas-block="ask"]');
    const output = page.locator('[data-workflow-node="ask"] .ws-port-out');
    const target = page.locator('[data-canvas-block="answer"]');
    await expect(output).toBeVisible();
    const undo = page.getByRole('button',{name:'실행 취소',exact:true});
    const state = () => api(context,'project.open',{id:project.id});
    const unchanged = async () => {
      await expect(undo).toBeDisabled();
      await expect(page.locator('.ws-save-badge')).toHaveText('저장됨');
      await expect(page.locator('dialog:modal')).toHaveCount(0);
      const saved = await state();
      assert.deepEqual(saved.graph,project.graph);
      assert.equal(saved.revision,project.revision);
    };
    if (mobile) {
      const cdp = await context.newCDPSession(page);
      const camera = () => page.locator('.ws-world').evaluate(el => {
        const m = new DOMMatrix(getComputedStyle(el).transform);
        return {zoom:m.a, x:m.e, y:m.f};
      });
      for (const first of [block,output]) {
        const old = await camera();
        const a = {...await center(first),id:1};
        const b = {x:a.x - 22,y:a.y + 55,id:2};
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,y:a.y + 6}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,y:a.y + 6},b]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,y:a.y - 14},{...b,y:b.y + 9}]});
        await expect.poll(async () => (await camera()).zoom).toBeGreaterThan(old.zoom);
        const pinched = await camera();
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,x:a.x - 18,y:a.y - 14},{...b,x:b.x - 18,y:b.y + 9}]});
        await expect.poll(async () => Math.round((await camera()).x - pinched.x)).toBe(-18);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await unchanged();
        await expect(page.locator('.ws-editor')).toHaveAttribute('data-pane','canvas');
        await page.getByRole('button',{name:'캔버스에 맞추기'}).click();
      }
      const start = {...await center(block),id:1};
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...start,y:start.y + 22}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await expect(undo).toBeEnabled();
      await page.keyboard.press('Control+s');
      await expect.poll(async () => (await state()).graph.nodes[0].y).toBeGreaterThan(20);
      await block.tap();
      if (width === 390) await expect(page.getByRole('dialog',{name:'속성 패널'})).toBeVisible();
    } else {
      for (const dragSource of [block, output]) {
        const from = await center(dragSource), to = await center(target);
        await page.mouse.move(from.x,from.y);
        await page.mouse.down();
        await page.mouse.move(to.x,to.y,{steps:5});
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await unchanged();
      }
      await output.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog',{name:'연결 추가'})).toBeVisible();
      await page.keyboard.press('Escape');
      const from = await center(output), to = await center(target);
      await page.mouse.move(from.x,from.y);
      await page.mouse.down();
      await page.mouse.move(to.x,to.y,{steps:5});
      await page.mouse.up();
      await page.keyboard.press('Control+s');
      await expect.poll(async () => (await state()).graph.edges.length).toBeGreaterThan(0);
    }
  } finally { await context.close(); }
}
try {
  await verifyOverviewTouch();
  await verifyDenseOverviewTouch();
  await verify(390);
  await verify(768);
  await verify(1440);
  console.log('PASS two-finger pinch and pan preserve the saved graph, Escape discards block and wire drags, normal tap and drop work.');
} finally { await browser.close(); }
