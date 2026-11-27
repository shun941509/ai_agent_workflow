import { useId, useLayoutEffect, useRef } from 'react';
import type { Block, Graph } from '../../domain/types';
import { Icon } from './Icons';
import { branchPredicate, connectionKindLabels, edgeLabel, edgePortLabels, titleById, type EdgeGroup } from './graph';
import type { PairEdit } from './use-editor-history';
import './connection-inspector.css';

function Decision({ source, group, target }: { source?: Block; group: EdgeGroup; target?: Block }) {
  if (source?.type !== 'control.branch' || target?.type === 'error.handle') return null;
  const routes = group.members.filter(edge => edge.kind === 'flow').map(edge => edge.out);
  if (!routes.includes('yes') && !routes.includes('no')) return null;
  if (routes.includes('yes') && routes.includes('no')) return <small>조건을 비교한 두 경우 모두 진행합니다.</small>;
  const predicate = branchPredicate(source);
  if (routes.includes('yes') && group.flowConditions.includes(predicate)) return null;
  return <small>{predicate} · {routes.includes('yes') ? '조건에 맞을 때' : '조건에 맞지 않을 때'}</small>;
}

export function ConnectionInspector({ graph, group, incoming, onChange, onEdit, onDeleteGroup }: {
  graph: Graph;
  group: EdgeGroup;
  incoming: EdgeGroup[];
  onChange: (graph: Graph, status?:string) => void;
  onEdit: (edit:PairEdit) => void;
  onDeleteGroup: () => void;
}) {
  const heading = useId();
  const members = useRef<HTMLDivElement>(null);
  const nextFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (nextFocus.current === null) return;
    const row = members.current?.querySelector('[data-member="' + CSS.escape(nextFocus.current) + '"]');
    nextFocus.current = null;
    row?.querySelector<HTMLElement>('button, input')?.focus();
  }, [graph]);
  const sourceName = titleById(graph, group.from);
  const targetName = titleById(graph, group.to);
  const target = graph.nodes.find(node => node.id === group.to);
  const source = graph.nodes.find(node => node.id === group.from);
  const hasRouteEditor = (source?.type === 'control.branch' || source?.type === 'ai.classify') && target?.type !== 'error.handle';
  const hasFlow = group.flowConditions.length > 0;
  const conditions = hasFlow ? [group] : incoming.filter(link => link.flowConditions.length);
  const transfers = group.members.filter(edge => edge.kind !== 'flow');
  const implicitInput = hasFlow && (target?.type === 'control.join' || target?.type === 'error.handle') &&
    !graph.edges.some(edge => edge.to === group.to && edge.kind !== 'flow' && edge.input === 'input');

  return <>
    <p className="ws-connection-route">{sourceName} → {targetName}</p>
    <section className="ws-connection-fact" aria-labelledby={heading + '-flow'}>
      <h3 id={heading + '-flow'}>{connectionKindLabels.flow}</h3>
      {!hasFlow && <p>{conditions.length ? '아래 경로로 들어오면 이 블록이 실행됩니다.' : '이 블록의 실행 순서를 정하는 연결이 없습니다.'}</p>}
      {conditions.length > 0 && <ul>{conditions.map(link =>
        <li key={link.id}>
          <b>{titleById(graph, link.from)}</b><span>{link.flowConditions.join(' 또는 ')}</span>
          <Decision source={graph.nodes.find(node => node.id === link.from)} group={link} target={target}/>
        </li>
      )}</ul>}
      {hasRouteEditor && <button type="button" className="ws-btn" onClick={() => onEdit('conditions')}>실행 조건 변경</button>}
    </section>
    <section className="ws-connection-fact" aria-labelledby={heading + '-values'}>
      <h3 id={heading + '-values'}>{connectionKindLabels.data}</h3>
      {transfers.length > 0 && <ul>{transfers.map(edge => {
        const { output, input } = edgePortLabels(graph, edge);
        return <li key={edge.id}>
          <span>{sourceName} · <b>{output}</b></span>
          <span className="ws-connection-receives">→ {targetName} · <b>{input}</b></span>
          {edge.label && <small>{edge.label}</small>}
        </li>;
      })}</ul>}
      {implicitInput && <p>{target?.type === 'error.handle'
        ? '진행 경로에서 발생한 오류 내용을 입력값으로 받습니다.'
        : '진행 경로의 결과와 오류 내용을 입력값으로 모읍니다.'}</p>}
      {!transfers.length && !implicitInput && <p>이 연결로 전달할 값이 없습니다.</p>}
    </section>
    <div ref={members}>{group.members.map((edge,index) => <section className="ws-member" key={edge.id} data-member={edge.id}>
      <div className="ws-inline">
        <strong>{connectionKindLabels[edge.kind]}</strong>
        {!(hasRouteEditor && edge.kind === 'flow') && <button type="button" className="ws-icon-button ws-danger" aria-label={edgeLabel(graph,edge) + ' · ' + connectionKindLabels[edge.kind] + ' 연결 삭제'}
          onClick={() => {
            const neighbor = group.members[index + 1] ?? group.members[index - 1];
            if (!neighbor) { onDeleteGroup(); return; }
            nextFocus.current = neighbor.id;
            onChange({ ...graph, edges: graph.edges.filter(item => item.id !== edge.id) }, edgeLabel(graph,edge) + ' 연결을 삭제했습니다.');
          }}>
          <Icon name="trash" size={14}/>
        </button>}
      </div>
      <p>{edgeLabel(graph, edge)}</p>
      <label className="ws-field">
        <span>선 설명</span>
        <input aria-label={edgeLabel(graph,edge) + ' · 선 설명'} value={edge.label ?? ''} onChange={event => onChange({
          ...graph, edges: graph.edges.map(item => item.id === edge.id ? { ...item, label: event.target.value } : item),
        })}/>
      </label>
    </section>)}</div>
    <button type="button" className="ws-btn" onClick={() => onEdit('transfers')}>
      <Icon name="link"/>전달 항목 추가
    </button>
  </>;
}
