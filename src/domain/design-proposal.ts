import type { Graph } from './types';

export type DesignProposal = { graph: Graph } | { clarification: true };

export function isDesignGreeting(text: string) {
  return /^(?:안녕(?:하세요|하십니까)?|반갑습니다|hello|hi|hey)[\s.!?~。！？]*$/iu.test(text.trim());
}
