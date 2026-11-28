import { Drawing } from './template-drawing';
import type { Lesson } from './types';
import { orderFilterSource, orderScreenNotes } from './web-design-example';
import { webDesignWorkInstruction } from './web-design-instructions';
import { attachWebDesignSkill } from './web-design-skills';

const diagnosisQuestion = '주문 목록에서 ‘배송 중’을 누르면 목록이 달라지는데 무엇이 적용됐는지 모르겠어요. 무엇을 먼저 고치면 좋을까요?';
const componentQuestion = '주문 목록에서 적용 중인 상태 필터가 보이게 하고, 키보드로 필터를 해제해 전체 주문을 다시 볼 수 있게 해 주세요.';
const flowQuestion = '주문 목록에서 ‘배송 중’을 선택하고 ‘없는상품’을 검색하면 표가 비어요. 결과가 없다는 걸 알리고 전체 주문으로 돌아가게 해 주세요.';

function diagnosisGraph() {
  const d = new Drawing('기존 웹 프로젝트의 한 화면에서 사용자 조작과 관찰 근거를 대조해 먼저 개선할 한 가지를 진단합니다.');
  d.node('input', 'input.user_request', '불편한 화면 설명', 0, 0, {question: diagnosisQuestion});
  d.node('diagnose', 'ai.single_task', '화면 불편 진단', 1, 0, {
    projectWork: 'inspect',
    goal: '사용자가 막힌 조작을 짚고 먼저 개선할 한 가지와 이유를 설명합니다.',
    instruction: [
      webDesignWorkInstruction,
      '이 단계의 산출물은 한 화면의 진단입니다. 코딩 도구에서는 대표 Agent가 실제 대상 화면에서 확인한 근거를 사용해 진단을 전달하세요.',
      '사용자의 조작, 그 뒤 화면에 나타난 변화, 여전히 알기 어려운 점을 근거와 함께 설명하세요. 우선 개선 한 가지와 그것이 이 조작에 도움이 되는 이유를 적으세요.',
    ].join('\n'),
    criterion: '사용자가 문제를 재현할 수 있고, 왜 그 지점을 먼저 개선하는지 이해할 수 있습니다.',
  });
  d.doc('observations', '주문 예제 관찰 기록', orderScreenNotes, 1, 1, 'diagnose');
  attachWebDesignSkill(d, 'diagnose', 0, 1, 'diagnose');
  attachWebDesignSkill(d, 'frontend-design', 2, 1, 'diagnose');
  d.node('answer', 'output.answer', '진단 전달', 2, 0);
  d.step('input', 'diagnose');
  d.step('diagnose', 'answer');
  return d.graph;
}

function componentGraph() {
  const d = new Drawing('기존 웹 프로젝트에서 사용자가 지정한 한 컴포넌트의 디자인이나 동작을 개선하고 변경 결과를 검증합니다.');
  d.node('input', 'input.user_request', '컴포넌트 개선 요청', 0, 0, {question: componentQuestion});
  d.node('component', 'ai.single_task', '대상 컴포넌트 개선', 1, 0, {
    projectWork: 'edit-and-verify',
    goal: '한 컴포넌트에서 사용자가 겪은 문제를 해결하고, 요청한 동작을 확인할 수 있게 합니다.',
    instruction: [
      webDesignWorkInstruction,
      '대상 컴포넌트의 기존 구성과 스타일을 읽고 요청한 조작이나 표시를 개선하세요. 현재 동작을 보여 주는 코드와 변경한 부분을 짝지으세요.',
      '실제 대상의 화면 이름, 조작, 기대 결과로 확인 절차를 작성하세요. 마우스나 키보드로 상태가 바뀔 때 사용자가 결과와 포커스를 알아볼 수 있는지 점검하세요.',
    ].join('\n'),
    criterion: '대상 컴포넌트에서 무엇을 바꿨으며 어떤 조작으로 개선을 확인할 수 있는지 알 수 있습니다.',
  });
  d.doc('source', '주문 예제 필터 소스', orderFilterSource, 0, 1, 'component');
  d.doc('observations', '주문 예제 관찰 기록', [
    orderScreenNotes,
    '이 예제의 개선 기준: 기존 상태 버튼과 renderOrders를 활용합니다. ‘배송 중’을 누르면 선택 표시와 ORD-1002가 보이고, Shift+Tab으로 ‘전체’에 이동해 Enter를 누르면 선택 표시가 옮겨가고 주문 3건이 돌아와야 합니다.',
  ].join('\n'), 1, 1, 'component');
  attachWebDesignSkill(d, 'component', 2, 1, 'component');
  attachWebDesignSkill(d, 'frontend-ui-engineering', 1, 2, 'component');
  d.node('file', 'file.create', '컴포넌트 개선 기록 만들기', 2, 0, {fileName: '컴포넌트-개선.md', format: 'markdown'});
  d.node('answer', 'output.answer', '컴포넌트 개선 기록 전달', 3, 0);
  d.step('input', 'component');
  d.step('component', 'file');
  d.step('file', 'answer');
  return d.graph;
}

