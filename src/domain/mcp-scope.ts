import type { Graph } from './types';

/** A capability is the immutable edition attached to a node's MCP port. */
export type McpPin={assetId:string;version:number};
export function mcpScope(inherited:McpPin[]|undefined,connections:unknown[]):McpPin[]|undefined {
  if(!connections.length)return inherited;
  const pins:McpPin[]=[];
  for(const value of connections){
    if(!value||typeof value!=='object')continue;
    const ref=value as Record<string,unknown>;
    const version=typeof ref.version==='number'?ref.version:typeof ref.version==='string'&&/^[1-9]\d*$/.test(ref.version)?Number(ref.version):0;
    if(typeof ref.assetId!=='string'||!Number.isSafeInteger(version)||version<1)continue;
    const matches=(pin:McpPin)=>pin.assetId===ref.assetId&&pin.version===version;
    if((!inherited||inherited.some(matches))&&!pins.some(matches))pins.push({assetId:ref.assetId,version});
  }
  return pins;
}
export function toolPin(name:string,pins:McpPin[]|undefined):McpPin|undefined {
  if(!name.startsWith('mcp.'))return undefined;
  const assetId=name.split('.')[1],matches=pins?.filter(p=>p.assetId===assetId)??[];
  if(matches.length!==1)throw new Error(name+' 작업에 사용할 MCP 연결 버전 하나를 이 블록 또는 상위 Agent에 연결하세요.');
  return matches[0];
}
export function nodeMcpScope(graph:Graph,nodeId:string,inherited?:McpPin[]){
  const refs=graph.edges.filter(e=>e.to===nodeId&&e.kind==='reference'&&e.input==='mcp')
    .map(edge=>graph.nodes.find(source=>source.id===edge.from&&source.type==='connection.mcp')?.config);
  return mcpScope(inherited,refs);
}
