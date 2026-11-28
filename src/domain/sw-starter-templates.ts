import { Drawing } from './template-drawing';
import type { Lesson } from './types';

const featureRequest = '할 일 앱에서 끝낸 항목을 잠깐 숨겼다가 다시 보고 싶어요.';
const acceptanceInstruction = '완료 항목을 숨긴 상태에서 어떤 조작을 하면 무엇이 다시 보이는지, 직접 시험할 수 있는 확인 조건을 쓰세요.';

function requirementsGraph() {
  const d = new Drawing('할 일 앱의 기능 요청을 개발자가 구현할 요구사항과 확인 질문으로 정리합니다.');
  d.node('input', 'input.user_request', '사용자 요청', 0, 0, { question: featureRequest });
  d.node('agent', 'ai.single_task', '요구사항 작성 Agent', 1, 0, {
    goal: '할 일 앱 사용자의 요청을 개발자가 읽을 수 있게 정리합니다.',
    instruction: '사용자가 원하는 기능을 기능 요구사항 한 문장으로 요약하세요.',
    criterion: '사용자가 요청한 동작을 목록에서 알아볼 수 있습니다.',
  });
  d.node('output', 'output.answer', '요구사항 전달', 2, 0);
  d.step('input', 'agent');
  d.step('agent', 'output');
  return d.graph;
}

const releaseQuestion = '할 일 앱의 변경 기록으로 사용자에게 보여 줄 업데이트 안내를 써 주세요.';
const changeLog = [
  '기능 | 상태 | 사용자 안내',
  '할 일 제목 수정 | 완료 | 목록에서 할 일의 제목을 고칩니다.',
  '완료 항목 숨기기 | 예정 | 끝낸 할 일을 목록에서 잠시 가립니다.',
  '마감일 알림 | 예정 | 마감일에 알림을 받습니다.',
].join('\n');
const releaseSkill = [
  '# 업데이트 안내 작성',
  '변경 기록의 각 행에서 기능, 상태, 사용자 안내를 읽으세요.',
  '상태가 완료인 행은 “## 이번 버전에 추가된 기능” 아래에, 예정인 행은 “## 예정” 아래에 적으세요.',
  '각 행은 “- 기능 — 사용자 안내” 형식으로 한 번만 적고 기능명과 안내 문장을 원문 그대로 쓰세요.',
  '같은 상태인 행은 원문의 순서를 유지하세요. 두 제목과 목록만 Markdown으로 출력하세요.',
].join('\n');

function releaseNotesGraph() {
  const d = new Drawing('할 일 앱의 변경 기록에 근거해 배포한 기능과 예정 기능을 구분한 릴리스 안내문을 작성합니다.');
  d.node('input', 'input.user_request', '안내 작성 요청', 0, 0, { question: releaseQuestion });
  d.node('agent', 'ai.single_task', '업데이트 안내 Agent', 1, 0, {
    goal: '할 일 앱을 사용하는 사람이 이번 버전에 쓸 수 있는 기능과 예정된 기능을 확인하게 합니다.',
    instruction: '연결된 변경 기록을 읽고 업데이트 안내 작성 Skill에 따라 안내문을 작성하세요.',
    criterion: '변경 기록의 모든 기능이 각자 해당하는 목록에 한 번씩 나타납니다.',
  });
  d.doc('changes', '변경 기록', changeLog, 0, 1, 'agent');
  d.node('skill', 'instruction.skill', '업데이트 안내 작성 Skill', 1, 1, { version: '1', content: releaseSkill });
  d.edge('skill', 'agent', 'reference', 'ref', 'skill', '업데이트 안내 작성 지침');
  d.node('file', 'file.create', '업데이트 안내 파일 만들기', 2, 0, { fileName: '업데이트안내.md', format: 'markdown' });
  d.node('output', 'output.answer', '업데이트 안내 전달', 3, 0);
  d.step('input', 'agent');
  d.step('agent', 'file');
  d.step('file', 'output');
  return d.graph;
}

