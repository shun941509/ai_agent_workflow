import { Drawing } from './template-drawing';
import type { Lesson } from './types';
import { webDesignInstructions } from './web-design-instructions';
import { attachWebDesignSkill } from './web-design-skills';

const criterion = '주문 목록에서 ‘배송 중’을 누른 뒤 Shift+Tab으로 ‘전체’에 포커스를 옮겨 Enter를 누르면 주문 세 건이 다시 보이고 ‘전체’에만 선택 표시가 남아야 합니다.';
const standardsField = '코딩 규칙 검토 결과';
const specField = '개선 기준 검토 결과';
const scopeField = '확정한 테스트 범위';
const standardFinding = '규칙 1 · 선택 표시를 주문 필터 값과 별도로 보관합니다.';
const specFinding = '기준 1 · 전체로 복구해도 배송 중에 선택 표시가 남습니다.';
const scopePrompt = [
  '고급에서 사용한 개선 기준\n{{input}}',
  '고급 예제의 Standards와 Spec 결과를 각각 해당 항목에 붙여 넣으세요. 지적이 없다고 확인한 축은 “지적 없음”이라고 적으세요. 검토를 받지 못했거나 자료가 부족한 축은 “미검증”과 이유를 적으세요.',
  '테스트할 범위는 Windows PC 브라우저에서 입력한 조작을 수행한 뒤 관찰할 수 있는 화면 결과입니다. 서버 내부 동작은 이 범위에서 확인할 수 없습니다. 이 범위라면 “동의”, 바꾸려면 먼저 확인할 조작과 기대 결과를 적으세요.',
  '주문 예제로 연습할 때 사용할 회신\n' + standardFinding + '\n' + specFinding + '\n동의',
].join('\n\n');

const evidence = [
  '주문 목록에 대한 가상 재검증 기록입니다. 고급 예제에서 다른 결과를 얻었다면 직접 입력한 지적과 그 작업 사본의 기록을 사용하세요.',
  '재검토 기준점은 주문 예제 A입니다. A에서는 배송 중을 누르면 주문 한 건이 남고 버튼에 선택 표시가 생깁니다. 전체로 되돌릴 때에는 목록만 세 건으로 돌아갑니다. 선택 표시를 계산하는 별도 값에는 배송 중이 남아 있습니다.',
  '예제 실패 · 배송 중을 클릭하고 Shift+Tab으로 전체에 포커스를 옮겨 Enter를 눌렀습니다. 테스트는 세 행과 전체 버튼에만 있는 선택 표시를 기대했습니다. 세 행은 보였지만 배송 중에 표시가 남아 마지막 검사에서 실패했습니다.',
  '예제 수정본 B · 주문 행을 갱신할 때 읽는 상태 값으로 선택 표시도 갱신합니다. 선택 표시를 따로 저장하던 변수를 없애고 그 값을 쓰던 주문 버튼 갱신 부분을 고쳤습니다.',
  '예제 재실행 · A에서 실패한 테스트를 B에서 다시 실행해 세 행과 전체 버튼의 선택 표시를 확인했습니다. 배송 중 버튼의 선택 표시는 해제됐습니다. 이 기록에 다른 화면이나 창 너비별 관찰은 없습니다.',
].join('\n\n');
const rules = '주문 예제 코딩 규칙 · 목록의 행과 주문 필터 버튼의 선택 표시는 현재 주문 필터 값에서 구합니다. 선택 표시를 위한 별도 상태를 저장하지 않습니다. 변경은 주문 필터에 적용합니다.';
const evidenceInstruction = webDesignInstructions(
  '작업실에서는 참고 자료로 확인되는 항목마다 자료 이름을 적으세요. 주문 예제 A와 B는 연습용 가상 기록입니다. 사용자 프로젝트의 지적에는 그 프로젝트의 근거를 사용하세요. 빠진 근거는 미검증으로 남기세요.',
);

