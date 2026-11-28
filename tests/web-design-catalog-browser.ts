import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { strFromU8, unzipSync, type Unzipped } from 'fflate';
import { templates, type Lesson } from '../src/domain';
import { orderManagementHtml, reviewFollowupHtml } from '../src/domain/web-design-example';
import { registerBrowserAccount } from './browser-account';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw Error('격리된 작업실 주소를 지정하세요.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined),
});

const lessons = templates.filter(lesson => lesson.topic === '웹 디자인 개선');
const singleScreenId = 'web-design-single-screen';
const questionsId = 'web-design-questions';
const tddReviewId = 'web-design-tdd-review';
const followupId = 'web-design-review-followup';
const expectedSkills: Record<string, string[]> = {
  'web-design-diagnose': ['화면 진단 Skill', 'frontend-design'],
  'web-design-component': ['컴포넌트 개선 Skill', 'frontend-ui-engineering'],
  'web-design-flow': ['사용 흐름 개선 Skill', 'frontend-ui-engineering'],
  [questionsId]: ['grilling', 'domain-modeling'],
  [tddReviewId]: ['tdd', 'code-review'],
  [followupId]: ['tdd', 'code-review'],
  'web-design-shared-ui': ['공통 UI 개선 Skill', '화면 검증 Skill', 'frontend-design', 'frontend-ui-engineering'],
  [singleScreenId]: ['화면 진단 Skill', '컴포넌트 개선 Skill', '화면 검증 Skill', 'frontend-design', 'frontend-ui-engineering'],
  'web-design-rollout': ['변경 영향 조사 Skill', '공통 UI 개선 Skill', '화면 검증 Skill', 'frontend-design', 'frontend-ui-engineering'],
};
assert.deepEqual(lessons.map(lesson => lesson.id).sort(), Object.keys(expectedSkills).sort());
assert.deepEqual(lessons.filter(lesson => lesson.level === '중급').map(lesson => lesson.id).sort(),
  ['web-design-flow', questionsId].sort());
assert.deepEqual(lessons.filter(lesson => lesson.level === '고급').map(lesson => lesson.id).sort(),
  ['web-design-shared-ui', singleScreenId, tddReviewId].sort());
assert.deepEqual(lessons.filter(lesson => lesson.level === '전문가').map(lesson => lesson.id).sort(),
  ['web-design-rollout', followupId].sort());

const originalFiles = new Map([
  ['frontend-design', ['SKILL.md', 'LICENSE.txt']],
  ['frontend-ui-engineering', ['SKILL.md', 'references/shared/accessibility-checklist.md']],
  ['grilling', ['SKILL.md', 'agents/openai.yaml']],
  ['domain-modeling', ['SKILL.md', 'GLOSSARY-FORMAT.md', 'ADR-FORMAT.md', 'agents/openai.yaml']],
  ['tdd', ['SKILL.md', 'tests.md', 'mocking.md', 'agents/openai.yaml']],
  ['code-review', ['SKILL.md', 'agents/openai.yaml']],
]);
const installedFile = (name: string, path: string) => readFileSync(new URL('../.agents/skills/' + name + '/' + path, import.meta.url));

async function checkSkillPreview(card: Locator, dialog: Locator, lesson: Lesson) {
  const preview = dialog.getByRole('region', { name: '연결된 Skill', exact: true });
  for (const title of expectedSkills[lesson.id]) {
    await expect(card).toContainText(title);
    const skill = lesson.graph.nodes.find(node => node.title === title && node.type === 'instruction.skill');
    assert.ok(skill, title);
    const heading = preview.getByText(title, {exact: true});
    await expect(heading).toBeVisible();
    const entry = heading.locator('..');
    await expect(entry).toContainText(skill.config.skillExample);
    const connections = lesson.graph.edges.filter(edge => edge.from === skill.id && edge.input === 'skill');
    assert.ok(connections.length);
    for (const edge of connections) {
      const agent = lesson.graph.nodes.find(node => node.id === edge.to)!;
      await expect(entry).toContainText(agent.title);
    }
  }
}