export const swStarterTemplates: Lesson[] = [
  {
    id: 'sw-requirements', title: '사용자 요청을 기능 요구사항으로 바꾸기', level: '입문', topic: '소프트웨어 개발',
    description: '할 일 앱 사용자의 말을 읽고, 개발한 기능을 목록 화면에서 어떻게 시험할지 적습니다.',
    goal: '같은 사용자 요청에서 기능의 한 줄 요약과 직접 시험할 수 있는 확인 조건을 얻습니다.',
    task: '요구사항 작성 Agent의 작업 지시 한 문장을 바꿔, 숨겼던 완료 항목이 다시 보이는 조건을 작성하세요.',
    question: featureRequest,
    sampleCase: { title: '숨긴 완료 항목 다시 보기', expected: '첫 답변은 숨기기와 다시 보기를 한 문장으로 요약합니다. 지시를 바꾸면 숨기기를 끌 때 숨겼던 완료 항목이 다시 나타난다는 확인 조건이 나옵니다.' },
    steps: [
      `‘시험 실행’에서 “${featureRequest}”를 보내세요. 첫 답변은 사용자가 원하는 기능을 한 문장으로 요약합니다.`,
      `캔버스에서 ‘요구사항 작성 Agent’를 선택하세요. 속성의 ‘작업 지시’를 “${acceptanceInstruction}”로 바꾸세요.`,
      '‘시험 실행 → 실행 기록 → ＋ 새 대화’에서 같은 요청을 보내세요. 두 번째 답변을 읽고 어떤 상태에서 시작해 무엇을 누르면 목록에 무엇이 보이는지 찾아보세요.',
    ],
    checks: [
      '첫 답변은 완료한 할 일을 숨겼다가 다시 볼 수 있다는 요구를 한 문장으로 설명합니다.',
      '두 번째 답변에는 완료 항목을 숨긴 상태, 숨기기를 끄는 조작, 숨겼던 완료 항목이 목록에 다시 나타나는 결과가 들어 있습니다.',
    ],
    example: '완료 항목을 숨긴 상태에서 숨기기를 끄면, 숨겼던 완료 항목이 목록에 다시 나타난다.',
    examples: [], graph: requirementsGraph(),
  },
  {
    id: 'sw-release-notes', title: '변경 기록으로 업데이트 안내 만들기', level: '초급', topic: '소프트웨어 개발',
    description: '할 일 앱의 변경 기록과 작성 Skill을 이용해, 지금 쓸 수 있는 기능과 예정된 기능을 안내합니다.',
    goal: '기능의 상태 한 칸이 업데이트 안내의 어느 목록을 바꾸는지 화면과 파일에서 확인합니다.',
    task: '‘완료 항목 숨기기’의 상태를 ‘예정’에서 ‘완료’로 바꾸고 업데이트안내.md를 내려받으세요.',
    question: releaseQuestion,
    sampleCase: { title: '할 일 앱 업데이트 안내', expected: '‘완료 항목 숨기기’는 처음에 ‘예정’에 있고 상태를 고치면 ‘이번 버전에 추가된 기능’에만 나옵니다. 다른 기능은 같은 목록에 있고 화면과 업데이트안내.md의 내용이 일치합니다.' },
    steps: [
      '캔버스의 ‘변경 기록’에서 속성의 ‘자료 원문’을 읽으세요. ‘업데이트 안내 작성 Skill’의 속성에서 ‘SKILL.md 지침’을 열어 완료와 예정을 각각 어느 제목 아래에 쓰는지 확인하세요.',
      `‘시험 실행’에서 “${releaseQuestion}”를 보내세요. 첫 안내의 ‘예정’ 목록에서 ‘완료 항목 숨기기’를 찾으세요.`,
      '‘변경 기록 → 자료 원문’에서 “완료 항목 숨기기 | 예정”의 “예정”만 “완료”로 바꾼 뒤 ‘변경 적용’을 누르세요.',
      '‘시험 실행 → 실행 기록 → ＋ 새 대화’에서 같은 요청을 보내세요. 달라진 목록을 찾고 ‘업데이트안내.md 내려받기’를 눌러 파일의 두 목록을 화면과 대조하세요.',
    ],
    checks: [
      '‘완료 항목 숨기기’는 처음에 ‘예정’에 있고 수정 후에는 ‘이번 버전에 추가된 기능’에만 있습니다.',
      '두 안내 모두 ‘할 일 제목 수정’은 이번 버전에, ‘마감일 알림’은 예정에 있습니다. 세 기능의 안내 문장은 같습니다.',
      '내려받은 업데이트안내.md의 제목, 항목, 순서가 화면의 답변과 같습니다.',
    ],
    example: [
      '## 이번 버전에 추가된 기능',
      '- 할 일 제목 수정 — 목록에서 할 일의 제목을 고칩니다.',
      '- 완료 항목 숨기기 — 끝낸 할 일을 목록에서 잠시 가립니다.',
      '', '## 예정',
      '- 마감일 알림 — 마감일에 알림을 받습니다.',
    ].join('\n'),
    examples: [], graph: releaseNotesGraph(),
  },
];
