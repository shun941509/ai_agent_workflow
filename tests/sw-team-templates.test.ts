import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { validateGraph } from '../src/domain/graph';
import { swTeamTemplates } from '../src/domain/sw-team-templates';
import { executeGraph, type EngineServices, type ModelInput } from '../src/engine';

const originalReport = '할 일이 사라졌어요';
const restored = '우유 사기를 완료로 표시했어요. 완료 항목 숨기기를 끄니 다시 보여요.';
const missing = '우유 사기를 완료로 표시했어요. 완료 항목 숨기기를 껐는데도 여전히 안 보여요.';

function adapters(reply: (request: ModelInput) => string | Promise<string>): EngineServices {
  return {
    model: async request => ({text: await reply(request)}),
    tool: async name => { throw new Error('이 실습에서 호출할 수 없는 도구 ' + name); },
  };
}

test('같은 오류 제보가 회신을 기다리고 숨기기 해제 결과에 따라 안내와 보고서로 나뉜다', async () => {
  const lesson = swTeamTemplates.find(item => item.id === 'sw-bug-triage')!;
  assert.equal(lesson.question, originalReport);
  assert.deepEqual(validateGraph(lesson.graph), []);
  for (const [observation, route, skipped] of [
    [restored, 'usage-guide', 'repro-report'],
    [missing, 'repro-report', 'usage-guide'],
  ]) {
    const services = adapters(({instruction, input, context}) => {
      assert.equal(input, observation);
      if (instruction.includes('"category"')) {
        const category = instruction.includes('관찰 완료') ? '관찰 완료' :
          observation === restored ? '다시 보임' : '계속 안 보임';
        return JSON.stringify({category});
      }
      assert.ok(context.includes(originalReport));
      assert.ok(context.includes('완료 항목 숨기기'));
      return input;
    });
    const request = {runId: route, input: originalReport};
    const waiting = await executeGraph(lesson.graph, request, services);
    assert.equal(waiting.status, 'waiting');
    assert.match(waiting.wait!.prompt, /완료 항목 숨기기/);
    assert.equal(waiting.checkpoint.counts.modelCalls, 0);
    const result = await executeGraph(lesson.graph, {
      ...request, checkpoint: waiting.checkpoint, reply: {waitId: waiting.wait!.id, value: observation},
    }, services);
    assert.equal(result.status, 'completed', result.error ?? result.output);
    assert.equal(result.output, observation);
    assert.ok(result.events.some(event => event.nodeId === route && event.kind === 'result'));
    assert.ok(!result.events.some(event => event.nodeId === skipped && event.kind === 'start'));
  }
});

test('관찰이 빠진 회신에는 한 번 더 묻고 끝내 확인하지 못하면 미확인으로 남긴다', async () => {
  const lesson = swTeamTemplates.find(item => item.id === 'sw-bug-triage')!;
  const firstReply = '우유 사기를 완료로 표시했어요.';
  for (const lastReply of [missing, '지금은 목록을 확인할 수 없어요.']) {
    const services = adapters(({instruction, input}) => {
      if (!instruction.includes('"category"')) return input;
      if (input === firstReply) return '{"category":null}';
      assert.equal(input, firstReply + '\n' + lastReply);
      return JSON.stringify({category: lastReply === missing ? '계속 안 보임' : null});
    });
    const request = {runId: 'clarify', input: originalReport};
    const first = await executeGraph(lesson.graph, request, services);
    assert.equal(first.status, 'waiting');
    const second = await executeGraph(lesson.graph, {
      ...request, checkpoint: first.checkpoint, reply: {waitId: first.wait!.id, value: firstReply},
    }, services);
    assert.equal(second.status, 'waiting');
    assert.notEqual(first.wait!.id, second.wait!.id);
    assert.match(second.wait!.prompt, /다시 보이나요/);
    const result = await executeGraph(lesson.graph, {
      ...request, checkpoint: second.checkpoint, reply: {waitId: second.wait!.id, value: lastReply},
    }, services);
    assert.equal(result.status, 'completed', result.error ?? result.output);
    if (lastReply === missing) {
      assert.equal(result.output, firstReply + '\n' + lastReply);
      assert.ok(result.events.some(event => event.nodeId === 'repro-report' && event.kind === 'result'));
    } else {
      assert.match(result.output, /추가 확인이 필요/);
      assert.ok(!result.events.some(event => event.nodeId === 'repro-report' && event.kind === 'start'));
    }
  }
});

test('개발자와 QA가 같은 변경을 동시에 읽고 두 검토 의견이 최종 보고서에 도달한다', async () => {
  const lesson = swTeamTemplates.find(item => item.id === 'sw-code-review')!;
  assert.deepEqual(validateGraph(lesson.graph), []);
  const developerFinding = '숨기기 켬에서 완료된 우유 사기만 남으므로 todo.completed를 !todo.completed로 고칩니다.';
  const qaFinding = '숨기기 켬은 책 반납만, 끔은 우유 사기와 책 반납을 기대합니다. 켬 시험은 추가 실행이 필요합니다.';
  const roles = new Set<string>();
  const sources: string[] = [];
  const services = adapters(async ({instruction, context, input}) => {
    const role = /^역할: (.+)$/m.exec(instruction)?.[1];
    if (role === '개발자' || role === 'QA') {
      assert.equal(input, lesson.question);
      const source = context.replace(/^이 경로를 담당하는 역할: [^\n]+\n/, '');
      assert.match(source, /hideCompleted \? todos\.filter\(todo => todo\.completed\) : todos/);
      assert.match(source, /미완료 항목만/);
      assert.match(source, /우유 사기/);
      assert.match(source, /책 반납/);
      sources.push(source);
      roles.add(role);
      await setImmediate();
      assert.equal(roles.size, 2, '첫 검토가 끝나기 전에 두 위임 모두 시작해야 합니다.');
      return role === '개발자' ? developerFinding : qaFinding;
    }
    assert.deepEqual(input.split('\n'), [developerFinding, qaFinding]);
    return input;
  });
  const result = await executeGraph(lesson.graph, {runId: 'review', input: lesson.question}, services);
  assert.equal(result.status, 'completed', result.error ?? result.output);
  assert.deepEqual(sources[0], sources[1]);
  assert.deepEqual(result.events.filter(event => event.kind === 'role').map(event => event.nodeId).sort(), ['developer', 'qa']);
  assert.ok(result.output.includes(developerFinding));
  assert.ok(result.output.includes(qaFinding));
});
