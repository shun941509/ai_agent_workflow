import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, expect, type Page, type Route } from '@playwright/test';
import type { Graph } from '../src/domain';
import { registerBrowserAccount } from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
assert.ok(baseURL, '격리 시험용 작업실 주소가 필요합니다.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined),
});

async function openCopy(page: Page, dynamic: boolean) {
  await page.goto('/?view=templates');
  await page.getByRole('combobox', {name:'실습 수준', exact:true}).selectOption({label:dynamic ? '전문가' : '고급'});
  await page.getByRole('button', {name:dynamic ? /지점 조사팀의 생성 한도/ : /동료 Agent와 초안 검토하기/}).click();
  const detail = page.getByRole('dialog');
  const optional = detail.getByText('선택 실습', {exact:true});
  await optional.focus();
  await optional.press('Enter');
  await expect(detail.getByRole('listitem').filter({hasText:dynamic ? '도구 및 자료 → 참고 자료' : '전달받을 상위 Skill'})).toBeVisible();
  if (dynamic) {
    await detail.getByLabel('총 생성 한도').selectOption('4');
    await detail.getByLabel('동시 실행 한도').selectOption('2');
    await detail.getByLabel('지점 조사 실패 시').selectOption('collect');
  }
  await detail.getByRole('button', {name:'내 사본으로 시작', exact:true}).click();
  await expect(page).toHaveURL(url => url.searchParams.has('edit'));
  return new URL(page.url()).searchParams.get('edit')!;
}

async function savedGraph(page: Page, id: string): Promise<Graph> {
  const response = await page.context().request.post('/api/studio', {data:{action:'project.open', data:{id}}});
  assert.ok(response.ok());
  return (await response.json()).data.graph;
}

type Asset = {id:string; name:string; revision:number; version:number; exampleLesson?:string};
async function resource<T>(page:Page, action:string, data:unknown = {}):Promise<T> {
  const response = await page.context().request.post('/api/studio', {data:{action, data}});
  const result = await response.json();
  assert.ok(response.ok(), result.error);
  return result.data;
}

async function openBlockList(page: Page) {
  await expect(page.getByRole('group', {name:'캔버스 보기 방식'})).toBeAttached();
  const list = page.getByRole('button', {name:'목록으로 편집', exact:true});
  if (await list.isVisible()) await list.click();
}

