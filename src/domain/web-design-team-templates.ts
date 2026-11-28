import { Drawing } from './template-drawing';
import type { Lesson } from './types';
import { orderFilterSource, orderScreenNotes, returnFilterSource } from './web-design-example';
import { webDesignWorkInstruction } from './web-design-instructions';
import { attachWebDesignSkill, webDesignSkills } from './web-design-skills';

const sharedQuestion = '예제 주문 관리 앱의 주문과 반품 목록에서 적용한 필터를 알아보기 어렵습니다. 두 화면이 같은 필터 UI를 쓰도록 개선하고 기존 검색과 필터 해제를 확인해 주세요.';
const exampleEvidence = '주문 관리 예제를 지정한 요청에서만 예제 코드·관찰·후보판 기록을 사용하세요. 다른 프로젝트에서는 그 프로젝트에 대해 제공되거나 직접 확인한 자료에 근거하세요.';

function addExampleSources(d: Drawing, recipient: string) {
  d.doc('orders', '예제 주문 필터 코드', orderFilterSource, 0, 0, recipient);
  d.doc('returns', '예제 반품 필터 코드', returnFilterSource, 0, 2, recipient);
  d.doc('observations', '예제 화면과 재현 순서', orderScreenNotes, 1, 3, recipient);
}

function sharedUiGraph() {
  const d = new Drawing('기존 웹 프로젝트에서 여러 화면이 함께 쓰는 UI를 개선하고 각 화면의 기존 동작을 검증합니다.');
  d.node('request', 'input.user_request', '공통 UI 개선 요청', 0, 1, {question: sharedQuestion});
  d.node('developer', 'agent.delegate', '공통 UI 개발', 1, 1, {
    role: '공통 UI 개발자', projectWork: 'edit',
    instruction: [webDesignWorkInstruction, exampleEvidence,
      '요청한 화면들에서 함께 쓰는 컴포넌트의 구현과 호출 위치를 찾아 바꿀 동작과 화면별로 지켜야 할 기존 동작을 정하세요. 기존 디자인을 활용해 공통 구현과 필요한 호출부를 고치고 변경 위치·화면별 기대 결과를 검토자에게 넘기세요.',
      '예제에서는 .filter-button과 기존 포커스 스타일을 활용해 선택 상태를 표시하고, 주문·반품 각 목록의 검색과 필터 해제를 보존하세요.',
    ].join('\n'),
  });
  addExampleSources(d, 'developer');
  d.node('qa', 'agent.delegate', '두 화면의 회귀 검증', 2, 1, {
    role: '화면 검증 담당', projectWork: 'verify',
    instruction: [exampleEvidence,
      '원래 요청과 개발자가 넘긴 변경 위치·기대 결과를 읽으세요. 대상 화면마다 바뀐 조작과 유지해야 할 기존 조작을 하나씩 재현하세요.',
      '작업실에서는 제공된 관찰의 출처, 사용자가 직접 시험할 조작과 기대 결과를 적으세요. 실제 프로젝트에서는 Windows PC 브라우저의 1,280px와 1,440px 창에서 마우스와 키보드로 확인하고, 화면별 관찰과 확인하지 못한 조작을 구분하세요.',
      '주문 관리 예제에서는 배송 중 1건·접수 1건, 빈 결과와 전체 복구 순서를 각 목록에서 확인하세요.',
    ].join('\n'),
  });
  d.edge('observations', 'qa', 'reference', 'ref', 'context');
  attachWebDesignSkill(d, 'shared', 1, 0, 'developer');
  attachWebDesignSkill(d, 'verify', 2, 2, 'qa');
  attachWebDesignSkill(d, 'frontend-design', 2, 0, 'developer');
  attachWebDesignSkill(d, 'frontend-ui-engineering', 1, 2, 'developer', 'qa');
  d.data('request', 'qa', 'question');
  d.node('report', 'control.join', '변경 내용과 검증 결과 묶기', 3, 1, {merge: 'text', partialFailure: 'fail'});
  d.node('answer', 'output.answer', '공통 UI 결과 전달', 4, 1);
  d.step('request', 'developer');
  d.step('developer', 'qa');
  d.data('developer', 'report');
  d.step('qa', 'report');
  d.step('report', 'answer');
  return d.graph;
}

