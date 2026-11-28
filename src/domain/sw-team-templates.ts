import { Drawing } from './template-drawing';
import type { Graph, Lesson } from './types';

const originalReport = '할 일이 사라졌어요';
const restoredReply = '우유 사기를 완료로 표시했어요. 완료 항목 숨기기를 끄니 다시 보여요.';
const missingReply = '우유 사기를 완료로 표시했어요. 완료 항목 숨기기를 껐는데도 여전히 안 보여요.';
const filterRule = '‘완료 항목 숨기기’를 켜면 미완료 항목만 표시합니다. 끄면 완료 항목과 미완료 항목을 모두 표시합니다.';
const reviewQuestion = '완료 항목 숨기기 변경을 검토해 주세요. 고쳐야 할 코드와 그 수정을 확인할 시험 사례를 함께 알려 주세요.';

const filterCode = [
  '// src/todos.ts',
  'type Todo = { title: string; completed: boolean };',
  '',
  'export function visibleTodos(todos: Todo[], hideCompleted: boolean): Todo[] {',
  '  return hideCompleted ? todos.filter(todo => todo.completed) : todos;',
  '}',
].join('\n');
const filterTests = [
  filterRule,
  '예시 목록에는 ‘우유 사기’(완료)와 ‘책 반납’(미완료)이 이 순서로 있습니다.',
  '기존 시험 기록 · 숨기기 끔에서 두 항목이 모두 표시되어 통과로 기록했습니다.',
  '숨기기 켬에 대한 기존 시험 기록은 없습니다.',
].join('\n');

