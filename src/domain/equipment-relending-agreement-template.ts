import { attachLessonSkill } from './lesson-skills';
import { Drawing } from './template-drawing';
import type { Lesson } from './types';

const question = '장비 재대여 기준을 담당자와 합의하고, 갱신한 기준으로 기존 반납 사례와 새 장비 사례를 다시 판정해 주세요.';
const sourceNames = ['중급 용어집', '중급 판단 규칙표', '고급 최종 판정표', '새 장비 사례'];
const questionnaireName = 'to-questionnaire-equipment-relending.md';
const documents = [
  {key:'glossary', source:'중급 용어집', title:'갱신 용어집', file:'갱신-용어집.md'},
  {key:'rules', source:'중급 판단 규칙표', title:'갱신 판단 규칙표', file:'갱신-판단-규칙표.md'},
] as const;
const tableName = '기존-신규-사례-재판정표.md';

function equipmentRelendingAgreementGraph() {
  const d = new Drawing('중급 문서와 고급 판정표에서 합의가 필요한 재대여 기준을 찾아 담당자에게 묻고, 답변이 적용되는 범위에 따라 두 문서와 기존·신규 장비의 판정을 갱신합니다.');
  d.node('request', 'input.user_request', '재대여 기준 합의 요청', 0, 1, {question});
  d.node('sources', 'input.form', '중급 문서·고급 판정표·새 사례 받기', 1, 1, {
    prompt:'중급 용어집과 판단 규칙표, 고급 최종 판정표의 본문을 각각 붙여 넣으세요. 새 장비 사례에는 장비를 구별할 이름과 실제로 확인한 사실을 적으세요.',
    fields:sourceNames.map(name => ({name, multiline:true})),
  });
  d.node('inputs', 'data.validate', '실습 자료 네 가지 확인', 2, 1, {
    requiredFields:sourceNames, types:Object.fromEntries(sourceNames.map(name => [name,'string'])),
  });
  d.step('request', 'sources');
  d.step('sources', 'inputs');

  d.node('writer', 'agent.delegate', '합의 질문 담당', 3, 1, {
    role:'합의 질문 담당',
    instruction:[
      '장비 대여 창구 직원을 대신해 재대여 기준을 정하는 장비 담당자 한 명에게 보낼 질문지를 준비하세요. 직접 입력한 고급 판정표의 재대여 항목에서 최종 판정과 근거를 읽고, 중급 규칙표와 대조해 아직 합의가 필요한 공통 조건이나 예외 기준을 찾으세요.',
      '과거 최초 판정이 미확정이어도 최종 판정에서 해결되었으면 제외하세요. 승인·금지·보류가 확정된 조건과 명시적으로 거절된 예외도 제외하세요. 한 장비의 사실만 확인하면 될 때는 판정 근거에 남기고 기준 합의 질문에서는 빼세요. 제안만으로 기존 결정을 다시 열지 마세요. 새 사례는 합의가 필요한 기준의 적용 범위를 이해하는 데 사용하세요.',
      '같은 기준을 기다리는 사례 번호를 모으고, 충전기 누락처럼 별도로 정해야 하는 예외가 있으면 적용 범위를 물으세요. 한국어 Markdown 질문지에는 목적, 수신인, 왜 답이 필요한지, 적용할 사례와 빈 답변란을 담으세요. 한 문항에 한 결정을 묻고 부분 회신과 “미합의”도 가능하다고 안내하세요.',
      'unresolved와 questionnaire 두 키의 JSON 객체만 반환하세요. unresolved는 {caseIds,missing} 객체의 배열이고, questionnaire는 전달할 Markdown 원문입니다. 합의할 재대여 기준이 없으면 빈 배열과 빈 문자열을 반환하세요.',
    ].join('\n'),
  });
  d.step('inputs', 'writer');
  d.node('proposal', 'data.validate', '합의할 기준과 질문지 형식 확인', 4, 1, {
    requiredFields:['unresolved.length'], types:{unresolved:'array', questionnaire:'string'},
  });
  d.node('gaps', 'data.transform', '합의할 기준 꺼내기', 5, 1, {operation:'select', path:'unresolved'});
  d.node('needs-reply', 'control.branch', '합의가 필요한 재대여 기준이 있나요?', 6, 1, {
    operator:'truthy', yesLabel:'합의 필요', noLabel:'합의할 기준 없음',
  });
  d.step('writer', 'proposal');
  d.step('proposal', 'gaps');
  d.step('gaps', 'needs-reply');

  d.node('question-ready', 'data.validate', '보낼 질문지 본문 확인', 7, 2, {
    requiredFields:['questionnaire'], types:{questionnaire:'string'},
  });
  d.order('needs-reply', 'question-ready', 'yes');
  d.data('proposal', 'question-ready');
  d.node('questionnaire', 'data.transform', '담당자에게 보낼 질문지', 8, 2, {operation:'select', path:'questionnaire'});
  d.node('reply', 'input.form', '재대여 기준에 대한 담당자 회신 받기', 9, 2, {
    prompt:'{{input}}', fields:['장비 담당자 회신'], questionFileName:questionnaireName,
  });
  d.step('question-ready', 'questionnaire');
  d.step('questionnaire', 'reply');
  d.node('exchange', 'data.transform', '원본 자료·질문지·회신 모으기', 10, 2, {operation:'text'});
  d.data('inputs', 'exchange');
  d.data('questionnaire', 'exchange');
  d.step('reply', 'exchange');
  d.node('modeler', 'agent.delegate', '기준 갱신 담당', 11, 2, {
    role:'기준 갱신 담당',
    instruction:[
      '중급 두 문서를 바탕으로 실제 장비 담당자 회신이 뒷받침하는 내용을 반영한 전체 Markdown 문서 두 개를 작성하세요. 고급 판정과 새 사례는 적용 맥락입니다. 질문지의 보기나 새 사례 자체를 합의로 간주하지 마세요.',
      '용어집에는 기존 명칭과 뜻을 보존하고, 담당자가 뜻을 확인하거나 바꾼 용어만 갱신하세요. 규칙표에는 기존 규칙과 근거를 보존하고 합의한 조건, 결정, 적용 범위와 회신 구절을 기록하세요. 변경이 없는 문서는 직접 입력한 원문을 그대로 반환하세요.',
      '공통 승인 조건과 특정 장비의 관찰 또는 일회성 예외를 구별하세요. 특정 사례 예외는 사례 번호와 허용한 범위를 남기고 같은 조건의 다른 장비에도 일반화하지 마세요. 점검을 마친 사실만으로 정상 판정을 내리지 마세요.',
      '명시적으로 변경·대체한 기준에는 이전 결정과 새 범위를 표시하세요. 회신하지 않은 부분, 모름 또는 충돌은 미확정으로 남기고 확정된 별도 조항은 유지하세요. 새 합의가 과거에 이미 적용됐던 것처럼 원기록을 쓰지 마세요.',
      'glossary와 rules 두 키로 된 JSON 객체만 반환하세요. 각각의 값은 제목을 포함한 전체 문서 문자열입니다.',
    ].join('\n'),
  });
  d.step('exchange', 'modeler');
  d.node('revised', 'data.validate', '갱신한 두 문서 본문 확인', 12, 2, {
    requiredFields:['glossary','rules'], types:{glossary:'string', rules:'string'},
  });
  d.step('modeler', 'revised');

  d.node('original', 'data.transform', '합의된 기존 기준 사용', 7, 0, {operation:'select'});
  d.order('needs-reply', 'original', 'no');
  d.data('inputs', 'original');
  d.node('applied', 'data.transform', '적용할 문서와 회신 근거 모으기', 13, 2, {operation:'text'});
  d.data('inputs', 'applied');
  d.data('reply', 'applied');
  d.step('revised', 'applied');
  d.node('judge-input', 'data.transform', '재판정에 사용할 자료', 14, 1, {operation:'text'});
  d.step('original', 'judge-input');
  d.step('applied', 'judge-input');
  d.node('judge', 'agent.delegate', '사례 재판정 담당', 15, 1, {
    role:'사례 재판정 담당',
    instruction:[
      '갱신 용어집과 판단 규칙표를 사용하세요. 회신 단계가 생략된 경우에는 입력한 중급 문서가 현행 기준입니다. 기존 사례는 고급 표의 최종 판정과 근거에서, 신규 사례는 사용자가 적은 관찰에서 각각 출발하세요.',
      '사례마다 반납 상태와 재대여 가능 여부를 별도 행에 적으세요. 기존 행의 이전 판정은 고급의 최종 판정 그대로, 신규 행의 이전 판정은 “신규”로 표시하세요. 기존과 신규의 번호가 겹치면 구분 열과 입력 순서로 각각 식별하고, 사례나 판단 항목을 합치지 마세요.',
      '새 기준을 해당 사실이 확인된 사례에만 적용하세요. 반납 완료, 정상 점검 결과, 재대여 승인을 각각 구별하세요. 다른 장비와 같은 조건이어도 일회성 예외는 회신이 지정한 장비에만 적용하세요. 기존에 확정한 사실과 관련 없는 반납 상태는 유지하세요.',
      '각 행에 적용한 규칙과 해당 사례의 사실 또는 담당자 회신 구절을 제시하세요. 공통 기준이 미합의인지, 규칙은 있지만 그 장비의 사실이 부족한지 구별해 미확정 사유를 적으세요. 현재 허용·보류·금지 결정을 내릴 근거가 있는지도 확인하세요.',
      '“# 기존·신규 사례 재판정표”로 시작하는 Markdown 표를 작성하세요. 열은 구분, 사례, 판단 항목, 이전 판정, 재판정, 근거입니다. table 한 키를 가진 JSON 객체만 반환하세요.',
    ].join('\n'),
  });
  d.step('judge-input', 'judge');
  d.node('final', 'data.validate', '기존·신규 사례 재판정표 본문 확인', 16, 1, {requiredFields:['table'], types:{table:'string'}});
  d.step('judge', 'final');

  for (const [index, {key, source, title, file}] of documents.entries()) {
    d.node('original-' + key, 'data.transform', source + ' 본문 꺼내기', 8, index, {operation:'select', path:source});
    d.step('original', 'original-' + key);
    d.node('updated-' + key, 'data.transform', title + ' 본문 꺼내기', 13, index + 3, {operation:'select', path:key});
    d.step('revised', 'updated-' + key);
    d.node(key, 'data.transform', title, 15, index + 3, {operation:'text'});
    d.step('original-' + key, key);
    d.step('updated-' + key, key);
    d.order(key, 'judge-input');
    d.node(key + '-file', 'file.create', title + ' 파일 만들기', 18, index + 2, {fileName:file, format:'markdown'});
    d.order('final', key + '-file');
    d.data(key, key + '-file');
    d.node(key + '-answer', 'output.answer', title + ' 전달', 19, index + 2, {format:'markdown'});
    d.step(key + '-file', key + '-answer');
  }
  d.node('table', 'data.transform', '재판정표 본문 꺼내기', 17, 1, {operation:'select', path:'table'});
  d.node('table-file', 'file.create', '재판정표 파일 만들기', 18, 1, {fileName:tableName, format:'markdown'});
  d.node('table-answer', 'output.answer', '기존·신규 사례 재판정표 전달', 19, 1, {format:'markdown'});
  d.step('final', 'table');
  d.step('table', 'table-file');
  d.step('table-file', 'table-answer');
  attachLessonSkill(d, 'to-questionnaire', {title:'to-questionnaire',
    example:'여러 장비의 재대여를 가르는 공통 승인 조건을 한 번 묻고, 구성품 누락 예외의 범위를 별도 문항으로 확인합니다.'}, 3, 2, 'writer');
  attachLessonSkill(d, 'domain-modeling', {title:'domain-modeling',
    example:'점검 완료와 정상 판정의 의미를 구별하고, 갱신한 승인 기준을 기존 장비와 새 장비의 실제 기록에 적용합니다.'}, 12, 4, 'modeler', 'judge');
  return d.graph;
}