const rolloutQuestion = '예제 주문 관리 앱의 필터와 검색 결과 복구를 개편해 주세요. 영향을 받는 화면을 나누고 후보판의 검증 기록을 모아 어느 변경을 반영할지 판단하고 싶습니다.';
const candidateLog = [
  '반영 판단 연습용 후보판 A의 가상 검증 기록입니다. 내려받은 원본 예제와 실제 프로젝트의 실행 기록은 별도로 확인하세요.',
  '주문 목록 · Windows PC 1,280px · 주문 검색란이 빈 상태에서 배송 중을 누른 뒤 Tab과 Enter로 전체를 선택하자 주문 3건이 복구됐다.',
  '반품 목록 · Windows PC 1,440px · 반품 검색란이 빈 상태에서 접수를 누른 뒤 Tab과 Enter로 전체를 선택했지만 RET-2001 1건만 남았다. 기대값은 전체 2건이다.',
  '나머지 창 너비와 결과 0건에서의 복구는 기록이 없다.',
].join('\n');

function rolloutGraph() {
  const d = new Drawing('기존 웹 프로젝트의 개편 영향을 조사하고 개발·화면 검토를 분담해 변경별 반영 범위와 근거를 기록합니다.');
  d.node('request', 'input.user_request', '화면 개편 요청', 0, 1, {question: rolloutQuestion});
  d.node('impact', 'ai.single_task', '변경 영향과 담당 범위 조사', 1, 1, {
    goal: '개편 요청을 기준 화면, 연관 화면과 양쪽이 호출하는 공통 코드로 나눕니다.', projectWork: 'inspect',
    instruction: exampleEvidence + '\n원본 Skill에서 정보의 우선순위를 정하는 방법을 활용해 Windows PC 화면의 변경 영향을 조사하세요. 예제에서는 주문을 기준 화면, 반품을 연관 화면으로 삼으세요. 실제 프로젝트에서는 사용자가 지정한 화면에서 시작해 파일과 호출 관계를 조사하고 영향을 받는 화면 이름을 정하세요. ' +
      '각 화면의 기존 동작과 디자인, 바꿀 파일, 같은 변경을 함께 반영해야 하는 화면과 따로 반영할 수 있는 부분을 적으세요. 재현에 꼭 필요한 정보만 물으세요.',
  });
  addExampleSources(d, 'impact');
  d.node('developer', 'agent.delegate', '화면 개편 개발', 2, 1, {
    role: '화면 개편 개발자', projectWork: 'edit',
    instruction: [webDesignWorkInstruction, exampleEvidence,
      '영향 조사에서 지정한 공통 코드와 화면 연결부를 순서대로 개선하세요. 원래 요청에서 사용자가 겪는 문제와 기대한 조작, 디자인 방향을 각 변경에 연결하고 지켜야 할 화면별 동작을 정리하세요.',
      '실제 프로젝트에서는 검토할 후보 변경을 작업 폴더에 준비하세요. 게시와 배포는 이 실습의 작업 범위 밖입니다. 검토자가 재현할 수 있도록 기준 화면·연관 화면의 이름, 분담 범위, 변경할 코드와 서로 함께 반영해야 하는 부분을 넘기세요.',
    ].join('\n'),
  });
  for (const source of ['orders', 'returns', 'observations']) d.edge(source, 'developer', 'reference', 'ref', 'context');
  d.node('split', 'control.parallel', '기준 화면과 연관 화면 검토 나누기', 3, 1, {maxConcurrency: 2});
  d.node('summary', 'control.join', '영향·변경·검증 기록 모으기', 5, 1, {merge: 'text', partialFailure: 'fail'});
  d.step('request', 'impact');
  d.step('impact', 'developer');
  d.data('request', 'developer', 'question');
  d.step('developer', 'split');
  d.data('impact', 'summary');
  d.data('developer', 'summary');

  const review = exampleEvidence + '\n개발자가 넘긴 변경 내용과 화면 이름을 읽고 맡은 화면만 검토하세요. ' +
    '작업실에서 예제 후보판을 검토할 때는 연습용 기록의 창 너비, 조작, 관찰과 기대 행을 인용해 기록이 있는 동작과 추가로 시험할 동작을 구분하세요. ' +
    '실제 프로젝트에서는 예제 후보판 기록을 근거에서 제외하세요. 실제 변경을 Windows PC의 1,280px와 1,440px 창에서 마우스·키보드로 확인해 화면·너비·조작·관찰·결과를 기록하세요. ' +
    '사용자가 요청한 조작, 바뀐 결과와 이번 변경의 영향을 받는 기존 동작을 확인하고 미실행 이유를 남기세요. 실패한 동작과 공통 코드가 묶인 변경의 반영 여부를 제안하세요.';
  d.node('primary', 'agent.delegate', '기준 화면 검토', 4, 0, {
    role: '기준 화면 검토자', projectWork: 'verify', instruction: '기준 화면을 맡습니다. 예제의 담당 화면은 주문 목록입니다. ' + review,
  });
  d.node('related', 'agent.delegate', '연관 화면 검토', 4, 2, {
    role: '연관 화면 검토자', projectWork: 'verify', instruction: '연관 화면들을 맡습니다. 예제의 담당 화면은 반품 목록입니다. ' + review,
  });
  d.doc('qa-log', '예제 후보판 검증 기록', candidateLog, 3, 3, 'primary');
  d.edge('qa-log', 'related', 'reference', 'ref', 'context');
  attachWebDesignSkill(d, 'impact', 1, 0, 'impact');
  attachWebDesignSkill(d, 'shared', 2, 2, 'developer');
  attachWebDesignSkill(d, 'verify', 4, 3, 'primary', 'related');
  attachWebDesignSkill(d, 'frontend-design', 2, 0, 'impact', 'developer');
  attachWebDesignSkill(d, 'frontend-ui-engineering', 3, 2, 'developer', 'primary', 'related');
  for (const lane of ['primary', 'related']) {
    d.step('split', lane);
    d.data('request', lane, 'question');
    d.step(lane, 'summary');
  }
  d.node('decision', 'input.form', '반영 범위와 근거 정하기', 6, 1, {
    prompt: '{{input}}\n\n화면별 결과를 읽으세요. 반영할 변경과 보류할 변경을 나누고, 근거에 화면·관찰·남은 검증을 적어 주세요.',
    fields: ['반영 범위', '판단 근거'],
  });
  d.node('record', 'control.join', '검증 기록에 반영 판단 붙이기', 7, 1, {merge: 'sections'});
  d.node('answer', 'output.answer', '반영 판단 기록 전달', 8, 1);
  d.step('summary', 'decision');
  d.data('summary', 'record');
  d.step('decision', 'record');
  d.step('record', 'answer');
  return d.graph;
}

