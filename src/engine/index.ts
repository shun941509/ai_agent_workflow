import type { Block, Edge, Graph } from '../domain/types';
import { evaluate, readable } from './operations';
import { LimitReached, Session, Stopped, Suspended, message, type Scope } from './session';
import { integer } from './values';
import {literalRunQuestion} from '../domain/run-input';
import type { EngineRequest, EngineResult, EngineServices, Step, Values } from './types';
export type * from './types';
export { retrieve } from './values';

const resources=new Set(['resource.context','instruction.skill','connection.mcp','workflow.tool']);
const entries=new Set(['input.user_request','control.trigger','file.input']);
const catcher=(node:Block)=>node.type==='control.join'||node.type==='error.handle';

class Frame {
  private byId:Map<string,Block>;
  private incoming=new Map<string,Edge[]>();
  private outgoing=new Map<string,Edge[]>();
  private refs=new Map<string,Promise<Step>>();
  private splits=new Map<string,Block[]>();
  constructor(private graph:Graph,private scope:Scope,private s:Session) {
    this.byId=new Map(graph.nodes.map(node=>[node.id,node]));
    if(this.byId.size!==graph.nodes.length || graph.nodes.length>512)throw new Error('그래프의 블록 식별자 또는 크기를 확인하세요.');
    for(const e of graph.edges){
      if(!this.byId.has(e.from)||!this.byId.has(e.to))throw new Error('연결 대상 블록을 찾을 수 없습니다.');
      const inputs=this.incoming.get(e.to)||[]; inputs.push(e);this.incoming.set(e.to,inputs);
      const outputs=this.outgoing.get(e.from)||[];outputs.push(e);this.outgoing.set(e.from,outputs);
    }
    for(const split of graph.nodes.filter(node=>node.type==='control.parallel')){
      const pending=(this.outgoing.get(split.id)||[]).filter(e=>e.kind==='flow').map(e=>e.to);
      const seen=new Set<string>();
      for(let i=0;i<pending.length;i++){
        const id=pending[i],target=this.byId.get(id)!;
        if(seen.has(id)||target.type==='control.join')continue;
        seen.add(id);const group=this.splits.get(id)||[];group.push(split);this.splits.set(id,group);
        for(const edge of this.outgoing.get(id)||[])if(edge.kind==='flow')pending.push(edge.to);
      }
    }
  }
  private path(node:Block){return this.s.key(this.scope,node);}
  private get(id:string){const node=this.byId.get(id);return node?this.s.state.steps[this.path(node)]:undefined;}
  private responsibleFor(node:Block){
    const active=(this.incoming.get(node.id)??[]).filter(edge=>edge.kind==='flow'&&this.get(edge.from)?.routes.includes(edge.out));
    const owners=new Set(active.map(edge=>this.get(edge.from)?.responsible).filter(Boolean));
    return owners.size===1?[...owners][0]:this.scope.responsible;
  }
  private ref(node:Block):Promise<Step> {
    // Resolve current permissions again even if a previous checkpoint cached the content.
    let result=this.refs.get(node.id);
    if(!result){
      result=evaluate(node,this.scope,{},this.s,async()=>{throw new Error('참조 준비 중 내부 실행을 호출할 수 없습니다.');}).then(async value=>{
        const path=this.path(node),key='ref:'+path;
        if(!this.s.state.memo[key]){
          this.s.state.memo[key]=true;
          this.s.event(node,path,'result','연결한 참조를 확인했습니다.',{type:node.type,title:node.title,version:node.config.version||null});
          await this.s.save();
        }
        return value;
      });
      this.refs.set(node.id,result);
    }
    return result;
  }
  private async bindings(node:Block):Promise<Values>{
    const inputs:Record<string,unknown[]>=Object.create(null);
    const incoming=this.incoming.get(node.id)||[];
    for(const edge of incoming){
      if(edge.kind==='flow')continue;
      const source=this.byId.get(edge.from)!;
      const step=resources.has(source.type)?await this.ref(source):this.get(source.id);
      if(!step)continue;
      if(step.state==='skipped'){
        if(catcher(node)&&step.error)(inputs[edge.input]??=[]).push({error:step.error,role:source.title});
        continue;
      }
      const value=step.state==='failed'?{error:step.error,role:source.title}:step.values[edge.out];
      if(value!==undefined){(inputs[edge.input]??=[]).push(value);}
    }
    if(catcher(node)&&!inputs.input){
      inputs.input=incoming.filter(e=>e.kind==='flow').flatMap(e=>{
        const step=this.get(e.from);
        if(!step||(step.state==='skipped'&&!step.error))return [];
        return [{value:step.error?{error:step.error,role:this.byId.get(e.from)!.title}:step.values.value}];
      }).map(x=>x.value);
    }
    const result=Object.fromEntries(Object.entries(inputs).map(([name,values])=>[name,values.length===1?values[0]:values]));
    if(incoming.some(e=>e.kind==='data'&&e.input==='input'&&['knowledge.search','quality.evidence'].includes(this.byId.get(e.from)!.type)))result.ragInput=true;
    return result;
  }
  private readiness(node:Block):'run'|'skip'|'pending'{
    if(this.scope.depth===0&&this.s.request.trigger?.nodeId&&entries.has(node.type)&&node.id!==this.s.request.trigger.nodeId)return 'skip';
    const edges=this.incoming.get(node.id)||[];
    const deps=edges.filter(e=>!resources.has(this.byId.get(e.from)!.type));
    if(deps.some(e=>!this.get(e.from)))return 'pending';
    const flows=edges.filter(e=>e.kind==='flow');
    if(!flows.length)return entries.has(node.type)?'run':'skip';
    const active=flows.some(edge=>{
      const source=this.get(edge.from);
      if(!source)return false;
      if(source.state==='skipped')return Boolean(source.error&&catcher(node));
      return source.state==='failed'?catcher(node):node.type!=='error.handle'&&source.routes.includes(edge.out);
    });
    return active?'run':'skip';
  }
  private async step(node:Block) {
    const path=this.path(node);
    await this.s.stopCheck();
    try{
      const fresh=!Object.hasOwn(this.s.state.memo,'budget:steps:'+path);
      this.s.charge('steps',path);
      const bindings=await this.bindings(node);
      if(fresh)this.s.event(node,path,'start',node.title+' 시작',bindings);
      const responsible=this.responsibleFor(node);
      const step=await evaluate(node,{...this.scope,responsible},bindings,this.s,(graph,scope)=>new Frame(graph,scope,this.s).run());
      await this.s.stopCheck();
      step.responsible=node.type==='agent.handoff'?String(node.config.role):responsible;
      this.s.state.steps[path]=step;
      this.s.event(node,path,'result',node.title+' 완료',{...step.values,responsible:step.responsible});
    }catch(error){
      if(error instanceof Suspended || error instanceof Stopped || error instanceof LimitReached)throw error;
      const reason=message(error);
      this.s.state.steps[path]={state:'failed',values:{},routes:[],error:reason};
      this.s.event(node,path,'error',reason);
    }
    await this.s.save();
  }
  private handlesFailure(source:string) {
    const seen=new Set([source]),queue=[source];
    while(queue.length){
      const id=queue.shift()!;
      for(const edge of this.outgoing.get(id)||[]){
        const node=this.byId.get(edge.to)!;
        const step=this.get(node.id);
        if(catcher(node)&&step?.state==='done')return true;
        if(step?.state==='skipped'&&!seen.has(node.id)){queue.push(node.id);seen.add(node.id);}
      }
    }
    return false;
  }
  async run():Promise<unknown>{
    const nodes=this.graph.nodes.filter(n=>!resources.has(n.type));
    const limit=integer(this.s.services.limits?.concurrency,4,1,12);
    const waiting=new Set<string>();
    while(nodes.some(n=>!this.get(n.id))){
      await this.s.stopCheck();
      const ready:Block[]=[];let skipped=0;
      for(const node of nodes){
        if(this.get(node.id)||waiting.has(node.id))continue;
        const state=this.readiness(node);
        if(state==='skip'){
          const error=(this.incoming.get(node.id)||[]).filter(e=>e.kind==='flow').map(e=>this.get(e.from)?.error).filter(Boolean).join('; ');
          this.s.state.steps[this.path(node)]={state:'skipped',values:{},routes:[],...(error?{error}:{})};skipped++;
        }else if(state==='run')ready.push(node);
      }
      if(!ready.length){
        if(skipped)continue;
        if(waiting.size)throw new Suspended('이용자의 응답을 기다립니다.');
        throw new Error('설계에서 실행 순서를 결정할 수 없습니다. 순환 연결을 확인하세요.');
      }
      const slots=new Map<string,number>(),batch:Block[]=[];
      for(const node of ready){
        const splits=this.splits.get(node.id)||[];
        if(splits.some(n=>(slots.get(n.id)||0)>=integer(n.config.maxConcurrency,2,1,10)))continue;
        for(const n of splits)slots.set(n.id,(slots.get(n.id)||0)+1);
        batch.push(node);if(batch.length===limit)break;
      }
      const settled=await Promise.allSettled(batch.map(n=>this.step(n)));
      const failures=settled.filter((item):item is PromiseRejectedResult=>item.status==='rejected');
      const fatal=failures.find(x=>!(x.reason instanceof Suspended));
      if(fatal)throw fatal.reason;
      settled.forEach((entry,i)=>{if(entry.status==='rejected'&&entry.reason instanceof Suspended)waiting.add(batch[i].id);});
      for(const node of batch){
        const step=this.get(node.id);
        if(step?.state==='failed'&&(this.splits.get(node.id)||[]).some(n=>n.config.failurePolicy==='stop'))throw new Error(step.error);
      }
    }
    const left=nodes.find(n=>this.get(n.id)?.state==='failed'&&!this.handlesFailure(n.id));
    if(left)throw new Error(this.get(left.id)!.error);
    const outputs=nodes.filter(n=>(n.type==='output.answer'||n.type==='control.terminate')&&this.get(n.id)?.state==='done');
    if(!outputs.length)throw new Error('실행된 경로에 결과를 전달할 마지막 블록이 없습니다.');
    const values=outputs.map(n=>this.get(n.id)!.values.value);
    return values.length===1?values[0]:values;
  }
}

