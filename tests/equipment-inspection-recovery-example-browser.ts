import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, rmdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {inspectionRecoveryHtml} from '../src/domain/equipment-inspection-recovery-example';
import {makeRecoveryDocuments,recoveryScenarios,verifyRecoveryRecord,type RecoveryRecord} from '../src/domain/inspection-recovery.mjs';

const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome)?chrome:undefined)});
const folder=await mkdtemp(join(tmpdir(),'studio-inspection-recovery-'));
const path=join(folder,'equipment-inspection-recovery.html');
const report='# 고급 개발 보고서\nB-08 야간 반납 사례. 중복 수신 2회, 처리 이력 한 건.';
const skill='---\nname: night-audit\ndescription: 야간 점검\n---\n\n# 기존 점검\n인수자 서명을 확인한다.';
try {
  await writeFile(path,inspectionRecoveryHtml,'utf8');
  for (const width of [1280,1440]) {
    const context=await browser.newContext({viewport:{width,height:900},offline:true});
    try {
      const page=await context.newPage();
      const errors:string[]=[],requests:string[]=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('request',r=>{if (/^https?:/.test(r.url())) requests.push(r.url());});
      await page.goto(pathToFileURL(path).href);
      const reportBox=page.getByRole('textbox',{name:'고급 개발 보고서',exact:true});
      const skillBox=page.getByRole('textbox',{name:'고급 점검 Skill',exact:true});
      const recordBox=page.getByRole('textbox',{name:'시도별 검증 기록',exact:true});
      const reportFile=page.getByRole('button',{name:'시도별-검증-보고서.md 내려받기',exact:true});
      const skillFile=page.getByRole('button',{name:'SKILL.md 내려받기',exact:true});
      await expect(reportFile).toBeDisabled();
      await reportBox.fill(report);
      const uploadedSkill=skill.replaceAll('\n','\r\n');
      await page.getByLabel('고급 점검 Skill 파일').setInputFiles({name:'SKILL.md',mimeType:'text/markdown',buffer:Buffer.from(uploadedSkill)});
      await expect(skillBox).toHaveValue(skill);
      const target=width===1440?'B-08':'A-17';
      await page.getByLabel('대상 장비').selectOption(target);
      const scenario=page.getByLabel('시나리오',{exact:true});
      const send=page.getByRole('button',{name:'다음 알림 보내기'});
      await page.getByText('시도별 검증 기록 보기',{exact:true}).click();
      await page.setViewportSize({width:width/2,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      for (const {id} of recoveryScenarios) {
        await scenario.selectOption(id);
        await send.click();
        const first:RecoveryRecord=JSON.parse(await recordBox.inputValue());
        const attempt=first.scenarios.find(s=>s.id===id)!.attempts[0];
        assert.equal(attempt.history.length,id==='before-save' ? 0 : 1);
        assert.equal(attempt.equipment.find(e=>e.equipmentId===target)?.inspectionStatus,id==='before-save'?'검수 대기':'검수 완료');
        await expect(page.getByRole('table',{name:'1차 수신 직후 장비 목록',exact:true})).toContainText(target);
        await send.press('Enter');
        await expect(send).toBeDisabled();
        await expect(page.getByRole('table',{name:'2차 수신 직후 장비 목록',exact:true})).toContainText('검수 완료');
      }
      const record:RecoveryRecord=JSON.parse(await recordBox.inputValue());
      assert.ok(record.verified && verifyRecoveryRecord(record));
      await expect(page.getByText('검증 통과 · '+target+' · 시나리오 3/3 완료')).toBeVisible();
      const docs=makeRecoveryDocuments(report,uploadedSkill,record);
      for (const [button,name,expected] of [[reportFile,'시도별-검증-보고서.md',docs.report],[skillFile,'SKILL.md',docs.skill]] as const) {
        const pending=page.waitForEvent('download');
        await button.press('Enter');
        const download=await pending;
        assert.equal(download.suggestedFilename(),name);
        assert.equal(await readFile((await download.path())!,'utf8'),expected);
      }
      await page.getByRole('button',{name:'검증 기록 복사',exact:true}).press('Enter');
      await expect(page.locator('#copy-note')).toHaveText(/복사했습니다|Ctrl\+C/);
      if (width===1440 && process.env.STUDIO_SCREENSHOTS) {
        await page.setViewportSize({width,height:1000});
        await page.getByText('시도별 검증 기록 보기',{exact:true}).click();
        await mkdir(process.env.STUDIO_SCREENSHOTS,{recursive:true});
        await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,'equipment-inspection-recovery-example.png'),fullPage:true});
      }
      await page.getByRole('button',{name:'현재 시나리오 초기화'}).click();
      await expect(reportFile).toBeDisabled();
      assert.deepEqual(requests,[]);
      assert.deepEqual(errors,[]);
    } finally {await context.close();}
  }
  console.log('PASS 오프라인 전문가 실습 · 장비 두 대의 세 시나리오와 여섯 시도 · 파일 선택/붙여넣기와 두 문서 다운로드 · 분할 창');
} finally {
  await browser.close();
  await rm(path,{force:true});
  await rmdir(folder);
}
