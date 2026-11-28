import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createBlock, type Graph } from '../src/domain';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 시험 주소를 지정하세요.');
const installed = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(installed) ? installed : undefined)});

async function api(ctx:BrowserContext, action:string, data:object = {}) {
  const response = await ctx.request.post('/api/studio',{data:{action,data}});
  const result = await response.json();
  assert.ok(response.ok(), result.error);
  return result.data;
}

function midpoint(wire:Locator) {
  return wire.locator('.ws-channel').evaluate(el => {
    const path = el as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength()/2).matrixTransform(path.getScreenCTM()!);
    return {x:point.x, y:point.y};
  });
}

// Compare screen-space bounds with the physical port, including when the camera is zoomed out.
async function openDiagram(page:Page, id:string) {
  await page.goto('/?edit='+id);
  await page.getByRole('button',{name:'캔버스로 보기',exact:true}).click();
}

async function checkPortCue(cue:Locator, port:Locator, incoming:boolean) {
  await expect(cue).toBeVisible();
  await expect(cue).toHaveCSS('pointer-events','none');
  await expect(cue).toHaveCSS('opacity','1');
  const marker = (await cue.boundingBox())!, dot = (await port.boundingBox())!;
  const centerX = dot.x + dot.width/2, centerY = dot.y + dot.height/2;
  const gap = incoming ? centerX-(marker.x+marker.width) : marker.x-centerX;
  assert.ok(gap >= -1 && gap < 22, '방향 화살표가 연결점의 올바른 쪽에 인접해야 합니다.');
  assert.ok(Math.abs(marker.y + marker.height/2 - centerY) < 2, '방향 화살표가 연결점에 맞아야 합니다.');
  assert.ok(marker.width >= 8 && marker.height >= 8, '전체 보기에서도 고정 화살표를 읽을 수 있어야 합니다.');
  return {width:marker.width,height:marker.height};
}

// Select at the actual fit scale, then measure in screen pixels after the trace stops.
async function checkCrowdedOutputs(page:Page, nodeId:string, names:(string|RegExp)[]) {
  const fit = page.getByRole('button',{name:'캔버스에 맞추기',exact:true});
  await fit.click();
  const zoom = page.locator('.ws-zoom-percent');
  const overview = await zoom.innerText();
  assert.ok(parseInt(overview) < 50, '시험 설계의 전체 보기에서 인접한 출력점 간격이 12px 미만이어야 합니다.');
  const block = page.locator(`[data-canvas-block="${nodeId}"]`);
  await block.click();
  await expect(block).toHaveAttribute('aria-pressed','true');
  await expect(zoom).toHaveText(overview);
  const trace = page.locator(`[data-from="${nodeId}"] > .ws-wire-trace`).first();
  await expect(trace).toHaveCSS('opacity','1');
  await expect(trace).toHaveCSS('opacity','0',{timeout:10000});

  const canvas = page.locator('.ws-canvas');
  const rows = canvas.locator('.ws-route-callout');
  await expect(rows.locator('.ws-route-callout-label')).toHaveText(names);
  assert.ok(await rows.evaluateAll(elements => elements.every(row =>
    row.getBoundingClientRect().right <= row.closest('.ws-canvas')!.getBoundingClientRect().right
  )), '처음 선택한 블록 오른쪽에 펼쳐진 경로 이름이 잘렸습니다.');
  await fit.click();
  await expect(zoom).toHaveText(overview);
  await expect(block).toHaveAttribute('aria-pressed','true');
  await expect(rows.locator('[data-direction="outgoing"]')).toHaveCount(names.length);
  await expect(canvas.locator('.ws-route-callout-leader')).toHaveCount(names.length);
  const findings = await canvas.evaluate((canvas, nodeId) => {
    const issues:string[] = [];
    const frame = canvas.getBoundingClientRect();
    const labels = Array.from(canvas.querySelectorAll('.ws-wire-label'), el => el.getBoundingClientRect());
    const card = canvas.querySelector(`[data-workflow-node="${CSS.escape(nodeId)}"]`)!;
    const box = card.getBoundingClientRect();
    const flow = getComputedStyle(canvas.querySelector(`.ws-wire[data-from="${CSS.escape(nodeId)}"] .ws-channel`)!).stroke;
    let previousBottom = -Infinity;
    for (const row of canvas.querySelectorAll<HTMLElement>('.ws-route-callout')) {
      const port = CSS.escape(row.dataset.outputPort!);
      const label = row.querySelector('.ws-route-callout-label')!;
      const name = label.textContent;
      const bounds = row.getBoundingClientRect(), text = label.getBoundingClientRect();
      const arrow = row.querySelector('[data-direction="outgoing"]')!;
      const dot = card.querySelector(`.ws-port-out[data-output-port="${port}"] .ws-output-dot`)!.getBoundingClientRect();
      const lead = canvas.querySelector<SVGGeometryElement>(`.ws-route-callout-leader[data-output-port="${port}"]`)!;
      const start = lead.getPointAtLength(0).matrixTransform(lead.getScreenCTM()!);
      const end = lead.getPointAtLength(lead.getTotalLength()).matrixTransform(lead.getScreenCTM()!);
      if (Math.abs(start.y - (dot.y + dot.height/2)) > 1 || Math.abs(start.x - (dot.x + dot.width/2)) > dot.width/2 + 2)
        issues.push(name + ' 인출선이 실제 출력점에서 시작하지 않습니다.');
      if (Math.abs(end.y - (bounds.y + bounds.height/2)) > 2 || Math.abs(end.x - bounds.left) > 3)
        issues.push(name + ' 인출선 끝이 해당 행에 닿지 않습니다.');
      if (bounds.left < box.right || bounds.right > frame.right || bounds.top < frame.top || bounds.bottom > frame.bottom)
        issues.push(name + ' 경로 행이 블록 오른쪽에서 벗어나거나 잘렸습니다. ' + JSON.stringify({
          row:bounds.toJSON(), canvas:frame.toJSON(), block:box.toJSON(),
        }));
      const pairs = [[text,arrow.getBoundingClientRect()], ...labels.map(caption => [caption,bounds])];
      if (bounds.top < previousBottom || pairs.some(([a,b]) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom))
        issues.push(name + ' 경로 이름과 화살표 또는 다른 경로 표시가 겹칩니다.');
      previousBottom = bounds.bottom;
      if (text.height < 10 || label.scrollWidth > label.clientWidth + 1)
        issues.push(name + ' 경로 이름이 너무 작거나 글자가 잘렸습니다.');
      if (getComputedStyle(arrow.querySelector('path')!).fill !== flow || getComputedStyle(lead).stroke !== flow)
        issues.push(name + ' 경로 표시 색상이 실행선과 다릅니다.');
      const rowHit = document.elementFromPoint(bounds.x + bounds.width/2, bounds.y + bounds.height/2);
      if (!row.matches('button') || !rowHit || !row.contains(rowHit) || getComputedStyle(lead).pointerEvents !== 'none')
        issues.push(name + ' 경로 행을 직접 선택할 수 없거나 인출선이 캔버스 조작을 가립니다.');
    }
    return issues;
  },nodeId);
  assert.deepEqual(findings, []);
  if (process.env.STUDIO_SCREENSHOTS) {
    mkdirSync(process.env.STUDIO_SCREENSHOTS,{recursive:true});
    await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,nodeId+'-routes-desktop.png')});
  }
}

