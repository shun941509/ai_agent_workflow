/** Opt-in provider acceptance against a disposable, fully launched Studio (no test model). */
import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import {
  templates,
  emptyGraph,
  validateGraph,
  type Graph,
} from '../src/domain';
import type { EngineEvent, Prompt } from '../src/engine/types';
import { newAgentPurpose, type DesignProposal } from '../src/domain/design-proposal';
import { Drawing } from '../src/domain/template-drawing';
import {workDocumentGraph, workDocuments} from '../src/domain/work-documents';
import type { ReleaseAction, ReleaseDecision } from '../src/domain/release-decision';
import type { SharedAssetPin } from '../src/ui/editor/asset-attachment';
import { checkLiveTeamInheritance, checkLiveTeamModes } from './live-team-inheritance';
import { checkVisitAnswer, checkVisitResources, visitCaseName } from './library-visit-checks';
import { checkOptionalReview, checkOptionalRiver, eventData } from './optional-team-exercises';
import { softwareScenarios, checkReleaseDownloads } from './live-software';

const base = process.env.STUDIO_TEST_URL;
assert.ok(
  base && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname),
  '격리된 로컬 시험 서버가 필요합니다.'
);
export type Run = {
  id: string;
  runNumber: number;
  state: string;
  input: string;
  output: string;
  error?: string;
  conversation: string;
  version: number | null;
  prompt?: Prompt;
  events: EngineEvent[];
};
export type Project = {
  id: string; title: string; revision: number; graph: Graph;
  visibility: string; publicVersion: number | null;
  releaseExercise?: {decisions: ReleaseDecision[]};
};
function client() {
  let cookie = '';
  return async function api<T = any>(
    action: string,
    data: unknown = {}
  ): Promise<T> {
    const response = await fetch(new URL('/api/studio', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ action, data }),
    });
    const next = response.headers.get('set-cookie');
    if (next) cookie = next.split(';')[0];
    const body = await response.json();
    assert.ok(response.ok, action + ': ' + (body.error ?? response.status));
    return body.data;
  };
}
const author = client(),
  reader = client();
const authorCredentials = {login: 'live-' + randomUUID().slice(0, 12), password: randomUUID()};
let lastRun: Run | undefined;
async function completed(api: ReturnType<typeof client>, run: Run, expectFailure = false) {
  const deadline = Date.now() + 300000;
  while (['queued', 'running'].includes(run.state)) {
    if (Date.now() > deadline)
      throw Error('실행 제한 시간을 넘었습니다: ' + run.id);
    await wait(450);
    run = await api<Run>('run.get', { runId: run.id });
  }
  lastRun = run;
  assert.ok(
    expectFailure ? run.state === 'failed' : run.state === 'completed' || run.state === 'waiting',
    run.error || run.state
  );
  return run;
}
async function ask(
  api: ReturnType<typeof client>,
  p: Project,
  input: string,
  extras: Record<string, unknown> = {}
) {
  return completed(
    api,
    await api<Run>('run.start', {
      id: p.id,
      mode: 'test',
      input,
      requestKey: randomUUID(),
      ...extras,
    })
  );
}
async function reply(run: Run, value: string, expectFailure = false) {
  assert.equal(run.state, 'waiting');
  return completed(
    author,
    await author<Run>('run.reply', {
      runId: run.id,
      value,
      waitId: run.prompt!.id,
    }),
    expectFailure
  );
}
const create = (id: string) =>
  author<Project>('project.create', { lesson: id });
async function edit(p: Project, mutate: (g: Graph) => void) {
  const graph = structuredClone(p.graph);
  mutate(graph);
  return author<Project>('project.save', { ...p, graph });
}
const question = (id: string) => templates.find((t) => t.id === id)!.question;
const match = (run: Run, regex: RegExp) => {
  assert.equal(run.state, 'completed');
  assert.match(run.output, regex);
};
const five = /(5\s*권|다섯\s*권)/,
  three = /(3\s*권|세\s*권)/,
  fourOClock = /(오후\s*4\s*시|16\s*시|16:00|오후\s*4:00)/;

async function newAgentIntentScenario() {
  const greeting = '안녕하세요';
  const task = '회의 메모에서 결정 사항을 뽑아 줘';
  const request = (prompt: string, clarificationAnswer?: string) => author<DesignProposal>('propose', {
    newAgent: true, graph: emptyGraph(), requestKey: randomUUID(), prompt, clarificationAnswer,
  });
  assert.deepEqual(await request(greeting), { clarification: true });
  const oneOff = '프랑스의 수도는 어디인가요?';
  assert.deepEqual(await request(oneOff), {clarification:true}, '단발성 지식 질문으로 새 Agent의 업무를 추측하면 안 됩니다.');
  const geography = await request(oneOff, '여러 나라의 수도를 묻는 질문에 답하는 Agent를 만들고 싶어요.');
  assert.ok('graph' in geography);
  assert.deepEqual(validateGraph(geography.graph), []);
  assert.match(JSON.stringify(geography.graph.nodes.map(node => node.config)), /수도|capital/i);
  const meeting = await request(oneOff, task);
  assert.ok('graph' in meeting);
  const purpose = newAgentPurpose(oneOff, task, meeting.graph);
  assert.match(purpose, /회의|메모/);
  assert.doesNotMatch(purpose, /수도|프랑스/);
  for (const [prompt, answer] of [[task], [greeting, task]]) {
    const result = await request(prompt, answer);
    assert.ok('graph' in result, '회의 메모에서 추출할 항목이 정해지면 바로 설계를 제안해야 합니다.');
    assert.deepEqual(validateGraph(result.graph), []);
    const tasks = result.graph.nodes.filter(node => ['agent.task', 'ai.single_task'].includes(node.type));
    assert.match(JSON.stringify(tasks.map(node => node.config)), /결정|의결|합의|decision/i);
  }
}

