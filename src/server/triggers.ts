import {timingSafeEqual} from 'node:crypto';
import type {Graph} from '../domain';
import type {User} from './auth';
import {all,digest,key,one,set,tx} from './db';
import {requireThat,stringArg} from './errors';
import {getVersion,owned,project} from './projects';
import {enqueueRun} from './runs';

type Automation={id:string;owner:string;project:string;version:number;node:string;kind:'event'|'schedule';setting:string;input:string;enabled:number;token_hash:string;next_at:number|null;note:string};
const minute=60_000;
const day=24*60*minute;

/** Times with offsets are unambiguous; fixed wall-clock daily schedules use Korea Standard Time. */
export function nextTime(setting:string,after:number):number|null{
  const interval=setting.trim().match(/^(?:every\s+(\d+)m|매\s*(\d+)\s*분)$/i);
  if(interval){const count=Number(interval[1]||interval[2]);requireThat(Number.isInteger(count)&&count>=1&&count<=525600,422,'반복 간격은 1~525600분입니다.');return after+count*minute;}
  const daily=setting.trim().match(/^(?:daily|매일)\s+(\d{1,2}):(\d{2})$/i);
  if(daily){const h=Number(daily[1]),m=Number(daily[2]);requireThat(h<24&&m<60,422,'일정 시각을 확인하세요.');
    const dayStart=Math.floor((after+9*60*minute)/day)*day-9*60*minute;
    const candidate=dayStart+(h*60+m)*minute;return candidate>after?candidate:candidate+day;}
  const date=Date.parse(setting);
  requireThat(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i.test(setting)&&Number.isFinite(date),422,'일정은 매일 09:00, 매 15분 또는 시간대가 있는 ISO 시각을 입력하세요.');
  return date>after?date:null;
}
function presentation(a:Automation){return {id:a.id,node:a.node,kind:a.kind,setting:a.setting,version:a.version,enabled:Boolean(a.enabled),input:a.input,nextAt:a.next_at?new Date(a.next_at).toISOString():null,note:a.note};}
function registration(id:string){const a=one<Automation>('SELECT * FROM automations WHERE id=?',id);requireThat(a,404,'자동 시작 설정을 찾을 수 없습니다.');return a;}
export function triggerList(user:User,id:string){
  const p=owned(user,id);
  const nodes=p.public_version?(JSON.parse(getVersion(p.id,p.public_version).graph) as Graph).nodes:[];
  const triggers=nodes.filter(n=>n.type==='control.trigger'&&['event','schedule'].includes(n.config.trigger)).map(n=>({id:n.id,title:n.title,kind:n.config.trigger,setting:String(n.config[n.config.trigger]||'')}));
  return {version:p.public_version,triggers,registrations:all<Automation>('SELECT * FROM automations WHERE project=? ORDER BY node',p.id).map(presentation)};
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
export function dispatchDue(at=Date.now()):boolean{
  const a=one<Automation>('SELECT * FROM automations WHERE enabled=1 AND next_at<=? ORDER BY next_at LIMIT 1',at);
  if(!a)return false;
  try{return tx(()=>{
    const actual=registration(a.id);if(!actual.enabled||actual.next_at===null||actual.next_at>at)return false;
    const user=current(actual);const instant=new Date(actual.next_at).toISOString();
    enqueueRun(user,{id:actual.project,mode:'live',input:actual.input,requestKey:'schedule:'+digest(JSON.stringify([a.id,actual.version,instant]))},{kind:'schedule',nodeId:actual.node,scheduledAt:instant});
    const next=nextTime(actual.setting,at);
    set("UPDATE automations SET next_at=?,enabled=?,note='' WHERE id=?",next,next===null?0:1,a.id);
    return true;
  });}catch(error){
    const message=error instanceof Error?error.message:'자동 시작 오류';
    set("UPDATE automations SET enabled=0,next_at=NULL,note=? WHERE id=? AND next_at=?",message,a.id,a.next_at);return true;
  }
}
