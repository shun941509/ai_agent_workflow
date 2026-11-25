import type {Block,Graph} from '../domain/types';
import {attachmentFrom} from '../domain/run-input';
import type {EngineCheckpoint,Step} from './types';
import {at,flattened,object} from './values';

export function completedRunFiles(graph:Graph,checkpoint:EngineCheckpoint){
  const paths=checkpoint.finalFilePaths??(checkpoint.fileOriginVersion?[]:recoverLegacyFilePaths(graph,checkpoint));
  return paths.flatMap(path=>{
    const file=attachmentFrom(checkpoint.steps[path]?.values.value);
    return file?[{...file,path}]:[];
  });
}

/** Reconstruct only file identities carried along known value-preserving wires in a pre-provenance checkpoint. */
export function recoverLegacyFilePaths(graph:Graph,checkpoint:EngineCheckpoint):string[]{
  if(!checkpoint.steps)return [];
  const designs=[graph];
  let hasFiles=false;
  for(let i=0;i<designs.length&&!hasFiles;i++)for(const node of designs[i].nodes){
    if(node.type==='file.create'){hasFiles=true;break;}
    if(node.graph)designs.push(node.graph);
  }
  if(!hasFiles)return [];
  const origins=new WeakMap<object,string>();
  const scopes=new Set<string>();
  for(const path of Object.keys(checkpoint.steps)){
    for(let slash=path.lastIndexOf('/');slash>0;slash=path.lastIndexOf('/',slash-1))scopes.add(path.slice(0,slash));
  }
  const refs=(value:unknown,keys:string[]=[]):NonNullable<Step['fileOrigins']>=>{
    if(!value||typeof value!=='object')return [];
    const path=origins.get(value);
    return path?[{path,keys}]:Object.entries(value).flatMap(([key,part])=>refs(part,[...keys,key]));
  };
  function hydrate(step:Step,expected:unknown){
    for(const {path,keys} of refs(expected)){
      let item=step.values.value;
      for(const key of keys)item=item&&typeof item==='object'?Object.getOwnPropertyDescriptor(item,key)?.value:undefined;
      const original=object(checkpoint.steps[path]?.values.value),saved=object(item);
      if(item&&typeof item==='object'&&saved.fileName===original.fileName&&saved.format===original.format&&saved.content===original.content)
        origins.set(item,path);
    }
    const found=refs(step.values.value);
    if(found.length)step.fileOrigins=found;
  }
  function frame(g:Graph,prefix:string,scopeInput:unknown):unknown{
    if(!scopes.has(prefix))return;
    const visited=new Set<string>(),byId=new Map(g.nodes.map(n=>[n.id,n]));
    const path=(n:Block)=>prefix+'/'+encodeURIComponent(n.id);
    const state=(n:Block)=>checkpoint.steps[path(n)];
    function visit(n:Block){
      if(visited.has(n.id))return;
      visited.add(n.id);
      const step=state(n);
      if(step?.state!=='done'&&!n.graph)return;
      const wires=g.edges.filter(e=>e.to===n.id&&e.kind==='data'&&e.input==='input');
      const values:unknown[]=[];
      let unknownInput=false;
      for(const e of wires){
        const source=byId.get(e.from);
        if(!source)continue;
        visit(source);
        const predecessor=state(source);
        if(predecessor?.state==='done'&&predecessor.values[e.out]!==undefined)values.push(predecessor.values[e.out]);
        else if(predecessor?.state==='failed')values.push({error:predecessor.error,role:source.title});
        else if(!predecessor&&['resource.context','instruction.skill','connection.mcp','workflow.tool'].includes(source.type))unknownInput=true;
      }
      const input=unknownInput?undefined:values.length>1?values:values.length?values[0]:scopeInput;
      const c=n.config;
      let expected:unknown;
      switch(n.type){
        case 'file.create':{
          const file=object(step?.values.value);
          if(typeof file.fileName==='string'&&typeof file.content==='string'){
            origins.set(file,path(n));expected=file;
          }
          break;
        }
        case 'input.user_request': case 'control.trigger':expected=scopeInput;break;
        case 'output.answer': case 'data.validate': case 'control.parallel': case 'control.branch':expected=input;break;
        case 'control.terminate':if(!c.message)expected=input;break;
        case 'data.transform':{
          const selected=c.path?at(input,String(c.path)):input;
          if(c.operation==='rename')expected={[c.target||'value']:selected};
          else if(c.operation!=='text')expected=selected;
          break;
        }
        case 'control.join':
          if(!unknownInput&&c.merge!=='text'&&c.merge!=='sections'){
            const incoming=g.edges.filter(e=>e.to===n.id&&e.kind==='flow').map(e=>byId.get(e.from)).filter(s=>s!==undefined);
            if(incoming.some(s=>state(s)?.error))break;
            const outputValues=values.length?values:incoming.filter(s=>state(s)?.state==='done').map(s=>{visit(s);return state(s).values.value;});
            expected=flattened(outputValues);
          }
          break;
        case 'agent.create_dynamic':{
          const targets=checkpoint.memo?.['dynamic-targets:'+path(n)];
          if(n.graph&&Array.isArray(targets)&&targets.length<=20){
            const results=targets.map((target,i)=>({result:frame(n.graph!,path(n)+'/dynamic-'+i,target)}));
            expected={results};
          }
          break;
        }
        case 'agent.team': case 'workflow.call': case 'agent.delegate': case 'agent.handoff':
          if(n.graph){
            const child=n.type==='agent.team'||n.type==='workflow.call'?'graph':'role';
            expected=frame(n.graph,path(n)+'/'+child,input);
          }
          break;
        case 'control.loop':
          if(n.graph)expected=(Array.isArray(input)?input:[input]).slice(0,100)
            .map((item,i)=>frame(n.graph!,path(n)+'/item-'+i,item));
          break;
      }
      if(step?.state==='done'&&expected!==undefined)hydrate(step,expected);
    }
    g.nodes.forEach(visit);
    const terminal=g.nodes.filter(n=>['output.answer','control.terminate'].includes(n.type)&&state(n)?.state==='done')
      .map(n=>state(n).values.value);
    return terminal.length===1?terminal[0]:terminal;
  }
  const result=frame(graph,'root',checkpoint.input);
  return [...new Set(refs(result).map(ref=>ref.path))];
}
