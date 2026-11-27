'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {api, message} from '../client';

type Choice = {id:string; title:string; mine:boolean; publicVersion:number|null};

function useChoices<T>(action:string, id?:string|null) {
  const [result, setResult] = useState<{id?:string|null; items:T[]; error:string}>();
  const [attempt, setAttempt] = useState(0);
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (id === null) return;
    const request = new AbortController();
    api<T[]>(action, id ? {id} : {}, request.signal)
      .then(items => { if (!request.signal.aborted) setResult({id,items,error:''}); })
      .catch(cause => { if (!request.signal.aborted) setResult({id,items:[],error:message(cause)}); });
    return () => request.abort();
  }, [action,id,attempt]);
  const current = result?.id === id ? result : undefined;
  return {items:current?.items ?? [], loading:id !== null && !current, error:current?.error, select, retry() {
    select.current?.focus();
    setResult(undefined);
    setAttempt(count => count + 1);
  }};
}

export default function WorkflowRefPicker({id,version,change}: {
  id:string; version:string; change:(id:string,version:string)=>void;
}) {
  const projects = useChoices<Choice>('project.list');
  const selected = projects.items.find(p => p.id === id);
  const ownVersions = useChoices<{number:number}>('versions.list', selected?.mine ? id : null);
  const versionHint = useId();
  const versions = selected?.mine ? ownVersions.items.map(item => item.number) : selected?.publicVersion ? [selected.publicVersion] : [];
  if (Number(version) > 0) versions.push(Number(version));

  return <div>
    <label className="ws-field"><span>호출할 Workflow</span>
      <select ref={projects.select} value={id} onChange={event => {
        const item = projects.items.find(p => p.id === event.target.value);
        change(item?.id ?? '', item?.publicVersion ? String(item.publicVersion) : '');
      }}>
        <option value="">이 블록 내부에 설계하기</option>
        {projects.items.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        {id && !selected && <option value={id}>연결된 Workflow</option>}
      </select>
    </label>
    {projects.loading && <small role="status">Workflow 목록을 불러오는 중입니다.</small>}
    {projects.error && <div className="ws-read-recovery"><small role="alert">{projects.error}</small>
      <button type="button" className="ws-btn" onClick={projects.retry}>Workflow 목록 다시 불러오기</button></div>}
    {id && <label className="ws-field"><span>Workflow 버전</span>
      <select ref={ownVersions.select} value={version} aria-describedby={version ? undefined : versionHint} onChange={event => change(id, event.target.value)}>
        <option value="">자동으로 버전 선택</option>
        {[...new Set(versions)].sort((a,b) => b-a).map(n => <option key={n} value={n}>{n}판</option>)}
      </select>
    </label>}
    {id && !version && <p className="ws-hint" id={versionHint}>버전을 저장하거나 초안을 시험할 때 게시된 판을 사용합니다. 내 Workflow에 게시된 판이 없으면 마지막으로 저장한 판을 사용합니다.</p>}
    {ownVersions.loading && <small role="status">Workflow 버전을 불러오는 중입니다.</small>}
    {ownVersions.error && <div className="ws-read-recovery"><small role="alert">{ownVersions.error}</small>
      <button type="button" className="ws-btn" onClick={ownVersions.retry}>버전 다시 불러오기</button></div>}
  </div>;
}
