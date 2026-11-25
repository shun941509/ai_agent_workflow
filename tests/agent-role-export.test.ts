import assert from 'node:assert/strict';
import {posix} from 'node:path';
import {test} from 'node:test';
import {strFromU8, unzipSync} from 'fflate';
import type {ExportPackage} from '../src/domain/agent-export';
import {connectBlocks, createBlock} from '../src/domain/graph';
import type {Graph} from '../src/domain/types';
import {buildAgentZip} from '../src/server/agent-zip';

function archive(pkg: ExportPackage) {
  const raw = unzipSync(buildAgentZip(pkg));
  return Object.fromEntries(Object.entries(raw).map(([path, content]) => [path, strFromU8(content)]));
}

function rolePaths(files: Record<string,string>) {
  return Object.keys(files).filter(path => /^agents\/[^/]+\.md$/.test(path));
}

test('일반 AI 역할, 팀, 병렬 분기만 있는 설계는 네이티브 하위 Agent를 등록하지 않는다', () => {
  const graph: Graph = {nodes:[
    createBlock('control.parallel', {id:'parallel'}),
    createBlock('ai.single_task', {id:'first', config:{role:'작성자'}}),
    createBlock('agent.task', {id:'second', config:{role:'검토자'}}),
    createBlock('agent.team', {id:'team', config:{responsible:'팀 대표'}}),
    createBlock('agent.delegate', {id:'unspecified', config:{role:'  '}}),
  ], edges:[]};
  const files = archive({title:'문서 작성', graph, resources:[], files:[]});
  assert.deepEqual(rolePaths(files), []);
  assert.ok(!Object.keys(files).some(path => /^\.(codex|claude|opencode)\/agents\//.test(path)));
  assert.equal(files['CLAUDE.md'], '@AGENTS.md\n');
});

test('명시적으로 위임·인계·동적 생성하는 역할은 세 도구에서 동일한 공통 역할 지침을 찾는다', () => {
  const graph: Graph = {nodes:[
    createBlock('agent.delegate', {id:'dev', config:{role:'개발자', instruction:'검토 규칙 D-81을 적용하세요.'}}),
    createBlock('agent.handoff', {id:'qa', config:{role:'QA', instruction:'시험 결과 Q-47을 반환하세요.'}}),
    createBlock('agent.create_dynamic', {id:'audit', config:{role:'감사', instruction:'선택한 대상마다 A-53을 확인하세요.',maxCreatedAgents:7}}),
  ], edges:[]};
  const files = archive({title:'역할 전달', graph, resources:[], files:[]});
  const roles = rolePaths(files);
  assert.equal(roles.length, 3);
  const instructions = ['D-81','Q-47','A-53'];
  for (const role of roles) {
    const {name} = posix.parse(role);
    const marker = instructions.find(value => files[role].includes(value));
    assert.ok(marker, '역할 원문이 자신에게 맡긴 작업을 포함해야 합니다.');
    assert.equal(roles.filter(path => files[path].includes(marker)).length, 1);
    for (const path of ['.codex/agents/' + name + '.toml','.claude/agents/' + name + '.md','.opencode/agents/' + name + '.md']) {
      assert.ok(files[path]?.includes(role), path + ' → ' + role);
      assert.ok(!files[path].includes(marker), path + '에서 실제 작업 지침을 중복하지 않습니다.');
    }
    assert.ok(files['AGENTS.md'].includes(name));
  }
  assert.deepEqual(rolePaths(archive({title:'역할 전달', graph, resources:[], files:[]})), roles);
});

test('단계가 분리되어도 동명 역할에 배정한 작업·Skill·MCP가 해당 하위 설계에만 전달된다', () => {
  const first = createBlock('workflow.call', {id:'first', title:'첫 번째 팀'});
  const second = createBlock('workflow.call', {id:'second', title:'두 번째 팀'});
  const child = (instruction: string): Graph => ({nodes:[
    createBlock('agent.delegate', {id:'owner', title:'검토 담당',config:{role:'동명 검토자', instruction}}),
  ], edges:[]});
  first.graph = child('첫 번째 업무의 결과 FIRST-CHECK를 반환하세요.');
  second.graph = child('두 번째 업무의 결과 SECOND-CHECK를 반환하세요.');
  const included = createBlock('connection.mcp', {id:'published',config:{exportResource:'m',assetId:'catalog',version:1}});
  const excluded = createBlock('connection.mcp', {id:'unpublished', title:'비공개연결',config:{exportResource:'hidden',assetId:'never-export',version:1}});
  const skill = createBlock('instruction.skill', {id:'policy',config:{exportResource:'s'}});
  first.graph.nodes.push(skill, included, excluded);
  first.graph.nodes[0].config.allowedTools = ['mcp.catalog.list','mcp.never-export.private'];
  for (const source of [skill,included,excluded]) first.graph.edges.push(...connectBlocks(first.graph, source.id, 'owner'));
  const pkg: ExportPackage = {
    title:'동명 역할', graph:{nodes:[first, second,
      createBlock('ai.single_task', {id:'detail',config:{goal:'단계 안내\n'.repeat(210)}})], edges:[]},
    resources:[
      {kind:'skill', key:'s',name:'policy',version:'1',available:true,included:true,files:['resources/s/SKILL.md'],steps:['검토 담당']},
      {kind:'mcp',key:'m',name:'카탈로그',version:'1',available:true,included:true,files:[],steps:['검토 담당'],
        mcp:{id:'public-catalog',tools:['list'],url:'https://example.org/test-mcp'}},
      {kind:'mcp',key:'hidden',name:excluded.title,version:'1',available:true,included:false,files:[],steps:['검토 담당']},
    ],
    files:[{path:'resources/s/SKILL.md',data:Buffer.from('참고할 항목을 하나 선택하세요.').toString('base64')}],
  };
  const files = archive(pkg);
  const roles = rolePaths(files);
  assert.equal(roles.length, 2);
  const firstPath = roles.find(path => files[path].includes('FIRST-CHECK'));
  const secondPath = roles.find(path => files[path].includes('SECOND-CHECK'));
  assert.ok(firstPath && secondPath);
  assert.notEqual(firstPath, secondPath);
  assert.match(files[firstPath], /\.agents\/skills\/policy\/SKILL\.md/);
  assert.match(files[firstPath], /public-catalog/);
  assert.doesNotMatch(files[secondPath], /FIRST-CHECK|\.agents\/skills\/policy\/SKILL\.md|public-catalog/);
  assert.doesNotMatch(Object.values(files).join('\n'), /비공개연결|never-export/);
  const linked = new Set<string>();
  for (const [page, text] of Object.entries(files)) {
    if (!/^workflow\/.+\.md$/.test(page)) continue;
    for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
      const target = posix.normalize(posix.join(posix.dirname(page), match[1].split('#')[0]));
      if (roles.includes(target)) linked.add(target);
    }
  }
  assert.deepEqual([...linked].sort(), roles.sort(), '각 위임 단계의 상대 링크가 맞는 공통 역할 파일에 도달해야 합니다.');
});

test('같은 범위에서 역할을 재사용하면 두 단계의 배정을 구분하고 도구나 자료가 달라지면 별도로 등록한다', () => {
  const delegate = (id: string, instruction: string, tool: string) => createBlock('agent.delegate', {
    id, title:id, config:{role:'Editor',instruction,allowedTools:[tool]},
  });
  const graph: Graph = {nodes:[
    delegate('first','첫 배정 A01','lookup'), delegate('second','둘째 배정 B02','lookup'),
    delegate('different-tool','다른 도구 C03','update'), delegate('different-material','다른 자료 D04','lookup'),
    createBlock('instruction.skill', {id:'s',config:{exportResource:'s'}}),
  ],edges:[]};
  graph.edges.push(...connectBlocks(graph, 's','different-material'));
  const files = archive({
    title:'같은 역할',graph,
    resources:[{kind:'skill', key:'s',name:'handbook',version:'1',available:true,included:true,files:['resources/s/SKILL.md'],steps:['different-material']}],
    files:[{path:'resources/s/SKILL.md',data:Buffer.from('표기 규칙').toString('base64')}],
  });
  const roles = rolePaths(files);
  assert.equal(roles.length, 3);
  const repeated = roles.find(path => files[path].includes('A01'));
  assert.ok(repeated && files[repeated].includes('B02'));
  assert.doesNotMatch(files[repeated], /C03|D04|\.agents\/skills\/handbook/);
  const assignments = Array.from(files[repeated].matchAll(/^## (\S+) .*$/gm), match => match[1]);
  assert.equal(new Set(assignments).size, 2);
  for (const key of assignments) assert.ok(files['AGENTS.md'].includes(key));
  const newTool = roles.find(path => files[path].includes('C03'));
  const newSkill = roles.find(path => files[path].includes('D04'));
  assert.ok(newTool && newSkill && newTool !== newSkill);
  assert.match(files[newTool], /update/);
  assert.match(files[newSkill], /\.agents\/skills\/handbook\/SKILL\.md/);
});

test('역할 파일에서 작은 설계와 큰 설계의 하위 작업 시작점을 찾아갈 수 있다', () => {
  const role = createBlock('agent.delegate', {id:'job',config:{role:'검토', instruction:'이 하위 설계를 검토하세요.'}});
  const start = createBlock('input.user_request', {id:'inner',title:'검토 원문 받기'});
  role.graph = {nodes:[start, createBlock('output.answer',{id:'end'})],edges:[]};
  role.graph.edges.push(...connectBlocks(role.graph, start.id,'end'));
  const graph: Graph = {nodes:[role],edges:[]};
  for (const large of [false,true]) {
    if (large) graph.nodes.push(createBlock('ai.single_task',{id:'long',config:{goal:'상세 단계\n'.repeat(205)}}));
    const files = archive({title:'하위 작업',graph,resources:[],files:[]});
    const [path] = rolePaths(files);
    const match = files[path].match(/\[[^\n]*검토 원문 받기[^\n]*?\]\(([^)]+)\)/);
    assert.ok(match);
    const [destination,anchor] = match[1].split('#');
    const target = posix.normalize(posix.join(posix.dirname(path),destination));
    assert.ok(files[target]?.includes(start.title));
    if (large) assert.ok(target.startsWith('workflow/'));
    else {
      assert.equal(target,'AGENTS.md');
      assert.ok(anchor && files[target].includes('id="' + anchor + '"'));
    }
  }
});