async function agentScopeScenario() {
  const doc = workDocuments.find(item => item.id === 'meeting-report')!;
  const graph = workDocumentGraph(doc);
  const meeting = await author<Project>('project.create', {title:doc.title, workDocument:doc.id, graph});
  assert.equal(meeting.graph.agentScope?.mode, 'dedicated');
  const outside = await ask(author, meeting, '프랑스의 수도는 어디인가요?');
  match(outside, /회의/);
  assert.doesNotMatch(outside.output, /파리|Paris/i);
  const mixed = await ask(author, meeting, '회의 결정: 윤서가 안내문 17부를 인쇄하기로 확정했다. 이 결정을 정리해 줘. 그리고 내 점심 메뉴도 추천해 줘.');
  match(mixed, /17\s*부/);
  assert.match(mixed.output, /윤서/);
  assert.match(mixed.output, /범위|업무에 해당|맡은 업무/);
  const source = await ask(author, meeting, '다음 회의 메모를 정리해 줘. 오늘 회의에서 점심 메뉴를 비빔밥으로 결정했다.');
  match(source, /비빔밥/);

  const general = new Drawing();
  general.graph.agentScope = {mode:'general', purpose:''};
  general.node('input', 'input.user_request', '질문', 0, 0);
  general.node('answer', 'ai.single_task', '질문에 답하기', 1, 0, {goal:'다양한 주제의 질문에 답합니다.', instruction:'사용자의 질문에 한국어로 답해 주세요.'});
  general.node('output', 'output.answer', '답변', 2, 0);
  general.step('input', 'answer');
  general.step('answer', 'output');
  const assistant = await author<Project>('project.create', {title:'범용 질의응답', graph:general.graph});
  match(await ask(author, assistant, '프랑스의 수도는 어디인가요?'), /파리|Paris/i);

  const change = (changeContext:string, prompt:string, clarificationAnswer?:string) => author<DesignProposal>('propose', {
    changeContext, prompt, clarificationAnswer, graph, requestKey:randomUUID(),
  });
  const nextInstruction = '담당자가 없는 항목은 “배정 대기”로 표시해 줘.';
  for (const [context, vague] of [['editor', '안녕하세요'], [doc.id, '프랑스의 수도는 어디인가요?']]) {
    assert.deepEqual(await change(context, vague), {clarification:true});
    for (const revised of [await change(context, vague, nextInstruction), await change(context, nextInstruction)]) {
      assert.ok('graph' in revised);
      assert.deepEqual(validateGraph(revised.graph), []);
      assert.match(JSON.stringify(revised.graph.nodes.find(node => node.id === 'report')?.config), /배정 대기/);
    }
  }
}

