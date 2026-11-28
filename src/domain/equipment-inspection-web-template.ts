import {attachLessonSkill} from './lesson-skills';
import {Drawing} from './template-drawing';
import type {Lesson} from './types';

const question = '같은 검수 완료 알림을 두 번 보내면 반납 목록과 처리 이력이 어떻게 바뀌나요? 실습에서 얻은 검증 기록을 바탕으로 이 동작을 웹으로 구현하고 확인할 방법을 정리해 주세요.';
const caseDescription = [
  '창구에서는 장비별로 검수 상태와 재대여 승인 상태를 따로 기록합니다. 검수 완료 알림은 eventId(알림 식별자), equipmentId(장비 번호), type(inspection.completed)을 담습니다.',
  '실습 화면에서는 초기 목록과 현재 목록을 대조할 수 있습니다. deliveries는 알림을 입력한 순서이고 history는 실제로 반영된 사건입니다. 같은 알림을 두 번 보내 첫 입력에서만 대상의 검수를 완료하고 나머지 장비와 모든 재대여 승인 상태를 유지하는지 확인합니다.',
  '작업실에서는 학습자가 붙여 넣은 실측 기록을 사용하세요. 웹 서버, 외부 계정, 문서 조회, 테스트 실행 또는 파일 빌드의 성공 여부는 해당 작업을 직접 수행한 기록으로만 보고하세요. 내보낸 Agent는 동봉한 equipment-inspection.html과 지정된 프로젝트에서 재현할 수 있습니다.',
].join('\n');
const docNote = [
  '예제 문서 조회 기록 · Context7에서 /nodejs/node/v24.22.2의 HTTP 요청 본문 읽기를 조회했습니다.',
  'Node.js의 HTTP 서버는 요청 본문을 스트림으로 제공합니다. 공식 예제에서는 본문 조각을 받은 뒤 end 시점에 JSON을 해석하고 형식 오류를 처리합니다. 중복 처리 규칙은 장비 업무에서 별도로 정합니다.',
  'Node.js v24.22.2 Streams 문서 — https://github.com/nodejs/node/blob/v24.22.2/doc/api/stream.md',
].join('\n');

