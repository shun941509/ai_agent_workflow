import type {Graph} from '../domain';
import {nodeMcpScope,toolPin,type McpPin} from '../domain/mcp-scope';
import {readAsset} from './assets';
import type {User} from './auth';
import {requireThat} from './errors';

/** Resolve registered resources by both identity and edition. Grants stay on the server. */
export function bindRunAssets(graph:Graph,user:User){
  const references=new Map<string,{assetId:string;version:number;grant?:string}>();
  const tools=new Set<string>();
  function collect(current:Graph){
    for(const node of current.nodes){
      const {assetId,version,assetGrant}=node.config;
      if(assetId){
        const key=assetId+':'+version;
        if(!references.has(key)){
          const entry=readAsset(user,assetId,version,assetGrant);
          references.set(key,{assetId,version:entry.version,grant:assetGrant});
          if(entry.asset.kind==='mcp')for(const tool of entry.payload.tools??[])tools.add('mcp.'+assetId+'.'+tool);
        }
      }
      if(node.graph)collect(node.graph);
    }
  }
  collect(graph);
  function read(id:string,version?:number|string){
    const ref=references.get(id+':'+version);
    requireThat(ref,403,'설계에 연결되지 않은 자료 버전입니다.');
    return readAsset(user,ref.assetId,ref.version,ref.grant);
  }
  function connector(name:string,pin?:McpPin){
    if(!name.startsWith('mcp.'))return undefined;
    requireThat(pin&&name.startsWith('mcp.'+pin.assetId+'.'),403,'이 블록에 연결된 MCP를 선택하세요.');
    const {asset,payload}=read(pin.assetId,pin.version),tool=name.slice(('mcp.'+pin.assetId+'.').length);
    requireThat(asset.kind==='mcp'&&payload.tools?.includes(tool),403,'연결한 MCP 버전에서 허용하지 않는 작업입니다.');
    return {payload,tool};
  }
  // Model-callable workflow tools may be referenced by several agents with different ceilings.
  const checked=new WeakMap<Graph,Set<string>>();
  function validate(current:Graph,inherited?:McpPin[],ceiling?:string[]){
    const signature=JSON.stringify([inherited,ceiling]),seen=checked.get(current)??new Set<string>();
    if(seen.has(signature))return;
    seen.add(signature);checked.set(current,seen);
    const byId=new Map(current.nodes.map(n=>[n.id,n]));
    for(const node of current.nodes){
      if(node.type==='workflow.tool')continue;
      const incoming=current.edges.filter(e=>e.to===node.id&&e.kind==='reference');
      const scope=nodeMcpScope(current,node.id,inherited);
      const localTools=Array.isArray(node.config.allowedTools)?node.config.allowedTools.filter((name:unknown)=>typeof name==='string'&&(!ceiling||ceiling.includes(name))):undefined;
      const childCeiling=localTools??ceiling;
      const callsExternalTool=['tool.invoke','error.compensate'].includes(node.type)||(node.type==='approval.action'&&Boolean(scope?.length));
      const selected=node.type==='agent.task'?localTools??[]:callsExternalTool?[node.config.tool]:[];
      for(const name of selected){
        if(typeof name!=='string'||!name.startsWith('mcp.'))continue;
        requireThat(!ceiling||ceiling.includes(name),403,node.title+'의 상위 역할에 허용되지 않은 도구입니다.');
        let pin:McpPin|undefined;
        try{pin=toolPin(name,scope);}catch{requireThat(false,422,node.title+'에서 사용할 MCP 연결 버전 하나를 지정하세요.');}
        connector(name,pin);
      }
      if(node.graph)validate(node.graph,scope,childCeiling);
      if(node.type==='agent.task')for(const e of incoming.filter(e=>e.input==='workflow')){
        const callable=byId.get(e.from)?.graph;if(callable)validate(callable,scope,childCeiling);
      }
    }
  }
  return {tools,read,connector,validate:()=>validate(graph)};
}