async function proposalScenario() {
  const taskRequest = '회의 내용에서 결정 사항과 담당자를 뽑아 주는 Agent를 만들어 주세요. 초안은 담당자가 정해진 항목만 정리하세요. 사용자가 입력한 회의록, AI 작업, 답변 전달의 세 블록을 사용하세요.';
  const proposal = await author<DesignProposal>('propose', {
    newAgent:true, graph:emptyGraph(), prompt:taskRequest,
    requestKey: randomUUID(),
  });
  assert.ok('graph' in proposal);
  assert.deepEqual(
    validateGraph(proposal.graph),
    [],
    'AI가 생성한 단순 설계는 실행 가능해야 합니다.'
  );
  let meeting = await author<Project>('project.create', {
    title: '실제 회의록 검증',
    graph: {...proposal.graph, agentScope:{mode:'dedicated', purpose:taskRequest}},
  });
  const task = meeting.graph.nodes.find(n => n.type === 'agent.task' || n.type === 'ai.single_task');
  assert.ok(task, '초안에 회의록을 정리할 AI 작업이 있어야 합니다.');
  assert.deepEqual(meeting.graph.nodes.map(n => n.type).sort(), ['input.user_request', task.type, 'output.answer'].sort());
  const copies = randomInt(12, 37);
  const draft = await ask(author, meeting, `인쇄본 ${copies}권 제작을 결정했습니다. 인쇄 담당은 유진입니다. 온라인 홍보는 담당자가 정해지지 않았습니다.`);
  const draftDetails = JSON.stringify({ draft: task.config, output: draft.output });
  assert.equal(draft.state, 'completed', draftDetails);
  assert.match(draft.output, new RegExp(String(copies)), draftDetails);
  assert.match(draft.output, /유진/, draftDetails);
  assert.doesNotMatch(draft.output, /홍보/, '처음 설계는 담당자가 있는 항목만 추출해야 합니다. ' + draftDetails);
  const revised = await author<DesignProposal>('propose', {
    changeContext:'editor', graph:meeting.graph,
    prompt:
      '담당자가 정해지지 않은 항목의 담당자를 “미정”으로 표시하세요. 다른 블록과 연결은 유지하세요.',
    requestKey: randomUUID(),
  });
  assert.ok('graph' in revised);
  assert.deepEqual(validateGraph(revised.graph), []);
  assert.deepEqual((await author<Project>('project.open', {id:meeting.id})).graph, meeting.graph, '제안만 받은 시점에는 기존 설계가 유지되어야 합니다.');
  const revisedTask = revised.graph.nodes.find(n => n.id === task.id);
  assert.ok(revisedTask, '수정 제안은 기존 AI 작업을 유지해야 합니다.');
  const settings = { draft: task.config, revised: revisedTask.config };
  assert.notDeepEqual(revisedTask.config, task.config, JSON.stringify(settings));
  assert.match([revisedTask.config.goal, revisedTask.config.instruction, revisedTask.config.criterion].join('\n'), /미정/, JSON.stringify(settings));
  assert.equal(revised.graph.nodes.length, meeting.graph.nodes.length);
  for (const original of meeting.graph.nodes) {
    const updated: Graph['nodes'][number] | undefined = revised.graph.nodes.find(n => n.id === original.id);
    assert.ok(updated, `보존해야 하는 블록이 사라졌습니다: ${original.id}`);
    const expected: Graph['nodes'][number] = original.id === task.id
      ? { ...original, config: revisedTask.config } : original;
    assert.deepEqual(updated, expected, `${original.title}의 요청하지 않은 속성이 변경됐습니다.`);
  }
  assert.deepEqual(
    [...revised.graph.edges].sort((a, b) => a.id.localeCompare(b.id)),
    [...meeting.graph.edges].sort((a, b) => a.id.localeCompare(b.id)),
    '기존 연결선의 식별자·이름·포트가 보존되어야 합니다.'
  );
  meeting = await author('project.save', {
    id: meeting.id,
    title: meeting.title,
    revision: meeting.revision,
    graph: revised.graph,
  });
  assert.deepEqual(meeting.graph, revised.graph, JSON.stringify(settings));
  const minutes = await ask(
    author,
    meeting,
    '오늘 자료집 23권을 준비하기로 결정했습니다. 담당자는 민걙입니다. 다음 달 홍보 담당자는 정해지지 않았습니다.'
  );
  const details = JSON.stringify({ ...settings, output: minutes.output });
  assert.equal(minutes.state, 'completed', details);
  assert.match(minutes.output, /23\s*권/, details);
  assert.match(minutes.output, /민걙/, details);
  // Accept a table row, a sentence, or a heading with its owner on the following line.
  assert.match(minutes.output, /홍보[^\n]*미정|미정[^\n]*홍보|홍보[^\n]*\n[\s>*_•|\-]*(?:담당(?:자)?[\s*_]*[:：|=]?[\s*_]*)?미정/, details);
}

async function introScenario() {
  let intro = await create('intro');
  const membership = question('intro');
  const first = await ask(author, intro, membership);
  match(first, /신분증/);
  intro = await edit(intro, (g) => {
    g.nodes.find((n) => n.id === 'agent')!.config.instruction =
      '답을 쓰고 다음 줄에 안내문의 근거 문장을 그대로 인용하세요.';
  });
  const revised = await ask(author, intro, membership);
  match(revised, /신분증/);
  assert.notEqual(revised.conversation, first.conversation);
  const lines = revised.output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const citation = '회원증을 처음 만들 때는 신분증을 가져오세요.';
  assert.ok(lines.some((line, i) => i > 0 && line.includes(citation) && lines[i - 1].includes('신분증')),
    '준비물을 안내한 다음 줄에 근거 문장이 그대로 있어야 합니다.\n' + revised.output);
}

function checkCitation(run: Run, nodeId: string, graph: Graph, sourceId: string) {
  const source = graph.nodes.find(node => node.id === sourceId);
  assert.ok(source);
  const { citations } = eventData(run, nodeId);
  assert.ok(Array.isArray(citations) && citations.length, nodeId + '에서 원문 인용을 반환해야 합니다.');
  const lines = String(source.config.content).split(/\r?\n/);
  assert.ok(citations.some(citation => {
    if (!citation || citation.id !== source.id || citation.title !== source.title ||
        citation.version !== String(source.config.version) || typeof citation.quote !== 'string' ||
        !citation.quote.trim()) return false;
    const [, line] = /^(\d+)행$/.exec(citation.location) ?? [];
    return lines[Number(line) - 1]?.includes(citation.quote);
  }), nodeId + '의 인용과 실제 자료·판·원문 위치가 일치해야 합니다.');
}

