import {byType} from './catalog';
import type {Graph} from './types';

export interface ExportPreparation {
  step: string;
  /** Positions in the previewed graph, independent of labels and selected resources. */
  stepPath?: string[];
  action: string;
  reason: string;
  when?: {key: string; selected: boolean; unlessSelected?:string};
}

export function exportStepPaths(graph: Graph, parent: string[] = []): Map<string,string[]> {
  return new Map(graph.nodes.map((node, index) => [node.id, [...parent, String(index)]]));
}

export function sharedEditionLabel(version:unknown,path:string[]) {
  return '공유 하위 Workflow '+version+'판 ('+path.join('.')+')';
}

/** Canonical addresses let all call sites attach preparation to the same saved stage. */
export function sharedExportDefinitions(root:Graph) {
  const definitions=new Map<string,{graph:Graph;ids:string[];titles:string[];stepPath:string[]}>();
  function visit(graph:Graph,ids:string[],titles:string[],parentPath:string[]){
    const names=exportStepNames(graph), paths=exportStepPaths(graph,parentPath);
    for(const node of graph.nodes){
      if(!node.graph)continue;
      const childIds=[...ids,node.id], stepPath=paths.get(node.id)!;
      const edition=node.config.exportSharedEdition;
      const childTitles=edition?[sharedEditionLabel(node.config.version,stepPath)]:[...titles,names.get(node.id)!];
      if(edition)definitions.set(edition,{graph:node.graph,ids:childIds,titles:childTitles,stepPath});
      visit(node.graph,childIds,childTitles,stepPath);
    }
  }
  visit(root,[],[],[]);
  return definitions;
}

/** These labels are safe to include even when the corresponding MCP connection was omitted. */
export function exportStepNames(graph: Graph): Map<string,string> {
  const counts = new Map<string,number>();
  const labels = graph.nodes.map(node => {
    const label = node.type === 'connection.mcp' ? 'MCP 연결' :
      node.title.trim().replace(/\s+/g, ' ') || byType.get(node.type)?.name || '이름 없는 단계';
    counts.set(label, (counts.get(label) ?? 0) + 1);
    return label;
  });
  const seen = new Map<string,number>();
  return new Map(graph.nodes.map((node, i) => {
    const label = labels[i];
    if (counts.get(label) === 1) return [node.id, label];
    let number = (seen.get(label) ?? 0) + 1;
    while (counts.has(label + ' (' + number + ')')) number++;
    seen.set(label, number);
    return [node.id, label + ' (' + number + ')'];
  }));
}

export function activeExportPreparation(items: ExportPreparation[], selected: readonly string[]): ExportPreparation[] {
  type Entry = {item: ExportPreparation; omitted: Set<string>};
  const keys = new Set(selected);
  const groups = new Map<string, Map<string, Entry>>();
  for (const item of items) {
    if (item.when && keys.has(item.when.key) !== item.when.selected) continue;
    if (item.when?.unlessSelected && keys.has(item.when.unlessSelected)) continue;
    const stepKey = JSON.stringify(item.stepPath ?? item.step);
    const group = groups.get(stepKey) ?? new Map<string, Entry>();
    groups.set(stepKey, group);
    const description = JSON.stringify([item.action, item.reason]);
    const entry = group.get(description) ?? {item, omitted:new Set<string>()};
    if (item.when?.selected === false) entry.omitted.add(item.when.key);
    group.set(description, entry);
  }
  return [...groups.values()].flatMap(group => [...group.values()].map(({item, omitted}) =>
    omitted.size > 1 ? {...item, reason:item.reason + ' 이 단계에서 빠진 항목은 ' + omitted.size + '개입니다.'} : item));
}

export interface ExportResource {
  key: string;
  name: string;
  kind: 'document' | 'skill' | 'knowledge' | 'mcp' | 'workflow';
  version: string;
  steps: string[];
  available: boolean;
  mcpMode?: 'remote' | 'manual';
  mcpUrl?: string;
  requiresAuth?: boolean;
  linkedFiles?: {path:string; target?:string; actualPath?:string}[];
  unavailableReason?: 'recursive-workflow' | 'workflow-limit' | 'unpublished' | 'unindexed';
}

export interface ExportMcp {
  id: string;
  tools: string[];
  url?: string;
  tokenEnv?: string;
  readOnlyTools?: string[];
}

export interface ExportPackage {
  title: string;
  graph: Graph;
  preparation?: ExportPreparation[];
  resources: (ExportResource & {included: boolean; files: string[]; mcp?: ExportMcp;
    skillName?:string; source?: {id:string; assetId?:string; location?:string; candidateOnly?:boolean}})[];
  files: {path: string; data: string}[];
}