function conditionExample():Graph {
  return {
    nodes:[
      createBlock('input.user_request',{id:'request',title:'신청 입력',x:0,y:80}),
      createBlock('control.branch',{id:'condition',title:'신청 확인',x:600,y:80,
        config:{yesLabel:'접수됨',noLabel:'다시 확인',operator:'equals',expected:'접수'}}),
      createBlock('output.answer',{id:'accepted',title:'접수 안내',x:1480,y:0}),
      createBlock('output.answer',{id:'retry',title:'재확인 안내',x:1480,y:200}),
    ],
    edges:[
      {id:'start',from:'request',out:'next',to:'condition',kind:'flow',input:'in'},
      {id:'request-value',from:'request',out:'value',to:'condition',kind:'data',input:'input'},
      {id:'yes',from:'condition',out:'yes',to:'accepted',kind:'flow',input:'in'},
      {id:'no',from:'condition',out:'no',to:'retry',kind:'flow',input:'in'},
    ],
  };
}

async function checkClassifierPathSelection(ctx:BrowserContext, page:Page) {
  const sharedPrefix = '시립도서관 통합 서비스에서 접수한 ';
  const sharedSuffix = ' 요청에 대한 처리 상태 확인 및 결과 안내';
  const routes = [
    {name:sharedPrefix+'대출 연장'+sharedSuffix, word:'연장', target:'loans'},
    {name:sharedPrefix+'예약 변경'+sharedSuffix, word:'변경', target:'reserve'},
    {name:sharedPrefix+'회원 갱신'+sharedSuffix, word:'갱신', target:'member'},
    {name:sharedPrefix+'대출 재신청'+sharedSuffix, word:'재신청', target:'loans'},
    {name:sharedPrefix+'자료 이용 건의 승인 신청', word:'신청', target:'approve'},
    {name:sharedPrefix+'자료 이용 건의 승인 취소', word:'취소', target:'cancel'},
    {name:'분실 신고', word:'분실 신고', target:'help'},
    {name:'자료 복사', word:'자료 복사', target:'help'},
    {name:'미분류', word:'미분류', target:'general'},
  ];
  const titles = new Map([
    ['member','회원 갱신'], ['cancel','승인 취소'], ['loans','대출 상담'], ['general','일반 문의'],
    ['approve','승인 접수'], ['reserve','예약 변경'], ['help','자료 상담'],
  ]);
  const graph:Graph = {
    nodes:[
      createBlock('input.user_request',{id:'ask',title:'도서관 문의',x:0,y:280}),
      createBlock('ai.classify',{id:'classifier',title:'도서관 업무 분류',x:380,y:220,
        config:{categories:routes.slice(0,-1).map(route=>route.name)}}),
      ...Array.from(titles,([id,title],index) => createBlock('output.answer',{id,title,x:1480,y:index*115})),
    ],
    edges:[
      {id:'start',kind:'flow',from:'ask',out:'next',to:'classifier',input:'in'},
      {id:'question',kind:'data',from:'ask',out:'value',to:'classifier',input:'input'},
      ...routes.map(({name,target},index) => ({id:'route-'+index,kind:'flow' as const,from:'classifier',
        out:index===routes.length-1?'other':'category:'+name,to:target,input:'in'})),
    ],
  };
  const project = await api(ctx,'project.create',{graph,title:'도서관 문의 경로'});
  await openDiagram(page,project.id);
  await checkCrowdedOutputs(page,'classifier',routes.map(route=>new RegExp(route.word)));
  const canvas = page.locator('.ws-canvas');
  const rows = canvas.locator('button.ws-route-callout');
  const overview = await canvas.locator('.ws-zoom-percent').innerText();
  const labels = await rows.locator('.ws-route-callout-label').allTextContents();
  assert.equal(new Set(labels).size,routes.length,'가운데만 다른 범주도 서로 다른 이름으로 표시해야 합니다.');
  const captionFor = (target:string) => canvas.locator(`.ws-wire[data-from="classifier"][data-to="${target}"] .ws-wire-label`);
  for (const {word,target} of routes) await expect(captionFor(target)).toContainText(word);
  await canvas.locator('[data-canvas-block="classifier"]').focus();
  await page.keyboard.press('Tab');
  await expect(rows.first()).toBeFocused();
  for (const [index,{name,word,target}] of routes.entries()) {
    const row = rows.nth(index);
    await expect(row).toHaveAccessibleName(name+' → '+titles.get(target));
    const portId = await row.getAttribute('data-output-port');
    if (index === 1 || index === 3) {
      await rows.nth(index+1).focus();
      await page.keyboard.press('Shift+Tab');
      await expect(row).toBeFocused();
      await page.keyboard.press(index===1 ? 'Enter' : 'Space');
    } else await row.click();
    await expect(row).toHaveAttribute('aria-pressed','true');
    const trace = canvas.locator('.ws-wire-trace');
    const rim = canvas.locator('.ws-wire-trace-rim');
    await expect(trace).toHaveCount(1);
    if (index === 3) {
      // Observe one real, uninterrupted animation in each viewport.
      await expect(trace).toHaveCSS('opacity','1');
    } else {
      await canvas.locator('.ws-wire-trace,.ws-wire-trace-rim').evaluateAll(paths => {
        for (const path of paths) for (const animation of path.getAnimations()) animation.finish();
      });
    }
    await expect(trace).toHaveCSS('opacity','0',{timeout:10000});
    await expect(rim).toHaveCSS('opacity','0');
    await expect(captionFor(target)).toContainText(word);
    await expect(canvas.locator('.ws-route-callout[aria-pressed="true"]')).toHaveCount(1);
    await expect(canvas.locator('.ws-route-callout-leader[data-route-active="true"]')).toHaveAttribute('data-output-port',portId!);
    const port = canvas.locator('.ws-port-out[data-route-active="true"]');
    await expect(port).toHaveAttribute('data-output-port',portId!);
    const destination = canvas.locator('.ws-node[data-route-target="true"]');
    await expect(destination).toHaveAttribute('data-workflow-node',target);
    const detail = page.locator('.ws-route-detail');
    await expect(detail.locator('.ws-route-detail-name')).toHaveText(name);
    await expect(detail.getByRole('button',{name:titles.get(target)+' 목적지 보기',exact:true})).toBeVisible();
    const highlighted = canvas.locator(`g[data-from="classifier"][data-to="${target}"] > .ws-route-traced-path`);
    await expect(highlighted).toHaveAttribute('data-output-port',portId!);
    await expect(canvas.locator('.ws-route-traced-path')).toHaveCount(1);
    const stroke = await highlighted.evaluate(el => {
      const path = el as SVGPathElement, screen = path.getScreenCTM()!;
      const style = getComputedStyle(path);
      const endpoints = [0,path.getTotalLength()].map(length => {
        const p = path.getPointAtLength(length).matrixTransform(screen);
        return {x:p.x,y:p.y};
      });
      return {endpoints, vectorEffect:style.vectorEffect, width:parseFloat(style.strokeWidth)*Math.hypot(screen.a,screen.b)};
    });
    assert.equal(stroke.vectorEffect,'none');
    assert.ok(Math.abs(stroke.width-3) < .2, name+' 선택선이 전체 보기에서 화면상 3px를 유지해야 합니다.');
    const dots = await Promise.all([port.locator('.ws-output-dot').boundingBox(),destination.locator('.ws-port-in').boundingBox()]);
    dots.forEach((dot,i) => {
      assert.ok(dot && Math.hypot(stroke.endpoints[i].x-dot.x-dot.width/2,stroke.endpoints[i].y-dot.y-dot.height/2)<2,
        name+' 강조선이 해당 물리적 출력점과 목적지 입력점 사이를 이어야 합니다.');
    });
    await expect(canvas.locator('.ws-wire[data-from="classifier"][data-route-muted="true"]')).toHaveCount(titles.size-1);
    await expect(canvas.locator('.ws-zoom-percent')).toHaveText(overview);
    await expect(highlighted).toBeVisible();
    await assertUncoveredTraces(canvas);
    if (index === 3 && process.env.STUDIO_SCREENSHOTS) {
      await page.screenshot({
        path:join(process.env.STUDIO_SCREENSHOTS,'traced-desktop.png'),
      });
    }
  }
  await rows.last().press('Escape');
  await expect(page.locator('.ws-route-traced-path,.ws-route-detail')).toHaveCount(0);
  await expect(canvas.locator('.ws-route-callout[aria-pressed="true"]')).toHaveCount(0);
  await expect(rows.last()).toBeFocused();
  await rows.last().press('Tab');
  const firstPort = canvas.locator('[data-workflow-node="classifier"] .ws-port-out').first();
  await expect(firstPort).toBeFocused();
  await firstPort.press('Shift+Tab');
  await expect(rows.last()).toBeFocused();
  await rows.last().press('Enter');
  await expect(rows.last()).toHaveAttribute('aria-pressed','true');
  await rows.last().press('Enter');
  await expect(rows.last()).toHaveAttribute('aria-pressed','false');

  // One physical exit may also lead to two different receiving blocks.
  graph.edges.push({id:'fallback-help',kind:'flow',from:'classifier',out:'other',to:'help',input:'in'});
  const fanout = await api(ctx,'project.create',{graph,title:'문의 분류의 복수 목적지'});
  await openDiagram(page,fanout.id);
  await page.getByRole('button',{name:'캔버스에 맞추기',exact:true}).click();
  const classifier = canvas.locator('[data-canvas-block="classifier"]');
  await classifier.click();
  await rows.last().click();
  await expect(canvas.locator('.ws-route-traced-path[data-output-port="other"]')).toHaveCount(2);
  assert.deepEqual(await canvas.locator('.ws-node[data-route-target="true"]').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('data-workflow-node')).sort()), ['general','help']);
  for (const title of ['자료 상담','일반 문의']) {
    await expect(page.getByRole('button',{name:title+' 목적지 보기',exact:true})).toBeVisible();
  }
}