const assignments = {
  docs:{role:'문서 담당', skill:'find-docs', projectWork:'inspect',
    example:'Node.js 공식 문서로 수신 본문을 언제 JSON으로 읽을 수 있는지 확인합니다.',
    instruction:'연결된 문서 조회 기록에서 서버가 검수 알림 본문을 읽는 방법과 그 근거를 찾아 개발 담당에게 전하세요. 작업실에서는 제공된 조회 기록과 출처를 표시하세요. 내보낸 Agent에서는 대표에게 프로젝트의 실제 라이브러리·버전을 확인하고 find-docs 원문의 ctx7 library와 docs로 현재 문서를 조회하도록 요청하세요. 라이브러리 ID·조회한 버전·출처·적용할 동작을 적으세요. 조회 실패 시 제공된 자료로 확인한 부분을 구분하세요.'},
  design:{role:'디자인 담당', skill:'frontend-design', projectWork:'inspect',
    example:'담당자가 검수 완료 표시와 재대여 승인 여부를 구별하도록 두 상태를 배치합니다.',
    instruction:'창구 직원이 어떤 장비를 검수했고 다시 빌려줄 수 있는지 한눈에 구별하도록 목록의 열 이름, 표시 문구와 우선순위를 정하세요. 첫 알림과 재전송 때 사용자가 볼 차이를 적고, 색상을 구분하기 어려울 때와 키보드로 장비를 선택할 때 쓸 표시를 제시하세요. 실제 기록에서 한 장비를 골라 UI 담당이 구현할 예를 남기세요.'},
  developer:{role:'개발 담당', skill:'test-driven-development', projectWork:'tdd',
    example:'같은 알림을 두 번 넣는 테스트로 검수 상태와 이력이 한 번만 바뀌는지 확인합니다.',
    instruction:'문서·디자인 결과와 학습자의 검증 기록을 읽으세요. initialEquipment와 equipment 전체에서 대상 장비의 검수 상태 변경, 다른 장비의 모든 상태와 각 장비의 재대여 승인 유지를 대조하세요. deliveries에서 같은 eventId·equipmentId·type이 순서대로 applied, duplicate인지, history에 해당 사건 한 건만 있는지 확인하세요. verified 값만으로 판정하지 마세요. 한 번만 입력했거나 다른 사건이거나 기록·승인 상태가 맞지 않으면 발견한 차이를 적으세요. 작업실에서는 이 관찰과 프로젝트에서 실행할 테스트를 나누세요. 내보낸 Agent에서는 대표와 함께 공통 상태 처리의 테스트를 먼저 실행해 예상한 실패를 확인한 뒤 최소 구현과 같은 테스트의 재실행 결과를 UI·백엔드에 전달하세요.'},
  ui:{role:'UI 담당', skill:'web-artifacts-builder', projectWork:'edit-and-verify',
    example:'장비를 선택해 검수 상태, 재대여 승인, 반영 이력을 읽는 HTML 시제품을 만듭니다.',
    instruction:'디자인 담당의 표시 문구와 개발 담당의 상태 처리 결과에 맞춰 목록·장비 상세·처리 이력이 연결되는 UI를 설계하세요. 첫 알림과 같은 알림의 재전송에서 선택 장비, 목록, 건수를 무엇과 대조할지 적으세요. 작업실에서는 관찰한 값과 제작할 UI를 구분하세요. 내보낸 Agent에서는 대표가 Web Artifacts Builder 원본의 제작·번들 절차로 HTML 시제품을 만들고 Windows PC에서 선택·재전송을 확인하도록 필요한 변경을 전달하세요. API 수신 처리는 백엔드 담당의 계약을 따르세요.'},
  backend:{role:'백엔드 담당', skill:'webhook-handler-patterns', projectWork:'edit',
    example:'첫 알림에 검수 상태와 이력을 함께 반영하고 같은 알림의 재전송을 구별합니다.',
    instruction:'개발 담당의 상태 처리와 문서 담당의 수신 방법을 사용하세요. 첫 검수 알림을 받으면 대상의 검수 상태와 이력 한 건을 함께 저장하고, 같은 eventId 재전송에는 이미 처리한 결과를 돌려주는 수신 경로를 설계하세요. 장비 번호가 다른데 같은 eventId인 경우와 저장 중 실패할 경우를 다루세요. 중복 요청이 겹쳐도 한 번 반영되게 하세요. 작업실에서는 HTML에서 관찰한 현상과 서버 구현안을 구분하세요. 내보낸 Agent에서는 대표가 ZIP 루트에서 node --test inspection-webhook.test.mjs로 로컬 수신기에 같은 본문을 두 번 보내는 검사를 실행하고 응답과 저장 결과를 확인하도록 하세요.'},
  creator:{role:'도구 제작 담당', skill:'skill-creator', projectWork:'edit',
    example:'다른 장비에서도 같은 방법으로 상태와 이력을 점검할 수 있는 Skill을 작성합니다.',
    instruction:'검증 기록, 네 담당자의 설계·구현과 개발 담당의 테스트 결과를 사용해 재사용할 Codex Skill을 작성하세요. name이 inspect-equipment-sync이고 description에 사용 시점이 있는 YAML frontmatter로 시작하는 SKILL.md 본문만 반환하세요. 코드 울타리로 감싸지 마세요. 특정 장비 번호 대신 실습자가 고른 장비·알림을 입력받고, 초기 목록 저장 → 동일 알림 두 번 입력 → 대상과 다른 장비·승인·처리 이력 대조 절차를 안내하세요. 예시에서 확인한 사실과 아직 시험할 조건을 구분하세요. 내보낸 Agent에서는 대표가 inspect-equipment-sync/SKILL.md를 작성하고 원본의 검증 방법으로 확인하도록 하세요.'},
} as const;

