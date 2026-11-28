import { BookOpen, Download } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Lesson } from '../../domain/types';
import { librarySteps } from '../home/LibrarySteps';
import { OptionalPractice } from './OptionalPractice';
import { InspectionExerciseLink } from './InspectionExerciseLink';
import styles from './LessonHandout.module.css';

type Props = {
  lesson: Omit<Lesson, 'graph'>;
  setup?: ReactNode;
  action: ReactNode;
  actionHint?: string;
};

export default function LessonHandout({ lesson, setup, action, actionHint = '내 작업실에 이 실습의 사본을 만듭니다.' }: Props) {
  const beginner = lesson.id === 'beginner';
  const reviewFollowup = lesson.id === 'web-design-review-followup';
  const exampleFile = reviewFollowup ? 'order-review-followup.html' : 'order-management.html';
  const steps = <ol className={styles.steps}>{lesson.steps.map((step, index) => <li key={step}>
    <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
    <div>{beginner && librarySteps[index] && <h4>{librarySteps[index].title}</h4>}<p>{step}</p></div>
  </li>)}</ol>;
  return <div className={styles.handout}>
    <div className={styles.spread}>
      <div className={styles.cover}>
        <span className={styles.level}><BookOpen size={18} aria-hidden="true"/>{lesson.level} 실습</span>
        <h2>{lesson.title}</h2>
        <p>{setup ? lesson.description : lesson.goal || lesson.description}</p>
        <div className={styles.imprint}><small>{beginner ? '만들 파일' : '실습 주제'}</small>
          <strong>{beginner ? '대출안내.txt' : lesson.topic}</strong>
        </div>
      </div>
      <section className={styles.guide} aria-label="실습 안내">
        {setup}
        <InspectionExerciseLink lessonId={lesson.id} />
        {lesson.topic === '웹 디자인 개선' && <p>
          <a className="btn" href={'/examples/' + exampleFile} download={exampleFile}>
            <Download size={16} aria-hidden="true" />{reviewFollowup ? '리뷰 지적이 남은 주문 예제 내려받기' : '주문 관리 예제 내려받기'}
          </a>
        </p>}
        {!!lesson.skills?.length && <section className={styles.skills} aria-label="연결된 Skill">
          <h3>연결된 Skill</h3>
          <dl>{lesson.skills.map(skill => <div key={skill.id}>
            <dt>{skill.title}</dt>
            <dd>{skill.example}</dd>
            <dd className={styles.targets}>{skill.bundled && '원본 Skill · '}사용하는 블록 · {skill.targets.map(target => target.title).join(', ')}</dd>
          </div>)}</dl>
        </section>}
        {lesson.level === '전문가' ? <details><summary>실습 순서 보기</summary>{steps}</details>
          : <><h3>실습 순서</h3>{steps}</>}
        <details><summary>{setup ? '제공된 예시' : '제공된 예시와 완료 기준'}</summary>
          <p className={styles.example}>{lesson.example}</p>
          {!setup && <ul>{lesson.checks.map(check => <li key={check}>{check}</li>)}</ul>}
        </details>
        {lesson.optionalPractice && <details><summary>선택 실습</summary><OptionalPractice lesson={lesson}/></details>}
      </section>
    </div>
    <footer className={styles.action}>
      <span>{actionHint}</span>
      {action}
    </footer>
  </div>;
}
