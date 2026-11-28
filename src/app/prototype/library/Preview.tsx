'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowUpRight, BookOpen, ChevronRight, DraftingCompass, FolderOpen, House, Layers3, X } from 'lucide-react';
import Home from './Home';
import Editor from './Editor';
import { rememberEditor, updateLibraryDraft, useLibraryDraft } from './preview-state';
import { cycleDialogFocus } from '../../../ui/dialog-focus';
import './preview.css';

export default function LibraryPreview() {
  const params = useSearchParams();
  const editor = params.get('view') === 'editor';
  const { draft, hasSaved, ready } = useLibraryDraft();
  const visit = params.get('visit');
  const returning = visit === 'return' || (visit !== 'first' && hasSaved);
  const guide = useRef<HTMLDialogElement>(null);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    if (editor) rememberEditor();
  }, [editor]);

  function navigate(toEditor: boolean, visitPreview?: 'first' | 'return') {
    const url = new URL(window.location.href);
    if (toEditor) rememberEditor();
    url.searchParams.set('view', toEditor ? 'editor' : 'home');
    if (!toEditor && visitPreview) url.searchParams.set('visit', visitPreview);
    else url.searchParams.delete('visit');
    window.history.pushState(null, '', url);
    window.scrollTo(0, 0);
    main.current?.focus({preventScroll:true});
  }

  return (
    <div className={'lp-shell' + (editor ? ' lp-editing' : '')}>
      <a className="lp-skip" href="#lp-work">본문으로 이동</a>
      <aside className="lp-rail" aria-label="작업실 탐색">
        <button className="lp-brand" onClick={() => navigate(false)} aria-label="Workflow Studio 홈">
          <span className="lp-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Workflow<br/>Studio</span>
        </button>
        <nav className="lp-nav" aria-label="작업 화면">
          <button onClick={() => navigate(false)} aria-current={!editor ? 'page' : undefined}><House/><span>작업실 홈</span></button>
          <button onClick={() => navigate(true)} aria-current={editor ? 'page' : undefined}><DraftingCompass/><span>Workflow 편집기</span></button>
        </nav>
        <div className="lp-resources">
          <button onClick={() => guide.current?.showModal()}><BookOpen/>실습 안내</button>
          <a href="/?view=templates" target="_blank" rel="noreferrer"><Layers3/>예제 템플릿<ArrowUpRight className="lp-external"/></a>
        </div>
        <a href="/" target="_blank" rel="noreferrer" className="lp-back"><FolderOpen/>실제 작업실 열기<ArrowUpRight className="lp-external"/></a>
      </aside>
      <div className="lp-panel">
        <header className="lp-bar">
          <div className="lp-crumb">워크스페이스<ChevronRight size={13}/><strong>{editor ? 'Workflow 편집기' : '작업실 홈'}</strong></div>
          <div className="lp-tools">
            {!editor && <label className="lp-view-option">
              <select aria-label="홈 방문 상태" value={returning ? 'return' : 'first'} onChange={e => navigate(false, e.target.value === 'return' ? 'return' : 'first')}>
                <option value="first">첫 방문</option><option value="return">다시 방문</option>
              </select>
            </label>}
            <span className="lp-proto"><span aria-hidden="true"/>디자인 시안</span>
          </div>
        </header>
        <main ref={main} id="lp-work" tabIndex={-1}>
          {!ready ? <p role="status">작업실을 여는 중입니다.</p> : editor ? (
            <Editor {...draft}
              onRuleChange={rule => updateLibraryDraft(current => ({ ...current, rule }))}
              onSelect={selected => updateLibraryDraft(current => ({ ...current, selected }))}
              onMove={(id, point) => updateLibraryDraft(current => ({
                ...current, selected: id, positions: { ...current.positions, [id]: point },
              }))}
            />
          ) : (
            <Home {...draft} returning={returning} hasSaved={hasSaved} onOpen={() => navigate(true)}/>
          )}
        </main>
      </div>
      <dialog ref={guide} className="lp-dialog" aria-labelledby="lp-guide-title" onKeyDown={cycleDialogFocus}>
        <header><h2 id="lp-guide-title">내 자료로 안내하기</h2><button aria-label="실습 안내 닫기" onClick={() => guide.current?.close()}><X size={19}/></button></header>
        <ol><li>편집기에서 ‘도서관 이용규정’ 블록을 여세요.</li><li>이용규정 원문에서 ‘3권’을 ‘5권’으로 직접 고쳐 적용하세요.</li><li>예시 결과에서 답변과 원문을 대조하고 대출안내.txt를 내려받으세요.</li></ol>
      </dialog>
    </div>
  );
}
