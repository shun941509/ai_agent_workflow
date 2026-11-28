import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium, expect} from '@playwright/test';
import {createBlock, type Graph} from '../src/domain';
import {groupKey} from '../src/ui/editor/graph';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리 시험용 작업실 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});
async function verifyDesktop() {
    const width = 1440;
    const context = await browser.newContext({baseURL, viewport:{width,height:900}});
    try {
      const branch = createBlock('control.branch',{id:'branch',title:'대출 요청 확인',x:0,y:24,config:{yesLabel:'대출',noLabel:'예약'}});
      const graph:Graph = {
        nodes:[branch,
          createBlock('output.answer',{id:'receipt',title:'대출 안내',x:240,y:24}),
          createBlock('output.answer',{id:'notice',title:'대출 기록',x:240,y:144}),
          createBlock('output.answer',{id:'reservation',title:'예약 안내',x:240,y:264}),
          createBlock('agent.task',{id:'free',title:'초안 쓰기',x:0,y:392}),
          createBlock('agent.task',{id:'review',title:'문장 검토',x:240,y:392}),
          createBlock('control.branch',{id:'partial',title:'재검토 확인',x:500,y:24})],
        edges:[['branch','yes','receipt'],['branch','yes','notice'],['branch','no','reservation'],['partial','yes','receipt']].map(([from,out,to]) => ({
          id:from+'-'+to,from,to,kind:'flow',out,input:'in',
        })),
      };
      const api = async (action:string,data:object = {}) => {
        const response = await context.request.post('/api/studio',{data:{action,data}});
        assert.ok(response.ok(), await response.text());
        return (await response.json()).data;
      };
      await registerBrowserAccount(context);
      const project = await api('project.create',{title:'경로 탐색과 배치',graph});
      const page = await context.newPage();
      await page.goto('/?edit='+project.id);
      const canvas = page.locator('.ws-canvas');
      const block = (id:string) => canvas.locator('[data-canvas-block="'+id+'"]');
      const wire = (to:string) => canvas.locator('[data-canvas-wire='+JSON.stringify(groupKey('branch',to))+']');
      const chooser = page.getByRole('dialog',{name:'따라갈 연결선 선택'});
      const candidate = (destination:string) => chooser.getByRole('button',{name:new RegExp('대출 요청 확인 → '+destination)});
      const capture = async (name:string) => {
        if (!process.env.STUDIO_SCREENSHOTS) return;
        mkdirSync(process.env.STUDIO_SCREENSHOTS,{recursive:true});
        await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,name+'-'+width+'.png')});
      };
      for (const list of [false,true]) {
        await page.getByRole('button',{name:list ? '목록으로 편집' : '캔버스로 보기',exact:true}).press('Enter');
        await block('free').press('Control+ArrowDown');
        await expect(block('free')).toBeFocused();
        await expect(canvas.getByRole('status')).toContainText('연결된 선이 없습니다');

        await block('branch').press('Control+ArrowDown');
        await expect(chooser).toBeVisible();
        await expect(candidate('대출 기록')).toContainText('대출 경로');
        await expect(candidate('예약 안내')).toContainText('예약 경로');
        if (!list) await capture('keyboard-path-choices');
        await page.goBack();
        await expect(chooser).toHaveCount(0);
        await expect(block('branch')).toBeFocused();
        await page.goForward();
        await expect(chooser).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(block('branch')).toBeFocused();
        await page.keyboard.press('Control+ArrowDown');
        await candidate('대출 기록').press('Enter');
        await expect(wire('notice')).toBeFocused();
        await expect(block('branch')).toHaveAttribute('aria-pressed','true');
        await block('reservation').press('Control+ArrowDown');
        await expect(wire('reservation')).toBeFocused();
        if (list) continue;
        const named = canvas.locator('[data-workflow-node="branch"]');
        const yes = named.locator('[data-output-port="yes"]'), no = named.locator('[data-output-port="no"]');
        await no.press('Control+ArrowDown');
        await expect(wire('reservation')).toBeFocused();
        await yes.press('Control+ArrowDown');
        await expect(chooser.locator('.ws-wire-choices button')).toHaveCount(2);
        await expect(candidate('예약 안내')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(yes).toBeFocused();
        await no.press('Enter');
        await expect(page.getByRole('dialog',{name:'연결 추가'})).toContainText('예약 경로');
        await page.keyboard.press('Escape');
        const unused = canvas.locator('[data-workflow-node="partial"] [data-output-port="no"]');
        await unused.press('Control+ArrowDown');
        await expect(unused).toBeFocused();
        await expect(canvas.getByRole('status')).toContainText('연결된 선이 없습니다');
      }
      assert.deepEqual((await api('project.open',{id:project.id})).graph,project.graph);
      await page.getByRole('button',{name:'캔버스로 보기',exact:true}).press('Enter');
      const moving = block('free');
      await moving.press('Control+ArrowDown');
      await expect(canvas.getByRole('status')).toContainText('연결된 선이 없습니다');
      for (let step=0; step<10; step++) await moving.press('Shift+ArrowRight');
      await expect(canvas.getByRole('status')).toContainText('문장 검토');
      const topBlock = () => moving.evaluate(el => {
        const box = el.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width/2,box.y + box.height/2)?.closest<HTMLElement>('[data-workflow-node]')?.dataset.workflowNode;
      });
      await expect.poll(topBlock).toBe('free');
      await capture('keyboard-block-on-top');
      await block('review').focus();
      await expect.poll(topBlock).toBe('review');
      for (let step=0; step<8; step++) await moving.press('Shift+ArrowLeft');
      await expect(canvas.getByRole('status')).toBeEmpty();
      await page.getByRole('button',{name:'캔버스에 맞추기',exact:true}).press('Enter');
      const from = (await moving.boundingBox())!, to = (await block('review').boundingBox())!;
      const start = {x:from.x+from.width/2,y:from.y+from.height/2};
      const end = {x:to.x+to.width/2,y:to.y+to.height/2};
      await page.mouse.move(start.x,start.y);
      await page.mouse.down();
      await page.mouse.move(end.x,end.y,{steps:5});
      await expect(canvas.getByRole('status')).toContainText('문장 검토');
      await expect.poll(topBlock).toBe('free');
      await page.mouse.up();
      await expect.poll(topBlock).toBe('free');
      await page.keyboard.press('Control+s');
      await expect.poll(async () => {
        const saved = (await api('project.open',{id:project.id})).graph as Graph;
        const first = saved.nodes.find(node => node.id === 'free')!;
        const second = saved.nodes.find(node => node.id === 'review')!;
        return Math.max(Math.abs(first.x-second.x),Math.abs(first.y-second.y));
      }).toBeLessThanOrEqual(2);
    } finally {await context.close();}
}
try {
  await verifyDesktop();
  console.log('PASS desktop keyboard path selection, named output tracing, focus return and overlapping block placement.');
} finally {await browser.close();}
