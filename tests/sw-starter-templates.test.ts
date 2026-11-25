import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateGraph } from '../src/domain/graph';
import { swStarterTemplates } from '../src/domain/sw-starter-templates';
import type { Graph } from '../src/domain/types';
import { executeGraph, type EngineServices } from '../src/engine';

function copyLesson(id: string) {
  const lesson = swStarterTemplates.find(item => item.id === id);
  assert.ok(lesson, id);
  return structuredClone(lesson);
}

async function run(graph: Graph, input: string, model: EngineServices['model']) {
  assert.deepEqual(validateGraph(graph), []);
  const result = await executeGraph(graph, { input, runId: crypto.randomUUID() }, {
    model,
    tool: async name => { throw new Error('Unexpected tool call: ' + name); },
  });
  assert.equal(result.status, 'completed', result.error ?? result.status);
  return result;
}

test('the same user request reaches the introductory Agent with the edited acceptance condition', async () => {
  const lesson = copyLesson('sw-requirements');
  const agent = lesson.graph.nodes.find(node => node.title === '요구사항 작성 Agent');
  assert.ok(agent);
  const initial = '완료한 할 일을 숨겼다가 다시 표시할 수 있어야 한다.';
  const condition = '완료 항목을 숨긴 상태에서 숨기기를 끄면, 숨겼던 완료 항목이 목록에 다시 나타난다.';
  const revisedInstruction = '완료 항목을 숨긴 상태에서 어떤 조작을 하면 무엇이 다시 보이는지, 직접 시험할 수 있는 확인 조건을 쓰세요.';
  const model: EngineServices['model'] = async request => {
    assert.equal(request.input, lesson.question);
    assert.match(request.input, /숨겼다가 다시 보고/);
    if (request.instruction.includes(revisedInstruction)) return { text: condition };
    assert.match(request.instruction, /기능 요구사항 한 문장/);
    return { text: initial };
  };
  assert.equal((await run(lesson.graph, lesson.question, model)).output, initial);
  assert.ok(lesson.steps.some(step => step.includes(revisedInstruction)));
  agent.config.instruction = revisedInstruction;
  assert.equal((await run(lesson.graph, lesson.question, model)).output, condition);
});

test('changing one status moves one feature between release note sections in both the answer and Markdown file', async () => {
  const lesson = copyLesson('sw-release-notes');
  const log = lesson.graph.nodes.find(node => node.title === '변경 기록');
  const skill = lesson.graph.nodes.find(node => node.title === '업데이트 안내 작성 Skill');
  assert.ok(log && skill);
  const titleEdit = '- 할 일 제목 수정 — 목록에서 할 일의 제목을 고칩니다.';
  const hide = '- 완료 항목 숨기기 — 끝낸 할 일을 목록에서 잠시 가립니다.';
  const reminder = '- 마감일 알림 — 마감일에 알림을 받습니다.';
  const model: EngineServices['model'] = async request => {
    assert.equal(request.input, lesson.question);
    assert.ok(request.instruction.includes(skill.config.content));
    assert.match(skill.config.content, /## 이번 버전에 추가된 기능/);
    assert.match(skill.config.content, /## 예정/);
    const lines = [...request.context.matchAll(/(할 일 제목 수정|완료 항목 숨기기|마감일 알림) \| (완료|예정) \| ([가-힣 ]+\.)/g)];
    assert.equal(lines.length, 3);
    const section = (status: string) => lines.filter(match => match[2] === status)
      .map(match => '- ' + match[1] + ' — ' + match[3]).join('\n');
    return { text: '## 이번 버전에 추가된 기능\n' + section('완료') + '\n\n## 예정\n' + section('예정') };
  };
  async function checkNote(expected: string) {
    const result = await run(lesson.graph, lesson.question, model);
    assert.equal(result.output, expected);
    const fileEvent = result.events.find(event => event.blockType === 'file.create' && event.kind === 'result');
    assert.ok(fileEvent);
    const { value: file } = fileEvent.data as { value: { fileName: string; content: string; format: string } };
    assert.equal(file.fileName, '업데이트안내.md');
    assert.equal(file.format, 'markdown');
    const bytes = await new Blob([file.content]).arrayBuffer();
    assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(bytes), result.output);
  }
  await checkNote(['## 이번 버전에 추가된 기능', titleEdit, '', '## 예정', hide, reminder].join('\n'));
  log.config.content = log.config.content.replace('완료 항목 숨기기 | 예정', '완료 항목 숨기기 | 완료');
  await checkNote(['## 이번 버전에 추가된 기능', titleEdit, hide, '', '## 예정', reminder].join('\n'));
});
