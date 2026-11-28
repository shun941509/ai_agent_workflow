import { Drawing } from './template-drawing';
import type { Lesson } from './types';
import { webDesignInstructions } from './web-design-instructions';
import { attachWebDesignSkill } from './web-design-skills';

const question = '주문 목록에서 검색어가 비어 있을 때 ‘배송 중’을 누른 뒤 Tab을 누른다. ‘배송 중’에 선택 표시가 남고 포커스는 ‘배송 완료’로 이동한다. 목록에는 유리 물병(ORD-1002) 한 건이 보인다.';
const scopePrompt = [
  '입력한 개선 기준\n{{input}}',
  '첫 테스트는 Windows PC 브라우저에서 위 조작을 따라 하고, 그 뒤 사용자가 볼 수 있는 결과를 확인합니다. 화면의 표시·포커스·목록 변화는 확인할 수 있고 서버 내부 처리는 이 테스트의 범위 밖입니다.',
  '이 범위로 진행하려면 “동의”라고 답하세요. 바꾸고 싶으면 먼저 시험할 조작과 그 뒤 기대하는 결과를 적어 주세요.',
].join('\n\n');

const exampleEvidence = [
  '주문 관리 예제를 연습하기 위한 가상 기록입니다. 비교 대상은 수정 전 주문 화면과 예제 수정본 A입니다.',
  '첫 테스트 · 주문 목록에서 ‘배송 중’을 누르고 Tab을 누른 뒤 ‘배송 완료’에 포커스가 있는지, ORD-1002 한 행이 보이는지, ‘배송 중’에 선택 표시가 남는지 확인합니다.',
  '예제 RED · 수정 전 화면에서 같은 조작을 했을 때 포커스와 주문 행은 기대와 일치했습니다. 선택한 버튼에는 “배송 중”만 표시되어 “배송 중 (선택됨)”이라는 기대값에서 실패했습니다.',
  '예제 수정본 A · 수정 전에는 order-management.html의 renderOrders가 목록의 행만 갱신했습니다. 수정본은 목록을 그릴 때 현재 필터 값인 orderStatus를 읽어 주문 필터 영역 안의 버튼도 함께 갱신합니다. 값이 일치하는 버튼에 “(선택됨)”과 눌림 상태를 표시하고 나머지 주문 버튼은 원래 이름과 해제 상태로 표시합니다. 키보드 포커스는 브라우저의 기존 이동 순서를 따릅니다.',
  '예제 GREEN · 같은 테스트를 수정본 A에서 다시 실행한 기록입니다. “배송 중 (선택됨)” 버튼이 보이고 눌림 상태를 가지며, 포커스는 ‘배송 완료’에 있습니다. 남은 한 행의 번호는 ORD-1002입니다. 다른 필터와 창 크기별 결과는 기록에 없습니다.',
].join('\n\n');
const exampleRules = [
  '주문 예제에서 연습할 코딩 규칙',
  '주문 필터의 선택 상태는 기존 orderStatus에서 읽습니다. 버튼별로 별도 상태를 저장하지 않습니다.',
  '주문 필터를 고칠 때 버튼 갱신 범위는 #order-filters 안으로 한정합니다. 같은 모양의 반품 필터에도 영향을 주는지 검토하세요.',
].join('\n');

const evidenceInstruction = webDesignInstructions(
  '작업실에서는 연결된 자료의 출처를 표시하세요. 주문 예제의 RED·GREEN과 수정 전후 설명은 가상 기록입니다. 사용자가 다른 기준을 주면 해당 기준에 맞는 자료만 사용하고, 확인할 자료가 없는 항목은 미검증으로 남기세요.',
);
const scopeInstruction = '‘확정한 테스트 범위’ 회신이 동의나 예이면 원래 개선 기준을 그대로 사용하세요. 조작이나 기대 결과를 바꿨다면 그 부분에는 회신을 우선 적용하세요.';
const reviewInstruction = [
  evidenceInstruction,
  '대표 Agent가 Standards와 Spec을 이미 병렬로 배정했습니다. 이번 배정에서는 맡은 축만 검토해 반환하세요.',
  '개발 담당이 넘긴 비교 기준점, 동일한 최종 코드 차이와 테스트 기록을 검토하세요. 프로젝트에서 확인한 근거와 예제 기록의 출처를 구분하세요. 누락된 자료는 어느 판단에 필요한지 적으세요.',
].join('\n');

