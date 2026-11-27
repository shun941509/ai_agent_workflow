import assert from 'node:assert/strict';
import {test} from 'node:test';
import {designPreparation} from '../src/domain/export-design-preparation';
import {activeExportPreparation} from '../src/domain/agent-export';
import {connectBlocks, createBlock} from '../src/domain/graph';
import type {Block,Graph} from '../src/domain/types';

function sequence(...nodes:Block[]):Graph {
  const graph:Graph = {nodes,edges:[]};
  for (let i=1;i<nodes.length;i++) graph.edges.push(...connectBlocks(graph,nodes[i-1].id,nodes[i].id));
  return graph;
}
const start = () => createBlock('input.user_request',{id:'start'});
const end = () => createBlock('output.answer',{id:'end'});

test('준비된 설계에는 보완 안내가 없고 없는 연결과 역할은 해당 중첩 단계로 안내한다',()=>{
  assert.deepEqual(designPreparation(sequence(start(),end())),[]);
  const member = createBlock('agent.delegate',{id:'private-member-id',title:'발표 준비',config:{instruction:'자료 정리'}});
  const child = sequence(start(),member,end());
  child.edges.push({id:'broken',kind:'flow',from:member.id,to:'removed',out:'next',input:'in'});
  const team = createBlock('agent.team',{id:'private-team-id',title:'자료팀',config:{goal:'발표'},graph:child});
  const items = designPreparation(sequence(start(),team,end()));
  assert.ok(items.some(item=>item.step==='자료팀 › 발표 준비'&&item.action.includes('위임할 역할')&&item.reason.includes('호출 이름')));
  assert.ok(items.some(item=>item.step==='자료팀 › 발표 준비'&&item.reason.includes('연결할 블록을 찾을 수 없습니다')));
  assert.deepEqual(items.find(item=>item.action.includes('위임할 역할'))?.stepPath,['1','1']);
  assert.doesNotMatch(JSON.stringify(items),/private-team-id|private-member-id|removed/);
  assert.equal(designPreparation({nodes:[],edges:[]}).filter(item=>item.step==='Workflow 전체').length,2);
});

test('실제 새 첨부·예약/이벤트·기억 이름·자료판 저장소와 내장 도구를 사용하는 단계를 안내한다',()=>{
  const file = createBlock('file.input',{title:'회의록',config:{attachmentMode:'request',accept:'.csv',content:'private-example-bytes'}});
  const memory = createBlock('memory.access',{title:'설정 보관',config:{key:'사용 지점'}});
  const store = createBlock('knowledge.manage',{title:'자료판 등록',config:{storeKey:'지점별 규정',operation:'publish'}});
  const task = createBlock('agent.task',{title:'내 예약',config:{goal:'예약 확인',allowedTools:['reservations.list']}});
  const graph = sequence(file,memory,store,task,end());
  graph.nodes.push(createBlock('control.trigger',{title:'정기 접수',config:{trigger:'schedule',schedule:'every 15m'}}),
    createBlock('control.trigger',{title:'새 회의',config:{trigger:'event',event:'new-meeting'}}));
  const items = designPreparation(graph);
  const on = (step:string) => items.filter(item=>item.step===step).map(item=>item.action+' '+item.reason).join('\n');
  assert.match(on('회의록'),/새 파일.*\.csv/);
  assert.match(on('정기 접수'),/예약 서비스.*every 15m/);
  assert.match(on('새 회의'),/new-meeting.*이벤트/);
  assert.match(on('설정 보관'),/기억 저장소.*사용 지점/);
  assert.match(on('자료판 등록'),/지점별 규정.*저장소/);
  assert.match(on('내 예약'),/예약 조회.*도서관 서비스/);
  assert.doesNotMatch(JSON.stringify(items),/private-example-bytes/);
});

test('호출형 Workflow는 Agent의 MCP 판을 상속하며 충돌한 판의 비공개 이름은 내보내지 않는다',()=>{
  const toolName = 'mcp.private-asset-id.private-tool';
  const tool = createBlock('tool.invoke',{title:'공유 자료 확인',config:{tool:toolName}});
  const definition = createBlock('workflow.tool',{title:'조회 함수',config:{name:'lookup',description:'자료 조회'},graph:sequence(start(),tool,end())});
  const agent = createBlock('agent.task',{title:'분석자',config:{goal:'검색',allowedTools:[toolName]}});
  const connector = (edition:number) => createBlock('connection.mcp',{title:'비공개 서버 이름',config:{assetId:'private-asset-id',version:edition}});
  const first = connector(1);
  const graph = sequence(start(),agent,end());
  graph.nodes.push(definition,first);
  graph.edges.push(...connectBlocks(graph,definition.id,agent.id),...connectBlocks(graph,first.id,agent.id));
  assert.deepEqual(designPreparation(graph),[]);
  const key = JSON.stringify(['private-asset-id',1]);
  assert.deepEqual(designPreparation(graph,new Map([[key,['private-tool']]])),[]);
  const unavailable = designPreparation(graph,new Map([[key,['different-tool']]]));
  assert.deepEqual(unavailable.filter(item=>item.reason.includes('지정한 MCP 버전')).map(item=>item.step).sort(),
    ['분석자','조회 함수 › 공유 자료 확인'].sort());
  assert.doesNotMatch(JSON.stringify(unavailable),/private-asset-id|private-tool|different-tool|비공개 서버 이름/);
  const second = connector(2);
  graph.nodes.push(second); graph.edges.push(...connectBlocks(graph,second.id,agent.id));
  const items = designPreparation(graph);
  assert.ok(items.some(item=>item.step==='조회 함수 › 공유 자료 확인'&&item.reason.includes('버전을 하나로 결정')));
  assert.doesNotMatch(JSON.stringify(items),/private-asset-id|private-tool|비공개 서버 이름/);
});

