import assert from 'node:assert/strict';
import { registerBrowserAccount } from './browser-account';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { createBlock, type Graph } from '../src/domain';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 Studio 시험 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome)?chrome:undefined)});

async function api(ctx:BrowserContext, action:string, data:unknown={}) {
  const response = await ctx.request.post('/api/studio', {data:{action,data}});
  const body = await response.json();
  assert.ok(response.ok(), action+' '+response.status()+' '+(body.error??''));
  return body.data;
}
async function openGallery(page:Page) {
  const menu = page.getByRole('button',{name:'메뉴 열기',exact:true});
  if (await menu.isVisible()) await menu.click();
  const nav = page.getByRole('navigation',{name:'작업 화면'}).getByRole('group',{name:'공유',exact:true});
  const names = await nav.getByRole('button').allTextContents();
  assert.equal(names[names.indexOf('공유 Agent')+1],'공유 도구 및 자료');
  await nav.getByRole('button',{name:'공유 도구 및 자료',exact:true}).click();
  await expect(page.getByRole('heading',{name:'공유 도구 및 자료',exact:true})).toBeVisible();
}
async function capture(page:Page, name:string) {
  if (!process.env.STUDIO_SCREENSHOTS) return;
  mkdirSync(process.env.STUDIO_SCREENSHOTS,{recursive:true});
  await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,name+'.png')});
}

async function signUpFromPinnedLink(owner:BrowserContext, note:{id:string;name:string}, token:string) {
  await api(owner,'asset.save',{id:note.id,baseVersion:1,name:note.name, payload:{content:'직원 안내 개정 지침'}});
  await api(owner,'asset.share',{id:note.id,visibility:'link',version:2});
  const context=await browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try {
    const page=await context.newPage();
    await page.goto('/?asset='+note.id+'&edition=1&token='+token);
    await expect(page.getByRole('heading',{name:'로그인',exact:true})).toBeVisible();
    await expect(page.getByText('직원 안내 지침',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'계정 만들기',exact:true}).click();
    await page.getByLabel('아이디',{exact:true}).fill('edition-'+crypto.randomUUID().slice(0,12));
    const password=page.getByLabel('비밀번호',{exact:true});
    const reveal=page.getByRole('button',{name:'비밀번호 표시',exact:true});
    await password.fill(crypto.randomUUID());
    await reveal.tap();
    await expect(password).toHaveAttribute('type','text');
    await expect(reveal).toHaveAttribute('aria-pressed','true');
    await reveal.press('Space');
    await expect(password).toHaveAttribute('type','password');
    await page.getByRole('button',{name:'계정 만들기',exact:true}).click();
    const detail=page.getByRole('region',{name:'도구 및 자료'});
    await expect(detail.getByRole('heading',{name:note.name,exact:true})).toBeVisible();
    await expect(detail.getByLabel('자료 버전')).toHaveValue('1');
    const instructions=detail.locator('section').filter({has:page.getByRole('heading',{name:'작업 지침',exact:true})});
    await expect(instructions.locator('pre')).toHaveText('직원 안내 지침');
  } finally {await context.close();}
}