async function beginnerScenario() {
  const original = await create('beginner');
  let copy = await author<Project>('project.copy', { id: original.id });
  async function checkLoanFile(project: Project, limit: 3 | 5) {
    const result = await ask(author, project, question('beginner'));
    const sentence = '한 사람의 대출 한도는 ' + limit + '권입니다.';
    assert.equal(result.state, 'completed');
    assert.ok(result.output.includes(sentence), '답변에 해당 사본의 원문을 인용해야 합니다: ' + result.output);
    assert.match(result.output.replace(sentence, ''), limit === 5 ? five : three, '인용 외에 질문에 대한 답변도 필요합니다.');
    assert.deepEqual(eventData(result, 'file').value, {
      fileName: '대출안내.txt', format: 'text', content: result.output,
    }, '파일의 내용과 화면에 표시할 답변·인용이 같아야 합니다.');
    eventData(result, 'skill');
  }
  await checkLoanFile(copy, 3);
  copy = await edit(copy, (g) => {
    const doc = g.nodes.find((n) => n.id === 'rules')!;
    doc.config.content = doc.config.content.replace('3권', '5권');
  });
  await checkLoanFile(copy, 5);
  const untouched = await author<Project>('project.open', {id: original.id});
  assert.deepEqual(untouched.graph, original.graph);

  const rules = copy.graph.nodes.find(node => node.id === 'rules')!;
  const saved = await author<{id: string; version: number; visibility: string}>('asset.save', {
    kind: 'document', name: rules.title, payload: {content: rules.config.content}, requestKey: randomUUID(),
  });
  assert.equal(saved.visibility, 'private');
  const fresh = await create('beginner');
  await checkLoanFile(fresh, 3);
  const linked = await edit(fresh, graph => {
    const target = graph.nodes.find(node => node.id === 'rules')!;
    target.config.assetId = saved.id;
    target.config.version = saved.version;
  });
  await checkLoanFile(linked, 5);
}

async function intermediateScenario() {
  const middle = await create('intermediate');
  const grounded = await ask(
    author,
    middle,
    '책을 몇 권까지 빌릴 수 있나요?'
  );
  match(grounded, three);
  match(grounded, /근거/);
  checkCitation(grounded, 'answer', middle.graph, 'loans');
  assert.ok(grounded.output.includes('한 사람의 대출 한도는 3권입니다.'), grounded.output);
  const missing = await ask(author, middle, question('intermediate'));
  assert.equal(missing.prompt?.kind, 'question');
  const resumed = await reply(
    missing,
    '중앙점 안내문에는 ‘분실물은 14일간 보관합니다’라고 적혀 있습니다.'
  );
  assert.equal(resumed.id, missing.id);
  match(resumed, /분실물은 14일간 보관합니다/);
  assert.equal(eventData(resumed, 'after').value, resumed.output);
  const branchOnly = await ask(author, middle, question('intermediate'));
  assert.equal(branchOnly.prompt?.kind, 'question');
  const unverified = await reply(branchOnly, '중앙점입니다.');
  assert.equal(unverified.id, branchOnly.id);
  match(unverified, /확인|명시|문의|알[기수\s]|근거|안내문|정보가 없/);
  assert.doesNotMatch(unverified.output, /\d+\s*(?:일|주|개월)|일주일|한\s*달|보름/);
  const booking = await ask(
    author,
    middle,
    '제가 신청한 도서 예약 목록을 조회해 주세요.'
  );
  assert.ok(
    booking.events.some(
      (e) => e.kind === 'tool' && e.detail.includes('reservations.list')
    )
  );
  assert.equal(booking.state, 'completed');
  const emptyList = {reservations: []};
  assert.deepEqual(eventData(booking, 'lookup').value, emptyList);
  assert.deepEqual(JSON.parse(booking.output), emptyList);
  assert.equal(booking.events.some(e => e.nodeId === 'search' && e.kind === 'lookup'), false);
}

async function libraryVisitScenario() {
  const project = await create('library-visit');
  const cases = await author<{id: string; title: string; input: string}[]>('cases.list', {id: project.id});
  const sample = cases.find(item => item.title === visitCaseName);
  assert.ok(sample);
  const {id: caseId, input} = sample;
  assert.equal(input, question('library-visit'));
  async function trial(draft: Project, version: number) {
    const run = await ask(author, draft, input, {caseId});
    assert.equal(run.state, 'completed');
    assert.equal(run.input, input);
    checkVisitResources(draft.graph, run.events, version);
    return {conversation: run.conversation, stable: checkVisitAnswer(run.output, version)};
  }
  const first = await trial(project, 1);
  const next = await edit(project, graph => { graph.nodes.find(node => node.id === 'pickup')!.config.version = 2; });
  const second = await trial(next, 2);
  assert.notEqual(first.conversation, second.conversation);
  assert.deepEqual(first.stable, second.stable, '자료판을 바꾼 뒤에도 방문 시간과 예약 안내는 같아야 합니다.');
}

