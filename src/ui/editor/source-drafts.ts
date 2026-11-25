import type { Block, Graph } from '../../domain/types';
import { sourceDraftKey } from '../../domain/source-preview';
export { sourceDraftKey };
import { subgraph, updateSubgraph } from './graph';

export type SourceDraft = { path: string[]; id: string; base: string; text: string };
export type SourceDrafts = Record<string, SourceDraft>;

export type RecoveryDraft = SourceDraft & { record: string; updated: number };

function readDraft(raw: string | null): SourceDraft | undefined {
  try {
    const item = JSON.parse(raw ?? 'null');
    if (item && Array.isArray(item.path) && item.path.every((id: unknown) => typeof id === 'string') &&
        typeof item.id === 'string' && typeof item.base === 'string' && typeof item.text === 'string') return item;
  } catch { /* Ignore an unreadable record without affecting other blocks. */ }
}

// sessionStorage restores this tab. Separate local records also make a closed tab's drafts recoverable.
export function sourceDraftStore(projectId: string) {
  const prefix = 'studio.source.' + JSON.stringify(projectId) + '.';
  const owned = new Map<string, RecoveryDraft>();
  const writing = new Map<string, string>();
  try {
    for (const name of Object.keys(sessionStorage)) {
      if (!name.startsWith(prefix)) continue;
      const item = readDraft(sessionStorage.getItem(name)) as RecoveryDraft | undefined;
      if (item && name === prefix + sourceDraftKey(item.path, item.id) && item.record?.startsWith(prefix))
        owned.set(name.slice(prefix.length), item);
    }
    // Older installations stored a single draft under the field key.
    for (const name of Object.keys(localStorage)) {
      if (!name.startsWith(prefix + '[')) continue;
      const field = name.slice(prefix.length);
      const item = readDraft(localStorage.getItem(name));
      if (item && !owned.has(field) && sourceDraftKey(item.path, item.id) === field)
        owned.set(field, {...item, record:name, updated:0});
    }
  } catch { /* In-memory editing is still available. */ }
  return {
    prefix,
    initial: Object.fromEntries(owned) as SourceDrafts,
    recoveries(field: string, current: string, applied: string) {
      const options: RecoveryDraft[] = [];
      try {
        for (const name of Object.keys(localStorage)) {
          if (!name.startsWith(prefix) || !name.endsWith(field)) continue;
          const item = readDraft(localStorage.getItem(name)) as RecoveryDraft | undefined;
          if (!item || sourceDraftKey(item.path, item.id) !== field || [current,applied].includes(item.text)) continue;
          options.push({...item, record:name, updated:Number(item.updated) || 0});
        }
      } catch { /* Browsers may disable storage. */ }
      const seen = new Set<string>();
      return options.sort((a,b) => b.updated - a.updated).filter(item => {
        if (seen.has(item.text)) return false;
        seen.add(item.text);
        return true;
      });
    },
    write(field: string, draft?: SourceDraft, keepPrevious = false) {
      const previous = owned.get(field);
      const previousWriter = writing.get(field);
      // New documents (including a duplicated tab) branch before their first edit.
      if (keepPrevious) writing.delete(field);
      if (draft) {
        const record = writing.get(field) ?? prefix + crypto.randomUUID() + '.' + field;
        const entry = {...draft, record, updated:Date.now()};
        const json = JSON.stringify(entry);
        localStorage.setItem(record, json);
        sessionStorage.setItem(prefix + field, json);
        owned.set(field, entry);
        writing.set(field, record);
      } else {
        sessionStorage.removeItem(prefix + field);
        owned.delete(field);
        writing.delete(field);
      }
      // A duplicated tab inherits sessionStorage. It may read its parent's record, but only
      // the document that created that record can retire it. Unscoped legacy records migrate once.
      if (!keepPrevious && previous && previous.record !== writing.get(field) &&
          (previous.record === previousWriter || previous.record === prefix + field)) {
        const saved = readDraft(localStorage.getItem(previous.record));
        if (saved?.text === previous.text && saved.base === previous.base) localStorage.removeItem(previous.record);
      }
    },
  };
}

export function retainSourceDrafts(drafts: SourceDrafts, root: Graph): SourceDrafts {
  let retained = drafts;
  for (const [key, draft] of Object.entries(drafts)) {
    let scope: Graph | undefined = root;
    for (const parent of draft.path)
      scope = scope?.nodes.find((node: Block) => node.id === parent)?.graph;
    const node = scope?.nodes.find(node => node.id === draft.id);
    if (node?.type === 'resource.context' && !node.config.assetId &&
        String(node.config.content ?? '') === draft.base) continue;
    if (retained === drafts) retained = { ...drafts };
    delete retained[key];
  }
  return retained;
}

export function prepareSourceSave(root: Graph, drafts: SourceDrafts) {
  const pending = Object.values(retainSourceDrafts(drafts, root));
  const invalid = pending.find(draft => !draft.text.trim());
  if (invalid) return { graph: root, invalid };

  let graph = root;
  for (const draft of pending) {
    const scope = subgraph(graph, draft.path);
    graph = updateSubgraph(graph, draft.path, {
      ...scope,
      nodes: scope.nodes.map(node => node.id === draft.id
        ? { ...node, config: { ...node.config, content: draft.text } }
        : node),
    });
  }
  return { graph, invalid: undefined };
}
