import {useRef, useState} from 'react';
import type {Block, Graph} from '../../domain';
import {edgeLabel, edgePortLabels, titleById} from './graph';
import {Modal} from './Modal';
import {Icon} from './Icons';

export function CategoryEditor({graph, node, names, onChange}: {
  graph: Graph; node: Block; names: string[]; onChange: (graph: Graph) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [rename, setRename] = useState('');
  const [addition, setAddition] = useState('');
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const addInput = useRef<HTMLInputElement>(null);
  const duplicate = (value: string, except?: number) => names.some((name,i) => name.trim() === value.trim() && i !== except);

  const outgoing = (index: number) => graph.edges.filter(edge =>
    edge.from === node.id && edge.kind === 'flow' && edge.out === 'category:' + names[index]);
  // Legacy imports may contain the same name twice. Its route still serves the other entry.
  const ownsRoute = (index: number) => names.filter(name => name === names[index]).length === 1;
  const affected = removing !== null && ownsRoute(removing) ? outgoing(removing) : [];
  function commit(categories: string[], edges = graph.edges) {
    onChange({...graph, edges, nodes:graph.nodes.map(n => n.id === node.id ? {...n, config:{...n.config, categories}} : n)});
  }
  function focusRow(index: number) {
    requestAnimationFrame(() => (buttons.current[index] ?? addInput.current)?.focus());
  }
  function saveName(index: number) {
    const next = rename.trim();
    if (!next || duplicate(next,index)) return;
    const old = names[index];
    if (old !== next) {
      const links = ownsRoute(index) ? outgoing(index) : [];
      const edges = graph.edges.map(edge => {
        if (!links.includes(edge)) return edge;
        const updated = {...edge, out:'category:' + next};
        if (edge.label === edgeLabel(graph,edge)) updated.label = next + ' → ' + edgePortLabels(graph,edge).input;
        return updated;
      });
      commit(names.map((name,i) => i === index ? next : name), edges);
    }
    setEditing(null);
    focusRow(index);
  }
  function remove(index: number) {
    commit(names.filter((_,i) => i !== index), graph.edges.filter(edge => !affected.includes(edge)));
    setRemoving(null);
    setEditing(null);
    focusRow(Math.min(index,names.length - 2));
  }
  function add() {
    if (!addition.trim() || duplicate(addition)) return;
    commit([...names, addition.trim()]);
    setAddition('');
    addInput.current?.focus();
  }
  return <fieldset className="ws-fieldset" data-field-key="categories">
    <legend>분류 범주 <small className="ws-required">필수</small></legend>
    {names.map((name,i) => editing === i
      ? <form className="ws-category-edit" key={i} onSubmit={e => {e.preventDefault(); saveName(i);}}>
          <input aria-label="새 범주 이름" autoFocus value={rename} onChange={e => setRename(e.target.value)}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing && e.key === 'Enter') e.preventDefault();
              if (e.key === 'Escape' && !e.nativeEvent.isComposing) {e.preventDefault(); setEditing(null); focusRow(i);}
            }}/>
          <button type="submit" className="ws-btn" disabled={!rename.trim() || duplicate(rename,i)}>이름 적용</button>
          <button type="button" className="ws-btn" onClick={() => {setEditing(null); focusRow(i);}}>취소</button>
          {duplicate(rename,i) && <small role="status">이미 사용 중인 범주 이름입니다.</small>}
        </form>
      : <div className="ws-category-row" key={i}>
          <span>{name}</span>
          <button type="button" className="ws-btn" aria-label={name+' 이름 변경'} ref={el => {buttons.current[i] = el;}}
            onClick={() => {setRename(name); setEditing(i);}}>이름 변경</button>
          <button type="button" className="ws-icon-button ws-danger" aria-label={name+' 삭제'} title={name+' 삭제'}
            onClick={() => setRemoving(i)}><Icon name="trash" size={14}/></button>
        </div>)}
    <div className="ws-chip-add">
      <input ref={addInput} aria-label="분류 범주 새 항목" placeholder="새 범주 이름" value={addition} onChange={e => setAddition(e.target.value)}
        onKeyDown={e => {if (e.key === 'Enter' && !e.nativeEvent.isComposing) {e.preventDefault(); add();}}}/>
      <button type="button" className="ws-btn" disabled={!addition.trim() || duplicate(addition)} onClick={add}>추가</button>
    </div>
    {duplicate(addition) && <small role="status">이미 사용 중인 범주 이름입니다.</small>}
    {removing !== null && <Modal title="분류 범주 삭제" onClose={() => setRemoving(null)}>
      <p>‘{names[removing]}’ 범주를 삭제할까요?</p>
      {affected.length > 0 ? <><p>함께 끊어지는 진행 연결 {affected.length}개</p>
        <ul>{affected.map(edge => <li key={edge.id}>{titleById(graph,edge.to)}</li>)}</ul></>
        : <p>함께 끊어지는 연결이 없습니다.</p>}
      <div className="ws-modal-actions">
        <button type="button" className="ws-btn" onClick={() => setRemoving(null)}>취소</button>
        <button type="button" className="ws-btn ws-danger" onClick={() => remove(removing)}>범주 삭제</button>
      </div>
    </Modal>}
  </fieldset>;
}
