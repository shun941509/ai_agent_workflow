import assert from 'node:assert/strict';
import {port,provider,stop} from './library-provider';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBlock, type Graph } from '../src/domain';
import { checkVisitAnswer, checkVisitResources, visitCaseName } from './library-visit-checks';

process.env.STUDIO_DATA_DIR = mkdtempSync(
  join(tmpdir(), 'studio-mcp-integration-')
);
process.env.STUDIO_MCP_TOKEN = randomBytes(32).toString('hex');
const { legacyGuestSession } = await import('./legacy-guest');
const { authenticate } = await import('../src/server/auth');
const { caseList, createProject, saveProject } = await import('../src/server/projects');
const { startRun, workOne, runGet, replyRun, stopRun, refreshReceipts } =
  await import('../src/server/runs');
const { one } = await import('../src/server/db');
const { library } = await import('../src/server/mcp');

test('자료함의 도서관 MCP를 연결하면 실제 도서관의 해당 시험 예약만 조회한다', async () => {
  process.env.STUDIO_MCP_PORT = await port();
  const service = await provider();
  try {
    const user = authenticate('signup','visit-mcp-reader','local-fixture-password','').user;
    const lesson = createProject(user, {lesson:'library-visit'});
    const graph = lesson.graph!;
    // Output the tool result directly so this integration exercises the real connector without an AI model.
    const probe = createProject(user, {graph:{
      nodes:['input','lookup','library','output'].map(id => graph.nodes.find(n => n.id === id)!),
      edges:[
        {id:'start', from:'input', to:'lookup', out:'next', input:'in', kind:'flow'},
        {id:'question', from:'input', to:'lookup', out:'value', input:'input', kind:'data'},
        {id:'reference', from:'library', to:'lookup', out:'ref', input:'mcp', kind:'reference'},
        {id:'finish', from:'lookup', to:'output', out:'next', input:'in', kind:'flow'},
        {id:'result', from:'lookup', to:'output', out:'value', input:'input', kind:'data'},
      ],
    }});
    const [sample] = caseList(user, lesson.id);
    const read = async (fixture:typeof sample.fixture, requestKey:string) => {
      const run = startRun(user, {id:probe.id,mode:'test',input:sample.input,caseFixture:fixture,requestKey});
      await workOne();
      const result = runGet(user,run.id);
      assert.equal(result.state,'completed',result.error);
      return result.output;
    };
    assert.match(await read(sample.fixture,'with-reservation'), /어린 왕자/);
    assert.doesNotMatch(await read({reservations:[]},'empty-reservations'), /어린 왕자/);
    assert.deepEqual((await library('reservations.list',{},user.id,'live')).reservations, []);
  } finally { await stop(service); }
});

