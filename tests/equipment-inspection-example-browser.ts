import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp, mkdir, rm, rmdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium, expect} from '@playwright/test';
import {inspectionExampleHtml} from '../src/domain/equipment-inspection-example';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const scratch = await mkdtemp(join(tmpdir(),'equipment-inspection-'));
const file = join(scratch, 'equipment-inspection.html');
const browser = await chromium.launch({
  executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined),
});

try {
  await writeFile(file, inspectionExampleHtml, 'utf8');
  for (const width of [1280, 1440]) {
    const context = await browser.newContext({offline:true, viewport:{width, height:900}});
    const page = await context.newPage();
    const requests:string[] = [];
    const errors:string[] = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(file).href);
    const inventory = page.getByRole('table',{name:'반납 장비'});
    const receipt = page.getByRole('textbox',{name:'검증 기록',exact:true});
    const input = page.getByRole('textbox',{name:'검수 알림',exact:true});
    const submit = page.getByRole('button',{name:'알림 입력',exact:true});
    const log = page.getByRole('table',{name:'처리 이력'});
    await expect(inventory.locator('tbody tr')).toHaveCount(3);
    await page.getByText('검증 기록 보기',{exact:true}).click();
    const initial = JSON.parse(await receipt.inputValue()).initialEquipment;
    const event = JSON.parse(await input.inputValue());
    assert.equal(event.equipmentId,'A-17');
    await submit.click();
    let recorded = JSON.parse(await receipt.inputValue());
    assert.equal(recorded.verified,false);
    assert.equal(recorded.history.length,1);
    assert.equal(recorded.deliveries[0].result,'applied');
    await submit.focus();
    await page.keyboard.press('Enter');
    recorded = JSON.parse(await receipt.inputValue());
    assert.equal(recorded.verified,true);
    assert.deepEqual(recorded.deliveries.map((item:{result:string})=>item.result),['applied','duplicate']);
    assert.deepEqual(recorded.history,[event]);
    assert.deepEqual(recorded.initialEquipment,initial);
    assert.deepEqual(recorded.equipment,initial.map((item:{equipmentId:string}) =>
      item.equipmentId==='A-17' ? {...item,inspectionStatus:'검수 완료'} : item));
    await expect(inventory.locator('tbody tr').filter({hasText:'A-17'})).toContainText('검수 완료');
    await expect(log.locator('tbody tr')).toHaveCount(1);
    await expect(log).toContainText(event.eventId);
    await page.getByRole('button',{name:'검증 기록 복사'}).press('Enter');
    await expect(page.locator('#copy-note')).toHaveText(/복사했습니다|Ctrl\+C/);
    if ((await page.locator('#copy-note').textContent())?.includes('Ctrl+C')) {
      await expect(receipt).toBeFocused();
      assert.ok(await receipt.evaluate(node=>
        node instanceof HTMLTextAreaElement && node.selectionStart===0 && node.selectionEnd===node.value.length));
    }
    if (width === 1440 && process.env.STUDIO_SCREENSHOTS) {
      await mkdir(process.env.STUDIO_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,'equipment-inspection-example.png'),fullPage:true});
    }
    await page.setViewportSize({width:width/2,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await input.fill(JSON.stringify({...event,equipmentId:'B-08'}));
    await submit.press('Enter');
    await expect(page.getByRole('status')).toContainText('다른 장비');
    assert.equal((await receipt.inputValue()),JSON.stringify(recorded,null,2));
    await input.fill('{');
    await submit.press('Enter');
    await expect(page.getByRole('status')).toContainText('JSON');
    assert.equal((await receipt.inputValue()),JSON.stringify(recorded,null,2));
    await page.getByRole('button',{name:'실습 초기화'}).press('Enter');
    await expect(log.locator('tbody tr')).toHaveCount(0);
    await input.fill(JSON.stringify({...event,equipmentId:'A-99'}));
    await submit.press('Enter');
    await expect(page.getByRole('status')).toContainText('장비 목록');
    const alternate = {...event,eventId:'inspect-202',equipmentId:'B-08'};
    await input.fill(JSON.stringify(alternate));
    await submit.click();
    await submit.press('Enter');
    const second = JSON.parse(await receipt.inputValue());
    assert.ok(second.verified);
    assert.deepEqual(second.history,[alternate]);
    assert.deepEqual(second.equipment,initial.map((item:{equipmentId:string}) =>
      item.equipmentId==='B-08' ? {...item,inspectionStatus:'검수 완료'} : item));
    await page.getByRole('button',{name:'A-17',exact:true}).press('Enter');
    await expect(log.locator('tbody tr')).toHaveCount(0);
    await page.getByRole('button',{name:'B-08',exact:true}).press('Enter');
    await expect(log).toContainText('inspect-202');
    assert.deepEqual(errors,[]);
    assert.deepEqual(requests,[]);
    await context.close();
  }
  console.log('PASS offline inspection exercise, duplicate deliveries, alternate equipment, conflicts, keyboard and split windows');
} finally {
  await browser.close();
  await rm(file,{force:true});
  await rmdir(scratch);
}