async function parallelScenario() {
  let team = await create('parallel');
  const normal = await ask(author, team, question('parallel'));
  const teamGraph = team.graph.nodes.find(n => n.type === 'agent.team')!.graph!;
  const opensAtTen = /10\s*(?:시|:00|[~–—-])|열\s*시/;
  match(normal, /토요일/);
  match(normal, opensAtTen);
  match(normal, fourOClock);
  match(normal, /신분증/);
  checkCitation(normal, 'hours', teamGraph, 'hours-document');
  checkCitation(normal, 'membership', teamGraph, 'membership-document');
  team = await edit(team, (g) => {
    const inner = g.nodes.find((n) => n.type === 'agent.team')!.graph!;
    inner.edges = inner.edges.filter(
      (e) => !(e.kind === 'reference' && e.from === 'membership-document')
    );
  });
  const partial = await ask(author, team, question('parallel'));
  match(partial, /토요일/);
  match(partial, opensAtTen);
  match(partial, fourOClock);
  const membershipSubjects = partial.output.matchAll(/회원증|준비물|구비\s*서류|준비\s*서류/g);
  const unknown = /미확인|부족|없|확인.{0,12}(?:필요|어렵|어려|불가|못|않|해\s*주세)|문의|명시.{0,6}않/;
  const membershipUnknown = Array.from(membershipSubjects).some(({index}) =>
    unknown.test(partial.output.slice(Math.max(0, index - 80), index + 120))
  );
  assert.ok(membershipUnknown, '최종 답변에서 회원증 준비물이 미확인임을 알려야 합니다. '+partial.output);
  assert.doesNotMatch(partial.output, /신분증/);
  assert.equal(partial.events.filter((e) => e.kind === 'lookup').length, 2);
  checkCitation(partial, 'hours', teamGraph, 'hours-document');
  const withoutSource = eventData(partial, 'membership');
  assert.equal(withoutSource.status, 'insufficient');
  assert.deepEqual(withoutSource.citations, []);
  eventData(partial, 'summary');
}
async function optionalExercise(project: Project, materialName: string) {
  const materials = await author<(SharedAssetPin & {mine:boolean})[]>('asset.list');
  const material = materials.find(asset => asset.mine && asset.name === materialName);
  assert.ok(material, materialName+'을 연결할 수 있어야 합니다.');
  return {
    graph:project.graph, material,
    ask:(input: string) => ask(author, project, input),
    async save(graph: Graph) { project = await author<Project>('project.save', {...project, graph}); },
  };
}

async function peerReviewScenario() {
  const exercise = await optionalExercise(await create('peer-review'), '교정 사유 표시 Skill');
  await checkOptionalReview(exercise);
}

// A summary can use a table, a list, or a single heading for several excluded branches.
function siteDescriptions(output: string, site: string): string[] {
  const descriptions: string[] = [];
  const group = /(?:중앙|호수|숲|강변)도서관(?:\s*(?:[,·/]|와|과|및)\s*(?:중앙|호수|숲|강변)도서관)*/g;
  let heading = '', continuing = false;
  for (const row of output.split(/\r?\n|;|(?<=[.!?])\s+/)) {
    const mentions = [...row.matchAll(group)];
    if (!mentions.length) {
      if (/^\s*#{1,6}\s|[:：]\s*\**$/.test(row)) {
        heading = row;
        continuing = false;
      } else if (continuing && row.trim()) {
        descriptions[descriptions.length - 1] += ' ' + row;
      }
      continue;
    }
    const prefix = row.slice(0, mentions[0].index);
    for (const [i, mention] of mentions.entries()) {
      continuing = mention[0].includes(site);
      if (continuing) {
        const details = row.slice(mention.index, mentions[i + 1]?.index);
        descriptions.push([heading, i === 0 ? prefix : '', details].join(' '));
      }
    }
  }
  return descriptions;
}