function inspectionGraph() {
  const d = new Drawing('장비 검수 알림을 두 번 입력한 실습 기록으로 장비별 검수 상태와 재대여 승인, 처리 이력을 대조하고 여섯 담당자가 웹 앱 구현과 검증 방법을 작성합니다.');
  function role(id:keyof typeof assignments, column:number, row:number, skillRow:number) {
    const task = assignments[id];
    d.node(id,'agent.delegate',task.role,column,row,{role:task.role,projectWork:task.projectWork,instruction:task.instruction});
    attachLessonSkill(d,task.skill,{title:task.skill,example:task.example},column,skillRow,id);
    d.edge('case',id,'reference','ref','context');
  }
  function recordRole(id:keyof typeof assignments, column:number, row:number) {
    const record = d.node('record-'+id,'data.transform',assignments[id].role+' 기록',column,row,
      {operation:'rename',target:assignments[id].role});
    d.step(id,record);
    return record;
  }
  d.node('request','input.user_request','확인할 검수 알림 동작',0,2,{question});
  d.node('evidence','input.form','실습 검증 기록 받기',1,2,{
    prompt:'검수 알림 실습에서 같은 알림으로 ‘알림 입력’을 두 번 누른 뒤 ‘검증 기록 복사’를 누르세요. 초기 목록부터 처리 이력까지 포함한 JSON 전문을 붙여 넣으세요.',
    fields:[{name:'검증 기록',multiline:true}],
  });
  d.step('request','evidence');
  d.node('raw','data.transform','검증 기록 본문 읽기',2,2,{operation:'select',path:'검증 기록'});
  d.step('evidence','raw');
  d.node('validate','data.validate','검증 기록 형식 확인',3,2,{
    requiredFields:['initialEquipment','equipment','deliveries','history','verified'],
    types:{initialEquipment:'array',equipment:'array',deliveries:'array',history:'array',verified:'boolean'},
  });
  d.step('raw','validate');
  d.node('source','data.transform','요청과 실측 기록 모으기',4,2,{operation:'text'});
  d.order('validate','source');
  d.data('request','source');
  d.data('raw','source');
  d.node('case','resource.context','검수 알림 처리 기준',5,0,{content:caseDescription,version:'1'});
  d.node('research','control.parallel','문서와 화면 기준 병렬 조사',5,2,{maxConcurrency:2,failurePolicy:'stop'});
  d.step('source','research');
  d.node('requirements','control.join','문서와 디자인 결과 모으기',8,2,{merge:'sections',partialFailure:'fail'});
  d.data('request','requirements');
  d.data('evidence','requirements');
  for (const [id,row,skillRow] of [['docs',1,0],['design',3,4]] as const) {
    role(id,6,row,skillRow);
    d.step('research',id);
    d.step(recordRole(id,7,row),'requirements');
  }
  d.doc('doc-note','Node.js HTTP 요청 문서 조회 기록',docNote,7,0,'docs');
  role('developer',9,2,1);
  d.step('requirements','developer');
  d.node('implementation','control.parallel','UI와 수신 경로 병렬 작업',11,2,{maxConcurrency:2,failurePolicy:'stop'});
  d.node('brief','control.join','실측 기록·설계·테스트 전달',10,2,{merge:'sections',partialFailure:'fail'});
  d.data('requirements','brief');
  d.step(recordRole('developer',10,3),'brief');
  d.step('brief','implementation');
  d.node('integration','control.join','UI와 백엔드 결과 모으기',14,2,{merge:'sections',partialFailure:'fail'});
  d.data('brief','integration');
  for (const [id,row,skillRow] of [['ui',1,0],['backend',3,4]] as const) {
    role(id,12,row,skillRow);
    d.step('implementation',id);
    d.step(recordRole(id,13,row),'integration');
  }
  role('creator',15,2,1);
  d.step('integration','creator');
  d.node('skill-file','file.create','상태 동기화 점검 Skill 만들기',16,2,{format:'markdown',fileName:'SKILL.md'});
  d.order(recordRole('creator',16,3),'skill-file');
  d.data('creator','skill-file');
  d.node('report','control.join','실측 기록과 담당자 결과 정리',17,2,{merge:'sections',partialFailure:'fail'});
  d.order('skill-file','report');
  d.data('integration','report');
  d.data('record-creator','report');
  d.node('report-file','file.create','검수 알림 개발 보고서 저장',18,2,{format:'markdown',fileName:'검수-알림-개발-보고서.md'});
  d.step('report','report-file');
  d.node('answer','output.answer','검수 알림 개발 결과 전달',19,2,{format:'markdown'});
  d.step('report-file','answer');
  d.node('skill-answer','output.answer','점검 Skill 전달',19,3,{format:'markdown'});
  d.order('report-file','skill-answer');
  d.data('skill-file','skill-answer');
  return d.graph;
}

