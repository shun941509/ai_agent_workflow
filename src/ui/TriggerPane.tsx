'use client';
import {useCallback,useEffect,useState} from 'react';
import './trigger-pane.css';

type Registration={id:string;node:string;enabled:boolean;version:number;kind:string;setting:string;input:string;nextAt:string|null;note:string};
type Overview={version:number|null;triggers:{id:string;title:string;kind:string;setting:string;resumeAt?:string|null}[];registrations:Registration[]};
export default function TriggerPane({id,api,onRun}:{id:string;api:(action:string,data?:any)=>Promise<any>;onRun:(id:string)=>Promise<void>}){
  const [state,setState]=useState<Overview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [input,setInput]=useState<Record<string,string>>({}),[secrets,setSecrets]=useState<Record<string,string>>({});
  const refresh=useCallback(async()=>setState(await api('trigger.list',{id})),[id,api]);
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[refresh]);
  async function act(work:()=>Promise<void>){setBusy(true);setError('');try{await work();await refresh();}catch(e){setError(e instanceof Error?e.message:'자동 시작을 설정하지 못했습니다.');}finally{setBusy(false);}}
  return <section className="run-cases trigger-pane"><h3>자동 시작</h3>
    {error&&<p role="alert">{error}</p>}
    {state&&!state.triggers.length&&<p>시작 조건 블록에서 예약 또는 이벤트를 선택하고 버전을 게시하세요.</p>}
    {state?.triggers.map(t=>{const a=state.registrations.find(a=>a.node===t.id);
      return <div key={t.id} className="trigger-row"><h4>{t.title} · {t.kind==='event'?'이벤트':'예약'}</h4>
        <small>{state.version}판 · {t.setting}</small>
        {a?.enabled&&a.version===state.version?<><p>{a.kind==='schedule'&&a.nextAt?'다음 실행 '+new Date(a.nextAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' (한국 시각)':'이벤트를 기다리고 있습니다.'}</p>
          {a.kind==='event'&&<>
            <label>이벤트 주소<input readOnly value={location.origin+'/api/events/'+a.id}/></label>
            {secrets[a.id]&&<label>이벤트 토큰 · 이 화면에서 한 번 표시<input readOnly type="password" value={secrets[a.id]} onFocus={e=>e.target.select()}/><button type="button" onClick={()=>void act(()=>navigator.clipboard.writeText(secrets[a.id]))}>토큰 복사</button></label>}
            <button disabled={busy} onClick={()=>void act(async()=>{const r=await api('trigger.event',{id:a.id,eventId:crypto.randomUUID()});await onRun(r.id);})}>기본 입력으로 이벤트 보내기</button>
          </>}
        </>:<label>시작할 때 전달할 입력<input value={input[t.id]??a?.input??''} onChange={e=>setInput({...input,[t.id]:e.target.value})}/></label>}
        {a?.note&&<small>{a.note}</small>}
        {t.resumeAt&&<small>지금 재개하면 첫 예약은 {new Date(t.resumeAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (한국 시각)입니다.</small>}
        {a?.enabled?<button disabled={busy} onClick={()=>void act(async()=>{await api('trigger.disable',{id:a.id});setSecrets(old=>({...old,[a.id]:''}));})}>자동 시작 해제</button>:
          <button disabled={busy||!(input[t.id]??a?.input)?.trim()} onClick={()=>void act(async()=>{const next=await api('trigger.enable',{id,node:t.id,version:state.version,input:input[t.id]??a?.input});if(next.secret)setSecrets(old=>({...old,[next.id]:next.secret}));})}>{t.kind==='schedule'&&a?.note?'게시한 버전으로 예약 재개':'게시한 버전으로 활성화'}</button>}
      </div>;})}
    {state?.registrations.filter(a=>a.enabled&&!state.triggers.some(t=>t.id===a.node)).map(a=><div key={a.id}><p>이전 {a.version}판 · {a.setting}</p><button onClick={()=>void act(async()=>{await api('trigger.disable',{id:a.id});})}>이전 설정 해제</button></div>)}
  </section>;
}