async function dynamicScenario() {
  const sites = ['중앙도서관', '호수도서관', '숲도서관', '강변도서관'];
  const dynamicPolicy = {maxCreatedAgents: 4, maxInFlightAgents: 2, failurePolicy: 'collect'};
  const collect = await author<Project>('project.create', {lesson: 'dynamic', dynamicPolicy});
  const policy = collect.graph.nodes.find(node => node.type === 'agent.create_dynamic')!.config;
  assert.deepEqual([policy.maxCreatedAgents, policy.maxInFlightAgents, policy.failurePolicy], [4, 2, 'collect']);
  const result = await ask(author, collect, sites.join(', '));
  assert.equal(result.state, 'completed');
  assert.deepEqual(roleTargets(result), [...sites].sort());
  const spawn = eventData(result, 'spawn').value as {
    results: {target: string; status: string; error?: string; result: {passages:{quote: string; location: string; version: string}[]}}[]; excluded: string[];
    selection?: {reason: string; requestedCount: number; selectedCount: number};
  };
  assert.deepEqual(spawn.results.map(r => [r.target, r.status]), [
    [sites[0], 'verified'], [sites[1], 'verified'], [sites[2], 'verified'], [sites[3], 'insufficient'],
  ], JSON.stringify(spawn));
  assert.deepEqual(spawn.excluded, []);
  assert.equal(spawn.selection, undefined);
  const wave = result.events.filter(e => e.kind === 'role').map(e => e.data as {target: string; wave: number; maxInFlightAgents: number});
  assert.deepEqual(wave.map(e => [e.wave, e.maxInFlightAgents]), [[1,2],[1,2],[2,2],[2,2]]);
  const source = collect.graph.nodes.find(n => n.id === 'branches')!;
  const lines = String(source.config.content).split(/\r?\n/);
  for(const row of spawn.results.slice(0, 3)) {
    assert.ok(row.result.passages.some(p => {
      const line = lines[Number(/^(\d+)행$/.exec(p.location)?.[1])-1];
      return p.quote.trim() && line?.includes(row.target) && line.includes(p.quote) && p.version === String(source.config.version);
    }), JSON.stringify(row));
  }
  assert.equal(spawn.results[3].error, '근거 부족');
  const nine = /(?:오전\s*)?(?:9\s*(?:시|:00)|아홉\s*시)/;
  const ten = /(?:오전\s*)?(?:10\s*(?:시|:00)|열\s*시)/;
  const insufficient = /(?:근거|자료|정보|안내문).{0,12}(?:부족|없|찾지|미제공|미확보)|미확인|확인.{0,10}(?:불가|어렵|어려|필요|못|없)|insufficient/i;
  const excluded = /제외|미선택|선택.{0,12}(?:않|없|못)|조사\s*대상\s*외|excluded/i;
  const checkSite = (run: {output:string}, site: string, fact: RegExp) =>
    assert.ok(siteDescriptions(run.output, site).some(detail => fact.test(detail)),
      site + '의 최종 안내가 해당 지점의 실제 조사 결과와 달랐습니다.\n' + run.output);
  checkSite(result, sites[0], nine);
  checkSite(result, sites[1], ten);
  checkSite(result, sites[2], /월요일.{0,25}(?:휴관|닫|쉽니다|휴무)|(?:휴관|휴무).{0,15}월요일/);
  checkSite(result, sites[3], insufficient);
  console.log('EVIDENCE dynamic 전체 수집', result.output);

  // Compare the learner's two policies on the same copy and the same selected sites.
  const limited = await edit(collect, graph => {
    const policy = graph.nodes.find(node => node.type === 'agent.create_dynamic')!.config;
    policy.maxCreatedAgents = 2;
    policy.maxInFlightAgents = 1;
  });
  const selection = [sites[3], sites[0]];
  const chooseSites = async (project: Project) => {
    const waiting = await ask(author, project, sites.join(', '));
    assert.equal(waiting.prompt?.kind, 'selection');
    assert.equal(waiting.prompt.selectionCount, 2);
    assert.deepEqual(roleTargets(waiting), []);
    return waiting;
  };
  const waitingForCollect = await chooseSites(limited);
  const partial = await reply(waitingForCollect, JSON.stringify(selection));
  assert.equal(partial.id, waitingForCollect.id);
  assert.equal(partial.state, 'completed');
  const partialSpawn = eventData(partial, 'spawn').value as typeof spawn;
  assert.deepEqual(partialSpawn.excluded, [sites[1], sites[2]]);
  assert.deepEqual(partialSpawn.selection, {reason:'creation_limit', requestedCount:4, selectedCount:2});
  assert.deepEqual(partialSpawn.results.map(row => [row.target, row.status]), [
    [sites[3], 'insufficient'], [sites[0], 'verified'],
  ]);
  assert.equal(partialSpawn.results[0].error, '근거 부족');
  assert.deepEqual(roleTargets(partial), [...selection].sort());
  checkSite(partial, sites[0], nine);
  checkSite(partial, sites[3], insufficient);
  for (const site of [sites[1], sites[2]]) checkSite(partial, site, excluded);
  // A shared section heading or footnote can explain both exclusions.
  const excludedDetails = [sites[1], sites[2]].flatMap(site => siteDescriptions(partial.output, site));
  const creationLimit = /(?:생성|담당자|전체|선택|조사|인원|Agent|에이전트).{0,18}(?:한도|상한|제한)|(?:최대|한도|상한)\s*[2두]\s*(?:명|곳|개)|creation_limit/i;
  assert.ok(excludedDetails.some(detail => creationLimit.test(detail)),
    '선택에서 제외된 이유인 생성 한도가 최종 안내에 필요합니다. '+partial.output);
  const uncertainLimit = /(?:한도|상한|제한).{0,55}(?:인지|는지|여부|추정|가능성)|(?:제외\s*)?(?:이유|사유|원인).{0,18}(?:미제공|불분명|제공되지|명시되지|알\s*수\s*없|확인.{0,5}필요)/;
  assert.ok(!excludedDetails.some(detail => uncertainLimit.test(detail)),
    '기록에 있는 생성 한도를 미확인 사유로 안내했습니다. '+partial.output);
  console.log('EVIDENCE dynamic 2개 지점 선택', partial.output);
  const stop = await edit(limited, graph => {
    graph.nodes.find(node => node.type === 'agent.create_dynamic')!.config.failurePolicy = 'stop';
  });
  const waiting = await chooseSites(stop);
  const stopped = await reply(waiting, JSON.stringify(selection), true);
  assert.equal(stopped.id, waiting.id);
  assert.deepEqual(roleTargets(stopped), [sites[3]], '첫 지점의 근거가 없으면 다음 지점에 담당자를 생성하지 않아야 합니다.');
  assert.match(stopped.error ?? '', /강변도서관/);
  assert.match(stopped.error ?? '', /근거|자료/);
  assert.ok(!stopped.events.some(e => e.nodeId === 'summary' && e.kind === 'start'));

  const resumed = await edit(stop, graph => {
    graph.nodes.find(node => node.id === 'spawn')!.config.failurePolicy = 'collect';
  });
  const exercise = await optionalExercise(resumed, '강변도서관 보완 안내문');
  const {before, after} = await checkOptionalRiver(exercise);
  checkSite(before, sites[0], nine);
  checkSite(after, sites[0], nine);
  checkSite(before, sites[3], insufficient);
  checkSite(after, sites[3], /(?:오전\s*)?(?:11\s*(?:시|:00)|열한\s*시)/);
}

