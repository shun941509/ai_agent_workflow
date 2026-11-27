import { useEffect, useRef, useState } from 'react';
import { Clock3, Search, Trash2, Undo2 } from 'lucide-react';
import { api, message } from './client';
import StudioDialog from './StudioDialog';
import './trash-list.css';

export type TrashEntry = {
  id: string;
  revision: number;
  deletedAt: string;
  expiresAt: string;
};

const localDate = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: 'long', day: 'numeric',
  hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
});

export default function TrashList<T extends TrashEntry>({ scope, titleOf, subtitleOf, onRestore }: {
  scope: 'project' | 'asset';
  titleOf: (item: T) => string;
  subtitleOf?: (item: T) => string;
  onRestore: (item: T) => Promise<void>;
}) {
  const noun = scope === 'project' ? '프로젝트' : '자료';
  const searchLabel = scope === 'project' ? '휴지통에서 Agent 이름 검색' : '휴지통에서 자료 이름 검색';
  const [items, setItems] = useState<T[] | null>(null);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set<string>());
  const [confirmation, setConfirmation] = useState<T[] | null>(null);
  const [listError, setListError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [restoring, setRestoring] = useState('');
  const [purging, setPurging] = useState(false);
  const pending = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const purgeButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let current = true;
    setItems(null);
    setListError('');
    api<T[]>(scope + '.trash')
      .then(result => {
        const now = Date.now();
        if (current) setItems(result.filter(item => Date.parse(item.expiresAt) > now));
      })
      .catch(error => { if (current) setListError(message(error)); });
    return () => { current = false; };
  }, [scope, reload]);

  useEffect(() => {
    if (!items?.length) return;
    const nextDeadline = items.reduce((next, item) => Math.min(next, Date.parse(item.expiresAt)), Infinity);
    let timer: number;
    function removeExpired() {
      window.clearTimeout(timer);
      const now = Date.now();
      if (now < nextDeadline) {
        timer = window.setTimeout(removeExpired, nextDeadline - now);
        return;
      }
      setItems(current => current?.filter(item => Date.parse(item.expiresAt) > now) ?? null);
    }
    removeExpired();
    document.addEventListener('visibilitychange', removeExpired);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', removeExpired);
    };
  }, [items]);

  function searchItems(list: T[], value: string) {
    const query = value.trim().toLowerCase();
    return list.filter(item => titleOf(item).toLowerCase().includes(query));
  }

  const matches = searchItems(items ?? [], search);
  const selected = matches.filter(item => selectedIds.has(item.id));
  const allSelected = matches.length > 0 && selected.length === matches.length;
  const confirmationChanged = Boolean(confirmation && confirmation.length !== selected.length);
  const busy = Boolean(restoring) || purging;

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selected.length > 0 && !allSelected;
  }, [selected.length, allSelected]);

  function updateSearch(value: string) {
    setSearch(value);
    setSelectedIds(new Set(searchItems(selected, value).map(item => item.id)));
  }

  function reloadAfterError(error: unknown) {
    setActionError(message(error));
    setConfirmation(null);
    setSelectedIds(new Set());
    setItems(null);
    setReload(value => value + 1);
    requestAnimationFrame(() => searchInput.current?.focus());
  }

  async function restore(item: T) {
    if (pending.current) return;
    pending.current = true;
    setRestoring(item.id);
    setActionError('');
    setNotice('');
    try {
      await onRestore(item);
    } catch (error) {
      reloadAfterError(error);
    } finally {
      pending.current = false;
      setRestoring('');
    }
  }

  function cancelPurge() {
    if (pending.current) return;
    setConfirmation(null);
    requestAnimationFrame(() => {
      if (purgeButton.current && !purgeButton.current.disabled) purgeButton.current.focus();
      else searchInput.current?.focus();
    });
  }

  async function purge() {
    if (!confirmation?.length || confirmationChanged || pending.current) return;
    if (confirmation.some(item => Date.parse(item.expiresAt) <= Date.now())) {
      reloadAfterError(new Error(`선택한 ${noun}의 보관 기한이 지났습니다. 목록을 다시 확인하세요.`));
      return;
    }
    pending.current = true;
    setPurging(true);
    try {
      const result = await api<{ ids: string[] }>(scope + '.purge', {
        items: confirmation.map(({ id, revision }) => ({ id, revision })),
      });
      const deleted = new Set(result.ids);
      setItems(current => current?.filter(item => !deleted.has(item.id)) ?? null);
      setSelectedIds(new Set());
      setConfirmation(null);
      setNotice(`${noun} ${deleted.size}개를 영구 삭제했습니다.`);
      requestAnimationFrame(() => searchInput.current?.focus());
    } catch (error) {
      reloadAfterError(error);
    } finally {
      pending.current = false;
      setPurging(false);
    }
  }

  return <div className="trash-surface">
    <div className="trash-policy"><Clock3 size={19} aria-hidden="true"/><div>
      <strong>보관 및 복구</strong>
      <p>{noun}는 삭제한 시각부터 3일 동안 보관한 뒤 자동으로 영구 삭제됩니다.{' '}
      {scope === 'project'
        ? '복구하면 ‘나만 사용’으로 돌아오며, 공유와 자동 시작을 다시 설정할 수 있습니다.'
        : '복구하면 모든 판이 ‘나만 사용’으로 돌아옵니다. 다른 사람이 다시 사용하려면 자료를 새로 공유하세요.'}</p>
    </div></div>
    <label className="list-search">
      <Search size={16} aria-hidden="true" />
      <input ref={searchInput} aria-label={searchLabel} placeholder={searchLabel}
        value={search} onChange={event => updateSearch(event.target.value)} />
    </label>
    {actionError && <p className="modal-error" role="alert">{actionError}</p>}
    {notice && <p role="status">{notice}</p>}
    {listError ? <div className="empty-state">
      <p role="alert">{listError}</p>
      <button className="btn" type="button" onClick={() => {
        searchInput.current?.focus();
        setReload(value => value + 1);
      }}>다시 불러오기</button>
    </div> : items === null ? <p role="status">휴지통을 불러오는 중입니다.</p>
      : matches.length === 0 ? <div className="empty-state">
        <Trash2 size={20} aria-hidden="true" />
        <p role="status">{search.trim() ? '검색 결과가 없습니다.' : '휴지통이 비어 있습니다.'}</p>
        {search.trim()&&<button type="button" className="btn" onClick={()=>{
          updateSearch('');
          searchInput.current?.focus();
        }}>검색어 지우기</button>}
      </div> : <>
        <div className="trash-toolbar">
          <label className="trash-select">
            <input type="checkbox" ref={selectAll} aria-label={`표시된 ${noun} 전체 선택`}
              checked={allSelected} disabled={busy}
              onChange={event => setSelectedIds(new Set(event.target.checked ? matches.map(item => item.id) : []))} />
            전체 선택
          </label>
          <span className="trash-count" aria-live="polite">{selected.length}개 선택됨</span>
          <button className="btn trash-purge" ref={purgeButton} type="button"
            disabled={!selected.length || busy} onClick={() => {
              setNotice('');
              setActionError('');
              setConfirmation(selected);
            }}>
            <Trash2 size={16} aria-hidden="true" />선택 항목 영구 삭제
          </button>
        </div>
        <ul className="project-list trash-list" aria-label={scope === 'project' ? '삭제한 Agent 프로젝트' : '삭제한 자료'}>
          {matches.map(item => <li key={item.id} className="project-item trash-item">
            <label className="trash-select trash-project-select">
              <input type="checkbox" aria-label={titleOf(item) + ' 선택'} checked={selectedIds.has(item.id)}
                disabled={busy} onChange={event => {
                  const checked = event.target.checked;
                  setSelectedIds(current => {
                    const next = new Set(current);
                    if (checked) next.add(item.id);
                    else next.delete(item.id);
                    return next;
                  });
                }} />
              <span className="project-name">
                <b>{titleOf(item)}</b>
                {subtitleOf && <small>{subtitleOf(item)}</small>}
              </span>
            </label>
            <button className="btn trash-restore" aria-label={titleOf(item) + ' 복구'} type="button"
              disabled={busy} onClick={() => void restore(item)}>
              <Undo2 size={16} aria-hidden="true" />{restoring === item.id ? '복구 중…' : '복구'}
            </button>
            <dl className="trash-times">
              <div><dt>삭제</dt><dd><time dateTime={item.deletedAt}>{localDate.format(new Date(item.deletedAt))}</time></dd></div>
              <div><dt>자동 삭제 예정</dt><dd><time dateTime={item.expiresAt}>{localDate.format(new Date(item.expiresAt))}</time></dd></div>
            </dl>
          </li>)}
        </ul>
      </>}
    {confirmation && <StudioDialog title={noun + ' 영구 삭제'} size={confirmation.length>4?'standard':'confirm'} descriptionId="purge-summary"
      initialFocus={cancelButton} onClose={cancelPurge} dismissDisabled={purging}
      footer={<><button className="btn" type="button" ref={cancelButton} disabled={purging} onClick={cancelPurge}>취소</button>
        <button className="btn danger" type="button" disabled={purging || confirmationChanged} onClick={() => void purge()}>
          {purging ? '영구 삭제 중…' : '영구 삭제'}
        </button></>}>
      <p id="purge-summary">선택한 {noun} {confirmation.length}개를 영구 삭제할까요? 삭제하면 복구할 수 없습니다.</p>
      <ul className="purge-project-names" aria-label={'영구 삭제할 ' + noun}>
        {confirmation.map(item => <li key={item.id}>{titleOf(item)}</li>)}
      </ul>
      {confirmationChanged && !purging && <p className="modal-error" role="alert">
        보관 기한이 지난 {noun}가 있습니다. 취소한 뒤 남은 {noun}를 다시 확인하세요.
      </p>}
    </StudioDialog>}
  </div>;
}
