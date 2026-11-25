import assert from 'node:assert/strict';
import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { connectBlocks, createBlock } from '../src/domain/graph';
import type { Graph } from '../src/domain/types';
import { buildAgentZip } from '../src/server/agent-zip';

const mode = process.argv[3] ?? 'small';
if (mode !== 'small' && mode !== 'split') throw Error('시험 설계는 small 또는 split을 지정하세요.');
const claudeTools = mode === 'split' ? 'Read' : '""';
const prompt = mode === 'split'
  ? '"Run the project workflow now with this exact input: project workflow. Return its final answer."'
  : '"Apply the project workflow."';
// The marker exists only in the exported project instructions, never in the chat prompt.
const commands = new Map([
  ['codex', 'codex exec --ephemeral --skip-git-repo-check --sandbox read-only --output-last-message reply.txt ' + prompt],
  ['claude', 'claude --print --tools ' + claudeTools + ' --no-session-persistence ' + prompt],
  ['opencode', 'opencode run ' + prompt],
]);
const client = process.argv[2];
const command = commands.get(client);
if (!command) throw Error('codex, claude, opencode 중 하나를 지정하세요.');
const expected = 'WF-' + randomUUID();
const graph: Graph = {nodes: [
  createBlock('input.user_request', {id: 'input'}),
  createBlock('ai.single_task', {id: 'echo', config: {goal: '다음 식별자를 그대로 출력하세요. ' + expected}}),
  createBlock('output.answer', {id: 'output'}),
], edges: []};
if (mode === 'split') {
  const branch = createBlock('control.branch', {id:'branch', title:'요청 종류', config:{operator:'contains', expected:'project workflow'}});
  graph.nodes.push(branch);
  graph.edges.push(...connectBlocks(graph, 'input', branch.id));
  graph.edges.push(...connectBlocks(graph, branch.id, 'echo', [{kind:'flow', out:'yes', input:'in'}]));
  // A longer alternative route makes this a split export. The test request takes the short route.
  let previous = branch.id;
  for (let index = 1; index <= 20; index++) {
    const review = createBlock('ai.single_task', {id:'review-' + index, title:'검토 ' + index, config:{goal:'전달받은 검토 항목의 결과를 정리하세요.'}});
    graph.nodes.push(review);
    graph.edges.push(...connectBlocks(graph, previous, review.id, previous === branch.id ? [{kind:'flow', out:'no', input:'in'}] : undefined));
    previous = review.id;
  }
  graph.nodes.push(createBlock('output.answer', {id:'review-output'}));
  graph.edges.push(...connectBlocks(graph, previous, 'review-output'));
} else {
  graph.edges.push(...connectBlocks(graph, 'input', 'echo'));
}
graph.edges.push(...connectBlocks(graph, 'echo', 'output'));
const files = unzipSync(await buildAgentZip({title: '식별자 확인', graph, resources: [], files: []}));
const containingMarker = Object.entries(files).filter(([, bytes]) => strFromU8(bytes).includes(expected));
assert.equal(containingMarker.length, 1);
if (mode === 'split') assert.match(containingMarker[0][0], /^workflow\/.+\.md$/);
else assert.equal(containingMarker[0][0], 'AGENTS.md');
const root = await mkdtemp(join(tmpdir(), 'studio-export-live-'));
try {
  for (const [name, bytes] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, bytes);
  }
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = exec(command, {cwd:root, timeout:210000, windowsHide:true}, (error, result) => {
      if (error) reject(new Error(client + ' 실행 실패 (' + (error.code ?? error.signal) + ')'));
      else resolve(result);
    });
    child.stdin?.end();
  });
  const answer = client === 'codex' ? await readFile(join(root, 'reply.txt'), 'utf8') : stdout;
  assert.ok(answer.includes(expected), client + ' 응답에서 시험 식별자를 찾을 수 없습니다. ' + answer.slice(0, 500));
  console.log('PASS extracted project instructions — ' + client + ' (' + mode + ')');
} finally {
  await rm(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 300});
}
