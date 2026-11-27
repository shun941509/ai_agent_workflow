import assert from 'node:assert/strict';
import {mkdtempSync, rmdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, posix} from 'node:path';
import {test} from 'node:test';
import {strFromU8, unzipSync} from 'fflate';
import {activeExportPreparation, type ExportPackage} from '../src/domain/agent-export';
import {connectBlocks, createBlock, validateGraph} from '../src/domain/graph';
import type {Block, Graph} from '../src/domain/types';
import {prepareAgentExport, previewAgentExport} from '../src/server/agent-export';
import {buildAgentZip} from '../src/server/agent-zip';
import {authenticate} from '../src/server/auth';
import {db} from '../src/server/db';
import {createProject} from '../src/server/projects';

type Files = Record<string,string>;
const block = (type: string, id: string, config = {}, title = id) => createBlock(type,{id,title,config});

function wired(nodes: Block[], connections: [string,string,string?][]): Graph {
  const graph: Graph = {nodes,edges:[]};
  for (const [from,to,route] of connections) {
    const edges = connectBlocks(graph,from,to,route ? [
      {kind:'flow',out:route,input:'in'}, {kind:'data',out:'value',input:'input'},
    ] : undefined);
    assert.ok(edges.length, from + ' → ' + to);
    graph.edges.push(...edges);
  }
  return graph;
}

function unpack(pkg: ExportPackage): Files {
  const files = unzipSync(buildAgentZip(pkg));
  return Object.fromEntries(Object.entries(files).map(([path,body]) => [path,strFromU8(body)]));
}

function archive(graph: Graph, resources: ExportPackage['resources'] = []): Files {
  return unpack({title:'단계 준비 시험',graph,resources,files:[]});
}

function stage(files: Files, title: string) {
  if (files['workflow/index.md']) {
    const page = Object.keys(files).find(path => path.startsWith('workflow/step-') && files[path].startsWith('# ' + title + '\n'));
    assert.ok(page, title);
    return {path:page, text:files[page]};
  }
  const section = files['AGENTS.md'].split('\n### ' + title + '\n')[1];
  assert.ok(section, title);
  return {path:'AGENTS.md',text:section.split('\n### ')[0]};
}

