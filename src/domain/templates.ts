import { Drawing } from './template-drawing';
import { equipmentInspectionWebTemplate } from './equipment-inspection-web-template';
import { equipmentInspectionStarterTemplates } from './equipment-inspection-starter-templates';
import { equipmentInspectionRecoveryTemplate } from './equipment-inspection-recovery-template';
import { equipmentRelendingAgreementTemplate } from './equipment-relending-agreement-template';
import { equipmentReturnStarterTemplates } from './equipment-return-starter-templates';
import { equipmentReturnCasesTemplate } from './equipment-return-cases-template';
import { equipmentReturnTemplate } from './equipment-return-template';
import { swStarterTemplates } from './sw-starter-templates';
import { swTeamTemplates } from './sw-team-templates';
import { webDesignQuestionsTemplate } from './web-design-questions-template';
import { webDesignReviewFollowupTemplate } from './web-design-review-followup-template';
import { webDesignSingleScreenTemplate } from './web-design-single-screen-template';
import { webDesignTddReviewTemplate } from './web-design-tdd-review-template';
import { webDesignStarterTemplates } from './web-design-starter-templates';
import { webDesignTeamTemplates } from './web-design-team-templates';
import { lessonWithSkills } from './lesson-skills';
import { swImpactTemplate } from './sw-impact-template';
import type { Graph, Lesson } from './types';
import { dynamicLessonExample } from './dynamic-lesson-policy';

// The second introductory exercise starts with an empty graph instead of a template.
export const blankPracticeLessonId = 'guide-blank';
export const membershipQuestion = '회원증을 만들려면 무엇을 준비해야 하나요?';
export const membershipRule = '회원증을 처음 만들 때는 신분증을 가져오세요.';

const rules = {
  hours:'평일에는 오전 9시부터 오후 6시까지, 토요일에는 오전 10시부터 오후 4시까지 엽니다. 일요일은 휴관합니다.',
  membership:membershipRule,
  loans:'한 사람의 대출 한도는 3권입니다.',
  help:'자료에서 확인할 수 없는 사항은 1층 안내데스크에 문의해 주세요.',
};
const handbook=Object.values(rules).join('\n');
const sourceInstruction='질문에 필요한 사실만 자료에서 확인하세요. 자료에 없는 사실은 확인이 필요하다고 말하세요.';

function single(kind:'intro'|'beginner'|'release'):Graph {
  const d=new Drawing('도서관 규정에 따라 회원증 발급, 대출 한도, 운영시간, 분실물 등 이용 문의에 답합니다.');
  const intro=kind==='intro';
  d.node('input','input.user_request','질문 입력',0,0,{question:intro?membershipQuestion:'책을 몇 권까지 빌릴 수 있나요?'});
  d.node('agent','ai.single_task','도서관 안내 Agent',1,0,{
    goal:'도서관 규정에서 확인한 사실을 이용자에게 안내합니다.',
    instruction:intro?'질문에 한 문장으로 답하세요. 자료에 없는 사항은 확인이 필요하다고 표시하세요.':
      sourceInstruction+' 답변에 사용한 원문 한 문장을 함께 인용하세요.',
    criterion:'질문에 대한 안내가 한눈에 보입니다.',
  });
  const beginner=kind==='beginner';
  const answerSource=beginner?d.node('file','file.create','대출 안내 파일 만들기',2,0,{fileName:'대출안내.txt',format:'text'}):'agent';
  d.node('output','output.answer','답변 전달',beginner?3:2,0);
  d.step('input','agent');
  if (beginner) d.step('agent','file');
  d.step(answerSource,'output');
  d.doc('rules','도서관 이용규정',intro?handbook:rules.loans+'\n'+rules.hours+'\n'+rules.help,1,1,'agent');
  if (beginner) {
    d.node('skill','instruction.skill','근거 인용 Skill',1,2,{
      version:'1',content:'# 근거 인용\n답변을 먼저 쓰고 다음 줄에 사용한 원문을 한 문장 인용합니다. 해당 사실이 없으면 확인 필요라고 안내합니다.',
    });
    d.edge('skill','agent','reference','ref','skill','근거 인용 지침');
  }
  return d.graph;
}

export const releaseTestCases = [
  {title:'대출 한도 변경',input:'책을 몇 권까지 빌릴 수 있나요?',expected:'기준판은 3권, 변경을 적용할 판은 5권이라고 안내한다.'},
  {title:'일요일 운영 규정',input:'일요일에도 여나요?',expected:'승인된 변경은 대출 한도뿐이다. 일요일은 계속 휴관이다.'},
  {title:'근거 없는 보관 기간',input:'분실물 보관 기간은 며칠인가요?',expected:'규정에 보관 기간이 없으므로 일수를 추측하지 않고 확인을 안내한다.'},
] as const;

export function releaseBaseline():Graph {
  return single('release');
}

function releaseCandidate():Graph {
  const graph=releaseBaseline();
  const rule=graph.nodes.find(node=>node.id==='rules')!;
  rule.config.content=[
    '한 사람의 대출 한도는 5권입니다.',
    rules.hours.replace('일요일은 휴관합니다.','일요일에는 오전 10시부터 오후 4시까지 엽니다.'),
    rules.help,
  ].join('\n');
  return graph;
}

