import type {Block,Graph} from '../domain/types';
import {literalRunQuestion} from '../domain/run-input';
import type {EngineCheckpoint} from './types';
import {object,readable,record,strings} from './values';

const detectors=[
  {kind:'email',pattern:/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,label:'[이메일 가림]'},
  {kind:'phone',pattern:/\b(?:01[016789]|0\d{1,2})[- .]?\d{3,4}[- .]?\d{4}\b/g,label:'[전화번호 가림]'},
];
const blocked='[민감정보 차단]';
export const privacyBlockError='민감정보 전달을 차단했습니다.';

function jsonContainer(text:string):unknown {
  if(/^\s*[\[{]/.test(text))try{return JSON.parse(text);}catch{}
}

function visitStrings(value:unknown,visit:(text:string)=>void){
  if(typeof value==='string'){
    visit(value);
    // JSON attachments and saved model context can contain escaped characters.
    if(value.includes('\\'))visitStrings(jsonContainer(value),visit);
  }else if(value&&typeof value==='object'){
    for(const [key,item] of Object.entries(value)){
      if(!Array.isArray(value))visit(key);
      visitStrings(item,visit);
    }
  }
}

function legacyFrameInput(state:EngineCheckpoint,frame:string):unknown {
  if(frame==='root'){
    const raw=state.scopeDecision?.status==='mixed'?state.scopeDecision.input:state.input;
    return literalRunQuestion(raw)??raw;
  }
  const entry=state.events.find(e=>e.kind==='result'&&e.path.slice(0,e.path.lastIndexOf('/'))===frame&&
    (e.blockType==='input.user_request'||e.blockType==='control.trigger'));
  if(entry){
    if(state.steps[entry.path]?.state==='done')return state.steps[entry.path].values.value;
    if(Object.hasOwn(object(entry.data),'value'))return object(entry.data).value;
  }
  const scope=object(state.memo?.['model:'+frame+'#scope#classify']);
  if(scope.text&&record(scope.text).status!=='in_scope')return;
  const slash=frame.lastIndexOf('/'),parent=frame.slice(0,slash),branch=frame.slice(slash+1);
  const call=state.events.find(e=>e.kind==='start'&&e.path===parent);
  if(!call)return;
  if(branch.startsWith('tool-'))return object(object(state.memo?.['model:'+parent+'#'+branch.slice(5)]).tool).args;
  if(branch.startsWith('dynamic-')){
    const targets=state.memo?.['dynamic-targets:'+parent];
    return Array.isArray(targets)?targets[Number(branch.slice(8))]:undefined;
  }
  const bindings=object(call.data);
  const input=Object.hasOwn(bindings,'input')?bindings.input:legacyFrameInput(state,parent.slice(0,parent.lastIndexOf('/')));
  if(branch.startsWith('item-'))return (Array.isArray(input)?input:[input])[Number(branch.slice(5))];
  if(branch==='graph'||branch==='role')return input;
}

/** Raw matches live in memory; the checkpoint refers to the existing audit input. */
export class ModelPrivacy {
  private terms=new Map<string,string>();
  private unresolved=false;
  private pattern?:RegExp;
  assertReady(){
    if(this.unresolved)throw Error('이전 민감정보 검사에 사용한 값을 복원할 수 없습니다. 처리된 내용으로 새 대화를 시작하세요.');
  }

  inspect(value:unknown,categories:string[],block:boolean):boolean{
    let found=false;
    visitStrings(value,text=>{
      for(const detector of detectors){
        if(!categories.includes(detector.kind))continue;
        for(const [match] of text.matchAll(detector.pattern)){
          found=true;
          if(!this.terms.has(match))this.pattern=undefined;
          if(this.terms.get(match)!==blocked)this.terms.set(match,block?blocked:detector.label);
        }
      }
    });
    return found;
  }

  private replace(text:string,onMatch?:(label:string)=>void){
    if(this.terms.size){
      // An occurrence may have been embedded in a longer identifier after the check.
      this.pattern??=new RegExp([...this.terms.keys()].sort((a,b)=>b.length-a.length)
        .map(term=>term.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&')).join('|'),'g');
      text=text.replace(this.pattern,match=>{
        const label=this.terms.get(match)!;
        onMatch?.(label);
        return label;
      });
    }
    return text;
  }

  blocksFile(file:unknown){
    let denied=false;
    if(this.terms.size)visitStrings(file,text=>this.replace(text,label=>{if(label===blocked)denied=true;}));
    return denied;
  }

  text(text:string):string {
    if(!this.terms.size)return text;
    const safe=this.replace(text);
    if(safe===text&&!text.includes('\\'))return safe;
    const data=jsonContainer(text);
    if(data===undefined)return safe;
    // Preserve original formatting when substitution neither merges keys nor misses escaped values.
    const structured=JSON.stringify(this.value(data));
    return structured===JSON.stringify(jsonContainer(safe))?safe:structured;
  }

  value<T>(value:T,onCopy?:(original:object,copy:object)=>void):T {
    if(!this.terms.size)return value;
    if(typeof value==='string')return this.text(value) as T;
    if(Array.isArray(value))return value.map(item=>this.value(item,onCopy)) as T;
    if(value&&typeof value==='object'){
      const entries=Object.entries(value);
      const used=new Set(entries.map(([key])=>key).filter(key=>this.replace(key)===key));
      const copy=Object.fromEntries(entries.map(([key,item])=>{
        const safe=this.replace(key);
        let unique=safe;
        if(safe!==key){
          for(let i=2;used.has(unique);i++)unique=safe+' ('+i+')';
          used.add(unique);
        }
        return [unique,this.value(item,onCopy)];
      }));
      onCopy?.(value,copy);
      return copy as T;
    }
    return value;
  }

  restore(state:EngineCheckpoint,graph:Graph){
    const recorded=new Set<number>();
    for(const check of state.privacyChecks??[]){
      const event=state.events[check.event-1];
      if(!event||event.id!==check.event||event.kind!=='start'||!this.inspect(object(event.data).input,check.categories,check.block))this.unresolved=true;
      recorded.add(check.event);
    }
    if(state.privacyChecks&&state.privacyVersion===2)return;
    // Older checkpoints persisted the bindings and outcome, before recording decisions.
    const byId=new Map<string,Block[]>();
    function index(g:Graph){
      for(const node of g.nodes){
        if(node.type==='safety.redact'){
          const group=byId.get(node.id)??[];
          group.push(node);byId.set(node.id,group);
        }
        if(node.graph)index(node.graph);
      }
    }
    index(graph);
    const checks=new Map<string,EngineCheckpoint['events'][number]>();
    for(const event of state.events??[]){
      if(event.blockType?event.blockType!=='safety.redact':!byId.has(event.nodeId))continue;
      if(event.kind==='start'||!checks.has(event.path)&&(event.kind==='result'||event.kind==='error'))checks.set(event.path,event);
    }
    for(const event of checks.values()){
      if(recorded.has(event.id))continue;
      const nodes=byId.get(event.nodeId)??[];
      if(!nodes.length&&event.blockType!=='safety.redact')continue;
      const step=state.steps?.[event.path],blockedHere=step?.error===privacyBlockError;
      if(!blockedHere&&step?.state!=='done')continue;
      if(event.kind!=='start'){this.unresolved=true;continue;}
      const bindings=object(event.data);
      const input=Object.hasOwn(bindings,'input')?bindings.input:legacyFrameInput(state,event.path.slice(0,event.path.lastIndexOf('/')));
      if(input===undefined){this.unresolved=true;continue;}
      // Before full-field checks a completed step could have overlooked a field outside content.
      // If a historical config is unavailable, preserve privacy for every supported category.
      const configs=nodes.length?nodes.map(n=>n.config):[{operation:blockedHere?'block':'mask',categories:detectors.map(d=>d.kind)}];
      let found=false;
      const local=new ModelPrivacy();
      for(const c of configs){
        const kinds=strings(c.categories),block=blockedHere||c.operation==='block';
        found=this.inspect(input,kinds,block)||found;
        local.inspect(input,kinds,block);
      }
      if(blockedHere&&!found)this.unresolved=true;
      if(!blockedHere){
        const saved=step?.values.value;
        // Older checks returned a projection of the input as text. Verify the recovered
        // input against either saved representation before sending any further model context.
        if(saved!==local.text(readable(input))&&JSON.stringify(saved)!==JSON.stringify(local.value(input)))this.unresolved=true;
      }
    }
  }
}
