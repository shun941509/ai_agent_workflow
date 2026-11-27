'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Workflow } from 'lucide-react';
import { emptyGraph, validateGraph, type Graph, type Issue } from '../domain';
import { newAgentPurpose, type DesignProposal } from '../domain/design-proposal';
import { workDocumentBindings, workDocumentGraph, type WorkDocument } from '../domain/work-documents';
import { runInputLimit } from '../domain/run-input';
import { intentHash, message, StudioApiError } from './client';
import { edgeNames, groupEdges, subgraph } from './editor/graph';
import { PromptTextarea } from './PromptTextarea';

export async function proposalIntent(userId: string | undefined, projectId: string | null | undefined,
  prompt: string, graph: Graph, answer?: string) {
  const initial = await intentHash([userId, projectId, prompt.trim(), graph]);
  return {initial, payload: answer ? await intentHash([initial, answer.trim()]) : initial};
}

function ProposalConnections({graph}: {graph: Graph}) {
  const titles = new Map(graph.nodes.map(node => [node.id, node.title]));
  return <details>
    <summary>연결 설정 {graph.edges.length}개</summary>
    <ul>{groupEdges(graph).map(group => {
      const kinds = [...new Set(group.members.map(edge => edgeNames[edge.kind]))];
      return <li key={group.id}>
        {titles.get(group.from) || group.from} → {titles.get(group.to) || group.to}
        <small> · {kinds.join('·')}{group.branchLabel && ' · ' + group.branchLabel}</small>
      </li>;
    })}</ul>
  </details>;
}

type Props = {
  prompt: string;
  onEdit: (text: string) => void;
  answer?: string;
  onAnswer: (answer: string) => void;
  creating: boolean;
  createLabel: string;
  onCreate: (graph: Graph, issue?: Issue) => void;
  modelReady: boolean;
  pendingPayload?: string;
  pendingFollowUpFor?: string;
  userId: string;
  workDocument?: WorkDocument;
  material?: string;
  onMaterialEdit?: (text: string) => void;
  onBlank: () => void;
  onTemplates: () => void;
  onRequest: (prompt: string, graph: Graph, signal: AbortSignal, clarificationAnswer?: string) => Promise<DesignProposal>;
  onClose: () => void;
};

