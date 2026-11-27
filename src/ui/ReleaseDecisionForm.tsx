import { useState } from 'react';
import { releaseDecisionLabels, type ReleaseAction, type ReleaseDecision } from '../domain/release-decision';

type Props = {
  version?: number;
  published: number | null;
  audienceChanged: boolean;
  busy: boolean;
  decisions: ReleaseDecision[];
  onDecide: (action: ReleaseAction, reason: string) => void;
};

export default function ReleaseDecisionForm({version, published, audienceChanged, busy, decisions, onDecide}: Props) {
  const [action, setAction] = useState<ReleaseAction | ''>('');
  const [reason, setReason] = useState('');
  const canPublish = published === null || (version !== undefined && (version > published || version === published && audienceChanged));
  const canKeep = published !== null && published === version;
  const canRollback = published !== null && version !== undefined && version < published;
  const available = {hold: version !== published, publish: canPublish, keep: canKeep, rollback: canRollback};
  if (action && !available[action]) setAction('');
  const edition = (value: number | null) => value === null ? '미게시' : value + '판';
  return <section className="vp-decision" aria-label="버전 판단과 기록">
    <label className="field">게시 판단
      <select disabled={busy} value={action} onChange={e=>setAction(e.target.value as ReleaseAction | '')}>
        <option value="">판단 선택</option>
        {(Object.keys(releaseDecisionLabels) as ReleaseAction[]).map(key=>
          <option value={key} key={key} disabled={!available[key]}>{releaseDecisionLabels[key]}</option>)}
      </select>
    </label>
    {action==='publish'&&<p>{version}판에 선택한 공유 범위를 적용합니다.</p>}
    {action==='rollback'&&<p>현재 공유 범위를 유지하고 새 대화에 {version}판을 적용합니다. 기존 대화는 시작한 판을 사용합니다.</p>}
    {(action==='hold'||action==='keep')&&<p>현재 게시 상태({edition(published)})와 공유 범위를 유지합니다.</p>}
    <label className="field">판단 근거
      <textarea rows={2} maxLength={1500} readOnly={busy} value={reason} placeholder="비교한 판, 실제 답변과 이용자에게 미치는 영향" onChange={e=>setReason(e.target.value)}/>
    </label>
    <button type="button" className="btn primary" disabled={busy||!version||!action||!available[action]||!reason.trim()}
      onClick={()=>{if(action)onDecide(action,reason.trim());}}>판단 적용 및 기록</button>
    {decisions.length>0&&<details className="ws-detail"><summary>판단 기록 ({decisions.length}건)</summary>
      <ol>{decisions.map(row=><li key={row.number}><strong>{row.version}판 · {releaseDecisionLabels[row.action]}</strong>
        <p>{row.reason}</p><small>게시 상태 {edition(row.previousVersion)} → {edition(row.resultVersion)}</small></li>)}</ol>
    </details>}
  </section>;
}
