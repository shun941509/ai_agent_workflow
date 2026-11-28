import { attachLessonSkill } from './lesson-skills';
import { Drawing } from './template-drawing';
import type { Lesson } from './types';

const question = [
  '아래 노트북 네 대의 반납 상태와 재대여 가능 여부를 각각 판정해 주세요.',
  'A · 본체와 충전기를 대조했고 상태 점검도 마쳤습니다. 이상은 없습니다.',
  'B · 본체만 창구에 도착했습니다. 충전기는 아직 돌아오지 않았습니다.',
  'C · 본체와 충전기를 대조했습니다. 상태 점검 기록은 비어 있습니다.',
  'D · 본체와 충전기를 대조했고 상태 점검 결과도 정상입니다. 다른 팀이 오늘 바로 빌리려고 합니다.',
].join('\n');
const questionnaireName = 'to-questionnaire-equipment-return-cases.md';
const resultName = '사례별-최종-판정표.md';
const tableFormat = 'table은 “# 사례별 최종 판정표”로 시작하는 한국어 Markdown입니다. 사례마다 반납 상태와 재대여 가능 여부를 각각 한 행에 적으세요. 표의 열은 사례, 판단 항목, 최초 판정, 최종 판정, 근거입니다. 근거에는 사례의 사실과 적용한 규칙 문구 또는 회신 구절을 적으세요.';

