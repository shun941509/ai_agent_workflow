import { useMemo, useSyncExternalStore } from 'react';
import { constrainPosition, initialPositions, nodeIds, type NodeId, type Positions } from './graph-model';
import { defaultRule } from './library-rule';

type LibraryDraft = { rule: string; positions: Positions; selected: NodeId };
export const initialDraft: LibraryDraft = { rule: defaultRule, positions: initialPositions, selected: 'rules' };
const storageKey = 'workflow-studio:prototype:library:v1';
const changeEvent = 'library-preview-draft-change';
let inMemory: string | null = null;
let memoryOnly = false;

function snapshot() {
  if (!memoryOnly) {
    try { inMemory = window.localStorage.getItem(storageKey); }
    catch { memoryOnly = true; }
  }
  return inMemory;
}

function parseDraft(raw: string | null | undefined): LibraryDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value?.rule !== 'string' || !value.rule.trim() || !nodeIds.includes(value.selected)) return null;
    const positions = { ...initialPositions };
    for (const id of nodeIds) {
      const point = value.positions?.[id];
      if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) positions[id] = constrainPosition(id, point);
    }
    return { rule: value.rule, selected: value.selected, positions };
  } catch {
    return null;
  }
}

function subscribe(notify: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === storageKey || event.key === null) notify();
  }
  window.addEventListener('storage', onStorage);
  window.addEventListener(changeEvent, notify);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(changeEvent, notify);
  };
}

export function useLibraryDraft() {
  const raw = useSyncExternalStore<string | null | undefined>(subscribe, snapshot, () => undefined);
  const saved = useMemo(() => parseDraft(raw), [raw]);
  return { draft: saved ?? initialDraft, hasSaved: Boolean(saved), ready: raw !== undefined };
}

export function updateLibraryDraft(edit: (draft: LibraryDraft) => LibraryDraft) {
  const previous = snapshot();
  const next = JSON.stringify(edit(parseDraft(previous) ?? initialDraft));
  if (previous === next) return;
  inMemory = next;
  if (!memoryOnly) {
    try { window.localStorage.setItem(storageKey, next); }
    catch { memoryOnly = true; }
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function rememberEditor() {
  if (!parseDraft(snapshot())) updateLibraryDraft(() => initialDraft);
}
