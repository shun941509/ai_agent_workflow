import { useState } from 'react';
import { connectBlocks, connectionOptions, type Edge, type Graph } from '../../domain';
import { edgeLabel, titleById } from './graph';
import { Modal } from './Modal';

export function FlowConditionsModal({graph, from, to, onApply, onClose}:{
  graph:Graph;
  from:string;
  to:string;
  onApply:(added:Edge[], removed:Set<string>)=>void;
  onClose:()=>void;
}) {
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  const connected = graph.edges.filter(edge => edge.kind === 'flow' && edge.from === from && edge.to === to);
  const available = connectionOptions(graph,from,to).filter(option => option.kind === 'flow');
  const rows = [
    ...connected.map(edge => ({key:'edge:'+edge.id, label:edgeLabel(graph,edge), connected:true})),
    ...available.map(option => ({key:JSON.stringify([option.out,option.input]), label:option.label, connected:false})),
  ];
  const removed = new Set(connected.filter(edge => toggled.has('edge:'+edge.id)).map(edge => edge.id));
  const added = available.filter(option => toggled.has(JSON.stringify([option.out,option.input])));
  return <Modal title="실행 조건 변경" onClose={onClose} footer={<>
    <button type="button" className="ws-btn" onClick={onClose}>취소</button>
    <button type="button" className="ws-btn ws-primary" disabled={!removed.size && !added.length}
      onClick={() => onApply(connectBlocks(graph,from,to,added),removed)}>실행 조건 적용</button>
  </>}>
    <p>{titleById(graph,from)} → {titleById(graph,to)}</p>
    <fieldset className="ws-fieldset"><legend>도착 블록을 실행할 경로</legend>
      {rows.map(row => <label className="ws-check" key={row.key}>
        <input type="checkbox" checked={row.connected !== toggled.has(row.key)} onChange={() => setToggled(old => {
          const next = new Set(old);
          if (!next.delete(row.key)) next.add(row.key);
          return next;
        })}/>{row.label}
      </label>)}
    </fieldset>
  </Modal>;
}
