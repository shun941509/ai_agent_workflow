import type { Block, Edge, Graph } from '../domain/types';
import {answerFormat} from '../domain/catalog';
import { evaluate, readable } from './operations';
import {runConcurrency} from './limits';
import {referencedRows,uniqueRows} from './evidence';
import { RunAborted, Session, Stopped, Suspended, message, token, type Scope } from './session';
import { flattened,integer,isPassage,object } from './values';
import {attachmentFrom,literalRunQuestion} from '../domain/run-input';
import {checkRequestScope,scopedChild} from './request-scope';
import type { EngineRequest, EngineResult, EngineServices, OriginalRow, Step, Values } from './types';
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
  private skippedCauses=new Map<string,string[]>();
  private causes(edge:Edge):string[]{
    if(edge.kind!=='flow')return [];
    const source=this.get(edge.from),destination=this.byId.get(edge.to)!;
    // A block that failed before choosing a named outcome never entered any of its branches.
    if(!source?.error || (edge.out!=='next' && destination.type!=='error.handle'))return [];
    if(source.state==='failed')return [edge.from];
    if(source.state!=='skipped')return [];
    let ids=this.skippedCauses.get(edge.from);
    if(!ids){
      ids=[...new Set((this.incoming.get(edge.from)??[]).flatMap(e=>this.causes(e)))];
      this.skippedCauses.set(edge.from,ids);
    }
    return ids;
  }
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
          this.s.event(node,path,'result','연결한 참조를 확인했습니다.',{type:node.type,title:node.title,version:node.config.version||null,assetId:node.config.assetId||null});
          await this.s.save();
        }
        return value;
      });
      this.refs.set(node.id,result);
    }
    return result;
  }
  private async bindings(node:Block):Promise<{values:Values;originals:OriginalRow[]}>{
    const inputs:Record<string,unknown[]>=Object.create(null);
    const incoming=this.incoming.get(node.id)||[];
    const failures=new Map<string,{error:string;role:string}>();
    const flowInputs:unknown[]=[];
    let hasInputValue=false;
    for(const edge of incoming){
      if(edge.kind==='flow'){
        if(catcher(node)){
          for(const id of this.causes(edge))if(!failures.has(id)){
            const failure={error:this.get(id)!.error!,role:this.byId.get(id)!.title};
            failures.set(id,failure);(inputs.input??=[]).push(failure);flowInputs.push(failure);
          }
          const predecessor=this.get(edge.from);
          if(node.type==='control.join'&&predecessor?.routes.includes(edge.out))flowInputs.push(predecessor.values.value);
        }
        continue;
      }
      if(node.type==='error.handle')continue;
      const source=this.byId.get(edge.from)!;
      const step=resources.has(source.type)?await this.ref(source):this.get(source.id);
      if(!step||step.state==='skipped'||(node.type==='control.join'&&step.state==='failed'))continue;
      const value=step.state==='failed'?{error:step.error,role:source.title}:step.values[edge.out];
      // Old checkpoints saved the grant digest before recording the expression it approved.
      if(source.type==='approval.action' && step.state==='done' && edge.out==='value'){
        const id=object(value).approvalId;
        const grant=this.s.state.memo['approval:'+id];
        if(grant && typeof grant==='object' && !Object.hasOwn(grant,'template'))
          Object.assign(grant,{template:token(source.config.args??{})});
      }
      if(value!==undefined){
        (inputs[edge.input]??=[]).push(value);
        if(edge.input==='input')hasInputValue=true;
      }
    }
    if(node.type==='control.join'){
      if(!hasInputValue)inputs.input=flowInputs;
      if(failures.size)inputs.laneErrors=[...failures.values()];
    }
    const result=Object.fromEntries(Object.entries(inputs).map(([name,values])=>[name,values.length===1?values[0]:values]));
    const evidence=incoming.filter(e=>e.kind==='data'&&e.input==='input').flatMap(e=>{
      const step=this.get(e.from);
      if(step?.state!=='done')return [];
      if(step.evidence)return [step.evidence];
      const type=this.byId.get(e.from)!.type,value=step.values[e.out];
      return ['knowledge.search','quality.evidence'].includes(type)?[flattened(object(value).passages??value).filter(isPassage)]:[];
    });
    if(evidence.length){
      const sourceTypes=incoming.filter(e=>e.kind==='data'&&e.input==='input'&&this.get(e.from)?.state==='done').map(e=>this.byId.get(e.from)!.type);
      result.ragInput=sourceTypes.every(type=>['knowledge.search','quality.evidence','control.branch','control.join','control.parallel'].includes(type));
      result.evidence=[...new Map(evidence.flat().map(p=>[JSON.stringify(p),p])).values()];
      const states=incoming.filter(e=>e.kind==='data'&&e.input==='input').map(e=>this.get(e.from)?.evidenceStatus);
      result.evidenceStatus=states.includes('conflicting')?'conflicting':states.includes('insufficient')?'insufficient':
        states.includes('candidate_match')?'candidate_match':states.includes('verified')?'verified':undefined;
    }
    const rows=incoming.filter(e=>e.kind==='data'&&e.input==='input').flatMap(e=>this.get(e.from)?.originalRows??[]);
    if(incoming.some(e=>e.kind==='data'&&e.input==='input'&&e.out==='value'&&this.get(e.from)?.attachmentInput))result.attachmentInput=true;
    return {values:result,originals:uniqueRows([...(this.scope.originalRows??[]),...rows])};
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
      if(source.state!=='done')return catcher(node)&&this.causes(edge).length>0;
      return node.type!=='error.handle'&&source.routes.includes(edge.out);
    });
    return active?'run':'skip';
  }
  private async step(node:Block) {
    const path=this.path(node);
    await this.s.stopCheck();
    try{
      const fresh=!Object.hasOwn(this.s.state.memo,'budget:steps:'+path);
      this.s.charge('steps',path);
      const {values:bindings,originals:upstream}=await this.bindings(node);
      await this.s.stopCheck();
      if(fresh)this.s.event(node,path,'start',node.title+' 시작',bindings);
      const responsible=this.responsibleFor(node);
      const childRows:OriginalRow[]=[];
      const step=await evaluate(node,{...this.scope,responsible,originalRows:upstream},bindings,this.s,async(graph,scope)=>{
        const frame=new Frame(graph,await scopedChild(graph,this.s,scope),this.s);
        const value=await frame.run();
        for(const terminal of graph.nodes.filter(n=>n.type==='output.answer'||n.type==='control.terminate')){
          childRows.push(...frame.get(terminal.id)?.originalRows??[]);
        }
        return value;
      });
      await this.s.stopCheck();
      step.responsible=node.type==='agent.handoff'?String(node.config.role):responsible;
      if(Array.isArray(step.values.citations))step.evidence=step.values.citations.filter(isPassage);
      else if(!['quality.evidence','knowledge.search'].includes(node.type)&&Array.isArray(bindings.evidence))step.evidence=bindings.evidence.filter(isPassage);
      if(node.type==='quality.evidence'){
        const checked=object(step.values.value);
        step.evidence=flattened(checked.passages).filter(isPassage);
        step.evidenceStatus=checked.status as Step['evidenceStatus'];
      }else if(step.evidence)step.evidenceStatus=(step.values.status??bindings.evidenceStatus) as Step['evidenceStatus'];
      const originals=referencedRows([...upstream,...childRows,...(step.originalRows??[])],step.values.value,step.evidence);
      if(originals.length)step.originalRows=originals;
      else delete step.originalRows;
      if(node.type==='file.input'||(bindings.attachmentInput&&['document.read','control.branch','control.parallel'].includes(node.type)))step.attachmentInput=true;
      if(node.type==='file.create'&&step.state==='done'&&step.values.value&&typeof step.values.value==='object')
        this.s.fileOrigins.set(step.values.value,path);
      const origins=this.s.fileReferences(step.values.value);
      if(origins.length)step.fileOrigins=origins;
      this.s.state.steps[path]=step;
      this.s.event(node,path,'result',node.title+' 완료',{...step.values,responsible:step.responsible});
    }catch(error){
      if(error instanceof Suspended || error instanceof RunAborted)throw error;
      const reason=message(error);
      this.s.state.steps[path]={state:'failed',values:{},routes:[],error:reason};
      const partialText=error instanceof Error && 'partialModelText' in error && typeof error.partialModelText==='string'?error.partialModelText:undefined;
      this.s.event(node,path,'error',reason,partialText?{partialText}:undefined);
      if((this.splits.get(node.id)??[]).some(n=>n.config.failurePolicy==='stop'))throw this.s.interrupt(new RunAborted(reason));
    }
    await this.s.save();
  }
  async run():Promise<unknown>{
    const nodes=this.graph.nodes.filter(n=>!resources.has(n.type));
    const limit=runConcurrency(this.s.services.limits?.concurrency);
    const waiting=new Set<string>();
    while(nodes.some(n=>!this.get(n.id))){
      await this.s.stopCheck();
      const ready:Block[]=[];let skipped=0;
      for(const node of nodes){
        if(this.get(node.id)||waiting.has(node.id))continue;
        const state=this.readiness(node);
        if(state==='skip'){
          const causes=[...new Set((this.incoming.get(node.id)||[]).flatMap(e=>this.causes(e)))];
          const error=causes.map(id=>this.get(id)?.error).join('; ');
          this.skippedCauses.set(node.id,causes);
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
    }
    const handled=new Set(nodes.filter(n=>catcher(n)&&this.get(n.id)?.state!=='skipped')
      .flatMap(n=>(this.incoming.get(n.id)??[]).flatMap(e=>this.causes(e))));
    const left=nodes.find(n=>this.get(n.id)?.state==='failed'&&!handled.has(n.id));
    if(left)throw new Error(this.get(left.id)!.error);
    const outputs=nodes.filter(n=>(n.type==='output.answer'||n.type==='control.terminate')&&this.get(n.id)?.state==='done');
    if(!outputs.length)throw new Error('실행된 경로에 결과를 전달할 마지막 블록이 없습니다.');
    const values=outputs.map(n=>this.get(n.id)!.values.value);
    if(this.scope.depth===0){
      const paths=new Set(values.flatMap(v=>this.s.fileReferences(v).map(ref=>ref.path)));
      if(paths.size)this.s.privacy.assertReady();
      this.s.state.finalFilePaths=[];
      for(const path of paths){
        const file=attachmentFrom(this.s.state.steps[path].values.value);
        if(!file||this.s.privacy.blocksFile(file))continue;
        this.s.state.finalFilePaths.push(path);
        const safe=this.s.privacy.value(file);
        if(safe.fileName!==file.fileName||safe.content!==file.content)(this.s.state.finalFileOverrides??={})[path]=safe;
      }
      const formats=new Set(outputs.map(n=>answerFormat(n.type==='output.answer'?n.config.format:undefined)));
      this.s.state.outputFormat=formats.size===1?[...formats][0]:'text';
      const answer=this.s.privacy.value(values.length===1?values[0]:values);
      return this.s.state.outputFormat==='json'?JSON.stringify(answer,null,2):answer;
    }
    return values.length===1?values[0]:values;
  }
}

export async function executeGraph(graph:Graph,request:EngineRequest,services:EngineServices):Promise<EngineResult> {
  const s=new Session(request,services,graph);
  let status:EngineResult['status']='completed',output='',error:string|undefined;
  try{
    await s.stopCheck();
    for(const reply of request.replies??(request.reply?[request.reply]:[])){
      const id=reply.waitId??Object.keys(s.state.waits)[0];
      if(!id||!Object.hasOwn(s.state.waits,id))throw new Error('현재 대기 중인 요청을 찾을 수 없습니다.');
      const deadline=s.state.waits[id].expiresAt;
      if(!deadline || (reply.receivedAt ?? Date.now()) < Date.parse(deadline)){
        s.state.replies[id]={value:reply.value,approved:reply.approved};
      }
      delete s.state.waits[id];await s.save();
    }
    const decision=await checkRequestScope(graph,s);
    if(decision?.status==='out_of_scope'){
      output='이 Agent가 맡은 일은 다음과 같습니다.\n'+graph.agentScope!.purpose+'\n이 업무에 맞는 요청이나 자료를 보내 주세요.';
    }else{
      if(decision?.status==='mixed')s.effectiveInput=decision.input;
      const scope:Scope={path:'root',input:literalRunQuestion(s.effectiveInput)??s.effectiveInput,permissions:services.allowedTools,depth:0,context:[],responsible:'대표 Agent'};
      output=readable(await new Frame(graph,scope,s).run());
      if(decision?.status==='mixed'&&s.state.outputFormat!=='json')output+='\n\n요청 중 이 Agent의 업무 범위 밖인 부분은 제외했습니다.';
    }
    await s.stopCheck();
  }catch(reason){
    if(!(reason instanceof Suspended)){
      const receipts=s.state.events.filter(e=>e.kind==='tool'&&object(e.data).write===true)
        .map(e=>object(e.data));
      if(receipts.length)output='처리가 확인된 작업\n'+receipts.map(e=>e.tool+' · '+readable(e.result)).join('\n');
    }
    if(reason instanceof Suspended){status='waiting';}
    else if(reason instanceof Stopped){status='stopped';output=[reason.message,output].filter(Boolean).join('\n\n');s.state.waits={};}
    else {status='failed';error=message(reason);s.state.waits={};}
  }
  await s.save();
  return {status,output,events:s.state.events,checkpoint:s.state,...(status==='waiting'?{wait:Object.values(s.state.waits)[0]}:{}),...(error?{error}:{})};
}
