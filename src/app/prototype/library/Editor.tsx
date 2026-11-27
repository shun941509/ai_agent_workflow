'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  ArrowDownToLine, ArrowRight, Check, ChevronRight, FileText, Layers3, List,
  PanelRight, Play, Quote, Search, Workflow, X,
} from 'lucide-react';
import LibraryGraph, { NodeIcon } from './LibraryGraph';
import { nodes, type NodeId, type Point, type Positions } from './graph-model';
import { readLoanRule } from './library-rule';
import { cycleDialogFocus } from '../../../ui/dialog-focus';
import './editor.css';

const sequence: NodeId[] = ['input', 'agent', 'file', 'output'];
const references: NodeId[] = ['rules', 'skill'];
const nodeList = [...sequence, ...references].map((id) => nodes[id]);
const question = '책을 몇 권까지 빌릴 수 있나요?';
const filename = '대출안내.txt';
const details: Record<Exclude<NodeId, 'rules'>, { label: string; text: string }> = {
  input: { label: '시험 질문', text: question },
  agent: { label: '작업 목표', text: '도서관 규정에서 질문에 필요한 사실을 확인하고, 답변에 사용한 원문 한 문장을 함께 인용합니다.' },
  file: { label: '파일 내용', text: '안내 Agent의 답변과 인용한 원문을 텍스트 파일에 담습니다.' },
  output: { label: '전달할 내용', text: '이용자에게 대출 한도와 원문 인용, 내려받을 수 있는 대출 안내 파일을 함께 전달합니다.' },
  skill: { label: 'Skill 본문', text: '답변을 먼저 쓰고 다음 줄에 사용한 원문을 한 문장 인용합니다. 해당 사실이 없으면 확인 필요라고 안내합니다.' },
};
const related: Record<NodeId, NodeId[]> = {
  input: ['agent'], agent: ['input', 'rules', 'skill', 'file'], file: ['agent', 'output'],
  output: ['file'], rules: ['agent'], skill: ['agent'],
};

type SelectionProps = { selected: NodeId; selectNode: (id: NodeId) => void };

function Palette({ selected, selectNode }: SelectionProps) {
  const [filter, setFilter] = useState('');
  const matches = nodeList.filter((node) => (node.name + node.role).toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <aside className="le-palette" aria-label="블록 팔레트">
      <h2 className="le-panel-heading"><Layers3 size={16} />블록 팔레트</h2>
      <label className="le-search"><Search size={15} /><input aria-label="블록 찾기" placeholder="블록 찾기" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
      {[
        { title: '실행 블록', ids: sequence },
        { title: '자료와 지침', ids: references },
      ].map((group) => {
        const items = matches.filter((node) => group.ids.includes(node.id));
        return items.length > 0 && <section className="le-palette-group" key={group.title}>
          <h3>{group.title}</h3>
          {items.map((node) => <button type="button" key={node.id} aria-pressed={selected === node.id}
            className="le-palette-item" onClick={() => selectNode(node.id)}>
            <NodeIcon node={node} /><span>{node.name}</span>
          </button>)}
        </section>;
      })}
      {matches.length === 0 && <p className="le-no-match">일치하는 블록이 없습니다.</p>}
    </aside>
  );
}

function NodeList({ selected, selectNode }: SelectionProps) {
  return <div className="le-node-list">
    {[{ label: '실행 순서', ids: sequence }, { label: 'Agent가 참조하는 블록', ids: references }].map((group) =>
      <section key={group.label}><h3>{group.label}</h3>{group.ids.map((id, index) => <button type="button"
        className="le-list-row" key={id} aria-pressed={id === selected} onClick={() => selectNode(id)}>
        <span className="le-list-index">{group.ids === sequence ? index + 1 : <ArrowRight size={13} />}</span>
        <NodeIcon node={nodes[id]} /><strong>{nodes[id].name}</strong><ChevronRight size={14} />
      </button>)}</section>)}
  </div>;
}

type GraphProps = {
  positions: Positions;
  selected: NodeId;
  onSelect: (id: NodeId) => void;
  onMove: (id: NodeId, point: Point) => void;
};

function Canvas(props: GraphProps) {
  const [listView, setListView] = useState(false);
  return <section className="le-canvas" aria-label="워크플로 캔버스">
    <div className="le-canvas-header">
      <h2><Workflow size={16} />워크플로 캔버스</h2>
      <div className="le-view-toggle" role="group" aria-label="캔버스 보기">
        <button type="button" title="연결도 보기" aria-label="연결도 보기" aria-pressed={!listView} onClick={() => setListView(false)}><Workflow size={15} /></button>
        <button type="button" title="목록 보기" aria-label="목록 보기" aria-pressed={listView} onClick={() => setListView(true)}><List size={16} /></button>
      </div>
    </div>
    <div className={`le-canvas-content${listView ? ' le-canvas-show-list' : ''}`}>
      <LibraryGraph {...props} />
      <NodeList selected={props.selected} selectNode={props.onSelect} />
    </div>
    <footer className="le-canvas-footer"><span>블록 6개</span>
      <ul aria-label="연결선 종류">{[['flow', '진행'], ['data', '데이터'], ['reference', '참조']].map(([kind, name]) =>
        <li key={kind}><i className={`le-legend-${kind}`} />{name}</li>)}</ul>
    </footer>
  </section>;
}

