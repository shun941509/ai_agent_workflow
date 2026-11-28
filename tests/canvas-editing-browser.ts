import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium, expect, type BrowserContext, type Locator, type Page} from '@playwright/test';

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
async function visibleInCanvas(block:Locator) {
  return block.evaluate(el => {
    const box = el.getBoundingClientRect();
    const frame = el.closest('.ws-canvas')!.getBoundingClientRect();
    return box.left >= frame.left && box.right <= frame.right && box.top >= frame.top && box.bottom <= frame.bottom;
  });
}
async function capture(page:Page, name:string) {
  const folder = process.env.STUDIO_SCREENSHOTS;
  if (!folder) return;
  mkdirSync(folder,{recursive:true});
  await page.screenshot({path:join(folder,name+'-'+page.viewportSize()!.width+'.png')});
}
async function verifyConnectionTerms(page:Page, projectId:string) {
  await page.goto('/?edit='+projectId);
  const button=(name:string)=>page.getByRole('button',{name,exact:true});
  const activate=(control:Locator)=>control.press('Space');
  await activate(button('캔버스로 보기'));
  const legend=page.getByRole('group',{name:'연결선 종류',exact:true});
  const tooltip=page.getByRole('tooltip');
  const kinds=['실행 순서','전달할 값','참조'];
  const samples=[
    {from:'intent',to:'lookup',kinds:['실행 순서'],detail:'예약'},
    {from:'input',to:'search',kinds:['전달할 값']},
    {from:'hours',to:'search',kinds:['참조'],detail:'운영 안내'},
    {from:'input',to:'intent',kinds:['실행 순서','전달할 값']},
  ];
  const listDescriptions:{id:string;name:string}[]=[];
  for (const overview of [false,true]) {
    if (overview) await activate(button('전체 보기'));
    await expect(legend.getByRole('button')).toHaveText(kinds);
    for (const name of kinds) {
      const control=legend.getByRole('button',{name:name+' 강조',exact:true});
      await expect(control).toHaveAttribute('aria-pressed','false');
      await activate(control);
      await expect(control,{message:`${page.viewportSize()!.width}px ${overview?'전체 보기':'기본 캔버스'}에서 ${name} 강조 선택`}).toHaveAttribute('aria-pressed','true');
      await expect(tooltip).toHaveText(name+' 연결 강조');
      await expect(control).toHaveAccessibleDescription(name+' 연결 강조');
      const drawing=await page.locator('.ws-canvas').boundingBox();
      const key=await legend.boundingBox(),tip=await tooltip.boundingBox();
      assert.ok(drawing && key && tip);
      assert.ok([key,tip].every(box=>box.y >= drawing.y+drawing.height-1), '범례와 툴팁이 도면을 가립니다.');
      for (const sample of samples) {
        const wire=page.locator(`.ws-wire[data-from="${sample.from}"][data-to="${sample.to}"]`);
        if (sample.kinds.includes(name)) await expect(wire).not.toHaveAttribute('data-legend-muted','true');
        else await expect(wire).toHaveAttribute('data-legend-muted','true');
      }
      await activate(control);
      await expect(control).toHaveAttribute('aria-pressed','false');
    }
    await legend.getByRole('button',{name:'참조 강조',exact:true}).hover();
    await expect(tooltip).toHaveText('참조 연결 강조');
    for (const sample of samples) {
      const wire=page.locator(`.ws-wire[data-from="${sample.from}"][data-to="${sample.to}"]`);
      const description=await wire.getAttribute('aria-label');
      assert.ok(description);
      for (const name of kinds) assert.equal(description.includes(name),sample.kinds.includes(name),description);
      if (sample.detail) assert.ok(description.includes(sample.detail),description);
      await wire.focus();
      await expect(tooltip).toHaveText(description);
      await page.keyboard.press('Escape');
      await expect(tooltip).toBeHidden();
      if (overview) await expect(button('편집기로 돌아가기')).toBeVisible();
      if (overview) {
        const id=await wire.getAttribute('data-canvas-wire');
        assert.ok(id);
        listDescriptions.push({id,name:sample.kinds.join(' · ')});
      }
    }
  }
  await activate(button('편집기로 돌아가기'));
  await activate(button('목록으로 편집'));
  for (const {id,name} of listDescriptions) {
    const row=page.locator('.ws-graph-list [data-canvas-wire='+JSON.stringify(id)+']');
    await expect(row.locator('small')).toContainText(name);
  }
  console.log('PASS '+page.viewportSize()!.width+'px canvas legend, grouped connection terms and filtering.');
}
async function exercise(width:number) {
  const context = await browser.newContext({baseURL,viewport:{width,height:900}});
  try {
    await registerBrowserAccount(context);
    const project = await api(context,'project.create',{lesson:'intermediate'});
    const page = await context.newPage();
    const button = (name:string) => page.getByRole('button',{name,exact:true});
    await page.goto('/?edit='+project.id);
    const canvas = page.locator('.ws-canvas');
    const edited = canvas.locator('[data-canvas-block="answer"]');
    await expect(edited).toHaveAttribute('aria-pressed','true');
    const zoom = () => canvas.locator('.ws-world').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);
    await expect.poll(zoom).toBeGreaterThanOrEqual(0.9);
    const beforeZoom = await zoom();
    await button('자동 정렬').click();
    await expect(edited).toHaveAttribute('aria-pressed','true');
    await expect.poll(() => visibleInCanvas(edited)).toBe(true);
    await expect.poll(zoom).toBe(beforeZoom);
    await capture(page,'arranged-readable');
    await button('캔버스에 맞추기').click();
    await expect.poll(zoom).toBeLessThan(beforeZoom);

    if (width === 1440) {
      const bounds = (await canvas.boundingBox())!;
      await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
      await page.mouse.wheel(2400,1000);
      await expect.poll(() => visibleInCanvas(edited)).toBe(false);
      await page.locator('.ws-current-nodes').getByRole('button',{name:'근거로 안내',exact:true}).click();
      await expect.poll(() => visibleInCanvas(edited)).toBe(true);
    }
    await button('목록으로 편집').click();
    const list = canvas.locator('.ws-graph-list');
    const edge = list.locator('[data-canvas-wire]').last();
    await edge.click();
    await expect(edge).toHaveAttribute('aria-pressed','true');
    const scroll = () => list.evaluate(el => el.scrollTop);
    await expect.poll(scroll).toBeGreaterThan(100);
    const offset = await scroll();
    await button('캔버스로 보기').click();
    await button('목록으로 편집').click();
    await expect.poll(scroll).toBeCloseTo(offset,0);
    await expect.poll(() => visibleInCanvas(edge)).toBe(true);

    const parallel = await api(context,'project.create',{lesson:'parallel'});
    await page.goto('/?edit='+parallel.id);
    await button('목록으로 편집').click();
    const team = canvas.locator('[data-canvas-block="team"]');
    const enterTeam = async () => {
      await team.click();
      await button('팀 열기').click();
      await expect(canvas.locator('[data-canvas-block="split"]')).toBeVisible();
    };
    await enterTeam();
    const childWire = list.locator('[data-canvas-wire]').last();
    await childWire.click();
    const childOffset = await scroll();
    await button('상위 Workflow로').click();
    await expect(team).toBeFocused();
    await enterTeam();
    await expect(childWire).toHaveAttribute('aria-pressed','true');
    await expect.poll(scroll).toBeCloseTo(childOffset,0);

    const beginner = await api(context,'project.create',{lesson:'beginner'});
    await page.goto('/?edit='+beginner.id);
    const initialView = '캔버스로 보기';
    await expect(button(initialView)).toHaveAttribute('aria-pressed','true');
    await button('목록으로 편집').click();
    await page.reload();
    await expect(button(initialView)).toHaveAttribute('aria-pressed','false');
    await button('목록으로 편집').click();
    await canvas.locator('[data-canvas-block="rules"]').press('Enter');
    const source = page.getByLabel('자료 원문',{exact:true});
    const original = await source.inputValue();
    await source.fill(original + '\n다시 확인할 자료');
    await button('전체 보기').press('Enter');
    await expect(button('편집기로 돌아가기')).toBeFocused();
    await expect(canvas.locator('.ws-world [data-canvas-block]')).toHaveCount(beginner.graph.nodes.length);
    for (const node of beginner.graph.nodes) {
      await expect.poll(() => visibleInCanvas(canvas.locator('[data-canvas-block="' + node.id + '"]'))).toBe(true);
    }
    await button('참조 강조').press('Space');
    await expect(canvas.locator('.ws-wire[data-legend-muted]')).toHaveCount(3);
    if (await page.getByRole('tooltip').isVisible()) {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('tooltip')).toBeHidden();
      await expect(button('편집기로 돌아가기')).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(button('전체 보기')).toBeFocused();
    await expect(canvas.locator('[data-canvas-block="rules"]')).toHaveAttribute('aria-pressed','true');
    await canvas.locator('[data-canvas-block="rules"]').press('Enter');
    await expect(source).toHaveValue(original + '\n다시 확인할 자료');
    await source.fill(original);
    await button('캔버스로 보기').click();
    const output = canvas.locator('[data-canvas-block="output"]');
    await output.focus();
    const start = await output.evaluate(el=>parseFloat((el.closest('[data-workflow-node]') as HTMLElement).style.left));
    for (let step=0; step<12; step++) await output.press('Shift+ArrowRight');
    await expect.poll(() => output.evaluate(el=>parseFloat((el.closest('[data-workflow-node]') as HTMLElement).style.left))).toBe(start+12*24);
    await expect.poll(() => visibleInCanvas(output)).toBe(true);
    const rules = canvas.locator('[data-canvas-block="rules"]');
    const nodes = canvas.locator('[data-canvas-block]');
    const wires = canvas.locator('[data-canvas-wire]');
    const nodeCount = await nodes.count(), wireCount = await wires.count();
    await rules.focus();
    await rules.press('Delete');
    await expect(nodes).toHaveCount(nodeCount-1);
    await page.keyboard.press('Control+z');
    await expect(rules).toBeFocused();
    await expect(rules).toHaveAttribute('aria-pressed','true');
    await expect(wires).toHaveCount(wireCount);
    await expect(page.locator('.ws-footer')).toContainText(/도서관 이용규정.*복구/);
    await capture(page,'undo-restored-block');
    await page.keyboard.press('Control+Shift+z');
    await expect(nodes).toHaveCount(nodeCount-1);
    await expect(page.locator('.ws-footer')).toContainText(/도서관 이용규정.*다시 삭제/);
    await page.keyboard.press('Control+z');
    await expect(rules).toBeFocused();
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await api(context,'project.open',{id:beginner.id})).graph.nodes.find((n:{id:string})=>n.id==='output').x).toBe(start+12*24);
    await verifyConnectionTerms(page,project.id);
  } finally { await context.close(); }
}
try {
  await exercise(1440);
  console.log('PASS desktop canvas arrangement, keyboard panning, list return and deletion undo/redo.');
} finally { await browser.close(); }
