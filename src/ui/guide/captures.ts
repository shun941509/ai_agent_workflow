import { goalCaptures } from './goal-captures';

/** Original browser captures from a sample workspace. Marker bounds are percentages of the unaltered PNG. */
export type GuideCapture = {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  marks: { x: number; y: number; w: number; h: number; label: string }[];
};

export const captures: Partial<Record<string, GuideCapture>> = {
  ...goalCaptures,
  'help-question-blocked': {
    src: '/guide/captures/help-question-blocked.png',
    width: 562, height: 630,
    alt: '실행 결과 패널에 초안을 실행하려면 설계를 수정하라는 안내와 설계 검사 버튼이 있습니다. 회원증 질문이 입력되어 있어도 질문 실행 버튼은 비활성 상태입니다.',
    caption: '도서관 안내 Agent의 필수 속성인 ‘맡길 일’이 비어 있습니다. ‘설계 검사’에서 오류를 열고 맡길 일을 입력하면 질문을 실행할 수 있습니다.',
    marks: [
      { x: 12.6, y: 5.87, w: 77.66, h: 6.35, label: '초안 설계 오류' },
      { x: 12.6, y: 23.02, w: 27.9, h: 11.75, label: '설계 검사' },
      { x: 67.12, y: 79.21, w: 27.9, h: 11.75, label: '비활성화된 질문 실행' },
    ],
  },
  'terms-workflow': {
    src: '/guide/captures/terms-workflow.png',
    width: 1438, height: 510,
    alt: '질문 입력, 도서관 안내 Agent, 답변 전달이 왼쪽에서 오른쪽으로 이어집니다. 아래의 도서관 이용규정은 별도 연결선을 통해 Agent로 들어갑니다.',
    caption: '질문은 위쪽 세 블록을 따라 답변이 됩니다. 아래쪽 규정은 안내에 쓸 자료를 제공합니다.',
    marks: [
      { x: 4.01, y: 11.18, w: 24.2, h: 18.04, label: '질문 입력' },
      { x: 37.94, y: 11.18, w: 24.2, h: 18.04, label: '도서관 안내 Agent' },
      { x: 71.88, y: 11.18, w: 24.2, h: 18.04, label: '답변 전달' },
    ],
  },
  'terms-block': {
    src: '/guide/captures/terms-block.png',
    width: 530, height: 538,
    alt: '질문 입력의 블록 속성. 이름 칸에는 질문 입력, 예시 질문에는 회원증을 만들려면 무엇을 준비해야 하나요?가 들어 있습니다.',
    caption: '질문 입력 블록을 선택하면 시험할 때 사용할 예시 질문을 확인하거나 고칠 수 있습니다.',
    marks: [
      { x: 4.68, y: 41.98, w: 90.79, h: 13.75, label: '이름' },
      { x: 4.68, y: 68.75, w: 90.79, h: 26.77, label: '예시 질문' },
    ],
  },
  'terms-connection': {
    src: '/guide/captures/terms-connection.png',
    width: 522, height: 540,
    alt: '질문 입력에서 도서관 안내 Agent로 가는 선의 연결 속성. 실행 조건은 질문 입력 작업 후이고, 전달값은 질문 입력의 결과에서 도서관 안내 Agent의 입력값으로 이어집니다.',
    caption: '연결선을 선택하면 어느 작업이 끝나야 다음 블록이 시작하는지, 그때 어떤 값을 받는지 보입니다.',
    marks: [
      { x: 3.99, y: 32.04, w: 92.18, h: 30.19, label: '실행 조건' },
      { x: 3.99, y: 65.93, w: 92.18, h: 30.19, label: '전달값' },
    ],
  },
  'terms-tool': {
    src: '/guide/captures/terms-tool.png',
    width: 646, height: 298,
    alt: '내 예약 조회 블록의 속성. 연결한 MCP에서 도구 선택 칸에 도서관 예약 조회 MCP, 1판, reservations.list가 표시되어 있습니다.',
    caption: '도서관 방문 준비하기에서 내 예약 조회 블록이 도서관 예약 조회 MCP 1판의 reservations.list를 사용합니다.',
    marks: [
      { x: 2.48, y: 21.43, w: 95.05, h: 24.83, label: '내 예약 조회' },
      { x: 2.48, y: 69.76, w: 95.05, h: 24.83, label: '연결한 MCP에서 도구 선택' },
    ],
  },
  'terms-agent': {
    src: '/guide/captures/terms-agent.png',
    width: 646, height: 726,
    alt: '도서관 안내 Agent의 속성. 작업 방식은 한 번 답하기이며, 작업 지시는 한 문장으로 답하고 자료에 없는 사항은 확인이 필요하다고 표시하라는 내용입니다.',
    caption: '도서관 안내 Agent가 규정에서 확인한 사실을 어떻게 설명할지 작업 지시에서 정합니다.',
    marks: [
      { x: 2.48, y: 8.8, w: 95.05, h: 10.19, label: '도서관 안내 Agent' },
      { x: 2.48, y: 28.63, w: 95.05, h: 10.19, label: '한 번 답하기' },
      { x: 2.48, y: 77.94, w: 95.05, h: 19.83, label: '작업 지시' },
    ],
  },
  '01-start': {
    src: '/guide/captures/01-start.png',
    width: 2880, height: 1262,
    alt: '첫 방문 작업실 홈. 왼쪽 설계 도구 맨 아래에 가이드가 있고 오른쪽 위에 모델 설정됨이 보입니다.',
    caption: '모델이 연결된 샘플 작업실입니다. 홈 왼쪽에 가이드, 오른쪽 위에 모델 연결 상태가 보입니다.',
    marks: [
      { x: 0.83, y: 82.3, w: 10.56, h: 6.02, label: '가이드' },
      { x: 91.36, y: 2.16, w: 5.64, h: 3.13, label: '모델 설정됨' },
    ],
  },
  '02-start-example': {
    src: '/guide/captures/02-start-example.png',
    width: 1020, height: 412,
    alt: '가이드의 완성할 결과와 준비사항에 회원증 질문과 모델 설정됨 상태가 적혀 있고, 그 아래에 예제로 시작하기 버튼이 있습니다.',
    caption: '가이드 첫 단계에서 준비사항을 읽고 도서관 예제를 엽니다.',
    marks: [
      { x: 3.33, y: 74.54, w: 29.26, h: 19.09, label: '예제로 시작하기' },
    ],
  },
  '02-editor': {
    src: '/guide/captures/02-editor.png',
    width: 2494, height: 1284,
    alt: '질문에서 답변까지 편집기. 질문 입력, 도서관 안내 Agent, 답변 전달 블록이 연결되어 있고 아래의 도서관 이용규정이 Agent로 이어집니다.',
    caption: '가운데 캔버스에서 질문이 흐르는 순서를 보고 오른쪽 위에서 시험 실행을 엽니다.',
    marks: [
      { x: 39.6, y: 65.97, w: 13.95, h: 7.17, label: '도서관 안내 Agent' },
      { x: 89.56, y: 3.12, w: 8.86, h: 6.07, label: '시험 실행' },
    ],
  },
  '03-question': {
    src: '/guide/captures/03-question.png',
    width: 562, height: 378,
    alt: '시험 질문 칸에 회원증을 만들려면 무엇을 준비해야 하나요?가 입력되어 있고 아래 오른쪽에 질문 실행 버튼이 있습니다.',
    caption: '샘플 질문을 입력한 직후의 실행 결과 패널입니다.',
    marks: [
      { x: 7.97, y: 18.25, w: 87.04, h: 41.8, label: '시험 질문' },
      { x: 67.12, y: 65.87, w: 27.9, h: 19.58, label: '질문 실행' },
    ],
  },
  '04-answer': {
    src: '/guide/captures/04-answer.png',
    width: 538, height: 460,
    alt: '답변 옆에 완료가 표시되어 있고 회원증을 처음 만들 때는 신분증을 준비하시면 됩니다라는 답변이 보입니다.',
    caption: '샘플 계정에서 실제 모델이 첫 질문에 답했습니다.',
    marks: [
      { x: 9.07, y: 45, w: 82.01, h: 9.13, label: '답변의 완료 상태' },
      { x: 9.07, y: 57.61, w: 82.01, h: 18.26, label: '신분증을 안내한 첫 답변' },
    ],
  },
  '05-instruction': {
    src: '/guide/captures/05-instruction.png',
    width: 502, height: 210,
    alt: '작업 지시 입력 칸에 답을 쓰고 다음 줄에 안내문의 근거 문장을 그대로 인용하세요라는 지시가 보입니다.',
    caption: '도서관 안내 Agent의 속성에서 답변에 근거를 덧붙이도록 지시를 수정했습니다.',
    marks: [
      { x: 2.15, y: 27.56, w: 95.85, h: 68.57, label: '작업 지시' },
    ],
  },
  '05-compare': {
    src: '/guide/captures/05-compare.png',
    width: 538, height: 544,
    alt: '같은 질문에 대한 두 번째 답변. 신분증을 안내하고 다음 줄에 회원증을 처음 만들 때는 신분증을 가져오세요라는 규정을 인용했습니다.',
    caption: '지시를 바꾼 뒤 새 대화에서 같은 질문을 보내 얻은 실제 모델 답변입니다.',
    marks: [
      { x: 4.61, y: 12.32, w: 90.93, h: 21.32, label: '다시 보낸 같은 질문' },
      { x: 9.07, y: 48.71, w: 82.01, h: 30.88, label: '원문을 인용한 두 번째 답변' },
    ],
  },
  'source-rule': {
    src: '/guide/captures/source-rule.png',
    width: 498, height: 754,
    alt: '도서관 이용규정의 자료 원문. 운영 시간 안내 다음 문단에 회원증을 처음 만들 때는 신분증을 가져오세요라고 적혀 있습니다.',
    caption: '도서관 이용규정 블록의 자료 원문에서 준비물을 확인합니다.',
    marks: [
      { x: 1.77, y: 32.44, w: 96.62, h: 54.84, label: '자료 원문' },
    ],
  },
  'error-source': {
    src: '/guide/captures/error-source.png',
    width: 498, height: 806,
    alt: '도서관 이용규정 편집 중 자료 원문이 빈 상태. 변경 적용 버튼이 비활성화되고 적용할 자료 원문을 입력하세요라는 안내가 보입니다.',
    caption: '편집 중인 자료 원문을 비웠을 때 표시되는 안내입니다.',
    marks: [
      { x: 1.77, y: 30.35, w: 96.62, h: 51.3, label: '빈 자료 원문' },
      { x: 1.77, y: 94.55, w: 96.62, h: 4.47, label: '원문 입력 안내' },
    ],
  },
  'error-model': {
    src: '/guide/captures/error-model.png',
    width: 522, height: 602,
    alt: '답변 상태는 실패이고 서버의 OPENAI_API_KEY와 OPENAI_MODEL 설정이 필요합니다라는 오류 메시지와 같은 입력으로 새 실행 버튼이 보입니다.',
    caption: '모델을 설정하지 않은 작업실에서 같은 질문을 실행한 결과입니다.',
    marks: [
      { x: 7.82, y: 42.69, w: 84.52, h: 25.58, label: '설정 누락 오류' },
      { x: 7.82, y: 70.6, w: 57.15, h: 12.29, label: '같은 입력으로 새 실행' },
    ],
  },
  'error-model-home': {
    src: '/guide/captures/error-model-home.png',
    width: 434, height: 92,
    alt: '작업실 홈 상단의 새 Agent 버튼 오른쪽에 모델 설정 필요가 표시되어 있습니다.',
    caption: '모델이 연결되지 않은 작업실의 상단 상태 표시입니다.',
    marks: [
      { x: 51.31, y: 29.62, w: 45.38, h: 42.93, label: '모델 설정 필요' },
    ],
  },
};
