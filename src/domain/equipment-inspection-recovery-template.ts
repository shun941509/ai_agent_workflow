import {attachLessonSkill} from './lesson-skills';
import {Drawing} from './template-drawing';
import type {Lesson} from './types';

const question = '고급의 개발 보고서와 점검 Skill을 이어서 검수 알림의 역순 도착, 저장 직전 실패 후 재전송, 저장 후 응답 유실 후 재전송을 시도별로 검증해 주세요.';
const reportName = '시도별-검증-보고서.md';
const sectionHeading = '## 검수 알림의 역순 도착과 재전송 점검';
const fieldNames = ['고급 개발 보고서','고급 점검 Skill','시도별 검증 기록'];
const checkInstructions = [
  '각 시나리오는 동일한 초기 장비 목록에서 따로 시작합니다. 발신자가 장비별로 매긴 sequence와 창구에 도착한 순서를 구별하세요. 수신 시도와 실제 처리 이력은 서로 다른 기록입니다.',
  '역순 도착에서는 완료 2번을 반영하고 뒤늦은 시작 1번을 수신 기록에 남깁니다. 저장 직전 실패에서는 첫 시도 직후 상태·순번·처리 이력이 초기값이고 같은 ID 재전송에서 처음 반영합니다. 저장 후 응답 유실에서는 첫 시도 직후 상태·순번·처리 이력이 이미 반영됐고 같은 ID 재전송은 중복입니다.',
  '이 내용은 기대값입니다. 실제 기록에 담긴 두 시도의 전체 장비 상태, 장비별 마지막 순번, 모든 재대여 승인과 이력을 초기값과 대조하세요. verified 표시에만 의존하지 마세요. 관찰이 빠지거나 예상과 다르면 해당 시도에 미검증 또는 불일치와 구체적인 이유를 남기세요.',
].join('\n');

const tasks = {
  docs:{role:'문서 담당',skill:'find-docs',work:'inspect',
    example:'고급 보고서에서 확인한 사실과 새로 검증할 저장·응답 순서를 구분합니다.',
    instruction:'직접 입력한 고급 보고서와 Skill에서 중복 처리 기준과 그 근거를 인용하세요. 검수 완료라는 업무 사실, 저장 결과, 발신자가 받은 응답을 나누어 설명하세요. 작업실에서는 자료 안에서 확인한 범위를 밝히세요. 개발 환경에서는 find-docs로 프로젝트 버전에 맞는 재시도·저장 처리 문서를 찾아 근거를 보완하세요.'},
  design:{role:'디자인 담당',skill:'frontend-design',work:'inspect',
    example:'처리 결과가 같은 두 재전송 사례에서 첫 시도의 차이를 읽을 수 있게 배치합니다.',
    instruction:'기록을 읽는 사람이 첫 시도 직후와 재전송 직후를 구별하도록 상태, 장비별 순번, 재대여 승인과 이력 건수를 배치하세요. 응답 유실과 저장 실패에 각각 쓸 문구를 실제 기록에 맞춰 제시하세요.'},
  backend:{role:'백엔드 담당',skill:'webhook-handler-patterns',work:'edit',
    example:'장비별 순번과 이벤트 ID로 오래된 알림, 첫 반영, 중복 재전송을 구분합니다.',
    instruction:'알림 ID와 장비별 순번을 시도별로 추적하세요. 오류가 저장 전인지 응답 전달 중인지 실제 장비·이력으로 대조하고, 상태·순번·처리 이력의 원자적 저장과 중복 판별에 필요한 조건을 제시하세요. 학습자의 실측 자료와 개발 환경에서 추가할 HTTP 시험을 구분하세요.'},
  developer:{role:'개발 담당',skill:'test-driven-development',work:'tdd',
    example:'세 시나리오에서 각 시도 직후 여섯 스냅숏의 기대값과 실제값을 대조합니다.',
    instruction:'“# 시도별 검증 보고서”로 시작하세요. 고급 보고서의 기존 시험 근거를 한 줄 인용하고, 세 시나리오 각각 두 시도를 한 행씩 검증하세요. 시나리오·시도, 알림 ID/순번, 수신 결과, 대상 장비의 기대/실제 검수 상태·마지막 순번, 처리 이력 건수와 ID, 판정을 기록하세요. 초기 목록과 비교해 다른 장비와 모든 재대여 승인이 유지됐는지도 적으세요. 서로 다른 사건 또는 첫 시도가 누락된 자료는 통과 근거로 삼지 마세요. ZIP에서 실제 구현을 수정할 때에는 각 실패를 먼저 재현하고 동일 테스트의 통과를 확인하세요.'},
  ui:{role:'UI 담당',skill:'web-artifacts-builder',work:'edit-and-verify',
    example:'행별 수신 기록과 처리 이력을 대조해 두 실패가 화면에서 구별되는지 확인합니다.',
    instruction:'개발 담당의 시도별 판정과 원문 스냅숏을 읽고 첫 실패 이후와 재전송 이후에 화면에 표시할 차이를 검토하세요. 로컬 실습의 여섯 스냅숏을 근거로 실제 확인한 항목을 적으세요. ZIP에서 화면을 변경하면 Windows 브라우저에서 표시와 키보드 조작을 재확인하세요.'},
  creator:{role:'도구 제작 담당',skill:'skill-creator',work:'edit',
    example:'기존 점검 Skill을 유지하면서 순번과 실패 시점을 확인하는 절차를 덧붙입니다.',
    instruction:'입력한 고급 점검 Skill의 현장 기준·명칭·검증 절차를 존중하세요. 갱신할 한 절만 Markdown으로 반환하세요. 첫 줄은 <!-- inspection-recovery:begin -->, 다음 줄은 “'+sectionHeading+'”입니다. 세 시나리오를 다른 장비에서 재현할 입력, 여섯 시도 직후 확인할 값, 불일치 시 조사할 근거를 적고 마지막 줄에 <!-- inspection-recovery:end -->를 쓰세요. 코드 울타리나 YAML frontmatter 없이 제출하세요. 같은 절에 기존 고유 점검 항목이 있으면 새 본문에 함께 담으세요. 이어지는 단계가 원본 문서에서 해당 절만 교체하거나 추가합니다.'},
} as const;

