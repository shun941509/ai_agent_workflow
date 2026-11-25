import { useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { practiceSteps, type GuidePractice } from './practice-steps';
import { libraryQuestion } from '../guide/content';
import styles from './PracticeCoach.module.css';

export type PracticeCoachHandle = { resume: (guideStep?: number) => void; guideStep: () => number };

type Position = { step: number; collapsed: boolean };
const firstPosition: Position = { step: 0, collapsed: false };
// Browsers with disabled or full storage can still move between the canvas and inspectors.
const unsavedPositions = new Map<string, Position>();

function readPosition(key: string, count: number): Position {
  const unsaved = unsavedPositions.get(key);
  if (unsaved) return unsaved;
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (saved && Number.isInteger(saved.step) && saved.step >= 0 && saved.step < count) {
      return { step: saved.step, collapsed: saved.collapsed === true };
    }
  } catch { /* The guide also works with browser storage disabled. */ }
  return firstPosition;
}

export default function PracticeCoach({ practice, userId, projectId, hasExampleAnswer, onOpenGuide, onStartBlank, onOpenTemplate, ref }: {
  practice: GuidePractice;
  userId: string;
  projectId: string;
  hasExampleAnswer: boolean;
  onOpenGuide: () => void;
  onStartBlank: () => void;
  onOpenTemplate: (id: string) => void;
  ref?: Ref<PracticeCoachHandle>;
}) {
  const steps = practiceSteps[practice];
  const storageKey = 'studio.guide.step.' + JSON.stringify([userId, projectId, practice]);
  const [position, setPosition] = useState(() => readPosition(storageKey, steps.length));
  const title = useRef<HTMLHeadingElement>(null);
  const reading = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  const contentId = useId();
  const current = steps[position.step];
  const last = position.step === steps.length - 1;

  function remember(next: Position) {
    setPosition(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      unsavedPositions.delete(storageKey);
    } catch {
      unsavedPositions.set(storageKey, next);
    }
  }
  function showStep(step: number) {
    pendingFocus.current = true;
    remember({ step, collapsed: false });
  }
  useLayoutEffect(() => {
    if (!pendingFocus.current || position.collapsed) return;
    pendingFocus.current = false;
    if (reading.current) reading.current.scrollTop = 0;
    title.current?.focus({ preventScroll: true });
  }, [position]);
  useImperativeHandle(ref, () => ({
    resume(guideStep) {
      if (practice === 'example' && guideStep === 5) showStep(Math.max(1, position.step));
      else if (practice === 'example' && (guideStep === 3 || guideStep === 4)) showStep(0);
      else showStep(position.step);
    },
    guideStep: () => position.step > 0 ? 5 : hasExampleAnswer ? 4 : 3,
  }));

  return <section className={styles.coach} aria-label="현재 실습 안내" data-practice-coach>
    <button className={styles.toggle} type="button" aria-controls={contentId} aria-expanded={!position.collapsed}
      aria-describedby={contentId + '-name ' + contentId + '-position'}
      aria-label={position.collapsed ? '단계 안내 펼치기' : '단계 안내 접기'}
      onClick={() => remember({ ...position, collapsed: !position.collapsed })}>
      <BookOpen size={16} aria-hidden="true" />
      <span id={contentId + '-name'} className={styles.practiceName}>{position.collapsed ? current.title : practice === 'example' ? '예시 답변 바꾸기' : '빈 설계로 만들기'}</span>
      <span id={contentId + '-position'} className={styles.number}>{position.step + 1}/{steps.length} 단계</span>
      <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
    </button>
    <div id={contentId} className={styles.frame} hidden={position.collapsed}>
      <div className={styles.reading} ref={reading} tabIndex={0} role="group" aria-label="현재 단계 설명">
        <h3 className={styles.title} ref={title} tabIndex={-1}>{current.title}</h3>
        {practice === 'example' && position.step > 0 && !hasExampleAnswer &&
          <div className={styles.prerequisite}>
            <strong>비교할 첫 답변이 필요합니다</strong>
            <p>지시를 바꾸기 전에 ‘시험 실행’에서 “{libraryQuestion}”를 보내고 ‘완료’된 답변을 확인하세요.</p>
            <button type="button" className={styles.overview} onClick={() => showStep(0)}>첫 답변 읽기로 이동</button>
          </div>}
        <p className={styles.check}><strong>완료 기준</strong>{current.check}</p>
        <div className={styles.instructions}>{current.instructions}</div>
        <details className={styles.help} key={position.step}>
          <summary>결과가 다를 때</summary>
          <p>{current.help}</p>
        </details>
        {last && <div className={styles.continue}>
          <strong>이어서 할 실습</strong>
          {practice === 'example' && <button type="button" onClick={onStartBlank}>빈 설계로 직접 만들기</button>}
          <p>내 규정을 고쳐 안내 파일을 만들려면</p>
          <button type="button" onClick={() => onOpenTemplate('beginner')}>내 자료로 안내하기</button>
          {practice === 'blank' && <>
            <p>질문에 따라 다른 답변 경로를 쓰려면</p>
            <button type="button" onClick={() => onOpenTemplate('intermediate')}>근거 찾기와 추가 질문</button>
          </>}
        </div>}
      </div>
      <div className={styles.controls}>
        <button type="button" className={styles.overview} onClick={onOpenGuide}>전체 가이드</button>
        <button type="button" aria-label="이전 단계" disabled={position.step === 0} onClick={() => showStep(position.step - 1)}>
          <ChevronLeft size={14} aria-hidden="true" />이전
        </button>
        <button type="button" aria-label="다음 단계" disabled={last} onClick={() => showStep(position.step + 1)}>
          다음<ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  </section>;
}
