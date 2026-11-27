import type {Block,Graph} from '../domain';
import type {User} from './auth';
import type {Visibility} from './assets';
import {canProject,getVersion,project} from './projects';
import {digest,one} from './db';
import {requireThat,StudioError} from './errors';

type ResolveOptions={expand:boolean;publication?:Visibility;onUnavailable?:(node:Block)=>void;onRecursive?:(node:Block)=>void};

function referencedEdition(node:Block,id:string,user:User,publication?:Visibility){
  const p=project(id);
  requireThat(canProject(p,user,node.config.workflowGrant),403,'호출할 Workflow를 읽을 권한이 없습니다.');
  const configured=node.config.version;
  requireThat(configured===undefined||configured===null||configured===''||typeof configured==='number'&&Number.isSafeInteger(configured)&&configured>0||typeof configured==='string'&&/^[1-9]\d*$/.test(configured),422,'Workflow 버전은 양의 정수여야 합니다.');
  const raw=configured||p.public_version||(p.owner===user.id&&one<{n:number}>('SELECT max(number) n FROM versions WHERE project=?',p.id)?.n);
  const version=Number(raw);
  requireThat(Number.isSafeInteger(version)&&version>0,422,'호출할 Workflow를 먼저 버전으로 저장하고 버전을 선택하세요.');
  if(p.owner!==user.id||publication&&publication!=='private'){
    requireThat(p.visibility!=='private'&&one('SELECT 1 FROM project_releases WHERE project=? AND version=?',id,version),403,'공유 가능한 Workflow 버전을 선택하세요.');
    if(publication==='public'||p.owner!==user.id&&p.visibility==='public')requireThat(p.visibility==='public'&&one('SELECT 1 FROM project_public_releases WHERE project=? AND version=?',p.id,version),409,'공개 Agent에는 공개된 Workflow 버전을 연결하세요.');
  }
  const edition=getVersion(id,version);
  node.config.version=version;
  if(p.visibility==='link')node.config.workflowGrant=p.token;
  else delete node.config.workflowGrant;
  return edition;
}

/** Freeze referenced version IDs in snapshots; materialize their actual graphs only for execution or copying. */
export function resolveWorkflowRefs(graph:Graph,user:User,rootId:string,options:ResolveOptions):Graph{
  let nodes=0;
  function resolve(source:Graph,ancestry:Set<string>,depth:number):Graph{
    nodes+=source.nodes.length;
    requireThat(depth<8&&nodes<=500,422,'호출한 Workflow의 깊이나 전체 블록 수가 한도를 넘었습니다.');
    const result=structuredClone(source);
    for(const node of result.nodes){
      const linked=['workflow.call','workflow.tool'].includes(node.type)&&node.config.workflowId;
      if(!linked){if(node.graph)node.graph=resolve(node.graph,ancestry,depth+1);continue;}
      const id=String(node.config.workflowId);
      if(ancestry.has(id)&&options.onRecursive){
        delete node.graph;
        options.onRecursive(node);
        continue;
      }
      requireThat(!ancestry.has(id),422,'Workflow가 자신이나 상위 Workflow를 다시 호출할 수 없습니다.');
      let edition:Graph;
      try { edition=JSON.parse(referencedEdition(node,id,user,options.publication).graph); }
      catch(error) {
        if(!options.onUnavailable||!(error instanceof StudioError)||![403,404,409,422].includes(error.status))throw error;
        delete node.graph;
        options.onUnavailable(node);
        continue;
      }
      const next=new Set(ancestry);next.add(id);
      const child=resolve(edition,next,depth+1);
      if(options.expand)node.graph=child;
      else delete node.graph;
    }
    return result;
  }
  return resolve(graph,new Set([rootId]),0);
}

type ExportProblem='recursive-workflow'|'workflow-limit'|'unavailable';
const linkedProject=(node:Block)=>['workflow.call','workflow.tool'].includes(node.type)&&node.config.workflowId;

/** Reserve a graph's own inline blocks before spending the remaining package budget on external editions. */
function inlineSize(graph:Graph):{nodes:number;height:number}{
  let nodes=graph.nodes.length,height=1;
  for(const node of graph.nodes){
    if(!node.graph||linkedProject(node))continue;
    const child=inlineSize(node.graph);
    nodes+=child.nodes;height=Math.max(height,1+child.height);
  }
  return {nodes,height};
}

