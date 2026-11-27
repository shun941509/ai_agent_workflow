import { useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type Ref } from 'react';
import { ArrowRight } from 'lucide-react';
import { byType, palette } from '../domain/catalog';
import { levels, type Level, type Lesson } from '../domain/types';
import { BlockIcon } from './editor/Icons';
import { guideHelp, type GuideHelpId } from './guide/content';
import { guideAddress, type GuideHelpOrigin } from './guide/navigation';
import { GuideFigure } from './guide/GuideFigure';
import { TemplateGallery } from './guide/TemplateGallery';
import type { WorkPurpose } from '../domain/work-documents';
import { OptionalPractice } from './guide/OptionalPractice';
import styles from './WorkflowGuide.module.css';

export type GuideLesson = Pick<Lesson, 'id' | 'title' | 'task' | 'steps' | 'question' | 'example' | 'checks' | 'optionalPractice' | 'optionalSteps'> & {showPreparedRelease?: boolean};

// A jump within the guide should leave its return-to-workspace history entry intact.
function jumpToReference(event: MouseEvent<HTMLAnchorElement>) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const heading = document.getElementById(event.currentTarget.hash.slice(1));
  if (!heading) return;
  event.preventDefault();
  heading.focus({preventScroll: true});
  heading.scrollIntoView({block: 'start'});
}

const resources = [
  { name: '참고 자료', description: 'Agent가 읽을 원문입니다. 수령 규정을 참고 자료로 연결하면 준비물 안내에 그 규정을 쓸 수 있습니다.', aliases: '문서 파일', source: '수령 규정', target: '방문 안내 Agent' },
  { name: 'Skill', description: 'Agent가 따를 작업 방법입니다. 도구 및 자료에 SKILL.md를 등록한 뒤 AI 작업 블록에서 사용할 Skill을 고르세요.', aliases: '스킬 지침 마크다운', source: '방문 안내 작성 Skill', target: '방문 안내 Agent' },
  { name: '지식 저장소', description: '질문에 맞는 구절을 찾을 자료 모음입니다. 자료 검색 블록이 운영 안내에서 토요일 운영시간을 찾습니다.', aliases: '지식저장소 RAG', source: '중앙도서관 운영 안내', target: '토요일 운영시간 검색' },
  { name: 'MCP 연결', description: '외부 도구를 호출하는 연결입니다. 예제에서는 도구 사용 블록이 도서관의 예약 조회 도구를 호출합니다.', aliases: '엠시피 외부 도구', source: '도서관 예약 조회 MCP', target: '내 예약 조회', blockType: 'tool.invoke' },
];

export type BlockFilters = { term: string; firstLevel: Level | '전체' };

function RelatedBlock({type}: {type: string}) {
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const panelId = useId();
  const block = byType.get(type);
  useLayoutEffect(() => { if (expanded) heading.current?.focus(); }, [expanded]);
  if (!block) return null;
  return <div className={styles.relatedBlock}>
    <button ref={trigger} type="button" className={styles.referenceAction} aria-expanded={expanded} aria-controls={panelId}
      onClick={() => setExpanded(!expanded)}>사용하는 블록 · {block.name}({block.level})</button>
    <section id={panelId} aria-labelledby={panelId + '-title'} hidden={!expanded}>
      <h4 ref={heading} tabIndex={-1} id={panelId + '-title'}>{block.name}</h4>
      <p>{block.level}부터 추천 · {block.description}</p>
      <button type="button" className={styles.referenceAction} onClick={() => {
        setExpanded(false);
        trigger.current?.focus();
      }}>검색 결과로 돌아가기</button>
    </section>
  </div>;
}

export function BlockReference({filters, onChange, headingRef, libraryPreview}: {
  filters: BlockFilters;
  onChange: (filters: BlockFilters) => void;
  headingRef: Ref<HTMLHeadingElement>;
  libraryPreview: ReactNode;
}) {
  const levelGroup = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const {term, firstLevel} = filters;
  const query = term.trim().toLocaleLowerCase('ko');
  const matches = (...parts: string[]) => parts.join(' ').toLocaleLowerCase('ko').includes(query);
  const blocks = palette.filter(block => (firstLevel === '전체' || block.level === firstLevel)
    && matches(block.name, block.description, ...(block.modes ?? []).map(mode => mode.label)));
  const materials = resources.filter(item => matches(item.name, item.description, item.aliases, item.source, item.target));
  return <section className={styles.reference} aria-labelledby="guide-block-reference">
    <h2 ref={headingRef} id="guide-block-reference" tabIndex={-1}>블록·자료 찾아보기</h2>
    <div className={styles.filters}>
      <label className={styles.search}>
        블록·자료 이름 검색
        <input ref={searchInput} type="search" value={term} placeholder="AI 작업, Skill, 지식 저장소" onChange={event => onChange({...filters, term:event.target.value})} />
      </label>
      <fieldset className={styles.levelPicker}>
        <legend>블록 추천 수준</legend>
        <div>{(['전체', ...levels] as const).map(level => <label key={level}>
          <input type="radio" name={levelGroup} checked={firstLevel === level} onChange={() => onChange({...filters, firstLevel:level})} />
          <span>{level}</span>
        </label>)}</div>
      </fieldset>
    </div>
    <div className={styles.resultBar}>
      <p role="status">{!blocks.length && !materials.length
        ? '일치하는 항목이 없습니다.'
        : `설계 블록 ${blocks.length}개 · 자료 종류 ${materials.length}개`}</p>
      {!blocks.length && !materials.length && <button type="button" className={styles.referenceAction} onClick={() => {
        onChange({term:'', firstLevel:'전체'});
        searchInput.current?.focus();
      }}>검색 조건 초기화</button>}
      {blocks.length > 0 && materials.length > 0 &&
        <a className={styles.materialJump} href="#guide-material-reference" onClick={jumpToReference}>자료 설명으로 이동</a>}
    </div>
    <div className={styles.columns}>
      {blocks.length > 0 && <section>
        <h3>편집기에서 추가하는 블록</h3>
        {levels.map(level => {
          const items = blocks.filter(item => item.level === level);
          if (!items.length) return null;
          return <div className={styles.level} key={level}>
            <h4>{level}부터 추천 · {items.length}개</h4>
            <dl className={styles.terms}>{items.map(item => <div key={item.type}>
              <dt className={styles.iconLabel}><BlockIcon type={item.type} />{item.name}</dt>
              <dd>{item.description}</dd>
            </div>)}</dl>
          </div>;
        })}
      </section>}
      {materials.length > 0 && <section>
        <h3 id="guide-material-reference" tabIndex={-1}>도구 및 자료에서 등록하는 자료</h3>
        <p className={styles.referenceHint}>각 자료가 어느 블록에 연결되는지 예제에서 확인하세요.</p>
        {libraryPreview}
        <dl className={styles.materials}>{materials.map(item => <div key={item.name}>
          <dt>{item.name}</dt>
          <dd>{item.description}
            <span className={styles.resourceFlow}>
              <span>{item.source}</span>
              <span className={styles.uses}><ArrowRight size={15} aria-hidden="true" /><span className={styles.srOnly}>사용하는 블록</span></span>
              <span>{item.target}</span>
            </span>
            {item.blockType && <RelatedBlock type={item.blockType} />}
          </dd>
        </div>)}</dl>
      </section>}
    </div>
  </section>;
}

