import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium, expect, type BrowserContext} from '@playwright/test';

const baseURL=process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소를 지정하세요.');
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome)?chrome:undefined)});
async function api(context:BrowserContext, action:string, data={}) {
  const response=await context.request.post('/api/studio',{data:{action,data}});
  const result=await response.json();
  assert.ok(response.ok(),result.error);
  return result.data;
}
for (const mobile of [false,true]) {
  const context=await browser.newContext({baseURL,viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
  try {
    await registerBrowserAccount(context);
    const project=await api(context,'project.create',{lesson:'parallel'});
    const page=await context.newPage();
    const errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/?view=projects');
    const row=page.locator('[data-project-id="'+project.id+'"]');
    await row.click();
    const button=(name:string)=>page.getByRole('button',{name,exact:true});
    const block=(id:string)=>page.locator('[data-canvas-block="'+id+'"]');
    const team=block('team');
    const split=block('split');
    if (mobile) {
      await button('시험 실행').click();
      await expect(page.getByRole('tab',{name:'실행 결과'})).toHaveAttribute('aria-selected','true');
      await page.goBack();
      await expect(page.getByRole('dialog',{name:'속성 패널'})).toHaveCount(0);
      await page.goForward();
      await expect(page.getByRole('tab',{name:'실행 결과'})).toHaveAttribute('aria-selected','true');
      await button('실행 화면 닫기').click();
      await expect(page.getByRole('dialog',{name:'속성 패널'})).toHaveCount(0);
      await button('캔버스로 보기').click();
    }
    await button('축소').click();
    await team.focus();
    const camera=()=>page.locator('.ws-world').getAttribute('style');
    const parentView=await camera();
    await team.press('Enter');
    if (mobile) {
      await expect(page.getByRole('dialog',{name:'속성 패널'})).toBeVisible();
      await page.goBack();
      await expect(team).toBeFocused();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.goForward();
    }
    await button('팀 열기').click();
    await expect(split).toBeVisible();
    await page.goBack();
    await expect(team).toBeFocused();
    await expect.poll(camera).toBe(parentView);
    await page.goForward();
    await expect(split).toBeVisible();
    await split.focus();
    await split.press('Enter');
    const inspector=page.locator('.ws-inspector');
    await inspector.getByLabel('이름',{exact:true}).fill('두 담당자에게 조사 요청');
    if (mobile) {
      // Reload while inspecting the child: previous entries still belong to this project.
      await page.keyboard.press('Control+s');
      await expect(page.locator('.ws-save-badge')).toContainText('저장됨');
      await page.reload();
      await expect(inspector.getByLabel('이름',{exact:true})).toHaveValue('두 담당자에게 조사 요청');
      await page.goBack();
      await expect(page.getByRole('dialog',{name:'속성 패널'})).toHaveCount(0);
      await expect(split).toBeFocused();
    }
    await button('설계 검사').click();
    await expect(page.getByRole('dialog',{name:'설계 검사'})).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog',{name:'설계 검사'})).toHaveCount(0);
    await expect(split).toBeVisible();
    await page.goBack();
    await expect(team).toBeFocused();
    await page.goBack();
    await expect(row).toBeVisible();
    await expect(row).toBeFocused();
    const saved=await api(context,'project.open',{id:project.id});
    assert.equal(saved.graph.nodes.find((node:{id:string})=>node.id==='team').graph.nodes.find((node:{id:string})=>node.id==='split').title,'두 담당자에게 조사 요청');
    const direct=await context.newPage();
    await direct.goto('/?edit='+project.id);
    await expect(direct.locator('[data-canvas-block="team"]')).toBeVisible();
    await direct.goBack();
    await expect(direct.locator('[data-project-id="'+project.id+'"]')).toBeVisible();
    if (mobile) {
      await direct.locator('[data-project-id="'+project.id+'"]').click();
      await direct.locator('[data-canvas-block="team"]').click();
      await expect(direct.getByRole('dialog',{name:'속성 패널'})).toBeVisible();
      const moves=await direct.evaluateHandle(() => {
        const calls:number[]=[];
        const go=history.go.bind(history);
        history.go=(delta=0) => {
          calls.push(delta);
          go(delta);
        };
        return calls;
      });
      await direct.setViewportSize({width:1440,height:900});
      await expect(direct.getByRole('complementary',{name:'속성 패널'})).toBeVisible();
      assert.deepEqual(await moves.jsonValue(),[], 'Changing viewport size must not traverse browser history.');
      await moves.dispose();
      const next=await api(context,'project.create',{lesson:'beginner'});
      await direct.goto('/?edit='+next.id);
      await expect(direct.locator('[data-canvas-block="rules"]')).toBeVisible();
    }
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
}
await browser.close();
console.log('PASS desktop/mobile Back and Forward through editor dialogs, properties and team, camera and project list focus, reload and saved edits.');
