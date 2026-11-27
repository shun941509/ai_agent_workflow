import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Play } from 'lucide-react';
import { levels, type Lesson } from '../../domain/types';
import type { WorkPurpose } from '../../domain/work-documents';
import { BlockReference, GuideGoals, GuideTroubleshooting, type BlockFilters, type GuideLesson } from '../WorkflowGuide';
import { GuideWalkthrough } from './GuideWalkthrough';
import { MenuReference } from './MenuReference';
import { VisualGlossary, type GlossaryTerm } from './VisualGlossary';
import referenceStyles from '../WorkflowGuide.module.css';
import { guideSteps } from './content';
import { FirstGuideStart, FirstGuideSteps } from './FirstGuideStart';
import { FirstGuideQuestions } from './FirstGuideQuestions';
import { GuideAgentConcept, GuideCoreFeatures, GuideUseCases } from './GuideVisualConcepts';
import { GuideCreationVisual } from './GuideCreationVisual';
import { guideAddress, guideSections, type GuidePosition, type GuideSection } from './navigation';
import styles from './GuidePage.module.css';

const stepLinks = ['준비 확인', '예제 열기', '질문 실행', '답변 확인', '지시 바꾸기'];

type Props = GuidePosition & {
  userId: string;
  lessons: readonly Omit<Lesson, 'graph'>[];
  lesson?: GuideLesson;
  busy?: boolean;
  hasExample?: boolean;
  practiceProjectId?: string;
  modelReady: boolean;
  onNavigate: (position: GuidePosition, href?: string) => void;
  onStartExample: () => void;
  onOpenTemplate: (id: string) => void;
  onStartWork: (id: WorkPurpose) => void;
  onStartBlank: () => void;
  onReturn: () => void;
  returnLabel: string;
};

function readNumber(key: string) {
  try {
    const value = Number(localStorage.getItem(key));
    return value >= 1 && value <= guideSteps.length && Number.isInteger(value) ? value : 1;
  } catch { return 1; }
}

function readChecks(key: string): number[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(values) ? values.filter(value => Number.isInteger(value) && value >= 1 && value <= guideSteps.length) : [];
  } catch { return []; }
}

function remember(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Keep the current page usable with storage disabled. */ }
}

function focusHelpIssue(issue: NonNullable<GuidePosition['issue']>) {
  const target = document.getElementById('guide-help-' + issue);
  target?.focus({preventScroll:true});
  target?.scrollIntoView({block:'start'});
}

function PracticeCheck({step, storageKey, success, available}: {step: number; storageKey: string; success: string; available: boolean}) {
  const [checked, setChecked] = useState(() => readChecks(storageKey).includes(step));
  function update(value: boolean) {
    setChecked(value);
    const otherSteps = readChecks(storageKey).filter(item => item !== step);
    remember(storageKey, JSON.stringify(value ? [...otherSteps, step] : otherSteps));
  }
  return <div className={styles.check}>
    <h3><Check aria-hidden="true" size={18} />완료 기준</h3>
    <p>{success}</p>
    {available ? <label><input type="checkbox" checked={checked} onChange={event => update(event.target.checked)} />
      {step === 1 ? '준비 상태를 직접 확인했어요' : '실제 편집기에서 직접 확인했어요'}</label>
      : <small>예제를 열고 돌아오면 내 실습의 완료 기준을 직접 체크할 수 있습니다.</small>}
  </div>;
}

export function GuidePage(props: Props) {
  return <GuideReader key={props.userId} {...props} />;
}