function flowGraph() {
  const d = new Drawing('기존 웹 프로젝트에서 사용자가 한 작업을 시작해 마칠 때까지의 화면과 조작을 개선하고 검증합니다.');
  d.node('input', 'input.user_request', '작업 흐름 개선 요청', 0, 0, {question: flowQuestion});
  d.node('route', 'ai.classify', '재현 정보 확인', 1, 0, {
    categories: ['재현 가능'],
    instruction: '대상 화면, 사용자가 한 조작, 그 뒤 관찰한 현상으로 어느 작업을 어떻게 재현할지 알 수 있으면 ‘재현 가능’입니다. 이 세 가지 중 재현에 꼭 필요한 정보가 빠졌을 때만 null을 반환하세요.',
  });
  d.node('ask', 'input.form', '빠진 재현 정보 묻기', 2, 1, {
    prompt: '어느 화면에서 무엇을 했고 그 뒤 무엇이 보이거나 일어났나요? 이미 알려 주신 내용을 제외하고 빠진 부분만 적어 주세요.',
  });
  d.node('details', 'data.transform', '요청과 회신 모으기', 3, 0, {operation: 'text'});
  d.node('flow', 'ai.single_task', '작업 흐름 개선', 4, 0, {
    projectWork: 'edit-and-verify',
    goal: '사용자가 막힌 지점을 지나 원래 하려던 작업을 마칠 수 있게 합니다.',
    instruction: [
      webDesignWorkInstruction,
      '요청과 회신에서 대상 작업의 시작, 막힌 조작, 도달하려는 결과를 찾으세요. 해당 프로젝트의 원문과 사용자가 관찰한 동작을 근거로 흐름에 필요한 코드 변경을 정리하세요.',
      '대상 화면에서 원래 작업을 끝내는 경로와 문제 상황에서 이어 가는 경로를 마우스와 키보드로 확인하세요. 각 단계에서 무엇을 하면 어떤 결과가 보여야 하는지 적으세요. 회신 뒤에도 필수 정보가 빠지면 어떤 관찰이 더 필요한지 밝히세요.',
    ].join('\n'),
    criterion: '사용자가 실제 화면에서 문제 상황을 재현하고 개선된 흐름을 따라 작업을 완료할 수 있는지 조작과 예상 결과로 확인합니다.',
  });
  d.doc('source', '주문 예제 필터 소스', orderFilterSource, 3, 2, 'flow');
  d.doc('observations', '주문 예제 관찰 기록', [
    orderScreenNotes,
    '이 예제의 개선 기준: ‘배송 중’과 ‘없는상품’을 함께 적용한 결과가 0건이면 현재 조건을 안내합니다. 키보드로 검색어와 상태를 함께 해제하면 원래 주문 3건이 돌아와야 합니다. 일반 검색과 단일 상태 필터도 확인하세요.',
  ].join('\n'), 4, 1, 'flow');
  attachWebDesignSkill(d, 'flow', 3, 1, 'flow');
  attachWebDesignSkill(d, 'frontend-ui-engineering', 4, 2, 'flow');
  d.node('answer', 'output.answer', '흐름 개선 결과 전달', 5, 0);
  d.step('input', 'route');
  d.order('route', 'details', 'category:재현 가능');
  d.order('route', 'ask', 'other');
  d.data('input', 'details');
  d.step('ask', 'details');
  d.step('details', 'flow');
  d.step('flow', 'answer');
  return d.graph;
}

