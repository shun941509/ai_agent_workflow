import { ArrowUpRight, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import ResumeHeading from '../ProjectNameHeading';
import './workspace-home.css';

type Props = {
  resume: boolean;
  title: ReactNode;
  description: ReactNode;
  facts: ReactNode;
  artwork: ReactNode;
  onOpen: () => void;
  onIntro?: () => void;
  busy?: boolean;
  steps?: { title: string; detail?: string }[];
  practiceNote?: ReactNode;
};

export { ResumeHeading };

export default function HomeLayout({ resume, title, description, facts, artwork, onOpen, onIntro, busy, steps, practiceNote }: Props) {
  return <div className="lh-home"><div className="lh-content">
    <section className="lh-feature" aria-labelledby="lh-project-name">
      <div className="lh-copy">
        <p className="lh-context"><span aria-hidden="true" />{resume ? '이어서 작업' : '시작할 실습'}</p>
        {resume ? <ResumeHeading key={typeof title === 'string' ? title : 'library'} title={title} /> : <h1 id="lh-project-name">{title}</h1>}
        <p className="lh-summary">{description}</p>
        <div className="lh-facts">{facts}</div>
        <div className="lh-actions">
          <button className="lh-open" type="button" onClick={onOpen} disabled={busy}>
            {resume ? '편집기 다시 열기' : '실습 시작하기'}<ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.8}/>
          </button>
          {!resume && onIntro && <button className="lh-intro" type="button" data-lesson-trigger="home-intro" onClick={onIntro}>입문 실습 보기</button>}
        </div>
      </div>
      {artwork}
    </section>
    {steps && steps.length > 0 && <section className="lh-practice" aria-labelledby="lh-steps-heading">
      <div className="lh-practice-intro">
        <h2 id="lh-steps-heading">실습 순서</h2>
        {practiceNote && <p>{practiceNote}</p>}
      </div>
      <ol className="lh-steps">{steps.map((step, index) => <li key={index} className="lh-step">
        {step.detail ? <details>
          <summary>
            <span aria-hidden="true" className="lh-step-number">{String(index + 1).padStart(2, '0')}</span>
            <span>{step.title}</span><ChevronDown className="lh-step-chevron" aria-hidden="true" size={17}/>
          </summary>
          <p>{step.detail}</p>
        </details> : <div className="lh-static-step">
          <span aria-hidden="true" className="lh-step-number">{String(index + 1).padStart(2, '0')}</span>
          <span>{step.title}</span>
        </div>}
      </li>)}</ol>
    </section>}
  </div></div>;
}

export const libraryTitle = <>내 자료로 <br/>안내하기</>;
export const libraryDescription = <>도서관 이용규정으로 대출 질문에 답하고,<br className="lh-wide-break"/> 근거를 담은 안내 파일을 만듭니다.</>;
export const libraryPracticeNote = <>같은 질문으로 규정을 고치기 전과 후의<br className="lh-wide-break"/> 답변을 비교하세요.</>;