function reviewFollowupGraph() {
  const d = new Drawing('고급 예제의 코딩 규칙·개선 기준 검토에서 지적된 웹 화면 문제를 수정하고, 원래 지적별로 해결 여부를 재검토합니다.');
  d.node('request', 'input.user_request', '고급에서 사용한 개선 기준', 0, 2, {question:criterion});
  d.node('scope', 'input.form', '검토 결과와 테스트 범위 확인', 1, 2, {prompt:scopePrompt, fields:[standardsField,specField,scopeField]});
  d.step('request', 'scope');

  // Match the whole field. A report can say “지적 0건” and still list an unverified item.
  const noFindings = ['지적 없음', '0건', '지적 0건'];
  for (const [index, value] of noFindings.entries()) {
    for (const [axis, field, row] of [['rule',standardsField,1],['criterion',specField,3]] as const) {
      const id = axis + '-' + index;
      d.node(id, 'control.branch', field + '가 ‘' + value + '’인가요?', index + 2, row, {
        path:field, operator:'equals', expected:value, yesLabel:'일치', noLabel:'다른 결과',
      });
      d.data('scope', id);
      if (index === 0 && axis === 'rule') d.order('scope', id);
      if (index > 0) d.order(axis + '-' + (index - 1), id, 'no');
      d.order(id, axis === 'rule' ? 'criterion-0' : 'no-findings', 'yes');
      if (index === noFindings.length - 1) d.order(id, 'developer', 'no');
    }
  }
  d.node('no-findings', 'control.terminate', '두 검토 모두 지적 없음', 5, 4, {
    status:'success', message:'코딩 규칙 검토와 개선 기준 검토 모두 지적 없음으로 확인했습니다. 수정 및 재검토할 항목은 0건입니다.',
  });
  d.node('developer', 'agent.delegate', 'TDD 수정 담당', 5, 2, {
    role:'TDD 수정 담당', projectWork:'tdd',
    instruction:[
      evidenceInstruction,
      '고급의 두 검토 결과에서 항목마다 원래 축과 번호 또는 원문 첫 구절을 남기세요. 사용자가 확정한 테스트 범위가 “동의”이면 처음 입력한 기준의 조작과 기대 결과를 사용하세요. 범위를 구체화한 회신도 원래 기준과 함께 보존하세요.',
      '실제 수정 항목, 자료 부족, 보류, 이미 해결된 항목을 구별하세요. 어느 한 축에 지적이 없으면 다른 축의 지적만 다루세요. 두 보고서가 자유 서술로 모두 지적이 없다고 하면 수정할 항목 0건으로 기록하세요. 미검증·보류만 있으면 필요한 근거를 기록하세요. 이 경우 파일을 수정하거나 시험 결과를 만들어 내지 마세요.',
      '수정 전 고급 검토가 가리킨 판을 확인하고 현재 작업 사본의 기준점을 기록하세요. 동작 결함마다 기존 회귀 테스트를 먼저 재현하고, 해당 검사가 없으면 확인받은 화면 조작을 검사하는 테스트 하나를 작성하세요. 기대 동작과 다른 이유로 실패했는지 확인한 뒤 필요한 부분만 고치고 같은 테스트를 재실행하세요.',
      '코딩 규칙만 고치는 항목은 현재 동작 검사를 수정 전후에 실행하고 해당 규칙과 변경을 직접 대조하세요. 규칙 정리 때문에 동작 실패를 만들지 마세요. 이미 통과한 동작과 실행하지 못한 검사를 구분하세요.',
      '각 지적 옆에 적용한 조치, 그 결과, 실행 명령과 관찰 또는 빠진 근거를 적으세요. 재검토 자료에 수정 전 기준점과 최종판, 이번 코드·테스트 차이, 수정 전후의 기록을 한 번 고정해 두 담당자에게 넘기세요.',
    ].join('\n'),
  });
  d.data('scope', 'developer');
  d.data('request', 'developer', 'question');
  d.node('development-record', 'data.transform', '지적별 수정 기록', 6, 2, {operation:'rename', target:'TDD 수정 기록'});
  d.step('developer', 'development-record');
  d.node('packet', 'data.transform', '원래 기준·지적과 수정 기록 모으기', 7, 2, {operation:'text'});
  d.order('development-record', 'packet');
  for (const id of ['request','scope','developer']) d.data(id, 'packet');
  d.node('split', 'control.parallel', '같은 수정본 병렬 재검토', 8, 2, {maxConcurrency:2, failurePolicy:'stop'});
  d.step('packet', 'split');
  d.node('report', 'control.join', '두 축의 재검토 결과 모으기', 11, 2, {merge:'sections', partialFailure:'fail'});
  d.data('development-record', 'report');
  const reviewers = [
    {id:'standards', role:'코딩 규칙 재검토 담당', row:1, heading:'Standards · 코딩 규칙 재검토',
      instruction:'고급의 코딩 규칙 지적마다 해당 저장소의 규칙 문서와 수정 전후의 파일 위치 또는 예제 설명을 대조하세요. 문서화된 규칙 위반과 설계 개선 의견을 구분하세요.'},
    {id:'spec', role:'개선 기준 재검토 담당', row:3, heading:'Spec · 개선 기준 재검토',
      instruction:'고급의 개선 기준 지적마다 원래 기준의 문구와 회신에서 확인된 조작을 찾아 수정 후 실제 관찰값과 대조하세요. 부분 충족, 잘못된 동작, 요청 밖의 변경을 살피세요.'},
  ];
  for (const r of reviewers) {
    d.node(r.id, 'agent.delegate', r.role, 9, r.row, {
      role:r.role, projectWork:'review-diff',
      instruction:[evidenceInstruction,
        '두 검토 역할은 대표 Agent가 병렬로 배정했습니다. 받은 동일한 기준점·최종판·코드 차이와 테스트 기록을 읽고 맡은 축을 검토하세요.',
        r.instruction,
        '원래 지적의 번호나 구절을 보존하고 “해결”, “남음”, “미검증” 중 하나와 근거를 적으세요. 보류한 지적의 이유와 다음에 확인할 내용을 남기세요. 원래 지적이 없던 축은 그 사실을 적고 새로 발견한 문제는 신규 지적으로 표시하세요. 두 축 모두 지적이 없고 이번 수정도 없으면 재검토할 변경 0건으로 기록하세요. 미제출된 리뷰나 실행 기록은 미검증으로 표시하세요.',
      ].join('\n'),
    });
    d.step('split', r.id);
    const record = d.node('record-' + r.id, 'data.transform', r.heading, 10, r.row, {operation:'rename', target:r.heading});
    d.step(r.id, record);
    d.step(record, 'report');
  }
  d.node('answer', 'output.answer', '지적별 재검증 결과 전달', 12, 2);
  d.step('report', 'answer');
  d.doc('evidence', '주문 예제 재검증 기록', evidence, 6, 0, 'developer');
  for (const id of ['standards','spec']) d.edge('evidence', id, 'reference', 'ref', 'context');
  d.doc('rules', '주문 예제 코딩 규칙', rules, 7, 0, 'standards');
  d.edge('rules', 'developer', 'reference', 'ref', 'context');
  attachWebDesignSkill(d, 'tdd', 5, 3, 'developer');
  attachWebDesignSkill(d, 'code-review', 9, 2, 'standards', 'spec');
  return d.graph;
}

