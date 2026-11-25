import {createBlock} from './graph';
import type {Graph} from './types';

/** Earlier editors stored a document picker directly on the search or indexing block. */
export function normalizeKnowledgeReferences(graph:Graph):Graph{
  for(const node of [...graph.nodes]){
    if(node.graph)normalizeKnowledgeReferences(node.graph);
    const {assetId,version,assetGrant}=node.config;
    if(!assetId||!['knowledge.search','knowledge.manage'].includes(node.type))continue;
    const connected=graph.edges.some(e=>e.to===node.id&&e.kind==='reference'&&e.input==='context'&&
      graph.nodes.some(n=>n.id===e.from&&n.type==='resource.context'&&n.config.assetId===assetId&&String(n.config.version)===String(version)));
    if(!connected){
      const base='rag-source-'+node.id.slice(0,116);
      let id=base;
      for(let i=2;graph.nodes.some(n=>n.id===id)||graph.edges.some(e=>e.id===id+'-ref');i++)id=base+'-'+i;
      graph.nodes.push(createBlock('resource.context',{id,x:node.x,y:node.y+125,config:{assetId,version,assetGrant}}));
      graph.edges.push({id:id+'-ref',from:id,to:node.id,kind:'reference',out:'ref',input:'context'});
    }
    delete node.config.assetId;delete node.config.assetGrant;
  }
  return graph;
}
