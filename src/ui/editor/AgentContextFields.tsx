import type {Block,Graph} from '../../domain/types';
import {isDelegatedRole,linkedAgentSkills,modelBlocks,skillChoicesFor,skillsForAgent,type AgentContext,type AgentSkill} from '../../domain/agent-context';

const label=(skill:AgentSkill)=>skill.title+' · '+skill.version+'판';

export function AgentContextFields({node,graph,parent,onSelect}:{
  node:Block;graph:Graph;parent:AgentContext;onSelect:(ids:string[])=>void;
}){
  const team=node.type==='agent.team';
  if(!team&&!isDelegatedRole(node.type)&&!modelBlocks.has(node.type))return null;
  const choices=skillChoicesFor(node,parent);
  const selected=choices.filter(skill=>Array.isArray(node.config.inheritedSkillIds)&&node.config.inheritedSkillIds.includes(skill.key)).map(skill=>skill.key);
  const skills=skillsForAgent(node,parent,linkedAgentSkills(graph,node.id));
  if(!team&&!parent.goals.length&&!parent.assignments.length&&!choices.length&&!skills.length)return null;
  return <fieldset className="ws-fieldset">
    <legend>{team?'담당자에게 전달할 지침':'이 블록이 받는 지침'}</legend>
    {parent.goals.length>0&&<div className="ws-field"><span>상위 팀 목표</span>
      {parent.goals.map((goal,index)=><div key={index}>{goal}</div>)}</div>}
    {parent.assignments.length>0&&<div className="ws-field"><span>상위 담당자가 맡긴 일</span>
      {parent.assignments.map((task,index)=><div key={index}>{task}</div>)}</div>}
    {choices.length>0&&<fieldset className="ws-fieldset"><legend>전달받을 상위 Skill</legend>
      {choices.map(skill=><label key={skill.key} className="ws-check"><input type="checkbox"
        checked={selected.includes(skill.key)} onChange={event=>onSelect(event.target.checked?
          [...selected,skill.key]:selected.filter(key=>key!==skill.key))}/>{label(skill)}</label>)}
    </fieldset>}
    {skills.length>0&&<div className="ws-field"><span>{team?'담당자가 선택할 수 있는 Skill':'적용되는 Skill'}</span>
      {skills.map(skill=><div key={skill.key}>{label(skill)}</div>)}</div>}
    {team&&<p className="ws-hint">팀 목표는 모든 담당자에게 전달됩니다. 팀에 연결한 Skill은 각 담당자의 속성에서 선택하세요.</p>}
  </fieldset>;
}
