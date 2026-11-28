import {attachLessonSkill} from './lesson-skills';
import {Drawing} from './template-drawing';
import type {Lesson} from './types';

const listField='장비 반납 목록';
const receiptField='검수 알림 1회 기록';
const listFile='장비-반납-목록.json';
const receiptFile='검수-알림-1회-기록.json';
const reportFile='검수-알림-전후-검증.md';

const stages = [
  {id:'equipment-return-inventory',level:'입문',title:'장비 반납 목록에는 무엇을 적을까?',
    description:'반납 창구에서 장비 번호·이름·검수 상태·재대여 승인을 입력해 처음 쓸 목록을 만듭니다.',
    goal:'검수를 기다리는 장비와 재대여가 승인된 장비를 목록에서 구별합니다.',
    question:'만든 반납 목록에서 어떤 장비가 검수 대기이고 재대여 승인은 각각 어떤 상태인지 확인해 주세요.',
    task:'반납 목록을 만들고 장비마다 검수 상태와 재대여 승인을 읽어 보세요. 수신 전 처리 이력은 0건입니다.',
    practice:'장비 번호, 이름, 검수 상태와 재대여 승인을 확인하거나 수정한 뒤 ‘반납 목록 만들기’를 누르세요.',
    next:'목록 파일을 내려받으세요. 초급 실습의 ‘입문 반납 목록’에 이 파일의 본문을 넣어 같은 장비로 이어 가세요.',
    agent:'design',role:'목록 디자인 담당',skill:'frontend-design',field:listField,file:listFile,
    skillExample:'검수 상태와 재대여 승인을 서로 다른 열로 읽을 수 있는지 실제 장비 행에서 살핍니다.',
    review:'입력한 장비 번호와 이름을 들어 검수 대기 장비를 알려 주세요. 서로 다른 열인 검수 상태와 재대여 승인을 한 행에서 따로 읽어 설명하고 수신 기록과 처리 이력이 모두 0건인지 확인하세요. 목록을 처음 읽는 창구 담당자가 어느 열을 보면 될지 간단히 안내하세요.',
    checks:['각 행에 장비 번호·이름·검수 상태·재대여 승인이 있습니다.','최초 목록과 현재 목록이 같고, 수신 기록과 처리 이력은 비어 있습니다.'],
    example:'예시 B-08 태블릿은 검수 대기이고 재대여는 보류입니다. 최초 목록의 두 값과 빈 이력을 함께 확인합니다.'},
  {id:'equipment-inspection-first',level:'초급',title:'검수 알림 한 건을 보내면 무엇이 바뀔까?',
    description:'입문에서 만든 목록에 검수 완료 알림을 한 번 보내고 어느 행에 처리 이력이 남는지 봅니다.',
    goal:'검수 알림의 장비 번호와 알림 ID를 사용해 대상 장비와 처리 이력 한 건을 찾습니다.',
    question:'한 번 보낸 검수 완료 알림이 어느 장비에 반영됐고 처리 이력에 무엇이 남았는지 알려 주세요.',
    task:'입문 목록에서 검수 대기 장비를 한 대 선택해 알림 한 건을 보내세요. 수신 전후의 상태와 처리 이력을 확인하세요.',
    practice:'‘입문 반납 목록’에 입문 파일의 본문을 넣고 ‘목록 불러오기’를 누르세요. ‘대상 장비’와 ‘알림 ID’를 정해 ‘검수 알림 한 번 입력’을 누르세요.',
    next:'1회 기록 파일을 내려받아 중급 실습의 ‘초급 수신 기록’에 입력하세요.',
    agent:'receiver',role:'알림 처리 담당',skill:'webhook-handler-patterns',field:receiptField,file:receiptFile,
    skillExample:'검수 완료를 받은 기록과 실제 처리 이력에 같은 알림 ID와 장비 번호가 남았는지 확인합니다.',
    review:'실제로 수신한 inspection.completed 한 건의 알림 ID·장비 번호·결과를 읽으세요. 입력 전과 후의 대상 상태를 대조하고, 수신 기록의 알림 ID가 처리 이력 한 건의 ID와 같은지 확인하세요. 다른 장비 한 대가 있으면 해당 장비의 상태도 함께 보여 주세요. 고급에서 같은 ID를 한 번 더 보낼 때 확인할 항목 하나를 제시하세요.',
    checks:['선택한 장비만 검수 대기에서 검수 완료로 바뀌고 재대여 승인은 유지됩니다.','수신 기록과 처리 이력에 같은 장비 번호·알림 ID가 각각 한 번 남습니다.'],
    example:'B-08에 지정한 알림 ID로 한 번 보내면 검수는 완료, 재대여는 보류이고 그 ID의 처리 이력이 한 건 생깁니다.'},
  {id:'equipment-inspection-compare',level:'중급',title:'검수 전후에 어떤 값이 달라졌을까?',
    description:'초급에서 받은 기록을 다시 읽어 장비별 전후 값과 처리 이력의 변화를 검증표로 정리합니다.',
    goal:'기대했던 변화와 실제 장비 행·이력의 값을 대조하고, 고급의 두 번째 수신에서 다시 확인할 기준을 세웁니다.',
    question:'검수 알림 한 건의 전후 기록으로 대상 장비·다른 장비·재대여 승인·처리 이력을 검증해 주세요.',
    task:'초급에서 받은 1회 기록을 입력해 어느 값이 달라졌는지 검증하고 결과 표를 내려받으세요.',
    practice:'‘초급 수신 기록’에 초급 파일의 본문을 넣고 ‘전후 검증하기’를 누르세요. 대상 장비, 다른 장비, 재대여 승인과 처리 이력의 실제 값을 비교하세요.',
    next:'검증 보고서를 내려받으세요. ‘고급 실습용 검수 알림’을 고급 실습에 넣어 두 번 보내세요. 연습한 장비가 고급 기본 목록의 대기 장비이면 같은 알림으로, 그 밖의 장비이면 새 알림 ID와 A-17로 시험합니다.',
    agent:'verifier',role:'검증 담당',skill:'test-driven-development',field:receiptField,file:reportFile,
    skillExample:'알림 한 건의 처리 전후를 공개된 장비 목록과 이력으로 비교하고 중복 수신 시험의 기대값을 정합니다.',
    review:'“## 검증 담당 의견”으로 시작하세요. 수신 기록의 알림 ID·장비 번호를 인용하고 한 번 수신했을 때의 기대값과 관찰값을 대조하세요. 대상 장비의 검수 상태, 다른 장비와 모든 재대여 승인, 처리 이력 0건에서 1건으로의 변화를 각각 판정하세요. 고급 실습에서 같은 알림을 한 번 더 받았을 때 검증할 기대값과 이번에 실제로 관찰한 값을 구별하세요.',
    checks:['모든 장비를 번호로 대조하여 대상 검수 상태와 이력 건수의 변화를 설명합니다.','다른 장비와 모든 재대여 승인이 유지되고 이력의 알림 ID가 수신 기록과 일치합니다.'],
    example:'검수 대기·보류였던 B-08이 검수 완료·보류가 되고, 이력 1건에 같은 알림 ID가 남았는지 확인합니다.'},
] as const;

