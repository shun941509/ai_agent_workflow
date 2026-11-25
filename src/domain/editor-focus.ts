import type { Graph } from './types';

export type EditorSelection = { kind: 'node' | 'edge'; id: string } | null;
export type EditorFocus = { path: string[]; selection: EditorSelection };
export const edgeGroupId = (from: string, to: string) => JSON.stringify([from, to]);

export function isEditorFocus(value: unknown): value is EditorFocus {
  if (!value || typeof value !== 'object' || !('path' in value) || !('selection' in value)) return false;
  const { path, selection } = value;
  if (!Array.isArray(path) || path.length > 8 || !path.every(id => typeof id === 'string' && id.length <= 150)) return false;
  return selection === null || (typeof selection === 'object' && 'kind' in selection &&
    (selection.kind === 'node' || selection.kind === 'edge') && 'id' in selection &&
    typeof selection.id === 'string' && selection.id.length <= 2000);
}

export function validEditorFocus(graph: Graph, focus: unknown): EditorFocus | undefined {
  if (!isEditorFocus(focus)) return undefined;
  const path: string[] = [];
  let current = graph;
  for (const id of focus.path) {
    const nested = current.nodes.find(node => node.id === id)?.graph;
    if (!nested) return { path, selection: null };
    current = nested;
    path.push(id);
  }
  const selection = focus.selection;
  const exists = selection?.kind === 'node'
    ? current.nodes.some(node => node.id === selection.id)
    : selection && current.edges.some(edge => edgeGroupId(edge.from, edge.to) === selection.id);
  return { path, selection: exists ? selection : null };
}