function recoveryGraph() {
  const d = new Drawing('장비 검수 알림의 순서 역전과 실패 후 재전송을 실측 자료에 근거해 시도별로 검증하고 기존 점검 Skill을 갱신합니다.');
  function role(id:keyof typeof tasks, col:number, row:number, skillRow:number) {
    const task = tasks[id];
    d.node(id,'agent.delegate',task.role,col,row,{role:task.role,projectWork:task.work,instruction:task.instruction});
    attachLessonSkill(d,task.skill,{title:task.skill,example:task.example},col,skillRow,id);
    d.edge('rules',id,'reference','ref','context');
  }
  d.node('request','input.user_request','검수 알림 복구 검증 요청',0,2,{question});
  d.node('inputs','input.form','고급 문서와 시도별 검증 기록 받기',1,2,{
    prompt:'고급에서 받은 개발 보고서와 점검 SKILL.md의 본문을 넣으세요. 전문가 실습에서 세 시나리오를 각각 두 번 실행하고 복사한 시도별 검증 기록을 마지막 칸에 붙여 넣으세요.',
    fields:fieldNames.map(name=>({name,multiline:true})),
  });
  d.step('request','inputs');
  d.node('original','data.transform','기존 점검 Skill 본문',2,0,{operation:'select',path:fieldNames[1]});
  d.step('inputs','original');
  d.node('evidence','data.transform','시도별 스냅숏 원문',2,2,{operation:'select',path:fieldNames[2]});
  d.order('original','evidence');
  d.data('inputs','evidence');
  const types:Record<string,string> = {equipmentId:'string',initialEquipment:'array',scenarios:'array',verified:'boolean'};
  const required = Object.keys(types);
  for (let scenario=0;scenario<3;scenario++) {
    const path = 'scenarios.'+scenario;
    required.push(path+'.id');
    types[path+'.id']='string';
    types[path+'.attempts']='array';
    for (let attempt=0;attempt<2;attempt++) {
      const prefix = path+'.attempts.'+attempt+'.';
      const shape = {'event.eventId':'string','event.sequence':'number','event.equipmentId':'string','event.type':'string',
        fault:'string',result:'string',equipment:'array',history:'array'};
      for (const [field,type] of Object.entries(shape)) {
        types[prefix+field]=type;
        required.push(prefix+(field==='history'?'history.length':field));
      }
    }
  }
  d.node('validate','data.validate','세 시나리오의 두 시도 확인',3,2,{requiredFields:required,types});
  d.step('evidence','validate');
  d.node('rules','resource.context','검수 상태·처리 이력 판정 기준',4,0,{content:checkInstructions,version:'1'});
  d.node('research','control.parallel','문서·디자인·백엔드 병렬 점검',4,3,{maxConcurrency:3,failurePolicy:'stop'});
  d.order('validate','research');
  d.data('inputs','research');
  d.node('review','control.join','입력 원문과 세 분야 점검 결과',7,3,{merge:'sections',partialFailure:'fail'});
  d.data('inputs','review');
  for (const [id,row] of [['docs',1],['design',3],['backend',5]] as const) {
    role(id,5,row,row-1);
    d.step('research',id);
    const tagged = d.node('note-'+id,'data.transform',tasks[id].role+' 점검 근거',6,row,{operation:'rename',target:tasks[id].role});
    d.step(id,tagged);
    d.step(tagged,'review');
  }
  role('developer',8,3,2);
  d.step('review','developer');
  d.node('findings','control.join','시도별 판정과 입력 원문 전달',9,3,{merge:'text',partialFailure:'fail'});
  d.data('review','findings');
  d.step('developer','findings');
  role('ui',10,3,2);
  d.step('findings','ui');
  d.node('handoff','control.join','점검 Skill에 반영할 실측 결과',11,3,{merge:'text',partialFailure:'fail'});
  d.data('findings','handoff');
  d.step('ui','handoff');
  role('creator',12,3,2);
  d.step('handoff','creator');

  d.node('updated','data.transform','원본 Skill의 복구 점검 절 갱신',13,3,
    {operation:'markdown-section',sectionHeading,sectionMarker:'inspection-recovery'});
  d.order('creator','updated');
  d.data('original','updated');
  d.data('creator','updated','section');
  d.node('skill-file','file.create','갱신된 점검 Skill 저장',14,3,{format:'markdown',fileName:'SKILL.md'});
  d.step('updated','skill-file');
  d.node('skill-answer','output.answer','갱신된 점검 Skill 전달',15,3,{format:'markdown'});
  d.step('skill-file','skill-answer');
  d.node('summary','control.join','시도별 판정·화면 검토·원문 기록',14,1,{merge:'text',partialFailure:'fail'});
  d.order('creator','summary');
  d.data('developer','summary');
  d.data('ui','summary');
  d.data('evidence','summary');
  d.node('report-file','file.create','시도별 검증 보고서 저장',15,1,{format:'markdown',fileName:reportName});
  d.step('summary','report-file');
  d.node('report-answer','output.answer','시도별 검증 보고서 전달',16,1,{format:'markdown'});
  d.step('report-file','report-answer');
  return d.graph;
}

