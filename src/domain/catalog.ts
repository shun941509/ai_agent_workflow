import { levels, type Block, type Choice, type Definition, type EdgeKind, type Field, type Group, type Port } from './types';

const text = (key: string, label: string, required = false, value = ''): Field =>
  ({ key, label, type: 'text', required, default: value });
const area = (key: string, label: string, required = false, value = ''): Field =>
  ({ ...text(key, label, required, value), type: 'textarea' });
const count = (key: string, label: string, value: number, min: number, max: number): Field =>
  ({ key, label, type: 'number', advanced: true, default: value, min, max });
const json = (key: string, label: string, value: object, required = false): Field =>
  ({ key, label, type: 'json', default: value, required });
const choice = (key: string, label: string, options: [string, string][]): Field =>
  ({ key, label, type: 'select', options: options.map(([value, caption]) => ({value, label: caption})), default: options[0][0] });
const port = (id: string, label: string, kind: EdgeKind, valueType = 'any', required = false, multiple = false): Port =>
  ({ id, label, kind, valueType, required, multiple });
const incoming = port('in','실행 시작','flow','void',false,true);
const next = port('next','작업 후','flow','void');
const value = port('value','결과','data');
const input = port('input','입력값','data','any',true);
const inputs = [incoming,input];
const outputs = [next,value];
const result = (id: string, label: string) => port(id, label, 'flow', 'void');
const ref = (id: string,label: string,valueType = 'resource') => port(id,label,'reference',valueType,false,true);
const context = ref('context','참고 자료'), skill = ref('skill','작업 지침','skill'), mcp = ref('mcp','연결할 도구','mcp');
const reference = (valueType: string) => port('ref','참조','reference',valueType);
const question = port('question','원래 질문','data','any');
const assetFields = [
  text('assetId','자료 라이브러리 항목'), text('version','자료 버전',false,'1'),
];
const agentFields = [
  area('goal','맡길 일',true), area('instruction','작업 지시'), area('criterion','원하는 결과'),
];
export function selectionSettings(node:Block) {
  const c=node.config;
  return node.type==='agent.select_candidate'
    ? {options:c.candidates??c.tasks??[],instruction:c.criterion??c.goal??''}
    : {options:c.tasks??c.candidates??[],instruction:c.goal??c.criterion??''};
}
const agentInputs = [...inputs,context,skill,mcp,question];
const functionRef = ref('workflow','호출 가능한 Workflow','workflow');
const entry = (type: string, name: string, description: string, group: Group, level: number,
  fields: Field[], ins: Port[] = inputs, outs: Port[] = outputs, menuType = type): Definition =>
  ({ type, name, description, group, level: levels[level - 1], fields, inputs: ins, outputs: outs, menuType });

export const replyDeadlineDefaultMinutes = 60;
export const replyDeadlineMaxMinutes = 10080;

export const terminalBehaviorOptions = [
  {value:'answer', label:'답변 반환'},
  {value:'success', label:'완료 안내'},
  {value:'cancelled', label:'실행 중지'},
  {value:'failed', label:'실패 처리'},
] as const satisfies readonly Choice[];
export type TerminalBehavior = typeof terminalBehaviorOptions[number]['value'];

export function terminalBehavior(node: Block): TerminalBehavior {
  if (node.type !== 'control.terminate') return 'answer';
  const status = node.config.status;
  return status === 'cancelled' || status === 'failed' ? status : 'success';
}

export function canonicalErrorStrategy(strategy: string): string {
  return strategy === 'report' || strategy === 'fallback' ? 'continue' : strategy;
}
export function answerFormat(value:unknown):'text'|'json'|'markdown' {
  const format=typeof value==='string'?value.trim().toLowerCase():'';
  return format==='json'||format==='markdown'?format:'text';
}

export function changesKnowledgeRelease(node: Block): boolean {
  return node.type === 'knowledge.manage' && (node.config.operation === 'publish' || node.config.operation === 'withdraw');
}