export const webDesignTeamTemplates: Lesson[] = [
  {
    id: 'web-design-shared-ui', title: '여러 화면의 공통 UI 개선하기', topic: '웹 디자인 개선', level: '고급',
    description: '주문·반품 목록에서 같은 방식으로 필터를 선택하고 해제하도록 공통 UI를 고칩니다.',
    goal: '두 화면에서 재사용할 필터를 만들고, 각 화면의 고유한 상태와 검색 동작을 지킵니다.',
    task: '공통 필터 변경 예시와 두 화면의 검증 순서를 대조하세요.',
    question: sharedQuestion,
    sampleCase: {title: '주문과 반품의 공통 필터', expected: '한 공통 UI의 변경과 두 화면의 적용 예시가 나옵니다. 배송 중·접수의 선택 표시, 키보드 해제 후 주문 3건·반품 2건 복구를 시험할 수 있습니다.'},
    skillSteps: [
      `사본에서 ‘${webDesignSkills.shared.title}’과 ‘${webDesignSkills.verify.title}’을 차례로 선택하세요. 블록 속성에서 각 지침을 읽고 ‘연결’에서 어느 담당자에게 전달되는지 확인하세요.`,
    ],
    steps: [
      '‘주문 관리 예제 내려받기’로 받은 HTML을 열어 주문 목록에서 ‘배송 중’, 반품 목록에서 ‘접수’를 눌러 보세요. 각 목록에 남은 행과 버튼 표시를 확인한 뒤 작업실에서 ‘내 사본으로 시작’을 누르세요.',
      '‘시험 실행’에서 예시 질문을 보내세요. ‘공통 UI 개발’ 결과에서 같은 UI를 두 목록이 각자의 상태값으로 호출하는 부분을 찾으세요.',
      '‘두 화면의 회귀 검증’에서 검색과 해제 후 기대하는 행을 읽으세요. 실제 프로젝트에 적용하려면 ‘Agent 내보내기’로 내려받은 Agent에 작업 폴더와 두 화면을 알려 주세요.',
    ],
    checks: [
      '기존 버튼과 포커스 스타일을 활용한 공통 필터가 화면별 상태값을 받고 현재 선택을 표시합니다.',
      '주문에서 배송 중을 선택하면 ORD-1002, 반품에서 접수를 선택하면 RET-2001이 보입니다. 검색란이 빈 상태에서 키보드로 전체를 선택하면 각각 3건·2건이 보입니다.',
      '작업실 답변에는 직접 확인할 조작이 있고, 실제 프로젝트에서는 두 PC 창 너비에서 확인한 화면별 결과를 읽을 수 있습니다.',
    ],
    example: '같은 필터 버튼에 주문은 ‘배송 중’, 반품은 ‘접수’를 전달합니다. 각 버튼의 선택 표시를 본 뒤 Tab과 Enter로 ‘전체’를 선택해 두 목록이 각자의 행을 복구하는지 확인하세요.',
    examples: [], graph: sharedUiGraph(),
  },
  {
    id: 'web-design-rollout', title: '여러 화면의 개편을 나눠 개발하고 검증하기', topic: '웹 디자인 개선', level: '전문가',
    description: '개편할 화면과 공통 코드의 관계를 조사한 뒤 개발과 검토를 나눠 맡기고, 화면별 근거로 반영 범위를 정합니다.',
    goal: '한 화면에서 잘 동작한 변경이 다른 화면에도 적용될 때, 두 화면의 기록을 근거로 반영할 부분을 결정합니다.',
    task: '예제 후보판 기록에서 기대한 행이 복구되지 않은 화면을 찾아 반영 범위와 그 이유를 남기세요.',
    question: rolloutQuestion,
    sampleCase: {title: '주문·반품 개편의 반영 판단', expected: '연습용 후보판 기록에서 주문은 1,280px에서 3건이 복구되고 반품은 1,440px에서 1건만 남습니다. 남은 시험과 사람이 정한 반영 범위가 결과에 함께 나옵니다.'},
    skillSteps: [
      `‘${webDesignSkills.impact.title}’에서 어떤 화면까지 조사하는지, ‘${webDesignSkills.shared.title}’에서 개발자가 고칠 부분을 읽으세요. ‘${webDesignSkills.verify.title}’의 ‘연결’에서 기준 화면과 연관 화면의 두 검토자가 같은 지침을 받는지 확인하세요.`,
    ],
    steps: [
      '‘주문 관리 예제 내려받기’로 받은 원본에서 주문과 반품 목록을 열어 보세요. ‘내 사본으로 시작’ 뒤 ‘예제 후보판 검증 기록’에서 개편한 후보판을 가정한 두 관찰을 읽으세요.',
      '‘시험 실행’에서 예시 질문을 보내세요. ‘변경 영향과 담당 범위 조사’에서 두 화면이 공유하는 부분을, ‘화면 개편 개발’에서 검토자에게 넘기는 변경 예시를 확인하세요.',
      '‘반영 범위와 근거 정하기’에서 주문과 반품의 창 너비, 해제 후 행 수, 아직 시험할 항목을 대조하세요. ‘반영 범위’와 ‘판단 근거’를 입력하고 ‘같은 실행 이어가기’를 누르세요.',
      '실제 개편에는 ‘Agent 내보내기’로 받은 Agent에 대상 프로젝트와 바꿀 화면을 알려 주세요. 판단할 때는 그 프로젝트에서 수집한 화면별 검증 결과를 사용하세요.',
    ],
    checks: [
      '개발자의 변경을 받은 두 검토자가 각각 기준 화면과 연관 화면의 조작, 관찰, 남은 검증을 기록합니다.',
      '작업실의 예제 기록에는 주문 전체 3건 복구와 반품 1건만 남는 문제가 있습니다. 다른 창 너비와 결과 0건에서의 복구는 직접 확인할 항목입니다.',
      '최종 결과에 화면별 근거, 반영하거나 보류할 변경과 그 이유가 함께 남습니다.',
    ],
    example: '공통 필터 반영을 보류합니다. 후보판 A의 주문은 전체 3건으로 돌아왔지만 반품은 2건 중 RET-2001만 남았습니다. 반품 해제를 고친 뒤 두 창 너비에서 빈 결과 복구까지 확인합니다.',
    examples: [], graph: rolloutGraph(),
  },
];
