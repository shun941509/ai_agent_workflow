'use client';
import {useEffect,useRef,useState} from 'react';
import type {McpPin} from '../../domain/mcp-scope';
import {api} from '../client';

interface Detail {asset:{name:string};payload:{tools?:string[];readOnlyTools?:string[]}}
interface Option {id:string;label:string}
export default function McpToolPicker({pins,ceiling,chosen,allowMultiple,onChoose}:{
  pins:McpPin[];ceiling?:string[];chosen:string[];allowMultiple:boolean;onChoose:(id:string)=>void;
}){
  const selection=JSON.stringify(pins);
  const [loaded,setLoaded]=useState<{selection:string;options:Option[];errors:string[];retryable:boolean}|null>(null);
  const [attempt,setAttempt]=useState(0);
  const label=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    const request=new AbortController();
    const refs=JSON.parse(selection) as McpPin[];
    const ambiguous=refs.some(pin=>refs.filter(p=>p.assetId===pin.assetId).length>1);
    const unique=refs.filter(pin=>refs.filter(p=>p.assetId===pin.assetId).length===1);
    Promise.allSettled(unique.map(async pin=>{
      const detail=await api<Detail>('asset.read',{id:pin.assetId,version:pin.version},request.signal);
      return (detail.payload.tools??[]).map(tool=>({id:'mcp.'+pin.assetId+'.'+tool,
        label:detail.asset.name+' · '+pin.version+'판 · '+tool+(detail.payload.readOnlyTools?.includes(tool)?' (조회)':' (승인 필요)')}));
    })).then(results=>{
      if(request.signal.aborted)return;
      const options=results.flatMap(result=>result.status==='fulfilled'?result.value:[]);
      const errors=results.flatMap(result=>result.status==='rejected'?[String(result.reason?.message??'연결한 MCP 정보를 읽을 수 없습니다.')]:[]);
      const retryable=errors.length>0;
      if(ambiguous)errors.push('같은 MCP의 여러 판이 연결되어 있습니다. 사용할 판 하나를 연결하세요.');
      setLoaded({selection,options,errors,retryable});
    });
    return()=>request.abort();
  },[selection,attempt]);
  const latest=loaded?.selection===selection?loaded:null;
  const options=(latest?.options??[]).filter(opt=>!ceiling||ceiling.includes(opt.id));
  return <div><label className="ws-field"><span ref={label} tabIndex={-1}>{allowMultiple?'연결한 MCP에서 허용 도구 추가':'연결한 MCP에서 도구 선택'}</span>
    <select value={!allowMultiple&&options.some(o=>chosen.includes(o.id))?chosen[0]:''} disabled={!options.length}
      onChange={e=>{if(e.target.value)onChoose(e.target.value);}}>
      <option value="">{latest?(options.length?'도구 선택':'선택할 도구 없음'):'도구 불러오는 중'}</option>
      {options.map(option=><option key={option.id} value={option.id} disabled={allowMultiple&&chosen.includes(option.id)}>{option.label}</option>)}
    </select></label>{!!latest?.errors.length&&<div className="ws-read-recovery">
      {latest.errors.map((message,i)=><small key={i} role="alert">{message}</small>)}
      {latest.retryable&&<button type="button" className="ws-btn" onClick={()=>{
      label.current?.focus();setLoaded(null);setAttempt(value=>value+1);
    }}>MCP 도구 다시 불러오기</button>}</div>}</div>;
}
