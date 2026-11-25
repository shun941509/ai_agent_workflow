import {useEffect, useRef, useState} from 'react';
import {byType, type Graph} from '../../domain';
import {api} from '../client';
import {assetTargets, defaultAssetTarget, type AssetTarget, type SharedAssetPin} from './asset-attachment';
import {Modal} from './Modal';

export function SharedAssetDialog({graph, asset, onClose, onAttach}: {
  graph: Graph;
  asset: SharedAssetPin;
  onClose: () => void;
  onAttach: (asset: SharedAssetPin, target?:AssetTarget) => void;
}) {
  const targets = assetTargets(graph, asset.kind);
  const [selected, setSelected] = useState(targets.length === 1 ? targets[0].value : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = useRef(false);
  useEffect(() => {
    current.current = true;
    return () => { current.current = false; };
  }, []);
  const newBlockName = byType.get(defaultAssetTarget(asset.kind))!.name;
  const target = targets.find(node => node.value === selected);

  async function submit() {
    if (busy || (targets.length && !target)) return;
    setBusy(true);
    setError('');
    try {
      const detail = await api<{asset:SharedAssetPin; version:number}>('asset.read', {
        id:asset.id, version:asset.version, sharedCatalog:true,
      });
      if (current.current) onAttach({...detail.asset, version:detail.version}, target);
    } catch (cause) {
      if (current.current) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
    }
  }

  return <Modal title="자료를 연결할 블록" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p><strong>{asset.name}</strong> · {asset.version}판</p>
      {targets.length ? <label className="ws-field"><span>연결할 블록</span>
        <select autoFocus value={selected} disabled={busy} required onChange={event => { setSelected(event.target.value); setError(''); }}>
          <option value="" disabled>블록 선택</option>
          {targets.map(node => <option key={node.value} value={node.value}>{node.label}</option>)}
        </select>
      </label> : <p>이 자료를 받을 블록이 없어 ‘{newBlockName}’ 블록을 함께 추가합니다. 편집기에서 새 블록을 실행 경로에 연결하세요.</p>}
      <p className="ws-hint">새 판이 게시되어도 이 Workflow는 {asset.version}판을 사용합니다.</p>
      {asset.kind === 'mcp' && <p className="ws-hint">{target?.type === 'ai.single_task'
        ? '한 번 답하기는 도구를 호출하지 않습니다. 호출하려면 AI 작업을 ‘목표까지 반복’으로 바꾸고 사용할 도구를 선택하세요.'
        : '호출할 도구는 블록 속성에서 설정할 수 있습니다.'}</p>}
      {error && <p role="alert" className="ws-danger">{error}</p>}
      <div className="ws-modal-actions"><button className="ws-btn" type="button" onClick={onClose}>취소</button>
        <button className="ws-btn ws-primary" type="submit" disabled={busy || (targets.length > 0 && !target)}>
          {busy ? '자료판 확인 중…' : '선택한 판 연결'}
        </button>
      </div>
    </form>
  </Modal>;
}