export const webDesignStarterTemplates: Lesson[] = [
  {
    id: 'web-design-diagnose', title: '한 화면에서 불편한 점 찾기', level: '입문', topic: '웹 디자인 개선',
    description: '주문 목록에서 배송 상태를 고른 사용자가 무엇을 알기 어려운지 살펴봅니다.',
    goal: '화면에서 바뀐 것과 사용자가 놓치는 단서를 찾고, 한 가지 개선에 우선순위를 줍니다.',
    task: '‘배송 중’을 누르기 전후를 비교하고 Agent의 진단에서 그 변화의 근거를 찾아보세요.',
    question: diagnosisQuestion,
    skillSteps: [
      '‘화면 진단 Skill’에서 ‘SKILL.md 지침’을 열어 조작 전후를 비교하는 방법을 읽으세요. ‘화면 불편 진단’이 그 방법을 답변 어디에 적용했는지 찾아보세요.',
    ],
    steps: [
      '‘주문 관리 예제 내려받기’로 받은 HTML을 브라우저에서 열고 주문 목록의 ‘배송 중’을 누르세요. 주문 행과 필터 버튼에서 무엇이 달라졌는지 살펴보세요.',
      '‘내 사본으로 시작’을 누르고 ‘주문 예제 관찰 기록’의 원문을 읽으세요. ‘시험 실행’에서 예시 질문을 보내세요.',
      '답변에서 어떤 조작이 불편한지, 무엇을 먼저 고칠지, 왜 그 변경이 필요한지 찾아 직접 본 화면과 대조하세요.',
      '내 프로젝트를 진단하려면 ‘Agent 내보내기’로 받은 지침을 코딩 도구에서 열고 대상 폴더, 화면, 불편한 조작을 알려 주세요.',
    ],
    checks: ['‘배송 중’을 누른 뒤 주문 행이 줄어드는 변화와 선택 상태를 알아보기 어려운 이유를 설명합니다.', '먼저 고칠 한 가지와 그 이유가 관찰 기록에 연결됩니다.'],
    sampleCase: {title: '배송 중 필터를 누른 뒤', expected: '배송 중 주문만 남은 결과와 현재 선택을 알려 주는 단서가 부족한 점을 구분하고 우선 개선 한 가지를 제안합니다.'},
    example: '‘배송 중’을 누르면 ORD-1002만 남습니다. 다른 상태 버튼과 구별되는 선택 표시를 추가하면 목록이 왜 줄었는지 바로 알 수 있습니다.',
    examples: [], graph: diagnosisGraph(),
  },
  {
    id: 'web-design-component', title: '한 컴포넌트의 디자인 고치기', level: '초급', topic: '웹 디자인 개선',
    description: '주문 상태 버튼에 선택 표시를 더하고 키보드로 전체 주문을 다시 보는 방법을 다룹니다.',
    goal: '다른 화면까지 고치지 않고 기존 필터 하나의 표시와 조작을 개선합니다.',
    task: '현재 버튼 코드를 확인한 뒤 배송 상태 선택과 해제를 위한 코드 변경 예시를 받아 보세요.',
    question: componentQuestion,
    skillSteps: [
      '편집기에서 ‘컴포넌트 개선 Skill’을 선택하고 ‘SKILL.md 지침’ 끝에 “선택 상태를 색과 글자로 함께 표시한다”를 추가하세요. 저장 후 ‘시험 실행 → 실행 기록 → ＋ 새 대화’에서 현재 초안에 같은 질문을 보내고, 두 코드 예시에서 선택 상태에 어떤 글자를 표시하는지 비교하세요.',
    ],
    steps: [
      '‘주문 관리 예제 내려받기’로 받은 HTML을 열어 ‘배송 중’을 누르고, 키보드로 ‘전체’를 선택해 두 목록을 비교하세요.',
      '‘내 사본으로 시작’을 눌러 ‘주문 예제 필터 소스’와 ‘주문 예제 관찰 기록’을 읽으세요. ‘시험 실행’에서 예시 질문을 보내세요.',
      '‘컴포넌트-개선.md 내려받기’를 누르세요. 기존 버튼을 어디서 고치는지, 선택 상태를 어떻게 알리는지, 키보드로 해제하면 어떤 행이 돌아오는지 찾으세요.',
      '실제 소스를 고치려면 ‘Agent 내보내기’로 받은 지침을 코딩 도구에서 열고 대상 프로젝트와 컴포넌트를 지정하세요. 수정 후 두 PC 창 너비에서 요청한 조작과 결과를 확인하세요.',
    ],
    checks: ['변경 예시가 기존 상태 버튼에 적용되고 색상 외에도 선택을 구분할 수 있습니다.', '‘배송 중’ 선택 뒤에는 ORD-1002가 남고, 키보드로 ‘전체’를 선택하면 원래 주문 3건으로 돌아오는지 확인할 수 있습니다.'],
    sampleCase: {title: '선택한 배송 상태 표시와 해제', expected: '기존 필터의 선택 상태를 표시하는 코드, 키보드 해제 방법, 배송 중 1건과 전체 3건의 확인 순서를 개선 기록에서 읽을 수 있습니다.'},
    example: '선택한 버튼의 aria-pressed를 true로 바꾸고 텍스트 옆에 선택 표시를 둡니다. ‘전체’에 포커스를 옮겨 Enter를 눌렀을 때 선택 표시가 옮겨가고 주문 3건이 돌아오는지 확인합니다.',
    examples: [], graph: componentGraph(),
  },
  {
    id: 'web-design-flow', title: '한 작업을 처음부터 끝까지 개선하기', level: '중급', topic: '웹 디자인 개선',
    description: '주문 목록을 검색하고 결과가 비었을 때 다시 전체 주문으로 돌아오는 흐름을 개선합니다.',
    goal: '현재 조건과 빈 결과의 이유를 알리고, 사용자가 목록을 복구해 하던 작업을 이어가게 합니다.',
    task: '같은 빈 목록 문제를 자세히 설명한 요청과 재현 정보가 빠진 요청으로 각각 시험해 보세요.',
    question: flowQuestion,
    skillSteps: [
      '‘사용 흐름 개선 Skill’의 ‘SKILL.md 지침’을 읽고, ‘작업 흐름 개선’의 답변에서 정상 경로와 문제가 생겼을 때 이어 가는 경로를 각각 짚어 보세요.',
    ],
    steps: [
      '‘주문 관리 예제 내려받기’로 받은 HTML을 열고 ‘배송 중’을 선택하세요. ‘주문 검색’에 ‘없는상품’을 입력해 빈 표를 확인하세요. 검색어를 지우고 ‘전체’를 선택해 원래 목록으로 돌아오세요.',
      '‘내 사본으로 시작 → 시험 실행’에서 예시 질문을 보내세요. 답변에서 필터 선택 뒤의 목록, 검색 결과가 없을 때의 안내, 복구 조작과 기대 결과를 찾아보세요.',
      '새 대화에서 “필터를 쓰다 막혔어요.”를 보내세요. ‘빠진 재현 정보 묻기’에 “주문 목록에서 배송 중을 누르고 없는상품을 검색하면 표가 비어요.”라고 회신하고 ‘같은 실행 이어가기’를 누르세요.',
      '실제 흐름을 고치려면 ‘Agent 내보내기’로 받은 지침을 코딩 도구에서 열고 프로젝트와 재현 순서를 알려 주세요. 두 창 너비에서 원래 하려던 작업을 마칠 수 있는지 확인하세요.',
    ],
    checks: ['대상 화면과 재현 순서가 있으면 바로 개선안을 작성하고, 정보가 빠지면 같은 실행에서 보충합니다.', '‘배송 중’ 1건 → 검색 결과 0건 → 조건을 해제한 전체 3건이 연결되고 키보드 복구 방법이 있습니다.'],
    sampleCase: {title: '빈 주문 목록에서 원래 작업으로 복귀', expected: '재현 정보를 바로 사용해 빈 결과 안내와 복구 코드 예시를 제시합니다. 배송 중 1건, 없는상품 검색 0건, 모든 조건 해제 후 3건을 사용자가 시험할 수 있습니다.'},
    example: '‘배송 중’에는 ORD-1002 한 건이 있습니다. ‘없는상품’ 검색으로 목록이 비면 적용된 조건을 보여 주고, ‘모든 조건 해제’를 키보드로 실행해 검색어와 상태를 함께 초기화하면 전체 주문 3건이 돌아옵니다.',
    examples: ['필터를 쓰다 막혔어요.'], graph: flowGraph(),
  },
];
