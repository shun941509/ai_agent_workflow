import type {Graph} from '../domain';
import type {User} from './auth';
import type {Visibility} from './assets';
import {canProject,getVersion,project} from './projects';
import {one} from './db';
import {requireThat} from './errors';

type ResolveOptions={expand:boolean;publication?:Visibility};

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
      requireThat(!ancestry.has(id),422,'Workflow가 자신이나 상위 Workflow를 다시 호출할 수 없습니다.');
      const p=project(id);
      requireThat(canProject(p,user,node.config.workflowGrant),403,'호출할 Workflow를 읽을 권한이 없습니다.');
      const configured=node.config.version;
      requireThat(configured===undefined||configured===null||configured===''||typeof configured==='number'&&Number.isSafeInteger(configured)&&configured>0||typeof configured==='string'&&/^[1-9]\d*$/.test(configured),422,'Workflow 버전은 양의 정수여야 합니다.');
      const raw=configured||p.public_version||(p.owner===user.id&&one<{n:number}>('SELECT max(number) n FROM versions WHERE project=?',p.id)?.n);
      const version=Number(raw);
      requireThat(Number.isSafeInteger(version)&&version>0,422,'호출할 Workflow를 먼저 버전으로 저장하고 버전을 선택하세요.');
      if(p.owner!==user.id||options.publication&&options.publication!=='private'){
        requireThat(p.visibility!=='private'&&one('SELECT 1 FROM project_releases WHERE project=? AND version=?',id,version),403,'공유 가능한 Workflow 버전을 선택하세요.');
        if(options.publication==='public'||p.owner!==user.id&&p.visibility==='public')requireThat(p.visibility==='public'&&one('SELECT 1 FROM project_public_releases WHERE project=? AND version=?',p.id,version),409,'공개 Agent에는 공개된 Workflow 버전을 연결하세요.');
      }
      node.config.version=version;
      if(p.visibility==='link')node.config.workflowGrant=p.token;
      else delete node.config.workflowGrant;
      const next=new Set(ancestry);next.add(id);
      const child=resolve(JSON.parse(getVersion(id,version).graph),next,depth+1);
      if(options.expand)node.graph=child;
      else delete node.graph;
    }
    return result;
  }
  return resolve(graph,new Set([rootId]),0);
}
