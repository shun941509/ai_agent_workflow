'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Workflow } from 'lucide-react';
import { emptyGraph, validateGraph, type Graph, type Issue } from '../domain';
import type { DesignProposal } from '../domain/design-proposal';
import { workDocumentBindings, workDocumentGraph, type WorkDocument } from '../domain/work-documents';
import { runInputLimit } from '../domain/run-input';
import { intentHash, message, StudioApiError } from './client';
import { subgraph } from './editor/graph';

export async function proposalPayload(userId: string | undefined, project: string | null | undefined, prompt: string, graph: Graph, answer?: string) {
  const initial = await intentHash([userId, project, prompt.trim(), graph]);
  return answer?.trim() ? intentHash([initial, answer.trim()]) : initial;
}

type Props = {
  prompt: string;
  onEdit: (text: string) => void;
  creating: boolean;
  createLabel: string;
  onCreate: (graph: Graph, issue?: Issue) => void;
  modelReady: boolean;
  pendingPayload?: string;
  userId: string;
  workDocument?: WorkDocument;
  onBlank: () => void;
  onTemplates: () => void;
  onRequest: (prompt: string, graph: Graph, signal: AbortSignal, answer?: string) => Promise<DesignProposal>;
  onClose: () => void;
};

export default function HomeDesignProposal({ prompt, onEdit, creating, createLabel, onCreate, onRequest, onClose,
  modelReady, pendingPayload, userId, workDocument, onBlank, onTemplates }: Props) {
  const request = useRef<AbortController | null>(null);
  const [answer, setAnswer] = useState<string>();
  const [waiting, setWaiting] = useState(false);
  const [draft, setDraft] = useState<Graph | null>(null);
  const [materialInput, setMaterialInput] = useState(workDocument?.sample ?? '');
  const base = useMemo(() => workDocument ? workDocumentGraph(workDocument) : emptyGraph(), [workDocument]);
  const [error, setError] = useState('');
  const [modelUnavailable, setModelUnavailable] = useState(false);
  const [recovery, setRecovery] = useState<{text:string; payload:string; userId:string}>();
  const actionButton = useRef<HTMLButtonElement>(null);
  const blankButton = useRef<HTMLButtonElement>(null);
  const offline = !modelReady || modelUnavailable;
  const canRecover = recovery && recovery.userId === userId && recovery.payload === pendingPayload && recovery.text === prompt.trim();
  const canRequest = !offline || (!modelUnavailable && canRecover);
  const issues = useMemo(() => draft ? validateGraph(draft) : [], [draft]);
  const first = issues[0];
  const block = draft && first && subgraph(draft, first.path ?? []).nodes.find(node => node.id === first.nodeId);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!pendingPayload || modelReady) return;
    let active = true;
    const text = prompt.trim();
    void proposalPayload(userId, null, text, base, answer).then(payload => {
      if (active) setRecovery(payload === pendingPayload ? {text, payload, userId} : undefined);
    });
    return () => { active = false; };
  }, [pendingPayload, modelReady, prompt, userId, base, answer]);
  useEffect(() => { if (draft) actionButton.current?.focus(); }, [draft]);
  useEffect(() => { if (modelUnavailable) blankButton.current?.focus(); }, [modelUnavailable]);

  async function propose() {
    if (!prompt.trim() || (answer !== undefined && !answer.trim()) || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setWaiting(true);
    setError('');
    try {
      const proposal = await onRequest(prompt, base, controller.signal, answer?.trim());
      if (controller.signal.aborted) return;
      if ('clarification' in proposal) {
        if (answer !== undefined) throw new Error('맡길 일과 원하는 결과를 구체적으로 입력해 주세요.');
        setAnswer('');
        return;
      }
      const graph = proposal.graph;
      if (workDocument) {
        const bindings = workDocumentBindings(graph, workDocument);
        if (!bindings) throw new Error('제안에 업무 입력이나 작성 규칙 연결이 빠졌습니다. 요청문을 수정하거나 기본 설계로 시작하세요.');
        bindings.rules.title = workDocument.material.name;
        bindings.rules.config = {content:workDocument.material.content, version:1};
      }
      if (!controller.signal.aborted) setDraft(graph);
    } catch (e) {
      if (!controller.signal.aborted) {
        if (e instanceof StudioApiError && e.status === 503) setModelUnavailable(true);
        else setError(e instanceof TypeError
          ? '응답을 받지 못했습니다. 다시 시도하면 같은 설계 요청의 결과를 확인합니다.' : message(e));
      }
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        request.current = null;
        setWaiting(false);
      }
    }
  }
  function createDraft(graph: Graph, issue?: Issue) {
    if (!workDocument) return onCreate(graph, issue);
    const copy = structuredClone(graph);
    const bindings = workDocumentBindings(copy, workDocument);
    if (!bindings) {
      setError('업무 입력과 작성 규칙이 있는 기본 설계로 다시 시작하세요.');
      return;
    }
    bindings.input.config.question = materialInput;
    onCreate(copy, issue);
  }
  const needsMaterial = Boolean(workDocument && !materialInput.trim());
  return <>
    <label className="field">맡길 일과 원하는 결과
      <textarea autoFocus disabled={creating || waiting} value={prompt}
        onChange={event => { onEdit(event.target.value); setAnswer(undefined); setDraft(null); setError(''); }}
        placeholder="회의 내용에서 결정 사항과 담당자를 표로 정리해 줘" />
    </label>
    {answer !== undefined && <label className="field">어떤 Agent를 만들고 싶으세요?
      <textarea autoFocus value={answer} disabled={creating || waiting}
        onChange={event => { setAnswer(event.target.value); setDraft(null); setError(''); }} />
    </label>}
    {workDocument && <label className="field">{workDocument.inputLabel}
      <textarea value={materialInput} rows={workDocument.material.kind === 'document' ? 7 : 4}
        maxLength={runInputLimit} disabled={creating} onChange={event => setMaterialInput(event.target.value)} />
      <small>AI는 설계 요청문과 기본 예시로 초안을 만듭니다. 여기에 입력한 자료는 새 Agent의 입력 블록에 저장됩니다.</small>
      <small>연결할 자료 · {workDocument.material.name} 1판</small>
    </label>}
    {error && <p className="modal-error" role="alert">{error}</p>}
    {offline && !workDocument && !draft && !waiting && <div className="proposal-preview">
      <p role="status">AI 설계 제안을 사용하려면 작업실 운영자가 모델을 연결해야 합니다. 직접 설계하거나 템플릿으로 시작할 수 있습니다.</p>
      <div className="row">
        <button ref={blankButton} type="button" className="btn" disabled={creating} onClick={onBlank}>빈 캔버스에서 시작</button>
        <button type="button" className="btn" disabled={creating} onClick={onTemplates}>수준별 템플릿 보기</button>
      </div>
    </div>}
    {workDocument && offline && !draft && !waiting && <p role="status">모델을 연결하면 AI 설계 제안을 받을 수 있습니다. 지금은 기본 설계를 열어 편집할 수 있습니다.</p>}
    {draft && <div className="proposal-preview">
      <h3>제안된 Workflow</h3>
      {first ? <div className="proposal-repairs" role="status">
        <strong>실행 전 수정 {issues.length}곳</strong>
        <p>{block && <b>{block.title}</b>} {first.message.replace((first.path ?? []).map(id => id + ' › ').join(''), '')}</p>
      </div> : <p role="status">설계 제안이 준비됐습니다. 캔버스에 적용할 수 있습니다.</p>}
      {draft.nodes.map(node => <p key={node.id}><Workflow size={14} />{node.title}</p>)}
      <small>연결 설정 {draft.edges.length}개{!first && ' · 설계 검사 통과'}</small>
    </div>}
    {waiting ? <>
      <p role="status">설계 제안을 작성하고 있습니다.</p>
      <button type="button" className="btn" onClick={onClose}>요청 취소하고 닫기</button>
    </> : (draft || canRequest) && <button ref={actionButton} type="button" className="btn primary" disabled={creating || !prompt.trim() || (answer !== undefined && !answer.trim()) || Boolean(draft && needsMaterial)}
      onClick={() => draft ? createDraft(draft, first) : void propose()}>
      {creating ? '만드는 중…' : draft ? (first ? '초안으로 열어 수정' : createLabel) : (offline ? '이전 요청 결과 확인' : answer !== undefined ? '답변으로 초안 제안받기' : error ? '같은 요청 다시 시도' : '초안 제안받기')}
    </button>}
    {workDocument && !waiting && !draft && <button ref={blankButton} type="button" className="btn"
      disabled={creating || !prompt.trim() || needsMaterial}
      onClick={() => createDraft(workDocumentGraph(workDocument, prompt.trim()))}>기본 설계로 시작</button>}
  </>;
}
