import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import type { Graph } from '../src/domain';
import type { Passage } from '../src/engine';
import { eventData } from './optional-team-exercises';
import type { Project, Run } from './live-service';

type Studio = {
  create(id: string): Promise<Project>;
  edit(project: Project, change: (graph: Graph) => void): Promise<Project>;
  runSample(project: Project): Promise<Run>;
  reply(run: Run, value: string): Promise<Run>;
  downloads(project: Project, runs: Run[]): Promise<void>;
};

export async function checkReleaseDownloads(baseURL: string, credentials: {login:string; password:string}, project: string, runs: Run[]) {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)});
  try {
    const context = await browser.newContext({baseURL});
    const login = await context.request.post('/api/studio', {data:{action:'auth.login', data:credentials}});
    assert.ok(login.ok(), '시험 작성자로 로그인');
    const page = await context.newPage();
    await page.goto('/?edit=' + project);
    await page.getByRole('button', {name:'시험 실행', exact:true}).click();
    const panel = page.getByRole('tabpanel', {name:'실행 결과'});
    for (const run of runs) {
      const history = panel.getByRole('button', {name:'실행 기록', exact:true});
      if (await history.getAttribute('aria-expanded') !== 'true') await history.click();
      await panel.locator('.run-history').filter({hasText:'실행 ' + run.runNumber + ' ·'}).click();
      const turn = panel.locator('[data-run-turn="' + run.id + '"]');
      await expect(turn.locator('.run-output')).toHaveText(run.output);
      const pending = page.waitForEvent('download');
      await turn.getByRole('button', {name:'업데이트안내.md 내려받기', exact:true}).click();
      const file = await pending;
      assert.equal(file.suggestedFilename(), '업데이트안내.md');
      assert.deepEqual(await readFile(await file.path()), Buffer.from(await turn.locator('.run-output').textContent() ?? '', 'utf8'));
    }
  } finally {
    await browser.close();
  }
}

const turnsOff = /끄|꺼|끈|껐|해제|비활성|off/i;
const shownAgain = /다시.{0,30}(?:보|표시|나타|볼|확인)|재표시|복원|표시\s*여부|(?:표시|노출|보이|나타나).{0,12}(?:되어야|된다|됩니다|있어야)/s;

async function requirements(studio: Studio) {
  const draft = await studio.create('sw-requirements');
  const before = await studio.runSample(draft);
  assert.equal(before.state, 'completed');
  assert.match(before.output, /완료|끝낸/);
  assert.match(before.output, /숨|감추|가리|표시\s*여부/);
  assert.match(before.output, shownAgain);
  assert.ok(before.output.trim().split(/(?<=[.!?。])\s+/).length === 1, before.output);
  const revised = await studio.edit(draft, graph => {
    graph.nodes.find(node => node.id === 'agent')!.config.instruction =
      '완료 항목을 숨긴 상태에서 어떤 조작을 하면 무엇이 다시 보이는지, 직접 시험할 수 있는 확인 조건을 쓰세요.';
  });
  const after = await studio.runSample(revised);
  assert.equal(after.state, 'completed');
  assert.equal(after.input, before.input);
  assert.notEqual(after.conversation, before.conversation);
  assert.equal(eventData(after, 'agent').value, after.output);
  assert.match(after.output, /완료|끝낸/);
  assert.match(after.output, turnsOff);
  assert.match(after.output, shownAgain);
}

async function releaseNotes(studio: Studio) {
  const project = await studio.create('sw-release-notes');
  async function note(draft: Project, done: boolean) {
    const run = await studio.runSample(draft);
    assert.equal(run.state, 'completed');
    const sections = /^## 이번 버전에 추가된 기능\s*\n([\s\S]*?)^## 예정\s*\n([\s\S]+)$/m.exec(run.output);
    assert.ok(sections, run.output);
    const changeLog = draft.graph.nodes.find(node => node.id === 'changes')!.config.content as string;
    for (const row of changeLog.split('\n').slice(1)) {
      const [name, , description] = row.split(' | ');
      const added = name === '할 일 제목 수정' || (name === '완료 항목 숨기기' && done);
      const expected: string = sections[added ? 1 : 2];
      const other: string = sections[added ? 2 : 1];
      assert.ok(expected.includes(name) && expected.includes(description), name + '\n' + run.output);
      assert.ok(!other.includes(name), name + '이 두 목록에 중복되었습니다.');
      assert.equal(run.output.split(name).length - 1, 1);
    }
    eventData(run, 'skill');
    eventData(run, 'changes');
    assert.deepEqual(eventData(run, 'file').value, {fileName:'업데이트안내.md', format:'markdown', content:run.output});
    return run;
  }
  const before = await note(project, false);
  const revised = await studio.edit(project, graph => {
    const log = graph.nodes.find(node => node.id === 'changes')!;
    log.config.content = log.config.content.replace('완료 항목 숨기기 | 예정', '완료 항목 숨기기 | 완료');
  });
  const after = await note(revised, true);
  assert.notEqual(after.conversation, before.conversation);
  await studio.downloads(revised, [before, after]);
}

