import type { Graph } from './types';

export type SourceSnapshot = Record<string, { title:string; text:string }>;
export type TestSources = { runId:string; version:number|null; created:string; state?:string; caseTitle?:string; sources:SourceSnapshot|null;
  question?:string; answer?:string; error?:string };
export const sourceDraftKey = (path:string[],id:string) => JSON.stringify([...path,id]);

/** Compare the loan rule in the editor with the rule pinned to an earlier test conversation. */
export function beginnerRuleSource(graph:Graph):string|null {
  const rule=graph.nodes.find(node=>node.id==='rules' && node.type==='resource.context');
  if(!rule)return null;
  const {assetId,version,content}=rule.config;
  return assetId ? JSON.stringify([assetId,String(version)]) : JSON.stringify([String(content??'')]);
}

export function sourceSnapshot(graph:Graph, path:string[] = [], titles:string[] = []):SourceSnapshot {
  const sources:SourceSnapshot = {};
  for (const node of graph.nodes) {
    const names = [...titles,node.title || node.id];
    if (node.type === 'resource.context' && !node.config.assetId)
      sources[sourceDraftKey(path,node.id)] = {title:names.join(' › '),text:String(node.config.content ?? '')};
    // The editor can compare embedded blocks. A referenced Workflow owns its own sources.
    if (node.graph && !node.config.workflowId)
      Object.assign(sources,sourceSnapshot(node.graph,[...path,node.id],names));
  }
  return sources;
}

const sentences = new Intl.Segmenter('ko', { granularity: 'sentence' });

export function firstSourceSentence(content: unknown): string {
  if (typeof content !== 'string') return '';
  const text = content.trimStart();
  return sentences.segment(text)[Symbol.iterator]().next().value?.segment.trimEnd() ?? '';
}
