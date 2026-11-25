'use client';
import {useEffect,useState} from 'react';
import {api} from '../client';
type Choice={id:string;title:string;mine:boolean;publicVersion:number|null};
export default function WorkflowRefPicker({id,version,change}:{id:string;version:string;change:(id:string,version:string)=>void}){
  const [projects,setProjects]=useState<Choice[]>([]),[versions,setVersions]=useState<number[]>([]),[error,setError]=useState('');
  useEffect(()=>{let active=true;api<Choice[]>('project.list').then(items=>{if(active)setProjects(items);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  useEffect(()=>{let active=true;const selected=projects.find(p=>p.id===id);setVersions([]);if(!selected)return;
    if(selected.mine)api<{number:number}[]>('versions.list',{id}).then(items=>{if(active)setVersions(items.map(v=>v.number));}).catch(e=>{if(active)setError(e.message);});
    else if(selected.publicVersion)setVersions([selected.publicVersion]);
    return()=>{active=false;};},[id,projects]);
  return <div><label className="ws-field"><span>호출할 Workflow</span><select value={id} onChange={e=>{const p=projects.find(p=>p.id===e.target.value);change(p?.id??'',p?.publicVersion?String(p.publicVersion):'');}}>
    <option value="">이 블록 내부에 설계하기</option>
    {projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}
    {id&&!projects.some(p=>p.id===id)&&<option value={id}>연결된 Workflow</option>}
  </select></label>{id&&<label className="ws-field"><span>Workflow 버전</span><select value={version} onChange={e=>change(id,e.target.value)}>
    <option value="">버전 저장 시점의 게시판 또는 최신 내 버전</option>
    {Array.from(new Set([...versions,...(Number(version)>0?[Number(version)]:[])])).sort((a,b)=>b-a).map(n=><option key={n} value={n}>{n}판</option>)}
  </select></label>}{error&&<small role="alert">{error}</small>}</div>;
}
