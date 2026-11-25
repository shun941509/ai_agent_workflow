import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {posix} from 'node:path';
import {chromium, expect, type Locator, type Page} from '@playwright/test';
import {strFromU8, unzipSync} from 'fflate';
import {createBlock, type Graph} from '../src/domain';
import type {ExportResource} from '../src/domain/agent-export';
import {registerBrowserAccount} from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소를 지정하세요.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined),
});
const original = '원래 규정은 3권입니다.';
const applied = '새 대출 한도는 5권입니다.';
const pending = '아직 검토 중인 7권 규정입니다.';
const omit = '내부 검토 자료 42호';
const skillText = '---\nname: cite-policy\ndescription: 대출 규정을 인용합니다.\n---\n이용규정 문장을 인용하세요.';
const publicAddress = 'https://catalog.example.org/library/mcp';
const graph:Graph = {
  nodes:[
    createBlock('input.user_request',{id:'start'}),
    createBlock('ai.single_task',{id:'work'}),
    createBlock('output.answer',{id:'end'}),
    createBlock('resource.context',{id:'rule',title:'대출 규정',config:{content:original}}),
    createBlock('resource.context',{id:'internal',title:'회의 참고자료',config:{content:omit}}),
    createBlock('instruction.skill',{id:'cite',title:'규정 인용 Skill',config:{content:skillText}}),
    createBlock('connection.mcp',{id:'local-mcp',title:'내장 도서관 연결',config:{server:'library'}}),
  ],
  edges:[
    {id:'begin',kind:'flow',from:'start',out:'next',to:'work',input:'in'},
    {id:'task',kind:'data',from:'start',out:'value',to:'work',input:'input'},
    {id:'done',kind:'flow',from:'work',out:'next',to:'end',input:'in'},
    {id:'answer',kind:'data',from:'work',out:'value',to:'end',input:'input'},
    ...['rule','internal'].map(from => ({id:from+'-ref',kind:'reference' as const,from,out:'ref',to:'work',input:'context'})),
    {id:'cite-ref',kind:'reference',from:'cite',out:'ref',to:'work',input:'skill'},
    {id:'library-ref',kind:'reference',from:'local-mcp',out:'ref',to:'work',input:'mcp'},
  ],
};

async function downloadZip(page:Page, dialog:Locator, filename = '대출 안내.zip') {
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button',{name:'ZIP 내려받기'}).click();
  const zip = await downloading;
  assert.equal(zip.suggestedFilename(),filename);
  return unzipSync(await readFile((await zip.path())!));
}

async function checkLargeExport(page:Page) {
  const checks = Array.from({length:220}, (_, i) => '검토 항목 ' + (i + 1) + '의 근거 문장을 확인하세요.');
  const largeGraph:Graph = {
    nodes:[
      createBlock('input.user_request',{id:'start',title:'대출 규정 접수'}),
      createBlock('ai.single_task',{id:'work',title:'규정 검토문 작성',config:{instruction:checks.join('\n')}}),
      createBlock('output.answer',{id:'end',title:'검토 결과 전달'}),
    ],
    edges:graph.edges.filter(edge => edge.kind !== 'reference'),
  };
  const response = await page.request.post('/api/studio',{data:{
    action:'project.create',data:{title:'규정 전수 검토',graph:largeGraph},
  }});
  assert.equal(response.status(),200);
  await page.goto('/?edit=' + (await response.json()).data.id);
  await page.getByRole('button',{name:'Agent 내보내기',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Agent 내보내기'});
  const files = await downloadZip(page,dialog,'규정 전수 검토.zip');
  const root = strFromU8(files['AGENTS.md']);
  assert.ok(files['AGENTS.md'].byteLength <= 16 * 1024);
  assert.ok(root.trimEnd().split('\n').length <= 200);
  assert.ok(!root.includes(checks[0]));
  assert.equal(strFromU8(files['CLAUDE.md']).trim(),'@AGENTS.md');
  const startPath = root.match(/\[대출 규정 접수\]\(([^)]+\.md)\)/)?.[1];
  assert.ok(startPath && files[startPath], '공통 지침에서 시작 단계 파일을 열 수 있어야 합니다.');
  const start = strFromU8(files[startPath]);
  const taskLink = start.match(/\[규정 검토문 작성[^\]]*\]\(([^)]+\.md)\)/)?.[1];
  assert.ok(taskLink, '시작 단계에 다음 실행 단계 링크가 필요합니다.');
  const taskPath = posix.join(posix.dirname(startPath),taskLink);
  assert.ok(files[taskPath],taskPath);
  const details = strFromU8(files[taskPath]);
  assert.ok(checks.every(line => details.includes(line)), '연결된 단계에서 작업 지시 전체를 읽을 수 있어야 합니다.');
}