function bugTriage(): Graph {
  const d = new Drawing('할 일 앱에서 항목이 사라졌다는 오류 제보를 받아 표시 설정을 안내하거나 개발팀에 전달할 재현 보고서를 작성합니다.');
  d.node('input', 'input.user_request', '오류 제보 접수', 0, 1, {question: originalReport});
  d.node('ask', 'input.form', '사라지기 전후 상황 묻기', 1, 1, {
    prompt: '어떤 할 일이 어떤 동작 뒤에 사라졌나요? ‘완료 항목 숨기기’를 끄면 그 항목이 다시 보이는지도 알려주세요.',
  });
  d.node('check-reply', 'ai.classify', '필터를 끈 결과가 있는지 확인', 2, 1, {
    categories: ['관찰 완료'],
    instruction: '제보자가 완료 항목 숨기기를 끄거나 꺼진 상태를 확인했고, 그때 해당 항목이 보였는지 알려주면 ‘관찰 완료’입니다. 끈 뒤의 결과가 없거나 모순되면 null을 반환하세요.',
  });
  d.node('clarify', 'input.form', '필터를 끈 결과 다시 묻기', 3, 2, {
    prompt: '‘완료 항목 숨기기’를 꺼 주세요. 그 뒤 같은 목록에서 사라졌던 항목이 다시 보이나요? 확인하기 어렵다면 그 이유를 알려주세요.',
  });
  d.node('observations', 'data.transform', '제보자의 회신 모으기', 4, 1, {operation: 'text'});
  d.node('route', 'ai.classify', '필터 해제 후 목록 상태 구분', 5, 1, {
    categories: ['다시 보임', '계속 안 보임'],
    instruction: '제보자가 완료 항목 숨기기를 끈 다음의 관찰을 분류하세요. 다시 나타나면 ‘다시 보임’, 꺼도 해당 항목을 찾을 수 없으면 ‘계속 안 보임’입니다. 보충 회신에서 바로잡은 내용은 그 회신을 따르세요. 확인하기 어렵거나 어느 상태인지 판단할 수 없으면 null을 반환하세요.',
  });
  d.step('input', 'ask');
  d.step('ask', 'check-reply');
  d.order('check-reply', 'observations', 'category:관찰 완료');
  d.order('check-reply', 'clarify', 'other');
  d.data('ask', 'observations');
  d.step('clarify', 'observations');
  d.step('observations', 'route');

  d.node('usage-guide', 'ai.single_task', '필터 사용법 안내', 6, 0, {
    goal: '항목을 다시 찾은 사용자에게 표시 설정을 설명합니다.',
    instruction: '회신에서 항목을 찾은 과정을 짚어 주세요. 표시 규칙에 따라 켤 때와 끌 때 보이는 항목을 짧게 안내하세요.',
  });
  d.node('repro-report', 'ai.single_task', '재현 보고서 작성', 6, 2, {
    goal: '개발팀이 직접 확인할 수 있도록 사용자가 겪은 현상을 재현 보고서로 정리합니다.',
    instruction: '원래 제보와 회신에서 제보자가 실제로 한 동작만 순서대로 쓰세요. 표시 규칙에 따른 기대 결과와 제보자가 본 실제 결과를 구분하세요. 기기·앱 버전 등 주어지지 않은 환경은 “확인 필요”로 남기세요. 재현 상태는 “제보자 관찰, 개발팀 재현 전”으로 표시하세요. 원인이나 데이터 삭제 여부를 단정하지 마세요.',
  });
  d.doc('filter-rule', '할 일 목록 표시 규칙', filterRule, 5, 3, 'usage-guide');
  d.edge('filter-rule', 'repro-report', 'reference', 'ref', 'context');
  d.node('usage-answer', 'output.answer', '사용 안내 전달', 7, 0);
  d.node('report-answer', 'output.answer', '재현 보고서 전달', 7, 2);
  d.node('needs-observation', 'control.terminate', '확인할 항목 남기기', 6, 4, {
    status: 'success', message: '필터를 끈 뒤의 목록 상태는 추가 확인이 필요합니다. 나중에 확인할 수 있을 때 항목 이름과 필터를 끈 뒤 그 항목이 보였는지 알려 주세요.',
  });
  d.order('route', 'usage-guide', 'category:다시 보임');
  d.order('route', 'repro-report', 'category:계속 안 보임');
  d.order('route', 'needs-observation', 'other');
  for (const recipient of ['usage-guide', 'repro-report']) {
    d.data('route', recipient);
    d.data('input', recipient, 'question');
  }
  d.step('usage-guide', 'usage-answer');
  d.step('repro-report', 'report-answer');
  return d.graph;
}

