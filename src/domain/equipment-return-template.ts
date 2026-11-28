import { attachLessonSkill } from './lesson-skills';
import { Drawing } from './template-drawing';
import type { Lesson } from './types';

const question = '저는 노트북 대여 창구의 신규 직원입니다. 반납 검수와 다음 대여 승인을 맡는 장비 담당 선배에게, 언제 반납을 완료로 기록하고 언제 다시 빌려줄 수 있는지 물을 질문지를 만들어 주세요. 오늘 노트북 본체만 돌아왔고 충전기는 오지 않았습니다.';
const context = '대여 창구 직원은 대여 장비를 받고 장비 담당자는 구성품을 점검합니다. 창구 기록에는 “반납”이라고만 적혀 있습니다. 오늘 돌아온 것은 노트북 본체 한 대이며 충전기는 없습니다. 반납 완료 시점과 다음 대여를 승인하는 조건은 아직 담당자에게 확인하지 않았습니다.';
const questionnaireName = 'to-questionnaire-equipment-return.md';
const sampleReply = '본체를 받으면 반납을 접수합니다. 구성품 점검 뒤 반납을 완료합니다. 충전기가 없을 때 재대여할 수 있는지는 아직 모릅니다.';

function equipmentReturnGraph() {
  const d = new Drawing('장비 반납 업무를 잘 아는 담당자에게 질문할 문서를 만들고, 담당자의 회신에 근거해 업무 용어와 상황별 판단 규칙을 정리합니다.');
  d.node('request', 'input.user_request', '확인할 장비 반납 업무', 0, 1, {question});
  d.node('writer', 'agent.delegate', '질문지 작성 담당', 1, 1, {
    role:'질문지 작성 담당',
    instruction:[
      '사용자 요청에서 보내는 사람, 받는 사람의 역할, 업무 상황과 결정할 일을 확인하세요. 초급에서 준비한 담당자 확인 질문이 있으면 그 사례와 표현, 수신인, 질문 순서를 유지해 질문지를 만드세요. 별도 사례를 입력한 경우 기본 참고 자료의 노트북·충전기 상황을 섞지 마세요.',
      '장비 담당자가 앞선 대화를 읽지 않아도 회신할 수 있는 한국어 Markdown 질문지 본문을 작성하세요. 목적, 보낸 사람과 받는 사람, 회신의 쓰임, 현재 상황과 답변 방법을 설명하세요. 회신 기한을 받지 않았다면 임의로 정하지 마세요.',
      '가장 중요한 결정부터 한 문항에 한 가지씩 묻고 각 문항 아래에 빈 답변란을 두세요. 기본 사례에서는 장비를 받았을 때 쓰는 용어와 완료 조건, 구성품 누락 시 처리, 재대여 가능 여부를 각각 물으세요. 부분 답변과 “모름”도 기록할 수 있도록 안내하세요. 회신할 내용은 담당자가 채웁니다.',
      '질문지만 반환하세요. 이어지는 파일 만들기 단계가 이 원문을 Markdown 파일로 보관하고 회신 단계에서 같은 질문지를 보여 줍니다.',
    ].join('\n'),
  });
  d.node('questionnaire-file', 'file.create', '담당자 질문지 만들기', 2, 1, {fileName:questionnaireName, format:'markdown'});
  d.node('reply', 'input.form', '장비 담당자 회신 받기', 3, 1, {
    prompt:'{{input}}', questionFileName:questionnaireName, fields:['장비 담당자 회신'],
  });
  d.node('exchange', 'data.transform', '질문지와 회신 모으기', 4, 1, {operation:'text'});
  d.node('modeler', 'agent.delegate', '용어 정리 담당', 5, 1, {
    role:'용어 정리 담당',
    instruction:[
      '원래 요청, 업무 상황, 보낸 질문지와 “장비 담당자 회신”을 읽으세요. 회신을 승인된 판단의 근거로 삼으세요. 질문지에 적힌 가정이나 보기, 예시는 담당자가 확인한 사실로 인용하지 마세요.',
      '용어집은 “# 용어집”으로 시작합니다. 회신에서 합의된 업무 용어마다 대표 명칭과 한두 문장의 뜻을 담으세요. 본체 접수와 반납 완료가 다른지 같은지는 실제 회신을 따르세요. 뜻이 불분명하거나 서로 충돌하는 표현은 추가 확인 대상으로 표시하세요.',
      '판단 규칙표는 “# 판단 규칙표”로 시작하며 상황, 판단할 일, 결정, 회신 근거를 열로 가진 Markdown 표입니다. 실제 질문지에서 물은 결정별로 관련된 회신 구절을 남기세요. 기본 노트북 사례에서는 구성품이 빠진 경우 반납 기록을 어떻게 남길지와 재대여를 허용할지 각각 판정하세요. 답이 없거나 모른다고 했거나 서로 모순되는 결정은 “미확정”으로 두고 확인할 질문을 적으세요. 미확정을 승인이나 금지로 해석하지 마세요.',
      '두 Markdown 문서를 이어지는 파일 단계에 전달하세요. glossary와 rules 두 키를 가진 JSON 객체만 반환하세요. 각 값은 해당 제목과 본문을 포함한 문자열입니다. JSON 밖에 코드 울타리나 설명을 붙이지 마세요.',
    ].join('\n'),
  });
  d.node('documents', 'data.validate', '용어집과 규칙표 본문 확인', 6, 1, {
    requiredFields:['glossary','rules'], types:{glossary:'string', rules:'string'},
  });
  d.step('request', 'writer');
  d.step('writer', 'questionnaire-file');
  d.order('questionnaire-file', 'reply');
  d.data('writer', 'reply');
  d.data('writer', 'exchange');
  d.step('reply', 'exchange');
  d.step('exchange', 'modeler');
  d.data('request', 'modeler', 'question');
  d.step('modeler', 'documents');

  for (const [key, title, fileName, row] of [
    ['glossary','용어집','GLOSSARY.md',0], ['rules','판단 규칙표','판단-규칙표.md',2],
  ] as const) {
    d.node(key, 'data.transform', title + ' 본문 꺼내기', 7, row, {operation:'select', path:key});
    d.node(key + '-file', 'file.create', title + ' 파일 만들기', 8, row, {fileName, format:'markdown'});
    d.step('documents', key);
    d.step(key, key + '-file');
  }
  d.node('glossary-answer', 'output.answer', '용어집 전달', 9, 0, {format:'markdown'});
  d.node('rules-answer', 'output.answer', '판단 규칙표 전달', 9, 2, {format:'markdown'});
  d.node('questionnaire-answer', 'output.answer', '보낸 질문지 첨부', 9, 1, {format:'markdown'});
  d.step('glossary-file', 'glossary-answer');
  d.step('rules-file', 'rules-answer');
  d.order('rules-file', 'questionnaire-answer');
  d.data('questionnaire-file', 'questionnaire-answer');
  d.doc('case', '장비 반납 상황', context, 3, 0, 'writer');
  d.edge('case', 'modeler', 'reference', 'ref', 'context');
  attachLessonSkill(d, 'to-questionnaire', {title:'to-questionnaire',
    example:'장비를 접수한 창구 직원이 검수 담당자에게 묻는 질문지에 반납 완료 시점과 충전기 누락 시 재대여 여부를 따로 묻습니다.'}, 1, 2, 'writer');
  attachLessonSkill(d, 'domain-modeling', {title:'domain-modeling',
    example:'담당자의 회신에 따라 반납 용어의 뜻을 적고, 충전기 누락 시 재대여 여부를 별도 규칙표에 기록합니다.'}, 5, 2, 'modeler');
  return d.graph;
}