// Measure the painted SVG stroke in screen space, including curved joins and the selected row itself.
async function assertUncoveredTraces(canvas:Locator) {
  const overlaps = await canvas.evaluate(canvas => {
    const rows = Array.from(canvas.querySelectorAll<HTMLButtonElement>('.ws-route-callout'), row => ({
      name:row.textContent, box:row.getBoundingClientRect(),
    }));
    const issues:string[] = [];
    for (const path of canvas.querySelectorAll<SVGPathElement>('.ws-route-traced-path')) {
      const matrix = path.getScreenCTM()!;
      const scale = Math.hypot(matrix.a, matrix.b);
      const radius = parseFloat(getComputedStyle(path).strokeWidth) * scale / 2;
      const length = path.getTotalLength();
      const samples = Math.max(1, Math.ceil(length * scale / .75));
      for (let i = 0; i <= samples; i++) {
        const p = path.getPointAtLength(length * i / samples).matrixTransform(matrix);
        const hit = rows.find(({box}) => {
          const dx = Math.max(box.left - p.x, 0, p.x - box.right);
          const dy = Math.max(box.top - p.y, 0, p.y - box.bottom);
          return Math.hypot(dx, dy) < radius;
        });
        if (hit) {
          issues.push(path.parentElement!.getAttribute('data-to') + ' 목적지로 가는 강조선이 ‘' + hit.name + '’ 행에 가립니다.');
          break;
        }
      }
    }
    return issues;
  });
  assert.deepEqual(overlaps, []);
}

async function checkMergedAndSplitRoutes(ctx:BrowserContext, page:Page) {
  const routes = [
    {name:'대출 연장', to:['loans']}, {name:'대출 재신청', to:['loans']},
    {name:'대출과 예약 확인', to:['loans','holds']},
    {name:'예약과 회원 확인', to:['holds','account']}, {name:'미분류', to:['account']},
  ];
  const graph:Graph = {
    nodes:[
      createBlock('input.user_request',{id:'ask',title:'도서관 문의',x:0,y:210}),
      createBlock('ai.classify',{id:'choice',title:'문의 경로 분류',x:390,y:160,
        config:{categories:routes.slice(0,-1).map(route => route.name)}}),
      createBlock('output.answer',{id:'loans',title:'대출 상담',x:1480,y:20}),
      createBlock('output.answer',{id:'holds',title:'예약 상담',x:1480,y:340}),
      createBlock('output.answer',{id:'account',title:'회원 상담 및 지역 분관의 도서 이용 자격 갱신 요청을 함께 처리하는 통합 담당 창구',x:1480,y:610}),
    ],
    edges:[
      {id:'start',kind:'flow',from:'ask',out:'next',to:'choice',input:'in'},
      {id:'question',kind:'data',from:'ask',out:'value',to:'choice',input:'input'},
      ...routes.flatMap(({name,to},index) => to.map(target => ({
        id:index+'-'+target,kind:'flow' as const,from:'choice',out:index===4?'other':'category:'+name,to:target,input:'in',
      }))),
    ],
  };
  const project = await api(ctx,'project.create',{graph,title:'도서관 문의 경로 확인'});
  await openDiagram(page,project.id);
  await checkCrowdedOutputs(page,'choice',routes.map(route => route.name));
  const canvas = page.locator('.ws-canvas');
  const rows = canvas.locator('button.ws-route-callout');
  const zoom = await canvas.locator('.ws-zoom-percent').innerText();
  const positions = () => rows.evaluateAll(buttons => buttons.map(button => {
    const {x,y,width,height} = button.getBoundingClientRect();
    return [x,y,width,height];
  }));
  const initial = await positions();
  // The two fan-outs share one destination. The long detail text must not shift the controls.
  for (const index of [0,1,2,3,4,1]) {
    const {name,to} = routes[index];
    const button = rows.nth(index);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.ws-route-detail-name')).toHaveText(name);
    const traces = canvas.locator('.ws-wire-trace');
    await expect(traces).toHaveCount(to.length);
    await expect(traces.first()).toHaveCSS('opacity','1');
    await expect.poll(() => traces.evaluateAll(paths => paths.every(path => getComputedStyle(path).opacity==='0')),
      {timeout:10000}).toBe(true);
    const targets = await canvas.locator('.ws-route-traced-path').evaluateAll(paths =>
      paths.map(path => path.parentElement!.getAttribute('data-to')).sort());
    assert.deepEqual(targets,[...to].sort());
    const settled = await positions();
    for (const [i,rect] of settled.entries()) {
      assert.ok(rect.every((value,j) => Math.abs(value-initial[i][j]) < .5),
        name + ' 선택 후 ‘' + routes[i].name + '’ 행 배치 변경: ' + initial[i] + ' → ' + rect);
    }
    await expect(canvas.locator('.ws-zoom-percent')).toHaveText(zoom);
    await assertUncoveredTraces(canvas);
    if (process.env.STUDIO_SCREENSHOTS && (index===2 || index===3)) {
      await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,
        'clear-desktop-'+to.join('-')+'.png')});
    }
  }
}

