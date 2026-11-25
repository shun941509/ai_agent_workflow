import { useId, useState, type ReactNode } from 'react';
import type { Lesson } from '../../domain/types';
import { workDocuments, type WorkPurpose } from '../../domain/work-documents';
import { GuideFigure } from './GuideFigure';
import { OptionalPractice } from './OptionalPractice';
import { captures } from './captures';
import { templateOutcomes } from './template-outcomes';
import styles from './TemplateGallery.module.css';

type Template = Omit<Lesson, 'graph'>;
type Option = {id: string; title: string; level?: string};

const purposes: Record<string, string> = {
  intro: '내 자료로 답하게 하기',
  beginner: '내 자료로 답하게 하기',
  intermediate: '질문에 따라 다른 경로로 보내기',
  'library-visit': '도구와 자료로 방문 안내하기',
  parallel: '여러 Agent에게 나눠 맡기기',
  'peer-review': '여러 Agent에게 나눠 맡기기',
  dynamic: '여러 Agent에게 나눠 맡기기',
  release: '시험한 버전 게시·복구하기',
};

export function TemplateGallery({ lessons, initialId, displayedPracticeId, onOpenTemplate, onStartWork, busy, returnToReference }: {
  lessons: readonly Template[];
  initialId?: string;
  displayedPracticeId?: string;
  onOpenTemplate: (id: string) => void;
  onStartWork: (id: WorkPurpose) => void;
  busy?: boolean;
  returnToReference?: ReactNode;
}) {
  const picker = useId();
  const [selection, setSelection] = useState<string | undefined>(() =>
    (typeof window !== 'undefined' && (new URLSearchParams(window.location.search).get('template')
      || window.history.state?.guideTemplatePreview)) || initialId);
  const previews = lessons.filter(item => Object.hasOwn(purposes, item.id));
  const requirements = lessons.find(item => item.id === 'sw-requirements');
  const documents: Option[] = [
    ...(requirements ? [{id:requirements.id, title:'할 일 앱 요구사항'}] : []),
    ...workDocuments,
  ];
  const byPurpose = new Map<string, Option[]>([['업무 문서 만들기', documents]]);
  for (const item of previews) {
    const purpose = purposes[item.id];
    const group = byPurpose.get(purpose);
    if (group) group.push(item);
    else byPurpose.set(purpose, [item]);
  }
  const groups = Array.from(byPurpose.entries());
  const selected = [...documents, ...previews].find(item => item.id === selection) ?? documents[0];
  const template = previews.find(item => item.id === selected.id);
  const doc = workDocuments.find(item => item.id === selected.id);
  const captureId = selected.id === 'intro' ? 'terms-workflow' : 'goal-' + selected.id;
  const teamCaptureId = captureId + '-team';
  const outcome = templateOutcomes[selected.id];
  function select(id: string) {
    setSelection(id);
    const url = new URL(window.location.href);
    if (url.searchParams.has('template')) url.searchParams.set('template', id);
    window.history.replaceState({ ...window.history.state, guideTemplatePreview: id }, '', url);
  }

  return <div className={styles.gallery}>
    <fieldset className={styles.catalog}>
      <legend>만들고 싶은 결과</legend>
      {groups.map(([purpose, items]) => <div key={purpose} className={styles.purpose}>
        <p>{purpose}</p>
        {items.map(item => <label className={styles.option} key={item.id}>
          <input type="radio" name={picker} aria-label={item.title} value={item.id}
            checked={selected.id === item.id} onChange={() => select(item.id)} />
          <span>{item.level && <small>{item.level}</small>}{item.title}</span>
        </label>)}
      </div>)}
    </fieldset>
    <label className={styles.compactPicker}>만들고 싶은 결과
      <select value={selected.id} onChange={event => select(event.target.value)}>
        {groups.map(([purpose, items]) => <optgroup key={purpose} label={purpose}>
          {items.map(item => <option key={item.id} value={item.id}>{item.level && item.level + ' · '}{item.title}</option>)}
        </optgroup>)}
      </select>
    </label>
    <section className={styles.preview} key={selected.id} aria-label={selected.title + ' 미리보기'}>
      <header className={styles.previewHeader}>
        <div>{selected.level && <p>{selected.level} 실습</p>}<h3 id="guide-template-title" tabIndex={-1}>{selected.title}</h3>
          {returnToReference}</div>
        {template ? <button type="button" className="btn" disabled={busy} onClick={() => onOpenTemplate(template.id)}>이 템플릿 열기</button>
          : <button type="button" className="btn primary" disabled={busy} onClick={() => onStartWork(doc?.id ?? 'sw-requirements')}>
            {doc ? '이 업무로 설계하기' : '내 사본으로 시작'}</button>}
      </header>
      {doc ? <div className={styles.previewBody}>
        <section className={styles.layout}>
          <h4>{doc.inputLabel} 예시</h4><pre className={styles.sample}>{doc.sample}</pre>
          <h4>설계 요청문</h4><p>{doc.prompt}</p>
        </section>
        <section className={styles.results}><h4>출력 예시</h4>
          <table className={styles.outputTable} aria-label={doc.title + ' 예시'}>
            <thead><tr>{doc.output.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
            <tbody>{doc.output.rows.map(row => <tr key={row.join('/')}>{row.map((cell, i) => <td key={doc.output.columns[i]}>{cell}</td>)}</tr>)}</tbody>
          </table><p>{doc.output.summary}</p>
          <details><summary>{doc.material.name} · 1판</summary><p>{doc.material.content.replace(/^# [^\n]+\n/, '')}</p></details>
        </section>
      </div> : !template && requirements ? <div className={styles.previewBody}>
        <section className={styles.layout}><h4>사용자 요청</h4><p>{requirements.question}</p>
          <p>‘{requirements.title}’ 템플릿을 내 프로젝트에서 편집합니다.</p></section>
        <section className={styles.results}><h4>기능 요구사항 예시</h4><p>완료 항목 숨기기를 켜면 미완료 항목만 표시한다. {requirements.example}</p></section>
      </div> : template && <div className={styles.previewBody}>
        <section className={styles.layout}>
          <h4>블록 배치</h4>
          <GuideFigure id={captureId} title={selected.title + ' 블록 배치'} />
          <p>{outcome?.layout ?? template.description}</p>
          {captures[teamCaptureId] && <details>
            <summary>내부 블록 배치 보기</summary>
            <GuideFigure id={teamCaptureId} title={selected.title + ' 내부 블록 배치'} />
          </details>}
        </section>
        <section className={styles.results}>
          <h4>예상 결과</h4>
          <dl>
            <dt>입력 예시</dt><dd>{template.question}</dd>
            <dt>실행 조건</dt><dd>{outcome?.condition ?? template.task}</dd>
            <dt>출력 예시</dt><dd>{outcome?.result ?? template.example}</dd>
            {template.optionalPractice && displayedPracticeId !== template.id && <><dt>선택 실습</dt><dd><OptionalPractice lesson={template} /></dd></>}
          </dl>
        </section>
      </div>}
    </section>
  </div>;
}
