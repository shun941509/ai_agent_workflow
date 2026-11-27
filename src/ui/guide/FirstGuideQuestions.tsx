import { libraryQuestion, libraryRule, type GuideHelpId } from './content';
import { GuideHelpVisual, type HelpVisualIssue } from './GuideHelpVisual';
import { GuideFigure } from './GuideFigure';
import styles from './FirstGuideQuestions.module.css';

type Question = {title:string; answer:string; issue:HelpVisualIssue; action:string};
const questions: Question[] = [
  {
    title: '질문을 어디에 입력하나요?',
    answer: '편집기에서 ‘시험 실행’을 열고 ‘Agent에게 보낼 질문’에 입력한 뒤 ‘질문 실행’을 누르세요. ‘작업 지시’에는 안내원이 매번 따라야 할 답변 방식을 씁니다.',
    issue: 'question', action: '질문 실행 도움말',
  },
  {
    title: '답에 나온 준비물을 어떻게 확인하나요?',
    answer: '편집기에서 ‘도서관 이용규정’을 선택하고 ‘속성’의 ‘자료 원문’을 여세요. 회원증을 처음 만들 때 가져오라는 물건이 답변에도 있는지 대조하세요.',
    issue: 'source', action: '자료 원문 도움말',
  },
  {
    title: '작업 지시를 바꿨는데 답이 그대로예요.',
    answer: '이미 받은 답은 실행 기록에 남습니다. ‘시험 실행’의 ‘실행 기록’에서 ‘＋ 새 대화’를 열고, ‘실행 설정’의 설계가 ‘현재 초안’인지 확인한 뒤 같은 질문을 보내세요.',
    issue: 'instruction', action: '지시 변경 도움말',
  },
];

const modelQuestion:Question = {
  title:'모델 설정 필요가 보이면 무엇을 할 수 있나요?',
  answer:'질문과 자료는 지금 열어 볼 수 있습니다. 실제 답변을 받으려면 작업실 운영자에게 모델 연결을 요청하세요.',
  issue:'model', action:'모델 연결 도움말',
};

export function FirstGuideQuestions({onHelp, modelReady}: {onHelp:(issue: GuideHelpId) => void; modelReady:boolean}) {
  return <div className={styles.support}>
    <section aria-labelledby="guide-question-examples">
      <h3 id="guide-question-examples">질문을 구체적으로 쓰는 법</h3>
      <figure className={styles.comparison}>
        <figcaption>도서관에 처음 가는 날, 안내원에게 무엇을 물어볼까요?</figcaption>
        <div className={styles.examples}>
          <div role="group" aria-labelledby="guide-broad-question" className={styles.example}>
            <h4 id="guide-broad-question">넓게 물었을 때</h4>
            <blockquote>“도서관에 가려는데 뭘 챙겨야 해요?”</blockquote>
            <p>대출인지 회원증 발급인지 알기 어려워, 안내원이 방문 목적을 다시 물을 수 있습니다.</p>
          </div>
          <div role="group" aria-labelledby="guide-specific-question" className={styles.example}>
            <h4 id="guide-specific-question">준비물을 지정했을 때</h4>
            <blockquote>“{libraryQuestion}”</blockquote>
            <p><strong>답변 예시</strong> “처음 회원증을 만들 때는 신분증을 가져오세요.”</p>
          </div>
        </div>
      </figure>
      <p className={styles.source}>예제의 이용규정에는 “{libraryRule}”라고 적혀 있습니다. 답변의 말투가 달라도 필요한 물건이 <strong>신분증</strong>인지 확인하세요.</p>
      <details className={styles.result}>
        <summary>이 질문의 실제 실행 결과 보기</summary>
        <GuideFigure id="04-answer" />
      </details>
    </section>
    <section aria-labelledby="guide-first-questions">
      <h3 id="guide-first-questions">첫 실습에서 자주 묻는 질문</h3>
      <div className={styles.questions}>
        {(modelReady?questions:[...questions,modelQuestion]).map(item => <details key={item.issue}>
          <summary>{item.title}</summary>
          <div className={styles.answer}>
            <p>{item.answer}</p>
            <GuideHelpVisual issue={item.issue}/>
            <button type="button" onClick={() => onHelp(item.issue)}>{item.action}</button>
          </div>
        </details>)}
      </div>
    </section>
  </div>;
}
