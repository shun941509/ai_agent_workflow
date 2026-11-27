import assert from 'node:assert/strict';
import {test} from 'node:test';
import {strFromU8, unzipSync} from 'fflate';
import {connectBlocks, createBlock} from '../src/domain/graph';
import type {Graph} from '../src/domain/types';
import {buildAgentZip} from '../src/server/agent-zip';

function fileZip(fileName: string, split = false, format = 'markdown') {
  const graph: Graph = {nodes:[
    createBlock('input.user_request', {id:'input'}),
    createBlock('file.create', {id:'write', config:{fileName, format}}),
    createBlock('output.answer', {id:'answer'}),
  ], edges:[]};
  graph.edges.push(...connectBlocks(graph, 'input', 'write'), ...connectBlocks(graph, 'write', 'answer'));
  if (split) graph.agentScope = {mode:'dedicated', purpose:'긴 업무 설명'.repeat(2000)};
  return unzipSync(buildAgentZip({title:'파일 전달', graph, resources:[], files:[]}));
}

test('단일·분할 ZIP은 CSV와 JSON 파일 본문을 Studio와 같은 방식으로 직렬화하도록 안내한다', () => {
  for (const split of [false, true]) {
    const path = split ? 'workflow/step-002.md' : 'AGENTS.md';
    const csv = strFromU8(fileZip('표.csv', split, 'csv')[path]);
    assert.match(csv, /객체 행에 나온 키를 처음 등장한 순서대로 모아 첫 행에/);
    assert.match(csv, /빠진 키와 null은 빈 셀.*내부 큰따옴표는 두 번/);
    assert.match(csv, /셀 안의 쉼표·개행과 마지막 빈 셀.*행은 CRLF.*끝에 줄바꿈을 덧붙이지/);
    const json = strFromU8(fileZip('객체.json', split, 'json')[path]);
    assert.match(json, /입력 자료형을 유지해 두 칸 들여쓰기.*끝에 줄바꿈을 덧붙이지/);
    assert.doesNotMatch(json, /행은 CRLF/);
  }
});

test('단일·분할 ZIP은 메모리의 파일을 후속 단계에 전달하고 최종 결과에 포함될 때 저장한다', () => {
  for (const split of [false, true]) {
    const files = fileZip('AGENTS.md', split);
    const root = strFromU8(files['AGENTS.md']);
    const page = split ? strFromU8(files['workflow/step-002.md']) : root;
    assert.ok(root.startsWith('# 파일 전달'));
    assert.match(page, /^    outputs\/AGENTS\.md$/m);
    assert.match(page, /심볼릭 링크를 포함한 실제 경로.*프로젝트 루트 안의 outputs\//);
    assert.match(page, /기존 파일을 보존.*새 파일 생성/);
    assert.match(page, /보고서 \(2\)\.md/);
    assert.match(page, /\{fileName, format, content\}/);
    assert.match(page, /"fileName":"AGENTS.md","format":"markdown"/);
    assert.match(page, /content는 생성한 본문 문자열/);
    assert.match(page, /디스크나 임시 파일에 쓰지 마세요/);
    assert.match(page, /하위 Workflow와 문서 읽기에서도 이 객체의 본문/);
    assert.match(page, /최상위 실행이 성공하고 최종 답변에 해당 파일이 포함될 때만 대표가 저장/);
    assert.match(root, /하위 종료·회신 대기·실패·중지 시 파일을 쓰지 마세요/);
    assert.match(root, /이번 전달에서 새로 만든 파일만 정리/);
    assert.match(strFromU8(files['README.md']),/최종 답변에 포함된 생성 파일만/);
    assert.ok(!Object.keys(files).some(path => path.startsWith('outputs/')));
  }
});

test('설계에 있는 하위 폴더와 파일명을 유지하고 외부 경로의 파일은 outputs 안에 배치한다', () => {
  const examples = [
    ['월간/11월 보고서.md', 'outputs/월간/11월 보고서.md'],
    ['outputs\\월간\\검토.md', 'outputs/월간/검토.md'],
    ['./월간/최종.md', 'outputs/월간/최종.md'],
    ['..\\AGENTS.md', 'outputs/AGENTS.md'],
    ['C:\\other\\README.md', 'outputs/README.md'],
    ['D:보고서.md', 'outputs/보고서.md'],
    ['/elsewhere/안내.md', 'outputs/안내.md'],
    ['월간/CON.txt', 'outputs/결과.md'],
    ['월간/'.repeat(750) + '요약.md', 'outputs/요약.md'],
    ['가'.repeat(100) + '.md', 'outputs/결과.md'],
  ];
  for (const [fileName, expected] of examples) {
    const files = fileZip(fileName);
    const page = strFromU8(files['workflow/step-002.md'] ?? files['AGENTS.md']);
    assert.ok(page.split('\n').includes('    ' + expected), fileName);
    assert.ok(page.includes(JSON.stringify({fileName, format:'markdown'})));
  }
});

test('파일 이름이 비어 있는 초안은 해당 단계에서 확인한 이름으로 저장하고 전달한다', () => {
  for (const name of ['', '   ']) {
    const page = strFromU8(fileZip(name)['AGENTS.md']);
    assert.match(page, /사용자에게 파일 이름을 확인하세요/);
    assert.match(page, /fileName은 설계에서 지정하거나 이 단계에서 확인한 이름/);
    assert.doesNotMatch(page, /^    outputs\//m);
  }
});