function GuideReader({
  section, step, issue, helpOrigin, userId, lessons, lesson, busy, hasExample, practiceProjectId, modelReady,
  onNavigate, onStartExample, onOpenTemplate, onStartWork, onStartBlank, onReturn, returnLabel,
}: Props) {
  const activeStep = Math.min(guideSteps.length, Math.max(1, step));
  const current = guideSteps[activeStep - 1];
  const issueOrigin = section === 'start' ? 'practice' : helpOrigin ?? 'guide';
  const bookmarkKey = 'studio.guide.read.' + userId;
  const [lastRead, setLastRead] = useState(() => readNumber(bookmarkKey));
  const [blockFilters, setBlockFilters] = useState<BlockFilters>({term: '', firstLevel: '전체'});
  const [glossaryTerm, setGlossaryTerm] = useState<GlossaryTerm>('Workflow');
  const focusReferenceLink = useRef(false);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const chapterHeading = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef(false);

  useEffect(() => {
    if (section === 'start' && activeStep > 1) {
      setLastRead(activeStep);
      remember(bookmarkKey, String(activeStep));
    }
  }, [section, activeStep, bookmarkKey]);

  useLayoutEffect(() => {
    pageHeading.current?.focus({preventScroll:true});
  }, []);
  useLayoutEffect(() => {
    if (section === 'help' && issue) focusHelpIssue(issue);
    else if (focusNext.current) chapterHeading.current?.focus();
    focusNext.current = false;
  }, [section, activeStep, issue]);

  function navigate(destination: GuideSection, targetStep: number, targetIssue?: GuidePosition['issue']) {
    if (section === destination && activeStep === targetStep && issue === targetIssue) {
      if (destination === 'help' && targetIssue) focusHelpIssue(targetIssue);
      else chapterHeading.current?.focus();
      return;
    }
    focusNext.current = true;
    onNavigate({section:destination, step:targetStep, issue:targetIssue, helpOrigin:targetIssue ? issueOrigin : undefined});
  }

  const previewParams = section === 'goals' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const previewSource = previewParams?.get('from');
  const linkedPreview = Boolean(previewParams?.get('template'));
  useLayoutEffect(() => {
    if (section === 'goals' && linkedPreview) document.getElementById('guide-template-title')?.focus();
    if (focusReferenceLink.current) {
      document.getElementById('guide-library-preview-link')?.focus();
      focusReferenceLink.current = false;
    }
  }, [section, linkedPreview]);

  const sourceParams = new URLSearchParams({template:'library-visit', from:section});
  if (section === 'blocks') {
    if (blockFilters.term) sourceParams.set('q', blockFilters.term);
    if (blockFilters.firstLevel !== '전체') sourceParams.set('level', blockFilters.firstLevel);
  }
  const libraryPreview = <a id="guide-library-preview-link" className={referenceStyles.referenceAction}
    href={guideAddress('goals', activeStep) + '&' + sourceParams}
    onClick={event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onNavigate({section:'goals', step:activeStep}, event.currentTarget.href);
    }}>도서관 방문 준비하기에서 보기</a>;
  const returnToReference = linkedPreview && (previewSource === 'terms' || previewSource === 'blocks') &&
    <button className={referenceStyles.referenceAction} type="button" onClick={() => {
      if (previewSource === 'terms') setGlossaryTerm('도구');
      else setBlockFilters({
        term: previewParams?.get('q') ?? '',
        firstLevel: levels.find(level => level === previewParams?.get('level')) ?? '전체',
      });
      focusReferenceLink.current = true;
      navigate(previewSource, activeStep);
    }}>{previewSource === 'terms' ? '도구 설명으로 돌아가기' : '블록·자료 검색 결과로 돌아가기'}</button>;

  const startLabel = hasExample ? '예제 편집기 열기' : '예제로 시작하기';
  const workButton = <button type="button" className="btn primary" disabled={busy} onClick={onStartExample}>
    <Play size={15} aria-hidden="true" />{startLabel}</button>;
  const bookmark = section === 'start' && activeStep > 1 ? activeStep : lastRead;
  function readStep(number: number) {
    // The overview can also be reached through reference menus without restarting the lesson.
    if (number === 1) {
      setLastRead(1);
      remember(bookmarkKey, '1');
    }
    navigate('start', number);
  }
  const stepNavigation = <div className={styles.stepNavigation}>
      <div className={styles.readHead}>
        <span>도서관 안내 실습</span>
        {bookmark > 1 && <div className={styles.readControls}>
          {activeStep === 1 && <button type="button" onClick={() => readStep(bookmark)}>읽던 {bookmark}단계 이어 보기</button>}
          <button type="button" onClick={() => readStep(1)}>처음부터 보기</button>
        </div>}
      </div>
      <nav aria-label="첫 실습 단계" className={styles.steps}><ol>
        {stepLinks.map((name, i) => <li key={name}>
          <button type="button" onClick={() => readStep(i + 1)} aria-current={activeStep === i + 1 ? 'step' : undefined}>
            <span>{i + 1}</span>{name}</button>
        </li>)}
      </ol></nav>
  </div>;
  return <article className={styles.page} aria-labelledby="guide-page-title">
    <header className={styles.header}>
      <h1 ref={pageHeading} id="guide-page-title" tabIndex={-1}>Workflow 설계 가이드</h1>
      <button type="button" className={styles.back} onClick={onReturn}><ArrowLeft size={16} aria-hidden="true" />{returnLabel}</button>
    </header>
    <nav className={styles.sections} aria-label="가이드 메뉴">
      {(Object.keys(guideSections) as GuideSection[]).map(id => {
        const targetStep = id === 'start' && section === 'start' ? bookmark : activeStep;
        const targetIssue = id === 'help' ? (section === 'start' ? current.helpId : issue) : undefined;
        return <a key={id} href={guideAddress(id, targetStep, targetIssue, issueOrigin)} aria-current={id === section ? 'page' : undefined}
          onClick={event => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigate(id, targetStep, targetIssue);
          }}>{guideSections[id]}</a>;
      })}
    </nav>
    {section === 'start' ? <>
      {activeStep !== 1 && stepNavigation}
      <section className={styles.chapter} aria-labelledby="guide-chapter-title">
        {activeStep === 1 ? <FirstGuideStart headingRef={chapterHeading} title={current.title} description={current.goal}
          modelReady={modelReady} workButton={workButton} /> : <header className={styles.chapterHeader}>
          <h2 id="guide-chapter-title" tabIndex={-1} ref={chapterHeading}>{current.title}</h2>
          <p>{current.goal}</p>
        </header>}
        {activeStep === 1 && <>
          <FirstGuideSteps onStep={readStep} />
          <GuideAgentConcept />
          <FirstGuideQuestions modelReady={modelReady} onHelp={topic => navigate('help', activeStep, topic)} />
          <section className={styles.nextUses} aria-labelledby="guide-next-uses">
            <h3 id="guide-next-uses">내 일에 써보기</h3>
            <div>
              <button type="button" onClick={() => onStartWork('meeting-report')} disabled={busy}>
                <strong>회의 메모로 회의록 만들기 <ArrowRight size={15} aria-hidden="true" /></strong>
                <span>확정된 일과 담당자를 표로 정리하는 예제를 엽니다.</span>
              </button>
              <button type="button" onClick={() => onOpenTemplate('beginner')} disabled={busy}>
                <strong>내 자료로 안내하기 <ArrowRight size={15} aria-hidden="true" /></strong>
                <span>자료 한 줄을 고치고 답변과 안내 파일이 어떻게 달라지는지 봅니다.</span>
              </button>
            </div>
          </section>
          <h3 className={styles.practiceTitle}>실습을 단계별로 따라가기</h3>
          {stepNavigation}
        </>}
        <GuideWalkthrough key={activeStep} step={current} workButton={activeStep !== 1 && workButton}>
          <PracticeCheck key={[activeStep, practiceProjectId].join('.')} step={activeStep}
            available={activeStep === 1 || Boolean(practiceProjectId)}
            storageKey={'studio.guide.checked.' + JSON.stringify([userId, activeStep === 1 ? 'setup' : practiceProjectId ?? 'library'])} success={current.success} />
          <section className={styles.tip} aria-labelledby="guide-step-tip-title">
            <h3 id="guide-step-tip-title">이 단계에서 막혔을 때</h3>
            <p>{current.tip}</p>
            <button className={styles.textButton} type="button" onClick={() => navigate('help', activeStep, current.helpId)}>문제 해결</button>
          </section>
        </GuideWalkthrough>
        {activeStep === 2 && <GuideCreationVisual />}
        <nav className={styles.turnPage} aria-label="단계 이동">
          {activeStep > 1 && <button type="button" onClick={() => readStep(activeStep - 1)}><ArrowLeft size={16} aria-hidden="true" />이전 단계</button>}
          <button type="button" onClick={() => activeStep === guideSteps.length ? navigate('goals', activeStep) : readStep(activeStep + 1)}>
            {activeStep === guideSteps.length ? '목적별로 만들기' : '다음 단계'}<ArrowRight size={16} aria-hidden="true" />
          </button>
        </nav>
      </section>
    </> : section === 'blocks' ? <BlockReference headingRef={chapterHeading} filters={blockFilters} onChange={setBlockFilters}
      libraryPreview={libraryPreview} />
      : section === 'menus' ? <MenuReference headingRef={chapterHeading} />
      : <section className={styles.lookup} aria-labelledby="guide-chapter-title">
      <h2 id="guide-chapter-title" tabIndex={-1} ref={chapterHeading}>{guideSections[section]}</h2>
      {section === 'goals' && <GuideGoals lesson={lesson} lessons={lessons} onStartBlank={onStartBlank} onOpenTemplate={onOpenTemplate} onStartWork={onStartWork} busy={busy}
        returnToReference={returnToReference} examples={!linkedPreview && <GuideUseCases step={activeStep} />} />}
      {section === 'terms' && <>
        <GuideCoreFeatures />
        <VisualGlossary selected={glossaryTerm} onSelect={setGlossaryTerm} libraryPreview={libraryPreview} />
      </>}
      {section === 'help' && <GuideTroubleshooting step={activeStep} issue={issue} origin={issueOrigin}
        onSelectIssue={id => navigate('help', activeStep, id)}
        onReturnToStep={() => navigate('start', activeStep)} />}
    </section>}
  </article>;
}
