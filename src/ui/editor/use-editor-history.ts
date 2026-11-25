import {useImperativeHandle, useLayoutEffect, useRef, type Ref} from 'react';
import {isEditorFocus, type EditorFocus} from '../../domain/editor-focus';
import type {CanvasBookmark} from './Canvas';
import type {InspectorTab} from './InspectorTabs';

export type HistoryPane = 'canvas' | 'inspector' | 'palette';
export type WireChoiceSource = {node:string; output?:string};
export type EditorDialog = 'ai' | 'issues' | 'import' | 'name' | 'export' | 'shortcuts' | 'copy-source' | 'attach-shared' | null;
export type PairEdit = 'transfers' | 'conditions';
export type ConnectionTarget = {from?:string; to?:string; input?:string; routeId?:string; edit?:PairEdit};
export interface EditorLocation extends EditorFocus {
  project:string;
  pane:HistoryPane;
  tab:InspectorTab;
  pendingRun?:string;
  list:boolean;
  dialog:EditorDialog;
  connection:ConnectionTarget|null;
  wireChoices:string[];
  wireSource?:WireChoiceSource;
  drawer:boolean;
  bookmark?:CanvasBookmark;
}
export type EditorPopHandler = () => boolean;

export function editorLocation(project:string):EditorLocation|undefined {
  if (typeof window === 'undefined' || new URLSearchParams(location.search).get('edit') !== project) return;
  const entry = history.state?.studioEditor;
  if (entry?.project === project && isEditorFocus(entry)) {
    // Older editor entries showed the guide in a dialog.
    if ('dialog' in entry && (entry.dialog === 'guide' || entry.dialog === 'lesson'))
      return {...entry, dialog:null} as EditorLocation;
    return entry as EditorLocation;
  }
}

// Parent entries contain navigation and camera state only. Graph edits stay in the mounted editor.
function layers(location:EditorLocation):EditorLocation[] {
  const canvas:EditorLocation = {...location, pane:'canvas', dialog:null, connection:null, wireChoices:[], wireSource:undefined, drawer:false};
  const result = location.path.map((id,index):EditorLocation => ({
    ...canvas, path:location.path.slice(0,index), selection:{kind:'node',id}, bookmark:undefined,
  }));
  result.push(canvas);
  if (location.pane !== 'canvas') result.push({...canvas, pane:location.pane});
  if (location.dialog || location.connection || location.wireChoices?.length || location.drawer) result.push(location);
  return result;
}
function sameLayer(a:EditorLocation,b:EditorLocation) {
  return JSON.stringify([a.path,a.pane,a.dialog,a.connection,a.wireChoices ?? [],a.wireSource,!!a.drawer]) ===
    JSON.stringify([b.path,b.pane,b.dialog,b.connection,b.wireChoices ?? [],b.wireSource,!!b.drawer]);
}
function write(entry:EditorLocation, push=false) {
  const state = {...history.state, studioEditor:entry};
  if (push) history.pushState(state, '');
  else history.replaceState(state, '');
}

export function useEditorHistory(
  ref:Ref<EditorPopHandler>|undefined, current:EditorLocation,
  readBookmark:(path:string[])=>CanvasBookmark|undefined,
  restore:(location:EditorLocation)=>void,
) {
  const rewinding = useRef(false);
  // Closing a panel with its own button consumes the same entry as browser Back.
  // A sibling transition (for example, inspector → child team) replaces that final entry.
  function sync() {
    if (!ref || rewinding.current || new URLSearchParams(location.search).get('edit') !== current.project) return;
    const previous = editorLocation(current.project);
    const next = layers(current);
    if (!previous) {
      if (history.length === 1 || (!document.referrer && window.navigation?.canGoBack === false)) {
        const address = location.href;
        history.replaceState({...history.state, workspacePosition:{y:0, projectId:current.project}}, '', '/?view=projects');
        history.pushState(null, '', address);
      }
      next.forEach((entry,index) => write(entry,index > 0));
      return;
    }
    if (sameLayer(previous,current)) {
      const updated = {...current, bookmark:previous.bookmark};
      if (JSON.stringify(updated)!==JSON.stringify(previous)) write(updated);
      return;
    }
    const before = layers(previous);
    let shared = 0;
    while (shared < before.length && shared < next.length && sameLayer(before[shared],next[shared])) shared++;
    const replaceSibling = shared < before.length && shared < next.length;
    const stepsBack = before.length - shared - Number(replaceSibling);
    if (stepsBack > 0) {
      rewinding.current = true;
      history.go(-stepsBack);
      return;
    }
    if (replaceSibling) write(next[shared++]);
    else {
      const parent = next[shared-1];
      write({...parent, list:previous.list, bookmark:readBookmark(parent.path) ?? previous.bookmark});
    }
    for (let i=shared; i<next.length; i++) write(next[i],true);
  }
  useLayoutEffect(sync);
  useImperativeHandle(ref, () => () => {
    const entry = editorLocation(current.project);
    if (!entry) { rewinding.current = false; return false; }
    if (rewinding.current) {
      rewinding.current = false;
      sync();
    } else restore(entry);
    return true;
  });
}