async function openLastClassifierRoute(ctx:BrowserContext, page:Page, fallback:{id:string;title:string;y:number}[]) {
  const categories = Array.from({length:31}, (_,index) => '자료 문의 ' + (index + 1));
  const graph:Graph = {
    nodes:[
      createBlock('input.user_request',{id:'question',title:'도서관 질문',x:0,y:200}),
      createBlock('ai.classify',{id:'classify',title:'도서관 문의 분류',x:390,y:130,config:{categories}}),
      createBlock('output.answer',{id:'desk',title:'자료 안내 데스크',x:1740,y:430}),
      ...fallback.map(({id,title,y}) => createBlock('output.answer',{id,title,x:1740,y})),
    ],
    edges:[
      {id:'start',kind:'flow',from:'question',out:'next',to:'classify',input:'in'},
      {id:'question-text',kind:'data',from:'question',out:'value',to:'classify',input:'input'},
      ...categories.map((name,index) => ({
        id:'inquiry-'+index,kind:'flow' as const,from:'classify',out:'category:'+name,to:'desk',input:'in',
      })),
      ...fallback.map(({id}) => ({id:'other-'+id,kind:'flow' as const,from:'classify',out:'other',to:id,input:'in'})),
    ],
  };
  const project = await api(ctx,'project.create',{graph,title:'32개 문의 경로의 목적지 탐색'});
  await openDiagram(page,project.id);
  await page.getByRole('button',{name:'캔버스에 맞추기',exact:true}).click();
  const canvas = page.locator('.ws-canvas');
  const zoom = canvas.locator('.ws-zoom-percent');
  const overview = await zoom.innerText();
  const classifier = canvas.locator('[data-canvas-block="classify"]');
  await classifier.focus();
  const rows = canvas.locator('button.ws-route-callout');
  await expect(rows).toHaveCount(categories.length+1);
  for (let index=0; index<=categories.length; index++) {
    await page.keyboard.press('Tab');
    await expect(rows.nth(index)).toBeFocused();
  }
  const last = rows.last();
  await expect(last).toHaveAttribute('data-output-port','other');
  const beforeSelection = (await last.boundingBox())!;
  await page.keyboard.press('Enter');
  await expect(last).toHaveAttribute('aria-pressed','true');
  // The detail mounts, then ResizeObserver can update the camera on the following frame.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const afterSelection = (await last.boundingBox())!;
  assert.ok(Math.hypot(afterSelection.x-beforeSelection.x,afterSelection.y-beforeSelection.y)<1,
    '32번째 행에서 경로 상세를 열면 선택 행의 화면 위치가 움직입니다.');
  return {canvas,rows,last,zoom,overview};
}

async function checkOffscreenDestinations(ctx:BrowserContext, page:Page) {
  const fallback = [
    {id:'holds',title:'예약 변경 및 지점 간 수령 상담',y:0},
    {id:'member',title:'회원 자격 확인 및 이용증 재발급',y:230},
  ];
  const {canvas,rows,last,zoom,overview} = await openLastClassifierRoute(ctx,page,fallback);

  const detail = page.locator('.ws-route-detail');
  const actions = detail.getByRole('button',{name:/목적지 보기/});
  const back = page.getByRole('button',{name:'선택한 경로로 돌아가기',exact:true});
  await expect(actions).toHaveCount(fallback.length);
  const traces = canvas.locator('.ws-wire-trace');
  await expect(traces).toHaveCount(2);
  await expect.poll(() => traces.evaluateAll(paths => paths.every(path => getComputedStyle(path).opacity==='0')),
    {timeout:10000}).toBe(true);
  const paths = canvas.locator('.ws-route-traced-path');
  const traceState = () => paths.evaluateAll(paths => paths.map(path => {
    const marker = path.getAttribute('marker-end');
    return {
      target:path.parentElement!.getAttribute('data-to'), port:path.getAttribute('data-output-port'),
      d:path.getAttribute('d'), marker:marker && path.ownerDocument.getElementById(marker.slice(5,-1))?.id,
    };
  }));
  const original = await traceState();
  assert.deepEqual(original.map(path => path.target).sort(),fallback.map(target => target.id).sort());
  assert.ok(original.every(path => path.d && path.marker && path.port==='other'));
  const insideCanvas = (el:Locator) => el.evaluate(el => {
    const box = el.getBoundingClientRect(), frame = el.closest('.ws-canvas')!.getBoundingClientRect();
    return box.left >= frame.left && box.right <= frame.right && box.top >= frame.top && box.bottom <= frame.bottom;
  });
  const assertTracePreserved = async () => {
    await expect(zoom).toHaveText(overview);
    await expect(last).toHaveAttribute('aria-pressed','true');
    assert.deepEqual(await traceState(),original);
    assert.deepEqual(await canvas.locator('[data-route-target="true"]').evaluateAll(cards =>
      cards.map(card => card.getAttribute('data-workflow-node')).sort()),fallback.map(target => target.id).sort());
  };
  const targetFor = (id:string) => canvas.locator('[data-workflow-node="'+id+'"]');
  const origin = (await last.boundingBox())!;
  assert.ok((await Promise.all(fallback.map(target => insideCanvas(targetFor(target.id))))).some(visible => !visible),
    '마지막 경로까지 키보드로 이동하면 적어도 한 목적지가 캔버스 밖에 있어야 합니다.');
  for (let index=0; index<fallback.length; index++) {
    await page.keyboard.press('Tab');
    const action = actions.nth(index);
    await expect(action).toBeFocused();
    await expect(action).toBeInViewport({ratio:.98});
    const target = fallback.find(target => original[index].target === target.id)!;
    await expect(action).toHaveAccessibleName(new RegExp(target.title));
    await page.keyboard.press('Enter');
    await expect(action).toBeFocused();
    await expect(action).toHaveAttribute('aria-current','location');
    await expect(detail.locator('button[aria-current="location"]')).toHaveCount(1);
    await expect.poll(() => insideCanvas(targetFor(target.id))).toBe(true);
    await expect(canvas.locator('.ws-node[data-route-viewed="true"]')).toHaveAttribute('data-workflow-node',target.id);
    await assertTracePreserved();
    if (process.env.STUDIO_SCREENSHOTS) await page.screenshot({
      path:join(process.env.STUDIO_SCREENSHOTS,'destination-desktop-'+target.id+'.png'),
    });
  }
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  await expect(back).toBeInViewport({ratio:.98});
  await page.keyboard.press('Enter');
  await expect(last).toBeFocused();
  assert.ok(await insideCanvas(last));
  const restored = (await last.boundingBox())!;
  assert.ok(Math.hypot(restored.x-origin.x, restored.y-origin.y) < 1,'복귀한 뒤 선택 행의 원래 화면 위치를 복원해야 합니다.');
  await expect(canvas.locator('.ws-node[data-route-viewed="true"]')).toHaveCount(0);
  await assertTracePreserved();
  if (process.env.STUDIO_SCREENSHOTS) await page.screenshot({
    path:join(process.env.STUDIO_SCREENSHOTS,'return-desktop.png'),
  });
  await page.keyboard.press('Shift+Tab');
  const previous = rows.nth(-2);
  await expect(previous).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(previous).toHaveAttribute('aria-pressed','true');
  await expect(last).toHaveAttribute('aria-pressed','false');
  await expect(actions).toHaveCount(1);
  await expect(actions).toHaveAccessibleName(/자료 안내 데스크/);
  for (const {title} of fallback) {
    await expect(page.getByRole('button',{name:title+' 목적지 보기',exact:true})).toHaveCount(0);
  }
  await expect(paths).toHaveCount(1);
  await expect(canvas.locator('[data-route-target="true"]')).toHaveAttribute('data-workflow-node','desk');
}

