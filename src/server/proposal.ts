import { byType, type Block, type Graph } from '../domain';
import { requireThat } from './errors';

// The model sees design information. Access grants stay on the server.
export function modelGraph(graph: Graph): Graph {
  const copy = structuredClone(graph);
  for (const node of copy.nodes) {
    delete node.config.assetGrant;
    delete node.config.workflowGrant;
    if (node.graph) node.graph = modelGraph(node.graph);
  }
  return copy;
}

const capabilityFields = [
  'assetId',
  'assetGrant',
  'workflowId',
  'workflowGrant',
  'server',
  'tool',
];
const authorityInputs = new Set(['mcp', 'workflow']);

function compileCriteria(cases: unknown[]): string {
  requireThat(cases.length > 0, 422, '수정한 AI 작업의 완료 기준이 비어 있습니다.');
  const lines = cases.map((item) => {
    const rule = item as { when?: unknown; result?: unknown } | null;
    requireThat(
      typeof rule?.when === 'string' && rule.when.trim() &&
        typeof rule.result === 'string' && rule.result.trim(),
      422, 'AI 작업의 완료 기준에는 입력 조건과 그에 따른 결과가 필요합니다.'
    );
    return `- ${rule.when.trim()} → ${rule.result.trim()}`;
  });
  return ['각 입력 항목에 맞는 조건을 적용하세요. 조건이 겹치면 위쪽 조건을 우선하세요.', ...lines].join('\n');
}

export function reviewProposal(proposed: Graph, before: Graph): Graph {
  const previous = new Map(before.nodes.map((node) => [node.id, node]));
  const nodes: Block[] = proposed.nodes.map((node) => {
    requireThat(
      byType.has(node.type),
      422,
      'AI 초안에 지원하지 않는 블록이 있습니다.'
    );
    const prior = previous.get(node.id);
    const original = prior?.type === node.type ? prior : undefined;
    const config = { ...node.config };
    if (['ai.single_task', 'agent.task'].includes(node.type) && Array.isArray(config.criterion)) {
      config.criterion = compileCriteria(config.criterion);
    }
    for (const field of capabilityFields) {
      delete config[field];
      if (original && Object.hasOwn(original.config, field))
        config[field] = original.config[field];
    }
    if(['tool.invoke','error.compensate','approval.action'].includes(node.type)&&!config.tool){
      const suggested=node.config.tool||original?.config.suggestedTool;
      if(typeof suggested==='string'&&suggested.trim())config.suggestedTool=suggested;
    }
    if (original?.config.assetId || original?.config.workflowId)
      config.version = original.config.version;
    if (
      Object.hasOwn(config, 'allowedTools') ||
      (original && Object.hasOwn(original.config, 'allowedTools'))
    ) {
      const existing = new Set(
        Array.isArray(original?.config.allowedTools)
          ? original.config.allowedTools
          : []
      );
      const requested = Array.isArray(config.allowedTools)
        ? config.allowedTools
        : (original?.config.allowedTools ?? []);
      config.allowedTools = requested.filter((name: unknown) =>
        existing.has(name)
      );
      if(node.type==='agent.task'){
        const needed=[...new Set([...requested,...(Array.isArray(original?.config.requiredTools)?original.config.requiredTools:[])])]
          .filter(name=>typeof name==='string'&&name.trim()&&!config.allowedTools.includes(name));
        if(needed.length)config.requiredTools=needed;
        else delete config.requiredTools;
      }
    }
    return {
      ...node,
      config,
      x: prior?.x ?? node.x,
      y: prior?.y ?? node.y,
      ...(node.graph
        ? {
            graph: reviewProposal(
              node.graph,
              original?.graph ?? { nodes: [], edges: [] }
            ),
          }
        : {}),
    };
  });
  const edges = proposed.edges.filter((edge) => {
    if (edge.kind !== 'reference' || !authorityInputs.has(edge.input))
      return true;
    return (
      before.edges.some(
        (saved) =>
          saved.kind === edge.kind &&
          saved.from === edge.from &&
          saved.to === edge.to &&
          saved.out === edge.out &&
          saved.input === edge.input
      ) &&
      [edge.from, edge.to].every(
        (id) =>
          previous.get(id)?.type === nodes.find((node) => node.id === id)?.type
      )
    );
  });
  return { nodes, edges, ...(before.agentScope ? {agentScope:{...before.agentScope}} : {}) };
}