export const catalog: Definition[] = [
  entry('input.user_request','사용자 입력','실행을 시작한 사람의 질문을 전달합니다.','input',1,
    [area('question','예시 질문')],[],outputs),
  entry('input.form','입력 양식·추가 질문','부족한 정보를 물어보고 같은 실행에서 회신을 받습니다. 필요하면 회신 기한을 정합니다.','input',2,
    [area('prompt','이용자에게 물어볼 내용',true),json('fields','입력 항목',[]),
      text('historyFields','다음 문답에 남길 회신 항목 (쉼표로 구분, *는 전체)'),
      count('replyTimeoutMinutes','회신 기한(분)',0,0,replyDeadlineMaxMinutes)],[incoming,{...input,required:false}],outputs),
  entry('control.trigger','시작 조건','선택한 시작 조건을 충족하는 실행의 입력을 전달합니다.','input',4,
    [choice('trigger','시작 방식',[['manual','수동'],['schedule','예약'],['event','이벤트']]),text('schedule','실행 일정'),text('event','이벤트 이름')],[],outputs),
  entry('output.answer','답변 전달','결과를 반환하거나 완료 안내, 실행 중지, 실패 처리를 선택합니다.','input',1,
    [choice('format','표시 형식',[['text','텍스트'],['json','JSON'],['markdown','Markdown']])],inputs,[]),
  entry('control.terminate','종료·중단','지정한 상태와 안내 문구로 종료합니다.','input',2,
    [{key:'status', label:'종료 결과', type:'select', options:terminalBehaviorOptions.filter(option=>option.value!=='answer'), default:'success'},
      text('message','종료 안내')],[incoming,{...input,required:false}],[],'output.answer'),
  entry('ai.single_task','AI 한 번 작업','모델에 한 번 요청해 결과를 얻습니다.','agent',1,agentFields,agentInputs,outputs,'agent.task'),
  entry('agent.task','AI 작업','목표와 허용한 도구 범위 안에서 답을 완성합니다.','agent',1,
    [...agentFields,json('allowedTools','허용할 도구',[]),count('maxSteps','최대 판단 횟수',4,1,20)],
    [...agentInputs,functionRef]),
  entry('ai.classify','AI 분류','입력의 의미를 읽어 등록한 범주 중 하나를 고릅니다.','agent',3,
    [json('categories','분류 범주',['일반','기타'],true),area('instruction','판단 기준')],inputs,[result('other','미분류'),value]),
  entry('agent.team','Agent 팀','팀 내부의 담당자와 협업 경로를 하나의 일로 실행합니다.','agent',4,
    [area('goal','팀이 맡을 일',true),text('responsible','최종 응답 담당',false,'대표 Agent')],[...inputs,skill]),
  entry('agent.coordinate','작업 순서 정하기','허용한 작업 중 목표에 필요한 작업을 골라 순서대로 목록을 반환합니다.','agent',4,
    [area('goal','조정 목표',true),json('tasks','허용 작업',[],true),count('maxSteps','선택 한도',3,1,20)],inputs,outputs,'agent.select_candidate'),
  entry('agent.select_candidate','담당자 한 명 선택','기준에 맞는 담당자 한 명을 골라 이름을 반환합니다.','agent',4,
    [json('candidates','선택할 후보',[],true),area('criterion','선택 기준',true)]),
  entry('agent.delegate','Agent에게 작업 전달','지정한 역할 또는 내부 설계에 위임하고 결과를 돌려받습니다.','agent',4,
    [text('role','담당 Agent',true),area('instruction','맡길 일',true)],agentInputs),
  entry('agent.create_dynamic','필요한 Agent 만들기','요청에 들어 있는 담당 대상별로 허용 역할을 생성합니다.','agent',5,
    [text('role','허용 역할',true),area('instruction','담당자에게 맡길 일',true),text('separator','대상 구분 문자',false,','),
      count('maxCreatedAgents','전체 생성 상한',3,1,20),count('maxInFlightAgents','동시 실행 상한',2,1,10),
      choice('failurePolicy','담당자 일부 미완료 시',[['stop','새 담당자 생성과 후속 정리 중단'],['collect','확인된 결과와 미완료 사유 수집']]),
      {...choice('resultRequirement','담당 작업 완료 조건',[['output','담당 작업이 결과를 반환'],['evidence','하위 설계가 확인한 원문 근거 필요']]),advanced:true},
      count('maxDepth','생성 깊이',1,1,5)],agentInputs),
  entry('agent.handoff','담당 Agent 바꾸기','다음 담당자에게 작업과 응답 책임을 전달합니다.','agent',4,
    [text('role','새 담당 Agent',true),area('instruction','이어갈 일',true)],agentInputs,outputs,'agent.delegate'),
  entry('tool.invoke','도구 사용','허용된 도구에 정해진 인자를 보내고 응답을 받습니다.','resource',3,
    [text('tool','도구 이름',true),json('args','요청 인자',{})],[...inputs,mcp]),
  entry('resource.context','자료 가져오기','특정 자료판 또는 이 사본의 원문을 제공합니다.','resource',1,
    [...assetFields,area('content','자료 원문')],[],[reference('resource'),port('value','자료 본문','data','text')]),
  entry('instruction.skill','작업 지침·Skill','허용된 작업 방법과 부속 자료를 참조합니다.','resource',2,
    [...assetFields,area('content','SKILL.md 지침')],[],[reference('skill')], ''),
  entry('data.transform','값 변환','입력값에서 항목을 선택하거나 이름과 형식을 바꿉니다.','resource',3,
    [choice('operation','변환 방식',[['select','항목 선택'],['rename','이름 바꾸기'],['text','문자열로 변환']]),text('path','가져올 항목'),text('target','새 항목 이름')]),
  entry('memory.access','기억 읽기·쓰기','현재 이용자의 설계된 기억을 읽거나 저장합니다.','resource',4,
    [choice('operation','작업',[['read','읽기'],['write','쓰기']]),text('key','기억 이름',true)], [incoming,{...input,required:false}]),
  entry('connection.mcp','MCP 연결','서버에 등록된 도구 연결을 참조합니다.','resource',3,
    [...assetFields,text('server','MCP 연결 이름')],[],[reference('mcp')], ''),
  entry('file.input','파일 입력','이용자가 입력한 파일과 원문을 받습니다.','file',2,
    [text('accept','허용 형식',false,'.txt,.md,.json,.csv'),
      choice('attachmentMode','사용할 파일',[['initial','첫 질문에 첨부한 파일 사용'],['request','이 단계에서 새 파일 요청']]),
      text('historyFields','다음 문답에 남길 첨부 JSON 항목 (쉼표로 구분, *는 원문)'),
      text('fileName','파일 이름'),area('content','시험 파일 내용')],[],outputs),
  entry('document.read','문서 내용 읽기','연결된 파일의 본문과 원래 위치를 추출합니다.','file',2,
    [choice('format','문서 형식',[['auto','자동'],['text','본문'],['json','JSON'],['csv','표']])],inputs,[...outputs,port('lines','원래 행 번호와 본문','data')]),
  entry('knowledge.search','자료 검색','질문과 관련 있는 원문 위치와 발췌를 찾습니다.','file',3,
    [text('query','검색어 또는 질의'),{...choice('matchMode','검색 방식',[['ranked','관련도순'],['literal','검색어가 그대로 있는 원문 행']]),advanced:true},
      text('storeKey','저장한 자료집 이름'),text('version','검색 자료판'),count('topK','최대 결과 수',5,1,30)], [...inputs,context],
    [next,port('value','검색 결과','data','passages')]),
  entry('knowledge.manage','지식 저장소 관리','자료집을 준비하거나 검색 가능한 버전으로 관리합니다.','file',5,
    [choice('operation','작업',[['prepare','준비'],['index','색인'],['publish','발행'],['withdraw','철회']]),text('storeKey','자료집 이름'),text('version','자료판',true,'1')],[...inputs,context]),
  entry('file.create','파일 만들기','전달받은 결과를 다운로드할 파일로 만듭니다.','file',2,
    [text('fileName','파일 이름',true,'결과.txt'),choice('format','파일 형식',[['text','텍스트'],['json','JSON'],['csv','CSV'],['markdown','Markdown']])]),
  entry('control.branch','조건 분기','이전 단계의 값을 확인해 맞는 경로로 이동합니다.','flow',3,
    [text('path','비교할 항목'),choice('operator','비교 방식',[['truthy','값이 있음'],['equals','같음'],['contains','포함'],['greater','보다 큼']]),
      text('expected','비교 기준'),text('yesLabel','맞을 때',false,'맞음'),text('noLabel','그 밖에는',false,'그 밖의 경우')],inputs,[result('yes','맞음'),result('no','그 밖의 경우'),value]),
  entry('control.parallel','병렬 작업','독립적인 후속 경로를 함께 시작합니다.','flow',4,
    [count('maxConcurrency','동시 실행 수',2,1,10),choice('failurePolicy','일부 실패 시',[['collect','성공 결과 수집'],['stop','전체 중단']])]),
  entry('control.join','결과 모으기','실제로 시작된 경로의 결과를 수집합니다.','flow',4,
    [choice('merge','결과 형식',[['array','목록'],['text','텍스트'],['sections','제목과 본문']]),choice('partialFailure','일부 실패',[['report','미확인 항목과 함께'],['fail','실패 처리']])],
    [incoming,{...input,multiple:true}]),
  entry('control.loop','반복 처리','내부 Workflow를 항목별로 한도 안에서 반복합니다.','flow',4,
    [count('maxIterations','최대 반복',5,1,100)]),
  entry('workflow.call','Workflow 재사용','이 지점에서 내부 Workflow를 호출해 결과를 받습니다.','flow',4,
    [text('workflowId','Workflow 참조'),text('version','Workflow 버전')]),
  entry('workflow.tool','호출 가능한 Workflow','Agent가 선택할 수 있는 내부 Workflow를 연결합니다.','flow',4,
    [text('name','도구 이름',true,'workflow'),area('description','사용할 때',true),text('workflowId','Workflow 참조'),text('version','Workflow 버전')],[],[reference('workflow')],'workflow.call'),
  entry('control.wait','회신 기다리기','설정한 기한 안에 이용자가 회신하면 같은 실행을 이어갑니다.','flow',4,
    [area('prompt','기다릴 내용',true),count('timeoutMinutes','대기 제한(분)',replyDeadlineDefaultMinutes,1,replyDeadlineMaxMinutes)],
    [incoming,{...input,required:false}],outputs,'input.form'),
  entry('review.human','사람 검토','검토자에게 결과를 보여 주고 수정 의견을 받습니다.','quality',4,
    [area('prompt','검토할 사항',true)]),
  entry('approval.action','행동 승인','외부 작업과 인자를 확인한 후 승인 또는 거절합니다.','quality',3,
    [text('tool','승인할 작업',true),json('args','행동 인자',{}),area('prompt','승인 안내')],[...inputs,mcp],
    [result('approved','승인'),result('rejected','거절'),value]),
  entry('safety.redact','민감정보 검사·처리','출력에 포함된 민감정보를 가리거나 전달을 중단합니다.','quality',3,
    [choice('operation','발견 시',[['mask','가리기'],['block','전달 중단']]),json('categories','검사 항목',['email','phone'])]),
  entry('quality.evaluate','결과 평가','산출물을 제작자의 기대 기준에 맞춰 평가합니다.','quality',4,
    [area('criterion','평가 기준',true),count('threshold','통과 점수',70,0,100)]),
  entry('error.handle','오류 처리','앞 단계가 실패하면 후속 단계로 계속하거나 오류를 발생시켜 중단합니다.','error',3,
    [choice('strategy','처리 방식',[['continue','후속 단계로 계속'],['stop','중단']]),area('message','이용자 안내')]),
  entry('error.compensate','보상 작업','이미 실행한 행동을 되돌릴 도구와 대상 인자를 지정합니다.','error',5,
    [text('tool','보상 작업',true),json('args','보상 인자',{})],[...inputs,mcp],outputs,'tool.invoke'),
  entry('data.validate','데이터 검증','입력의 필수 항목과 형식을 검사합니다.','quality',3,
    [json('requiredFields','필수 항목',[],true),json('types','항목별 기대 형식',{})]),
  entry('quality.evidence','근거·출처 확인','질문의 주장을 실제 원문과 대조해 경로를 정합니다.','quality',3,
    [area('criterion','근거 충족 기준',false,'질문에 직접 답하는 원문이 있는지 확인합니다.'),
      {key:'includeSourceLines', label:'인용한 원문 행 전체도 반환', type:'boolean', default:false, advanced:true}],
    [incoming,port('input','검색된 구절','data','passages',true),question,context],
    [result('verified','근거 있음'),result('insufficient','근거 부족'),result('conflicting','근거 상충'),value]),
  entry('context.compress','문맥 정리·압축','다음 담당자가 필요한 사실과 원문 참조를 간결하게 정리합니다.','resource',5,
    [area('preserve','보존할 내용',true),count('maxLength','최대 글자 수',1000,50,12000)]),
];