async function checkLongDestinationNames(ctx:BrowserContext, page:Page) {
  const prefix = '시립도서관 통합 상담 창구에서 접수한 자료 이용 문의를 해당 지점에서 처리하기 위해 접수자의 요청 사항과 기존 안내 이력을 확인하고 분관별 지원 기준에 따라 이용 일자와 신청 내용을 검토한 뒤 직원에게 전달하는 정기 업무 가운데 접수 대장에 등록된 요청 유형 ';
  const suffix = ' 건에 대해 이전 회신 내용과 지점별 업무 시간을 대조하고, 이용자에게 필요한 증빙과 신청 절차를 안내한 다음 담당 부서와 협의하여 처리 결과를 기록하고, 접수 순서에 맞춰 통합 상담 창구에서 확인할 수 있도록 정리하는 최종 안내 담당 창구';
  const keywords = ['야간반납','상호대차','분실신고','주소변경','열람예약','대출연장','회원갱신','도서기증','희망도서','단체방문','복사신청','주말예약'];
  const destinations = keywords.map((word,index) => ({
    id:'desk-'+index, title:prefix+word+suffix, y:index*120, word,
  }));
  const wanted = destinations.at(-1)!;
  assert.equal(wanted.title.length,283);
  const {canvas,last,zoom,overview} = await openLastClassifierRoute(ctx,page,destinations);
  const detail = page.locator('.ws-route-detail');
  const list = detail.locator('.ws-route-buttons');
  const buttons = list.getByRole('button');
  const header = detail.locator('.ws-route-title');
  const back = detail.getByRole('button',{name:'선택한 경로로 돌아가기',exact:true});
  const preview = detail.locator('.ws-route-full-name:visible');
  const traces = canvas.locator('.ws-wire-trace');
  await expect(traces).toHaveCount(destinations.length);
  await expect.poll(() => traces.evaluateAll(paths => paths.every(path => getComputedStyle(path).opacity==='0')),
    {timeout:10000}).toBe(true);
  const paths = canvas.locator('.ws-route-traced-path[data-output-port="other"]');
  const traceState = () => paths.evaluateAll(paths => paths.map(path => [
    path.parentElement!.getAttribute('data-to'),path.getAttribute('d'),path.getAttribute('marker-end'),
  ]));
  const initialPaths = await traceState();
  assert.deepEqual(initialPaths.map(path => path[0]).sort(),destinations.map(target => target.id).sort());
  assert.ok(initialPaths.every(([,d,marker]) => d && marker?.includes('trace-arrow')));
  const origin = (await last.boundingBox())!;
  const labels = await buttons.allInnerTexts();
  assert.equal(labels.length,destinations.length);
  assert.equal(new Set(labels).size,destinations.length);
  for (const {word,title} of destinations) {
    const button = buttons.filter({hasText:word});
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAccessibleName(title+' 목적지 보기');
    assert.ok((await button.innerText()).length < title.length,word+' 구분어를 남기고 목적지 이름을 줄여야 합니다.');
  }

  await page.keyboard.press('Tab');
  await expect(buttons.first()).toBeFocused();
  const fixedPositions = async () => Promise.all([header,back].map(async el => {
    const rect = (await el.boundingBox())!;
    return [rect.x,rect.y,rect.width,rect.height];
  }));
  const fixed = await fixedPositions();
  const scrollTop = await list.evaluate(el => el.scrollTop);
  const wantedButton = buttons.filter({hasText:wanted.word});
  for (let index=0; index<destinations.length; index++) {
    const focused = buttons.nth(index);
    await expect(focused).toBeFocused();
    if ((await focused.innerText()).includes(wanted.word)) break;
    await page.keyboard.press('Tab');
  }
  await expect(wantedButton).toBeFocused();
  await expect(wantedButton).toBeInViewport({ratio:.98});
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(scrollTop);
  const scrolled = await fixedPositions();
  for (const [index,rect] of fixed.entries()) assert.ok(rect.every((value,axis) => Math.abs(scrolled[index][axis]-value)<1),
    '목적지 목록을 스크롤할 때 경로 이름과 복귀 버튼 위치가 바뀌지 않아야 합니다.');
  await expect(header).toBeInViewport({ratio:.98});
  await expect(back).toBeInViewport({ratio:.98});
  await expect(preview).toHaveText(wanted.title);
  await expect(preview).toBeInViewport({ratio:.98});
  const allTextVisible = await preview.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const bounds = el.getBoundingClientRect();
    return [...range.getClientRects()].every(line => line.left >= bounds.left-1 && line.right <= bounds.right+1 &&
      line.top >= bounds.top-1 && line.bottom <= bounds.bottom+1);
  });
  assert.ok(allTextVisible,'활성화 전 미리보기에서 전체 이름의 끝까지 읽을 수 있어야 합니다.');
  await expect(canvas.locator('[data-route-viewed="true"]')).toHaveCount(0);
  const capture = async (state:string) => {
    if (process.env.STUDIO_SCREENSHOTS) await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,
      'long-names-desktop-'+state+'.png')});
  };
  await capture('focus');
  await page.keyboard.press('Enter');
  await expect(wantedButton).toHaveAttribute('aria-current','location');
  const viewed = canvas.locator('[data-route-viewed="true"]');
  await expect(viewed).toHaveAttribute('data-workflow-node',wanted.id);
  await expect(viewed).toBeInViewport({ratio:.98});
  await expect(zoom).toHaveText(overview);
  assert.deepEqual(await traceState(),initialPaths);
  await capture('destination');
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport({ratio:.98});
  await expect(viewed).toHaveCount(0);
  await expect(zoom).toHaveText(overview);
  assert.deepEqual(await traceState(),initialPaths);
  const restored = (await last.boundingBox())!;
  assert.ok(Math.hypot(restored.x-origin.x,restored.y-origin.y)<1,'복귀 후 32번째 경로 행 위치가 바뀌었습니다.');
  await capture('return');
  await wantedButton.click();
  await expect(wantedButton).toBeFocused();
  await expect(preview).toHaveText(wanted.title);
  await expect(viewed).toHaveAttribute('data-workflow-node',wanted.id);
  await page.keyboard.press('Escape');
  await expect(last).toBeFocused();
  await expect(viewed).toHaveCount(0);
}