function tddReviewGraph() {
  const d = new Drawing('웹 화면 개선 기준과 테스트할 범위를 사용자에게 확인하고 테스트 주도 개발로 화면을 고친 다음 같은 변경을 코딩 규칙과 개선 기준 관점에서 병렬 검토합니다.');
  d.node('request', 'input.user_request', '중급에서 정한 개선 기준', 0, 2, {question});
  d.node('scope', 'input.form', '테스트 범위 확인', 1, 2, {prompt:scopePrompt, fields:['확정한 테스트 범위']});
  d.step('request', 'scope');
  d.node('developer', 'agent.delegate', 'TDD 개발 담당', 2, 2, {
    role:'TDD 개발 담당', projectWork:'tdd',
    instruction:[
      evidenceInstruction, scopeInstruction,
      '확정한 화면과 조작에서 사용자가 볼 결과 하나를 골라 그 기대값을 검증하는 테스트를 먼저 작성하세요. 수정 전 실행해 기대한 이유로 실패하는지 확인하고, 그 동작에 필요한 최소 변경 후 같은 테스트를 다시 실행하세요. 다른 동작도 한 번에 하나씩 진행하세요.',
      '실제 프로젝트에서는 대표 Agent가 확인한 수정 전 기준점과 같은 작업 사본의 최종 변경을 사용하세요. 두 검토자에게 전달할 기록에 기준점, 변경 파일과 테스트를 포함한 코드 차이, 실행 명령, 실패 이유와 재실행 결과를 함께 적으세요.',
      '작업실에서 예제 기록을 쓸 때는 “예제 수정본 A”처럼 자료의 이름으로 비교 대상을 식별하세요. 실제 실행할 수 없으면 제안하는 테스트·수정과 미검증 이유를 기록하세요.',
    ].join('\n'),
  });
  d.step('scope', 'developer');
  d.data('request', 'developer', 'question');
  d.node('record-development', 'data.transform', '개발·테스트 결과 기록', 3, 2, {operation:'rename', target:'TDD 개발 기록'});
  d.step('developer', 'record-development');
  d.node('review-material', 'data.transform', '테스트 범위와 변경 기록 모으기', 4, 2, {operation:'text'});
  d.order('record-development', 'review-material');
  d.data('scope', 'review-material');
  d.data('developer', 'review-material');
  d.node('split', 'control.parallel', '같은 변경을 두 관점으로 검토', 5, 2, {maxConcurrency:2, failurePolicy:'stop'});
  d.step('review-material', 'split');
  d.node('report', 'control.join', '개발 기록과 두 검토 결과 모으기', 8, 2, {merge:'sections', partialFailure:'fail'});
  d.data('record-development', 'report');

  const reviewers = [
    {id:'standards', role:'코딩 규칙 검토 담당', row:1, heading:'Standards · 코딩 규칙 검토',
      instruction:'저장소에서 적용되는 코딩 규칙을 찾아 각 규칙의 문서와 해당 변경 부분을 대조하세요. 작업실에서는 연결된 규칙과 변경 설명으로 판단 가능한 항목을 짚고, 원본 코드가 필요한 항목은 미검증으로 남기세요. 규칙 위반과 Skill이 제시하는 개선 의견을 구분하고 근거가 되는 규칙과 코드 위치를 짚으세요.'},
    {id:'spec', role:'개선 기준 검토 담당', row:3, heading:'Spec · 개선 기준 검토',
      instruction:scopeInstruction + '\n사용자가 직접 입력한 개선 기준과 회신을 이번 검토의 명세로 삼으세요. 각 기대 결과를 테스트·화면 변경과 대조해 충족, 누락·부분 충족, 잘못된 동작 또는 범위 밖 변경을 근거와 함께 적으세요. 자료가 없어 판단할 수 없는 항목을 표시하세요.'},
  ];
  for (const reviewer of reviewers) {
    d.node(reviewer.id, 'agent.delegate', reviewer.role, 6, reviewer.row, {
      role:reviewer.role, projectWork:'review-diff', instruction:reviewInstruction + '\n' + reviewer.instruction,
    });
    d.step('split', reviewer.id);
    const record = d.node('record-' + reviewer.id, 'data.transform', reviewer.heading, 7, reviewer.row, {operation:'rename', target:reviewer.heading});
    d.step(reviewer.id, record);
    d.step(record, 'report');
  }
  d.data('request', 'spec', 'question');
  d.node('answer', 'output.answer', '개선·검토 결과 전달', 9, 2);
  d.step('report', 'answer');
  d.doc('evidence', '주문 예제 변경·테스트 기록', exampleEvidence, 2, 0, 'developer');
  for (const role of ['standards', 'spec']) d.edge('evidence', role, 'reference', 'ref', 'context');
  d.doc('rules', '주문 예제 코딩 규칙', exampleRules, 3, 0, 'standards');
  d.edge('rules', 'developer', 'reference', 'ref', 'context');
  attachWebDesignSkill(d, 'tdd', 2, 3, 'developer');
  attachWebDesignSkill(d, 'code-review', 6, 2, 'standards', 'spec');
  return d.graph;
}