test('상위 Agent가 허용하지 않은 명시적 호출과 보상은 호출 단계에서 준비를 요청한다',()=>{
  const name = 'mcp.studio-private-id.secret_write';
  for (const type of ['tool.invoke','error.compensate']) {
    const target = createBlock(type,{title:'예약 변경',config:{tool:name}});
    const child = sequence(start(),target,end());
    const role = createBlock('agent.delegate',{title:'위임',config:{role:'담당',instruction:'예약 확인',allowedTools:[]},graph:child});
    const items = designPreparation(sequence(start(),role,end()));
    assert.ok(items.some(item=>item.step==='위임 › 예약 변경'&&item.reason.includes('호출자가 허용한 도구 목록')));
    assert.doesNotMatch(JSON.stringify(items),/studio-private-id|secret_write/);
  }
});

test('잘못된 도구 허용 목록이 있는 초안도 준비 안내를 생성하고 내부 도구 제안은 가린다',()=>{
  const bad = createBlock('agent.task',{config:{goal:'확인',allowedTools:{},requiredTools:['mcp.private.asset']}});
  const items = designPreparation(sequence(start(),bad,end()));
  assert.ok(items.some(item=>item.reason.includes('요구하는 도구')));
  assert.doesNotMatch(JSON.stringify(items),/mcp\.private\.asset/);
});

test('분기의 연결 누락은 해당 출구를 고를 때만 확인하며, 그래프 전체 항목은 루트에 둔다',()=>{
  const branch=createBlock('control.branch',{id:'when',title:'신청 분류'});
  const graph=sequence(start(),branch,end());
  graph.edges.push({id:'yes',kind:'flow',from:branch.id,to:'end',out:'yes',input:'in'});
  const item=designPreparation(graph).find(item=>item.step==='신청 분류' && item.reason.includes('이어갈'));
  assert.ok(item);
  assert.deepEqual(item.stepPath,['1']);
  assert.match(item.action,/경로를 선택했을 때/);
  assert.ok(designPreparation({nodes:[],edges:[]}).every(item=>item.stepPath?.length===0));
});

test('사용자가 붙인 번호와 자동 번호가 겹쳐도 단계 식별과 준비 항목의 순서를 유지한다',()=>{
  const files=['회의','회의','회의 (1)'].map((title,i)=>createBlock('file.input',{id:String(i),title,config:{attachmentMode:'request'}}));
  const graph:Graph={nodes:files,edges:[]};
  const notes=designPreparation(graph);
  const active=activeExportPreparation(notes,[]);
  const fileRows=active.filter(item=>item.action.includes('새 파일'));
  assert.deepEqual(fileRows.map(x=>x.stepPath),[['0'],['1'],['2']]);
  assert.equal(new Set(fileRows.map(x=>x.step)).size,3);
  const paths=active.map(item=>JSON.stringify(item.stepPath));
  for(const path of new Set(paths)) assert.ok(paths.slice(paths.indexOf(path),paths.lastIndexOf(path)+1).every(p=>p===path));
});

test('상위가 제한한 선택적 모델 도구는 제외하고 실제 MCP의 승인 대상 권한은 요구한다',()=>{
  const name='mcp.private.read';
  const task=createBlock('agent.task',{id:'agent',title:'조회 선택',config:{goal:'선택',allowedTools:[name]}});
  const approval=createBlock('approval.action',{id:'confirm',title:'조회 승인',config:{tool:name}});
  const connector=createBlock('connection.mcp',{id:'ref',config:{assetId:'private',version:1}});
  const child=sequence(start(),task,approval,end());
  child.nodes.push(connector);
  child.edges.push(...connectBlocks(child,'ref','confirm'));
  const role=createBlock('agent.delegate',{title:'자료 관리',config:{role:'검토자',allowedTools:[],instruction:'확인'},graph:child});
  const items=designPreparation(sequence(start(),role,end()));
  assert.ok(!items.some(item=>item.step.endsWith('조회 선택')&&item.reason.includes('도구')));
  assert.ok(items.some(item=>item.step.endsWith('조회 승인')&&item.reason.includes('호출자가 허용한 도구')));
  approval.config.tool='reservations.create';
  assert.ok(!designPreparation(sequence(start(),approval,end())).some(item=>item.action.includes('도서관 서비스')));
});

test('같은 하위 도구의 연결이 부족한 호출자만 실행 중 확인한다',()=>{
  const tool='mcp.private.lookup';
  const child=sequence(start(),createBlock('tool.invoke',{title:'조회',config:{tool}}),end());
  const definition=createBlock('workflow.tool',{id:'def',title:'자료 조회',graph:child});
  const agent=(id:string,title:string)=>createBlock('agent.task',{id,title,config:{goal:'확인',allowedTools:[tool]}});
  const graph=sequence(start(),agent('a','연결된 담당'),agent('b','준비할 담당'),end());
  graph.nodes.push(definition,createBlock('connection.mcp',{id:'pin',config:{assetId:'private',version:1}}));
  for(const [from,to] of [['pin','a'],['def','a'],['def','b']]) graph.edges.push(...connectBlocks(graph,from,to));
  const items=designPreparation(graph).filter(item=>item.step==='자료 조회 › 조회');
  assert.equal(items.length,1);
  assert.match(items[0].action,/호출자가 ‘준비할 담당’인 경우/);
  assert.doesNotMatch(items[0].action,/연결된 담당/);
});
