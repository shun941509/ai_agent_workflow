import {useEffect, useRef, useState} from 'react';
import type {Graph} from '../../domain';
import type {ExportResource} from '../../domain/agent-export';
import {api, message, studioResponse} from '../client';
import {Modal} from './Modal';

const kindLabels = {document:'문서', skill:'Skill', knowledge:'지식 자료집', mcp:'MCP 도구', workflow:'하위 Workflow'};

export function AgentExportDialog({projectId, title, graph, hasSourceDrafts, onClose, onDownloaded}: {
  projectId:string;
  title:string;
  graph:Graph;
  hasSourceDrafts:boolean;
  onClose:() => void;
  onDownloaded:() => void;
}) {
  const [snapshot] = useState(() => ({id:projectId, title, graph}));
  const [resources, setResources] = useState<ExportResource[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const download = useRef<AbortController | null>(null);
  const preview = useRef<{id:string; resources:Map<string,ExportResource>} | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<{resources:ExportResource[];previewId:string}>('project.exportPreview', snapshot, controller.signal)
      .then(({resources,previewId:updatedId}) => {
        if (controller.signal.aborted) return;
        const previousPreview = preview.current;
        preview.current = {id:updatedId, resources:new Map(resources.map(resource => [resource.key, resource]))};
        setResources(resources);
        setSelected(previous => resources.filter(resource => {
          if (!resource.available) return false;
          if (!previousPreview) return resource.kind !== 'mcp';
          const earlier = previousPreview.resources.get(resource.key);
          return previous.includes(resource.key) && earlier?.mcpMode === resource.mcpMode && earlier?.mcpUrl === resource.mcpUrl;
        }).map(resource => resource.key));
      })
      .catch(cause => { if (!controller.signal.aborted) setError(message(cause)); });
    return () => controller.abort();
  }, [snapshot, attempt]);

  useEffect(() => () => download.current?.abort(), []);

  async function exportZip() {
    if (!resources || !preview.current || download.current) return;
    const controller = new AbortController();
    download.current = controller;
    setBusy(true);
    setError('');
    try {
      const response = await studioResponse('project.exportAgent', {...snapshot, selected, previewId:preview.current.id}, controller.signal);
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = (snapshot.title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Workflow') + '.zip';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onDownloaded();
    } catch (cause) {
      if (!controller.signal.aborted) setError(message(cause));
    } finally {
      download.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const groups = [
    {label:'ZIP에 포함할 자료', hint:'제외한 자료는 지침에 표시된 단계에서 다시 연결하세요.',
      items:resources?.filter(resource => resource.kind !== 'mcp')},
    {label:'ZIP에 포함할 MCP 연결', hint:'공유할 연결을 선택하세요. 인증이 필요한 서버는 받는 사람이 자신의 환경에서 인증합니다.',
      items:resources?.filter(resource => resource.kind === 'mcp')},
  ];
  return <Modal title="Agent 내보내기" onClose={onClose}>
    <p><strong>{snapshot.title || '이름 없는 Agent'}</strong>의 현재 설계를 작업 지침으로 받습니다. 압축을 푼 폴더를 Codex, Claude Code 또는 OpenCode에서 여세요.</p>
    {hasSourceDrafts && <p className="ws-hint">편집 중인 자료 원문은 ‘변경 적용’을 마친 내용까지 포함합니다.</p>}
    {resources === null && !error && <p role="status" className="ws-hint">연결 자료를 확인하는 중…</p>}
    {groups.map(({label, hint, items}) => items && items.length > 0 && <fieldset key={label} className="ws-fieldset ws-export-materials" disabled={busy}>
      <legend>{label}</legend>
      <p className="ws-hint">{hint}</p>
      {items.map(resource => <label key={resource.key}>
        <input type="checkbox" checked={selected.includes(resource.key)} disabled={!resource.available}
          onChange={event => setSelected(event.target.checked
            ? [...selected, resource.key] : selected.filter(key => key !== resource.key))}/>
        <span><strong>{resource.name}</strong>
          <small>{[kindLabels[resource.kind], /^\d+$/.test(resource.version) ? resource.version + '판' : resource.version,
            ...resource.steps].filter(Boolean).join(' · ')}</small>
          {resource.mcpMode === 'remote' && resource.available && <small>공유할 서버 주소 · {resource.mcpUrl}</small>}
          {resource.mcpMode === 'manual' && resource.available && <small>받는 사람이 연결할 수 있도록 README.md에 설정 방법을 담습니다.</small>}
          {!resource.available && <small>사용할 환경에서 다시 연결하세요.</small>}
        </span>
      </label>)}
    </fieldset>)}
    {resources?.length === 0 && <p className="ws-hint">이 설계에는 연결된 자료나 MCP가 없습니다.</p>}
    {error && <p role="alert" className="ws-danger">{error}</p>}
    <div className="ws-modal-actions">
      {error && <button type="button" className="ws-btn" disabled={busy}
        onClick={() => { setError(''); setResources(null); setAttempt(value => value + 1); }}>자료 다시 확인</button>}
      <button type="button" className="ws-btn ws-primary" disabled={resources === null || busy} onClick={exportZip}>
        {busy ? 'ZIP 준비 중…' : 'ZIP 내려받기'}
      </button>
    </div>
  </Modal>;
}