// Follow the exported relative link, then inspect just its target so another stage cannot satisfy the check.
function preparation(files: Files, page: {path:string; text:string}) {
  const target = page.text.match(/\]\(((?:\.\.\/)?README\.md)#(prep-[^\s)]+)\)/);
  assert.ok(target, page.path + ' 준비 항목 링크');
  assert.equal(posix.join(posix.dirname(page.path),target[1]),'README.md');
  const marker = '<a id="' + target[2] + '"></a>';
  const readme = files['README.md'].split(marker);
  assert.equal(readme.length,2,'하나의 준비 항목에 연결되어야 합니다 — ' + marker);
  return readme[1].split(/<a id=|\n## /)[0];
}

test('조건이 선택한 단계에서만 준비 항목을 열고 사용 가능한 설계에는 준비 링크를 만들지 않는다', () => {
  const graph = wired([
    block('input.user_request','start'), block('control.branch','branch'),
    block('memory.access','memory',{key:'weeklyMemo'}), block('output.answer','memo-end'), block('output.answer','plain-end'),
  ],[['start','branch'],['branch','memory','yes'],['branch','plain-end','no'],['memory','memo-end']]);
  assert.deepEqual(validateGraph(graph),[]);
  for (const split of [false,true]) {
    const files = archive(split ? {...graph,agentScope:{mode:'dedicated',purpose:'긴'.repeat(6000)}} : graph);
    assert.equal(Boolean(files['workflow/index.md']),split);
    assert.match(preparation(files,stage(files,'memory')),/weeklyMemo/);
    assert.doesNotMatch(stage(files,'plain-end').text,/README\.md#/);
    assert.doesNotMatch(stage(files,'branch').text,/README\.md#/);
    assert.match(files['AGENTS.md'],/필요한 조치[^\n]*이유[^\n]*회신/);
    assert.match(files['AGENTS.md'],/대기한 단계부터 재개/);
  }
  const ready = archive(wired([block('input.user_request','start'),block('output.answer','done')],[['start','done']]));
  assert.doesNotMatch(ready['AGENTS.md'],/README\.md#(?:prep-|workflow-preparation)/);
  assert.doesNotMatch(ready['README.md'],/## 실행 준비/);
});

test('시작할 단계가 없는 빈 설계도 ZIP을 받고 공통 진입점에서 전체 설계의 준비 사항을 찾는다', () => {
  const files = archive({nodes:[],edges:[]});
  assert.ok(files['AGENTS.md'] && files['README.md']);
  const links = files['AGENTS.md'].match(/\[[^\]]+\]\(README\.md#prep-[^\s)]+\)/g) ?? [];
  const groups = links.map(text => preparation(files,{path:'AGENTS.md',text}));
  assert.ok(groups.some(group => group.includes('시작') && group.includes('종료')));
});

test('같은 블록 ID를 재사용한 두 하위 설계는 자신의 준비 항목으로 연결한다', () => {
  const callers = ['왼쪽 호출','오른쪽 호출'].map((title,index) => {
    const call = block('workflow.call','call' + index,{},title);
    call.graph = wired([
      block('input.user_request','in'),block('memory.access','same',{key:'memo-' + index},'기억'),block('output.answer','out'),
    ],[['in','same'],['same','out']]);
    return call;
  });
  const graph = wired([block('input.user_request','start'),...callers,block('output.answer','out')],
    [['start','call0'],['call0','call1'],['call1','out']]);
  assert.deepEqual(validateGraph(graph),[]);
  graph.agentScope = {mode:'dedicated',purpose:'긴'.repeat(6000)};
  const files = archive(graph);
  for (const [index,caller] of callers.entries()) {
    const group = preparation(files,stage(files,caller.title + ' / 기억'));
    assert.ok(group.includes('memo-' + index));
    assert.ok(!group.includes('memo-' + (1-index)));
    assert.doesNotMatch(stage(files,caller.title).text,/README\.md#/);
  }
});

test('같은 하위 Agent의 두 배정 중 준비가 필요한 배정만 사용자에게 확인하도록 연결한다', () => {
  const graph = wired([block('input.user_request','start'),
    block('agent.delegate','incomplete',{role:'교정자'},'초안 교정'),
    block('agent.delegate','complete',{role:'교정자',instruction:'완성된 원고를 반환하세요.'},'최종 교정'),
    block('output.answer','done')],[['start','incomplete'],['incomplete','complete'],['complete','done']]);
  const files = archive(graph);
  const roles = Object.keys(files).filter(path => path.startsWith('agents/'));
  assert.equal(roles.length,1);
  const assignments = files[roles[0]].split(/^## /m).slice(1);
  const missing = assignments.find(text => text.split('\n')[0].includes('초안 교정'));
  const ready = assignments.find(text => text.split('\n')[0].includes('최종 교정'));
  assert.ok(missing && ready);
  assert.equal(preparation(files,{path:roles[0],text:missing}),preparation(files,stage(files,'초안 교정')));
  assert.doesNotMatch(ready,/README\.md#/);
});

test('병렬 작업에서 준비를 기다리는 경로는 대기하고, 확정된 실패는 설계별 정책으로 처리한다', () => {
  for (const policy of ['stop','collect']) {
    const graph = wired([block('input.user_request','start'),block('control.parallel','fork',{failurePolicy:policy}),
      block('memory.access','pending',{key:'보관함'}),block('data.transform','other',{operation:'text'}),
      block('control.join','join',{partialFailure:policy==='stop'?'fail':'report'}),block('output.answer','out')],
    [['start','fork'],['fork','pending'],['fork','other'],['pending','join'],['other','join'],['join','out']]);
    assert.deepEqual(validateGraph(graph),[]);
    const files = archive(graph);
    assert.match(preparation(files,stage(files,'pending')),/보관함/);
    assert.doesNotMatch(stage(files,'other').text,/README\.md#/);
    const fork = stage(files,'fork').text, join = stage(files,'join').text;
    assert.match(fork,/준비[^\n]*대기[^\n]*독립된 경로/);
    assert.match(fork,/준비[^\n]*없다고 확인[^\n]*실패로 처리/);
    assert.match(join,/준비나 회신 대기[^\n]*완료한 작업의 결과는 재사용/);
    assert.match(fork, policy==='stop' ? /새 작업을 중단/ : /남은 경로를 계속/);
    assert.match(join, policy==='stop' ? /합류를 실패로 처리/ : /성공한 결과와 함께/);
  }
});

test('MCP 판이 충돌한 호출은 연결 선택을 기다리고, 제외한 연결의 식별자와 주소를 노출하지 않는다', () => {
  const resources: ExportPackage['resources'] = [1,2].map(version => ({
    kind:'mcp',key:'edition-' + version,name:'Archive Edition ' + version,version:String(version),available:true,included:true,
    steps:['조회'],files:[],mcp:{id:'archive-' + version,url:'https://edition-' + version + '.example.org/mcp',tools:['exact_lookup']},
  }));
  const graph = wired([block('input.user_request','start'),
    ...resources.map(resource => block('connection.mcp',resource.key,{assetId:'archive-asset',version:resource.version,exportResource:resource.key},resource.name)),
    block('tool.invoke','query',{tool:'mcp.archive-asset.exact_lookup'},'조회'),block('output.answer','end')],
  [['start','query'],['edition-1','query'],['edition-2','query'],['query','end']]);
  const selected = archive(graph,resources);
  const query = stage(selected,'조회');
  assert.match(preparation(selected,query),/버전 하나/);
  for (const version of [1,2]) {
    const choice = version + '판 (archive-' + version + ')';
    assert.ok(query.text.includes(choice));
    assert.ok(selected['README.md'].includes(choice));
  }
  assert.doesNotMatch(query.text,/도구 이름[^\n]*archive-[12] \/ exact_lookup/);
  const excluded = archive(graph,resources.map(resource => ({...resource,mcp:undefined,included:false})));
  assert.match(preparation(excluded,stage(excluded,'조회')),/MCP/);
  assert.doesNotMatch(Object.values(excluded).join('\n'),/Archive Edition|archive-asset|exact_lookup|edition-[12]\.example/);
  for (const name of ['.codex/config.toml','.mcp.json','opencode.json']) assert.ok(!excluded[name]);
});

test('미리보기에서 자료를 선택해 ZIP을 받을 때 연결된 분기 출구는 진행하고 빠진 출구에만 조치를 요구한다', context => {
  const previous = process.env.STUDIO_DATA_DIR;
  const directory = mkdtempSync(join(tmpdir(),'workflow-stage-preparation-'));
  process.env.STUDIO_DATA_DIR = directory;
  context.after(() => {
    db().close();
    if (previous === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = previous;
    for (const name of ['studio.sqlite','studio.sqlite-shm','studio.sqlite-wal']) rmSync(join(directory,name),{force:true});
    rmdirSync(directory);
  });
  const owner = authenticate('signup','stage-export','stage-test-passphrase','').user;
  const project = createProject(owner,{title:'접수 분류'});
  const graph = wired([block('input.user_request','start'),
    block('control.branch','route',{yesLabel:'확인 완료',noLabel:'자료 재요청'},'접수 분류'),
    block('ai.single_task','writer',{goal:'요약'},'접수 요약'),block('output.answer','done'),
    block('resource.context','rules',{content:'담당자에게 보낼 요약 작성 규칙'},'작성 기준')],
  [['start','route'],['route','writer','yes'],['writer','done'],['rules','writer']]);
  assert.deepEqual(validateGraph(graph).map(issue => issue.routeId),['no']);
  const request = {id:project.id,title:project.title,graph};
  const preview = previewAgentExport(owner,request);
  assert.equal(preview.resources.length,1);
  const key = preview.resources[0].key;
  for (const selected of [[],[key]]) {
    const expected = activeExportPreparation(preview.preparation,selected);
    const files = unpack(prepareAgentExport(owner,{...request,previewId:preview.previewId,selected}));
    const branch = stage(files,'접수 분류');
    const notice = preparation(files,branch);
    assert.match(notice,/자료 재요청/);
    assert.doesNotMatch(notice,/확인 완료/);
    assert.match(branch.text,/확인 완료 → .*접수 요약/);
    assert.match(files['AGENTS.md'],/선택한 출구[^\n]*바로 진행/);
    const writer = stage(files,'접수 요약');
    if (selected.length) {
      assert.doesNotMatch(writer.text,/README\.md#/);
    } else {
      assert.match(preparation(files,writer),/작성 기준/);
    }
    for (const item of expected) assert.ok(files['README.md'].includes(item.action) && files['README.md'].includes(item.reason));
  }
});
