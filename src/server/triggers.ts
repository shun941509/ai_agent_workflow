import {scheduleTime} from '../domain/schedule';
import {timingSafeEqual} from 'node:crypto';
import type {Graph} from '../domain';
import type {User} from './auth';
import {all,digest,key,one,set,tx} from './db';
import {requireThat,stringArg,StudioError} from './errors';
import {getVersion,owned,project} from './projects';
import {enqueueRun} from './runs';

type Automation={id:string;owner:string;project:string;version:number;node:string;kind:'event'|'schedule';setting:string;input:string;enabled:number;token_hash:string;next_at:number|null;note:string};
export function nextTime(setting:string,after:number):number|null {
  const result=scheduleTime(setting,after);
  if('error' in result)throw new StudioError(422,result.error);
  return result.time;
}
function presentation(a:Automation){return {id:a.id,node:a.node,kind:a.kind,setting:a.setting,version:a.version,enabled:Boolean(a.enabled),input:a.input,nextAt:a.next_at?new Date(a.next_at).toISOString():null,note:a.note};}
function registration(id:string){const a=one<Automation>('SELECT * FROM automations WHERE id=?',id);requireThat(a,404,'자동 시작 설정을 찾을 수 없습니다.');return a;}
export function triggerList(user:User,id:string){
  const p=owned(user,id);
  const nodes=p.public_version?(JSON.parse(getVersion(p.id,p.public_version).graph) as Graph).nodes:[];
  const registrations=all<Automation>('SELECT * FROM automations WHERE project=? ORDER BY node',p.id).map(presentation);
  const triggers=nodes.filter(n=>n.type==='control.trigger'&&['event','schedule'].includes(n.config.trigger)).map(n=>{
    const kind=n.config.trigger,setting=String(n.config[kind]||'').trim();
    let resumeAt:string|null=null;
    if(kind==='schedule'&&registrations.some(a=>a.node===n.id&&!a.enabled&&a.note)){
      // The new edition may contain an invalid or expired setting. Activation validates it.
      try{const next=nextTime(setting,Date.now());if(next!==null)resumeAt=new Date(next).toISOString();}catch{}
    }
    return {id:n.id,title:n.title,kind,setting,resumeAt};
  });
  return {version:p.public_version,triggers,registrations};
}
export function enableTrigger(user:User,b:{id:string;node:string;input:string;version:number},at=Date.now()){
  return tx(()=>{const p=owned(user,b.id);
    requireThat(user.login&&p.public_version&&p.public_version===Number(b.version),409,'로그인 후 사용할 버전을 게시하고 설정을 다시 여세요.');
    const graph:Graph=JSON.parse(getVersion(p.id,p.public_version).graph);
    const n=graph.nodes.find(n=>n.id===b.node&&n.type==='control.trigger');
    requireThat(n&&['schedule','event'].includes(n.config.trigger),422,'게시판의 예약 또는 이벤트 시작 블록을 선택하세요.');
    const kind=n.config.trigger,setting=stringArg(n.config[kind],kind==='schedule'?'일정':'이벤트 이름',200),input=stringArg(b.input,'기본 입력',40000);
    const next=kind==='schedule'?nextTime(setting,at):null;
    if(kind==='schedule')requireThat(next!==null,422,'앞으로 실행할 시각을 지정하세요.');
    const old=one<Automation>('SELECT * FROM automations WHERE project=? AND node=?',p.id,n.id);
    requireThat(!old?.enabled,409,'기존 자동 시작을 해제한 뒤 변경하세요.');
    const id=old?.id??key(),secret=kind==='event'?key()+key():'';
    set("INSERT INTO automations(id,owner,project,version,node,kind,setting,input,enabled,token_hash,next_at,note) VALUES(?,?,?,?,?,?,?,?,1,?,?, '') ON CONFLICT(project,node) DO UPDATE SET version=excluded.version,kind=excluded.kind,setting=excluded.setting,input=excluded.input,enabled=1,token_hash=excluded.token_hash,next_at=excluded.next_at,note=''",id,user.id,p.id,p.public_version,n.id,kind,setting,input,digest(secret),next);
    return {...presentation(registration(id)),...(secret?{secret}:{})};
  });
}
export function disableTrigger(user:User,id:string){const a=registration(id);owned(user,a.project);set("UPDATE automations SET enabled=0,next_at=NULL,token_hash='',note='' WHERE id=?",id);return presentation(registration(id));}
function current(a:Automation){const p=project(a.project);requireThat(a.enabled&&p.owner===a.owner&&p.public_version===a.version,409,'자동 시작이 해제됐거나 게시 버전이 변경되었습니다.');const user=one<User>('SELECT id,login FROM people WHERE id=?',a.owner);requireThat(user?.login,403,'자동 시작 계정을 확인하세요.');return user;}
function event(a:Automation,eventId:unknown,input:unknown){
  const user=current(a);requireThat(a.kind==='event',422,'이 설정은 이벤트를 받지 않습니다.');
  const id=stringArg(eventId,'이벤트 번호',150),text=input==null?a.input:stringArg(input,'이벤트 입력',40000);
  return enqueueRun(user,{id:a.project,input:text,mode:'live',requestKey:'event:'+digest(JSON.stringify([a.id,a.version,a.node,id]))},{kind:'event',name:a.setting,nodeId:a.node});
}
export function ownerEvent(user:User,b:{id:string;eventId:string;input?:string}){return tx(()=>{const a=registration(b.id);owned(user,a.project);return event(a,b.eventId,b.input);});}
export function acceptEvent(id:string,secret:string,b:{eventId:string;input?:string}){
  return tx(()=>{const a=one<Automation>('SELECT * FROM automations WHERE id=?',id);const received=Buffer.from(digest(secret));const expected=Buffer.from(a?.token_hash||'');
    requireThat(secret&&a&&a.enabled&&a.kind==='event'&&expected.length===received.length&&timingSafeEqual(expected,received),403,'올바른 이벤트 인증이 필요합니다.');
    const r=event(a,b.eventId,b.input);return {runId:r.id};});
}
/** Claim a due instant and queue its run in the same transaction; coalesce downtime to one delivery. */
export function dispatchDue(at=Date.now(),startedAt=at):boolean{
  const a=one<Automation>('SELECT * FROM automations WHERE enabled=1 AND next_at<=? ORDER BY next_at LIMIT 1',at);
  if(!a)return false;
  try{return tx(()=>{
    const actual=registration(a.id);if(!actual.enabled||actual.next_at===null||actual.next_at>at)return false;
    const user=current(actual);const instant=new Date(actual.next_at).toISOString();
    enqueueRun(user,{id:actual.project,mode:'live',input:actual.input,requestKey:'schedule:'+digest(JSON.stringify([a.id,actual.version,instant]))},{kind:'schedule',nodeId:actual.node,scheduledAt:instant});
    const next=nextTime(actual.setting,Math.max(actual.next_at,startedAt));
    set("UPDATE automations SET next_at=?,enabled=?,note='' WHERE id=?",next,next===null?0:1,a.id);
    return true;
  });}catch(error){
    const message=error instanceof Error?error.message:'자동 시작 오류';
    set("UPDATE automations SET enabled=0,next_at=NULL,note=? WHERE id=? AND next_at=?",message,a.id,a.next_at);return true;
  }
}

/** Poll independently of model and tool calls occupying both run slots. */
export function startScheduleClock() {
  const startedAt=Date.now();
  function poll(){
    try{
      const at=Date.now();
      // Bound synchronous queue work so run workers keep their turns with many schedules.
      for(let n=0;n<32&&dispatchDue(at,startedAt);n++){}
    }catch(error){console.error('예약 접수 오류',error instanceof Error?error.message:'unknown');}
  }
  poll();
  const clock=setInterval(poll,400);
  return ()=>clearInterval(clock);
}