async function tabTo(page: Page, control: Locator) {
  for (let i = 0; i < 12; i++) {
    if (await control.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
}

function orderDownload(lesson: Lesson) {
  if (lesson.id === followupId) return {
    name:'리뷰 지적이 남은 주문 예제 내려받기', filename:'order-review-followup.html', html:reviewFollowupHtml,
  };
  return {name:'주문 관리 예제 내려받기', filename:'order-management.html', html:orderManagementHtml};
}

async function checkDownload(page: Page, dialog: Locator, lesson: Lesson) {
  const example = orderDownload(lesson);
  const link = dialog.getByRole('link', { name: example.name, exact:true });
  await tabTo(page, link);
  await expect(link).toBeInViewport();
  const pending = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const download = await pending;
  assert.equal(download.suggestedFilename(), example.filename);
  assert.deepEqual(await readFile((await download.path())!), Buffer.from(example.html, 'utf8'));
}

async function checkSavedCase(page: Page, lesson: Lesson) {
  await page.getByRole('button', { name: '시험 실행', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: '실행 결과' });
  await expect(panel.getByRole('textbox', { name: 'Agent에게 보낼 질문' })).toHaveValue(lesson.question);
  for (const name of ['실행 설정', '시험 사례']) {
    const section = panel.getByRole('button', { name, exact: true });
    if (await section.getAttribute('aria-expanded') !== 'true') await section.click();
  }
  assert.ok(lesson.sampleCase);
  await panel.getByLabel('시험 사례 선택').selectOption({ label: lesson.sampleCase.title });
  await expect(panel.getByLabel('기대 결과')).toHaveValue(lesson.sampleCase.expected);
  const custom = {
    [tddReviewId]: {
      criterion:'알림 설정을 끈 뒤 Tab으로 이동해도 버튼은 꺼짐을 표시하고, 포커스만 저장 버튼으로 이동해야 합니다.',
      title:'중급 문답에서 정한 알림 설정 기준',
      expected:'알림을 꺼도 설정이 유지되는지 테스트한 결과와 두 검토자의 판단을 확인한다.',
    },
    [followupId]: {
      criterion:'알림을 끈 뒤 저장해도 꺼진 상태가 유지되고 저장 완료 문구가 보여야 합니다.',
      title:'고급에서 검토한 알림 설정 기준',
      expected:'고급 검토에서 지적한 상태 유지와 완료 문구가 각각 수정됐는지 재검토한다.',
    },
  }[lesson.id];
  if (custom) {
    const {criterion, title, expected} = custom;
    const cases = panel.getByLabel('시험 사례 선택');
    const question = panel.getByRole('textbox', { name: 'Agent에게 보낼 질문' });
    await cases.selectOption({ label: '직접 작성' });
    await question.fill(criterion);
    await panel.getByLabel('사례 이름', { exact: true }).fill(title);
    await panel.getByLabel('기대 결과').fill(expected);
    await panel.getByRole('button', { name: '현재 입력으로 사례 저장', exact: true }).click();
    await expect(cases.locator('option:checked')).toHaveText(title);
    await cases.selectOption({ label: lesson.sampleCase.title });
    await cases.selectOption({ label: title });
    await expect(question).toHaveValue(criterion);
    await expect(panel.getByLabel('기대 결과')).toHaveValue(expected);
  }
}

function checkRoleSkills(assignments: string[], role: string, expected: string[]) {
  const body = assignments.find(text => text.startsWith('# ' + role + '\n'));
  assert.ok(body, role);
  const originals = [...body.matchAll(/Skill 지침을 읽고 적용하세요 — \.agents\/skills\/([^/]+)\/SKILL\.md/g)]
    .map(match => match[1]).filter(name => originalFiles.has(name)).sort();
  assert.deepEqual(originals, [...expected].sort(), role);
  return body;
}

function verifyInstructions(files: Unzipped, lesson: Lesson, editedDescription?: string) {
  assert.ok(files['AGENTS.md'], lesson.title);
  assert.equal(strFromU8(files['CLAUDE.md']).trim(), '@AGENTS.md');
  const skillFiles = Object.entries(files).filter(([path]) => /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(path));
  assert.equal(skillFiles.length, expectedSkills[lesson.id].length);
  for (const title of expectedSkills[lesson.id]) {
    const originals = originalFiles.get(title);
    if (originals) {
      for (const file of originals) {
        const entry = files['.agents/skills/' + title + '/' + file];
        assert.ok(entry, title + '/' + file);
        assert.deepEqual(Buffer.from(entry), installedFile(title, file));
      }
      continue;
    }
    const source = lesson.graph.nodes.find(node => node.type === 'instruction.skill' && node.title === title)!;
    assert.doesNotMatch(source.config.content, /참고한 원본/);
    assert.ok(skillFiles.some(([, data]) => strFromU8(data).trimEnd() === source.config.content.trimEnd()), title);
  }
  const stages = Object.entries(files)
    .filter(([path]) => path === 'AGENTS.md' || /^workflow\/.*\.md$/.test(path))
    .map(([path, data]) => ({ path, text: strFromU8(data) }));
  const allStages = stages.map(stage => stage.text).join('\n');
  const actions: Record<string, string[]> = {
    'web-design-diagnose': ['소스와 화면 조사'],
    'web-design-component': ['소스 수정과 화면 검증'],
    'web-design-flow': ['소스 수정과 화면 검증'],
    [questionsId]: [],
    [tddReviewId]: ['실패 테스트부터 수정·재검증', '변경 차이 검토', '변경 차이 검토'],
    [followupId]: ['실패 테스트부터 수정·재검증', '변경 차이 검토', '변경 차이 검토'],
    'web-design-shared-ui': ['소스 수정', '화면 검증'],
    [singleScreenId]: ['소스와 화면 조사', '소스와 화면 조사', '소스 수정', '화면 검증'],
    'web-design-rollout': ['소스와 화면 조사', '소스 수정', '화면 검증', '화면 검증'],
  };
  const assigned = [...allStages.matchAll(/^대표 Agent의 프로젝트 작업 · (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(assigned.sort(), actions[lesson.id].sort(), lesson.title);
  const readme = strFromU8(files['README.md']);
  assert.equal(/^## 기존 웹 프로젝트에 적용하기$/m.test(readme), actions[lesson.id].length > 0, lesson.title);
  if (actions[lesson.id].length) assert.match(allStages, /대상 프로젝트/, lesson.title);

  if (!['web-design-rollout', singleScreenId, questionsId, tddReviewId, followupId].includes(lesson.id)) return;
  const assignments: string[] = [];
  for (const stage of stages) {
    for (const link of stage.text.matchAll(/호출할 역할은 \[[^\]]+\]\(([^)]+)\)입니다\. 작업 번호 `([^`]+)`/g)) {
      const role = posix.join(posix.dirname(stage.path), link[1]);
      assert.ok(files[role], role);
      const body = strFromU8(files[role]);
      assert.ok(body.includes('## ' + link[2] + ' · '), role);
      assignments.push(body);
    }
  }
  if (lesson.id === tddReviewId || lesson.id === followupId) {
    assert.equal(assignments.length, 3);
    const followup = lesson.id === followupId;
    const fields = followup ? ['코딩 규칙 검토 결과', '개선 기준 검토 결과', '확정한 테스트 범위'] : ['확정한 테스트 범위'];
    const scope = lesson.graph.nodes.find(node => node.id === 'scope');
    assert.deepEqual(scope?.config.fields, fields);
    const form = stages.find(stage => stage.text.startsWith('# ' + scope?.title + '\n'));
    assert.ok(form?.text.includes('입력 항목 — ' + JSON.stringify(fields)), lesson.title);
    const evidence = followup ? '주문 예제 재검증 기록' : '주문 예제 변경·테스트 기록';
    const rules = '주문 예제 코딩 규칙';
    const expectations = [
      {role:followup ? 'TDD 수정 담당' : 'TDD 개발 담당', skill:'tdd', documents:[evidence, rules]},
      {role:followup ? '코딩 규칙 재검토 담당' : '코딩 규칙 검토 담당', skill:'code-review', documents:[evidence, rules]},
      {role:followup ? '개선 기준 재검토 담당' : '개선 기준 검토 담당', skill:'code-review', documents:[evidence]},
    ];
    assert.equal(Object.keys(files).filter(path => path.startsWith('resources/')).length, 2);
    for (const {role, skill, documents} of expectations) {
      const body = checkRoleSkills(assignments, role, [skill]);
      const sources = [...body.matchAll(/참고할 자료를 읽으세요 — (resources\/\S+) \(([^)]+)\)/g)];
      assert.deepEqual(sources.map(match => match[2]).sort(), documents.sort(), role);
      for (const [, path, name] of sources) {
        const source = lesson.graph.nodes.find(node => node.type === 'resource.context' && node.title === name);
        assert.ok(source && files[path], name);
        assert.equal(strFromU8(files[path]), source.config.content, name);
      }
    }
    return;
  }
  if (lesson.id === singleScreenId || lesson.id === questionsId) {
    const documents = lesson.graph.nodes.filter(node => node.type === 'resource.context');
    assert.deepEqual(documents.map(node => node.title), [lesson.id === questionsId ? '화면 동작 설명' : '주문 목록 동작 설명']);
    const sources = Object.keys(files).filter(path => path.startsWith('resources/'));
    assert.equal(sources.length, 1, '담당자들이 공유하는 참고 자료 한 개');
    assert.equal(strFromU8(files[sources[0]]), editedDescription ?? documents[0].config.content);
    const expectedRoles = new Map(lesson.id === questionsId ? [
      ['요구사항 확인 담당', ['grilling']],
      ['용어 정리 담당', ['domain-modeling']],
    ] : [
      ['시각 디자인 담당', ['frontend-design']],
      ['접근성 검토 담당', ['frontend-ui-engineering']],
      ['UI 개발 담당', ['frontend-design', 'frontend-ui-engineering']],
      ['화면 검증 담당', ['frontend-ui-engineering']],
    ]);
    assert.equal(assignments.length, expectedRoles.size);
    for (const [role, skills] of expectedRoles) {
      const body = checkRoleSkills(assignments, role, skills);
      const references = [...body.matchAll(/참고할 자료를 읽으세요 — (resources\/\S+) \(([^)]+)\)/g)];
      assert.deepEqual(references.map(match => [match[1], match[2]]), [[sources[0], documents[0].title]], role);
    }
    if (lesson.id === questionsId) {
      assert.match(allStages, /질문을 보여 주고 회신을 기다리세요/);
      assert.match(allStages, /사용자 답변/);
    }
    return;
  }
  assert.equal(assignments.length, 3);
  for (const [name, work] of [
    ['화면 개편 개발자', '화면 개편 개발'],
    ['기준 화면 검토자', '기준 화면 검토'],
    ['연관 화면 검토자', '연관 화면 검토'],
  ]) {
    const role = assignments.find(text => text.startsWith('# ' + name + '\n'));
    assert.ok(role?.includes(' · ' + work + '\n'), name + '의 배정에서 ' + work + ' 단계를 읽을 수 있어야 합니다.');
  }
}

async function downloadAgentZip(page: Page, exclude?: string, savePath?: string) {
  await page.getByRole('button', { name: 'Agent 내보내기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent 내보내기' });
  const button = dialog.getByRole('button', { name: 'ZIP 내려받기' });
  await expect(button).toBeEnabled();
  if (exclude) await dialog.getByRole('checkbox', {name: new RegExp('^' + exclude + '\\s')}).uncheck();
  const downloading = page.waitForEvent('download');
  await button.click();
  const zip = await downloading;
  assert.ok(zip.suggestedFilename().endsWith('.zip'));
  if (savePath) await zip.saveAs(savePath);
  return unzipSync(await readFile((await zip.path())!));
}

async function openBlock(page: Page, id: string) {
  const list = page.getByRole('button', { name: '목록으로 편집', exact: true });
  if (await list.getAttribute('aria-pressed') !== 'true') await list.click();
  const block = page.locator('[data-canvas-block="' + id + '"]');
  await block.focus();
  await block.press('Enter');
  return page.getByRole('tabpanel', { name: '속성', exact: true });
}

async function checkSkillInCopy(page: Page, lesson: Lesson) {
  for (const skill of lesson.graph.nodes.filter(node => node.type === 'instruction.skill')) {
    const properties = await openBlock(page, skill.id);
    const field = properties.getByRole('textbox', {name: 'SKILL.md 지침', exact: true});
    if (originalFiles.has(skill.title)) {
      const edition = properties.getByRole('region', {name: '연결된 SKILL.md 지침'});
      await expect(edition).toContainText(skill.title + ' · 1판');
      const body = edition.locator('.ws-picker-text');
      await expect(body).toHaveText(installedFile(skill.title, 'SKILL.md').toString('utf8'));
      await expect(field).toHaveCount(0);
    } else {
      await expect(field).toHaveValue(skill.config.content);
    }
    for (const edge of lesson.graph.edges.filter(edge => edge.from === skill.id && edge.input === 'skill')) {
      const agent = lesson.graph.nodes.find(node => node.id === edge.to)!;
      await expect(properties.getByRole('button', {name: skill.title + ' → ' + agent.title, exact: true})).toBeVisible();
    }
  }
}

async function checkEditedSkill(page: Page, lesson: Lesson) {
  const properties = await openBlock(page, 'skill-component');
  const field = properties.getByRole('textbox', {name: 'SKILL.md 지침', exact: true});
  const edited = (await field.inputValue()) + '\n선택 상태를 색과 글자로 함께 표시한다';
  await field.fill(edited);
  await field.press('Tab');
  await expect(page.getByRole('status').filter({hasText: /^저장됨$/})).toBeVisible();
  const exported = await downloadAgentZip(page);
  assert.equal(strFromU8(exported['.agents/skills/web-component-improvement/SKILL.md']).trimEnd(), edited);
  await page.reload();
  const saved = await openBlock(page, 'skill-component');
  await expect(saved.getByRole('textbox', {name: 'SKILL.md 지침', exact: true})).toHaveValue(edited);
  const agent = await openBlock(page, 'component');
  await expect(agent.getByText('적용되는 Skill', {exact: true})).toBeVisible();
  await expect(agent.getByText('컴포넌트 개선 Skill · 1판', {exact: true})).toBeVisible();
  await checkSavedCase(page, lesson);
}

async function checkEditedDescription(page: Page, lesson: Lesson) {
  const properties = await openBlock(page, 'behavior');
  const title = '주문 목록 동작 설명';
  await expect(properties.getByRole('heading', {name: title, exact: true})).toBeVisible();
  const field = properties.getByRole('textbox', {name: '자료 원문', exact: true});
  const initial = lesson.graph.nodes.find(node => node.id === 'behavior')!;
  await expect(field).toHaveValue(initial.config.content);
  for (const agent of lesson.graph.nodes.filter(node => node.type === 'agent.delegate')) {
    await expect(properties.getByRole('button', {name: title + ' → ' + agent.title, exact: true})).toBeVisible();
  }
  const edited = '주문 목록에서 배송 완료를 누르면 주문 두 건이 보입니다. Tab으로 이동해도 배송 완료의 선택 표시가 남아야 합니다.';
  await field.fill(edited);
  await properties.getByRole('button', {name: '변경 적용', exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: /^저장됨$/})).toBeVisible();
  await page.reload();
  const saved = await openBlock(page, 'behavior');
  await expect(saved.getByRole('textbox', {name: '자료 원문', exact: true})).toHaveValue(edited);
  verifyInstructions(await downloadAgentZip(page), lesson, edited);
}

async function checkCopyWithoutSkill(page: Page, lesson: Lesson, missing: 'original' | 'practice') {
  const properties = await openBlock(page, missing === 'original' ? 'skill-frontend-design' : 'skill-diagnose');
  await properties.getByRole('button', {name: '블록 삭제', exact: true}).click();
  await page.getByRole('button', {name:'실습 안내', exact:true}).click();
  const guide = page.getByRole('heading', {name: lesson.title + ' 실습 안내', exact:true}).locator('..');
  await expect(guide).toBeVisible();
  if (missing === 'original') await expect(guide).toContainText('화면 진단 Skill');
  else await expect(guide).not.toContainText('화면 진단 Skill');
  await expect(guide).toContainText('배송 중');
}

async function checkReplacedOriginal(page: Page) {
  const engineering = await openBlock(page, 'skill-frontend-ui-engineering');
  const engineeringId = await engineering.getByRole('combobox', {name: '연결할 자료', exact:true}).inputValue();
  const design = await openBlock(page, 'skill-frontend-design');
  await design.getByRole('combobox', {name: '연결할 자료', exact:true}).selectOption(engineeringId);
  await design.getByRole('button', {name: '이 판 연결', exact:true}).click();
  const pinned = design.getByRole('region', {name: '연결된 SKILL.md 지침'});
  await expect(pinned.locator('.ws-picker-text')).toHaveText(installedFile('frontend-ui-engineering', 'SKILL.md').toString('utf8'));
  await expect(design.getByRole('textbox', {name: '이름', exact:true})).toHaveValue('frontend-ui-engineering');
}

async function checkDisabledProjectWork(page: Page) {
  const properties = await openBlock(page, 'component');
  await properties.getByText('고급 설정', { exact: true }).click();
  const work = properties.getByRole('combobox', { name: '내보낸 Agent의 프로젝트 작업', exact: true });
  await expect(work.locator('option:checked')).toHaveText('소스 수정과 화면 검증');
  await work.selectOption({ label: '없음' });
  const files = await downloadAgentZip(page);
  for (const [path, data] of Object.entries(files)) {
    if (path === 'AGENTS.md' || path.startsWith('workflow/')) {
      assert.doesNotMatch(strFromU8(data), /^대표 Agent의 프로젝트 작업 ·/m, path);
    }
  }
  assert.doesNotMatch(strFromU8(files['README.md']), /^## 기존 웹 프로젝트에 적용하기$/m);
}

try {
  for (const width of [1280, 1440]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
    await registerBrowserAccount(context);
    const page = await context.newPage();
    for (const lesson of lessons) {
      await page.goto('/?view=templates');
      const levelFilter = page.getByRole('combobox', { name: '실습 수준', exact: true });
      await levelFilter.selectOption({ label: '전체' });
      await page.getByRole('combobox', { name: '실습 주제', exact: true }).selectOption({ label: '웹 디자인 개선' });
      const cards = page.locator('[data-lesson-trigger]');
      await expect(cards).toHaveCount(9);
      await levelFilter.selectOption({ label: lesson.level });
      await expect(cards).toHaveCount(({입문:1, 초급:1, 중급:2, 고급:3, 전문가:2})[lesson.level]);
      const card = page.locator('[data-lesson-trigger="' + lesson.id + '"]');
      await expect(card).toContainText(lesson.title);
      await card.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: lesson.title, exact: true });
      await checkSkillPreview(card, dialog, lesson);
      if (width === 1440 && lesson.level === '초급' && process.env.STUDIO_SKILL_PREVIEW_SCREENSHOT) {
        await dialog.screenshot({path: process.env.STUDIO_SKILL_PREVIEW_SCREENSHOT});
      }
      const captureSingleScreen = width === 1440 && lesson.id === singleScreenId;
      if (captureSingleScreen && process.env.STUDIO_SINGLE_SCREEN_SCREENSHOT) {
        await dialog.screenshot({path: process.env.STUDIO_SINGLE_SCREEN_SCREENSHOT});
      }
      if (width === 1440 && lesson.id === followupId && process.env.STUDIO_REVIEW_FOLLOWUP_SCREENSHOT) {
        await dialog.screenshot({path: process.env.STUDIO_REVIEW_FOLLOWUP_SCREENSHOT});
      }
      await expect(dialog.getByText(lesson.level + ' 실습', { exact: true })).toBeVisible();
      await expect(dialog.getByText('웹 디자인 개선', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('link', { name: orderDownload(lesson).name, exact:true })).toBeVisible();
      const start = dialog.getByRole('button', { name: '내 사본으로 시작', exact: true });
      if (lesson.level === '입문' || [singleScreenId, questionsId, tddReviewId, followupId].includes(lesson.id)) {
        await page.setViewportSize({ width: width / 2, height: 900 });
        await checkDownload(page, dialog, lesson);
        await tabTo(page, start);
        await expect(start).toBeInViewport();
        await page.keyboard.press('Enter');
        await page.setViewportSize({ width, height: 900 });
      } else {
        await start.click();
      }
      await expect(page).toHaveURL(url => url.searchParams.has('edit'));
      const archives: Record<string, string | undefined> = {
        [singleScreenId]: process.env.STUDIO_SINGLE_SCREEN_ZIP,
        [questionsId]: process.env.STUDIO_QUESTIONS_ZIP,
        [tddReviewId]: process.env.STUDIO_TDD_REVIEW_ZIP,
        [followupId]: process.env.STUDIO_REVIEW_FOLLOWUP_ZIP,
      };
      const savePath = width === 1440 ? archives[lesson.id] : undefined;
      verifyInstructions(await downloadAgentZip(page, undefined, savePath), lesson);
      await checkSkillInCopy(page, lesson);
      if (lesson.id === singleScreenId) await checkEditedDescription(page, lesson);
      if (width === 1280 && lesson.level === '초급') {
        const archive = await downloadAgentZip(page, 'frontend-ui-engineering');
        assert.ok(archive['.agents/skills/web-component-improvement/SKILL.md']);
        assert.ok(!Object.keys(archive).some(path => path.startsWith('.agents/skills/frontend-ui-engineering/')));
        await checkDisabledProjectWork(page);
      }
      if (lesson.level === '초급') await checkEditedSkill(page, lesson);
      else await checkSavedCase(page, lesson);
      if (lesson.level === '입문') await checkCopyWithoutSkill(page, lesson, width === 1280 ? 'original' : 'practice');
      if (width === 1440 && lesson.id === 'web-design-rollout') await checkReplacedOriginal(page);
    }
    await context.close();
  }
  console.log('PASS nine web design lessons at 1280px and 1440px: filters, saved handoffs, role assignments and original Skill exports.');
} finally {
  await browser.close();
}