export const equipmentInspectionRecoveryTemplate:Lesson = {
  id:'equipment-inspection-recovery',topic:'웹 개발',level:'전문가',title:'검수 알림이 뒤늦게 오거나 다시 오면 무엇이 남아야 할까?',
  description:'순서가 뒤바뀐 알림과 저장 전후에 실패한 알림을 보내고, 매 시도의 상태와 처리 이력을 대조해 고급 점검 Skill을 갱신합니다.',
  goal:'수신 시도와 실제로 반영된 사건을 구별하고, 재전송 전에 이미 저장됐는지를 첫 시도의 장비 상태와 이력으로 설명합니다.',
  task:'고급 개발 보고서와 점검 Skill을 입력하고 각 시나리오의 두 시도를 재현하세요. 첫 시도와 마지막 시도의 상태를 각각 확인하세요.',question,
  steps:[
    '‘검수 알림 복구 실습 열기 (새 창)’를 누르세요. 고급에서 받은 개발 보고서와 점검 SKILL.md 본문을 각각 붙여 넣고 대상 장비를 고르세요.',
    '세 시나리오를 차례로 선택해 매번 ‘다음 알림 보내기’를 두 번 누르세요. 각 시도 직후 검수 상태와 순번, 재대여 승인과 이력을 대조하고 실습 화면에서 시도별 검증 보고서와 갱신된 SKILL.md를 내려받으세요.',
    '여섯 담당자의 검토를 받으려면 ‘검증 기록 복사’로 기록을 복사하세요. ‘내 사본으로 시작 → 시험 실행 → 질문 실행’을 누르고 고급 두 문서와 ‘시도별 검증 기록’을 입력한 뒤 ‘같은 실행 이어가기’를 누르세요.',
  ],
  skillSteps:['연결된 원본 Skill 여섯 개와 담당자를 확인하세요. 도구 제작 담당은 고급 Skill에 이번 실습에서 검증한 복구 점검 절차를 추가합니다.'],
  checks:['역순 도착에서 예전 순번이 새 상태를 덮지 않습니다.','첫 시도 직후 저장 전 실패는 이력 0건, 응답 유실은 1건입니다. 재전송 후에는 각각 한 건입니다.','각 시도에서 다른 장비와 모든 재대여 승인이 초기값을 유지합니다. 원래 Skill의 고유 기준이 결과 파일에 남습니다.'],
  sampleCase:{title:'저장 직전 실패와 응답 유실 대조',expected:'첫 시도의 상태·순번과 처리 이력으로 실패 시점을 구분하고, 두 재전송이 각각 최초 반영 또는 중복 수신인지 확인합니다.'},
  example:'저장 전 실패 뒤에는 두 번째 시도에서 처음 검수가 완료됩니다. 응답 유실 뒤에는 첫 시도에서 이미 검수가 완료되고 두 번째 시도는 처리 이력을 늘리지 않습니다.',
  examples:[],graph:recoveryGraph(),
};