function roleTargets(run: Run) {
  return run.events.filter(event => event.kind === 'role').map(event => (event.data as {target: string}).target).sort();
}

async function releaseScenario() {
  let release = await create('release');
  assert.equal(release.visibility, 'private');
  assert.equal(release.publicVersion, null);
  const versions = await author<{number: number}[]>('versions.list', { id: release.id });
  assert.deepEqual(versions.map(v => v.number).sort(), [1, 2]);
  const v1 = 1, candidate = 2;
  async function decide(action: ReleaseAction, version: number, reason: string) {
    assert.ok(release.releaseExercise);
    const history = release.releaseExercise.decisions;
    release = await author<Project>('versions.decide', {
      id: release.id, action, version, reason, visibility: 'link',
      expectedDecision: history[0]?.number ?? 0,
      expectedPublicVersion: release.publicVersion, expectedVisibility: release.visibility,
    });
    const latest = release.releaseExercise?.decisions[0];
    assert.equal(latest?.action, action);
    assert.equal(latest?.resultVersion, release.publicVersion);
    assert.equal(release.releaseExercise?.decisions.length, history.length + 1);
    const saved = await author<Project>('project.open', {id:release.id});
    const recorded = saved.releaseExercise?.decisions[0];
    assert.ok(recorded);
    assert.deepEqual([recorded.action, recorded.version, recorded.reason, recorded.resultVersion], [action, version, reason, release.publicVersion]);
  }
  const cases = await author<{title:string; input:string; expected:string}[]>('cases.list', {id:release.id});
  function caseQuestion(title:string) {
    const item=cases.find(row=>row.title===title);
    assert.ok(item?.input && item.expected, title+' 시험 사례와 기대 결과가 필요합니다.');
    return item.input;
  }
  const loanQuestion = caseQuestion('대출 한도 변경');
  const sundayQuestion = caseQuestion('일요일 운영 규정');
  const lostQuestion = caseQuestion('근거 없는 보관 기간');
  async function checkSunday(version: number, opens: boolean) {
    const run = await ask(author, release, sundayQuestion, {version});
    assert.equal(run.state, 'completed');
    console.log('EVIDENCE release', version + '판 일요일', run.output);
    // A citation can also discuss Saturday. Only use hours associated with Sunday or
    // a direct answer that doesn't name any other day.
    const parts = run.output.split(/(?=평일|주말|[월화수목금토일]요일)/);
    const sunday = parts.filter(part => part.startsWith('일요일'));
    if (!/(?:평일|주말|[월화수목금토일]요일)/.test(run.output)) sunday.push(run.output);
    const closed = sunday.some(part => /휴관|휴무|(?:운영|개관)하지\s*않|열지\s*않|문을\s*안\s*열|쉽니다|쉬는\s*날/.test(
      part.replace(/(?:휴관|휴무)(?:(?:일)?이?\s*아[니닙]|하지\s*않)/g, '')
    ));
    const hours = sunday.some(part => /10\s*(?:시|:00|[~–—-])|열\s*시/.test(part) && (fourOClock.test(part) || /오후\s*네\s*시/.test(part)));
    const matches = opens ? hours && !closed : !hours && (closed || sunday.some(part => /문을\s*닫/.test(part)));
    assert.ok(matches, '선택한 자료판의 일요일 '+(opens?'개관 시간':'휴관')+'을 확인할 수 없습니다. '+run.output);
  }
  async function confirmUnknownDuration(version:number) {
    const lost = await ask(author, release, lostQuestion, {version});
    match(lost, /확인|안내데스크|명시|알 수 없/);
    assert.doesNotMatch(lost.output, /\d+\s*(?:일|주|개월)|일주일|한\s*달|보름/, '분실물 보관 기간을 추정했습니다. '+lost.output);
  }

  await decide('publish', v1, '기존 규정을 기준판으로 공유해 변경 전 동작을 확인합니다.');
  const {token} = await author<{token:string}>('project.open', {id:release.id});
  assert.ok(token);
  const visit = { mode: 'live', token };
  assert.equal((await reader<Project>('project.open', {id:release.id, token})).visibility, 'link');
  const first = await ask(reader, release, loanQuestion, visit);
  match(first, three);
  assert.equal(first.version, v1);
  await checkSunday(v1, false);
  await confirmUnknownDuration(v1);

  match(await ask(author, release, loanQuestion, { version: candidate }), five);
  await checkSunday(candidate, true);
  await confirmUnknownDuration(candidate);
  await decide('hold', candidate, '대출 한도는 5권이지만 일요일 휴관을 개관으로 답해 후보 게시를 보류합니다.');
  const publicBeforeFix = await reader<Project>('project.open', { id: release.id, token });
  assert.equal(publicBeforeFix.publicVersion, v1);
  const afterHold = await ask(reader, release, loanQuestion, visit);
  match(afterHold, three);
  assert.equal(afterHold.version, v1);

  release = await edit(release, (g) => {
    const doc = g.nodes.find((n) => n.id === 'rules')!;
    const incorrect = '일요일에는 오전 10시부터 오후 4시까지 엽니다.';
    assert.ok(doc.config.content.includes(incorrect), '수정할 후보판의 일요일 운영시간이 필요합니다.');
    doc.config.content = doc.config.content.replace(incorrect, '일요일은 휴관합니다.');
  });
  const fixed = (
    await author('versions.save', { id: release.id, revision: release.revision })
  ).number;
  assert.equal(fixed, 3);
  match(await ask(author, release, loanQuestion, { version: fixed }), five);
  await checkSunday(fixed, false);
  await confirmUnknownDuration(fixed);
  await decide('publish', fixed, '후보판의 잘못된 일요일 운영시간을 고쳤고 세 시험 결과를 확인했습니다.');
  const second = await ask(reader, release, loanQuestion, visit);
  match(second, five);
  assert.equal(second.version, fixed);
  const continuedFirst = await ask(reader, release, loanQuestion, {
    ...visit, conversation: first.conversation,
  });
  match(continuedFirst, three);
  assert.equal(continuedFirst.version, v1);
  assert.equal(continuedFirst.conversation, first.conversation);
  await decide('keep', fixed, '현재 5권 기준과 일요일 휴관 안내가 맞아서 게시판을 유지합니다.');
  assert.equal((await reader<Project>('project.open', { id: release.id, token })).publicVersion, fixed);
  await decide('rollback', v1, '도서관의 신규 대출 정책 시행이 연기되어 기존 3권 기준으로 복구합니다.');
  const restored = await ask(reader, release, loanQuestion, visit);
  match(restored, three);
  assert.equal(restored.version, v1);
  assert.equal(new Set([first.conversation, second.conversation, restored.conversation]).size, 3);
  const continuedSecond = await ask(reader, release, loanQuestion, {
    ...visit, conversation: second.conversation,
  });
  match(continuedSecond, five);
  assert.equal(continuedSecond.version, fixed);
  assert.equal(continuedSecond.conversation, second.conversation);
}

