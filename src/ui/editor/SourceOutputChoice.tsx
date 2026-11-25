import { useId } from 'react';
import { firstSourceChange, type SourceOutput } from './source-comparison';

export function SourceOutputChoice({ data, edited, onChoose, action }: {
  data:SourceOutput; edited:boolean; onChoose:(edited:boolean)=>void; action:'버전 저장'|'내보내기';
}) {
  const {applied,drafts} = data;
  const tested = data.tested?.sources;
  const fieldId = useId();
  const entries = Object.entries(drafts);
  const outputText = (key:string) => edited && drafts[key] ? drafts[key].text : applied[key]?.text;
  const differences = tested ? [...new Set([...Object.keys(applied),...Object.keys(tested)])]
    .filter(key => outputText(key) !== tested[key]?.text) : [];
  if (!entries.length && !data.tested) return null;
  return <section className="source-output" aria-label="원문 확인">
    {entries.length > 0 && <div>
      <label htmlFor={fieldId}>{action}에 포함할 원문</label>
      <select id={fieldId} value={edited?'edited':'applied'} onChange={event=>onChoose(event.target.value==='edited')}>
        <option value="edited">수정 중인 원문 포함 ({entries.length}개)</option>
        <option value="applied">현재 적용된 원문만</option>
      </select>
    </div>}
    <div aria-live="polite">
      {data.tested && <p>마지막 시험 대상 · {data.tested.version ? 'v'+data.tested.version : '초안'} · {new Date(data.tested.created).toLocaleString('ko-KR')}{data.tested.caseTitle && ' · '+data.tested.caseTitle}</p>}
      {data.tested?.sources === null && <p>마지막 시험의 자료에 접근할 수 없어 원문을 비교할 수 없습니다.</p>}
      {entries.map(([key,draft]) => {
        const change = firstSourceChange(draft.base,draft.text);
        return <p key={key}><strong>{applied[key]?.title}</strong> · {edited ? change.after : change.before}</p>;
      })}
      {tested && differences.length > 0 && <>
        <p><strong>마지막 시험과 원문이 다릅니다.</strong></p>
        {differences.map(key => {
          const change = firstSourceChange(tested[key]?.text ?? '', outputText(key) ?? '');
          return <p key={key}><strong>{applied[key]?.title ?? tested[key].title}</strong><br/>
            마지막 시험 · {tested[key] ? change.before : '원문 없음'}<br/>
            이번 {action} · {applied[key] ? change.after : '원문 없음'}</p>;
        })}
      </>}
      {edited && entries.some(([,draft])=>!draft.text.trim()) && <p>빈 원문을 채우거나 현재 적용된 원문을 선택하세요.</p>}
    </div>
  </section>;
}