function equipmentReturnCasesGraph() {
  const d = new Drawing('중급의 용어집과 판단 규칙표로 장비별 반납 상태와 재대여 가능 여부를 판정하고, 판단할 근거가 부족한 항목은 담당자에게 확인합니다.');
  d.node('request', 'input.user_request', '판정할 장비 반납 사례', 0, 1, {question});
  d.node('sources', 'input.form', '중급 용어집과 판단 규칙표 받기', 1, 1, {
    prompt:'중급 실습에서 받은 GLOSSARY.md와 판단-규칙표.md의 본문을 각각 붙여 넣으세요. 표의 조건, 결정, 회신 근거를 함께 옮기세요.',
    fields:[{name:'중급 용어집', multiline:true}, {name:'중급 판단 규칙표', multiline:true}],
  });
  d.node('documents', 'data.validate', '두 중급 문서의 본문 확인', 1, 0, {
    requiredFields:['중급 용어집','중급 판단 규칙표'], types:{'중급 용어집':'string','중급 판단 규칙표':'string'},
  });
  d.node('judge', 'agent.delegate', '사례 판정 담당', 2, 1, {
    role:'사례 판정 담당',
    instruction:[
      '사용자가 보낸 장비 사례와 직접 입력한 중급 용어집·판단 규칙표만 근거로 사용하세요. 사례 번호를 보존하고 번호가 없으면 입력 순서대로 부여하세요. 모든 사례에서 반납 상태와 재대여 가능 여부를 독립적으로 결정하세요.',
      '용어집의 뜻을 각 사례에 대입하고 규칙의 조건과 대조하세요. 접수 사실만으로 완료나 재대여를 단정하지 마세요. 재대여 요청 유무는 허용 조건과 다릅니다. 확인된 상태는 기록하고 다음 상태를 정할 수 없으면 어느 부분이 미확정인지 밝히세요.',
      '있는 기록과 실제 발생한 사실을 구별하세요. 점검 기록이 비었다고 미점검으로 판정하지 마세요. 규칙이 금지·보류를 명시하면 그 결정을 쓰고, 조건 누락·상충·모름은 미확정으로 남기세요.',
      tableFormat,
      '아직 회신 전이므로 최초 판정과 최종 판정을 같게 적으세요. 미확정 부분마다 unresolved에 {caseIds,axis,kind,missing}을 넣으세요. caseIds는 적용할 사례 번호 배열, axis는 “반납 상태” 또는 “재대여 가능 여부”, kind는 “사례 사실” 또는 “공통 규칙”, missing은 담당자에게 확인할 구체적인 사실이나 규칙입니다. 같은 공통 규칙을 기다리는 사례 번호들은 묶으세요. 모든 항목을 판정했다면 빈 배열을 쓰세요.',
      'table과 unresolved 두 키를 가진 JSON 객체만 반환하세요. Markdown 코드 울타리로 감싸지 마세요.',
    ].join('\n'),
  });
  d.node('initial', 'data.validate', '최초 판정과 미확정 목록 확인', 3, 1, {
    requiredFields:['table'], types:{table:'string', unresolved:'array'},
  });
  d.node('gaps', 'data.transform', '미확정 항목 꺼내기', 4, 1, {operation:'select', path:'unresolved'});
  d.node('needs-reply', 'control.branch', '미확정 항목이 있나요?', 5, 1, {
    operator:'truthy', yesLabel:'미확정 있음', noLabel:'모두 판정됨',
  });
  d.step('request', 'sources');
  d.step('sources', 'documents');
  d.step('documents', 'judge');
  d.data('request', 'judge', 'question');
  d.step('judge', 'initial');
  d.step('initial', 'gaps');
  d.step('gaps', 'needs-reply');

  d.node('writer', 'agent.delegate', '재질문 담당', 6, 2, {
    role:'재질문 담당',
    instruction:[
      '보낸 사람은 장비 대여 창구 직원이고 수신인은 반납 점검과 재대여를 맡은 장비 담당자 한 명입니다. 입력받은 미확정 항목만 질문하는 한국어 Markdown 질문지 본문을 반환하세요. 수신인에게 사례 번호와 결정할 일을 짧게 소개하세요.',
      '문항에 적용할 사례 번호와 판단 항목을 표시하고 한 번에 한 가지를 물으세요. 사례 사실은 해당 장비의 관찰을 묻고, 공통 규칙은 해당 사례 번호를 모아 적용 조건을 한 번만 물으세요. 이미 결정된 사항이나 목록 밖의 추가 주제를 묻지 마세요.',
      '질문마다 빈 답변란을 두고 부분 회신이나 “아직 모름”도 기록할 수 있다고 안내하세요. 선택지를 답으로 간주하거나 임의로 기한을 정하지 마세요.',
    ].join('\n'),
  });
  d.order('needs-reply', 'writer', 'yes');
  d.data('gaps', 'writer');
  d.node('reply', 'input.form', '미확정 항목에 대한 담당자 회신 받기', 7, 2, {
    prompt:'{{input}}', questionFileName:questionnaireName, fields:['장비 담당자 회신'],
  });
  d.step('writer', 'reply');
  d.node('exchange', 'data.transform', '기준과 최초 판정·질문·회신 모으기', 8, 2, {operation:'text'});
  d.data('documents', 'exchange');
  d.data('initial', 'exchange');
  d.data('writer', 'exchange');
  d.step('reply', 'exchange');
  d.node('rejudge', 'agent.delegate', '회신 반영 담당', 9, 2, {
    role:'회신 반영 담당',
    instruction:[
      '중급 문서, 최초 판정표와 미확정 목록, 보낸 질문지, 장비 담당자 회신을 대조하세요. 모든 사례 번호와 두 판단 항목, 최초 판정과 기존 근거를 보존하세요. 질문에 실린 가정은 사실로 쓰지 마세요.',
      '미확정 항목 중 회신이 뒷받침하는 결정만 갱신하고 해당 구절을 인용하세요. 사례 사실의 답은 해당 장비에만, 공통 규칙으로 명시한 답은 조건이 확인된 해당 사례들에만 적용하세요. 한 장비에 대한 허락을 일반 규칙으로 넓히지 마세요.',
      '미응답·모름·모순된 답은 미확정으로 남기고 더 확인할 내용과 이유를 적으세요. 담당자가 기존 규칙을 변경했다고 명시한 경우에만 적용 범위와 근거를 기록하세요. 관련 없는 확정 항목은 원래 근거를 유지하세요.',
      tableFormat,
      'table 한 키를 가진 JSON 객체만 반환하세요. Markdown 코드 울타리로 감싸지 마세요.',
    ].join('\n'),
  });
  d.step('exchange', 'rejudge');
  d.data('request', 'rejudge', 'question');
  d.node('updated', 'data.validate', '회신을 반영한 판정표 확인', 10, 2, {requiredFields:['table'], types:{table:'string'}});
  d.step('rejudge', 'updated');
  d.node('direct-table', 'data.transform', '모두 확정된 판정표 꺼내기', 6, 0, {operation:'select', path:'table'});
  d.order('needs-reply', 'direct-table', 'no');
  d.data('initial', 'direct-table');
  d.node('updated-table', 'data.transform', '회신 후 판정표 꺼내기', 11, 2, {operation:'select', path:'table'});
  d.step('updated', 'updated-table');
  d.node('table', 'data.transform', '사례별 최종 판정표', 12, 1, {operation:'text'});
  d.step('direct-table', 'table');
  d.step('updated-table', 'table');
  d.node('file', 'file.create', '최종 판정표 파일 만들기', 13, 1, {fileName:resultName, format:'markdown'});
  d.node('answer', 'output.answer', '최종 판정표 전달', 14, 1, {format:'markdown'});
  d.step('table', 'file');
  d.step('file', 'answer');
  attachLessonSkill(d, 'domain-modeling', {title:'domain-modeling',
    example:'점검 기록의 빈칸과 미점검의 뜻을 구별하고, 회신에서 확인한 사실이 어느 장비의 판정을 바꾸는지 대조합니다.'}, 3, 3, 'judge', 'rejudge');
  attachLessonSkill(d, 'to-questionnaire', {title:'to-questionnaire',
    example:'한 장비의 점검 여부와 여러 장비에 적용할 재대여 조건을 나눠, 장비 담당자에게 부족한 근거만 묻습니다.'}, 6, 3, 'writer');
  return d.graph;
}