test('저장한 방문 사례를 두 판으로 실행하면 모델에 전달된 근거 중 수령 규정만 답변을 바꾼다', async () => {
  process.env.STUDIO_MCP_PORT = await port();
  const service = await provider();
  const realFetch = globalThis.fetch;
  const oldKey = process.env.OPENAI_API_KEY, oldModel = process.env.OPENAI_MODEL;
  try {
    const user = authenticate('signup', 'visit-model-input', 'local-fixture-password', '').user;
    const lesson = createProject(user, {lesson:'library-visit'});
    const [sample] = caseList(user, lesson.id);
    assert.equal(sample.title, visitCaseName);
    process.env.OPENAI_API_KEY = 'local-test-only';
    process.env.OPENAI_MODEL = 'request-inspection';
    const pickupVersions: number[] = [];
    globalThis.fetch = async (url, init) => {
      if (String(url) !== 'https://api.openai.com/v1/responses') return realFetch(url, init);
      const prompt = JSON.parse(String(init?.body));
      if (prompt.instructions.includes('업무 범위 판정')) {
        return Response.json({output:[{type:'message',content:[{type:'output_text',text:'{"status":"in_scope"}'}]}]});
      }
      const skill = prompt.instructions.split('등록된 작업 지침 (방문 안내 작성 Skill · 1판): ')[1];
      assert.ok(skill, '등록된 Skill의 지침이 모델에 전달되어야 합니다.');
      const labels = Array.from(String(skill).matchAll(/(?:첫|둘째|셋째) 줄은 “([^”]+)”/g), match => match[1]);
      assert.deepEqual(labels, ['방문 시간: ', '준비물: ', '예약 내역: ']);
      const {request, context} = JSON.parse(prompt.input.at(-1).content) as {request:string;context:string};
      const [source, question] = context.split('\n사용자 원래 질문: ');
      assert.equal(question, sample.input);
      const pickup = JSON.parse(source.slice(source.indexOf('{')));
      assert.equal(pickup.id, lesson.graph!.nodes.find(node => node.id === 'pickup')!.config.assetId);
      pickupVersions.push(Number(pickup.version));
      // The transform supplies the lookup result and the retrieved passage as newline-separated JSON objects.
      const inputs = request.split(/\r?\n(?=\{)/).map(value => JSON.parse(value));
      const hours = inputs.find(value => typeof value.quote === 'string');
      assert.equal(hours?.assetId, lesson.graph!.nodes.find(node => node.id === 'hours')!.config.assetId);
      const reservations = inputs.find(value => Array.isArray(value.reservations))?.reservations;
      assert.ok(Array.isArray(reservations));
      const books = reservations.map(({book,branch}) => book + ' (' + branch + ')').join(', ');
      const text = [labels[0] + hours.quote, labels[1] + pickup.content, labels[2] + books].join('\n');
      return Response.json({output:[{type:'message',content:[{type:'output_text',text}]}]});
    };
    async function trial(graph: Graph, version: number) {
      const run = startRun(user, {id:lesson.id, mode:'test', caseId:sample.id, requestKey:randomUUID()});
      assert.equal(await workOne(), true);
      const result = runGet(user,run.id);
      assert.equal(result.state,'completed',result.error);
      assert.equal(result.input,sample.input);
      assert.ok('testCase' in result && result.testCase?.caseId === sample.id);
      checkVisitResources(graph,result.events!,version);
      return {stable:checkVisitAnswer(result.output,version), conversation:result.conversation};
    }
    const first = await trial(lesson.graph!,1);
    const edited = structuredClone(lesson.graph!);
    edited.nodes.find(node => node.id === 'pickup')!.config.version = 2;
    const saved = saveProject(user,{id:lesson.id,title:lesson.title,revision:lesson.revision,graph:edited});
    const second = await trial(saved.graph!,2);
    assert.deepEqual(pickupVersions,[1,2]);
    assert.notEqual(first.conversation,second.conversation);
    assert.deepEqual(first.stable,second.stable);
  } finally {
    globalThis.fetch = realFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = oldModel;
    await stop(service);
  }
});

test('MCP 실제 저장 직후 연결 유실·실행 중지·서비스 재시작 후 재시도해도 예약은 한 건이다', async () => {
  process.env.STUDIO_MCP_PORT = await port();
  let service = await provider();
  const realFetch = globalThis.fetch;
  try {
    const actor = legacyGuestSession().user,
      other = legacyGuestSession().user;
    const nodes = [
      createBlock('input.user_request', { id: 'q' }),
      createBlock('tool.invoke', {
        id: 'write',
        config: {
          tool: 'reservations.create',
          args: { book: '실습 도서', branch: '중앙' },
        },
      }),
      createBlock('tool.invoke', {
        id: 'other',
        config: { tool: 'reservations.list', args: {} },
      }),
      createBlock('output.answer', { id: 'out' }),
    ];
    const graph: Graph = {
      nodes,
      edges: nodes.slice(1).flatMap((n, i) =>
        ['flow', 'data'].map((kind) => ({
          id: i + kind,
          kind: kind as 'flow' | 'data',
          from: nodes[i].id,
          to: n.id,
          out: kind === 'flow' ? 'next' : 'value',
          input: kind === 'flow' ? 'in' : 'input',
        }))
      ),
    };
    const p = createProject(actor, { title: '예약 유실 검증', graph });
    const first = startRun(actor, {
      id: p.id,
      input: '예약',
      mode: 'test',
      requestKey: randomUUID(),
    });
    await workOne();
    const wait = runGet(actor, first.id);
    assert.equal(wait.state, 'waiting');
    replyRun(actor, {
      runId: first.id,
      waitId: wait.prompt.id,
      value: '승인',
      approved: true,
    });
    let transmitted = 0;
    globalThis.fetch = async (input, init) => {
      const response = await realFetch(input, init);
      const rpc = JSON.parse(String(init?.body));
      if (rpc.params?.name === 'reservations.create') {
        transmitted++;
        await response.arrayBuffer(); // The external transaction and its receipt have committed.
        stopRun(actor, first.id);
        throw new Error('시험에서 MCP 응답 연결을 끊었습니다.');
      }
      return response;
    };
    await workOne();
    globalThis.fetch = realFetch;
    const stopped = runGet(actor, first.id);
    assert.equal(stopped.state, 'stopped');
    assert.equal(transmitted, 1);
    assert.equal(stopped.operations[0].status, 'unknown');
    assert.ok(
      !stopped.events.some(
        (event: { nodeId: string }) => event.nodeId === 'other'
      )
    );
    await stop(service);
    service = await provider();
    const checked = await refreshReceipts(actor, first.id);
    assert.equal(checked.state, 'stopped');
    assert.equal(checked.operations[0].status, 'confirmed');
    const second = startRun(actor, {
      id: p.id,
      input: '예약',
      mode: 'test',
      requestKey: randomUUID(),
      retryOf: first.id,
    });
    await workOne();
    const again = runGet(actor, second.id);
    assert.equal(again.state, 'waiting');
    replyRun(actor, {
      runId: second.id,
      waitId: again.prompt.id,
      approved: true,
      value: '예',
    });
    await workOne();
    assert.equal(runGet(actor, second.id).state, 'completed');
    const c = one<{ scope: string }>(
      'SELECT scope FROM conversations WHERE id=?',
      second.conversation
    )!;
    const rows = await library('reservations.list', {}, actor.id, c.scope);
    assert.equal(rows.reservations.length, 1);
    const id = rows.reservations[0].id;
    assert.ok(id);
    assert.equal(
      (await library('reservations.list', {}, other.id, c.scope)).reservations
        .length,
      0
    );
    await assert.rejects(
      library(
        'reservations.cancel',
        { reservationId: id },
        other.id,
        c.scope,
        randomUUID(),
        true
      )
    );
    assert.equal(
      (
        await library(
          'reservations.cancel',
          { reservationId: id },
          actor.id,
          c.scope,
          randomUUID(),
          true
        )
      ).status,
      'cancelled'
    );
  } finally {
    globalThis.fetch = realFetch;
    await stop(service);
  }
});

test('동일한 도구와 인자를 지정한 서로 다른 블록은 재시도 뒤에도 각각 한 번 처리한다', async () => {
  process.env.STUDIO_MCP_PORT = await port();
  const service = await provider();
  try {
    const actor = legacyGuestSession().user;
    const nodes = [
      createBlock('input.user_request', { id: 'q' }),
      ...['first', 'second'].map((id) =>
        createBlock('tool.invoke', {
          id,
          config: {
            tool: 'reservations.create',
            args: { book: '동일한 도서', branch: '중앙' },
          },
        })
      ),
      createBlock('output.answer', { id: 'out' }),
    ];
    const graph: Graph = {
      nodes,
      edges: nodes.slice(1).flatMap((n, i) =>
        ['flow', 'data'].map((kind) => ({
          id: n.id + kind,
          kind: kind as 'flow' | 'data',
          from: nodes[i].id,
          to: n.id,
          out: kind === 'flow' ? 'next' : 'value',
          input: kind === 'flow' ? 'in' : 'input',
        }))
      ),
    };
    const project = createProject(actor, { title: '서로 다른 두 예약', graph });
    const begin = (retryOf?: string) =>
      startRun(actor, {
        id: project.id,
        input: '두 예약',
        mode: 'test',
        requestKey: randomUUID(),
        retryOf,
      });
    const approve = async (id: string) => {
      const waiting = runGet(actor, id);
      assert.equal(waiting.prompt.kind, 'approval');
      replyRun(actor, {
        runId: id,
        waitId: waiting.prompt.id,
        value: '승인',
        approved: true,
      });
      await workOne();
    };
    const first = begin();
    await workOne();
    await approve(first.id);
    assert.equal(runGet(actor, first.id).state, 'waiting');
    stopRun(actor, first.id);
    const again = begin(first.id);
    await workOne();
    await approve(again.id);
    await approve(again.id);
    assert.equal(runGet(actor, again.id).state, 'completed');
    const conv = one<{ scope: string }>(
      'SELECT scope FROM conversations WHERE id=?',
      again.conversation
    )!;
    const { reservations } = await library(
      'reservations.list',
      {},
      actor.id,
      conv.scope
    );
    assert.equal(reservations.length, 2);
    assert.notEqual(reservations[0].id, reservations[1].id);
  } finally {
    await stop(service);
  }
});