export const equipmentReturnTemplate: Lesson = {
  id:'equipment-return-terms', topic:'업무 용어와 판단 기준 정리', level:'중급', title:'장비를 돌려받으면 반납이 끝난 걸까?',
  description:'충전기 없이 노트북만 돌아왔을 때 반납 처리를 어디까지 할 수 있는지 담당자에게 묻고, 회신을 용어집과 판단 규칙표로 정리합니다.',
  goal:'담당자의 회신에서 용어의 뜻과 판단 조건을 구별하고, 답을 받지 못한 조건을 미확정으로 남깁니다.',
  task:'누구에게 무엇을 확인할지 적어 질문지를 만들고 장비 담당자의 회신을 입력하세요. 두 문서에서 반납 완료의 뜻과 재대여 여부에 대한 근거를 확인하세요.',
  question,
  steps:[
    '‘내 사본으로 시작’을 누르고 ‘시험 실행’을 여세요. 초급에서 준비한 담당자 확인 질문이 있으면 ‘Agent에게 보낼 질문’에 본문을 붙여 넣으세요. 바로 시작하려면 ‘장비 반납 상황’의 기본 질문을 사용하세요. ‘질문 실행’을 누르세요.',
    '‘장비 담당자 회신 받기’에 나타난 질문지를 내려받으세요. 담당자가 답한 내용을 ‘장비 담당자 회신’에 입력하고 ‘같은 실행 이어가기’를 누르세요. 혼자 연습할 때는 제공된 회신 예시를 사용하세요.',
    '최종 답변과 내려받은 GLOSSARY.md에서 업무 용어의 뜻을 읽으세요. 판단-규칙표.md에서 담당자가 확인한 결정과 미확정으로 남긴 결정을 구분하고 근거를 회신과 대조하세요.',
  ],
  skillSteps:['‘질문지 작성 담당’에 연결된 to-questionnaire와 ‘용어 정리 담당’에 연결된 domain-modeling의 원문을 확인하세요.'],
  checks:[
    '질문지에 수신인, 업무 상황과 결정할 일이 있고, 담당자 회신을 받을 때까지 용어 정리 단계가 기다립니다.',
    '용어집에는 회신이 뒷받침하는 뜻이, 판단 규칙표에는 조건별 결정과 그 근거가 담깁니다. 미응답·불확실·상충하는 조건은 미확정으로 남습니다.',
  ],
  sampleCase:{title:'충전기 없이 돌아온 노트북', expected:'회신을 입력하면 반납 관련 용어의 뜻과 충전기 누락 시 판단을 각각 확인할 수 있습니다. 답하지 않은 사항은 미확정으로 표시됩니다.'},
  example:'장비 담당자 회신 예시 — “' + sampleReply + '” 이 회신이면 본체 접수와 반납 완료는 서로 다른 시점이고, 충전기가 없는 장비의 재대여는 미확정입니다.',
  examples:[], graph:equipmentReturnGraph(),
};
