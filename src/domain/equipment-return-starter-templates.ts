import { attachLessonSkill } from './lesson-skills';
import { Drawing } from './template-drawing';
import type { Lesson } from './types';

const topic = '업무 용어와 판단 기준 정리';
const record = '창구 기록의 용어 후보 메모를 만들어 주세요.\n\n노트북 반납. 본체 도착, 충전기 미도착.';
const prepare = '입문에서 만든 용어 후보 메모를 읽고, 무엇을 먼저 결정할지 제게 물은 뒤 장비 담당자에게 확인할 질문을 정리해 주세요.';
const handoffFile = '중급-담당자-확인-질문.md';

function memoGraph() {
  const d = new Drawing('입력한 장비 반납 창구 기록에서 실제로 관찰한 일과 뜻을 확인할 업무 표현을 찾아 용어 후보 메모를 만듭니다.');
  d.node('request', 'input.user_request', '장비 반납 창구 기록', 0, 1, {question:record});
  d.node('memo', 'ai.single_task', '용어 후보 메모 작성', 1, 1, {
    goal:'창구 기록 한 건을 읽고 헷갈리는 표현, 확인된 사실, 더 알아볼 뜻을 구분합니다.',
    instruction:[
      '사용자가 이번 실행에 적은 장비와 기록만 읽으세요. “# 용어 후보 메모”로 시작하는 짧은 한국어 Markdown을 작성하세요. 첫 줄 아래에 창구 기록의 핵심 문장을 그대로 인용해 다음 실습에서도 원래 상황을 읽을 수 있게 하세요.',
      '원문에서 뜻이 여러 가지일 수 있는 업무 표현을 고르세요. 표현마다 기록으로 확인한 사실과 아직 확인할 뜻을 나누어 적으세요. 한 표현이 두 사건을 가리킬 수 있다면 그 차이를 구체적인 상황으로 보여 주세요. 원문에 없는 해석은 가능성으로 표시하세요.',
      '기록에 이미 정의된 뜻은 근거와 함께 적으세요. 헷갈리는 후보를 찾기 어려우면 그렇게 적으세요. 기록되지 않은 검수 결과, 승인 조건이나 담당자의 답변을 추측하지 마세요. 이 메모에서 열린 뜻은 담당자에게 확인할 후보로 남깁니다.',
    ].join('\n'),
  });
  attachLessonSkill(d,'domain-modeling',{title:'domain-modeling',
    example:'창구가 본체를 받았다는 기록을 근거로, ‘반납’이 수령과 검수 완료 중 어느 상태를 가리키는지 살펴봅니다.'}, 1, 0, 'memo');
  d.node('answer', 'output.answer', '용어 후보 메모 전달', 2, 1, {format:'markdown'});
  d.step('request','memo');
  d.step('memo','answer');
  return d.graph;
}

