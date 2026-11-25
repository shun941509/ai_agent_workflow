import { useState } from 'react';
import { agentPurposeLimit, type AgentScope } from '../../domain';
import { Modal } from './Modal';

export function AgentScopeDialog({ scope, onApply, onClose }: {
  scope?: AgentScope;
  onApply: (scope: AgentScope) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<AgentScope['mode']>(scope?.mode ?? 'general');
  const [purpose, setPurpose] = useState(scope?.purpose ?? '');
  const valid = mode === 'general' || Boolean(purpose.trim());
  return <Modal title="Agent 업무 범위" onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault();
      if (valid) onApply({mode, purpose:purpose.trim()});
    }}>
      <label className="ws-field">
        <span>응답 범위</span>
        <select autoFocus value={mode} onChange={event => setMode(event.target.value === 'dedicated' ? 'dedicated' : 'general')}>
          <option value="dedicated">업무 전용</option>
          <option value="general">범용</option>
        </select>
      </label>
      {mode === 'dedicated' ? <>
        <label className="ws-field">
          <span>맡길 업무</span>
          <textarea required rows={3} maxLength={agentPurposeLimit} value={purpose} aria-describedby="agent-scope-hint"
            onChange={event => setPurpose(event.target.value)}
            placeholder="회의 메모에서 결정 사항과 담당자를 정리합니다." />
        </label>
        <p className="ws-hint" id="agent-scope-hint">여러 부탁이 섞여 있으면 이 업무에 해당하는 부분을 처리합니다.</p>
      </> : <p className="ws-hint">다양한 주제의 요청을 현재 Workflow로 처리합니다.</p>}
      <div className="ws-modal-actions">
        <button type="submit" className="ws-btn ws-primary" disabled={!valid}>적용</button>
      </div>
    </form>
  </Modal>;
}