export const webDesignTddReviewTemplate: Lesson = {
  id:'web-design-tdd-review', title:'개선 기준을 테스트로 옮겨 화면 고치기', topic:'웹 디자인 개선', level:'고급',
  description:'중급에서 정한 개선 기준을 직접 입력하고 테스트할 동작을 확인합니다. TDD 개발 담당이 수정한 내용을 두 담당자가 코딩 규칙과 개선 기준에 따라 동시에 검토합니다.',
  goal:'사용자의 기대 결과가 실패 테스트, 화면 수정, 두 관점의 검토 결과로 어떻게 이어지는지 확인합니다.',
  task:'‘질문으로 화면 개선 기준 정하기’에서 만든 기준이나 아래 주문 예시를 입력하고, 테스트가 확인할 동작과 기대 결과를 정하세요.',
  question,
  sampleCase:{title:'포커스를 옮겨도 선택한 주문 필터 알아보기', expected:'범위를 확인한 뒤 주문 예제의 RED·GREEN과 변경 근거가 나옵니다. 코딩 규칙 검토와 개선 기준 검토의 결과를 각 제목 아래서 대조할 수 있습니다.'},
  steps:[
    '‘내 사본으로 시작’을 누른 뒤 ‘시험 실행’에서 중급의 최종 답변에 있는 개선 기준을 직접 붙여 넣으세요. 주문 화면으로 먼저 연습하려면 예시 질문을 보내세요.',
    '‘테스트 범위 확인’에서 먼저 시험할 조작과 화면 결과를 읽으세요. ‘확정한 테스트 범위’에 “동의” 또는 바꿀 조작과 기대 결과를 적고 ‘같은 실행 이어가기’를 누르세요.',
    '최종 답변에서 ‘TDD 개발 기록’의 실패 이유와 재실행 결과를 읽으세요. ‘Standards · 코딩 규칙 검토’와 ‘Spec · 개선 기준 검토’가 같은 변경에서 어떤 근거를 확인했는지 비교하세요.',
    '내 화면으로 연습하려면 두 참고 자료를 해당 프로젝트의 코딩 규칙, 변경 전후 차이와 테스트 기록으로 바꾸고 새 대화에 개선 기준을 입력하세요. 실제 파일을 고치려면 ‘Agent 내보내기’로 받은 Agent를 코딩 도구에서 열고 작업 폴더와 개선 기준을 알려 주세요.',
  ],
  skillSteps:['사본에서 ‘TDD 개발 담당’의 ‘적용되는 Skill’을 열어 tdd를 확인하세요. 두 검토 담당자는 code-review 하나를 함께 사용합니다. 각 블록의 지침에서 어느 관점을 맡았는지 읽으세요.'],
  checks:[
    '원래 입력과 범위 확인 답변에 따라 먼저 시험할 화면 동작과 기대값이 정해집니다.',
    '같은 테스트의 수정 전 실패 이유와 최소 변경 후 재실행 결과를 추적할 수 있습니다. 예제 기록과 실제 실행한 결과의 출처가 드러납니다.',
    '두 담당자가 같은 변경을 독립적으로 검토합니다. 규칙의 출처, 기준별 근거, 아직 확인할 수 없는 항목을 각 검토 결과에서 찾을 수 있습니다.',
  ],
  example:'“배송 중 (선택됨)”을 기대한 테스트가 기존 화면의 “배송 중”에서 실패합니다. 예제 수정본은 선택 표시를 기존 필터 상태에 맞춰 갱신합니다. 한 담당자는 이 변경이 상태 관리 규칙을 지키는지, 다른 담당자는 사용자가 요청한 Tab 동작까지 확인됐는지 검토합니다.',
  examples:['프로필 편집 화면에서 이름을 비운 뒤 저장하면 이름 입력란 아래에 “이름을 입력해 주세요”가 보이고 포커스가 이름 입력란으로 이동해야 합니다.'],
  graph:tddReviewGraph(),
};
