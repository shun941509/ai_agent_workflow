import { createBlock, type Block, type Edge, type Graph } from '../../domain';
import { placeNewBlock } from './node-layout';

/** Insert a search on the same execution paths and carry the author's document references with it. */
export function insertEvidenceSearch(graph: Graph, evidence: Block) {
  const search = placeNewBlock(createBlock('knowledge.search', {
    x: Math.max(0, evidence.x - 220), y: evidence.y,
  }), graph.nodes);
  const incoming = graph.edges.filter(edge => edge.to === evidence.id);
  const primary = incoming.find(edge => edge.kind === 'data' && edge.input === 'input');
  const question = incoming.find(edge => edge.kind === 'data' && edge.input === 'question');
  const raw = graph.nodes.find(node => node.id === primary?.from)?.type === 'resource.context';
  const entries = graph.nodes.filter(node => node.type === 'input.user_request');
  const query = (!raw && primary) || question;
  const querySource = query?.from ?? (entries.length === 1 ? entries[0].id : undefined);
  const references = incoming.filter(edge => edge.kind === 'reference' && edge.input === 'context');
  const edges = graph.edges.filter(edge => edge !== primary).map(edge =>
    edge.to === evidence.id && (edge.kind === 'flow' || references.includes(edge)) ? { ...edge, to: search.id } : edge);
  function link(from: string, to: string, kind: Edge['kind'], out: string, input: string) {
    edges.push({ id: crypto.randomUUID(), from, to, kind, out, input });
  }
  if (raw && primary && !references.some(edge => edge.from === primary.from))
    edges.push({ ...primary, to: search.id, kind:'reference', out:'ref', input:'context' });
  if (querySource) {
    if (primary && !raw) edges.push({ ...primary, to: search.id });
    else link(querySource, search.id, 'data', query?.out ?? 'value', 'input');
    if (!question) link(querySource, evidence.id, 'data', query?.out ?? 'value', 'question');
    // Start an entirely unconnected step only when its query comes directly from an entry block.
    if (!incoming.some(edge => edge.kind === 'flow') && entries.some(node => node.id === querySource))
      link(querySource, search.id, 'flow', 'next', 'in');
  }
  link(search.id, evidence.id, 'flow', 'next', 'in');
  link(search.id, evidence.id, 'data', 'value', 'input');
  return { graph: { ...graph, nodes: [...graph.nodes, search], edges }, search };
}