export async function executeGraph(graph:Graph,request:EngineRequest,services:EngineServices):Promise<EngineResult> {
  const s=new Session(request,services);
  let status:EngineResult['status']='completed',output='',error:string|undefined;
  try{
    await s.stopCheck();
    if(request.reply){
      const id=request.reply.waitId??Object.keys(s.state.waits)[0];
      if(!id||!Object.hasOwn(s.state.waits,id))throw new Error('현재 대기 중인 요청을 찾을 수 없습니다.');
      const deadline=s.state.waits[id].expiresAt;
      if(!deadline || (request.reply.receivedAt ?? Date.now()) < Date.parse(deadline)){
        s.state.replies[id]={value:request.reply.value,approved:request.reply.approved};
      }
      delete s.state.waits[id];await s.save();
    }
    const scope:Scope={path:'root',input:literalRunQuestion(request.input)??request.input,permissions:services.allowedTools,depth:0,context:[],responsible:'대표 Agent'};
    output=readable(await new Frame(graph,scope,s).run());
    await s.stopCheck();
  }catch(reason){
    if(reason instanceof Suspended){status='waiting';}
    else if(reason instanceof Stopped){status='stopped';s.state.waits={};}
    else {status='failed';error=message(reason);s.state.waits={};}
  }
  await s.save();
  return {status,output,events:s.state.events,checkpoint:s.state,...(status==='waiting'?{wait:Object.values(s.state.waits)[0]}:{}),...(error?{error}:{})};
}
