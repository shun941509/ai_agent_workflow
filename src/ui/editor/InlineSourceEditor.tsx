import { useId, useRef, useState } from 'react';
import type { Block, Graph } from '../../domain/types';
import { message } from '../client';
import { PromptTextarea } from '../PromptTextarea';
import {assetNumber} from '../resource-labels';
import type { AssetItem } from '../ResourceLibrary';
import type { RecoveryDraft, SourceDraft, SourceDrafts } from './source-drafts';
import { firstSourceChange } from './source-comparison';
import { BlockIcon } from './Icons';
import { nodeTitle } from './graph';
import './inline-source.css';

export function SourceCopyChoice({title, draft, onChoose, onCancel}: {
  title:string; draft:SourceDraft; onChoose:(text:string)=>void; onCancel:()=>void;
}) {
  const change = firstSourceChange(draft.base, draft.text);
  return <>
    <p>‘{title}’ 사본에 사용할 원문을 선택하세요.</p>
    <h3>첫 변경 · {change.label}</h3>
    <dl className="ws-source-diff">
      <dt>편집 중</dt><dd>{change.edited.prefix}<ins>{change.edited.marked}</ins>{change.edited.suffix}</dd>
      <dt>적용됨</dt><dd>{change.original.prefix}<del>{change.original.marked}</del>{change.original.suffix}</dd>
    </dl>
    <div className="ws-modal-actions ws-copy-source-actions">
      <button type="button" className="ws-btn ws-primary" onClick={() => onChoose(draft.text)}>편집 중인 원문으로 복제</button>
      <button type="button" className="ws-btn" onClick={() => onChoose(draft.base)}>마지막으로 적용한 원문으로 복제</button>
      <button type="button" className="ws-btn" onClick={onCancel}>취소</button>
    </div>
  </>;
}

export function SourceTestChoice({graph, drafts, onChoose}: {
  graph: Graph; drafts: SourceDrafts; onChoose: (edited: boolean) => void;
}) {
  const entries = Object.entries(drafts);
  const hasEmpty = entries.some(([, draft]) => !draft.text.trim());
  return <section className="ws-test-source" aria-label="시험에 사용할 원문">
    <h3>어느 원문으로 시험할까요?</h3>
    <p>변경을 적용하지 않은 원문 {entries.length}개가 있습니다.</p>
    {entries.map(([key, draft]) => {
      let scope: Graph | undefined = graph;
      const titles = [...draft.path, draft.id].map(id => {
        const node: Block | undefined = scope?.nodes.find(candidate => candidate.id === id);
        scope = node?.graph;
        return node?.title || id;
      });
      const change = firstSourceChange(draft.base, draft.text);
      return <details key={key}>
        <summary>{titles.join(' › ')} 원문 비교</summary>
        <h4>첫 변경 · {change.label}</h4>
        <dl className="ws-source-diff">
          <dt>현재</dt><dd>{change.original.prefix}{change.original.marked && <del>{change.original.marked}</del>}{change.original.suffix}</dd>
          <dt>수정</dt><dd>{change.edited.prefix}{change.edited.marked && <ins>{change.edited.marked}</ins>}{change.edited.suffix}</dd>
        </dl>
        <details><summary>원문 전체 보기</summary>
          <h4>현재 적용된 원문</h4><p>{draft.base || '빈 원문'}</p>
          <h4>수정 중인 원문</h4><p>{draft.text.trim() ? draft.text : '빈 원문'}</p>
        </details>
      </details>;
    })}
    <button className="ws-btn ws-primary" disabled={hasEmpty} onClick={() => onChoose(true)}>수정한 원문을 적용하고 시험</button>
    <button className="ws-btn" onClick={() => onChoose(false)}>현재 적용된 원문으로 시험</button>
    <small>{hasEmpty ? '빈 원문을 적용하려면 먼저 내용을 입력하세요.' : '현재 적용된 원문을 선택해도 편집 중인 내용은 임시 보관합니다.'}</small>
  </section>;
}

export type SaveReferenceDocument = (name: string, content: string) => Promise<AssetItem>;