async function checkNumberedDestinations(ctx:BrowserContext, page:Page) {
  const named = (name:string) => '시립도서관 야간 자료 문의를 접수하는 통합 서비스의 ' + name +
    ' 담당 직원 확인과 이용자별 방문 안내 결과를 기록하는 전담 창구';
  const shared = named('동일한 이름으로 등록한 상담실');
  const joined = (number:string) => '시립도서관야간도서이용문의접수를맡는통합자료실의' + number +
    '안내직원이접수요청과처리내용을기록하는전담상담창구';
  const destinations = [
    {id:'manual',title:'1번 · '+shared, visible:/^1번 · /u},
    {id:'duplicate-a',title:shared, full:'2번 · '+shared, visible:/^2번 · /u},
    {id:'duplicate-b',title:shared, full:'3번 · '+shared, visible:/^3번 · /u},
    {id:'serial-001',title:named('제001번 상담팀'),visible:/제001번/u},
    {id:'serial-01',title:named('제01번 상담팀'),visible:/제01번/u},
    {id:'joined-001',title:joined('001번'),visible:/(?<![0-9])001번/u},
    {id:'joined-01',title:joined('01번'),visible:/(?<![0-9])01번/u},
    ...['10','11'].flatMap(branch => ['01','02'].map(counter => ({
      id:'branch-'+branch+'-'+counter, title:named(branch+'지점 민원 접수를 처리하는 '+counter+'번 창구'),
      visible:new RegExp('^'+branch+'지점 · '+counter+'번$','u'),
    }))),
  ].map((entry,index) => ({...entry,y:index*120,full:'full' in entry && entry.full || entry.title}));
  const {canvas,last,zoom,overview} = await openLastClassifierRoute(ctx,page,destinations);
  const detail = page.locator('.ws-route-detail');
  const buttons = detail.locator('button[data-route-destination]');
  const active = buttons.and(page.locator(':focus'));
  const back = detail.getByRole('button',{name:'선택한 경로로 돌아가기',exact:true});
  const viewed = canvas.locator('[data-route-viewed="true"]');
  const origin = (await last.boundingBox())!;
  const labels = await buttons.allInnerTexts();
  assert.equal(labels.length,destinations.length);
  assert.equal(new Set(labels).size,destinations.length,'번호의 원래 표기와 조합으로 모든 목적지를 구분해야 합니다.');
  const animated = canvas.locator('.ws-wire-trace');
  await expect(animated).toHaveCount(destinations.length);
  await expect.poll(() => animated.evaluateAll(paths => paths.every(path => getComputedStyle(path).opacity==='0')),
    {timeout:10000}).toBe(true);
  const paths = canvas.locator('.ws-route-traced-path[data-output-port="other"]');
  const traceState = () => paths.evaluateAll(paths => paths.map(path => ({
    target:path.parentElement!.getAttribute('data-to'), line:path.getAttribute('d'), marker:path.getAttribute('marker-end'),
  })));
  const traces = await traceState();
  assert.deepEqual(traces.map(path => path.target).sort(),destinations.map(target => target.id).sort());
  assert.ok(traces.every(path => path.line && path.marker?.includes('trace-arrow')));
  const capture = async (state:string) => {
    if (process.env.STUDIO_SCREENSHOTS) await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,
      'numbered-desktop-'+state+'.png')});
  };
  async function checkReturn() {
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute('aria-pressed','true');
    await expect(viewed).toHaveCount(0);
    await expect(zoom).toHaveText(overview);
    assert.deepEqual(await traceState(),traces);
    const box = (await last.boundingBox())!;
    assert.ok(Math.hypot(box.x-origin.x,box.y-origin.y)<1,'복귀 시 32번째 행의 화면 위치를 복원해야 합니다.');
  }
  async function activate(target:typeof destinations[number]) {
    await expect(active).toHaveText(target.visible);
    await expect(active).toHaveAccessibleName(target.full+' 목적지 보기');
    await expect(detail.locator('.ws-route-full-name:visible')).toHaveText(target.full);
    await expect(active).toBeInViewport({ratio:.98});
    await page.keyboard.press('Enter');
    await expect(active).toHaveAttribute('aria-current','location');
    await expect(viewed).toHaveAttribute('data-workflow-node',target.id);
    await expect(viewed).toBeInViewport({ratio:.98});
    await expect(zoom).toHaveText(overview);
    assert.deepEqual(await traceState(),traces);
  }
  for (const target of destinations) {
    await page.keyboard.press('Tab');
    await activate(target);
    if (target.id==='duplicate-b') await capture('ordinals');
  }
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  // Move backwards by the labels that distinguish two neighbouring branches and counters.
  const wanted = destinations.find(target => target.id==='branch-10-02')!;
  for (let step=0; step<destinations.length; step++) {
    await page.keyboard.press('Shift+Tab');
    if (wanted.visible.test(await active.innerText())) break;
  }
  await expect(active).toHaveText(wanted.visible);
  await capture('focus');
  await activate(wanted);
  await capture('destination');
  await page.keyboard.press('Escape');
  await checkReturn();
  await capture('return');
  // Exercise the explicit return button from the route's final destination, too.
  for (let step=0; step<destinations.length; step++) await page.keyboard.press('Tab');
  await activate(destinations.at(-1)!);
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  await page.keyboard.press('Enter');
  await checkReturn();
}

async function checkShortViewportScroll(ctx:BrowserContext, page:Page) {
  await page.setViewportSize({width:1280,height:600});
  const title = (serial:string) =>
    '지역 공공도서관 통합 민원 접수 및 처리 현황을 점검하는 권역별 전담 운영 창구 '.repeat(3) +
    '통합요청번호'+serial+'호처리이력' +
    ' 안내 대상자를 다시 확인하여 연계 기관으로 보내기 전 요청 근거와 후속 처리 결과를 검토하고 보관하는 담당 부서'.repeat(4);
  const serials = ['000000123456780100','000000123456780101'];
  const targets = ['자료 문의','대출 상담',...serials.map(title),'기타 문의']
    .map((title,index) => ({id:'short-screen-'+index,title,y:120*index}));
  const {canvas,last} = await openLastClassifierRoute(ctx,page,targets);
  const detail = page.locator('.ws-route-detail'), list = detail.locator('.ws-route-buttons');
  const first = list.getByRole('button',{name:targets[2].title+' 목적지 보기',exact:true});
  const next = list.getByRole('button',{name:targets[3].title+' 목적지 보기',exact:true});
  for (let i=0; i<3; i++) await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  const preview = detail.locator('.ws-route-full-name:visible');
  await expect(preview).toHaveText(targets[2].title);
  const lastLetterVisible = () => preview.evaluate(text => {
    const line = document.createRange(), value = text.firstChild!;
    line.setStart(value,value.textContent!.length-1);
    line.setEnd(value,value.textContent!.length);
    const end = line.getBoundingClientRect(), frame = text.closest('.ws-route-buttons')!.getBoundingClientRect();
    return end.top >= frame.top && end.bottom <= frame.bottom;
  });
  assert.equal(await lastLetterVisible(),false,'첫 포커스에서 원문의 끝은 목록 밖에 있어야 합니다.');
  for (let step=0; step<24 && !await lastLetterVisible(); step++) {
    await page.keyboard.press('ArrowDown');
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  assert.ok(await lastLetterVisible(),'방향키로 원문의 마지막 글자까지 읽을 수 있어야 합니다.');
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(canvas.locator('[data-route-viewed="true"]')).toHaveAttribute('data-workflow-node',targets[2].id);
  await expect(next).toBeFocused();
  await expect(preview).toHaveText(targets[3].title);
  // Native scrolling may continue after Tab. Check the entire button over successive painted frames.
  const remainsVisible = await next.evaluate(async button => {
    const list = button.closest('.ws-route-buttons')!;
    const until = performance.now()+300;
    do {
      const box = button.getBoundingClientRect(), frame = list.getBoundingClientRect();
      if (box.top < frame.top+2 || box.bottom > frame.bottom-2) return false;
      const hit = document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
      if (!hit || !button.contains(hit)) return false;
      await new Promise(requestAnimationFrame);
    } while (performance.now()<until);
    return true;
  });
  assert.ok(remainsVisible,'원문 끝에서 Enter와 Tab을 누른 뒤 다음 버튼 전체가 목록 안에 보여야 합니다.');
  if (process.env.STUDIO_SCREENSHOTS) await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,'short-window-next-focus.png')});
  await page.keyboard.press('Escape');
  await expect(last).toBeFocused();
}

