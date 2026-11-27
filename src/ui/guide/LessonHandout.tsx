import { BookOpen, ClipboardCopy } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Lesson } from '../../domain/types';
import { librarySteps } from '../home/LibrarySteps';
import { OptionalPractice } from './OptionalPractice';
import styles from './LessonHandout.module.css';

type Props = {
  lesson: Omit<Lesson, 'graph'>;
  setup?: ReactNode;
  actionLabel: string;
  onStart: () => void;
  busy: boolean;
};

export default function LessonHandout({ lesson, setup, actionLabel, onStart, busy }: Props) {
  const beginner = lesson.id === 'beginner';
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
          <strong>{beginner ? '대출안내.txt' : lesson.id.startsWith('sw-') ? '할 일 앱 실습' : '도서관 실습'}</strong>
        </div>
      </div>
      <section className={styles.guide} aria-label="실습 안내">
        {setup}
        {lesson.level === '전문가' ? <details><summary>실습 순서 보기</summary>{steps}</details>
          : <><h3>실습 순서</h3>{steps}</>}
        <details><summary>{setup ? '제공된 예시' : '제공된 예시와 완료 기준'}</summary>
          <p className={styles.example}>{lesson.example}</p>
          {!setup && <ul>{lesson.checks.map(check => <li key={check}>{check}</li>)}</ul>}
        </details>
        {lesson.optionalPractice && <details><summary>선택 실습</summary><OptionalPractice lesson={lesson}/></details>}
      </section>
    </div>
    {!setup && <footer className={styles.action}><span>내 작업실에 이 실습의 사본을 만듭니다.</span>
      <button type="button" className="btn primary" disabled={busy} onClick={onStart}><ClipboardCopy size={16} aria-hidden="true"/>{actionLabel}</button>
    </footer>}
  </div>;
}