function intermediate():Graph {
  const d=new Drawing('도서관 대출과 분실물 등 이용 규정을 찾아 안내하고 본인의 도서 예약 목록을 조회합니다.');
  d.node('input','input.user_request','도서관 질문',0,1);
  d.node('intent','ai.classify','규정과 개인 예약 구분',1,1,{categories:['규정','예약'],instruction:'본인 예약 목록을 조회하는 요청은 예약입니다. 일반 도서관 문의는 규정입니다.'});
  d.step('input','intent');
  d.node('lookup','tool.invoke','내 예약 조회',2,3,{tool:'reservations.list',args:{}});
  d.node('reservations','output.answer','예약 조회 결과',3,3);
  d.order('intent','lookup','category:예약','내 예약'); d.data('input','lookup');d.step('lookup','reservations');
  d.node('search','knowledge.search','규정과 지점 안내문 검색',2,0,{topK:4});
  d.order('intent','search','category:규정');d.order('intent','search','other');d.data('input','search');
  d.doc('hours','운영 안내',rules.hours,0,3,'search');d.doc('loans','대출 규정',rules.loans,1,3,'search');
  d.doc('membership','회원증 안내',rules.membership,0,4,'search');
  d.node('evidence','quality.evidence','질문의 근거 확인',3,0,{criterion:'후보에 질문에 직접 답하는 문장이 있어야 합니다. 관련 문서가 있다는 사실만으로 통과하지 않습니다.'});
  d.step('search','evidence');d.data('input','evidence','question');
  d.node('answer','ai.single_task','근거로 안내',4,0,{goal:'사용자 질문에 원문으로 답합니다.',instruction:'가장 관련 있는 원문의 제목과 근거 문장을 인용하세요.'});
  d.order('evidence','answer','verified');d.data('evidence','answer');d.data('input','answer','question');
  d.node('result','output.answer','확인한 답변',5,0);d.step('answer','result');
  d.node('ask','input.form','추가 안내문 받기',4,2,{prompt:'확인하고 싶은 지점이나 가지고 계신 안내문을 알려주시겠어요?'});
  d.order('evidence','ask','insufficient');d.order('evidence','ask','conflicting');
  d.node('followup','ai.single_task','회신과 원래 질문 확인',5,2,{goal:'회신이 실제로 증명하는 범위 안에서 원래 질문에 답합니다.',instruction:'지점 이름만 주어지거나 기간이 없으면 보관 기간을 확인할 수 없다고 안내하세요. 회신에 근거가 있다면 그 문장을 인용하세요.'});
  d.step('ask','followup');d.data('input','followup','question');
  d.node('after','output.answer','회신 후 답변',6,2);d.step('followup','after');
  return d.graph;
}

const libraryVisitQuestion='토요일에 중앙도서관에 가려는데, 몇 시에 열고 예약한 책을 받으려면 무엇을 가져가야 하나요? 내 예약도 확인해 주세요.';

function libraryVisit():Graph {
  const d=new Drawing('도서관 방문일의 운영시간, 예약 도서 수령 준비물과 본인의 도서 예약 내역을 안내합니다.');
  d.node('input','input.user_request','방문 질문',0,0,{question:libraryVisitQuestion});
  d.node('search-hours','knowledge.search','토요일 운영시간 검색',1,0,{topK:1});
  d.node('lookup','tool.invoke','내 예약 조회',2,0,{tool:'mcp.library.reservations.list',args:{}});
  d.node('brief','data.transform','검색·예약 결과 모으기',3,0,{operation:'text'});
  d.node('answer','ai.single_task','방문 안내 Agent',4,0,{
    goal:'질문한 방문일의 운영시간, 수령 준비물, 본인의 예약 내역을 안내합니다.',
    instruction:'검색 결과의 원문 구절(quote), 참고 자료로 연결한 수령 규정, 도구가 반환한 예약 목록(reservations)을 사용하세요. 답변 형식은 연결한 Skill을 따르세요.',
    criterion:'운영 안내와 수령 규정은 각각 해당 판의 문장을 그대로 쓰고, 예약 도서와 지점은 조회 결과와 일치해야 합니다.',
  });
  d.node('output','output.answer','방문 안내 전달',5,0);
  d.step('input','search-hours');d.step('search-hours','lookup');d.step('lookup','brief');
  d.data('search-hours','brief');d.step('brief','answer');d.data('input','answer','question');d.step('answer','output');
  // The new-project transaction replaces these four template pins with private, versioned library assets.
  d.node('hours','resource.context','중앙도서관 운영 안내',1,1,{assetId:'hours',version:'1'});
  d.node('library','connection.mcp','도서관 예약 조회 MCP',2,1,{assetId:'library',version:'1'});
  d.node('pickup','resource.context','수령 규정',4,1,{assetId:'pickup',version:'1'});
  d.node('format','instruction.skill','방문 안내 작성 Skill',4,2,{assetId:'format',version:'1'});
  d.edge('hours','search-hours','reference','ref','context');
  d.edge('library','lookup','reference','ref','mcp');
  d.edge('pickup','answer','reference','ref','context');d.edge('format','answer','reference','ref','skill');
  return d.graph;
}