export default function HomeDesignProposal({ prompt, onEdit, answer, onAnswer, creating, createLabel, onCreate, onRequest, onClose,
  modelReady, pendingPayload, pendingFollowUpFor, userId, workDocument, material = '', onMaterialEdit, onBlank, onTemplates }: Props) {
  const request = useRef<AbortController | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [draft, setDraft] = useState<Graph | null>(null);
  const answerField = useRef<HTMLTextAreaElement>(null);
  const formId = useId();
  const base = useMemo(() => {
    if (!workDocument) return emptyGraph();
    // The guide supplies its purpose on creation. Preserve the graph shape of existing proposal receipts.
    const {nodes, edges} = workDocumentGraph(workDocument);
    return {nodes, edges};
  }, [workDocument]);
  const [error, setError] = useState('');
  const [modelUnavailable, setModelUnavailable] = useState(false);
  const [recovery, setRecovery] = useState<{text:string; initial:string; payload:string; userId:string; answer?:string}>();
  const actionButton = useRef<HTMLButtonElement>(null);
  const blankButton = useRef<HTMLButtonElement>(null);
  const offline = !modelReady || modelUnavailable;
  const currentIntent = recovery?.userId === userId && recovery.text === prompt.trim() ? recovery : undefined;
  const clarificationAnswer = answer?.trim() || undefined;
  const needsAnswer = answer !== undefined || Boolean(pendingFollowUpFor && pendingFollowUpFor === currentIntent?.initial);
  const canRecover = currentIntent && currentIntent.payload === pendingPayload && currentIntent.answer === clarificationAnswer;
  const canRequest = !offline || (!modelUnavailable && canRecover);
  const issues = useMemo(() => draft ? validateGraph(draft) : [], [draft]);
  const first = issues[0];
  const block = draft && first && subgraph(draft, first.path ?? []).nodes.find(node => node.id === first.nodeId);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!pendingPayload || (modelReady && !pendingFollowUpFor)) return;
    let active = true;
    const text = prompt.trim();
    void proposalIntent(userId, null, text, base, clarificationAnswer).then(intent => {
      if (active) setRecovery({text, ...intent, userId, answer:clarificationAnswer});
    });
    return () => { active = false; };
  }, [pendingPayload, pendingFollowUpFor, modelReady, prompt, userId, base, clarificationAnswer]);
  useEffect(() => {
    if (needsAnswer && !waiting) answerField.current?.focus();
  }, [needsAnswer, waiting]);
  useEffect(() => { if (draft) actionButton.current?.focus(); }, [draft]);
  useEffect(() => { if (modelUnavailable) blankButton.current?.focus(); }, [modelUnavailable]);

  async function propose() {
    if (!prompt.trim() || (needsAnswer && !clarificationAnswer) || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setWaiting(true);
    setError('');
    try {
      const proposal = await onRequest(prompt, base, controller.signal, clarificationAnswer);
      if (controller.signal.aborted) return;
      if ('clarification' in proposal) {
        if (needsAnswer) throw new Error('맡길 일과 원하는 결과를 구체적으로 입력해 주세요.');
        onAnswer('');
        return;
      }
      const graph = proposal.graph;
      if (workDocument) {
        const bindings = workDocumentBindings(graph, workDocument);
        if (!bindings) throw new Error('제안에 업무 입력이나 작성 규칙 연결이 빠졌습니다. 요청문을 수정하거나 기본 설계로 시작하세요.');
        bindings.rules.title = workDocument.material.name;
        bindings.rules.config = {content:workDocument.material.content, version:1};
      }
      setDraft(graph);
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
    bindings.input.config.question = material;
    onCreate(copy, issue);
  }
  const needsMaterial = Boolean(workDocument && !material.trim());
  const requestLabel = offline ? '이전 요청 결과 확인' : needsAnswer ? '답변으로 초안 제안받기'
    : error ? '같은 요청 다시 시도' : '초안 제안받기';
  const answerLabel = workDocument ? workDocument.title + ' 설계에서 무엇을 바꾸고 싶으세요?' : '어떤 Agent를 만들고 싶으세요?';
  return <>
    <div className="field">
      <label htmlFor={formId + '-prompt'}>맡길 일과 원하는 결과</label>
      <PromptTextarea id={formId + '-prompt'} expandLabel="맡길 일과 원하는 결과" autoFocus disabled={creating || waiting} value={prompt}
        onChange={event => { onEdit(event.target.value); setDraft(null); setError(''); }}
        placeholder="회의 내용에서 결정 사항과 담당자를 표로 정리해 줘" />
    </div>
    {needsAnswer && <div className="field">
      <label htmlFor={formId + '-answer'}>{answerLabel}</label>
      <PromptTextarea id={formId + '-answer'} expandLabel={answerLabel} ref={answerField} value={answer ?? ''} disabled={creating || waiting}
        placeholder={workDocument ? '바꾸고 싶은 입력이나 출력 형식을 적어 주세요' : '회의 메모에서 결정 사항을 뽑아 줘'}
        onChange={event => { onAnswer(event.target.value); setDraft(null); setError(''); }} />
    </div>}
    {workDocument && <div className="field">
      <label htmlFor={formId + '-material'}>{workDocument.inputLabel}</label>
      <PromptTextarea id={formId + '-material'} expandLabel={workDocument.inputLabel} value={material} rows={workDocument.material.kind === 'document' ? 7 : 4}
        aria-describedby={formId + '-material-hint ' + formId + '-material-edition'}
        maxLength={runInputLimit} disabled={creating} onChange={event => onMaterialEdit?.(event.target.value)} />
      <small id={formId + '-material-hint'}>AI는 설계 요청문과 기본 예시로 초안을 만듭니다. 여기에 입력한 자료는 새 Agent의 입력 블록에 저장됩니다.</small>
      <small id={formId + '-material-edition'}>연결할 자료 · {workDocument.material.name} 1판</small>
    </div>}
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
      {!workDocument && clarificationAnswer && <p><b>담당 업무</b> {newAgentPurpose(prompt, clarificationAnswer, draft)}</p>}
      {first ? <div className="proposal-repairs" role="status">
        <strong>실행 전 수정 {issues.length}곳</strong>
        <p>{block && <b>{block.title}</b>} {first.message.replace((first.path ?? []).map(id => id + ' › ').join(''), '')}</p>
      </div> : <p role="status">설계 제안이 준비됐습니다. 캔버스에 적용할 수 있습니다.</p>}
      {draft.nodes.map(node => <p key={node.id}><Workflow size={14} />{node.title}</p>)}
      {!first && <small>설계 검사 통과</small>}
      {draft.edges.length ? <ProposalConnections graph={draft} /> : <small>연결 설정 0개</small>}
    </div>}
    {waiting ? <>
      <p role="status">설계 제안을 작성하고 있습니다.</p>
      <button type="button" className="btn" onClick={onClose}>요청 취소하고 닫기</button>
    </> : (draft || canRequest) && <button ref={actionButton} type="button" className="btn primary" disabled={creating || !prompt.trim() || (needsAnswer && !clarificationAnswer) || Boolean(draft && needsMaterial)}
      onClick={() => draft ? createDraft(draft, first) : void propose()}>
      {creating ? '만드는 중…' : draft ? (first ? '초안으로 열어 수정' : createLabel) : requestLabel}
    </button>}
    {workDocument && !waiting && !draft && <button ref={blankButton} type="button" className="btn"
      disabled={creating || !prompt.trim() || needsMaterial}
      onClick={() => createDraft(workDocumentGraph(workDocument, needsAnswer ? workDocument.prompt : prompt.trim()))}>기본 설계로 시작</button>}
  </>;
}
