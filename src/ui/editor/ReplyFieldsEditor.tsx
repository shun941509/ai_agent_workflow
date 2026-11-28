import {useRef,useState} from 'react';
import {replyFields} from '../../domain/reply-form';
import {Icon} from './Icons';

export function ReplyFieldsEditor({entries,onChange}:{entries:unknown[];onChange:(value:unknown[])=>void}) {
  const [draft,setDraft]=useState('');
  const addInput=useRef<HTMLInputElement>(null);
  const removeButtons=useRef(new Map<string,HTMLButtonElement>());
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
    {fields.map((field,index)=>{
      const matches=(entry:unknown)=>replyFields([entry])[0]?.name===field.name;
      function setOption(key:'required'|'multiline',checked:boolean) {
        onChange(entries.map(entry=>matches(entry)
          ? {...(typeof entry==='object' && entry!==null?entry:{name:field.name}),[key]:checked}
          : entry));
      }
      return <div className="ws-reply-field" key={field.name}>
        <span>{field.name}</span>
        <div className="ws-reply-field-options">
          <label className="ws-check"><input type="checkbox" checked={field.required} aria-label={field.name+' 필수'}
            onChange={e=>setOption('required',e.target.checked)}/>필수</label>
          <label className="ws-check"><input type="checkbox" checked={field.multiline===true} aria-label={field.name+' 여러 줄'}
            onChange={e=>setOption('multiline',e.target.checked)}/>여러 줄</label>
        </div>
        <button type="button" className="ws-icon-button" aria-label={field.name+' 삭제'}
          ref={button=>{if(button)removeButtons.current.set(field.name,button);else removeButtons.current.delete(field.name);}}
          onClick={()=>{
            const neighbor=fields[index+1]??fields[index-1];
            onChange(entries.filter(entry=>!matches(entry)));
            requestAnimationFrame(()=>(neighbor?removeButtons.current.get(neighbor.name):addInput.current)?.focus());
          }}><Icon name="close" size={14}/></button>
      </div>;
    })}
    <div className="ws-chip-add">
      <input ref={addInput} aria-label="입력 항목 새 항목" placeholder="항목 이름" value={draft} onChange={e=>setDraft(e.target.value)}
        onKeyDown={e=>{if(e.key==='Enter' && !e.nativeEvent.isComposing){e.preventDefault();add();}}}/>
      <button type="button" className="ws-btn" onClick={add} disabled={!name||duplicate}>추가</button>
    </div>
    {duplicate&&<small role="status">같은 이름의 항목이 있습니다.</small>}
  </fieldset>;
}