async function bugTriage(studio: Studio) {
  const project = await studio.create('sw-bug-triage');
  async function begin() {
    const run = await studio.runSample(project);
    assert.equal(run.state, 'waiting');
    assert.equal(run.prompt?.kind, 'question');
    assert.ok(run.events.some(event => event.nodeId === 'ask' && event.kind === 'wait'));
    return run;
  }
  const initial = await begin();
  const restored = await studio.reply(initial, '우유 사기를 완료로 표시했어요. 완료 항목 숨기기를 끄니 다시 보여요.');
  assert.equal(restored.id, initial.id);
  assert.equal(restored.state, 'completed');
  assert.equal(eventData(restored, 'usage-guide').value, restored.output);
  assert.match(restored.output, /우유\s*사기/);
  assert.match(restored.output, /미완료|완료하지\s*않|완료되지\s*않|끝내지\s*않|진행\s*중/);
  assert.match(restored.output, turnsOff);
  assert.ok(!restored.events.some(event => event.kind === 'start' && event.nodeId === 'repro-report'));

  const next = await begin();
  assert.notEqual(next.conversation, initial.conversation);
  const followUp = await studio.reply(next, '우유 사기를 완료로 표시했어요.');
  assert.equal(followUp.state, 'waiting');
  assert.ok(followUp.events.some(event => event.nodeId === 'clarify' && event.kind === 'wait'));
  const missing = await studio.reply(followUp, '우유 사기를 완료로 표시했어요. 완료 항목 숨기기를 껐는데도 여전히 안 보여요.');
  assert.equal(missing.state, 'completed');
  assert.equal(missing.id, next.id);
  assert.equal(eventData(missing, 'repro-report').value, missing.output);
  assert.ok(!missing.events.some(event => event.nodeId === 'usage-guide' && event.kind === 'start'));
  assert.match(missing.output, /우유\s*사기/);
  assert.match(missing.output, /기대|예상|보여야|표시되어야/);
  assert.match(missing.output, /안\s*보|보이지\s*않|나타나지\s*않|표시되지\s*않|미표시|찾을\s*수\s*없/);
  assert.match(missing.output, /기기|환경|버전/);
  assert.match(missing.output, /재현\s*전|미재현|재현.{0,12}(?:필요|않|미확인)|재현.{0,10}확인/);
}

async function codeReview(studio: Studio) {
  const run = await studio.runSample(await studio.create('sw-code-review'));
  assert.equal(run.state, 'completed');
  const developer = String(eventData(run, 'developer').value);
  const qa = String(eventData(run, 'qa').value);
  assert.deepEqual(eventData(run, 'developer', 'start').context, eventData(run, 'qa', 'start').context);
  const source = JSON.stringify(eventData(run, 'qa', 'start').context);
  assert.match(source, /visibleTodos/);
  assert.match(source, /기존 시험/);
  const collected = String(eventData(run, 'join').value);
  assert.ok(collected.includes(developer) && collected.includes(qa));
  assert.equal(eventData(run, 'review-summary', 'start').input, collected);
  assert.equal(eventData(run, 'review-summary').value, run.output);
  for (const text of [developer, run.output]) {
    assert.match(text, /visibleTodos/);
    assert.match(text, /!\s*(?:todo|t|item)\.completed|(?:todo|t|item)\.completed\s*={2,3}\s*false/);
  }
  for (const text of [qa, run.output]) {
    assert.match(text, /책\s*반납/);
    assert.match(text, /우유\s*사기/);
    const settings = [...text.matchAll(/비활성|활성|해제|끔|꺼|끈|끄|켬|켜|켠|\b(?:true|false|on|off)\b/gi)];
    const cases = settings.map((match, i) => ({
      off: /비활성|해제|끔|꺼|끈|끄|false|off/i.test(match[0]),
      detail: text.slice(match.index, settings[i + 1]?.index),
    }));
    assert.ok(cases.some(item => !item.off && /책\s*반납|미완료.{0,12}만/.test(item.detail)), '숨기기 켬의 기대 목록\n' + text);
    assert.ok(cases.some(item => item.off && (/모두|전부|전체|둘\s*다|두\s*(?:항목|개)|원래\s*목록/.test(item.detail)
      || (/책\s*반납/.test(item.detail) && /우유\s*사기/.test(item.detail)))), '숨기기 끔의 기대 목록\n' + text);
    assert.match(text, /추가|예정|미실행|실행\s*전|(?:시험|테스트|실행|검증).{0,20}(?:필요|해야)/);
  }
}