async function checkAttachment(page: Page, dynamic: boolean) {
  const name = dynamic ? '강변도서관 보완 안내문' : '교정 사유 표시 Skill';
  const personal = await resource<Asset>(page, 'asset.save', {kind:dynamic ? 'document' : 'skill', name, payload:{content:'개인 자료의 원문입니다.'}});
  const id = await openCopy(page, dynamic);
  const initial = await savedGraph(page, id);
  const target = dynamic ? 'spawn' : 'team';
  const example = (await resource<Asset[]>(page, 'asset.list')).find(item => item.exampleLesson === (dynamic ? 'dynamic' : 'peer-review'));
  assert.ok(example);
  await resource(page, 'asset.save', {id:example.id, baseVersion:1, name, payload:{content:'직접 고친 예제의 두 번째 판입니다.'}});
  await page.reload();
  const inherited = page.getByRole('group', {name:'전달받을 상위 Skill'})
    .getByRole('checkbox', {name:name + ' · 1판', exact:true});
  await openBlockList(page);
  await page.locator('[data-canvas-block="' + target + '"]').click();
  const panel = page.getByRole('tabpanel', {name:'속성'});
  await panel.getByText('도구 및 자료', {exact:true}).click();
  const picker = panel.getByRole('combobox', {name:dynamic ? '참고 자료' : '팀에 연결할 Skill', exact:true});
  const option = picker.getByRole('option', {name:new RegExp(name + '.*실습 예제.*1판')});
  await expect(option).toBeAttached();
  const assetId = await option.getAttribute('value');
  assert.ok(assetId);
  assert.ok(initial.nodes.every(node => node.config.assetId !== assetId));
  await expect(picker.getByRole('option', {name:new RegExp(name + '.*내 자료.*1판')})).toHaveAttribute('value', personal.id);
  const preview = panel.getByRole('region', {name:'연결 전 원문'});
  const connect = panel.getByRole('button', {name:'이 판 연결', exact:true});
  await picker.selectOption(personal.id);
  await expect(preview).toContainText('개인 자료의 원문입니다.');
  await picker.selectOption(assetId);
  await panel.getByLabel('미리 볼 자료판').selectOption('2');
  await expect(preview).toContainText('직접 고친 예제의 두 번째 판입니다.');
  await panel.getByLabel('미리 볼 자료판').selectOption('1');
  const original = dynamic ? '강변도서관은 평일 오전 11시에 엽니다.' : '무엇을 왜 고쳤는지 설명하세요.';
  await expect(preview).toContainText(original);
  assert.ok((await savedGraph(page, id)).nodes.every(node => node.config.assetId !== assetId));
  if (dynamic) {
    const current = (await resource<Asset[]>(page, 'asset.list')).find(item => item.id === assetId)!;
    await resource(page, 'asset.delete', current);
    await connect.click();
    await expect(preview.getByRole('alert')).toContainText('자료를 찾을 수 없습니다');
    await expect(preview).not.toContainText(original);
    assert.ok((await savedGraph(page, id)).nodes.every(node => node.config.assetId !== assetId));
    await panel.getByText('예제 자료 찾기·복구', {exact:true}).click();
    const recovery = panel.getByText('예제 자료 찾기·복구', {exact:true}).locator('..');
    await expect(recovery).toContainText(original);
    const popup = page.waitForEvent('popup');
    await recovery.getByRole('link', {name:/자료 휴지통 열기/}).click();
    const trash = await popup;
    await trash.getByRole('button', {name:name + ' 복구', exact:true}).click();
    await expect(trash.getByRole('region', {name:'도구 및 자료'})).toBeVisible();
    await trash.close();
    await recovery.getByRole('button', {name:'자료 목록 새로고침'}).click();
    await expect(recovery.getByRole('status')).toContainText('새로 불러왔습니다');
    await picker.selectOption(assetId);
    await expect(preview).toContainText(original);
  }
  if (dynamic) {
    await connect.click();
    await expect(panel.getByRole('button', {name:'지점별 안내 → 지점별 조사 담당 생성'})).toBeVisible();
    await expect(panel.getByRole('button', {name:name + ' → 지점별 조사 담당 생성'})).toBeVisible();
  } else {
    // Open the team while the server's confirmation of the chosen edition is still in flight.
    const enteredTeam = Promise.withResolvers<void>();
    const delivered = Promise.withResolvers<void>();
    const holdConfirmation = async (route:Route) => {
      const body = route.request().postDataJSON();
      if (body.action !== 'asset.read' || body.data.id !== assetId) return route.continue();
      const response = await route.fetch();
      await enteredTeam.promise;
      await route.fulfill({response});
      delivered.resolve();
    };
    await page.route('**/api/studio', holdConfirmation);
    const confirmation = page.waitForRequest(request => {
      const body = request.url().endsWith('/api/studio') && request.postDataJSON();
      return body?.action === 'asset.read' && body.data.id === assetId;
    });
    try {
      await connect.click();
      await confirmation;
      await panel.getByRole('button', {name:'팀 열기'}).click();
      await page.locator('[data-canvas-block="review-facts"]').click();
      await panel.getByRole('textbox', {name:'이름', exact:true}).fill('교정 근거 확인 담당');
    } finally {
      enteredTeam.resolve();
    }
    await delivered.promise;
    await page.unroute('**/api/studio', holdConfirmation);
    await expect(inherited).toBeVisible();
    await expect(inherited).not.toBeChecked();
    await inherited.check();
    await page.locator('[data-canvas-block="review-clarity"]').click();
    await expect(inherited).toBeVisible();
    await expect(inherited).not.toBeChecked();
  }

  await page.getByLabel('프로젝트 메뉴', {exact:true}).click();
  await page.getByRole('button', {name:'저장', exact:true}).click();
  await expect.poll(async () => {
    const graph = await savedGraph(page, id);
    const source = graph.nodes.find(node => node.config.assetId === assetId);
    if (!source || dynamic) return !!source;
    const team = graph.nodes.find(node => node.id === target);
    const reviewer = team?.graph?.nodes.find(node => node.id === 'review-facts');
    return reviewer?.config.inheritedSkillIds?.includes('block:' + source.id);
  }).toBe(true);
  const saved = await savedGraph(page, id);
  const pin = saved.nodes.find(node => node.config.assetId === assetId)!;
  assert.equal(String(pin.config.version), '1');
  assert.equal(pin.type, dynamic ? 'resource.context' : 'instruction.skill');
  const added = saved.edges.filter(edge => edge.from === pin.id);
  assert.deepEqual(added.map(({to, kind, out, input}) => [to, kind, out, input]),
    [[target, 'reference', 'ref', dynamic ? 'context' : 'skill']]);
  assert.deepEqual(saved.edges.filter(edge => edge.from !== pin.id), initial.edges);
  // Only the selected reviewer changes. All other blocks, nested graphs and positions survive saving.
  if (!dynamic) {
    const reviewers = initial.nodes.find(node => node.id === target)!.graph!;
    const reviewer = reviewers.nodes.find(node => node.id === 'review-facts')!;
    reviewer.title = '교정 근거 확인 담당';
    reviewer.config.inheritedSkillIds = ['block:' + pin.id];
  }
  assert.deepEqual(saved.nodes.filter(node => node.id !== pin.id), initial.nodes);
  if (dynamic) {
    await expect(page.locator('[data-canvas-block="' + pin.id + '"]')).toContainText('강변도서관은 평일 오전 11시에 엽니다.');
  }
}

try {
  const width = 1440;
  const context = await browser.newContext({baseURL, viewport:{width, height:900}});
  try {
    await registerBrowserAccount(context);
    const page = await context.newPage();
    await checkAttachment(page, false);
    await checkAttachment(page, true);
    console.log(width + 'px 동료 검토 선택적 Skill과 지점 조사 보완 안내문 연결·저장 확인');
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}
