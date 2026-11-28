import { Drawing } from './template-drawing';
import type { Lesson } from './types';
import { webDesignInstructions } from './web-design-instructions';
import { attachWebDesignSkill, webDesignSkills } from './web-design-skills';

const question = '예제 주문 관리 앱의 주문 목록에서 ‘배송 중’을 누르고 키보드 포커스를 옮기면 선택한 필터를 구별하기 어렵습니다. 이 화면의 선택 표시와 키보드 동작을 함께 개선해 주세요.';
const orderBehavior = [
  '현재 동작\n주문 검색란이 비어 있으면 주문 3건이 보입니다. ‘배송 중’을 누르면 유리 물병(ORD-1002) 1건만 남습니다. 이때 ‘없는상품’을 검색하면 목록이 비고, 검색어를 지우면 유리 물병이 다시 보입니다.',
  '불편한 점\n‘배송 중’을 누른 뒤 Tab으로 다음 버튼인 ‘배송 완료’로 이동하면 어느 필터가 적용돼 있는지 알아보기 어렵습니다.',
  '기대 동작\n‘배송 중’에는 선택 표시가 남고 키보드 포커스 테두리만 ‘배송 완료’로 이동해야 합니다. 이때 주문은 여전히 1건이고, 키보드로 ‘전체’를 선택하면 주문 3건이 다시 보여야 합니다.',
].join('\n\n');
const workInstruction = webDesignInstructions(
  '작업실에서는 연결된 동작 설명을 읽고 현재 동작, 불편한 점, 기대 동작을 근거로 답하세요. 구현 방법은 제안으로 표현하고, 변경 후 확인할 동작은 기대값으로 적으세요.',
);

function singleScreenGraph() {
  const d = new Drawing('기존 웹 프로젝트에서 요청한 한 화면을 시각 디자인과 접근성 관점으로 검토하고 두 의견을 반영한 변경을 개발·검증합니다.');
  d.node('request', 'input.user_request', '개선할 화면과 조작', 0, 2, {question});
  d.node('split', 'control.parallel', '한 화면을 두 관점으로 검토', 1, 2, {maxConcurrency: 2, failurePolicy: 'stop'});
  d.step('request', 'split');

  const reviewers = [
    {id: 'visual', role: '시각 디자인 담당', title: '시각 디자인 검토', row: 1,
      task: '같은 화면에서 사용자가 먼저 알아봐야 할 정보와 현재 잘 보이지 않는 단서를 찾으세요. 관찰한 위치와 조작, 기존 스타일을 활용한 구체적인 표시 방법, 바뀐 뒤 기대하는 모습을 개발자에게 전달하세요.'},
    {id: 'accessibility', role: '접근성 검토 담당', title: '접근성 검토', row: 3,
      task: '설명에 나온 키보드 조작을 순서대로 짚으세요. 포커스가 어디로 이동하는지, 사용자가 현재 상태를 알아볼 단서가 무엇인지 살피세요. 필요한 변경과 브라우저에서 이름·역할·상태를 확인할 방법을 개발자에게 전달하세요.'},
  ];
  for (const reviewer of reviewers) {
    d.node(reviewer.id, 'agent.delegate', reviewer.title, 2, reviewer.row, {
      role: reviewer.role, projectWork: 'inspect', instruction: workInstruction + '\n' + reviewer.task,
    });
    d.step('split', reviewer.id);
    const record = d.node('record-' + reviewer.id, 'data.transform', reviewer.role + ' 의견', 3, reviewer.row,
      {operation: 'rename', target: reviewer.role});
    d.step(reviewer.id, record);
    d.step(record, 'reviews');
  }

  d.node('reviews', 'control.join', '두 검토 의견 모으기', 4, 2, {merge: 'sections', partialFailure: 'fail'});
  d.node('developer', 'agent.delegate', '두 의견을 반영한 UI 개발', 5, 2, {
    role: 'UI 개발 담당', projectWork: 'edit',
    instruction: [workInstruction,
      '두 담당자의 의견을 하나의 변경안으로 통합하세요. 각각의 의견이 어떤 표시와 조작에 반영되는지 적고, 의견이 충돌하면 사용자의 동작을 근거로 선택을 설명하세요.',
      '변경할 화면 요소와 유지해야 할 기존 동작을 검증 담당자에게 넘기세요. 실제 소스를 확인한 경우에는 해당 파일과 변경 내용도 적으세요.',
    ].join('\n'),
  });
  d.step('reviews', 'developer');
  d.data('request', 'developer', 'question');
  d.node('record-developer', 'data.transform', '통합 변경안 기록', 6, 2, {operation: 'rename', target: 'UI 개발 담당'});
  d.step('developer', 'record-developer');
  d.node('qa', 'agent.delegate', '개선한 화면 검증', 7, 2, {
    role: '화면 검증 담당', projectWork: 'verify',
    instruction: [workInstruction,
      '개발자가 전달한 변경과 원래 요청을 대조하세요. 같은 화면에서 변경된 조작과 유지해야 할 동작을 각각 확인하고 조작별 기대값, 관찰 결과, 미검증 항목과 이유를 기록하세요.',
      '연결된 설명에 나온 시작 상태와 조작 순서로 검증 절차를 작성하세요. 기대 동작과 실제 관찰 결과를 구분하고, 변경 후 결과는 직접 확인했거나 실행 기록이 있을 때 적으세요.',
    ].join('\n'),
  });
  d.order('record-developer', 'qa');
  d.data('developer', 'qa');
  d.data('request', 'qa', 'question');
  d.node('record-qa', 'data.transform', '검증 결과 기록', 8, 2, {operation: 'rename', target: '화면 검증 담당'});
  d.step('qa', 'record-qa');
  d.node('report', 'control.join', '의견·변경안·검증 결과 묶기', 9, 2, {merge: 'sections', partialFailure: 'fail'});
  d.data('reviews', 'report');
  d.data('record-developer', 'report');
  d.step('record-qa', 'report');
  d.node('answer', 'output.answer', '한 화면 개선 결과 전달', 10, 2);
  d.step('report', 'answer');

  const behavior = d.node('behavior', 'resource.context', '주문 목록 동작 설명', 1, 0, {content: orderBehavior, version: '1'});
  for (const recipient of ['visual', 'accessibility', 'developer', 'qa']) {
    d.edge(behavior, recipient, 'reference', 'ref', 'context');
  }
  attachWebDesignSkill(d, 'diagnose', 2, 0, 'visual');
  attachWebDesignSkill(d, 'component', 5, 1, 'developer');
  const verify = webDesignSkills.verify;
  d.node('skill-verify', 'instruction.skill', verify.title, 7, 1, {
    version: '1', content: verify.content,
    skillExample: '주문 목록에서 배송 중을 눌러 ORD-1002 한 건을 확인한 뒤, 키보드로 전체를 선택해 주문 3건이 다시 보이는지 확인합니다.',
  });
  d.edge('skill-verify', 'qa', 'reference', 'ref', 'skill', verify.title);
  attachWebDesignSkill(d, 'frontend-design', 4, 0, 'visual', 'developer');
  attachWebDesignSkill(d, 'frontend-ui-engineering', 5, 4, 'accessibility', 'developer', 'qa');
  return d.graph;
}