export const equipmentReturnCasesTemplate: Lesson = {
  id:'equipment-return-cases', topic:'업무 용어와 판단 기준 정리', level:'고급', title:'이 장비는 반납 완료일까, 다시 물어봐야 할까?',
  description:'중급의 용어집과 판단 규칙표로 여러 장비의 반납 상태와 재대여 가능 여부를 판정합니다. 근거가 부족한 항목만 담당자에게 다시 묻습니다.',
  goal:'한 장비의 사실 확인과 여러 장비에 적용할 규칙 확인을 구별하고, 담당자 회신이 바꾸는 판정을 설명합니다.',
  task:'판정할 사례를 보내고 중급의 용어집과 판단 규칙표를 직접 입력하세요. 미확정 항목에 회신한 뒤 최초 판정과 최종 판정을 비교하세요.',
  question,
  steps:[
    '‘내 사본으로 시작’ 후 ‘시험 실행’에서 예시 장비 네 대를 확인하세요. 다른 사례로 연습하려면 ‘Agent에게 보낼 질문’에 사례 번호와 관찰한 사실을 적고 ‘질문 실행’을 누르세요.',
    '‘중급 용어집’과 ‘중급 판단 규칙표’에 중급 결과 문서의 본문을 각각 붙여 넣고 ‘같은 실행 이어가기’를 누르세요.',
    '미확정 항목이 있으면 ‘질문지 내려받기’로 장비 담당자에게 전달할 질문지를 받으세요. ‘장비 담당자 회신’에 답변을 입력하고 ‘같은 실행 이어가기’를 누르세요. 모든 사례를 판정할 수 있다면 바로 최종 판정표가 나옵니다.',
    '‘사례별-최종-판정표.md’를 내려받아 장비마다 반납 상태와 재대여 가능 여부의 최초·최종 판정, 적용한 규칙과 인용한 회신을 비교하세요.',
  ],
  skillSteps:['사례 판정 담당과 회신 반영 담당에 연결된 domain-modeling, 재질문 담당에 연결된 to-questionnaire 원문을 확인하세요.'],
  checks:[
    '장비 한 대마다 두 판단과 근거가 있으며, 이미 결정된 항목은 다시 묻지 않습니다.',
    '개별 점검 사실은 해당 장비에만 반영하고, 공통 규칙은 조건에 맞는 사례에 적용합니다. 담당자가 답하지 못한 항목은 미확정으로 남습니다.',
  ],
  sampleCase:{title:'점검 기록이 비어 있는 노트북', expected:'완료에 점검이 필요하다는 규칙이라면 C의 실제 점검 여부를 확인합니다. C에 대한 답은 다른 장비의 점검 사실을 바꾸지 않습니다.'},
  example:'C의 점검 여부와 공통 재대여 조건을 질문받았다면 “C는 지금 확인해 보니 정상 점검을 마쳤습니다. 재대여 승인 기준은 아직 합의하지 못했습니다.”라고 회신해 보세요. 어떤 판정이 바뀌고 어떤 판단이 남았는지 비교하세요.',
  examples:[], graph:equipmentReturnCasesGraph(),
};
