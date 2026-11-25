import { useEffect, useState } from 'react';
import { ChevronRight, FolderOpen } from 'lucide-react';
import StudioDialog from './StudioDialog';
import { api, message } from './client';

export type ProjectMenuAction = 'import' | 'connect';
type Choice = { id: string; title: string; mine: boolean; updated: string };

export default function ProjectActionPicker({ action, resourceLabel, onClose, onSelect }: {
  action: ProjectMenuAction;
  resourceLabel?: string;
  onClose: () => void;
  onSelect: (id: string, action: ProjectMenuAction) => Promise<void>;
}) {
  const [projects, setProjects] = useState<Choice[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let active = true;
    api<Choice[]>('project.list').then(items => {
      if (active) setProjects(items.filter(project => project.mine));
    }).catch(err => { if (active) setError(message(err)); });
    return () => { active = false; };
  }, [attempt]);

  async function pick(id: string) {
    setOpening(true);
    setError('');
    try {
      await onSelect(id, action);
    } catch (err) {
      setError(message(err));
      setAttempt(n => n + 1);
    } finally {
      setOpening(false);
    }
  }

  return (
    <StudioDialog title="프로젝트 선택" onClose={onClose} dismissDisabled={opening} descriptionId="project-action-prompt">
      <p id="project-action-prompt">{action === 'connect' ? resourceLabel + '을 연결할 내 Workflow를 선택하세요.' :
        '설계를 가져올 내 프로젝트를 선택하세요.'}</p>
      {error && <p role="alert" className="modal-error">{error}</p>}
      {projects === null ? (
        error ? <button type="button" className="btn" onClick={() => { setError(''); setAttempt(n => n + 1); }}>다시 불러오기</button>
          : <p role="status">프로젝트 목록을 불러오는 중입니다…</p>
      ) : projects.length === 0 ? (
        <p>{action === 'connect' ? '내 Agent에서 프로젝트를 만든 뒤 이 자료를 연결하세요.' : '선택할 프로젝트가 없습니다.'}</p>
      ) : (
        <div className="project-list">
          {projects.map(project => (
            <div className="project-item" key={project.id}>
              <button type="button" className="project-row" aria-label={project.title} disabled={opening} onClick={() => void pick(project.id)}>
                <FolderOpen size={18} aria-hidden="true" />
                <span className="project-name">
                  <b>{project.title}</b>
                  <small>최근 수정 {new Date(project.updated).toLocaleDateString('ko-KR')}</small>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn" disabled={opening} onClick={onClose}>취소</button>
    </StudioDialog>
  );
}