async function verify() {
  const ctx = await browser.newContext({baseURL, viewport:{width:1440,height:900}});
  try {
    await registerBrowserAccount(ctx);
    const {id} = await api(ctx,'project.create',{lesson:'intermediate'});
    const page = await ctx.newPage();
    const wire = (from:string,to:string) => page.locator('.ws-wire[data-from="' + from + '"][data-to="' + to + '"]');
    await openDiagram(page,id);
    const recipient = page.locator('[data-canvas-block="answer"]');
    await recipient.focus();
    await expect(wire('input','answer').locator('.ws-wire-label')).toHaveText('원래 질문');
    await page.locator('[data-canvas-block="input"]').focus();
    await expect(wire('input','answer').locator('.ws-wire-label')).toHaveCount(0);

    await page.getByRole('button',{name:'캔버스에 맞추기',exact:true}).click();
    const intended = wire('input','search'), hit = await midpoint(intended);
    await page.mouse.click(hit.x,hit.y);
    await expect(intended).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.ws-inspector')).toContainText('도서관 질문 → 규정과 지점 안내문 검색');

    // This recipient has incoming flow, data and reference wires, an outgoing
    // flow wire, and two named exits merging into the same incoming arrow.
    const search = page.locator('[data-canvas-block="search"]');
    const searchCard = page.locator('[data-workflow-node="search"]');
    const cues = page.locator('.ws-port-direction');
    const incoming = page.locator('.ws-port-direction[data-direction="incoming"]');
    const outgoing = page.locator('.ws-port-direction[data-direction="outgoing"]');
    await page.getByRole('button',{name:'캔버스에 맞추기',exact:true}).click();
    await search.focus();
    await expect(search).toHaveAttribute('aria-pressed','true');
    await expect(incoming).toHaveCount(1);
    await expect(outgoing).toHaveCount(1);
    const incident = page.locator('.ws-wire:is([data-from="search"],[data-to="search"])');
    const traces = page.locator('.ws-wire-trace');
    await expect(traces).toHaveCount(await incident.count());
    const expectedPairs = await incident.evaluateAll(wires => wires.map(w => [w.getAttribute('data-from'),w.getAttribute('data-to')]).sort());
    const tracedPairs = () => traces.evaluateAll(paths => paths.map(path => {
      const wire = path.closest('[data-from][data-to]')!;
      return [wire.getAttribute('data-from'),wire.getAttribute('data-to')];
    }).sort());
    assert.deepEqual(await tracedPairs(),expectedPairs);
    const palette = await incident.evaluateAll(wires => wires.map(wire => {
      const {from,to,kind} = (wire as SVGGElement).dataset;
      const decoration = wire.closest('svg')!.querySelector(
        `[data-from="${CSS.escape(from!)}"][data-to="${CSS.escape(to!)}"] > .ws-wire-trace`,
      )!;
      return {kind, line:getComputedStyle(wire.querySelector('.ws-channel')!).stroke, core:getComputedStyle(decoration).stroke};
    }));
    assert.deepEqual(new Set(palette.map(p => p.kind)),new Set(['flow','data','reference']));
    for (const {kind,line,core} of palette) assert.equal(core,line,kind + ' 선과 이동 표시가 같은 색이어야 합니다.');
    assert.equal(new Set(palette.map(p => p.core)).size,3);
    const branch = wire('intent','search');
    const branchDecoration = page.locator('[data-from="intent"][data-to="search"]:has(> .ws-wire-trace)');
    const trace = branchDecoration.locator('.ws-wire-trace');
    const rim = branchDecoration.locator('.ws-wire-trace-rim');
    const fullPath = await branch.locator('.ws-wire-hit').getAttribute('d');
    assert.ok(fullPath && (fullPath.match(/M/g)?.length ?? 0) > 1);
    await expect(trace).toHaveAttribute('d',fullPath);
    await expect(trace).toHaveCSS('pointer-events','none');
    await expect(rim).toHaveAttribute('d',fullPath);
    const traceColors = await rim.evaluate(outer => {
      const core = outer.parentElement!.querySelector('.ws-wire-trace')!;
      const surface = getComputedStyle(outer.closest('.ws-editor')!).backgroundColor;
      const border = getComputedStyle(outer).stroke;
      const sample = document.createElement('canvas');
      sample.width = sample.height = 1;
      const paint = sample.getContext('2d')!;
      const [rimLight, coreLight] = [border, getComputedStyle(core).stroke].map(color => {
        paint.clearRect(0,0,1,1);
        paint.fillStyle = color;
        paint.fillRect(0,0,1,1);
        const [red, green, blue] = [...paint.getImageData(0,0,1,1).data].map(value => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return red * .2126 + green * .7152 + blue * .0722;
      });
      return {surface, border, contrast:(Math.max(rimLight,coreLight) + .05) / (Math.min(rimLight,coreLight) + .05)};
    });
    assert.equal(traceColors.border, traceColors.surface, '이동 표시의 테두리는 편집기 표면 색상과 같아야 합니다.');
    assert.ok(traceColors.contrast >= 3, '이동 표시와 바깥 테두리의 명암비는 3:1 이상이어야 합니다. 실제 ' + traceColors.contrast.toFixed(2) + ':1');
    assert.ok(await trace.evaluate(core => {
      const rim = core.parentElement!.querySelector('.ws-wire-trace-rim')!;
      const inside = getComputedStyle(core), outside = getComputedStyle(rim);
      return parseFloat(outside.strokeWidth) > parseFloat(inside.strokeWidth) &&
        outside.strokeDasharray === inside.strokeDasharray && outside.strokeDashoffset === inside.strokeDashoffset;
    }), '바깥 테두리가 이동 표시의 위치와 간격을 따라가야 합니다.');
    // Verify the rendered dash advances from source to destination during playback.
    assert.ok(await trace.evaluate(async path => {
      let previous = parseFloat(getComputedStyle(path).strokeDashoffset);
      for (let frame = 0; frame < 12; frame++) {
        await new Promise(requestAnimationFrame);
        const next = parseFloat(getComputedStyle(path).strokeDashoffset);
        if (next < previous) return true;
        previous = next;
      }
      return false;
    }), '강조 표시가 연결선의 출발점에서 도착점 방향으로 움직여야 합니다.');
    await page.locator('.ws-wire-trace,.ws-wire-trace-rim').evaluateAll(paths => {
      for (const path of paths) for (const animation of path.getAnimations()) animation.finish();
    });
    await expect(trace).toHaveCSS('opacity','0');
    await expect(branchDecoration.locator('.ws-wire-trail-halo')).toBeVisible();
    const measureCues = () => Promise.all([
      checkPortCue(incoming,searchCard.locator('.ws-port-in'),true),
      checkPortCue(outgoing,searchCard.locator('.ws-output-dot'),false),
    ]);
    const overviewSize = await measureCues();
    const coveredCaptions = await page.locator('.ws-canvas').evaluate(canvas => {
      const cues = Array.from(canvas.querySelectorAll('.ws-port-direction'), cue => cue.getBoundingClientRect());
      return Array.from(canvas.querySelectorAll('.ws-wire-label')).filter(label => {
        const box = label.getBoundingClientRect();
        return cues.some(cue => box.left < cue.right && cue.left < box.right && box.top < cue.bottom && cue.top < box.bottom);
      }).map(label => label.textContent);
    });
    assert.deepEqual(coveredCaptions, [], '전체 보기에서 방향 화살표와 연결선 이름이 서로 가리지 않아야 합니다.');
    for (const percent of [100,200]) {
      if (percent === 100) await search.press('0');
      else for (let i=0; i<4; i++) await search.press('=');
      await expect(page.locator('.ws-zoom-percent')).toHaveText(percent + '%');
      const sizes = await measureCues();
      sizes.forEach((size,i) => {
        assert.ok(Math.abs(size.width-overviewSize[i].width) < 1 && Math.abs(size.height-overviewSize[i].height) < 1,
          '방향 화살표의 화면 크기는 배율에 따라 바뀌지 않아야 합니다.');
      });
    }
    await expect(search).toBeFocused();
    assert.deepEqual(await tracedPairs(),expectedPairs);
    await search.press('Enter');
    await expect(trace).toHaveCSS('opacity','1');

    await page.emulateMedia({reducedMotion:'reduce'});
    await expect(trace).toBeHidden();
    await expect(rim).toBeHidden();
    await expect(branchDecoration.locator('.ws-wire-trail-halo')).toBeVisible();
    await measureCues();
    const widthOf = (line:Locator) => line.locator('.ws-channel').evaluate(path => parseFloat(getComputedStyle(path).strokeWidth));
    assert.ok(await widthOf(branch) > await widthOf(wire('answer','result')));
    await expect(page.locator('.ws-wire-endpoint')).toHaveCount(0);
    await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'active'});
    const systemColors = await page.evaluate(() => {
      const swatch = document.createElement('span');
      swatch.style.cssText = 'color:CanvasText;background-color:Canvas;forced-color-adjust:none';
      document.body.append(swatch);
      const {color,backgroundColor} = getComputedStyle(swatch);
      swatch.remove();
      return {ink:color,paper:backgroundColor};
    });
    await expect(trace).toHaveCSS('stroke',systemColors.ink);
    await expect(rim).toHaveCSS('stroke',systemColors.paper);
    await expect(incoming).toBeVisible();
    await expect(outgoing).toBeVisible();
    await expect(incoming.locator('path')).toHaveCSS('fill',systemColors.ink);
    await expect(outgoing.locator('path')).toHaveCSS('stroke',systemColors.paper);
    await page.emulateMedia({forcedColors:'none'});
    await checkCrowdedOutputs(page,'intent',['규정','예약','미분류']);
    const classifier = page.locator('[data-canvas-block="intent"]');
    await classifier.focus();
    await classifier.press('0');
    await expect(page.locator('.ws-route-callout')).toHaveCount(0);
    const routeDots = page.locator('[data-workflow-node="intent"] .ws-route-output .ws-output-dot');
    await expect(routeDots).toHaveCount(3);
    await expect(outgoing).toHaveCount(3);
    const centerHeights = (items:Locator) => items.evaluateAll(elements => elements.map(el => {
      const box = el.getBoundingClientRect();
      return box.y + box.height/2;
    }).sort((a,b) => a-b));
    const dots = await centerHeights(routeDots), arrows = await centerHeights(outgoing);
    assert.ok(dots.every((y,i) => Math.abs(y-arrows[i]) < 2),'합류하는 분기에서도 각 출력점에 화살표가 표시되어야 합니다.');
    await page.locator('[data-canvas-block="result"]').focus();
    await expect(incoming).toHaveCount(1);
    await expect(outgoing).toHaveCount(0);
    await recipient.focus();
    await expect(trace).toHaveCount(0);
    assert.deepEqual(await tracedPairs(),[['answer','result'],['evidence','answer'],['input','answer']]);
    await wire('input','answer').press('Enter');
    await expect(traces).toHaveCount(0);
    await expect(cues).toHaveCount(0);
    await expect(page.locator('.ws-wire-endpoint').first()).toBeVisible();
    await expect(page.locator('.ws-save-badge')).toHaveText('저장됨');

    const condition = await api(ctx,'project.create',{graph:conditionExample(),title:'신청 확인과 안내'});
    await openDiagram(page,condition.id);
    await checkCrowdedOutputs(page,'condition',['접수됨','다시 확인']);
    const acceptedRoute = page.getByRole('button',{name:'접수됨 → 접수 안내',exact:true});
    await acceptedRoute.click();
    await expect(page.locator('.ws-node[data-route-target="true"]')).toHaveAttribute('data-workflow-node','accepted');
    await page.locator('[data-canvas-block="request"]').focus();
    await expect(page.locator('.ws-route-callout')).toHaveCount(0);
    await expect(page.locator('.ws-route-detail')).toHaveCount(0);

    // The rightmost card needs camera room for long labels, including on the first selection and a second fit.
    const categories = ['시립도서관 자료열람 및 관외대출 승인 신청','시립도서관 자료열람 및 관외대출 승인 취소'];
    const rightmost:Graph = {
      nodes:[
        createBlock('input.user_request',{id:'request',title:'도서관 질문',x:0,y:0}),
        createBlock('ai.classify',{id:'rightmost',title:'승인 요청 분류',x:1500,y:80,config:{categories}}),
        createBlock('output.answer',{id:'answer',title:'처리 안내',x:320,y:180}),
      ],
      edges:[
        {id:'start',from:'request',out:'next',to:'rightmost',kind:'flow',input:'in'},
        {id:'question',from:'request',out:'value',to:'rightmost',kind:'data',input:'input'},
        ...[...categories.map(name=>'category:'+name),'other'].map(out => ({
          id:out,from:'rightmost',out,to:'answer',kind:'flow' as const,input:'in',
        })),
      ],
    };
    const edgeProject = await api(ctx,'project.create',{graph:rightmost,title:'화면 오른쪽의 질문 분류'});
    await openDiagram(page,edgeProject.id);
    await checkCrowdedOutputs(page,'rightmost',[/신청/,/취소/,'미분류']);

    await checkClassifierPathSelection(ctx,page);
    await checkMergedAndSplitRoutes(ctx,page);
    await checkOffscreenDestinations(ctx,page);
    await checkLongDestinationNames(ctx,page);
    await checkNumberedDestinations(ctx,page);

    // Two connections have identical visible geometry. Both destinations must be selectable.
    const source = createBlock('input.user_request',{id:'source', title:'질문', x:0, y:20});
    const a = createBlock('output.answer',{id:'a', title:'첫 번째 답변', x:208, y:20});
    const b = createBlock('output.answer',{id:'b', title:'두 번째 답변', x:208, y:20});
    const loose = createBlock('agent.task',{id:'loose', title:'연결하지 않은 블록', x:0, y:180});
    const graph:Graph = {nodes:[source,a,b,loose], edges:[a,b].map(block=>({
      id:'edge-'+block.id, from:source.id, to:block.id, kind:'flow', out:'next', input:'in',
    }))};
    const overlap = await api(ctx,'project.create',{graph, title:'겹친 경로'});
    await openDiagram(page,overlap.id);
    const first = wire('source','a');
    await first.waitFor();
    await page.locator('[data-canvas-block="loose"]').focus();
    await expect(page.locator('[data-workflow-node="loose"] .ws-port-out')).toBeVisible();
    await expect(cues).toHaveCount(0);
    await page.getByRole('button',{name:'캔버스에 맞추기',exact:true}).click();
    const point = await midpoint(first);
    const clickWire = () => page.mouse.click(point.x,point.y);
    await clickWire();
    const chooser = page.getByRole('dialog',{name:'겹친 연결선 선택'});
    await expect(chooser.getByRole('button',{name:/질문 → 첫 번째 답변/})).toBeVisible();
    await expect(chooser.getByRole('button',{name:/질문 → 두 번째 답변/})).toBeVisible();
    if (process.env.STUDIO_SCREENSHOTS) {
      mkdirSync(process.env.STUDIO_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,'overlapping-wires-'+page.viewportSize()!.width+'.png')});
    }
    await page.keyboard.press('Escape');
    await expect(chooser).toHaveCount(0);
    await expect(first).toHaveAttribute('aria-pressed','false');
    await clickWire();
    const choice = chooser.getByRole('button',{name:/질문 → 첫 번째 답변/});
    await choice.focus();
    await page.keyboard.press('Enter');
    await expect(chooser).toHaveCount(0);
    await expect(first).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.ws-inspector')).toContainText('질문 → 첫 번째 답변');
    await checkShortViewportScroll(ctx,page);
  } finally {
    await ctx.close();
  }
}

try {
  await verify();
  console.log('PASS fixed-size port cues, reduced motion, wire choices, per-output tracing and keyboard navigation to both destinations and back on desktop.');
} finally {
  await browser.close();
}