function matchingTeam(id:string) {
  return createBlock('agent.team',{id,title:'안내 팀',graph:{
    nodes:[createBlock('agent.task',{id:'library-agent',title:'대출 안내 담당'})],edges:[],
  }});
}
async function verifyNestedPin(reader:BrowserContext,page:Page,projectId:string,assetId:string) {
  const saved=async ():Promise<Graph> => (await api(reader,'project.open',{id:projectId})).graph;
  const nested=(graph:Graph) => graph.nodes.find(n=>n.id==='team-b')!.graph!;
  const before=await saved();
  await page.goto('/?view=shared-assets&asset='+assetId+'&edition=1');
  await page.getByRole('button',{name:'내 Workflow에 연결',exact:true}).click();
  const project = await api(reader,'project.open',{id:projectId});
  await page.getByRole('dialog',{name:'프로젝트 선택'}).getByRole('button',{name:new RegExp(project.title)}).click();
  const connect=page.getByRole('dialog',{name:'자료를 연결할 블록'});
  const select=connect.getByLabel('연결할 블록');
  const optionLabels=await select.locator('option').allTextContents();
  assert.ok(optionLabels.includes('1번 · 안내 팀 › 대출 안내 담당'));
  const second='2번 · 안내 팀 › 대출 안내 담당';
  await select.selectOption({label:second});
  await connect.getByRole('button',{name:'선택한 판 연결',exact:true}).click();
  await expect(connect).toHaveCount(0);
  async function saveAfterShortcut(shortcut?:string) {
    const panel=page.getByRole('dialog',{name:'속성 패널'});
    if(await panel.isVisible())await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'설계 검사',exact:true}).focus();
    if(shortcut)await page.keyboard.press(shortcut);
    await page.keyboard.press('Control+s');
  }
  await saveAfterShortcut();
  await expect.poll(async()=>nested(await saved()).nodes.some(n=>n.config.assetId===assetId)).toBe(true);
  const after=await saved(), branch=nested(after);
  assert.deepEqual(after.nodes.filter(n=>n.id!=='team-b'),before.nodes.filter(n=>n.id!=='team-b'));
  assert.deepEqual(after.edges,before.edges);
  const source=branch.nodes.find(n=>n.config.assetId===assetId)!;
  assert.equal(source.type,'resource.context');assert.equal(source.config.version,1);
  assert.ok(branch.edges.some(e=>e.kind==='reference'&&e.from===source.id&&e.to==='library-agent'&&e.out==='ref'&&e.input==='context'));
  await saveAfterShortcut('Control+z');
  await expect.poll(saved).toEqual(before);
  await saveAfterShortcut('Control+Shift+z');
  await expect.poll(saved).toEqual(after);

  const reopened=await reader.newPage();
  try {
    await reopened.goto('/?edit='+projectId);
    const canvas=reopened.getByRole('button',{name:'캔버스로 보기',exact:true});
    const team=reopened.locator('[data-canvas-block="team-b"]');
    const pinned=reopened.locator('[data-canvas-block="'+source.id+'"]');
    await expect(team.or(pinned).or(canvas).first()).toBeVisible();
    if(await canvas.isVisible())await canvas.click();
    if(await team.isVisible()){
      await team.focus(); await team.press('Enter');
      await reopened.getByRole('button',{name:'팀 열기',exact:true}).click();
    }
    await expect(pinned).toBeVisible();
  } finally {await reopened.close();}
}

