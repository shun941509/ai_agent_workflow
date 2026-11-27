import type {Block,Graph} from './types';

export interface AgentSkill {
  key:string;
  title:string;
  version:string;
  content?:string;
}
export interface AgentContext {
  goals:string[];
  assignments:string[];
  availableSkills:AgentSkill[];
  activeSkills:AgentSkill[];
}
export const emptyAgentContext:AgentContext={goals:[],assignments:[],availableSkills:[],activeSkills:[]};
export const modelBlocks:ReadonlySet<string>=new Set(['ai.single_task','agent.task','ai.classify','agent.coordinate','agent.select_candidate','quality.evidence','quality.evaluate','context.compress']);

export function usesModel(graph:Graph):boolean {
  return graph.nodes.some(node => modelBlocks.has(node.type) || (node.graph ? usesModel(node.graph) :
    isDelegatedRole(node.type) || (node.type==='workflow.call' && Boolean(node.config.workflowId && node.config.version))));
}

export function childScopeInstructions(graph?:Graph):string[] {
  if(graph?.agentScope?.mode!=='dedicated'||!usesModel(graph))return [];
  return ['', '하위 Agent의 담당 업무 — '+graph.agentScope.purpose,
    '위임할 입력이 이 범위에 속하는지 먼저 확인하세요. 범위 밖이면 하위 작업을 중단하고, 섞여 있으면 업무에 해당하는 부분만 전달하세요.',
    '하위 역할의 주 입력과 참조용 원래 질문에는 이 판정을 거친 요청을 사용하세요.'];
}

export function isDelegatedRole(type:string){
  return type==='agent.delegate'||type==='agent.handoff'||type==='agent.create_dynamic';
}

export function skillChoicesFor(node:Block,parent:AgentContext){
  if(isDelegatedRole(node.type)||node.type==='agent.team')return parent.availableSkills;
  if((node.type==='ai.single_task'||node.type==='agent.task')&&!parent.activeSkills.length)return parent.availableSkills;
  return [];
}

export function skillsForAgent(node:Block,parent:AgentContext,local:AgentSkill[]):AgentSkill[]{
  const ids=Array.isArray(node.config.inheritedSkillIds)?node.config.inheritedSkillIds:[];
  const selected=skillChoicesFor(node,parent).filter(skill=>ids.includes(skill.key));
  const implicit=isDelegatedRole(node.type)||node.type==='agent.team'?[]:parent.activeSkills;
  // An ancestor and a local reference may have the same block ID in different graphs.
  return [...implicit,...selected].map(skill=>({...skill,key:'parent:'+skill.key})).concat(local);
}

export function childAgentContext(parent:AgentContext,node:Block,skills:AgentSkill[]):AgentContext{
  if(node.type==='agent.team')return {
    goals:node.config.goal?[...parent.goals,String(node.config.goal)]:parent.goals,
    assignments:parent.assignments,availableSkills:skills,activeSkills:[],
  };
  if(isDelegatedRole(node.type))return {
    goals:parent.goals,
    assignments:node.config.instruction?[...parent.assignments,String(node.config.instruction)]:parent.assignments,
    availableSkills:skills,activeSkills:skills,
  };
  return parent;
}

export function linkedAgentSkills(graph:Graph,nodeId:string):AgentSkill[]{
  return graph.edges.filter(edge=>edge.to===nodeId&&edge.kind==='reference'&&edge.input==='skill').flatMap(edge=>{
    const source=graph.nodes.find(node=>node.id===edge.from&&node.type==='instruction.skill');
    return source?[{key:'block:'+source.id,title:source.title,version:String(source.config.version||'1')}]:[];
  });
}

export function agentContextAt(root:Graph,path:string[]):AgentContext{
  let graph=root,context=emptyAgentContext;
  for(const id of path){
    const node=graph.nodes.find(item=>item.id===id);
    if(!node)break;
    context=childAgentContext(context,node,skillsForAgent(node,context,linkedAgentSkills(graph,id)));
    if(!node.graph)break;
    graph=node.graph;
  }
  return context;
}
