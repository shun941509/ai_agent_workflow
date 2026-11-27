import type { ReactNode } from 'react';
import { libraryQuestion as question, libraryRule as rule, quoteInstruction as instruction } from '../guide/content';

export type GuidePractice = 'example' | 'blank';

type Step = {
  title: string;
  instructions: ReactNode;
  check: string;
  help: string;
};

export const practiceSteps: Record<GuidePractice, readonly Step[]> = {
  example: [
    {
      title: '첫 답변 읽기',
      instructions: <p><strong>시험 실행</strong>을 열고 <strong>Agent에게 보낼 질문</strong>에 “{question}”를 입력한 뒤 <strong>질문 실행</strong>을 누르세요. <strong>답변</strong> 옆에 ‘완료’가 표시되면 내용을 읽으세요.</p>,
      check: '실행 상태가 ‘완료’이고 첫 답변에서 준비물인 신분증을 찾을 수 있습니다.',
      help: '질문이 비어 있으면 회원증 질문을 입력하세요. 준비물이 다르면 ‘도서관 이용규정’의 ‘자료 원문’을 확인하세요. 모델 설정 오류가 뜨면 작업실 홈 상단의 ‘모델 설정 필요’를 확인하고 운영자에게 연결을 요청하세요.',
    },
    {
      title: '작업 지시 바꾸기',
      instructions: <p><strong>도서관 안내 Agent → 속성 → 작업 지시</strong>에서 기존 지시를 다음 문장으로 바꾸세요. “{instruction}” 작은 화면에서는 <strong>실행 화면 닫기</strong>를 눌러 블록으로 돌아갈 수 있습니다.</p>,
      check: '‘작업 지시’에 답을 쓴 뒤 원문을 인용하라는 문장이 보입니다.',
      help: '‘질문 입력’에는 이용자가 물을 내용이, ‘도서관 이용규정’에는 답변의 근거가 들어 있습니다. 답하는 방식을 바꿀 때는 ‘도서관 안내 Agent’를 선택하세요.',
    },
    {
      title: '같은 질문으로 비교하기',
      instructions: <p><strong>시험 실행 → 실행 기록 → 새 대화</strong>에서 “{question}”를 다시 보내세요. 두 대화를 따로 남기면 <strong>실행 기록</strong>에서 첫 답변을 다시 열어 비교할 수 있습니다.</p>,
      check: '두 답변 모두 신분증을 안내하고, 두 번째 답변의 다음 줄에는 “' + rule + '”가 인용됩니다.',
      help: '같은 질문을 보냈는지 두 대화의 ‘보낸 질문’을 확인하세요. 인용이 빠지면 ‘작업 지시’와 ‘도서관 이용규정’ 원문을 확인한 뒤 수정한 초안으로 다시 시험하세요.',
    },
  ],
  blank: [
    {
      title: '블록 네 개 배치하기',
      instructions: <p>빈 화면의 <strong>블록 선택</strong>에서 <strong>사용자 입력</strong>, <strong>AI 작업</strong>, <strong>답변 전달</strong>, <strong>자료 가져오기</strong>를 하나씩 추가하세요. 입문에서 AI 작업의 블록 이름은 <strong>AI 한 번 작업</strong>입니다. 작은 화면은 <strong>속성 닫기 → 블록</strong>으로 팔레트를 다시 엽니다.</p>,
      check: '캔버스에 질문을 받는 블록, AI 작업, 답변 전달, 자료 블록이 하나씩 보입니다.',
      help: '블록 팔레트의 ‘블록 추가’에서 ‘추천’을 누른 뒤 ‘AI 작업’을 추가하세요. 작은 화면에서 팔레트를 열려면 캔버스의 ‘블록’을 누르세요.',
    },
    {
      title: '질문과 원문 준비하기',
      instructions: <ol>
        <li><strong>사용자 입력 → 예시 질문</strong>에 “{question}”를 입력하세요.</li>
        <li><strong>자료 가져오기 → 자료 원문</strong>에 “{rule}”를 적고 <strong>변경 적용</strong>을 누르세요.</li>
      </ol>,
      check: '질문은 준비물을 묻고, 적용한 자료 원문에는 준비물로 신분증이 적혀 있습니다.',
      help: '원문을 적고 적용하지 않으면 시험할 때 쓸 원문을 묻습니다. ‘자료 가져오기’에서 입력한 문장을 확인하고 ‘변경 적용’을 누르세요.',
    },
    {
      title: 'AI 작업 지시하기',
      instructions: <ol>
        <li><strong>AI 한 번 작업 → 속성</strong>에서 <strong>작업 방식</strong>을 ‘한 번 답하기’로 두세요.</li>
        <li><strong>맡길 일</strong>에 “도서관 규정에서 확인한 사실을 이용자에게 안내합니다.”를, <strong>작업 지시</strong>에 “{instruction}”를 입력하세요.</li>
        <li><strong>원하는 결과</strong>에 “질문에 대한 안내가 한눈에 보입니다.”를 적고, <strong>답변 전달 → 종료 방식</strong>에서 ‘답변 반환’을 확인하세요.</li>
      </ol>,
      check: 'AI 작업에는 인용 지시가 있고, 답변 전달의 종료 방식은 ‘답변 반환’입니다.',
      help: '‘맡길 일’은 AI가 할 일이고 ‘작업 지시’는 그 일을 하는 방법입니다. 인용하라는 문장이 ‘작업 지시’에 들어 있는지 확인하세요.',
    },
    {
      title: '실행 순서와 자료 연결하기',
      instructions: <ol>
        <li><strong>사용자 입력 → 속성 → 연결 추가</strong>에서 <strong>도착 블록</strong>을 ‘AI 한 번 작업’으로 고르세요. <strong>실행 순서</strong>의 ‘작업 후 → 실행 시작’과 <strong>전달할 값</strong>의 ‘결과 → 입력값’을 선택해 <strong>연결 적용</strong>을 누르세요.</li>
        <li><strong>AI 한 번 작업 → 답변 전달</strong>도 같은 두 항목으로 연결하세요. AI 작업이 끝나면 답변 전달 블록이 실행되고, AI가 작성한 답변을 입력값으로 받습니다.</li>
        <li><strong>자료 가져오기 → AI 한 번 작업</strong>은 <strong>참조</strong>의 ‘참조 → 참고 자료’만 선택해 연결하세요. 이 선을 따라 AI가 규정을 읽습니다.</li>
      </ol>,
      check: '입력에서 AI를 거쳐 답변으로 이어지고, 규정에서 AI로 향하는 참조 선이 보입니다.',
      help: '같은 두 블록 사이의 연결은 화살표 하나에 묶여 보입니다. 선을 선택해 실행 순서와 전달할 값을 확인하고 ‘설계 검사’에서 표시되는 항목을 눌러 수정하세요.',
    },
    {
      title: '답과 근거 확인하기',
      instructions: <p><strong>설계 검사</strong>에서 실행 조건을 확인한 뒤 <strong>시험 실행</strong>을 여세요. “{question}”를 <strong>질문 실행</strong>으로 보내고, <strong>실행 결과</strong>에서 완성 예시의 두 번째 답변과 비교하세요.</p>,
      check: '신분증이 필요하다는 안내 다음 줄에 “' + rule + '”가 그대로 나옵니다.',
      help: '질문이 전달되지 않으면 입력과 AI 사이의 ‘전달할 값’을, 근거가 달라지면 자료에서 AI로 향하는 ‘참조’와 적용한 원문을 확인하세요. 인용할 줄은 ‘작업 지시’에서 지정합니다.',
    },
  ],
};
