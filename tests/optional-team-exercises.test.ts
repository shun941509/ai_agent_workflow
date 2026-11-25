import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test, type TestContext } from 'node:test';
import type { Graph } from '../src/domain';
import type { Passage } from '../src/engine/types';
import { assetList, readAsset } from '../src/server/assets';
import { authenticate } from '../src/server/auth';
import { db } from '../src/server/db';
import { createProject, saveProject } from '../src/server/projects';
import { runGet, startRun, workOne } from '../src/server/runs';
import { checkOptionalReview, checkOptionalRiver, eventData } from './optional-team-exercises';

const directory = mkdtempSync(join(tmpdir(), 'studio-optional-team-'));
process.env.STUDIO_DATA_DIR = directory;
process.env.OPENAI_API_KEY = 'offline-test-only';
process.env.OPENAI_MODEL = 'test-response';
after(() => { db().close(); rmSync(directory, {recursive:true, force:true}); });

type Prompt = {instruction:string; input:string; context:string};
function interceptModel(t: TestContext, reply: (prompt: Prompt) => string) {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init.body));
    const {request, context} = JSON.parse(body.input.at(-1).content);
    const text = reply({instruction:body.instructions, input:request, context});
    return Response.json({output:[{type:'message', content:[{type:'output_text', text}]}]});
  });
}

function exercise(lesson: string, materialName: string) {
  const user = authenticate('signup', 'optional-'+lesson, 'local-test-password', '').user;
  let project = createProject(user, {lesson});
  const material = assetList(user).find(asset => asset.name === materialName);
  assert.ok(material, materialName+'을 실습 사본의 자료 목록에서 찾을 수 있어야 합니다.');
  return {
    graph:project.graph!, material, content:readAsset(user, material.id, material.version).payload.content,
    async ask(input: string) {
      const queued = startRun(user, {id:project.id, mode:'test', input, requestKey:randomUUID()});
      assert.equal(await workOne(), true);
      const run = runGet(user, queued.id);
      assert.equal(run.state, 'completed', run.error);
      return run;
    },
    async save(graph: Graph) {
      project = saveProject(user, {id:project.id, title:project.title, revision:project.revision, graph});
    },
  };
}

test('고급 선택 실습은 팀의 Skill을 받은 사실 검토 기록에만 교정 사유를 한 줄 더한다', async t => {
  const sample = exercise('peer-review', '교정 사유 표시 Skill');
  assert.match(sample.content, /교정 사유/);
  const recipients: string[] = [];
  interceptModel(t, ({instruction, input, context}) => {
    const task = /^작업: (.+)$/m.exec(instruction)![1];
    const receivedSkill = instruction.includes(sample.content);
    if (receivedSkill) recipients.push(task);
    if (task.endsWith(' 초안')) return task+' “'+input.split('“')[1];
    const quote = /토요일에는 오전 10시부터 오후 4시까지 엽니다\./.exec(context)?.[0];
    assert.ok(quote, '수정할 폐관 시각은 검토자가 받은 원문에서 읽습니다.');
    if (task.includes('동료 검토')) {
      return input+' → '+quote+'\n도서관 원문 “'+quote+'”'+(receivedSkill ? '\n교정 사유: 토요일 폐관 시각이 원문과 다릅니다.' : '');
    }
    assert.equal(task, '방문 안내문 수정');
    return quote+' 회원증 발급에는 신분증이 필요합니다.';
  });
  const {before, after} = await checkOptionalReview(sample);
  assert.deepEqual(recipients, ['사실 검토 담당의 동료 검토']);
  for (const nodeId of ['facts','clarity','review-clarity','revise'])
    assert.equal(eventData(after,nodeId).value, eventData(before,nodeId).value);
});

test('전문가 선택 실습은 중앙 원문을 보존하고 근거가 부족했던 강변에 보완 안내문 1판을 인용한다', async t => {
  const sample = exercise('dynamic', '강변도서관 보완 안내문');
  assert.equal(sample.content.trim(), '강변도서관은 평일 오전 11시에 엽니다.');
  interceptModel(t, ({instruction, input, context}) => {
    if (instruction.includes('"references"')) {
      const passages = JSON.parse(context.slice(context.indexOf('['))) as (Passage & {index:number})[];
      const references = passages.filter(p => p.quote.includes(input)).map(({index, quote}) => ({index, quote}));
      return JSON.stringify({status:references.length ? 'verified' : 'insufficient', references});
    }
    assert.match(instruction, /작업: 지점별 결과 정리/);
    const {results} = JSON.parse(input) as {results:{target:string; result:{passages:Passage[]}; error?:string}[]};
    return results.map(row => row.target+' · '+(row.error ?? row.result.passages.map(p => '“'+p.quote+'”').join(' '))).join('\n');
  });
  const {before, after} = await checkOptionalRiver(sample);
  const central = '중앙도서관 · “중앙도서관은 평일 오전 9시에 엽니다.”';
  assert.equal(before.output, central+'\n강변도서관 · 근거 부족');
  assert.equal(after.output, central+'\n강변도서관 · “'+sample.content.trim()+'”');
});
