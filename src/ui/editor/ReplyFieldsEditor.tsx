import {useState} from 'react';
import {replyFields} from '../../domain/reply-form';
import {Icon} from './Icons';

export function ReplyFieldsEditor({entries,onChange}:{entries:unknown[];onChange:(value:unknown[])=>void}) {
  const [draft,setDraft]=useState('');
  const fields=replyFields(entries);
  const name=draft.trim(),duplicate=fields.some(field=>field.name===name);
  function add(){
    if(!name || duplicate)return;
    onChange([...entries,name]);
    setDraft('');
  }
  return <fieldset className="ws-fieldset" data-field-key="fields">
    <legend>입력 항목</legend>
    {!fields.length&&<p className="ws-hint">항목이 없으면 이용자가 글로 답할 수 있습니다.</p>}
    {fields.map(field=>{
      const matches=(entry:unknown)=>replyFields([entry])[0]?.name===field.name;
      return <div className="ws-reply-field" key={field.name}>
        <span>{field.name}</span>
        <label className="ws-check"><input type="checkbox" checked={field.required} aria-label={field.name+' 필수'}
          onChange={e=>onChange(entries.map(entry=>matches(entry)
            ? {...(typeof entry==='object' && entry!==null?entry:{name:field.name}),required:e.target.checked}
            : entry))}/>필수</label>
        <button type="button" className="ws-icon-button" aria-label={field.name+' 삭제'}
          onClick={()=>onChange(entries.filter(entry=>!matches(entry)))}><Icon name="close" size={14}/></button>
      </div>;
    })}
    <div className="ws-chip-add">
      <input aria-label="입력 항목 새 항목" placeholder="항목 이름" value={draft} onChange={e=>setDraft(e.target.value)}
        onKeyDown={e=>{if(e.key==='Enter' && !e.nativeEvent.isComposing){e.preventDefault();add();}}}/>
      <button type="button" className="ws-btn" onClick={add} disabled={!name||duplicate}>추가</button>
    </div>
    {duplicate&&<small role="status">같은 이름의 항목이 있습니다.</small>}
  </fieldset>;
}