async function runTeamGraph(graph: Graph, input: string) {
  const project = await author<Project>('project.create', {title:'담당자별 팀 지침 확인', graph});
  return ask(author, project, input);
}

const scenarios = new Map<string, () => Promise<void>>([
  ['agent-scope', agentScopeScenario],
  ['new-agent-intent', newAgentIntentScenario],
  ['proposal', proposalScenario],
  ['intro', introScenario],
  ['beginner', beginnerScenario],
  ['intermediate', intermediateScenario],
  ['library-visit', libraryVisitScenario],
  ['parallel', parallelScenario],
  ['peer-review', peerReviewScenario],
  ['dynamic', dynamicScenario],
  ['release', releaseScenario],
  ['team-inheritance', () => checkLiveTeamInheritance(runTeamGraph)],
  ['team-inheritance-modes', () => checkLiveTeamModes(runTeamGraph)],
  ...softwareScenarios({
    create, edit, reply,
    async runSample(project) {
      const samples = await author<{id:string; input:string; expected:string}[]>('cases.list', {id:project.id});
      assert.equal(samples.length, 1, '실습 사본의 기본 시험 사례');
      const [sample] = samples;
      assert.ok(sample.expected.trim());
      return ask(author, project, sample.input, {caseId:sample.id});
    },
    downloads: (project, runs) => checkReleaseDownloads(base!, authorCredentials, project.id, runs),
  }),
]);
const expectedCases = ['agent-scope', 'new-agent-intent', 'proposal', 'team-inheritance', 'team-inheritance-modes', ...templates.map((lesson) => lesson.id)];
assert.deepEqual([...scenarios.keys()].sort(), expectedCases.sort(), '모든 실습에 실제 모델 시험이 필요합니다.');
const filter = process.env.STUDIO_LIVE_CASES?.trim();
const selected = filter ? [...new Set(filter.split(',').map((id) => id.trim()))] : [...scenarios.keys()];
for (const id of selected) assert.ok(scenarios.has(id), '알 수 없는 시험 ID: '+id);
await author('auth.signup', authorCredentials);
const initial = await author('bootstrap');
assert.ok(initial.modelReady, '서버의 모델 설정이 필요합니다.');
if (selected.includes('release')) {
  await reader('auth.signup', {
    login: 'reader-' + randomUUID().slice(0, 12),
    password: randomUUID(),
  });
}
const failed: string[] = [];
const passed: string[] = [];
for (const id of selected) {
  console.log('RUN', id);
  lastRun = undefined;
  try {
    await scenarios.get(id)!();
    passed.push(id);
    console.log('PASS', id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failed.push(id);
    console.error('FAIL', id, message);
    logLastRun();
    if (/invalid_api_key|insufficient_quota|credit_balance_exhausted|billing_hard_limit_reached|model_not_found|insufficient_permissions|모델 서비스가 요청을 처리하지 못했습니다 \((?:401|403)\)/i.test(message)) {
      console.error('모든 실습에 필요한 모델에 접근할 수 없어 남은 시험을 중지합니다.');
      break;
    }
  }
}
console.log('실제 모델 시험 결과', JSON.stringify({passed, failed, skipped: selected.filter(id => !passed.includes(id) && !failed.includes(id))}));
if (failed.length) process.exitCode = 1;

function logLastRun() {
  if (lastRun) console.error('마지막 시험 실행', JSON.stringify({
    input: lastRun.input, state: lastRun.state, output: lastRun.output, error: lastRun.error,
  }));
}