export const equipmentRelendingAgreementTemplate: Lesson = {
  id:'equipment-relending-agreement', topic:'업무 용어와 판단 기준 정리', level:'전문가', title:'재대여 기준을 합의하면 어떤 판정이 달라질까?',
  description:'담당자와 재대여 승인 조건과 예외를 확인하고, 갱신한 용어집과 판단 규칙표로 기존·신규 장비 사례를 다시 판정합니다.',
  goal:'공통 기준, 개별 장비의 사실, 한 번만 허용한 예외를 구별하고 무엇이 이전 판정을 바꾸었는지 설명합니다.',
  task:'중급 두 문서와 고급 최종 판정표, 새 사례를 직접 입력하세요. 합의한 기준이 적용되는 장비와 아직 사실 확인이 필요한 장비를 재판정표에서 비교하세요.',
  question,
  steps:[
    '‘내 사본으로 시작 → 시험 실행 → 질문 실행’을 누르세요. ‘중급 용어집’, ‘중급 판단 규칙표’, ‘고급 최종 판정표’에 해당 문서의 본문을 붙여 넣으세요. ‘새 장비 사례’에 사례 번호와 관찰한 사실을 적고 ‘같은 실행 이어가기’를 누르세요.',
    '미확정 재대여 기준이 있으면 ‘질문지 내려받기’로 질문지를 받으세요. ‘장비 담당자 회신’에 합의한 조건과 예외의 범위를 입력하고 ‘같은 실행 이어가기’를 누르세요. 합의할 기준이 없으면 입력한 문서로 바로 재판정합니다.',
    '세 결과 파일을 내려받으세요. 갱신 용어집과 규칙표에서 회신이 반영된 내용을 읽고, 재판정표에서 각 기존 장비의 이전 판정과 새 판정, 신규 장비의 첫 판정 근거를 확인하세요.',
  ],
  skillSteps:['합의 질문 담당에 연결된 to-questionnaire와 기준 갱신 담당·사례 재판정 담당에 연결된 domain-modeling 원문을 확인하세요.'],
  checks:['승인 조건과 예외 기준은 실제 회신에 따라 갱신되고, 일회성 예외는 해당 장비에만 적용됩니다.',
    '기존 장비와 새 장비 모두 반납 상태와 재대여 여부를 따로 판정합니다. 결과에는 이전 판정, 현재 결정, 바뀌거나 미확정으로 남은 근거가 있습니다.'],
  sampleCase:{title:'점검 완료 장비와 정상 판정 장비', expected:'정상 결과가 필수인 재대여 기준을 합의했다면, 점검 완료만 확인된 장비와 정상 결과가 확인된 장비에서 재대여 판정이 달라집니다.'},
  example:'새 사례로 “E는 본체와 충전기를 대조했고 점검 결과가 정상입니다.”를 입력해 보세요. 회신에서 정상 점검 결과를 승인 조건으로 합의했다면, E와 점검 완료만 기록된 기존 사례를 비교하세요.',
  examples:[], graph:equipmentRelendingAgreementGraph(),
};