export const equipmentInspectionWebTemplate:Lesson = {
  id:'equipment-inspection-web',topic:'웹 개발',level:'고급',title:'검수가 끝나면 장비 반납 목록은 어떻게 바뀔까?',
  description:'같은 검수 알림을 두 번 입력해 반납 목록과 처리 이력을 대조하고, 여섯 담당자가 실제 기록을 사용해 웹 구현과 점검 Skill을 작성합니다.',
  goal:'알림을 받은 횟수와 반영한 횟수를 구분하고, 검수 상태와 재대여 승인 상태를 독립적으로 확인합니다.',
  task:'검수 알림 실습에서 장비 상태와 이력을 대조한 뒤, 검증 기록을 여섯 담당자에게 전달하세요.',
  question,
  steps:[
    '‘검수 알림 실습 열기 (새 창)’를 누르세요. A-17의 검수 상태와 재대여 승인, 다른 장비의 상태를 읽고 기본 알림으로 ‘알림 입력’을 한 번 누르세요. 같은 내용으로 한 번 더 누른 뒤 처리 이력의 건수를 확인하세요.',
    '‘검증 기록 보기’를 펼쳐 ‘검증 기록 복사’를 누르고 작업실로 돌아오세요. ‘내 사본으로 시작 → 시험 실행 → 질문 실행’을 누른 뒤 ‘검증 기록’에 복사한 JSON을 붙여 넣고 ‘같은 실행 이어가기’를 누르세요.',
    '검수-알림-개발-보고서.md에서 첫 처리와 중복 알림을 대조하고, SKILL.md에서 다른 장비에 적용할 절차를 확인하세요. 실제 소스에서 테스트하고 개발하려면 ‘Agent 내보내기’로 받은 ZIP을 개발 환경에서 열고 동봉된 equipment-inspection.html로 동작을 재현하세요.',
  ],
  skillSteps:['‘연결된 Skill’에서 여섯 담당자의 원본 이름과 사용 단계를 대조하세요. 작업실에서는 검증 기록을 읽고, 내보낸 Agent는 개발 환경에서 문서 조회·구현·테스트를 수행합니다.'],
  checks:['같은 알림을 두 번 입력해 최초 처리 한 번과 중복 수신 한 번을 구별합니다.','대상 장비의 검수 상태만 바뀌고 다른 장비와 재대여 승인 값은 유지되며 처리 이력은 한 건입니다.','여섯 담당의 결과와 다른 장비에도 쓸 수 있는 점검 Skill을 받습니다.'],
  sampleCase:{title:'A-17 검수 완료 알림 재전송',expected:'A-17의 검수만 완료로 바뀌고 재대여 승인은 미승인입니다. 같은 알림의 수신은 두 번이고 처리 이력은 한 건입니다.'},
  example:'A-17 노트북의 기본 검수 알림을 처음 입력하면 검수 상태가 완료됩니다. 같은 알림을 다시 입력하면 이력에 같은 사건이 추가되지 않습니다. B-08 태블릿의 상태도 함께 대조하세요.',
  examples:[],graph:inspectionGraph(),
};