function teamRoot(inner:Graph, title:string, goal:string, purpose:string) {
  const d=new Drawing(purpose);d.node('input','input.user_request','질문 입력',0,0);
  d.node('team','agent.team',title,1,0,{goal,responsible:'도서관 안내 담당'},inner);
  d.node('output','output.answer','팀의 최종 답변',2,0);d.step('input','team');d.step('team','output');return d.graph;
}
function parallel():Graph {
  const d=new Drawing();d.node('input','input.user_request','방문 질문',0,1);
  d.node('split','control.parallel','두 담당자에게 분담',1,1);d.step('input','split');
  for (const [index,id,role,content] of [[0,'hours','운영시간 담당',rules.hours],[2,'membership','회원증 담당',rules.membership]] as const) {
    const search='search-'+id;
    d.node(search,'knowledge.search',role+' 자료 검색',2,index,{topK:3});
    d.step('split',search);
    d.node(id,'agent.delegate',role,3,index,{
      role,instruction:'자신에게 전달된 검색 결과에서 '+role+' 범위만 확인하세요. 원문이 없거나 관련 내용이 없으면 해당 항목은 확인이 필요하다고 답하세요. 답과 인용을 대표 Agent에게 반환하세요.',
    });
    d.step(search,id);d.data('input',id,'question');d.doc(id+'-document',role+' 안내문',content,1,index,search);
  }
  d.node('join','control.join','두 조사 결과 모으기',4,1,{merge:'array',partialFailure:'report'});
  d.step('hours','join');d.step('membership','join');
  d.node('summary','ai.single_task','대표 Agent',5,1,{goal:'운영시간과 회원증 준비물을 한 번에 안내합니다.',instruction:'두 담당자의 결과 안에서만 요약하고 원문 인용을 보존하세요. 실패하거나 자료가 없으면 그 항목만 확인이 필요하다고 말하세요.'});
  d.step('join','summary');d.node('answer','output.answer','방문 안내',6,1);d.step('summary','answer');
  return teamRoot(d.graph,'도서관 방문 안내 팀','두 담당자에게 병렬로 위임하고 확인된 정보와 미확인 항목을 함께 전달합니다.', '도서관 방문을 준비하는 이용자에게 운영시간과 회원증 발급 준비물을 안내합니다.');
}
function peerReview():Graph {
  const d=new Drawing();d.node('input','input.user_request','검토할 안내 초안',0,2);
  d.node('split','control.parallel','두 담당자에게 초안 작성 요청',1,2.5);d.step('input','split');
  const members=[
    {id:'facts',role:'사실 검토 담당',instruction:'받은 안내문의 운영시간과 준비물을 항목별로 정리하세요.'},
    {id:'clarity',role:'안내문 편집 담당',instruction:'받은 안내문을 방문자가 읽기 쉬운 문장으로 다듬으세요.'},
  ];
  for (const [i,m] of members.entries()) {
    d.node(m.id,'agent.delegate',m.role+' 초안',2,i*3,{role:m.role,
      instruction:m.instruction+' 시간과 준비물은 받은 내용 그대로 유지하세요. 사실 확인은 다음 동료 검토에서 진행합니다.'});
    d.step('split',m.id);
  }
  d.node('drafts','control.join','초안 두 건 준비',3,2.5);members.forEach(m=>d.step(m.id,'drafts'));
  d.node('cross','control.parallel','서로의 초안 교환',4,2.5);d.step('drafts','cross');
  for (const [i,m] of members.entries()) {
    const other=members[1-i],id='review-'+m.id,row=(1-i)*3;
    d.node(id,'agent.delegate',m.role+'의 동료 검토',5,row,{role:m.role,
      instruction:other.role+'의 초안을 한 차례 원문과 대조하세요. 틀린 문장 → 수정 문장 순서로 적고, 근거 자료 제목과 원문에서 그대로 옮긴 구절을 함께 쓰세요. 수정할 점이 없으면 확인한 문장과 근거를 남기고, 자료에 없는 내용은 미확인으로 표시하세요.'});
    d.order('cross',id);d.edge(other.id,id,'data','value','input',other.role+' 초안');d.data('input',id,'question');
    d.node('record-'+m.id,'data.transform',m.role+'의 검토 기록',6,row,{
      operation:'rename',target:m.role+' → '+other.role+' 초안'});
    d.step(id,'record-'+m.id);
  }
  d.doc('source','도서관 원문',rules.hours+'\n'+rules.membership,4,1,'review-facts');
  d.edge('source','review-clarity','reference','ref','context');
  d.node('reviews','control.join','상호 검토 결과 모으기',7,3);members.forEach(m=>d.step('record-'+m.id,'reviews'));
  d.node('revise','ai.single_task','방문 안내문 수정',8,1.5,{goal:'두 검토 의견을 원문과 대조해 원래 안내문을 수정합니다.',
    instruction:'방문자가 읽을 최종 안내문만 작성하세요. 원문에서 확인되는 내용으로 잘못된 문장을 고치고, 자료로 확인할 수 없는 사항은 확인이 필요하다고 안내하세요.'});
  d.step('reviews','revise');d.data('input','revise','question');
  d.edge('source','revise','reference','ref','context');
  d.node('report','control.join','안내문에 검토 기록 첨부',9,1.5,{merge:'sections'});
  d.step('revise','report');d.data('reviews','report');
  d.node('output','output.answer','검토한 안내문',10,1.5);d.step('report','output');
  return teamRoot(d.graph,'도서관 안내문 검토 팀','두 역할이 서로의 초안을 한 차례 원문 대조한 뒤 수정합니다.', '도서관 방문 안내문의 운영시간과 회원증 준비물을 원문과 대조하고 안내문을 수정합니다.');
}
function dynamic():Graph {
  const investigation=new Drawing();
  investigation.node('site','input.user_request','배정된 지점',0,0);
  investigation.node('search','knowledge.search','해당 지점의 안내문 찾기',1,0,{matchMode:'literal',topK:4});
  investigation.step('site','search');
  investigation.node('evidence','quality.evidence','지점 운영 정보 확인',2,0,{
    criterion:'질문에는 담당 지점 이름이 들어 있습니다. 그 지점의 운영 시간이나 휴관일을 명시한 원문을 인용하세요. 다른 지점의 정보로 대체하지 마세요.',
  });
  investigation.step('search','evidence');investigation.data('site','evidence','question');
  investigation.node('report','output.answer','조사 근거와 상태 반환',3,0);
  for(const route of ['verified','insufficient','conflicting'])investigation.order('evidence','report',route);
  investigation.data('evidence','report');
  const d=new Drawing('입력된 도서관 지점 목록을 조사해 지점별로 확인된 안내와 근거를 정리합니다.');
  d.node('input','input.user_request','조사할 지점 목록',0,0,{question:'중앙도서관, 호수도서관, 숲도서관, 강변도서관'});
  d.node('spawn','agent.create_dynamic','지점별 조사 담당 생성',1,0,{role:'도서관 지점 조사 담당',
    instruction:'배정된 지점의 운영 정보를 자료에서 확인하고 원문과 확인 상태를 반환합니다.',
    maxCreatedAgents:4,maxInFlightAgents:2,maxDepth:1,separator:',',failurePolicy:'collect',resultRequirement:'evidence'},investigation.graph);
  d.step('input','spawn');
  d.doc('branches','지점별 안내','중앙도서관은 평일 오전 9시에 엽니다.\n호수도서관은 평일 오전 10시에 엽니다.\n숲도서관은 월요일에 휴관합니다.',1,1,'spawn');
  d.node('summary','ai.single_task','지점별 결과 정리',2,0,{goal:'선택한 지점별 담당자와 확인된 안내를 표로 정리합니다.',
    instruction:'확인된 지점마다 원문에서 운영 정보를 인용하세요. results의 지점은 담당자가 조사했습니다. 근거 부족·상충과 담당 작업 오류를 구분하세요. selection.reason이 creation_limit이면 생성 한도 때문에 요청 지점 중 이용자가 이번 조사 대상을 골랐습니다. 선택한 수와 요청한 수를 밝히고 excluded의 각 지점을 선택 제외로 표시하세요. 확인되지 않은 운영 정보는 추측하지 마세요.'});
  d.step('spawn','summary');d.node('output','output.answer','지점 조사 결과',3,0);d.step('summary','output');return d.graph;
}

