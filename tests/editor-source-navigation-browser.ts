import { registerBrowserAccount } from './browser-account';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {chromium, expect, type BrowserContext, type Page} from '@playwright/test';
import {createBlock, type Graph} from '../src/domain';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소를 지정하세요.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});

async function api(context: BrowserContext, action: string, data = {}) {
  const response = await context.request.post('/api/studio', {data:{action,data}});
  const result = await response.json();
  assert.ok(response.ok(), action + ' ' + (result.error || ''));
  return result.data;
}

async function capture(page: Page, name: string) {
  const dir = process.env.STUDIO_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, {recursive:true});
  await page.screenshot({path:join(dir, name + '-' + page.viewportSize()!.width + '.png')});
}

const rule = '한 사람의 대출 한도는 3권입니다.';
const sourceGraph: Graph = {
  nodes:[
    createBlock('input.user_request',{id:'q',x:20,y:60}),
    createBlock('knowledge.search',{id:'search',x:260,y:60}),
    createBlock('output.answer',{id:'answer',x:500,y:60}),
    createBlock('resource.context',{id:'rule',title:'도서관 이용규정',x:260,y:180,config:{content:rule}}),
  ],
  edges:[
    {id:'start',from:'q',to:'search',kind:'flow',out:'next',input:'in'},
    {id:'question',from:'q',to:'search',kind:'data',out:'value',input:'input'},
    {id:'end',from:'search',to:'answer',kind:'flow',out:'next',input:'in'},
    {id:'result',from:'search',to:'answer',kind:'data',out:'value',input:'input'},
    {id:'source',from:'rule',to:'search',kind:'reference',out:'ref',input:'context'},
  ],
};