function codeReview(): Graph {
  const team = new Drawing();
  team.node('input', 'input.user_request', '코드 변경 검토 요청', 0, 2);
  team.node('split', 'control.parallel', '개발자와 QA에게 검토 요청', 1, 2, {maxConcurrency: 2});
  team.node('developer', 'agent.delegate', '개발자의 코드 검토', 2, 1, {
    role: '개발자',
    instruction: '연결한 변경 코드와 표시 요구사항을 읽으세요. 예시 목록이 필터를 통과하는 순서를 따라가며 조건식이 요구사항을 지키는지 확인하세요. 잘못된 경우 해당 함수와 식을 인용하고 필요한 최소 수정식을 제안하세요. 검토 결과에 “개발자”를 표시하세요.',
  });
  team.node('qa', 'agent.delegate', 'QA의 시험 사례 검토', 2, 3, {
    role: 'QA',
    instruction: '같은 변경 코드, 표시 요구사항과 기존 시험 기록을 읽으세요. 예시 목록으로 숨기기 켬·끔 두 사례의 입력과 기대 목록을 항목 이름으로 적고, 코드로 예상한 결과와 대조하세요. 기존에 기록된 시험과 새로 실행해야 할 시험을 구분하세요. 이번 검토에서는 코드를 실행하지 않았습니다. 검토 결과에 “QA”를 표시하세요.',
  });
  team.doc('code', '목록 필터 변경 코드', filterCode, 1, 0, 'developer');
  team.edge('code', 'qa', 'reference', 'ref', 'context');
  team.doc('criteria', '표시 요구사항과 기존 시험 기록', filterTests, 1, 4, 'developer');
  team.edge('criteria', 'qa', 'reference', 'ref', 'context');
  team.node('join', 'control.join', '두 검토 의견 모으기', 3, 2, {merge: 'text', partialFailure: 'fail'});
  team.node('review-summary', 'ai.single_task', '코드 검토 보고서 작성', 4, 2, {
    goal: '개발자의 수정 제안과 QA의 검증 방법을 한 보고서에서 연결합니다.',
    instruction: '두 담당자의 검토를 바탕으로 잘못 표시되는 항목, 개발자가 짚은 함수의 기존 조건과 제안한 수정식, 그 수정을 확인할 QA의 켬·끔 시험을 연결하세요. QA의 각 사례에는 예시 입력과 기대 항목 이름을 담으세요. 기존 시험 기록, 이번에 코드를 읽어 예상한 동작, 수정 후 실행할 시험을 구분하세요.',
    criterion: '독자가 어떤 조건을 왜 바꾸고 어떤 항목이 보여야 수정이 맞는지 알 수 있습니다.',
  });
  team.node('answer', 'output.answer', '검토 보고서 반환', 5, 2);
  team.step('input', 'split');
  for (const reviewer of ['developer', 'qa']) {
    team.step('split', reviewer);
    team.step(reviewer, 'join');
  }
  team.step('join', 'review-summary');
  team.step('review-summary', 'answer');

  const d = new Drawing('할 일 앱의 목록 필터 코드와 요구사항을 검토해 수정안과 시험 사례를 제안합니다.');
  d.node('input', 'input.user_request', '할 일 앱 코드 검토 요청', 0, 0, {question: reviewQuestion});
  d.node('team', 'agent.team', '할 일 앱 코드 검토 팀', 1, 0, {
    goal: '목록 필터가 표시 요구사항에 맞는지 검토하고 수정안과 시험 사례를 제안합니다.',
    responsible: '검토 담당자',
  }, team.graph);
  d.node('output', 'output.answer', '코드 검토 보고서 전달', 2, 0);
  d.step('input', 'team');
  d.step('team', 'output');
  return d.graph;
}

