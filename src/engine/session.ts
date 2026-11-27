import { createHash } from 'node:crypto';
import type { AgentContext } from '../domain/agent-context';
import type { Block,Graph } from '../domain/index';
import {recoverLegacyFilePaths} from './legacy-files';
import {ModelPrivacy,privacyBlockError} from './model-privacy';
import {defaultRunCounts, runConcurrency} from './limits';
import { toolPin, type McpPin } from '../domain/mcp-scope';
import {replyFieldError} from '../domain/reply-form';
import type { EngineCheckpoint, EngineEvent, EngineRequest, EngineServices, ModelInput, ModelOutput, OriginalRow, Prompt, Values } from './types';
import { asText, integer, object, record, strings } from './values';

export class Suspended extends Error {}
export class RunAborted extends Error {}
export class Stopped extends RunAborted {}
export class LimitReached extends RunAborted {}
export interface Scope { path:string; budgetPath?:string; input:unknown; originalQuestion?:string; includeOriginalQuestion?:boolean; permissions:string[] | undefined; depth:number; context:unknown[]; originalRows?:OriginalRow[]; responsible?:string; connectors?:McpPin[]; agentContext?:AgentContext }
export const message=(error:unknown)=>error instanceof Error?error.message:String(error);
export function stable(value:unknown):string {
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable((value as Values)[k])).join(',')+'}';
  return JSON.stringify(value)??'null';
}
export function token(value:unknown):string { return createHash('sha256').update(stable(value)).digest('hex'); }
export function allowed(config:unknown, ceiling:string[]|undefined):string[] {
  return [...new Set(strings(config))].filter(name=>!ceiling || ceiling.includes(name));
}
export class Session {
  readonly privacy:ModelPrivacy;
  readonly fileOrigins=new WeakMap<object,string>();
  fileReferences(value:unknown,keys:string[]=[]):NonNullable<import('./types').Step['fileOrigins']>{
    if(!value || typeof value!=='object')return [];
    const path=this.fileOrigins.get(value);
    if(path)return [{keys,path}];
    return Object.entries(value).flatMap(([key,item])=>this.fileReferences(item,[...keys,key]));
  }
  state:EngineCheckpoint;
  effectiveInput:string;
  private saveTail=Promise.resolve();
  private activeRemote=0;
  private remoteQueue:(()=>void)[]=[];
  constructor(readonly request:EngineRequest,readonly services:EngineServices,graph?:Graph) {
    this.effectiveInput=request.input;
    if(request.checkpoint && (request.checkpoint.runId!==request.runId || request.checkpoint.input!==request.input || request.checkpoint.version!==1))
      throw new Error('실행 기록과 요청이 일치하지 않습니다.');
    this.state=request.checkpoint?structuredClone(request.checkpoint):{
      version:1,runId:request.runId,input:request.input,privacyVersion:2,privacyChecks:[],events:[],steps:{},memo:{},waits:{},replies:{},counts:{steps:0,modelCalls:0,toolCalls:0,agents:0},
    };
    this.privacy=request.restoredPrivacy??new ModelPrivacy();
    if(request.checkpoint&&graph){
      if(!request.restoredPrivacy)this.privacy.restore(this.state,graph);
      if(this.state.historyDetails)this.state.historyDetails=this.privacy.value(this.state.historyDetails);
    }
    if(request.checkpoint&&graph&&!this.state.fileOriginVersion)recoverLegacyFilePaths(graph,this.state);
    this.state.fileOriginVersion=1;
    for(const step of Object.values(this.state.steps)){
      for(const {keys,path} of step.fileOrigins??[]){
        let file=step.values.value;
        for(const k of keys)file=file&&typeof file==='object'?Object.getOwnPropertyDescriptor(file,k)?.value:undefined;
        if(file&&typeof file==='object')this.fileOrigins.set(file,path);
      }
    }
  }
  key(scope:Scope,node:Block) {return scope.path+'/'+encodeURIComponent(node.id);}
  inspectPrivacy(node:Block,path:string,input:unknown,categories:string[],block:boolean){
    if(!this.privacy.inspect(input,categories,block))return input;
    let start=this.state.events.findLast(e=>e.kind==='start'&&e.path===path);
    if(!start){
      // A parallel save can persist the step budget before its start event.
      this.event(node,path,'start',node.title+' 시작',{input});
      start=this.state.events[this.state.events.length-1];
    }
    if(!Object.hasOwn(object(start.data),'input'))start.data={...object(start.data),input};
    this.state.privacyChecks?.push({event:start.id,categories,block});
    if(this.state.historyDetails)this.state.historyDetails=this.privacy.value(this.state.historyDetails);
    if(block)throw Error(privacyBlockError);
    return this.privacy.value(input,(original,copy)=>{
      const origin=this.fileOrigins.get(original);
      if(origin)this.fileOrigins.set(copy,origin);
    });
  }
  private interruption?:Error;
  interrupt(reason:Error){return this.interruption??=reason;}
  assertActive(){if(this.interruption)throw this.interruption;}
  async stopCheck() {
    this.assertActive();
    if(await this.services.isStopped?.())throw this.interrupt(new Stopped('사용자가 실행을 중지했습니다.'));
    this.assertActive();
  }
  private async remote<T>(operation:()=>Promise<T>):Promise<T> {
    const limit=runConcurrency(this.services.limits?.concurrency);
    if(this.activeRemote>=limit)await new Promise<void>(resume=>this.remoteQueue.push(resume));
    else this.activeRemote++;
    try{await this.stopCheck();this.assertActive();return await operation();}
    finally{const next=this.remoteQueue.shift();if(next)next();else this.activeRemote--;}
  }
  save() {
    if(!this.services.save) return this.saveTail;
    const snapshot=structuredClone(this.state);
    this.saveTail=this.saveTail.then(()=>this.services.save!(snapshot));
    return this.saveTail;
  }
  event(node:Pick<Block, 'id'|'title'> & {type?:string},path:string,kind:EngineEvent['kind'],detail:string,data?:unknown) {
    this.state.events.push({id:this.state.events.length+1,time:new Date().toISOString(),nodeId:node.id,blockType:node.type,path,title:node.title,kind,detail,...(data===undefined?{}:{data})});
  }
  charge(counter:keyof EngineCheckpoint['counts'],id:string,maximum?:number) {
    const key='budget:'+counter+':'+id;
    if(Object.hasOwn(this.state.memo,key)) return;
    const ceiling=Math.min(maximum??Number.MAX_SAFE_INTEGER,integer(this.services.limits?.[counter],defaultRunCounts[counter],0,defaultRunCounts[counter]));
    if(this.state.counts[counter]>=ceiling) throw new LimitReached('실행 한도에 도달했습니다 ('+counter+' '+ceiling+').');
    this.state.counts[counter]++;
    this.state.memo[key]=true;
  }
  async ask(node:Block,path:string,prompt:Omit<Prompt,'id'>,display:Pick<Prompt,'fields'|'reviewDraft'|'showApprovalNote'>={}) {
    // Presentation can be upgraded without invalidating a previously issued reply ID.
    const {fields,reviewDraft}=display;
    const id=path+'#'+token(prompt).slice(0,24);
    const reply=this.state.replies[id];
    const fieldError = reply && fields?.length ? replyFieldError(fields,record(reply.value)) : '';
    if(reply && !fieldError) return reply;
    if(fieldError) delete this.state.replies[id];
    if(prompt.expiresAt && Date.parse(prompt.expiresAt) <= Date.now()){
      delete this.state.waits[id];
      throw new Error('대기 기한이 지났습니다.');
    }
    const previous=this.state.waits[id];
    if(!previous || (fields && !previous.fields) || (reviewDraft!==undefined && previous.reviewDraft===undefined)){
      this.state.waits[id]={...prompt,id,...display,...(fieldError?{fieldError}:{})};
      if(!previous)this.event(node,path,'wait',prompt.prompt);
      await this.save();
    }
    throw new Suspended(prompt.prompt);
  }
  async model(path:string,round:string,request:ModelInput,invoke=this.services.model):Promise<ModelOutput> {
    const key='model:'+path+'#'+round;
    if(Object.hasOwn(this.state.memo,key)) return this.state.memo[key] as ModelOutput;
    await this.stopCheck();
    this.charge('modelCalls',key);
    const output=await this.remote(()=>{
      this.privacy.assertReady();
      const safe=this.privacy.value({...request,history:this.request.history??[]});
      safe.tools=request.tools.filter(name=>this.privacy.text(name)===name);
      return invoke(safe);
    });
    if(typeof output?.text!=='string') throw new Error('모델이 읽을 수 있는 결과를 반환하지 않았습니다.');
    this.state.memo[key]=output;
    await this.save();
    return output;
  }
  async runTool(node:Block,scope:Scope,path:string,round:string,name:string,args:Values,approvalRef?:unknown) {
    if(!name || (scope.permissions && !scope.permissions.includes(name))) throw new Error('이 역할에 허용되지 않은 도구입니다: '+name);
    const connector=toolPin(name,scope.connectors);
    const digest=token(connector?{name,args,connector}:{name,args});
    const id=this.request.runId+'/'+path+'/'+round+'/'+digest.slice(0,24);
    const key='tool:'+id;
    if(Object.hasOwn(this.state.memo,key)) return this.state.memo[key];
    const readOnly=this.services.isReadOnlyTool ? this.services.isReadOnlyTool(name,connector) : ['reservations.list','reservation.lookup','reservations.lookup'].includes(name);
    const bound=object(this.state.memo['approval:'+asText(approvalRef)]);
    const grant=bound.digest===digest && (!bound.usedBy || bound.usedBy===id);
    if(!readOnly && !grant){
      const reply=await this.ask(node,path+'#tool:'+round,{kind:'approval',prompt:'이 작업을 승인할까요? '+name+' '+asText(args),operation:{tool:name,args,connector}},{showApprovalNote:false});
      if(reply.approved!==true) throw new Error('사용자가 도구 실행을 승인하지 않았습니다.');
    }
    await this.stopCheck();
    this.charge('toolCalls',key);
    if(grant) this.state.memo['approval:'+asText(approvalRef)]={...bound,usedBy:id};
    if(!this.state.memo['sent:'+id]){
      this.state.memo['sent:'+id]=true;
      this.event(node,path,'tool',name+' 호출', {operationId:id,args});
      await this.save();
    }
    await this.stopCheck();
    const value=await this.remote(()=>this.services.tool(name,args,{operationId:id,approved:!readOnly,connector}));
    this.state.memo[key]=value??null;
    this.event(node,path,'tool',name+' 처리 결과',{operationId:id,tool:name,write:!readOnly,result:value});
    await this.save();
    return value;
  }
}