function questionsGraph() {
  const d = new Drawing('장비 반납 용어 후보 메모를 바탕으로 학습자의 결정 목적과 수신인을 확인해 중급 질문지 작성에 사용할 요청을 정리합니다.');
  d.node('request', 'input.user_request', '담당자 질문 준비 요청', 0, 1, {question:prepare});
  d.node('source', 'input.form', '입문 용어 후보 메모 받기', 1, 1, {
    prompt:'입문 실습에서 받은 용어 후보 메모를 붙여 넣으세요. 기록 원문, 확인된 사실과 아직 불분명한 뜻을 함께 옮겨 주세요.',
    fields:[{name:'입문 용어 후보 메모',multiline:true}],
  });
  d.step('request','source');
  d.node('interviewer', 'ai.single_task', '학습자에게 확인할 질문 만들기', 2, 1, {
    goal:'메모에서 학습자가 먼저 내릴 결정과 그 질문에 답할 사람을 확인합니다.',
    instruction:[
      '입문 용어 후보 메모와 학습자의 요청을 읽으세요. 첫 문답의 상대는 이 실습을 하는 학습자입니다. 기록에 이미 있는 사실을 활용하고, 학습자가 결정할 내용 중 지금 답할 수 있는 것만 한 묶음으로 물으세요.',
      '오늘 먼저 내려야 하는 결정과 확인할 사람의 역할을 중심으로, 한 문항에 한 가지씩 번호를 붙이세요. 각 문항에 메모에 맞는 권장 답을 제안하고 학습자가 “예”로 받아들이거나 다른 우선순위·수신인을 적을 수 있게 하세요. 담당자가 정해야 할 용어 정의나 실제 업무 규칙은 열린 질문으로 남겨 두세요.',
      '작업실이 표시할 한국어 질문 본문만 반환하세요. 답변은 다음 단계에서 학습자가 입력합니다.',
    ].join('\n'),
  });
  d.step('source','interviewer');
  d.data('request','interviewer','question');
  d.node('reply', 'input.form', '학습자의 우선순위 듣기', 3, 1, {
    prompt:'{{input}}', fields:[{name:'학습자 답변',multiline:true}],
  });
  d.step('interviewer','reply');
  d.node('first-exchange', 'data.transform', '메모와 첫 문답 모으기', 4, 1, {operation:'text'});
  d.data('source','first-exchange');
  d.data('interviewer','first-exchange');
  d.step('reply','first-exchange');
  d.node('confirm', 'ai.single_task', '답변을 되짚고 확인하기', 5, 1, {
    goal:'첫 답변의 뜻을 확인하고 우선순위와 수신인에서 빠진 결정을 학습자가 보완하도록 돕습니다.',
    instruction:[
      '메모, 방금 제안한 문항과 실제 학습자 답변을 대조하세요. “예”는 앞서 제안한 결정에 대한 학습자의 답입니다. 담당자의 정책 승인으로 읽지 마세요. 선택이 달라졌으면 학습자가 적은 선택을 반영하세요.',
      '확인된 수신인, 가장 먼저 결정할 일과 그 용도를 짧게 되짚으세요. 빠졌거나 서로 맞지 않는 결정이 있으면 그 부분에만 후속 질문을 하세요. 이미 충분하면 이해한 내용이 맞는지 확인하는 질문 하나를 하세요. 원래 기록의 사실이나 업무 규칙 자체를 학습자에게 새로 지어내게 하지 마세요.',
      '권장 답과 직접 수정할 방법을 포함한 한국어 확인 질문 본문만 반환하세요. 학습자가 답할 때까지 인계 문장을 확정하지 마세요.',
    ].join('\n'),
  });
  d.step('first-exchange','confirm');
  d.node('confirmation', 'input.form', '학습자의 확인 또는 보완 듣기', 6, 1, {
    prompt:'{{input}}', fields:[{name:'학습자 확인·보완 답변',multiline:true}],
  });
  d.step('confirm','confirmation');
  d.node('second-exchange', 'data.transform', '확인 질문과 보완 답변 모으기', 7, 1, {operation:'text'});
  d.data('confirm','second-exchange');
  d.step('confirmation','second-exchange');
  d.node('handoff', 'ai.single_task', '중급에 보낼 질문 정리', 8, 1, {
    goal:'실제 두 차례 답변과 메모를 바탕으로 중급 예제의 첫 질문에 붙여 넣을 요청을 작성합니다.',
    instruction:[
      '메모와 첫 문답, 확인 질문과 보완 답변을 함께 읽으세요. 학습자가 고친 내용과 마지막으로 확인한 우선순위·수신인을 따르세요. 권장 답은 학습자가 받아들인 범위에서만 쓰세요. 학습자가 자신의 업무 역할을 밝히지 않았다면 보낸 사람을 “질문을 준비한 학습자”로 적으세요.',
      '장비 반납 중급 실습의 “Agent에게 보낼 질문”에 그대로 붙여 넣을 한국어 요청 본문만 반환하세요. 기록 속 구체적인 사례, 보낸 사람과 수신인의 역할, 회신으로 결정하려는 일, 담당자에게 먼저 확인할 질문과 그다음 질문을 담으세요. 결정할 일에 가장 직접적인 질문을 첫 문항에 두고 문항당 한 결정만 물으세요. 마지막에는 수신인에게 전달할 질문지로 만들어 달라고 요청하세요.',
      '원문에 따르면 분명한 사실과 담당자에게 물어야 할 규칙을 구분하세요. 학습자의 우선순위는 담당자의 업무 답변이 아닙니다. 학습자가 동의하지 않았거나 끝까지 모른다고 한 내용은 “학습자 추가 확인 필요”로 표시하고 보완할 사항을 적으세요. 이 경우 결과는 확인된 범위의 초안임을 밝히세요.',
    ].join('\n'),
  });
  d.step('second-exchange','handoff');
  d.data('first-exchange','handoff','question');
  attachLessonSkill(d,'grilling',{title:'grilling',
    example:'먼저 정할 일과 답해 줄 사람을 묻고 실제 답을 되짚어, 학습자가 확인한 순서로 담당자 질문을 정리합니다.'}, 5, 0, 'interviewer','confirm','handoff');
  d.node('file', 'file.create', '중급 입력 문장 저장', 9, 1, {fileName:handoffFile, format:'markdown'});
  d.node('answer', 'output.answer', '담당자 확인 질문 전달', 10, 1, {format:'markdown'});
  d.step('handoff','file');
  d.step('file','answer');
  return d.graph;
}

