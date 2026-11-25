import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { membershipQuestion } from '../src/domain';
import { authenticate } from '../src/server/auth';
import { db } from '../src/server/db';
import { createProject, openProject, saveProject } from '../src/server/projects';
import { runGet, startRun, workOne } from '../src/server/runs';

const dir = mkdtempSync(join(tmpdir(), 'studio-intro-example-'));
process.env.STUDIO_DATA_DIR = dir;
process.env.OPENAI_API_KEY = 'offline-test-only';
process.env.OPENAI_MODEL = 'offline';
after(() => { db().close(); rmSync(dir, { recursive: true, force: true }); });

test('only a membership answer from the original instruction counts in its example project', async t => {
  const owner = authenticate('signup', 'intro-example-owner', 'intro-example-password', '').user;
  const example = createProject(owner, {lesson:'intro'});
  const other = createProject(owner, {lesson:'intro'});
  const hasAnswer = (id: string) => openProject(owner, id).hasExampleAnswer;
  let modelReply = '';
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    output:[{type:'message', content:[{type:'output_text', text:modelReply}]}],
  }));
  const ask = async (input: string, reply: string) => {
    modelReply = reply;
    const run = startRun(owner, {id:example.id, mode:'test', input, requestKey:crypto.randomUUID()});
    assert.equal(await workOne(), true);
    const completed = runGet(owner, run.id);
    assert.equal(completed.state, 'completed');
    assert.equal(completed.output, reply);
    return completed;
  };

  const goodAnswer = '처음 발급받으실 때에는 본인의 신분증을 지참해 주세요.';
  assert.equal(hasAnswer(example.id), false);
  await ask('토요일에도 여나요?', goodAnswer);
  assert.equal(hasAnswer(example.id), false);
  await ask(membershipQuestion, membershipQuestion);
  assert.equal(hasAnswer(example.id), false);
  await ask(membershipQuestion, '토요일은 오후 네 시에 문을 닫습니다.');
  assert.equal(hasAnswer(example.id), false);
  await ask(membershipQuestion, '회원증을 만들 때 신분증은 필요하지 않습니다.');
  assert.equal(hasAnswer(example.id), false);
  await ask(membershipQuestion, '신분증을 지참해야 하나요?');
  assert.equal(hasAnswer(example.id), false);
  await ask(membershipQuestion, '신분증 대신 학생증을 가져오세요.');
  assert.equal(hasAnswer(example.id), false);
  for (const reply of ['신분증 지참은 선택 사항입니다.', '신분증 지참 여부는 선택입니다.', '신분증은 필수가 아닙니다.',
    '신분증은 있으면 좋지만 없어도 발급할 수 있습니다.',
    '신분증을 준비해 주세요. 다만 신분증 지참은 선택입니다.']) {
    const run = await ask(membershipQuestion, reply);
    assert.ok('isExampleAnswer' in run && run.isExampleAnswer === false, reply);
    assert.equal(hasAnswer(example.id), false);
  }

  const withoutRule = structuredClone(example.graph!);
  withoutRule.nodes.find(n => n.id === 'rules')!.config.content = '토요일은 오후 네 시에 문을 닫습니다.';
  const noRule = saveProject(owner, {...example, graph:withoutRule});
  await ask(membershipQuestion, goodAnswer);
  assert.equal(hasAnswer(example.id), false, 'the model guessed the right item without the membership rule');
  const disconnected = structuredClone(example.graph!);
  disconnected.edges = disconnected.edges.filter(edge => edge.from !== 'rules');
  const noReference = saveProject(owner, {...noRule, graph:disconnected});
  await ask(membershipQuestion, goodAnswer);
  assert.equal(hasAnswer(example.id), false, 'the original rule is present but the Agent did not receive it');
  const changed = structuredClone(example.graph!);
  changed.nodes.find(n => n.id === 'agent')!.config.instruction = '준비물을 안내하고 규정을 인용하세요.';
  const revised = saveProject(owner, {...noReference, graph:changed});
  const revisedRun = await ask(membershipQuestion, goodAnswer);
  saveProject(owner, {...revised, graph:example.graph});
  assert.equal(hasAnswer(example.id), false, 'restoring the draft cannot change an earlier conversation');
  const previous = runGet(owner, revisedRun.id);
  assert.ok('isExampleAnswer' in previous && previous.isExampleAnswer === false);

  const baseline = await ask(membershipQuestion, goodAnswer);
  assert.ok('isExampleAnswer' in baseline && baseline.isExampleAnswer);
  assert.equal(hasAnswer(example.id), true);
  assert.equal(hasAnswer(other.id), false);
  const restored = openProject(owner, example.id);
  saveProject(owner, {...restored, graph:changed});
  const pinned = runGet(owner, baseline.id);
  assert.ok('isExampleAnswer' in pinned && pinned.isExampleAnswer);
  assert.equal(hasAnswer(example.id), true, 'a completed baseline survives later edits');
  saveProject(owner, {...openProject(owner, example.id), graph:example.graph});
  for (const reply of ['회원증을 만들 때는 본인 신분증만 있으면 됩니다.', '신분증 한 장이면 충분합니다.',
    '신분증을 준비하세요. 증명사진은 선택 사항입니다.', '신분증 지참은 선택 사항이 아닙니다.']) {
    const run = await ask(membershipQuestion, reply);
    assert.ok('isExampleAnswer' in run && run.isExampleAnswer === true, reply);
  }
});