function makeLesson(stage:typeof stages[number]):Lesson {
  const d=new Drawing(stage.goal);
  const inventory=stage.level==='입문';
  const report=stage.level==='중급';
  d.node('request','input.user_request','실습 검토 요청',0,1,{question:stage.question});
  d.node('form','input.form',stage.field+' 받기',1,1,{prompt:'독립 실습에서 받은 '+(inventory?listFile:receiptFile)+'의 JSON 본문을 붙여 넣으세요.',
    fields:[{name:stage.field,multiline:true}]});
  d.step('request','form');
  d.node('raw','data.transform','입력한 JSON 본문',2,1,{operation:'select',path:stage.field});
  d.step('form','raw');
  d.node('validate','data.validate',inventory?'수신 전 목록 확인':'검수 알림 한 건 대조',3,1,{
    requiredFields:['initialEquipment','equipment','deliveries.length','history.length'],
    types:{initialEquipment:'array',equipment:'array',deliveries:'array',history:'array'},
    inspectionRule:inventory?'return-list':'first-receipt'});
  d.step('raw','validate');
  d.node(stage.agent,'ai.single_task',stage.role,4,1,{goal:stage.goal,instruction:stage.review});
  attachLessonSkill(d,stage.skill,{title:stage.skill,example:stage.skillExample},4,0,stage.agent);
  d.order('validate',stage.agent);
  d.data('raw',stage.agent);
  d.node('file','file.create',stage.file+' 만들기',6,1,{fileName:stage.file,format:report?'markdown':'text'});
  if(report) {
    d.node('report','data.transform','검증표와 담당 의견 정리',5,1,{operation:'text'});
    d.order(stage.agent,'report');
    d.edge('validate','report','data','inspectionReport','input');
    d.data(stage.agent,'report');
    d.step('report','file');
  } else {
    d.node('review','output.answer',stage.role+' 의견 전달',5,0,{format:'markdown'});
    d.step(stage.agent,'review');
    d.order(stage.agent,'file');
    d.data('raw','file');
  }
  d.node('answer','output.answer','결과 파일 전달',7,1);
  d.step('file','answer');
  return {id:stage.id,title:stage.title,level:stage.level,topic:'웹 개발',description:stage.description,
    task:stage.task,goal:stage.goal,question:stage.question,graph:d.graph,
    steps:['‘장비 반납 기초 실습 열기 (새 창)’를 누르세요. '+stage.practice,stage.next,
      '담당 의견을 받으려면 ‘내 사본으로 시작 → 시험 실행 → 질문 실행’을 누르세요. ‘'+stage.field+'’에 '+(inventory?listFile:receiptFile)+'의 본문을 넣고 ‘같은 실행 이어가기’를 누르세요.'],
    skillSteps:['‘'+stage.role+'’에 연결된 '+stage.skill+' 원본 Skill을 열어 담당자의 점검 방법을 확인하세요.'],
    checks:[...stage.checks],sampleCase:{title:'B-08 태블릿의 검수와 재대여',expected:stage.example},example:stage.example,examples:[]};
}

export const equipmentInspectionStarterTemplates=stages.map(makeLesson);
