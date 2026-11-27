import type { GuideCapture } from './captures';

/** Full-view screenshots of the actual template copies and their nested workflows. */
export const goalCaptures: Record<string, GuideCapture> = {
  'goal-beginner': {
    src: '/guide/captures/goal-beginner.png',
    width: 1888, height: 696,
    alt: '질문 입력에서 도서관 안내 Agent, 대출 안내 파일 만들기, 답변 전달로 이어지고 아래의 도서관 이용규정과 근거 인용 Skill이 Agent에 연결되어 있습니다.',
    caption: '도서관 이용규정을 바꾼 일이 대출 안내 파일에 어떻게 반영되는지 살펴보세요.',
    marks: [
      { x: 27.75, y: 43.1, w: 23.31, h: 19.54, label: '도서관 이용규정' },
      { x: 53.6, y: 5.17, w: 18.64, h: 13.79, label: '대출 안내 파일 만들기' },
    ],
  },
  'goal-intermediate': {
    src: '/guide/captures/goal-intermediate.png',
    width: 3352, height: 1264,
    alt: '도서관 질문이 규정과 개인 예약으로 나뉩니다. 규정 경로는 근거를 확인해 답하거나 추가 안내문을 받고, 예약 경로는 내 예약을 조회합니다.',
    caption: '먼저 질문의 종류를 나누는 블록을, 그다음 규정에 답할 근거가 있는지 판단하는 블록을 찾아보세요.',
    marks: [
      { x: 15.63, y: 23.73, w: 10.5, h: 18.99, label: '규정과 개인 예약 구분' },
      { x: 44.75, y: 2.85, w: 10.5, h: 7.59, label: '질문의 근거 확인' },
    ],
  },
  'goal-library-visit': {
    src: '/guide/captures/goal-library-visit.png',
    width: 2864, height: 696,
    alt: '방문 질문에서 운영시간 검색과 예약 조회를 거쳐 결과를 모읍니다. 방문 안내 Agent에는 수령 규정과 방문 안내 작성 Skill이 연결되어 있습니다.',
    caption: '예약 내역은 ‘내 예약 조회’에서, 준비물은 ‘수령 규정’에서 가져옵니다.',
    marks: [
      { x: 35.34, y: 5.17, w: 12.29, h: 13.79, label: '내 예약 조회' },
      { x: 69.41, y: 43.1, w: 15.36, h: 19.54, label: '수령 규정' },
    ],
  },
  'goal-parallel': {
    src: '/guide/captures/goal-parallel.png',
    width: 1400, height: 168,
    alt: '질문 입력, 도서관 방문 안내 팀, 팀의 최종 답변이 한 줄로 이어진 최상위 설계입니다.',
    caption: '가운데 도서관 방문 안내 팀을 열면 운영시간과 회원증 담당자의 작업이 보입니다.',
    marks: [
      { x: 37.43, y: 21.43, w: 25.14, h: 57.14, label: '도서관 방문 안내 팀' },
    ],
  },
  'goal-parallel-team': {
    src: '/guide/captures/goal-parallel-team.png',
    width: 3352, height: 736,
    alt: '도서관 방문 안내 팀 안의 두 갈래. 운영시간 담당과 회원증 담당이 각각 자료를 검색하고, 두 결과가 대표 Agent를 거쳐 방문 안내로 이어집니다.',
    caption: '두 담당자에게 일을 나누는 곳과 각각의 조사 결과가 다시 모이는 곳을 확인하세요.',
    marks: [
      { x: 15.63, y: 40.76, w: 10.5, h: 13.04, label: '두 담당자에게 분담' },
      { x: 59.31, y: 40.76, w: 10.5, h: 13.04, label: '두 조사 결과 모으기' },
    ],
  },
  'goal-peer-review': {
    src: '/guide/captures/goal-peer-review.png',
    width: 1400, height: 168,
    alt: '질문 입력에서 도서관 안내문 검토 팀을 거쳐 팀의 최종 답변으로 이어진 최상위 설계입니다.',
    caption: '도서관 안내문 검토 팀을 열면 사실 검토와 안내문 편집을 맡은 두 담당자를 볼 수 있습니다.',
    marks: [
      { x: 37.43, y: 21.43, w: 25.14, h: 57.14, label: '도서관 안내문 검토 팀' },
    ],
  },
  'goal-peer-review-team': {
    src: '/guide/captures/goal-peer-review-team.png',
    width: 3596, height: 684,
    alt: '두 담당자가 작성한 초안을 서로 교환하고 도서관 원문과 대조합니다. 상호 검토 결과를 모아 안내문을 수정한 뒤 검토 기록을 첨부합니다.',
    caption: '초안의 작성자와 검토자가 어떻게 바뀌는지 연결선을 따라가 보세요. 마지막 안내문에는 두 사람의 검토 기록이 함께 전달됩니다.',
    marks: [
      { x: 37.56, y: 70.44, w: 6.59, h: 11.11, label: '서로의 초안 교환' },
      { x: 83.27, y: 44.44, w: 6.59, h: 11.11, label: '안내문에 검토 기록 첨부' },
    ],
  },
  'goal-dynamic': {
    src: '/guide/captures/goal-dynamic.png',
    width: 1888, height: 472,
    alt: '조사할 지점 목록이 지점별 조사 담당 생성, 지점별 결과 정리, 지점 조사 결과로 이어집니다. 아래의 지점별 안내는 담당 생성 블록에 연결됩니다.',
    caption: '지점별 조사 담당 생성 블록을 열면 한 담당자가 배정받은 지점을 조사하는 과정을 볼 수 있습니다.',
    marks: [
      { x: 27.75, y: 7.63, w: 18.64, h: 20.34, label: '지점별 조사 담당 생성' },
    ],
  },
  'goal-dynamic-team': {
    src: '/guide/captures/goal-dynamic-team.png',
    width: 1888, height: 168,
    alt: '배정된 지점에서 해당 지점의 안내문 찾기, 지점 운영 정보 확인, 조사 근거와 상태 반환 순으로 이어진 담당자 내부 설계입니다.',
    caption: '각 담당자가 지점 안내문을 찾아 운영 정보의 근거를 확인한 뒤 조사 상태를 돌려줍니다.',
    marks: [
      { x: 27.75, y: 21.43, w: 18.64, h: 57.14, label: '해당 지점의 안내문 찾기' },
      { x: 53.6, y: 21.43, w: 18.64, h: 57.14, label: '지점 운영 정보 확인' },
    ],
  },
  'goal-release': {
    src: '/guide/captures/goal-release.png',
    width: 1400, height: 472,
    alt: '질문 입력, 도서관 안내 Agent, 답변 전달 아래에 도서관 이용규정이 연결되어 있습니다. 후보판의 원문에는 한 사람의 대출 한도는 5권입니다라고 적혀 있습니다.',
    caption: '규정 변경 실습 사본의 후보판입니다. 도서관 이용규정 블록에서 5권으로 바뀐 대출 한도를 읽을 수 있습니다.',
    marks: [
      { x: 37.43, y: 63.56, w: 31.43, h: 28.81, label: '도서관 이용규정' },
    ],
  },
};