export const webDesignReviewFollowupTemplate: Lesson = {
  id:'web-design-review-followup', title:'리뷰 지적을 고치고 다시 검증하기', topic:'웹 디자인 개선', level:'전문가',
  description:'고급 예제의 두 검토 결과를 가져와 지적된 부분을 고칩니다. 같은 수정본을 다시 검토해 각 지적의 해결 여부와 근거를 확인합니다.',
  goal:'이전 검토가 지적한 문제를 수정 전후 관찰로 추적하고, 여전히 남은 문제와 더 필요한 근거를 찾습니다.',
  task:'고급 예제의 원래 개선 기준을 질문으로 보내고, 두 검토 결과와 이번 테스트 범위를 양식에 입력하세요.',
  question:criterion,
  sampleCase:{title:'전체로 돌아와도 배송 중 표시가 남는 경우', expected:'규칙 1과 기준 1이 같은 수정본에서 어떻게 해결됐는지 두 재검토 결과에 근거가 표시됩니다.'},
  steps:[
    '실습 상세에서 ‘리뷰 지적이 남은 주문 예제 내려받기’를 눌러 브라우저에서 여세요. ‘배송 중’을 클릭하고 Shift+Tab으로 ‘전체’에 이동해 Enter를 누른 뒤 행 수와 선택 표시를 확인하세요. ‘내 사본으로 시작’ 후 ‘시험 실행’에 고급의 원래 개선 기준을 직접 입력하거나 주문 예시 질문을 보내세요.',
    '‘검토 결과와 테스트 범위 확인’에서 고급 최종 답변의 두 검토 결과를 해당 칸에 붙여 넣으세요. 주문 실습은 양식에 나온 예시 지적 두 개를 사용하세요. 결과가 0건인 축은 “지적 없음”, 자료가 없는 축은 “미검증”과 이유를 적으세요. 테스트 범위를 확인한 뒤 ‘같은 실행 이어가기’를 누르세요.',
    '‘TDD 수정 기록’에서 지적의 원문과 수정 전후 결과를 대조하세요. 두 재검토 제목 아래에서 해결·남음·미검증의 근거를 확인하세요. 남은 항목은 원래 개선 기준과 이번 두 검토 결과로 새 대화에서 이어서 확인할 수 있습니다.',
    '실제 예제를 수정하려면 내려받은 주문 HTML을 작업 폴더에 두고 ‘Agent 내보내기’로 받은 ZIP을 풀어 코딩 도구에서 여세요. Agent에 작업 폴더와 실습 지적을 알려 주세요. 내 프로젝트에서는 고급에서 검토한 판과 두 검토 결과를 전달하세요. 작업실에서 연습할 때는 두 참고 자료를 해당 프로젝트의 규칙과 재검증 기록으로 바꾸세요.',
  ],
  skillSteps:['‘TDD 수정 담당’의 tdd와 두 재검토 담당자의 code-review를 열어, 같은 변경을 각 역할이 어떤 근거로 검증하는지 확인하세요.'],
  checks:[
    '원래 지적이 어느 검토에서 나왔고 무엇을 확인할지 추적할 수 있습니다. 두 축 모두 지적이 없으면 수정 없이 종료합니다.',
    '동작 결함은 같은 테스트의 실패와 재실행 결과로, 코딩 규칙 지적은 규칙과 수정 전후의 근거로 확인합니다.',
    '두 검토자가 같은 변경을 독립적으로 읽고 원래 지적별 상태와 근거를 반환합니다.',
  ],
  example:'주문 예제에서는 전체를 다시 선택한 뒤 보이는 세 행과 버튼 표시를 함께 검사합니다. 규칙 1은 별도로 저장하던 값의 제거를, 기준 1은 전체 버튼에만 선택 표시가 남는지를 근거로 재검토합니다.',
  examples:['프로필에서 이름을 비우고 저장하면 입력란에 오류가 표시되고 포커스가 이름 입력란으로 돌아와야 합니다.'],
  graph:reviewFollowupGraph(),
};