export const swTeamTemplates: Lesson[] = [
  {
    id: 'sw-bug-triage', title: '오류 제보에서 빠진 정보 되묻기', level: '중급', topic: '소프트웨어 개발',
    description: '할 일 목록에서 항목이 사라졌다는 제보를 받고, 표시 설정을 바꾼 뒤의 관찰을 물어봅니다.',
    task: '같은 제보를 두 번 보내고, 필터를 끈 결과만 바꿔 회신해 보세요.',
    question: originalReport,
    sampleCase: {title: '할 일이 사라진 상황 접수', expected: '회신 대기 후 항목이 다시 보이면 필터 사용법을, 계속 안 보이면 재현 보고서를 전달합니다.'},
    goal: '한 줄짜리 제보에서 빠진 정보를 찾아 사용 방법을 설명할 때와 개발팀에 넘길 때를 구분합니다.',
    steps: [
      '‘시험 실행’에서 “할 일이 사라졌어요”를 보내세요. ‘사라지기 전후 상황 묻기’에서 실행이 회신을 기다리는지 확인하세요.',
      '회신 칸에 “' + restoredReply + '”를 입력하고 ‘같은 실행 이어가기’를 누르세요. ‘필터 사용법 안내’가 켰을 때와 껐을 때 표시되는 항목을 어떻게 설명하는지 읽으세요.',
      '새 대화에서 같은 제보를 다시 보내세요. 이번에는 “' + missingReply + '”라고 회신하세요. ‘재현 보고서 작성’에 전달된 관찰과 최종 보고서의 기대 결과·실제 결과를 대조하세요.',
      '보충 질문도 시험하려면 처음에는 “우유 사기를 완료로 표시했어요.”까지만 회신하세요. ‘필터를 끈 결과 다시 묻기’가 나타나면 필터를 끈 뒤 항목이 보였는지 알려 주세요.',
    ],
    checks: [
      '첫 회신에서는 완료 항목을 다시 찾은 이유와 숨기기 설정의 사용 방법이 나옵니다.',
      '두 번째 회신에서는 숨기기를 끄면 완료 항목도 보여야 하지만 ‘우유 사기’가 보이지 않았다는 보고서가 나옵니다. 기기·앱 버전과 개발팀의 재현 여부가 확인 과제로 남습니다.',
    ],
    example: '사용자가 ‘우유 사기’를 완료로 표시하고 숨기기를 껐습니다. 완료 항목도 보여야 하지만 사용자의 목록에는 ‘우유 사기’가 나타나지 않았습니다. 기기와 앱 버전은 확인이 필요합니다. 개발팀 재현 전입니다.',
    examples: [], graph: bugTriage(),
  },
  {
    id: 'sw-code-review', title: '개발자와 QA가 코드 변경 함께 검토하기', level: '고급', topic: '소프트웨어 개발',
    description: '개발자와 QA가 같은 할 일 목록 필터를 읽고, 코드 수정안에 그 수정을 확인할 시험 사례를 붙입니다.',
    task: '팀 안에서 두 담당자가 받은 자료를 찾고 최종 보고서에서 수정식과 켬·끔 시험을 짝지어 보세요.',
    question: reviewQuestion,
    sampleCase: {title: '완료 항목 숨기기 변경 검토', expected: '개발자가 반대로 된 조건의 수정식을 제안하고, QA가 켬에서 미완료만, 끔에서 전체가 보여야 한다는 시험 사례를 제시합니다.'},
    goal: '같은 코드에서 개발자는 수정할 식을, QA는 기존 시험이 놓친 동작을 찾아 하나의 검토 결과로 모읍니다.',
    steps: [
      '‘할 일 앱 코드 검토 팀’을 열고 ‘목록 필터 변경 코드’와 ‘표시 요구사항과 기존 시험 기록’을 읽으세요. ‘우유 사기’는 완료, ‘책 반납’은 미완료입니다. 숨기기를 켜면 코드가 어떤 항목을 남길지 예상해 보세요.',
      '예시 질문을 실행하세요. 실행 경로에서 ‘개발자의 코드 검토’와 ‘QA의 시험 사례 검토’를 열어, 한쪽이 인용한 조건을 다른 쪽의 어떤 시험이 발견하는지 살펴보세요.',
      '마지막 보고서에서 개발자의 수정식과 QA의 두 기대 목록을 확인하세요. 기존 기록에 있는 시험과 수정 후 실행할 시험을 구별해 보세요.',
    ],
    checks: [
      '개발자가 visibleTodos의 todo.completed 때문에 숨기기를 켜면 완료 항목만 남는다고 설명하고, !todo.completed로 바꾸는 수정을 제안합니다.',
      'QA의 켬 사례는 ‘책 반납’만, 끔 사례는 ‘우유 사기’와 ‘책 반납’을 기대합니다. 기존에는 끔 시험만 통과로 기록되어 있습니다.',
      '최종 보고서에 어느 조건을 고칠지와 이를 검증할 두 사례가 함께 나오고, 수정 후 시험은 실행할 일로 남습니다.',
    ],
    example: 'visibleTodos에서 숨기기를 켰을 때 todo.completed가 참인 ‘우유 사기’만 남습니다. 개발자는 조건을 !todo.completed로 바꾸자고 제안했습니다. QA는 수정 후 켬에서 ‘책 반납’만, 끔에서 두 항목 모두 보이는지 확인합니다. 기존 기록에는 끔 시험만 통과로 남아 있습니다. 수정 후 시험은 아직 실행 전입니다.',
    examples: [], graph: codeReview(),
  },
];
