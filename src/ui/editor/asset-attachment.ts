import {connectBlocks, createBlock, portsFor, type Block, type Graph} from '../../domain';
import type {AssetItem} from '../ResourceLibrary';
import {subgraph, titleById, updateSubgraph} from './graph';
import {nodeLayout, placeNewBlock} from './node-layout';

export type SharedAssetPin = Pick<AssetItem, 'id' | 'name' | 'kind' | 'version'>;

const references = {
  document: {type:'resource.context', input:'context', target:'ai.single_task'},
  knowledge: {type:'resource.context', input:'context', target:'knowledge.search'},
  skill: {type:'instruction.skill', input:'skill', target:'ai.single_task'},
  mcp: {type:'connection.mcp', input:'mcp', target:'tool.invoke'},
} as const;

export function defaultAssetTarget(kind: SharedAssetPin['kind']) { return references[kind].target; }

export function acceptsAsset(target: Block, kind: SharedAssetPin['kind']) {
  // Evidence checks require passages from a search, not a direct document reference.
  return target.type !== 'quality.evidence' && portsFor(target).inputs.some(port =>
    port.kind === 'reference' && port.id === references[kind].input);
}

export type AssetTarget = {path:string[]; id:string};

export function assetTargets(graph:Graph, kind:SharedAssetPin['kind']) {
  const choices: (AssetTarget & {value:string; label:string; type:string})[] = [];
  // Imported block IDs can themselves be serialized paths. Reserve root IDs first.
  const used = new Set(graph.nodes.map(node => node.id));
  function visit(scope:Graph, path:string[], parents:string[]) {
    for (const node of scope.nodes) {
      const names = [...parents, titleById(scope, node.id)];
      if (acceptsAsset(node, kind)) {
        let value = node.id;
        if (path.length) {
          value = JSON.stringify([...path, node.id]);
          while (used.has(value)) value = '@' + value;
          used.add(value);
        }
        choices.push({id:node.id, path, value, label:names.join(' › '), type:node.type});
      }
      const linkedWorkflow = (node.type === 'workflow.call' || node.type === 'workflow.tool') && node.config.workflowId;
      if (node.graph && !linkedWorkflow) visit(node.graph, [...path, node.id], names);
    }
  }
  visit(graph, [], []);
  return choices;
}

export function attachAssetEdition(graph: Graph, targetId: string, asset: SharedAssetPin) {
  const target = graph.nodes.find(node => node.id === targetId);
  if (!target || !acceptsAsset(target, asset.kind)) throw Error('이 자료를 받을 수 있는 블록을 선택하세요.');
  if (!Number.isSafeInteger(asset.version) || asset.version < 1) throw Error('연결할 자료판을 확인하세요.');
  const {type, input} = references[asset.kind];
  const pins = graph.nodes.filter(node => node.type === type && node.config.assetId === asset.id);
  const sameEdition = pins.filter(node => String(node.config.version) === String(asset.version));
  const incoming = new Set(graph.edges.filter(edge => edge.to === targetId && edge.kind === 'reference' && edge.input === input).map(edge => edge.from));
  const connected = sameEdition.find(node => incoming.has(node.id));
  if (connected) return {graph, source:connected};
  if (asset.kind === 'mcp' && pins.some(node => incoming.has(node.id))) {
    throw Error('이 블록은 같은 MCP의 다른 판을 사용 중입니다. 기존 MCP 연결을 해제한 뒤 원하는 판을 연결하세요.');
  }
  const source = sameEdition[0] ?? placeNewBlock(createBlock(type, {
    title:asset.name, config:{assetId:asset.id, version:asset.version},
    x:target.x, y:target.y + nodeLayout(target).height + 48,
  }), graph.nodes);
  const next = sameEdition.length ? graph : {...graph, nodes:[...graph.nodes, source]};
  const edges = connectBlocks(next, source.id, targetId, [{kind:'reference', out:'ref', input}]);
  if (!edges.length) throw Error('이 자료를 받을 수 있는 참조 연결을 찾지 못했습니다.');
  return {graph:{...next, edges:[...graph.edges, ...edges]}, source};
}

export function attachWorkflowAsset(root:Graph, asset:SharedAssetPin, choice?:AssetTarget) {
  const path = choice?.path ?? [];
  const scope = subgraph(root, path);
  let graph = scope;
  let id: string;
  if (choice) id = choice.id;
  else {
    const target = placeNewBlock(createBlock(defaultAssetTarget(asset.kind)), graph.nodes);
    graph = {...graph, nodes:[...graph.nodes, target]};
    id = target.id;
  }
  const linked = attachAssetEdition(graph, id, asset);
  return {graph:linked.graph === scope ? root : updateSubgraph(root, path, linked.graph), source:linked.source,
    path, targetTitle:titleById(linked.graph, id)};
}