const modeGroups: Record<string, Choice[]> = {
  'agent.task': [{value:'ai.single_task',label:'한 번 답하기'},{value:'agent.task',label:'목표까지 반복'}],
  'agent.delegate': [{value:'agent.delegate',label:'결과 돌려받기'},{value:'agent.handoff',label:'담당 넘기기'}],
  'workflow.call': [{value:'workflow.call',label:'정해진 단계에서 호출'},{value:'workflow.tool',label:'Agent가 도구로 호출'}],
  'agent.select_candidate': [{value:'agent.select_candidate',label:'담당자 한 명 선택'},{value:'agent.coordinate',label:'작업 순서 정하기'}],
  'tool.invoke': [{value:'tool.invoke',label:'일반 도구 호출'},{value:'error.compensate',label:'보상 작업'}],
};
for (const item of catalog) item.modes = modeGroups[item.menuType];
export const palette = catalog.filter(item => item.menuType === item.type).map(item =>
  item.type === 'agent.select_candidate'
    ? {...item, name:'담당자·작업 선택', description:'담당자 한 명의 이름이나 수행할 작업의 순서 목록을 반환합니다.'}
    : item
);
export const byType = new Map(catalog.map(item => [item.type,item]));

export function portsFor(node: Block): {inputs: Port[]; outputs: Port[]} {
  const item = byType.get(node.type);
  if (!item) return {inputs:[],outputs:[]};
  if (node.type === 'data.transform' && node.config.operation === 'text' && !node.config.path) {
    return {inputs:item.inputs.map(p => p.id === 'input' ? {...p, multiple:true} : p), outputs:item.outputs};
  }
  if (node.type === 'ai.classify') {
    const categories: unknown[] = Array.isArray(node.config.categories) ? node.config.categories : [];
    const names = new Set(categories.filter((s): s is string => typeof s === 'string' && !!s.trim()));
    const categoryPorts = Array.from(names, name => result('category:' + name, name));
    const outputs = item.outputs.map(p => p.id === 'other' && categoryPorts.some(c => c.label.trim() === p.label)
      ? { ...p, label: p.label + ' (기본 경로)' } : p);
    return { inputs: item.inputs, outputs: [...categoryPorts, ...outputs] };
  }
  if (node.type === 'control.branch') {
    const yes = String(node.config.yesLabel ?? '').trim() || '맞음';
    const no = String(node.config.noLabel ?? '').trim() || '그 밖의 경우';
    const same = yes === no;
    return { inputs: item.inputs, outputs: item.outputs.map(p => {
      if (p.id === 'yes') return { ...p, label: same ? yes + ' (조건 일치)' : yes };
      if (p.id === 'no') return { ...p, label: same ? no + ' (그 밖의 경우)' : no };
      return p;
    }) };
  }
  return {inputs:item.inputs,outputs:item.outputs};
}