export const libraryTemplates: Lesson[] = [
  {id:'intro',title:'질문에서 답변까지',level:'입문',topic:'도서관',description:'질문 하나가 세 블록을 지나 답변이 되는 과정을 봅니다.',
    task:'같은 회원증 질문에서 근거 문장을 붙이도록 지시를 바꿔 보세요.',question:membershipQuestion,
    goal:'질문과 답변 지시를 구별하고 결과의 변화를 확인합니다.',
    steps:[`‘시험 실행’에서 “${membershipQuestion}”를 보내고 첫 답변의 상태가 ‘완료’인지와 준비물로 신분증을 안내하는지 확인하세요.`,
      '실행 화면을 닫고 ‘도서관 안내 Agent’ 블록을 선택하세요. ‘작업 지시’의 기존 내용을 모두 지우고 “답을 쓰고 다음 줄에 안내문의 근거 문장을 그대로 인용하세요.”로 바꾸세요.',
      '‘시험 실행’을 다시 열어 새 대화에 같은 질문을 보내세요. 두 답변에서 준비물을 확인하고, 두 번째 답변의 다음 줄을 ‘도서관 이용규정’ 원문과 대조하세요.'],
    checks:['두 답변 모두 준비물로 신분증을 안내합니다.','수정 후 답변의 다음 줄에 “회원증을 처음 만들 때는 신분증을 가져오세요.”가 인용됩니다.'],
    example:'회원증을 만들려면 신분증이 필요합니다.\n“회원증을 처음 만들 때는 신분증을 가져오세요.”',examples:['토요일에도 여나요?'],graph:single('intro')},
  {id:'beginner',title:'내 자료로 안내하기',level:'초급',topic:'도서관',description:'내 규정으로 대출 질문에 답하고, 인용을 담은 안내 파일을 만듭니다.',
    task:'내 사본의 대출 한도를 3권에서 5권으로 바꾸고 대출안내.txt를 내려받으세요.',question:'책을 몇 권까지 빌릴 수 있나요?',
    goal:'내가 고친 규정이 화면의 답변과 안내 파일에 어떻게 반영되는지 확인합니다.',
    optionalPractice:'5권으로 고친 ‘도서관 이용규정’의 속성에서 ‘내 참고 자료로 저장’을 누르세요. 3권으로 시작하는 새 초급 사본의 같은 블록에서 ‘속성 → 이름·자료판 설정 → 연결할 자료’를 여세요. 내 자료 중 방금 저장한 규정을 고르고, 미리보기에서 5권 원문과 저장한 판을 확인한 뒤 ‘이 판 연결’을 누르세요. 새 대화의 답변과 대출안내.txt에서 5권 인용을 확인하세요.',
    steps:['예시 질문을 실행해 답변과 인용에서 대출 한도 3권을 확인하세요.',
      '내 사본의 ‘도서관 이용규정’에서 ‘자료 원문’의 3권을 5권으로 고쳐 ‘변경 적용’을 누르세요. ‘시험 실행’에서 ‘현재 원문 · 새 대화’로 같은 질문을 보내세요. ‘이전 원문 · 같은 대화’를 고르면 처음의 3권 규정을 다시 시험할 수 있습니다.',
      '‘대출안내.txt 내려받기’를 눌러 파일을 열고 화면의 답변과 인용을 대조하세요. 이 실습에서 새 사본을 하나 더 만들어 원래 규정도 확인하세요.'],
    checks:['내 사본은 5권이라고 답하고 “한 사람의 대출 한도는 5권입니다.”를 인용합니다.','대출안내.txt에는 화면에 나온 답변과 인용이 그대로 들어 있습니다.','템플릿에서 새로 만든 사본의 대출 한도는 3권입니다.'],
    example:'5권까지 빌릴 수 있습니다.\n“한 사람의 대출 한도는 5권입니다.”',examples:[],graph:single('beginner')},
  {id:'intermediate',title:'근거 찾기와 추가 질문',level:'중급',topic:'도서관',description:'규정을 검색해 원문이 있을 때 답하고, 부족하면 정보를 더 받습니다.',
    task:'분실물 보관 기간을 묻고 추가 안내문을 보내 같은 실행을 마쳐 보세요.',question:'분실물은 며칠 보관하나요?',
    goal:'질문에 따라 규정 검색, 추가 질문, 본인 예약 조회 중 어느 경로를 실행하는지 확인합니다.',
    steps:['네 번의 질문을 각각 새 대화에서 실행해 규정 검색, 추가 질문, 예약 조회 경로를 비교하세요.',
      '‘시험 실행’에서 “책을 몇 권까지 빌릴 수 있나요?”를 보내세요. ‘실행 경로’에서 ‘규정과 지점 안내문 검색’과 ‘근거로 안내’를 찾고, 답변이 ‘대출 규정’의 3권 문장을 인용하는지 확인하세요.',
      '‘새 대화’에서 “분실물은 며칠 보관하나요?”를 보내세요. ‘추가 안내문 받기’에서 ‘응답 대기’가 되면 회신 칸에 “중앙점 안내문에는 ‘분실물은 14일간 보관합니다’라고 적혀 있습니다.”를 입력하고 ‘같은 실행 이어가기’를 누르세요. ‘회신 후 답변’에서 14일의 근거를 찾으세요.',
      '새 대화에서 분실물 질문을 다시 보내고 이번에는 “중앙점입니다.”라고만 회신하세요. 답변이 일수를 추측하지 않고 보관 기간을 확인할 수 없다고 안내하는지 살펴보세요.',
      '새 대화에 “제가 신청한 도서 예약 목록을 조회해 주세요.”를 보내세요. ‘내 예약 조회’에서 ‘예약 조회 결과’로 이어지는 경로와 본인의 시험 예약 목록을 확인하세요. 예약이 없으면 빈 목록이 나옵니다.'],
    checks:['대출 답변에 “한 사람의 대출 한도는 3권입니다.”라는 근거가 있습니다.','분실물 질문은 회신을 기다립니다. 안내문을 보내면 14일을 인용하고, 지점명만 보내면 기간을 확인할 수 없다고 안내합니다.','예약 질문은 본인 권한으로 예약 도구를 호출합니다.'],
    example:'확인하고 싶은 지점이나 가지고 계신 안내문을 알려주시겠어요?',examples:['책을 몇 권까지 빌릴 수 있나요?','제가 신청한 도서 예약 목록을 조회해 주세요.'],graph:intermediate()},
  {id:'library-visit',title:'도서관 방문 준비하기',level:'중급',topic:'도서관',description:'자료함의 수령 규정, 방문 안내 Skill, 운영시간 지식 저장소와 예약 조회 MCP를 연결해 방문 안내를 작성합니다.',
    task:'수령 규정을 1판에서 2판으로 바꾼 뒤 같은 질문을 보내 준비물 안내가 어떻게 달라지는지 확인하세요.',question:libraryVisitQuestion,
    goal:'같은 질문과 시험 예약을 유지한 채 연결한 참고 자료의 판만 바꿔 두 답변을 비교합니다.',
    steps:['내 사본에서 ‘시험 실행 → 실행 설정 → 시험 사례’를 여세요. 설계는 ‘현재 초안’, 시험 사례는 ‘토요일 방문과 예약 조회’를 선택하고 ‘저장된 사례로 시험’을 누르세요.',
      '‘실행 경로’에서 ‘토요일 운영시간 검색’이 찾은 원문과 ‘내 예약 조회’가 반환한 도서명·지점을 확인하세요. 답변에는 방문 시간, 준비물, 예약 내역이 차례로 표시됩니다.',
      '캔버스에서 ‘수령 규정’ 블록을 선택하세요. 속성의 ‘고정할 자료 버전’을 1판에서 2판으로 바꾸고 프로젝트를 저장하세요.',
      '‘시험 실행’에서 같은 시험 사례의 ‘저장된 사례로 시험’을 다시 누르세요. 바뀐 초안으로 새 시험 대화가 열립니다. 실행 기록에서 첫 답변을 열어 두 답변의 세 줄을 비교하세요.'],
    checks:['두 답변 모두 토요일 운영시간은 오전 10시부터 오후 4시까지이며, 시험 예약은 어린 왕자 (중앙도서관)입니다.',
      '첫 답변의 준비물은 수령 규정 1판 원문과, 다시 시험한 답변의 준비물은 2판 원문과 일치합니다.',
      '두 답변의 방문 시간과 예약 내역은 같고, 세 항목의 순서는 연결한 Skill의 지침과 일치합니다.'],
    example:'방문 시간: 중앙도서관은 토요일 오전 10시부터 오후 4시까지 엽니다.\n준비물: 회원증이 필요합니다.\n예약 내역: 어린 왕자 (중앙도서관)',examples:[],graph:libraryVisit()},
  {id:'parallel',title:'두 담당자에게 병렬로 맡기기',level:'고급',topic:'도서관',description:'운영시간과 회원증 담당을 동시에 실행하고 결과를 하나로 모읍니다.',
    task:'팀 안에서 회원증 담당의 자료 연결만 해제한 뒤 결과를 비교하세요.',question:'토요일에 처음 회원증을 만들려면 언제 가고 무엇을 가져가나요?',
    goal:'독립 작업 한쪽에 근거가 없어도 다른 쪽의 결과를 보존합니다.',steps:[
      '‘도서관 방문 안내 팀’에서 ‘팀 열기’를 누르고 두 담당자와 ‘두 조사 결과 모으기’를 찾으세요.',
      '예시 질문을 실행해 두 담당자가 각각 토요일 운영시간과 신분증을 안내하는지 확인하세요.',
      '팀 안에서 ‘회원증 담당 안내문’을 선택하세요. 속성의 ‘연결’에서 ‘회원증 담당 안내문 → 회원증 담당 자료 검색’을 선택하고 ‘연결선 삭제’를 누르세요.',
      '새 대화에서 같은 질문을 보내세요. 운영시간은 토요일 오전 10시부터 오후 4시까지이고, 회원증 준비물만 미확인인지 확인하세요.',
    ],
    checks:['정상 결과는 토요일 10~16시와 신분증입니다.','자료 해제 후 운영시간은 유지되고 준비물만 미확인입니다.'],example:'토요일 오전 10시부터 오후 4시까지 열며, 첫 회원증 발급에는 신분증이 필요합니다.',examples:[],graph:parallel()},
  {id:'peer-review',title:'동료 Agent와 초안 검토하기',level:'고급',topic:'도서관',description:'두 담당자가 서로의 초안을 원문에 대조하고 한 차례 검토합니다.',
    task:'틀린 운영시간이 누구의 검토로 어떻게 고쳐지는지 확인하세요.',question:'다음 방문 안내 초안을 검토해 주세요. “토요일은 오후 6시까지 열며 회원증 발급에는 신분증이 필요합니다.”',
    optionalPractice:'교정 사유 표시 Skill을 사실 검토 담당에게만 전달하고 두 사람의 검토 기록을 비교해 보세요.',
    optionalSteps:[
      '예시 질문을 먼저 실행하세요. 최종 안내문 아래에서 두 검토자가 토요일 폐관 시각을 오후 6시에서 4시로 바로잡은 구절을 확인하세요.',
      '‘도서관 안내문 검토 팀’의 속성에서 ‘도구 및 자료 → 팀에 연결할 Skill’을 여세요. ‘교정 사유 표시 Skill’ 1판을 골라 교정 사유를 한 줄 추가하라는 지침을 확인하고 ‘이 판 연결’을 누르세요.',
      '‘팀 열기’를 누르고 ‘사실 검토 담당의 동료 검토’를 선택하세요. ‘전달받을 상위 Skill’에서 이 Skill을 체크하고 프로젝트를 저장하세요.',
      '새 대화에서 같은 질문을 실행하세요. 두 검토 기록의 교정과 원문 인용을 대조하고, 사실 검토 담당의 기록에만 ‘교정 사유’ 한 줄이 추가됐는지 확인하세요.',
    ],
    goal:'어느 담당자가 동료의 어떤 문장을 고쳤는지 원문으로 확인합니다.',steps:['팀 내부에서 두 초안을 찾아 각각 어느 동료 검토로 전달되는지 선을 따라가세요.','예시 질문을 실행하고 두 검토자가 받은 초안과 원문을 비교하세요.','최종 안내문 아래에서 각 검토자의 수정 전후 문장과 인용을 확인하세요.'],
    checks:['토요일 폐관 시각을 오후 6시에서 오후 4시로 고칩니다.','두 검토 기록에 검토자와 상대 초안, 수정 전후 문장, 근거 원문이 함께 나옵니다.'],
    example:'사실 검토 담당 → 안내문 편집 담당 초안\n“토요일은 오후 6시까지 엽니다.” → “토요일은 오후 4시까지 엽니다.”\n도서관 원문에서 “토요일에는 오전 10시부터 오후 4시까지 엽니다.”라고 안내합니다.',examples:[],graph:peerReview()},
  {id:'dynamic',title:'지점 조사팀의 생성 한도와 실패 처리 설계',level:'전문가',topic:'도서관',description:'네 지점 중 세 곳에만 안내문이 있습니다. 동시에 두 곳까지 조사할 수 있을 때, 담당자 수와 조사를 중단할 조건을 정합니다.',
    task:'사본을 만들며 생성 한도·동시 실행 수·실패 처리 방식을 정하고 네 지점을 조사하세요. 정책을 바꿔 이전 실행과 비교하세요.',question:'중앙도서관, 호수도서관, 숲도서관, 강변도서관',
    optionalPractice:'강변도서관 보완 안내문을 연결하기 전후로 같은 두 지점을 조사해 보세요.',
    optionalSteps:[
      '기본 실습을 마친 뒤 ‘지점별 조사 담당 생성’의 ‘고급 설정 → 전체 생성 상한’을 2명 이상으로 맞추세요. ‘담당자 일부 미완료 시’에는 ‘확인된 결과와 미완료 사유 수집’을 선택하세요.',
      '시험 질문에 “중앙도서관, 강변도서관”을 입력해 실행하세요. 중앙은 평일 오전 9시 개관, 강변은 근거 부족으로 나오는지 확인하세요.',
      '같은 생성 블록의 속성에서 ‘도구 및 자료 → 참고 자료’를 열어 ‘강변도서관 보완 안내문’ 1판을 고르세요. 평일 오전 11시 원문을 확인하고 ‘이 판 연결’을 눌러 저장하세요. 기존 ‘지점별 안내’도 함께 연결되어 있어야 합니다.',
      '새 대화에서 같은 두 지점을 다시 조사하세요. 중앙의 인용은 그대로이고, 강변의 결과에 “강변도서관은 평일 오전 11시에 엽니다.”라는 근거가 나오는지 확인하세요.',
    ],
    goal:'모든 지점을 확인할지 일부 결과를 먼저 제공할지 판단하고, 선택한 정책이 실제로 어떤 지점의 조사와 답변에 영향을 주었는지 설명합니다.',
    steps:['사본을 만들 때 전체 생성 상한, 동시 실행 상한, 담당 작업 일부가 미완료일 때의 처리를 선택하세요. 운영 정보를 즉시 공유할지 전 지점 확인 후 공유할지를 고려하세요.',
      '네 지점으로 실행하고, 대상을 고를 때는 조사 순서를 확인한 뒤 회신하세요. 동시 1명에서 강변을 먼저 고르면 중단 정책은 다음 지점을 시작하기 전에 멈춥니다. '+dynamicLessonExample,
      '지점별 조사 담당 생성 블록의 일부 미완료 처리를 바꿔 같은 지점으로 다시 실행하세요. 고급 속성에서 생성·동시 상한도 조정할 수 있습니다. 두 기록을 비교해 어떤 정책을 채택할지 결정하세요.'],
    checks:['생성 상한을 넘을 때는 조사할 지점을 선택하고, 한도 안에 들어오면 모든 지점이 조사 대상이 됩니다.',
      '각 생성 차수의 인원이 동시 실행 한도 안에 있는지 확인합니다.',
      '근거가 부족한 지점이 있을 때 선택한 정책에 따라 조사 결과가 정리되거나 후속 정리가 중단됩니다.'],
    example:'실행 기록에서 지점별 생성 차수, 원문 인용, 미완료 사유와 최종 정리 단계 실행 여부를 대조합니다.',examples:['중앙도서관, 강변도서관','중앙도서관, 호수도서관, 숲도서관'],graph:dynamic()},
  {id:'release',title:'규정 변경 검증·게시·복구',level:'전문가',topic:'도서관',description:'대출 한도만 바꾸기로 한 도서관에서 후보판의 답변을 검토하고 게시 여부를 결정합니다.',
    task:'기준판과 후보판에 같은 질문을 보내세요. 어느 판을 운영할지 정하고 판단 근거를 남기세요.',question:releaseTestCases[0].input,
    goal:'승인된 변경과 예상 밖의 변화를 구별하고, 사용자에게 제공할 판을 시험 결과로 결정합니다.',
    steps:['1판은 기준판이고 2판과 현재 초안은 후보입니다. 세 사례를 두 판에서 비교하면 여섯 번 실행합니다.',
      '승인된 변경은 대출 한도 3권에서 5권뿐입니다. ‘시험 실행’의 ‘시험 사례’에서 대출 한도·일요일 운영·분실물 사례를 하나씩 골라 ‘같은 사례로 두 번 시험’으로 1판과 2판의 답변을 비교하세요.',
      '방문자 대화까지 비교하려면 후보판을 게시하기 전에 기준판부터 게시하세요. ‘공유 설정’에서 대상 버전은 1판, 공유 범위는 ‘비밀 링크’, 게시 판단은 ‘게시’를 선택하세요. 근거를 적고 ‘판단 적용 및 기록’을 누른 뒤 ‘공유 주소 복사’를 누르세요.',
      '1판을 게시했다면 별도의 시크릿 창에서 복사한 주소를 여세요. 로그인 페이지에서 방문자용 계정으로 로그인하거나 새 계정을 만드세요. 공유 Agent가 열리면 ‘Agent 사용’에서 “책을 몇 권까지 빌릴 수 있나요?”를 보내 1판의 3권 답변을 확인하세요. 이 창을 열어 두세요.',
      '편집 창에서 시험 결과를 보고 후보판을 게시할지 보류할지 정하세요. 수정하려면 ‘도서관 이용규정’을 고치고 ‘현재 초안 버전 저장’으로 새 판을 만든 뒤 다시 시험하세요. ‘공유 설정’에서 대상 판과 ‘게시’ 또는 ‘게시 보류’를 고르고 실제 답변을 근거로 기록하세요. 방문자 비교를 계속할 때는 ‘비밀 링크’를 유지하세요.',
      '방문자 비교를 선택했다면 같은 방문자 창에서 ‘내 실행 기록’의 ‘사용 · 1판’ 대화를 열어 대출 질문을 다시 보내세요. 이어서 ‘새 대화’에도 같은 질문을 보내세요. 5권 규정을 게시했다면 기존 대화는 3권, 새 대화는 5권입니다. 후보판을 보류했다면 두 대화 모두 1판의 3권을 안내합니다.',
      '새 판을 게시한 뒤 문제가 보고되면 ‘공유 설정’에서 현재 판의 ‘현재 게시판 유지’ 또는 이전 판의 ‘이전 판으로 복구’를 선택하고 근거를 기록하세요. 복구했다면 방문자 창에서 새 대화를 시작해 복구한 판의 답변을 확인하고, 복구 직전 판에서 시작한 대화에도 같은 대출 질문을 보내 비교하세요.'],
    checks:['후보판의 대출 한도·일요일 운영·분실물 안내를 기대 결과와 대조해 게시 판단을 설명할 수 있습니다.','대상 판과 근거가 판단 기록에 남고 현재 게시 버전이 결정과 일치합니다.','방문자 실습에서 새 대화는 현재 게시판의 대출 한도를, 기존 대화는 시작 당시 판의 대출 한도를 안내합니다.'],
    example:'결정 근거에는 비교한 판, 기대와 달랐던 실제 답변, 해당 답변이 방문자에게 미치는 영향을 적습니다.',examples:releaseTestCases.slice(1).map(item=>item.input),graph:releaseCandidate()},
];

export const templates: Lesson[] = [
  ...libraryTemplates, ...swStarterTemplates, ...swTeamTemplates, swImpactTemplate,
  ...webDesignStarterTemplates.map(lessonWithSkills),
  lessonWithSkills(webDesignQuestionsTemplate),
  lessonWithSkills(webDesignSingleScreenTemplate),
  lessonWithSkills(webDesignTddReviewTemplate),
  lessonWithSkills(webDesignReviewFollowupTemplate),
  ...webDesignTeamTemplates.map(lessonWithSkills),
  ...equipmentReturnStarterTemplates.map(lessonWithSkills),
  lessonWithSkills(equipmentReturnTemplate),
  lessonWithSkills(equipmentReturnCasesTemplate),
  lessonWithSkills(equipmentRelendingAgreementTemplate),
  ...equipmentInspectionStarterTemplates.map(lessonWithSkills),
  lessonWithSkills(equipmentInspectionWebTemplate),
  lessonWithSkills(equipmentInspectionRecoveryTemplate),
];