/** A download can describe an unfinished call. Executions and saved versions still use the strict resolver above. */
export function resolveExportWorkflowRefs(source:Graph,user:User,rootId:string){
  const graph=structuredClone(source);
  const problems=new WeakMap<Block,ExportProblem>();
  const shared=new WeakMap<Block,string>();
  type Frame={graph:Graph;ancestry:Set<string>;depth:number};
  type Tree={projects:Set<string>;height:number};
  type Edition={key:string;id:string;first:Block;graph:Graph;tree?:Tree};
  const editions=new Map<string,Edition>();
  const references=new WeakMap<Block,{edition:Edition;frame:Frame}>();
  const queue:Frame[]=[{graph,ancestry:new Set([rootId]),depth:0}];
  let remaining=500-inlineSize(graph).nodes;
  // A shallow call can include a complete edition even if an earlier branch calls it near the depth limit.
  for(let i=0;i<queue.length;i++){
    const frame=queue[i],{graph:current,ancestry,depth}=frame;
    const agents=new Set(current.nodes.filter(node=>node.type==='agent.task').map(node=>node.id));
    for(const node of current.nodes){
      const projectId=linkedProject(node);
      if(!projectId){
        if(node.graph)queue.push({graph:node.graph,ancestry,depth:depth+1});
        continue;
      }
      // A graph supplied alongside a pin never substitutes for its authorized saved version.
      delete node.graph;
      const id=String(projectId);
      if(ancestry.has(id)){problems.set(node,'recursive-workflow');continue;}
      let edition;
      try{edition=referencedEdition(node,id,user);}
      catch(error){
        if(!(error instanceof StudioError)||![403,404,409,422].includes(error.status))throw error;
        problems.set(node,'unavailable');continue;
      }
      const key='edition-'+digest(JSON.stringify([id,edition.number])).slice(0,24);
      const existing=editions.get(key);
      if(existing){references.set(node,{edition:existing,frame});continue;}
      const child:Graph=JSON.parse(edition.graph);
      const size=inlineSize(child);
      if(size.nodes>remaining||depth+1+size.height>8){problems.set(node,'workflow-limit');continue;}
      remaining-=size.nodes;
      node.graph=child;
      const entry:Edition={key,id,first:node,graph:child};
      editions.set(key,entry);references.set(node,{edition:entry,frame});
      if(node.type==='workflow.tool'){
        const callers=new Set(current.edges.filter(edge=>edge.kind==='reference' && edge.input==='workflow' &&
          edge.from===node.id && agents.has(edge.to)).map(edge=>edge.to));
        if(callers.size>1)shared.set(node,key);
      }
      queue.push({graph:child,ancestry:new Set([...ancestry,id]),depth:depth+1});
    }
  }
  // Check each alias against the complete shared body without copying or recursively revisiting that body.
  const visiting=new Set<Edition>();
  function includesActiveOwner(edition:Edition):boolean{
    function check(graph:Graph):boolean{
      return graph.nodes.some(node=>{
        const nested=references.get(node)?.edition;
        return Boolean(node.graph && (nested && visiting.has(nested) || check(node.graph)));
      });
    }
    return visiting.has(edition)||check(edition.graph);
  }
  function summarize(current:Graph):Tree {
    const tree:Tree={projects:new Set(),height:1};
    for(const node of current.nodes){
      const ref=references.get(node);
      let child:Tree;
      if(ref){
        const {edition,frame}=ref;
        // Decline the back-reference itself, even if its target owns another active definition.
        if(node!==edition.first && visiting.size && includesActiveOwner(edition)){problems.set(node,'recursive-workflow');continue;}
        if(!edition.tree){
          visiting.add(edition);
          edition.tree=summarize(edition.graph);
          visiting.delete(edition);
          edition.tree.projects.add(edition.id);
        }
        child=edition.tree;
        if(node!==edition.first){
          if([...child.projects].some(id=>frame.ancestry.has(id))){problems.set(node,'recursive-workflow');continue;}
          if(frame.depth+1+child.height>8){problems.set(node,'workflow-limit');continue;}
          shared.set(edition.first,edition.key);shared.set(node,edition.key);
        }
      }else if(node.graph)child=summarize(node.graph);
      else continue;
      for(const project of child.projects)tree.projects.add(project);
      tree.height=Math.max(tree.height,1+child.height);
    }
    return tree;
  }
  summarize(graph);
  return {graph,shared,problems};
}