export function LessonReference({lesson, onOpenTemplate, busy}: {lesson: GuideLesson; onOpenTemplate: (id: string) => void; busy?: boolean}) {
  return <section className={styles.currentLesson}>
    <h3>{lesson.title} 실습 안내</h3>
    <p>{lesson.task}</p>
    <ol>{lesson.steps.map(step => <li key={step}>{step}</li>)}</ol>
    <h4>시험 질문</h4>
    <p>{lesson.question}</p>
    <details className={styles.disclosure}>
      <summary>제공된 예시와 완료 기준 보기</summary>
      <p>{lesson.example}</p>
      <ul>{lesson.checks.map(item => <li key={item}>{item}</li>)}</ul>
    </details>
    {lesson.optionalPractice && <><h4>선택 실습</h4><OptionalPractice lesson={lesson} /></>}
    {lesson.showPreparedRelease && <div>
      <p>게시·보류·복구 판단을 연습하려면 두 판과 시험 사례 세 개가 준비된 템플릿을 여세요.</p>
      <button className="btn" type="button" disabled={busy} onClick={() => onOpenTemplate('release')}>기준판·후보판이 준비된 실습 열기</button>
    </div>}
  </section>;
}

export function GuideGoals({lessons, onOpenTemplate, onStartWork, onStartBlank, busy, lesson, returnToReference, examples}: {
  lessons: readonly Omit<Lesson, 'graph'>[];
  onOpenTemplate: (id: string) => void;
  onStartWork: (id: WorkPurpose) => void;
  onStartBlank: () => void;
  busy?: boolean;
  lesson?: GuideLesson;
  returnToReference?: ReactNode;
  examples?: ReactNode;
}) {
  return <div>
    {lesson && <LessonReference lesson={lesson} onOpenTemplate={onOpenTemplate} busy={busy}/>}
    {examples}
    <TemplateGallery lessons={lessons} initialId={lesson?.id} displayedPracticeId={lesson?.optionalPractice ? lesson.id : undefined} onOpenTemplate={onOpenTemplate} onStartWork={onStartWork} busy={busy}
      returnToReference={returnToReference} />
    <section className={styles.blank}>
      <h3>직접 배치하고 연결하기</h3>
      <p>빈 편집기에 질문, 자료, AI 작업, 답변 블록을 놓고 회원증 안내를 다시 만들어 보세요.</p>
      <button type="button" className="btn" disabled={busy} onClick={onStartBlank}>빈 설계 시작하기</button>
    </section>
  </div>;
}

export function GuideTroubleshooting({issue, step, origin, onSelectIssue, onReturnToStep}: {
  issue?: GuideHelpId;
  step: number;
  origin: GuideHelpOrigin;
  onSelectIssue: (id: GuideHelpId) => void;
  onReturnToStep: () => void;
}) {
  return <div>
    <nav className={styles.jumpLinks} aria-label="문제 상황 바로가기">
      {guideHelp.map(item => <a key={item.id} href={guideAddress('help', step, item.id, origin)}
        aria-current={issue === item.id ? 'location' : undefined} onClick={event => {
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
          event.preventDefault();
          onSelectIssue(item.id);
        }}>{item.shortLabel}</a>)}
    </nav>
    {guideHelp.map(item => {
      const headingId = 'guide-help-' + item.id;
      return <section key={item.id} className={styles.helpCase} aria-labelledby={headingId}>
        <h3 id={headingId} tabIndex={-1}>{item.title}</h3>
        <div className={styles.helpBody}>
          <div>
            <h4>해결 방법</h4>
            <ol>{item.actions.map(action => <li key={action}>{action}</li>)}</ol>
            <div className={styles.helpCheck}><h4>해결 확인</h4><p>{item.success}</p></div>
            {origin === 'practice' && issue === item.id && <button type="button" className="btn" onClick={onReturnToStep}>{step}단계로 돌아가기</button>}
          </div>
          <GuideFigure id={item.image} eager={issue === item.id} />
        </div>
      </section>;
    })}
  </div>;
}
