import { useId, type CSSProperties } from 'react';
import Image from 'next/image';
import { GuideVisual } from './GuideVisual';
import styles from './GuideCreationVisual.module.css';

type Capture = {
  image: string;
  width: number;
  height: number;
  alt: string;
  action: string;
  mark: readonly [number, number, number, number];
  fromRight?: boolean;
};

export function AnnotatedGuideCapture({capture, number}: {capture: Capture; number: number}) {
  const [left, top, width, height] = capture.mark;
  const position = {
    '--mark-left': left + '%', '--mark-top': top + '%', '--mark-width': width + '%',
    '--mark-height': height + '%', '--mark-mid': (top + height / 2) + '%',
  } as CSSProperties;
  return <div className={styles.annotation} data-right={capture.fromRight || undefined}>
    <div className={styles.action}><span aria-hidden="true">{number}</span>{capture.action}</div>
    <div className={styles.shot} style={position}>
      <Image unoptimized src={'/guide/captures/' + capture.image + '.webp'}
        width={capture.width} height={capture.height} alt={capture.alt} />
      <span aria-hidden="true" className={styles.leader} />
      <span aria-hidden="true" className={styles.target} />
    </div>
  </div>;
}

const creationSteps = [
  {
    title: '내 Agent에서 생성 시작', description: '작업 메뉴에서 ‘내 Agent’를 열고 ‘새 Agent’를 누르세요. 작은 화면에서는 먼저 ‘메뉴 열기’를 누릅니다.',
    action: '새 Agent 누르기', image: 'create-entry', width: 347, height: 134,
    alt: '내 Agent 화면 제목 아래에 휴지통과 새 Agent 버튼이 나란히 있습니다.', mark: [31.8, 62.3, 32, 32.8], fromRight: true,
  },
  {
    title: '이름과 시작 방법 설정', description: '‘Agent 이름’에 ‘도서관 회원증 안내’를 입력하세요. ‘수준별 템플릿에서 시작’을 누르면 예제 목록이 열립니다.',
    action: '이름을 쓰고 템플릿으로 시작', image: 'create-name', width: 460, height: 326,
    alt: 'Agent 이름에 도서관 회원증 안내를 입력한 창. 빈 캔버스, 한 문장, 수준별 템플릿 중 세 번째 항목을 선택합니다.', mark: [1.7, 81.9, 96.5, 16],
  },
  {
    title: '입문 템플릿 선택', description: '‘질문에서 답변까지’를 고르세요. 실습 상세에서 준비된 질문과 도서관 이용규정으로 어떤 답을 만들지 확인합니다.',
    action: '질문에서 답변까지 선택', image: 'create-lesson', width: 496, height: 84,
    alt: '입문 수준의 질문에서 답변까지 실습이 템플릿 목록에 표시됩니다.', mark: [3.4, 22.8, 81.4, 25.9],
  },
  {
    title: '내 이름으로 사본 만들기', description: '상세 화면 아래에서 ‘도서관 회원증 안내’ 만들기를 누르세요. 내 사본의 편집기가 열리고 ‘내 Agent’ 목록에서 입력한 이름으로 다시 찾을 수 있습니다.',
    action: '입력한 이름으로 만들기', image: 'create-copy', width: 241, height: 57,
    alt: '실습 상세 아래쪽에 입력한 이름이 붙은 ‘도서관 회원증 안내’ 만들기 버튼이 있습니다.', mark: [3.6, 10.7, 93.1, 77.2],
  },
  {
    title: '사본의 작업 지시 확인', description: '편집기의 ‘도서관 안내 Agent’를 선택해 ‘작업 지시’를 읽으세요. 여기서 한 문장으로 답할지 정합니다. ‘도서관 이용규정’의 ‘자료 원문’에서는 답의 근거를 확인합니다.',
    action: '답변 방식을 정하는 지시 읽기', image: 'create-instruction', width: 323, height: 108,
    alt: '작업 지시 칸에는 질문에 한 문장으로 답하고 자료에 없는 사항은 확인이 필요하다고 표시하라는 지시가 있습니다.', mark: [2.5, 27.7, 95, 66.7],
  },
] as const;

export function GuideCreationVisual() {
  const titleId = useId();
  return <section aria-labelledby={titleId} className={styles.creation}>
    <h3 id={titleId}>내 이름으로 Agent 만들기</h3>
    <p>도서관 예제에 이름을 붙여 내 작업실에 보관하려면 이 순서로 만드세요.</p>
    <ol>{creationSteps.map((step, index) => <li key={step.image}>
      <GuideVisual title={step.title} description={step.description}>
        <AnnotatedGuideCapture capture={step} number={index + 1} />
      </GuideVisual>
    </li>)}</ol>
    <p className={styles.tryIt}><strong>만든 뒤 시험하기</strong> 편집기 위 ‘시험 실행’에서 ‘Agent에게 보낼 질문’에 회원증을 만들 때 필요한 준비물을 물어보세요.
      ‘질문 실행’을 누르고 답변에 나온 준비물을 자료 원문의 ‘신분증’과 대조하세요. 실제 답변을 받으려면 모델 연결이 필요합니다.</p>
  </section>;
}
