import type { ReactNode, Ref } from 'react';
import { ArrowRight, BookOpen, FileText } from 'lucide-react';
import { guideAddress } from './navigation';
import { libraryQuestion } from './content';
import { AnnotatedGuideCapture } from './GuideCreationVisual';
import { GuideVisual } from './GuideVisual';
import styles from './FirstGuideStart.module.css';

export function FirstGuideStart({headingRef, title, description, modelReady, workButton}: {
  headingRef: Ref<HTMLHeadingElement>; title: string; description: string; modelReady: boolean; workButton: ReactNode;
}) {
  return <div className={styles.intro}>
    <header className={styles.introText}>
      <h2 id="guide-chapter-title" tabIndex={-1} ref={headingRef}>{title}</h2>
      <p>{description}</p>
      {workButton}
      <div className={styles.preparation}>
        <strong>준비사항</strong>
        <span>{modelReady ? '모델 설정됨 · 예제에 질문과 자료가 준비되어 있습니다.' :
          '모델 설정 필요 · 예제는 지금 열 수 있습니다. 실제 답변을 받으려면 작업실 운영자에게 모델 연결을 요청하세요.'}</span>
      </div>
    </header>
    <aside className={styles.outcome} aria-labelledby="first-guide-outcome">
      <h3 id="first-guide-outcome"><BookOpen size={18} aria-hidden="true" />완성할 결과</h3>
      <dl>
        <dt>질문</dt><dd>{libraryQuestion}</dd>
        <dt>답변 예시</dt><dd>회원증을 처음 만들 때는 <strong>신분증</strong>을 준비하시면 됩니다.</dd>
      </dl>
      <p><FileText size={15} aria-hidden="true" />사용한 자료 · 도서관 이용규정</p>
    </aside>
  </div>;
}

const quickSteps = [
  {step:2, image:'quick-open', width:433, height:98, title:'시험 실행 열기', action:'시험 실행 누르기', text:'편집기 위의 버튼을 누르면 실행 결과에 ‘Agent에게 보낼 질문’ 칸이 열립니다.',
    alt:'편집기 위쪽의 파란 시험 실행 버튼', mark:[46.2,11.2,51,79.5], fromRight:true},
  {step:3, image:'quick-question', width:816, height:446, title:'질문 보내기', action:'질문을 읽고 질문 실행 누르기', text:'“' + libraryQuestion + '”가 입력됐는지 확인하고 질문을 실행하세요.',
    alt:'회원증 질문이 채워진 입력란과 오른쪽 아래 질문 실행 버튼', mark:[72.2,77.5,26.3,19.7], fromRight:true},
  {step:4, image:'quick-answer', width:500, height:230, title:'답변 확인하기', action:'완료된 답에서 신분증 찾기', text:'실제 회원증 안내 기록입니다. 답변에 나온 준비물을 ‘도서관 이용규정’의 ‘자료 원문’과 대조하세요.',
    alt:'완료된 실행에 표시된 신분증 준비 안내', mark:[5.1,49.8,85.5,33]},
] as const;

export function FirstGuideSteps({onStep}: {onStep:(number:number) => void}) {
  return <section aria-labelledby="first-guide-quick" className={styles.quick}>
    <h3 id="first-guide-quick">예제를 연 뒤 따라 할 세 단계</h3>
    <ol>{quickSteps.map((item, i) => <li key={item.image}>
      <GuideVisual compact title={item.title} description={item.text} dialogSize="form">
        <AnnotatedGuideCapture number={i + 1} capture={item} />
      </GuideVisual>
      <a className={styles.stepTitle} href={guideAddress('start',item.step)} onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onStep(item.step);
      }}>
        {item.title}<ArrowRight size={16} aria-hidden="true" />
      </a>
    </li>)}</ol>
  </section>;
}