export const equipmentReturnStarterTemplates: Lesson[] = [
  {
    id:'equipment-return-memo', topic, level:'입문', title:'창구 기록의 ‘반납’은 무슨 뜻일까?',
    description:'창구 기록에서 뜻이 모호한 표현을 골라, 지금 확인한 사실과 담당자에게 물어봐야 할 뜻을 나란히 적습니다.',
    goal:'같은 “반납”이라는 말이 서로 다른 일을 가리킬 수 있음을 사례 원문으로 설명합니다.',
    task:'창구 기록을 읽고 Agent가 인용한 원문과 해석을 대조하세요. 초급 실습에 옮길 용어 후보 메모를 만드세요.',
    question:record,
    steps:[
      '‘내 사본으로 시작 → 시험 실행’을 누르세요. ‘Agent에게 보낼 질문’의 창구 기록을 읽으세요. 다른 장비로 연습할 때는 기록을 바꾸고 ‘질문 실행’을 누르세요.',
      '‘용어 후보 메모’에서 원문과 확인된 사실, 아직 모호한 뜻을 찾아보세요. 메모 본문을 복사해 초급 ‘장비 담당자에게 무엇부터 물을까?’의 ‘입문 용어 후보 메모’에 붙여 넣으세요.',
    ],
    skillSteps:['‘용어 후보 메모 작성’에 연결된 domain-modeling 원본에서 구체적인 사례로 모호한 뜻을 확인하는 방법을 살펴보세요.'],
    checks:['메모가 입력한 기록에서 업무 표현을 인용합니다.','확인된 사실과 열린 해석이 구분되고, 기록에 없는 완료 조건은 확인 대상으로 남습니다.'],
    sampleCase:{title:'본체만 돌아온 노트북',expected:'본체 도착과 충전기 미도착은 사실로 남고, “반납”의 범위는 확인이 필요한 용어 후보로 제시됩니다.'},
    example:'“노트북 반납. 본체 도착, 충전기 미도착.”에서 확인되는 일은 본체가 창구에 도착했다는 것입니다. 기록의 “반납”이 검수 완료까지 뜻하는지는 더 물어봐야 합니다.',
    examples:[], graph:memoGraph(),
  },
  {
    id:'equipment-return-questions', topic, level:'초급', title:'장비 담당자에게 무엇부터 물을까?',
    description:'입문 메모를 읽고 어떤 결정을 내릴지 학습자와 짚어 본 뒤, 장비 담당자가 답할 질문을 중급 시작 문장으로 만듭니다.',
    goal:'담당자에게 묻는 이유와 질문의 우선순위를 결정하고, 자신의 답이 질문의 순서를 어떻게 바꾸는지 확인합니다.',
    task:'입문 메모를 붙여 넣고 확인할 사람과 우선 결정할 일을 답하세요. Agent가 되짚은 내용을 확인하거나 수정하세요.',
    question:prepare,
    steps:[
      '‘내 사본으로 시작 → 시험 실행 → 질문 실행’을 누르세요. ‘입문 용어 후보 메모’에 입문 결과를 붙여 넣고 ‘같은 실행 이어가기’를 누르세요.',
      'Agent의 질문을 읽고 ‘학습자 답변’에 먼저 정할 일과 답해 줄 사람을 적으세요. 실행을 이어가고 두 번째 질문에서 이해한 내용이 맞는지 확인하거나 빠진 정보를 ‘학습자 확인·보완 답변’에 적으세요.',
      '‘같은 실행 이어가기’를 눌러 최종 문장을 확인하세요. 답변 또는 ‘중급-담당자-확인-질문.md’의 본문을 중급 ‘장비를 돌려받으면 반납이 끝난 걸까?’의 ‘시험 실행 → Agent에게 보낼 질문’에 붙여 넣고 ‘질문 실행’을 누르세요.',
    ],
    skillSteps:['세 AI 작업에 연결된 grilling 원본을 열어, 먼저 물을 질문과 답을 받은 뒤에 물을 질문을 어떻게 나누는지 확인하세요.'],
    checks:['실제로 붙여 넣은 메모와 학습자의 두 답변을 읽어 우선순위와 수신인을 반영합니다.','결과에는 장비 담당자가 답할 문항이 있고, 담당자의 답과 판단 규칙은 열린 상태입니다.'],
    sampleCase:{title:'오늘 창구에 남길 기록부터 정하기',expected:'창구 기록을 먼저 정하겠다고 답하면 수신인에게 오늘 남길 상태를 첫 문항으로 묻는 중급 입력 문장을 받습니다.'},
    example:'“오늘 창구에 적을 상태가 우선입니다. 반납 검수 담당자에게 물어보겠습니다.”라고 답해 보세요. “오늘 본체만 받았을 때 어떤 상태로 기록하나요?”가 먼저 나오는지 살펴보세요.',
    examples:[], graph:questionsGraph(),
  },
];