function SaveReference({title, text, save}: { title: string; text: string; save: SaveReferenceDocument }) {
  const fieldId = useId();
  const [customName, setCustomName] = useState<string>();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [result, setResult] = useState<{name: string; text: string; asset?: AssetItem; error?: string}>();
  const name = customName ?? title.slice(0, 120);
  const savedName = name.trim();
  const current = result?.name === savedName && result.text === text ? result : undefined;

  async function submit() {
    if (saving.current || !savedName || !text.trim() || current?.asset) return;
    saving.current = true;
    setBusy(true);
    setResult(undefined);
    try {
      const asset = await save(savedName, text);
      setResult({name:savedName, text, asset});
    } catch (error) {
      setResult({name:savedName, text, error:message(error)});
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return <div className="ws-field ws-save-reference">
    <label htmlFor={fieldId}>자료 이름</label>
    <input id={fieldId} maxLength={120} value={name} onChange={event => setCustomName(event.target.value)} />
    <button type="button" className="ws-btn" disabled={!savedName || !text.trim()} aria-disabled={busy || Boolean(current?.asset) || undefined}
      onClick={() => void submit()}>내 참고 자료로 저장</button>
    <small role="status">{busy ? '참고 자료를 저장하고 있습니다.' : current?.asset
      ? '‘' + current.asset.name + '’ ' + current.asset.version + '판을 내 비공개 참고 자료로 저장했습니다.'
      : '위에 보이는 원문을 다른 Workflow에서도 사용할 수 있습니다.'}</small>
    {current?.error && <small className="ws-danger" role="alert">{current.error}</small>}
    {current?.asset && <>
      <a className="ws-edition-link" href={'/?' + new URLSearchParams({asset:current.asset.id, edition:String(current.asset.version)})}
        target="_blank" rel="noreferrer">저장한 참고 자료 열기 <span>(새 탭)</span></a>
      <small>다른 초급 사본의 ‘도서관 이용규정 → 이름·자료판 설정 → 연결할 자료’에서 ‘{current.asset.name}’을 고르세요. 같은 이름이면 자료 번호 {assetNumber(current.asset.id)}을 찾으세요. ‘미리 볼 자료판’에서 {current.asset.version}판 원문을 확인하고 ‘이 판 연결’을 누르세요.</small>
    </>}
  </div>;
}

export function InlineSourceEditor({ node, draftText, recoveries, onRecover, onEdit, onApply, onSaveReference }: {
  node?: Block;
  draftText?: string;
  recoveries: RecoveryDraft[];
  onRecover: (text: string) => void;
  onEdit: (text: string) => void;
  onApply: (content: string) => void;
  onSaveReference?: SaveReferenceDocument;
}) {
  const fieldId = useId();
  const [lastApplied, setLastApplied] = useState<{ id: string; text: string }>();
  if (node?.type !== 'resource.context') return null;
  if (node.config.assetId) {
    const params = new URLSearchParams({ asset: String(node.config.assetId) });
    if (node.config.version) params.set('edition', String(node.config.version));
    if (node.config.assetGrant) params.set('token', String(node.config.assetGrant));
    return <a className="ws-edition-link" href={'/?' + params} target="_blank" rel="noreferrer">
      연결한 자료 원문 열기 <span>(새 탭)</span>
    </a>;
  }

  const original = String(node.config.content ?? '');
  const text = draftText ?? original;
  const changed = text !== original;
  const empty = !text.trim();
  const status = changed
    ? (empty ? '적용할 자료 원문을 입력하세요.' : '편집 중인 원문은 이 브라우저에 임시 보관합니다. 시험 실행에서 어느 원문을 쓸지 선택할 수 있습니다.')
    : (lastApplied?.id === node.id && lastApplied.text === original ? '수정한 원문을 적용했습니다.' : '');

  return <section className="ws-source-editor">
    <div className="ws-source-title">
      <BlockIcon type={node.type}/>
      <div><small>참고 자료</small><h3>{nodeTitle(node)}</h3></div>
    </div>
    <div className="ws-field" data-field-key="content">
      <PromptTextarea id={fieldId} label="자료 원문" expandLabel="자료 원문" rows={8} value={text} aria-invalid={changed && empty}
        aria-describedby={fieldId + '-status'}
        onChange={event => {
          setLastApplied(undefined);
          onEdit(event.currentTarget.value);
        }}/>
      <button type="button" className="ws-btn ws-primary" disabled={!changed || empty} onClick={() => {
        onApply(text);
        setLastApplied({ id: node.id, text });
      }}>변경 적용</button>
      <small id={fieldId + '-status'} role="status">{status}</small>
      {recoveries.length > 0 && <details className="ws-source-recovery">
        <summary>다른 원문 초안 {recoveries.length}개</summary>
        <ul>{recoveries.map(draft => <li key={draft.record}>
          <small>{draft.updated ? new Date(draft.updated).toLocaleString('ko-KR') : '이전 편집에서 보관한 초안'}</small>
          <p>{firstSourceChange(original,draft.text).after}</p>
          <details><summary>내용 전체 보기</summary><p>{draft.text || '빈 원문'}</p></details>
          <button type="button" className="ws-btn" onClick={()=>onRecover(draft.text)}>이 초안 불러오기</button>
        </li>)}</ul>
      </details>}
    </div>
    {onSaveReference && <SaveReference key={node.id} title={nodeTitle(node)} text={text} save={onSaveReference} />}
  </section>;
}
