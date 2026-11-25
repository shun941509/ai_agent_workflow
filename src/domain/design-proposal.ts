import type { Graph } from './types';
import type { WorkDocumentId } from './work-documents';
import { agentPurposeLimit } from './graph';

export type DesignProposal = { graph: Graph } | { clarification: true };
export type DesignChangeContext = 'editor' | WorkDocumentId;

export function isDesignGreeting(text: string) {
  return /^(?:안녕(?:하세요|하십니까)?|반갑습니다|hello|hi|hey)[\s.!?~。！？]*$/iu.test(text.trim());
}

export function newAgentPurpose(prompt: string, answer?: string, graph?: Graph) {
  const original = prompt.trim();
  const followUp = answer?.trim();
  if (!followUp) return original.slice(0, agentPurposeLimit);
  const proposed = graph?.agentScope;
  if (proposed?.mode === 'dedicated' && proposed.purpose.trim()) return proposed.purpose.trim();
  if (isDesignGreeting(original)) return followUp.slice(0, agentPurposeLimit);
  // Earlier receipts have no purpose. Their AI blocks already describe the work the user reviewed.
  if (graph) {
    const tasks = graph.nodes.filter(node => ['agent.task','ai.single_task','agent.team'].includes(node.type));
    const instructions = tasks.flatMap(node => [node.config.goal, node.config.instruction])
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
    if (instructions.length) return [...new Set(instructions.map(text => text.trim()))].join('\n').slice(0, agentPurposeLimit);
  }
  const separator = '\n보충 설명: ';
  const budget = agentPurposeLimit - separator.length;
  const first = original.slice(0, Math.max(Math.floor(budget / 2), budget - followUp.length));
  return first + separator + followUp.slice(0, budget - first.length);
}