async function check(mobile: boolean) {
  const context = await browser.newContext({baseURL,viewport: mobile ? {width:390,height:844} : {width:1440,height:900},
    hasTouch:mobile,isMobile:mobile});
  context.setDefaultTimeout(15000);
  try {
    await registerBrowserAccount(context);
    const page = await context.newPage();
    const button = (name: string) => page.getByRole('button',{name,exact:true});
    const project = await api(context,'project.create',{title:'원문 선택 실습',graph:sourceGraph});
    await page.goto('/?edit=' + project.id);
    await button('목록으로 편집').click();
    await page.locator('[data-canvas-block="rule"]').click();
    const text = page.getByRole('textbox',{name:'자료 원문',exact:true});
    await text.fill(rule.replace('3권','5권'));
    await page.getByRole('tab',{name:'실행 결과'}).click();
    const panel = page.getByRole('tabpanel',{name:'실행 결과'});
    const choice = panel.getByRole('region',{name:'시험에 사용할 원문'});
    await expect(choice).toBeVisible();
    await choice.getByText('도서관 이용규정 원문 비교').click();
    await expect(choice).toContainText('3권');
    await expect(choice).toContainText('5권');
    await expect(button('질문 실행')).toHaveCount(0);
    await capture(page,'source-test-choice');
    await button('현재 적용된 원문으로 시험').click();
    async function ask(expected: string) {
      await panel.locator('.run-compose textarea').fill('대출 한도는?');
      await button('질문 실행').click();
      await expect(panel.locator('.run-output').last()).toContainText(expected,{timeout:20000});
    }
    await ask('3권');
    const savedSource = async () => ((await api(context,'project.open',{id:project.id})).graph as Graph)
      .nodes.find(node => node.id === 'rule')!.config.content;
    assert.equal(await savedSource(),rule);
    if (mobile) await button('실행 화면 닫기').click();
    const projectAction = async (name: string) => {
      await page.getByLabel('프로젝트 메뉴',{exact:true}).click();
      await button(name).click();
    };
    await projectAction('내보내기');
    const exporter = page.getByRole('dialog',{name:'설계 내보내기'});
    await expect(exporter).toContainText('3권');
    await exporter.getByRole('combobox').selectOption('edited');
    await expect(exporter).toContainText('마지막 시험과 원문이 다릅니다.');
    const downloadPromise = page.waitForEvent('download');
    await exporter.getByRole('button',{name:'JSON 내려받기'}).click();
    const downloaded = JSON.parse(await readFile((await (await downloadPromise).path())!,'utf8'));
    assert.equal(downloaded.graph.nodes.find((n:{id:string})=>n.id==='rule').config.content,rule.replace('3권','5권'));
    assert.equal(await savedSource(),rule);
    await projectAction('버전');
    const versions = page.getByRole('dialog',{name:'버전 및 복구'});
    await expect(versions).toContainText('5권');
    await expect(versions).toContainText('마지막 시험과 원문이 다릅니다.');
    await versions.getByLabel('버전 저장에 포함할 원문',{exact:true}).selectOption('applied');
    await expect(versions.getByText('마지막 시험과 원문이 다릅니다.')).toHaveCount(0);
    let lostVersion=false;
    await page.route('**/api/studio',async route=>{
      if(!lostVersion && route.request().postDataJSON()?.action==='versions.save'){
        lostVersion=true;
        assert.equal((await route.fetch()).ok(),true);
        await route.abort('failed');
      }else await route.continue();
    });
    await versions.getByRole('button',{name:'현재 초안 버전 저장'}).click();
    await expect(versions.getByRole('alert')).toBeVisible();
    await versions.getByRole('button',{name:'현재 초안 버전 저장'}).click();
    await expect(versions.getByLabel('대상 버전')).toHaveValue('1');
    assert.equal((await api(context,'versions.list',{id:project.id})).length,1);
    const fixtureQuestion='대출 한도는?';
    const sample=await api(context,'cases.save',{id:project.id,title:'타 지점 이용규정',input:fixtureQuestion,expected:'9권',fixture:{documents:{rule:'타 지점의 대출 한도는 9권입니다.'}}});
    const versionOne = await api(context,'run.start',{id:project.id,caseId:sample.id,version:1,mode:'test',input:fixtureQuestion,requestKey:crypto.randomUUID()});
    await expect.poll(async () => (await api(context,'run.get',{id:project.id,runId:versionOne.id})).output,{timeout:20000}).toContain('9권');
    await page.keyboard.press('Escape');
    for(const action of ['버전','내보내기']){
      await projectAction(action);
      const dialog=action==='버전'?versions:exporter;
      await expect(dialog).toContainText('마지막 시험 대상 · v1');
      await expect(dialog).toContainText('9권');
      await page.keyboard.press('Escape');
    }
    if (mobile && !await page.getByRole('dialog',{name:'속성 패널'}).isVisible()) await button('속성 열기').click();
    await page.getByRole('tab',{name:'속성',exact:true}).click();
    await expect(text).toHaveValue(rule.replace('3권','5권'));
    // Reopen from the top bar as well as the results tab.
    if (mobile) await button('속성 닫기').click();
    await button('시험 실행').click();
    await button('수정한 원문을 적용하고 시험').click();
    await ask('5권');
    assert.equal(await savedSource(),rule.replace('3권','5권'));
    const logs = await api(context,'run.list',{id:project.id}) as {conversation:string}[];
    assert.equal(new Set(logs.map(log => log.conversation)).size,3);
    await capture(page,'source-test-updated');

    // Another tab must not replace the first tab's edit, even after a reload.
    const longRule = Array.from({length:31},(_,i)=>'제'+(i+1)+'조 '+(i<30?'도서관 이용 안내':'제5조에 따라 대출 한도는 3권입니다.')).join('\n');
    const longGraph = {...sourceGraph,nodes:sourceGraph.nodes.map(n=>n.id==='rule'?{...n,config:{...n.config,content:longRule}}:n)};
    const secondProject = await api(context,'project.create',{title:'두 탭 원문 복구',graph:longGraph});
    const openSource = async (tab:Page) => {
      await tab.goto('/?edit='+secondProject.id);
      await tab.getByRole('button',{name:'목록으로 편집',exact:true}).click();
      await tab.locator('[data-canvas-block="rule"]').click();
      return tab.getByRole('textbox',{name:'자료 원문',exact:true});
    };
    const firstText = await openSource(page);
    await firstText.fill(longRule.replace('3권','5권'));
    const otherTab = await context.newPage();
    const otherText = await openSource(otherTab);
    await otherText.fill(longRule.replace('3권','7권'));
    await page.reload();
    await expect(page.locator('.ws-graph-list')).toBeAttached();
    await expect(page.locator('[data-canvas-block="rule"]')).toHaveAttribute('aria-pressed','true');
    await expect(firstText).toHaveValue(longRule.replace('3권','5권'));
    const duplicated = page.waitForEvent('popup');
    await page.evaluate(()=>{ window.open(location.href,'_blank'); });
    const duplicateTab = await duplicated;
    await duplicateTab.getByRole('button',{name:'목록으로 편집',exact:true}).click();
    await duplicateTab.locator('[data-canvas-block="rule"]').click();
    const duplicateText = duplicateTab.getByRole('textbox',{name:'자료 원문',exact:true});
    await expect(duplicateText).toHaveValue(longRule.replace('3권','5권'));
    await duplicateText.fill(longRule.replace('3권','9권'));
    await duplicateTab.close();
    await page.bringToFront();
    if (mobile && !await page.getByRole('dialog',{name:'속성 패널'}).isVisible()) await button('속성 열기').click();
    await page.getByRole('tab',{name:'실행 결과'}).click();
    await page.getByText('도서관 이용규정 원문 비교').click();
    await expect(page.getByRole('heading',{name:'첫 변경 · 제31조'})).toBeInViewport();
    await expect(page.locator('.ws-source-diff del')).toHaveText('3');
    await expect(page.locator('.ws-source-diff ins')).toHaveText('5');
    await capture(page,'changed-article-first');
    await page.getByRole('tab',{name:'속성',exact:true}).click();
    await page.getByText('다른 원문 초안 2개').click();
    await page.locator('.ws-source-recovery li').filter({hasText:'7권'}).getByRole('button',{name:'이 초안 불러오기'}).click();
    await expect(firstText).toHaveValue(longRule.replace('3권','7권'));
    await expect(page.locator('.ws-source-recovery li > p').filter({hasText:'5권'})).toHaveCount(1);
    await expect(otherText).toHaveValue(longRule.replace('3권','7권'));
    await otherTab.close();
    // The default version save includes the recovered draft.
    if (mobile) await button('속성 닫기').click();
    await projectAction('버전');
    await expect(versions.getByLabel('버전 저장에 포함할 원문',{exact:true})).toHaveValue('edited');
    await versions.getByRole('button',{name:'현재 초안 버전 저장'}).click();
    await expect(versions.getByLabel('대상 버전')).toHaveValue('1');
    const savedLong = await api(context,'project.open',{id:secondProject.id});
    assert.match(savedLong.graph.nodes.find((node:{id:string})=>node.id==='rule').config.content,/7권/);
    await page.keyboard.press('Escape');

    const middle = await api(context,'project.create',{lesson:'intermediate'});
    await page.goto('/?edit=' + middle.id);
    if (mobile) await button('캔버스로 보기').click();
    const canvas = page.locator('.ws-canvas');
    // Every focused route must have an actual visible stroke even if the full route is wider than the phone.
    const wires = canvas.locator('.ws-wire');
    await expect(wires).toHaveCount(18);
    await button('연결선으로 이동').focus();
    await page.keyboard.press('Enter');
    const paths = page.getByRole('dialog',{name:'따라갈 연결선 선택'});
    if (await paths.isVisible()) await paths.locator('.ws-wire-choices button').first().press('Enter');
    await expect(canvas.locator('.ws-wire:focus')).toHaveCount(1);
    await page.keyboard.press('Control+ArrowUp');
    await expect(canvas.locator('[data-canvas-block]:focus')).toHaveCount(1);
    await page.keyboard.press('Control+ArrowDown');
    if (await paths.isVisible()) await paths.locator('.ws-wire-choices button').first().press('Enter');
    await expect(canvas.locator('.ws-wire:focus')).toHaveCount(1);
    await wires.first().focus();
    for(let index=0;index<18;index++){
      const wire = wires.nth(index);
      await expect(wire).toBeFocused();
      await expect.poll(() => wire.evaluate(group => {
        const line = group.querySelector<SVGPathElement>('.ws-channel')!;
        const frame = group.closest('.ws-canvas')!.getBoundingClientRect();
        const length = line.getTotalLength();
        for (let i=0;i<=80;i++){
          const point = line.getPointAtLength(length*i/80).matrixTransform(line.getScreenCTM()!);
          if (point.x>frame.left && point.x<frame.right && point.y>frame.top && point.y<frame.bottom-20) return true;
        }
        return false;
      }), {message:'연결선 ' + (index + 1) + '의 강조 경로가 캔버스 안에 보여야 합니다.'}).toBe(true);
      if(index<17) await page.keyboard.press('Tab');
    }
    await capture(page,'focused-connection');

    const parallel = await api(context,'project.create',{lesson:'parallel'});
    await page.goto('/?edit=' + parallel.id);
    await expect(canvas.locator('[data-canvas-block="team"]')).toBeVisible();
    for (const list of [mobile,!mobile]) {
      if ((await canvas.locator('.ws-graph-list').count()>0) !== list)
        await button(list?'목록으로 편집':'캔버스로 보기').click();
      if (!list) await button('축소').click();
      const team = canvas.locator('[data-canvas-block="team"]');
      await team.focus();
      await team.press('Enter');
      const savedView = list ? undefined : await canvas.locator('.ws-world').evaluate(el => el.getAttribute('style'));
      await button('팀 열기').click();
      await expect(canvas.locator('[data-canvas-block="split"]')).toBeVisible();
      if (!list && !mobile) {
        // This member starts at the edge of the readable canvas. Its center can be under the inspector.
        const member = button('회원증 담당 블록 속성');
        await member.click();
        await button('내부 Workflow 열기').click();
        await button('상위 Workflow로').click();
        await expect(member).toBeFocused();
        await expect(member).toBeInViewport({ratio:0.98});
        await member.click();
      }
      await button(list?'캔버스로 보기':'목록으로 편집').click();
      await button('상위 Workflow로').click();
      await expect(team).toBeFocused();
      await expect(team).toHaveAttribute('aria-pressed','true');
      await expect(team).toBeInViewport({ratio:0.98});
      if (!list) {
        await expect(canvas.locator('.ws-world')).toHaveAttribute('style',savedView!);
        await capture(page,'returned-team');
      }
    }
  } finally { await context.close(); }
}
try {
  await check(false);
  await check(true);
  console.log('PASS desktop/mobile original and edited source tests, visible keyboard wires, scope shortcuts and restored team focus.');
} finally { await browser.close(); }