type RuleProps = { rule: string; onRuleChange: (source: string) => void };
function Inspector({ selected, selectNode, rule, onRuleChange, titleRef }: SelectionProps & RuleProps & {titleRef: RefObject<HTMLHeadingElement | null>}) {
  const [pending, setPending] = useState<string | null>(null);
  const [lastApplied, setLastApplied] = useState<string | null>(null);
  const draft = pending ?? rule;
  const dirty = draft !== rule;
  const empty = !draft.trim();
  let notice = '';
  if (empty) notice = '적용할 도서관 이용규정을 입력하세요.';
  else if (dirty) notice = '미리보기에는 마지막으로 적용한 원문이 쓰입니다.';
  else if (lastApplied === rule) notice = '수정한 원문을 적용했습니다.';
  const node = nodes[selected];
  function apply() {
    onRuleChange(draft);
    setPending(null);
    setLastApplied(draft);
  }
  return <aside className="le-inspector" aria-label="블록 속성">
    <h2 className="le-panel-heading"><PanelRight size={16} />블록 속성</h2>
    <div className="le-inspect-title"><NodeIcon node={node} /><div><small>{node.role}</small><h3 ref={titleRef} tabIndex={-1}>{node.name}</h3></div></div>
    {selected === 'rules' ? <section className="le-inspect-section">
      <label className="le-source-label" htmlFor="le-rule-source">자료 원문</label>
      <textarea id="le-rule-source" className="le-source-input" rows={9} value={draft}
        aria-invalid={empty} aria-describedby="le-rule-status" onChange={(event) => {
          setPending(event.target.value === rule ? null : event.target.value);
          setLastApplied(null);
        }} />
      <button type="button" className="le-apply" disabled={!dirty || empty} onClick={apply}><Check size={15} />변경 적용</button>
      <p id="le-rule-status" className="le-status" role="status">{notice}</p>
    </section> : <section className="le-inspect-section"><h4>{details[selected].label}</h4><p className="le-description">{details[selected].text}</p>
      {selected === 'file' && <div className="le-filename"><FileText size={15}/>{filename}</div>}
    </section>}
    <section className="le-inspect-section le-connections"><h4>연결된 블록</h4>
      {related[selected].map((id) => <button type="button" key={id} onClick={() => selectNode(id)}><NodeIcon node={nodes[id]} />{nodes[id].name}<ChevronRight size={15} /></button>)}
    </section>
  </aside>;
}

function Result({ rule, close }: { rule: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const fileLink = useRef<HTMLAnchorElement>(null);
  const { limit, quote } = readLoanRule(rule);
  const answer = limit === null
    ? '이 규정에서 한 사람의 대출 한도를 확인하기 어렵습니다. 원문을 확인해 주세요.'
    : `한 사람당 최대 ${limit}권까지 빌릴 수 있습니다.`;
  useEffect(() => {
    if (!fileLink.current) return;
    const file = new Blob([answer, '\n“', quote, '”\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(file);
    fileLink.current.href = url;
    return () => URL.revokeObjectURL(url);
  }, [answer, quote]);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="le-result" aria-labelledby="le-result-title" onKeyDown={cycleDialogFocus} onCancel={close} onClick={(event) => {
    if (event.target === event.currentTarget) close();
  }}>
    <div className="le-result-inner">
      <div className="le-dialog-heading"><div><span><Play size={13} />예시 실행</span><h2 id="le-result-title">결과 미리보기</h2></div>
        <button type="button" className="le-close" aria-label="미리보기 닫기" onClick={close}><X size={20} /></button>
      </div>
      <section className="le-result-question"><h3>질문 입력</h3><p>{question}</p></section>
      <section className="le-result-answer"><h3><NodeIcon node={nodes.agent} />도서관 안내 Agent</h3><p>{answer}</p>
        <blockquote><Quote size={16} aria-hidden="true" /><div><span className="le-quoted-text">{quote}</span><cite>도서관 이용규정</cite></div></blockquote></section>
      <a ref={fileLink} download={filename} className="le-download"><FileText size={20} /><span>{filename} 내려받기</span><ArrowDownToLine size={17} /></a>
    </div>
  </dialog>;
}

export default function Editor({ rule, onRuleChange, positions, selected, onSelect, onMove }: RuleProps & GraphProps) {
  const [mobilePanel, setMobilePanel] = useState<'canvas' | 'inspector'>('canvas');
  const [preview, setPreview] = useState(false);
  const inspectorTitle = useRef<HTMLHeadingElement>(null);
  const selectionTrigger = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const trigger = selectionTrigger.current;
    selectionTrigger.current = null;
    if (trigger && !trigger.getClientRects().length) inspectorTitle.current?.focus();
  }, [selected, mobilePanel]);
  function selectNode(id: NodeId) {
    selectionTrigger.current = document.activeElement;
    onSelect(id);
    setMobilePanel('inspector');
  }
  return <div className="le-editor">
    <header className="le-project-header"><div>
      <div className="le-project-name"><h1>내 자료로 안내하기</h1><span>초급</span></div>
      <p>대출 한도를 3권에서 5권으로 바꾸고 같은 질문으로 결과를 확인하세요.</p>
    </div><button className="le-run" type="button" onClick={() => setPreview(true)}><Play size={15} fill="currentColor" />결과 미리보기</button></header>
    <div className="le-mobile-tabs"><button type="button" aria-pressed={mobilePanel === 'canvas'} onClick={() => setMobilePanel('canvas')}><Workflow size={16} />캔버스</button>
      <button type="button" aria-pressed={mobilePanel === 'inspector'} onClick={() => setMobilePanel('inspector')}><PanelRight size={16} />블록 속성</button></div>
    <div className={`le-workspace le-mobile-${mobilePanel}`}>
      <Palette selected={selected} selectNode={selectNode} />
      <Canvas positions={positions} selected={selected} onSelect={selectNode} onMove={onMove} />
      <Inspector selected={selected} selectNode={selectNode} rule={rule} onRuleChange={onRuleChange} titleRef={inspectorTitle} />
    </div>
    {preview && <Result rule={rule} close={() => setPreview(false)} />}
  </div>;
}