export const webDesignSingleScreenTemplate: Lesson = {
  id: 'web-design-single-screen', title: '한 화면을 여러 Agent로 개선하기', topic: '웹 디자인 개선', level: '고급',
  description: '한 화면을 시각 디자인과 접근성 담당자가 병렬로 검토합니다. UI 개발 담당자가 두 의견을 함께 반영하고 화면 검증 담당자가 같은 조작을 확인합니다.',
  goal: '같은 화면을 본 두 담당자의 관찰이 하나의 변경안과 검증 기준으로 어떻게 이어지는지 설명합니다.',
  task: '주문 목록에서 선택한 필터와 키보드 포커스를 구별할 수 있도록 두 담당자의 의견을 모으고 변경 전후를 비교하세요.',
  question,
  sampleCase: {title: '주문 목록의 선택 표시와 포커스', expected: '시각·접근성 의견, 두 의견을 반영한 변경안 한 건, 검증 순서가 담당자 이름 아래 나옵니다. 포커스를 옮긴 뒤에도 배송 중 선택과 ORD-1002 한 건이 유지되고 전체를 선택하면 3건이 복구되는지 시험할 수 있습니다.'},
  steps: [
    '‘주문 관리 예제 내려받기’로 받은 HTML을 열고 주문 목록에서 ‘배송 중’을 누르세요. ORD-1002 한 건이 보일 때 Tab으로 다음 버튼으로 이동해 선택한 버튼과 포커스가 있는 버튼을 비교하세요.',
    '‘내 사본으로 시작’ 후 ‘시험 실행’에 예시 질문을 보내세요. ‘시각 디자인 검토’와 ‘접근성 검토’에서 같은 주문 목록에 대해 각자 무엇을 관찰했는지 읽으세요.',
    '‘두 의견을 반영한 UI 개발’에서 선택 표시와 키보드 조작을 어떻게 함께 개선하는지 읽으세요. ‘개선한 화면 검증’에서 키보드로 ‘전체’를 선택한 뒤의 기대 결과를 확인하고, 최종 답변에서 네 담당자의 기록을 대조하세요.',
    '내 화면으로 시험하려면 사본에서 네 담당자의 참고 자료에 현재 동작, 불편한 점, 기대 동작을 적고 새 대화에서 그 화면에 관한 질문을 보내세요. 실제 파일을 고치려면 ‘Agent 내보내기’로 받은 Agent를 코딩 도구에서 열고 작업 폴더와 대상 화면을 알려 주세요.',
  ],
  skillSteps: [
    '사본에서 각 담당자 블록을 선택해 ‘적용되는 Skill’을 확인하세요. ‘컴포넌트 개선 Skill’의 ‘SKILL.md 지침’ 끝에 “선택한 버튼 이름 옆에 체크 표시를 붙이세요”를 추가해 저장하세요. ‘시험 실행’의 ‘실행 기록’에서 ‘＋ 새 대화’를 누르고 같은 질문을 보내 이전 변경안과 새 변경안의 선택 표시를 비교하세요.',
  ],
  checks: [
    '네 담당자가 같은 동작 설명을 참고하고, 두 검토자가 각자의 관점에서 불편의 근거와 제안을 남깁니다.',
    'UI 개발 담당이 두 의견을 받아 선택 상태와 포커스를 구별하는 한 가지 변경으로 통합합니다.',
    '최종 답변에서 두 의견, 통합 변경안, 검증 결과를 담당자별로 읽을 수 있습니다. 원본에서 관찰한 결과와 변경 후 확인할 기대값을 구분합니다.',
  ],
  example: '‘배송 중’의 선택 표시는 버튼에 남겨 두고 Tab으로 옮긴 포커스는 다음 버튼에 테두리로 표시합니다. 검색란이 비어 있을 때 키보드로 ‘전체’를 선택해 주문 3건이 복구되는지 확인합니다.',
  examples: ['내 프로젝트의 알림 설정 화면에서 알림 수신 버튼을 켠 뒤 Tab을 누르면 켜짐 상태와 포커스를 혼동합니다. 이 화면의 표시와 키보드 조작을 개선해 주세요.'],
  graph: singleScreenGraph(),
};