async function releaseImpact(studio: Studio) {
  const project = await studio.create('sw-release-impact');
  const selected = ['목록', '상세', '알림'];
  const supplement = '[알림 QA] 완료한 일의 예약 알림이 발송되지 않았다. 통과.';
  async function inspect(draft: Project, hasNotificationRecord: boolean) {
    const first = await studio.runSample(draft);
    assert.equal(first.state, 'waiting');
    assert.equal(first.prompt?.kind, 'selection');
    assert.deepEqual(first.prompt.options, ['목록', '상세', '검색', '알림']);
    assert.equal(first.prompt.selectionCount, 3);
    assert.equal(first.prompt.selectionPolicy?.simultaneous, 2);
    const form = await studio.reply(first, JSON.stringify(selected));
    assert.equal(form.id, first.id);
    assert.equal(form.state, 'waiting');
    assert.equal(form.prompt?.kind, 'question');
    assert.deepEqual(form.prompt.fields, [{name:'출시 판단', required:true}, {name:'판단 근거', required:true}]);
    assert.ok(form.events.some(event => event.kind === 'wait' && event.nodeId === 'decision'));
    assert.ok(!form.events.some(event => event.kind === 'start' && event.nodeId === 'record'));
    const roles = form.events.filter(event => event.kind === 'role' && event.nodeId === 'spawn');
    assert.deepEqual(roles.map(event => {
      const {target, wave} = event.data as {target:string; wave:number};
      return [target, wave];
    }), [['목록',1], ['상세',1], ['알림',2]]);
    const {results, excluded} = eventData(form, 'spawn').value as {
      results:{target:string; status:string; error?:string; result?:{passages?:Passage[]; sourceLines?:string[]}}[]; excluded:string[];
    };
    assert.deepEqual(excluded, ['검색']);
    assert.deepEqual(results.map(row => [row.target, row.status]), [
      ['목록', 'verified'], ['상세', 'verified'], ['알림', hasNotificationRecord ? 'verified' : 'insufficient'],
    ]);
    const log = draft.graph.nodes.find(node => node.id === 'qa-log')!;
    const records = String(log.config.content).split('\n');
    for (const row of results) {
      if (row.status === 'insufficient') {
        assert.equal(row.error, '근거 부족');
        assert.match(form.prompt.prompt, /알림[\s·]+근거 부족/);
        continue;
      }
      const line = records.findIndex(record => record.startsWith('[' + row.target + ' QA]'));
      assert.ok(line >= 0);
      assert.ok(row.result?.passages?.some(passage => passage.id === log.id && passage.version === String(log.config.version)
        && passage.location === (line + 1) + '행' && passage.quote.trim() && records[line].includes(passage.quote)), row.target + '의 QA 원문 인용');
      assert.ok(row.result?.sourceLines?.includes(records[line]), row.target + '의 QA 원문 전체 행');
      assert.ok(form.prompt.prompt.includes(records[line]), form.prompt.prompt);
    }
    assert.match(form.prompt.prompt, /선택 제외[\s·]+검색/);
    const human = hasNotificationRecord
      ? {'출시 판단':'진행', '판단 근거':'세 모듈의 통과 기록을 확인했습니다. 조사하지 않은 검색은 출시 후 점검하겠습니다.'}
      : {'출시 판단':'보류', '판단 근거':'알림의 QA 기록이 없어 완료한 일의 예약 알림 발송 여부를 확인해야 합니다.'};
    const final = await studio.reply(form, JSON.stringify(human));
    assert.equal(final.state, 'completed');
    assert.equal(final.id, first.id);
    assert.deepEqual(eventData(final, 'decision').value, human);
    assert.equal(eventData(final, 'record').value, final.output);
    assert.match(final.output, new RegExp('출시 판단\\s+' + human['출시 판단']));
    assert.ok(final.output.includes(human['판단 근거']));
    assert.ok(final.output.includes(String(eventData(form, 'summary').value)));
    assert.equal(final.output.includes(supplement), hasNotificationRecord);
    return final;
  }
  const before = await inspect(project, false);
  const revised = await studio.edit(project, graph => {
    const log = graph.nodes.find(node => node.id === 'qa-log')!;
    log.config.content += '\n' + supplement;
  });
  const after = await inspect(revised, true);
  assert.notEqual(after.conversation, before.conversation);
}

export function softwareScenarios(studio: Studio): [string, () => Promise<void>][] {
  return [
    ['sw-requirements', () => requirements(studio)],
    ['sw-release-notes', () => releaseNotes(studio)],
    ['sw-bug-triage', () => bugTriage(studio)],
    ['sw-code-review', () => codeReview(studio)],
    ['sw-release-impact', () => releaseImpact(studio)],
  ];
}
