import { useRef, useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { GuideFigure } from './GuideFigure';
import { libraryQuestion, quoteInstruction, type GuideStep } from './content';
import styles from './GuidePage.module.css';

type CopyTarget = '작업 지시' | '시험 질문';
type CopyNotice = { target: CopyTarget; message: string };

function CopySample({ target, sample, notice, onCopy }: {
  target: CopyTarget;
  sample: string;
  notice?: CopyNotice;
  onCopy: (target: CopyTarget, element: HTMLParagraphElement) => void;
}) {
  const text = useRef<HTMLParagraphElement>(null);
  const label = target === '작업 지시' ? '바꿀 작업 지시' : '보낼 질문';
  return <div className={styles.sample} role="group" aria-label={label}>
    <div><strong>{label}</strong>
      <button type="button" onClick={() => { if (text.current) onCopy(target, text.current); }}>
        <Copy size={15} aria-hidden="true" />{target} 복사</button>
    </div>
    <p ref={text}>{sample}</p>
    <span role="status">{notice?.target === target ? notice.message : ''}</span>
  </div>;
}

export function GuideWalkthrough({ step, workButton, children }: {
  step: GuideStep; workButton: ReactNode; children: ReactNode;
}) {
  const [notice, setNotice] = useState<CopyNotice>();
  const latestCopy = useRef(0);
  async function copy(target: CopyTarget, element: HTMLParagraphElement) {
    const request = ++latestCopy.current;
    const focused = document.activeElement;
    const { anchorNode, anchorOffset, focusNode, focusOffset } = window.getSelection() ?? {};
    setNotice(undefined);
    let message = target === '작업 지시' ? '작업 지시를 복사했습니다.' : '시험 질문을 복사했습니다.';
    try {
      await navigator.clipboard.writeText(element.textContent ?? '');
    } catch {
      if (request !== latestCopy.current || !element.isConnected) return;
      const selection = window.getSelection();
      if (document.activeElement !== focused || selection?.anchorNode !== anchorNode
        || selection?.anchorOffset !== anchorOffset || selection?.focusNode !== focusNode
        || selection?.focusOffset !== focusOffset) return;
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
        let copied = false;
        try { copied = document.execCommand('copy'); } catch { /* The text remains selected for manual copy. */ }
        if (copied) selection.removeAllRanges();
        else message = '문장을 선택했습니다. 기기의 복사 기능을 사용하세요.';
      } else message = '문장을 직접 선택해 복사하세요.';
    }
    if (request === latestCopy.current && element.isConnected) setNotice({target, message});
  }

  if (step.helpId === 'instruction') {
    const [edit, rerun, compare] = step.actions;
    const [instructionImage, resultImage] = step.images;
    return <div className={styles.walkthrough}>
      <GuideFigure id={instructionImage} eager />
      <div className={styles.directions}>
        <h3>작업 지시 바꾸기</h3>
        <p>{edit}</p>
        <CopySample target="작업 지시" sample={quoteInstruction} notice={notice} onCopy={copy} />
        {workButton}
        <h3 className={styles.rerunHeading}>같은 질문 다시 보내기</h3>
        <CopySample target="시험 질문" sample={libraryQuestion} notice={notice} onCopy={copy} />
        <p>{rerun}</p>
      </div>
      <section className={styles.comparison}>
        <h3>변경 전후 답변</h3>
        <p>{compare}</p>
        <div><section><h4>첫 답변</h4><GuideFigure id="04-answer" /></section>
          <section><h4>지시를 바꾼 답변</h4><GuideFigure id={resultImage} /></section></div>
      </section>
      <div className={styles.directions}>{children}</div>
    </div>;
  }

  return <div className={styles.walkthrough}>
    <div className={styles.images}>{step.images.map((id, index) => id === 'source-rule'
      ? <details className={styles.imageDetail} key={id}><summary>비교할 규정 원문 보기</summary><GuideFigure id={id} /></details>
      : <GuideFigure id={id} key={id} eager={index === 0} />)}</div>
    <div className={styles.directions}>
      <h3>따라 하기</h3>
      <ul>{step.actions.map(text => <li key={text}>{text}</li>)}</ul>
      {step.sample && <CopySample target="시험 질문" sample={step.sample} notice={notice} onCopy={copy} />}
      {workButton}
      {children}
    </div>
  </div>;
}