async function check(width:number) {
  const owner = await browser.newContext({baseURL});
  const reader = await browser.newContext({baseURL,viewport:{width,height:width===390?844:900},isMobile:width===390,hasTouch:width===390});
  try {
    await registerBrowserAccount(owner);
    await registerBrowserAccount(reader);
    const tag = crypto.randomUUID().slice(0,8);
    const firstName = '도서관 이용규정 '+tag, secondName = '여름 이용규정 '+tag, draftName = '미게시 초안 '+tag;
    const doc = await api(owner,'asset.save',{name:firstName,kind:'document',payload:{content:'대출 한도 3권'}});
    await api(owner,'asset.share',{id:doc.id,visibility:'public',version:1});
    await api(owner,'asset.save',{id:doc.id,baseVersion:1,name:secondName,payload:{content:'대출 한도 5권'}});
    await api(owner,'asset.share',{id:doc.id,visibility:'public',version:2});
    await api(owner,'asset.save',{id:doc.id,baseVersion:2,name:draftName,payload:{content:'대출 한도 7권'}});
    const note = await api(owner,'asset.save',{name:'직원 안내 '+tag,kind:'skill',payload:{content:'직원 안내 지침'}});
    const shared = await api(owner,'asset.share',{id:note.id,visibility:'link',version:1});
    if (width===390) await signUpFromPinnedLink(owner,note,shared.token);

    const authorPage = await owner.newPage();
    await authorPage.goto('/?view=shared-assets');
    const authorGallery = authorPage.getByRole('region',{name:'공유 도구 및 자료'});
    await authorGallery.getByRole('button',{name:new RegExp(secondName)}).click();
    await expect(authorGallery.getByLabel('자료 버전')).toHaveValue('2');
    assert.deepEqual(await authorGallery.getByLabel('자료 버전').locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value)),['2','1']);
    await expect(authorGallery.getByRole('button',{name:'수정',exact:true})).toHaveCount(0);

    const graph:Graph = {
      nodes:[createBlock('input.user_request',{id:'ask'}),createBlock('agent.task',{id:'library-agent',title:'대출 안내 담당'}),
        createBlock('output.answer',{id:'answer'}),matchingTeam('team-a'),matchingTeam('team-b')],
      edges:[{id:'start',from:'ask',to:'library-agent',kind:'flow',out:'next',input:'in'},{id:'finish',from:'library-agent',to:'answer',kind:'flow',out:'next',input:'in'}],
    };
    const project = await api(reader,'project.create',{title:'내 도서관 '+tag,graph});
    const page = await reader.newPage();
    await page.goto('/?view=assets');
    await expect(page.getByRole('heading',{name:'도구 및 자료',exact:true})).toBeVisible();
    await openGallery(page);
    const gallery = page.getByRole('region',{name:'공유 도구 및 자료'});
    const received = gallery.getByRole('tab',{name:'직접 받은 자료'});
    await expect(gallery.getByRole('tab',{name:'모두에게 공개'})).toHaveAttribute('aria-selected','true');
    await gallery.getByRole('searchbox').fill(tag);
    await gallery.getByLabel('종류',{exact:true}).selectOption('document');
    await expect(gallery.getByRole('button',{name:new RegExp(draftName)})).toHaveCount(0);
    await received.click();
    await expect(gallery.getByRole('button',{name:new RegExp(note.name)})).toHaveCount(0);
    await page.goto('/?asset='+note.id+'&edition=published&token='+shared.token);
    await expect(page.getByRole('heading',{name:note.name,exact:true})).toBeVisible();
    await openGallery(page);
    await received.click();
    await gallery.getByLabel('종류',{exact:true}).selectOption('skill');
    await expect(gallery.getByRole('button',{name:new RegExp(note.name)})).toBeVisible();
    await api(owner,'asset.share',{id:note.id,visibility:'link',rotate:true});
    await page.reload();
    await received.click();
    await expect(gallery.getByRole('button',{name:new RegExp(note.name)})).toHaveCount(0);
    await gallery.getByRole('tab',{name:'모두에게 공개'}).click();
    await gallery.getByLabel('종류',{exact:true}).selectOption('document');
    await gallery.getByRole('searchbox').fill(tag);
    await gallery.getByRole('button',{name:new RegExp(secondName)}).click();
    await gallery.getByLabel('자료 버전').selectOption('1');
    await expect(gallery.getByRole('heading',{name:firstName})).toBeVisible();
    await expect(gallery.locator('.rl-source')).toHaveText('대출 한도 3권');
    await capture(page,'shared-resource-edition-'+width);
    await gallery.getByRole('button',{name:'내 Workflow에 연결'}).click();
    await page.getByRole('dialog',{name:'프로젝트 선택'}).getByRole('button',{name:new RegExp(project.title)}).click();
    const connect = page.getByRole('dialog',{name:'자료를 연결할 블록'});
    await connect.getByLabel('연결할 블록').selectOption('library-agent');
    await capture(page,'shared-resource-connect-'+width);
    await connect.getByRole('button',{name:'선택한 판 연결',exact:true}).click();
    await expect(connect).toHaveCount(0);
    if (width === 1440) {
      const sourcePicker = page.getByRole('combobox',{name:'연결할 자료',exact:true});
      await expect(sourcePicker).toHaveValue(doc.id);
      await expect(sourcePicker.locator('option:checked')).toContainText(secondName + ' · 공유 자료');
      await expect(page.getByLabel('고정할 자료 버전')).toHaveValue('1');
    }
    await page.keyboard.press('Control+s');
    await expect.poll(async () => {
      const saved:Graph = (await api(reader,'project.open',{id:project.id})).graph;
      const block = saved.nodes.find(n=>n.type==='resource.context'&&n.config.assetId===doc.id);
      return Boolean(block?.config.version===1 && saved.edges.some(e=>e.from===block.id&&e.out==='ref'&&e.to==='library-agent'&&e.input==='context'&&e.kind==='reference'));
    }).toBe(true);
    await verifyNestedPin(reader,page,project.id,doc.id);
    await page.goto('/?view=shared-assets&asset='+doc.id+'&edition=1');
    await gallery.getByRole('button',{name:'내 사본 만들기',exact:true}).click();
    const copyName=firstName+' 사본';
    await expect(page.getByRole('region',{name:'도구 및 자료'}).getByRole('heading',{name:copyName})).toBeVisible();
    const copy = (await api(reader,'asset.list')).find((a:{name:string})=>a.name===copyName);
    assert.ok(copy.mine && copy.visibility==='private' && copy.id!==doc.id);
    await api(owner,'asset.share',{id:doc.id,visibility:'private'});
    assert.equal((await api(reader,'asset.read',{id:copy.id})).payload.content,'대출 한도 3권');
    const denied=await reader.request.post('/api/studio',{data:{action:'asset.read',data:{id:doc.id,version:1,sharedCatalog:true}}});
    assert.equal(denied.status(),403);
  } finally {
    await reader.close(); await owner.close();
  }
}

try {
  await check(1440);
  await check(390);
  console.log('PASS desktop/mobile published editions, received-link rotation, selecting a workflow target and saving an independent copy.');
} finally { await browser.close(); }