async function checkTeamExport(page: Page) {
  const response = await page.request.post('/api/studio', {data:{action:'project.create', data:{lesson:'sw-code-review'}}});
  assert.equal(response.status(), 200);
  const project = (await response.json()).data;
  await page.goto('/?edit=' + project.id);
  await page.getByRole('button', {name:'Agent 내보내기', exact:true}).click();
  const dialog = page.getByRole('dialog', {name:'Agent 내보내기'});
  const files = await downloadZip(page, dialog, project.title + '.zip');
  const roles = Object.keys(files).filter(path => path.startsWith('agents/'));
  assert.equal(roles.length, 2);
  assert.deepEqual(roles.map(path => strFromU8(files[path]).split('\n')[0]).sort(), ['# QA', '# 개발자']);
  for (const path of roles) {
    const id = posix.basename(path, '.md');
    for (const entry of ['.codex/agents/' + id + '.toml','.claude/agents/' + id + '.md','.opencode/agents/' + id + '.md']) {
      assert.ok(files[entry] && strFromU8(files[entry]).includes(path), entry);
    }
  }
}

try {
  for (const width of [1440,390]) {
    const context = await browser.newContext({baseURL, viewport:{width,height:850}});
    try {
      const user = await registerBrowserAccount(context);
      const draft = structuredClone(graph);
      const testDir = process.env.STUDIO_TEST_DATA_DIR;
      if (testDir) {
        process.env.STUDIO_DATA_DIR = testDir;
        const {one} = await import('../src/server/db');
        assert.ok(one('SELECT 1 FROM people WHERE id=? AND login=?',user.id,user.login));
        process.env.STUDIO_ADMIN_IDS = user.id;
        const {writeAsset} = await import('../src/server/assets');
        const connector = writeAsset(user,{kind:'mcp',name:'공개 도서 검색',payload:{
          url:publicAddress, tools:['lookup'], readOnlyTools:['lookup'],
        }});
        draft.nodes.push(createBlock('connection.mcp',{id:'catalog-mcp',title:'도서 검색 연결',config:{
          assetId:connector.id, version:1,
        }}));
        draft.edges.push({id:'catalog-ref',kind:'reference',from:'catalog-mcp',out:'ref',to:'work',input:'mcp'});
      }
      const response = await context.request.post('/api/studio', {data:{
        action:'project.create', data:{title:'대출 안내',graph:draft},
      }});
      assert.equal(response.status(),200);
      const projectId = (await response.json()).data.id;
      const page = await context.newPage();
      await page.goto('/?edit=' + projectId);
      const button = (name:string) => page.getByRole('button',{name,exact:true});
      const trigger = button('Agent 내보내기');
      await expect(trigger).toBeInViewport({ratio:1});
      await button('목록으로 편집').click();
      await page.locator('[data-canvas-block="rule"]').click();
      const source = page.getByRole('textbox',{name:'자료 원문',exact:true});
      let failPreview = width === 1440;
      let simulateChangedAddress = false;
      await page.route('**/api/studio', async route => {
        const action = route.request().postDataJSON()?.action;
        if (action === 'project.save') {
          await route.fulfill({status:503,json:{error:'시험 중 자동 저장 보류'}});
        } else if (failPreview && action === 'project.exportPreview') {
          await route.fulfill({status:503,json:{error:'자료 목록을 확인할 수 없습니다.'}});
        } else if (simulateChangedAddress && action === 'project.exportPreview') {
          const response = await route.fetch();
          const body = await response.json();
          const connection = body.data.resources.find((item:ExportResource) => item.mcpUrl === publicAddress);
          assert.ok(connection);
          connection.mcpUrl = 'https://old.example.org/library/mcp';
          body.data.previewId = '이전 서버 주소 미리보기';
          await route.fulfill({response,json:body});
        } else await route.continue();
      });
      await source.fill(applied);
      await button('변경 적용').click();
      await source.fill(pending);
      if (width < 680) await button('속성 닫기').click();
      await trigger.click();
      const dialog = page.getByRole('dialog',{name:'Agent 내보내기'});
      await expect(dialog).toContainText('변경 적용');
      if (width === 1440) {
        await expect(dialog.getByRole('alert')).toContainText('자료 목록');
        await expect(dialog.getByRole('button',{name:'ZIP 내려받기'})).toBeDisabled();
        failPreview = false;
        await dialog.getByRole('button',{name:'자료 다시 확인'}).click();
      }
      const shared = dialog.getByRole('checkbox',{name:/대출 규정/});
      const internal = dialog.getByRole('checkbox',{name:/회의 참고자료/});
      const connections = dialog.getByRole('group',{name:'ZIP에 포함할 MCP 연결'});
      const local = connections.getByRole('checkbox',{name:/내장 도서관 연결/});
      const remote = connections.getByRole('checkbox',{name:/공개 도서 검색/});
      await expect(dialog).toContainText('OpenCode');
      await expect(shared).toBeChecked();
      await expect(local).not.toBeChecked();
      await expect(local).toBeEnabled();
      if (testDir) {
        await expect(remote).not.toBeChecked();
        await expect(connections).toContainText(publicAddress);
      }
      await internal.uncheck();
      const files = await downloadZip(page,dialog);
      for (const path of ['workflow.json','run.mjs','.codex/config.toml','.mcp.json','opencode.json']) assert.ok(!files[path],path);
      assert.ok(!Object.keys(files).some(path => path.startsWith('runtime/')));
      assert.match(strFromU8(files['.agents/skills/cite-policy/SKILL.md']),/이용규정 문장을 인용하세요/);
      assert.match(strFromU8(files['.claude/skills/cite-policy/SKILL.md']),/\.agents\/skills\/cite-policy\/SKILL\.md/);
      assert.match(strFromU8(files['CLAUDE.md']),/@AGENTS\.md/);
      assert.match(strFromU8(files['AGENTS.md']),/회의 참고자료/);
      const bundle = Object.values(files).map(bytes => strFromU8(bytes)).join('\n');
      assert.ok(bundle.includes(applied));
      assert.ok(!bundle.includes(original));
      assert.ok(!bundle.includes(pending));
      assert.ok(!bundle.includes(omit));
      assert.ok(!bundle.includes(publicAddress));
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      simulateChangedAddress = Boolean(testDir) && width === 1440;
      await trigger.click();
      const includeLocal = !testDir || width === 1440;
      if (includeLocal) await local.check();
      if (testDir) await remote.check();
      if (simulateChangedAddress) {
        await dialog.getByRole('button',{name:'ZIP 내려받기'}).click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        simulateChangedAddress = false;
        await dialog.getByRole('button',{name:'자료 다시 확인'}).click();
        await expect(connections).toContainText(publicAddress);
        await expect(local).toBeChecked();
        await expect(remote).not.toBeChecked();
        await remote.check();
      }
      const configured = await downloadZip(page,dialog);
      const configuredReadme = strFromU8(configured['README.md']);
      assert.equal(configuredReadme.includes('내장 도서관 연결'),includeLocal);
      assert.equal(strFromU8(configured['AGENTS.md']).includes('내장 도서관 연결'),includeLocal);
      for (const path of ['.codex/config.toml','.mcp.json','opencode.json']) {
        if (testDir) assert.ok(strFromU8(configured[path]).includes(publicAddress),path);
        else assert.ok(!configured[path],path);
      }
      const saved = await context.request.post('/api/studio',{data:{action:'project.open',data:{id:projectId}}});
      const savedGraph:Graph = (await saved.json()).data.graph;
      assert.equal(savedGraph.nodes.find(node => node.id === 'rule')?.config.content,original);
      await page.getByLabel('프로젝트 메뉴',{exact:true}).click();
      await button('내보내기').click();
      const jsonDialog = page.getByRole('dialog',{name:'설계 내보내기'});
      await jsonDialog.getByRole('combobox').selectOption('edited');
      const jsonDownload = page.waitForEvent('download');
      await jsonDialog.getByRole('button',{name:'JSON 내려받기'}).click();
      const json = JSON.parse(await readFile((await (await jsonDownload).path())!, 'utf8'));
      assert.equal(json.format,'workflow-studio-v1');
      assert.equal((json.graph as Graph).nodes.find(node => node.id === 'rule')?.config.content,pending);
      console.log('PASS Agent ZIP download, source selection and applied canvas at '+width+'px');
      await checkLargeExport(await context.newPage());
      console.log('PASS Large Agent ZIP links from AGENTS.md to complete stage instructions at '+width+'px');
      await checkTeamExport(await context.newPage());
      console.log('PASS developer and QA subagent download at '+width+'px');
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
