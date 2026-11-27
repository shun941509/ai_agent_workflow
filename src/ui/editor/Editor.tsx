'use client';
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type MouseEventHandler, type ReactNode, type Ref } from 'react';
import {
  byType,
  blankPracticeLessonId,
  connectBlocks,
  connectionOptions,
  createBlock,
  migrateGraph,
  portsFor,
  validateGraph,
  type Block,
  type Graph,
  type Issue,
  type Lesson,
} from '../../domain/index';
import { Canvas, type CanvasBookmark, type CanvasHandle, type CanvasListPosition } from './Canvas';
import { CanvasShortcuts } from './CanvasShortcuts';
import { preferredList, rememberCanvasMode } from './canvas-preference';
import { FlowConditionsModal } from './FlowConditionsModal';
import { AgentScopeDialog } from './AgentScopeDialog';
import { AgentExportDialog } from './AgentExportDialog';
import { SourceCopyChoice, SourceTestChoice, type SaveReferenceDocument } from './InlineSourceEditor';
import { useMaterialPreviews } from './use-material-previews';
import { prepareSourceSave, sourceDraftStore, retainSourceDrafts, sourceDraftKey, type SourceDraft } from './source-drafts';
import { sourceSnapshot, type SourceOutput } from './source-comparison';
import type { TestSources } from '../../domain/source-preview';
import type { DesignProposal } from '../../domain/design-proposal';
import { SourceOutputChoice } from './SourceOutputChoice';
import { placeNewBlock } from './node-layout';
import { insertEvidenceSearch } from './evidence-search';
import {attachAssetEdition, attachWorkflowAsset, type AssetTarget, type SharedAssetPin} from './asset-attachment';
import {SharedAssetDialog} from './SharedAssetDialog';
import { WorkspaceMenuButton, WorkspaceNav, type WorkspaceDestination, type WorkspaceMenuAction } from '../WorkspaceNav';
import PracticeCoach, { type PracticeCoachHandle } from './PracticeCoach';
import RunPanel, { type RunProject } from '../RunPanel';
import { PromptTextarea } from '../PromptTextarea';
import { api } from '../client';
import { InspectorTabs, type InspectorTab } from './InspectorTabs';
import { useInspectorFocus } from './use-inspector-focus';
import {editorLocation, useEditorHistory, type EditorDialog, type EditorPopHandler, type ConnectionTarget} from './use-editor-history';
import { Icon, type IconName } from './Icons';
import { ConnectionModal, Inspector, Modal, Palette, type AssetOption, type PaletteTab } from './Panels';
import {nodeMcpScope,type McpPin} from '../../domain/mcp-scope';
import { agentContextAt } from '../../domain/agent-context';
import { validEditorFocus, type EditorFocus } from '../../domain/editor-focus';
import {
  arranged,
  clone,
  graphChanges,
  groupEdges,
  groupKey,
  nodeTitle,
  subgraph,
  titleById,
  uniqueId,
  updateSubgraph,
  type Selection,
} from './graph';
import './editor.css';
import './inspector-tabs.css';
import './workspace-editor.css';

export type EditorDestination = Exclude<WorkspaceDestination, 'editor'>;
export interface EditorProps {
  project: RunProject & { graph: Graph; lesson?: string; hasExampleAnswer?: boolean };
  user: { id: string; login: string };
  saveDraftRef?: Ref<(includeEdited?:boolean) => Promise<boolean>>;
  historyRef?: Ref<EditorPopHandler>;
  sourceOutputRef?: Ref<() => SourceOutput>;
  onAccount: () => void;
  onSave: (graph: Graph, title: string) => Promise<void>;
  getDraftRevision: () => number|undefined;
  onSaveReference: SaveReferenceDocument;
  onRefreshAssets: () => Promise<void>;
  onPropose: (prompt: string, graph: Graph, clarificationAnswer?: string) => Promise<DesignProposal>;
  onVersions: () => void;
  onReopenDraft?: () => void | Promise<void>;
  onShare: () => void;
  onHome: () => void;
  onNavigate?: (view: EditorDestination) => void;
  onGuidePractice: (practice: 'example' | 'blank') => void;
  onOpenTemplate: (id: string) => void;
  onLessonGuide: (guideStep?: number) => void;
  fromGuide?: boolean;
  initialGuideStep?: number;
  initialFocus?: EditorFocus;
  initialMenuAction?: 'import';
  initialSharedAsset?: SharedAssetPin;
  initialIssue?: Issue;
  onFocusChange?: (focus: EditorFocus) => void;
  assets?: AssetOption[];
  lesson?: Pick<Lesson, 'id' | 'title' | 'level' | 'task' | 'steps' | 'checks' | 'question' | 'example' | 'optionalPractice'>;
}
type Doc = { graph: Graph; title: string };
type EditorProposal = { graph: Graph; base: string; scope: string; prompt: string; issues: string[] };
type HistoryFocusChange = {path:string[]; before:Selection; after:Selection; undoText:string; redoText:string};
type HistoryEntry = {doc: Doc; focus?:HistoryFocusChange; keyHold?:symbol; removedDrafts?:SourceDraft[]};
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const fingerprint = (doc: Doc) => JSON.stringify(doc);
function proposalIssue(graph: Graph, issue: Issue): string {
  const path = issue.path ?? [];
  let current = graph;
  const location = path.map(id => {
    const title = titleById(current, id);
    current = subgraph(current, [id]);
    return title;
  });
  if (issue.nodeId) location.push(titleById(current, issue.nodeId));
  const detail = issue.message.slice(path.length ? (path.join(' › ') + ' › ').length : 0);
  return location.length ? location.join(' › ') + ' · ' + detail : detail;
}
function preservePositions(proposed: Graph, previous: Graph): Graph {
  return {
    ...proposed,
    nodes: proposed.nodes.map((node) => {
      const old = previous.nodes.find((x) => x.id === node.id);
      if (!old) return node;
      return {
        ...node,
        x: old.x,
        y: old.y,
        ...(node.graph && old.graph ? { graph: preservePositions(node.graph, old.graph) } : {}),
      };
    }),
  };
}
function locate(root: Graph, which: string, path: string[] = []): string[] | undefined {
  if (root.nodes.some((n) => n.id === which) || root.edges.some((e) => e.id === which)) return path;
  for (const n of root.nodes)
    if (n.graph) {
      const found = locate(n.graph, which, [...path, n.id]);
      if (found) return found;
    }
}
function ToolButton({
  icon,
  children,
  onClick,
  disabled,
  primary,
  label,
}: {
  icon: IconName;
  children?: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  primary?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={(children ? 'ws-btn' : 'ws-icon-button') + (primary ? ' ws-primary' : '')}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} />
      {children}
    </button>
  );
}

function ProjectMenu({ onSave, onScope, onVersions, onShare, onExport }: {
  onSave: () => void;
  onScope: () => void;
  onVersions: () => void;
  onShare: () => void;
  onExport: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (menu.current?.open && event.target instanceof Node && !menu.current.contains(event.target))
        menu.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  function activate(action: () => void) {
    if (menu.current) {
      menu.current.open = false;
      menu.current.querySelector('summary')?.focus();
    }
    action();
  }
  return <details className="ws-project-menu" ref={menu}
    onBlur={event => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget))
        event.currentTarget.open = false;
    }}
    onKeyDown={event => {
      if (event.key === 'Escape' && event.currentTarget.open) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }
    }}>
    <summary aria-label="프로젝트 메뉴" title="프로젝트 메뉴"><Icon name="more" /><span>프로젝트 메뉴</span></summary>
    <div className="ws-project-commands">
      <ToolButton icon="save" onClick={() => activate(onSave)}>저장</ToolButton>
      <ToolButton icon="settings" onClick={() => activate(onScope)}>Agent 업무 범위</ToolButton>
      <ToolButton icon="versions" onClick={() => activate(onVersions)}>버전</ToolButton>
      <ToolButton icon="share" onClick={() => activate(onShare)}>공유 설정</ToolButton>
      <ToolButton icon="export" onClick={() => activate(onExport)}>내보내기</ToolButton>
    </div>
  </details>;
}
export default function Editor({
  project,
  user,
  saveDraftRef,
  historyRef,
  sourceOutputRef,
  onAccount,
  onSave,
  getDraftRevision,
  onSaveReference,
  onRefreshAssets,
  onPropose,
  onVersions,
  onReopenDraft,
  onShare,
  onHome,
  onNavigate,
  onGuidePractice,
  onOpenTemplate,
  onLessonGuide,
  fromGuide,
  initialGuideStep,
  initialFocus,
  initialMenuAction,
  initialSharedAsset,
  initialIssue,
  onFocusChange,
  assets = [],
  lesson,
}: EditorProps) {
  const { graph, title } = project;
  const practice = project.lesson === blankPracticeLessonId ? 'blank' : project.lesson === 'intro' ? 'example' : undefined;
  const [answeredInEditor, setAnsweredInEditor] = useState(false);
  const recordExampleAnswer = useCallback(() => setAnsweredInEditor(true), []);
  const coachRef = useRef<PracticeCoachHandle>(null);
  const guideReturn = useRef(fromGuide ? {step:initialGuideStep} : null);
  useEffect(() => {
    if (!guideReturn.current) return;
    const {step} = guideReturn.current;
    guideReturn.current = null;
    if (coachRef.current) coachRef.current.resume(step);
    else {
      const triggers = document.querySelectorAll<HTMLButtonElement>('.ws-editor button[aria-label="실습 안내"], [data-guide-menu], .ws-editor .workspace-menu-button');
      Array.from(triggers).find(button => button.getClientRects().length)?.focus();
    }
  }, []);
  const [doc, setDoc] = useState<Doc>(() => ({ graph: clone(graph), title }));
  // Only the owner can open this editor. Guest import transfers the same project ID.
  const [draftStore] = useState(() => sourceDraftStore(project.id));
  const [storedDrafts, setStoredDrafts] = useState(draftStore.initial);
  const draftRef = useRef(storedDrafts);
  const [storageRevision, setStorageRevision] = useState(0);
  useEffect(() => {
    const changed = (event:StorageEvent) => {
      if (!event.key || event.key.startsWith(draftStore.prefix)) setStorageRevision(n=>n+1);
    };
    window.addEventListener('storage',changed);
    return () => window.removeEventListener('storage',changed);
  },[draftStore]);
  const unprotectedDrafts = useRef(new Set<string>());
  const sourceDrafts = useMemo(() => retainSourceDrafts(storedDrafts, doc.graph), [storedDrafts, doc.graph]);
  const hasSourceDrafts = Object.keys(sourceDrafts).length > 0;
  const [testedSources, setTestedSources] = useState<TestSources|null>(null);
  const [exportEdited, setExportEdited] = useState(false);
  const describeSources = ():SourceOutput => ({applied:sourceSnapshot(doc.graph), drafts:sourceDrafts, tested:testedSources});
  useImperativeHandle(sourceOutputRef,()=>describeSources);
  const saveAttempt = useRef(0);
  const docRef = useRef(doc);
  docRef.current = doc;
  const past = useRef<HistoryEntry[]>([]),
    future = useRef<HistoryEntry[]>([]);
  const level = lesson?.level ?? '입문';
  const [paletteTab, setPaletteTab] = useState<PaletteTab>('level');
  const [showCatalog, setShowCatalog] = useState(!lesson || !graph.nodes.length);
  const [sharedAsset] = useState(initialSharedAsset);
  const [entry] = useState(() => sharedAsset ? undefined : editorLocation(project.id));
  const resumeRun = fromGuide && typeof entry?.pendingRun === 'string' ? entry.pendingRun : undefined;
  const [pendingRun, setPendingRun] = useState(resumeRun);
  const [openingFocus] = useState<EditorFocus>(() => {
    const restored = sharedAsset ? undefined : validEditorFocus(graph, entry ?? initialFocus);
    if (restored) return restored;
    const first = (lesson?.id === 'beginner' && graph.nodes.find(n => n.id === 'rules' && n.type === 'resource.context')) ||
      graph.nodes.find(n => ['agent.task', 'ai.single_task', 'agent.team'].includes(n.type)) || graph.nodes[0];
    return { path: [], selection: first ? {kind: 'node', id: first.id} : null };
  });
  const [selection, setSelection] = useState<Selection>(openingFocus.selection);
  const [path, setPath] = useState<string[]>(openingFocus.path),
    [pane, setPane] = useState<'canvas' | 'palette' | 'inspector'>(resumeRun ? 'inspector' : entry?.pane ?? 'canvas');
  const inspectorFocus = useInspectorFocus(pane);
  const overlayOpen = inspectorFocus.modal || inspectorFocus.paletteModal;
  const [drawer, setDrawer] = useState(entry?.drawer ?? false);
  const [wireSource, setWireSource] = useState(entry?.wireSource);
  const [wireChoices, setWireChoices] = useState<string[]>(() => {
    if (!entry?.wireChoices?.length) return [];
    const groups = groupEdges(subgraph(graph,openingFocus.path));
    const choices = entry.wireChoices.filter(id => groups.some(group => group.id === id));
    return choices && choices.length > 1 ? choices : [];
  });
  const [showRestoreNotice, setShowRestoreNotice] = useState(Boolean(onReopenDraft));
  const [reopening, setReopening] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(resumeRun ? 'results' : entry?.tab ?? 'properties');
  const [runOpened, setRunOpened] = useState(Boolean(resumeRun) || entry?.tab === 'results');
  const [reviewedSources, setReviewedSources] = useState<typeof sourceDrafts | null>(resumeRun ? sourceDrafts : null);
  const [sourceChoice, setSourceChoice] = useState(0);
  const needsSourceChoice = hasSourceDrafts && sourceDrafts !== reviewedSources;
  const canvas = useRef<CanvasHandle>(null);
  const listPositions = useRef(new Map<string, CanvasListPosition>());
  const scope = JSON.stringify(path);
  const historyFocus = useRef<{item:Selection; inspect?:boolean} | null>(null);
  const parentViews = useRef(new Map<string, {bookmark: CanvasBookmark; list: boolean}>());
  const [canvasReturn, setCanvasReturn] = useState<{scope: string; id: string; bookmark?: CanvasBookmark}|undefined>(() =>
    entry?.bookmark ? {scope:JSON.stringify(openingFocus.path),id:openingFocus.selection?.id ?? '',bookmark:entry.bookmark} : undefined);
  const focusCallback = useRef(onFocusChange);
  focusCallback.current = onFocusChange;
  useEffect(() => {
    focusCallback.current?.({ path, selection });
  }, [path, selection]);
  const [list, setList] = useState(() => entry?.list ?? preferredList(user.id, project.id,
    typeof window !== 'undefined' && window.matchMedia('(max-width:680px)').matches)),
    [layoutRev, setLayoutRev] = useState(0);
  const [overview, setOverview] = useState(false);
  const overviewExit = useRef<HTMLButtonElement>(null);
  const overviewTrigger = useRef<HTMLButtonElement>(null);
  function chooseView(nextList: boolean) {
    setOverview(false);
    setList(nextList);
    rememberCanvasMode(user.id, project.id, nextList ? 'list' : 'diagram');
  }
  function openOverview() {
    setOverview(true);
    requestAnimationFrame(() => overviewExit.current?.focus({preventScroll:true}));
  }
  function closeOverview() {
    setOverview(false);
    requestAnimationFrame(() => overviewTrigger.current?.focus({preventScroll:true}));
  }
  const [dialog, setDialog] = useState<EditorDialog>(sharedAsset ? 'attach-shared' : initialMenuAction ?? (entry?.dialog === 'attach-shared' ? null : entry?.dialog) ?? null),
    [connection, setConnection] = useState<ConnectionTarget | null>(entry?.connection ?? null);
  const [status, setStatus] = useState<string | null>('설계 초안을 열었습니다.'),
    [saveState, setSaveState] = useState('저장됨');
  const [prompt, setPrompt] = useState(''),
    [clarificationAnswer, setClarificationAnswer] = useState<string>(),
    [proposal, setProposal] = useState<EditorProposal | null>(null),
    [requestedProposal, setRequestedProposal] = useState(false),
    [thinking, setThinking] = useState(false),
    [aiError, setAiError] = useState('');
  const changeAnswerField = useRef<HTMLTextAreaElement>(null);
  const proposalFormId = useId();
  const needsChangeAnswer = clarificationAnswer !== undefined;
  useEffect(() => {
    if (dialog === 'ai' && needsChangeAnswer && !thinking && !proposal) changeAnswerField.current?.focus();
  }, [dialog, needsChangeAnswer, thinking, proposal]);
  const [importText, setImportText] = useState(''),
    [importError, setImportError] = useState(''),
    [name, setName] = useState('');
  const [importWarning,setImportWarning]=useState<{text:string;missing:string[]}>();
  const importCheck=useRef(0);
  const durable = useRef(fingerprint({ graph, title })),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<boolean> | null>(null),
    mounted = useRef(false),
    saveCallback = useRef(onSave);
  const pendingConnections = useRef(new Map<string, {controller:AbortController; done:Promise<void>}>());
  saveCallback.current = onSave;
  const lastProp = useRef(fingerprint({ graph, title })),
    aiRequest = useRef(0);
  const aiScope = useRef(scope);
  useLayoutEffect(() => {
    if (aiScope.current === scope) return;
    aiScope.current = scope;
    aiRequest.current++;
    setThinking(false);
    setAiError('');
    setProposal(null);
    setRequestedProposal(false);
    setPrompt('');
    setClarificationAnswer(undefined);
  }, [scope]);
  const workspace = subgraph(doc.graph, path),
    groups = groupEdges(workspace);
  const materialSources = useMaterialPreviews(workspace);
  const chosen =
    selection?.kind === 'node' ? workspace.nodes.find((n) => n.id === selection.id) : undefined;
  const sourceKey = chosen ? sourceDraftKey(path, chosen.id) : undefined;
  const appliedSource = String(chosen?.config.content ?? '');
  const visibleSource = (sourceKey && sourceDrafts[sourceKey]?.text) ?? appliedSource;
  const recoveries = useMemo(() => sourceKey && chosen?.type === 'resource.context' && !chosen.config.assetId
    ? draftStore.recoveries(sourceKey, visibleSource, appliedSource) : [],
    [sourceKey,chosen,visibleSource,appliedSource,draftStore,storageRevision]);
  const storeDraft = (key: string, draft?: SourceDraft, keepPrevious = false) => {
    const next = { ...draftRef.current };
    if (draft) next[key] = draft;
    else delete next[key];
    draftRef.current = next;
    if (mounted.current) setStoredDrafts(next);
    try {
      draftStore.write(key, draft, keepPrevious);
      unprotectedDrafts.current.delete(key);
    } catch {
      if (draft) unprotectedDrafts.current.add(key);
      else unprotectedDrafts.current.delete(key);
    }
  };
  const editSource = (text: string, recovering = false) => {
    if (!chosen || !sourceKey) return;
    saveAttempt.current++;
    const base = String(chosen.config.content ?? '');
    storeDraft(sourceKey, text === base ? undefined : { path, id: chosen.id, base, text }, recovering);
    setStatus(unprotectedDrafts.current.size ? '이 브라우저에 원문을 임시 보관할 공간이 없습니다. 이동 전에 프로젝트를 저장하세요.' : null);
  };
  let currentGraph=doc.graph,inheritedConnectors:McpPin[]|undefined,inheritedTools:string[]|undefined;
  for(const id of path){
    const parent=currentGraph.nodes.find(n=>n.id===id);
    if(!parent?.graph)break;
    inheritedConnectors=nodeMcpScope(currentGraph,id,inheritedConnectors);
    if(Array.isArray(parent.config.allowedTools)){
      const ceiling=inheritedTools;
      inheritedTools=parent.config.allowedTools.filter((tool:unknown)=>typeof tool==='string'&&(!ceiling||ceiling.includes(tool)));
    }
    currentGraph=parent.graph;
  }
  const checkDesign = dialog === 'issues' || inspectorTab === 'results';
  const issues = useMemo(() => checkDesign ? validateGraph(doc.graph) : [], [checkDesign, doc.graph]);
  const replaceDoc = (next: Doc) => {
    docRef.current = next;
    setDoc(next);
  };
  const apply = (next: Doc, text?: string, focus?: HistoryFocusChange, keyHold?:symbol) => {
    const previous = docRef.current;
    if (fingerprint(next) === fingerprint(previous)) return;
    if (!keyHold || past.current.at(-1)?.keyHold !== keyHold || future.current.length) {
      const previousDrafts=retainSourceDrafts(draftRef.current,previous.graph);
      const nextDrafts=retainSourceDrafts(previousDrafts,next.graph);
      const removedDrafts=Object.entries(previousDrafts).filter(([key])=>!nextDrafts[key]).map(([,draft])=>draft);
      past.current = [...past.current.slice(-69), {doc:previous, focus, keyHold,removedDrafts}];
    }
    future.current = [];
    replaceDoc(next);
    setSaveState('편집 중');
    if (text) setStatus(text);
  };
  const change = (next: Graph, text?: string, focus?: HistoryFocusChange, keyHold?:symbol) =>
    apply({ ...docRef.current, graph: updateSubgraph(docRef.current.graph, path, next) }, text, focus, keyHold);
  const flush = (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    if (pendingConnections.current.size) {
      const pending = [...pendingConnections.current.values()].map(connection => connection.done);
      return Promise.allSettled(pending).then(async results => {
        const saved = await flush();
        return saved && results.every(result => result.status === 'fulfilled');
      });
    }
    if (running.current) return running.current;
    if (fingerprint(docRef.current) === durable.current) return Promise.resolve(true);
    const persist = async () => {
      while (fingerprint(docRef.current) !== durable.current) {
        const snapshot = docRef.current;
        try {
          if (mounted.current) setSaveState('저장 중');
          await saveCallback.current(snapshot.graph, snapshot.title);
          durable.current = fingerprint(snapshot);
          if (snapshot === docRef.current) {
            const drafts = draftRef.current, remaining = retainSourceDrafts(drafts, snapshot.graph);
            for (const [key, draft] of Object.entries(drafts)) {
              if (remaining[key]) continue;
              const block = subgraph(snapshot.graph,draft.path).nodes.find(node=>node.id===draft.id);
              // A server-side change can invalidate the base while the local text still needs recovery.
              storeDraft(key,undefined,block?.type === 'resource.context' && block.config.content !== draft.text);
            }
          }
        } catch (error) {
          if (mounted.current) {
            setSaveState('저장 실패');
            setStatus(message(error));
          }
          return false;
        }
      }
      if (mounted.current) setSaveState('저장됨');
      return true;
    };
    running.current = persist().finally(() => {
      running.current = null;
    });
    return running.current;
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const {controller} of pendingConnections.current.values()) controller.abort();
      pendingConnections.current.clear();
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
  }, []);
  useEffect(() => {
    const nextProp = fingerprint({ graph, title });
    if (nextProp === lastProp.current) return;
    lastProp.current = nextProp;
    // Normal save callbacks can echo the saved graph while the user has typed the next edit.
    if (nextProp === fingerprint(docRef.current) || nextProp === durable.current || running.current)
      return;
    if (fingerprint(docRef.current) !== durable.current || hasSourceDrafts) {
      setStatus('다른 초안이 변경되었습니다. 현재 편집 내용을 저장한 뒤 버전을 확인하세요.');
      return;
    }
    const replacement = { graph: clone(graph), title };
    docRef.current = replacement;
    durable.current = nextProp;
    past.current = [];
    future.current = [];
    setDoc(replacement);
    setPath([]);
    setSelection(null);
    setSaveState('저장됨');
  }, [graph, title]);
  useEffect(() => {
    if (fingerprint(doc) === durable.current) {
      setSaveState('저장됨');
      return;
    }
    timer.current = setTimeout(() => {
      void flush();
    }, 950);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [doc]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (fingerprint(docRef.current) !== durable.current || unprotectedDrafts.current.size || pendingConnections.current.size) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  const undo = (forward = false) => {
    const source = forward ? future.current : past.current,
      target = forward ? past.current : future.current,
      next = source.pop();
    if (!next) return;
    const currentDrafts=retainSourceDrafts(draftRef.current,docRef.current.graph);
    const nextDrafts=retainSourceDrafts(currentDrafts,next.doc.graph);
    target.push({doc:docRef.current, focus:next.focus,removedDrafts:Object.entries(currentDrafts).filter(([key])=>!nextDrafts[key]).map(([,draft])=>draft)});
    for(const draft of next.removedDrafts??[])storeDraft(sourceDraftKey(draft.path,draft.id),draft);
    replaceDoc(next.doc);
    setSaveState('편집 중');
    if (next.focus) {
      const {path:where, before, after, undoText, redoText} = next.focus;
      const selected = forward ? after : before;
      setPath(where);
      setSelection(selected);
      setInspectorTab('properties');
      setPane('canvas');
      historyFocus.current = {item:selected};
      setStatus(forward ? redoText : undoText);
    } else {
      const restored = validEditorFocus(next.doc.graph, {path,selection});
      setPath(restored?.path ?? []);
      setSelection(restored?.selection ?? null);
      setStatus(forward ? '변경을 다시 실행했습니다.' : '변경을 취소했습니다.');
    }
  };
  useLayoutEffect(() => {
    const pending = historyFocus.current;
    if (pending) {
      historyFocus.current = null;
      if (pending.item?.kind === 'node') canvas.current?.revealNode(pending.item.id);
      if (pending.inspect && pending.item) {
        // The added block is now mounted and can receive focus when its properties close.
        inspectorFocus.opener.current = document.querySelector<HTMLElement>('[data-canvas-block="' + CSS.escape(pending.item.id) + '"]');
      } else {
        canvas.current?.focusItem(pending.item);
      }
    }
  }, [doc]);
  const discard = (target: Selection) => {
    if (target?.kind === 'node') {
      const index = workspace.nodes.findIndex(node => node.id === target.id);
      if (index < 0) return;
      const neighbor = workspace.nodes[index + 1] ?? workspace.nodes[index - 1];
      const edges = workspace.edges.filter(e => e.from !== target.id && e.to !== target.id);
      const wireCount = groups.filter(group => group.from === target.id || group.to === target.id).length;
      const description = '‘' + nodeTitle(workspace.nodes[index]) + '’ 블록' + (wireCount ? '과 연결선 ' + wireCount + '개를' : '을');
      change(
        {
          ...workspace,
          nodes: workspace.nodes.filter((n) => n.id !== target.id),
          edges,
        },
        '블록과 연결을 삭제했습니다.',
        {path, before:target, after:neighbor ? {kind:'node',id:neighbor.id} : null,
          undoText:description + ' 복구했습니다.', redoText:description + ' 다시 삭제했습니다.'},
      );
    } else if (target?.kind === 'edge') {
      const group = groups.find(g => g.id === target.id);
      if (!group) return;
      change(
        { ...workspace, edges: workspace.edges.filter((e) => groupKey(e.from, e.to) !== target.id) },
        '선택한 연결선을 삭제했습니다.',
        {path, before:target, after:{kind:'node',id:group.to},
          undoText:'선택한 연결선을 복구했습니다.', redoText:'선택한 연결선을 다시 삭제했습니다.'},
      );
    }
    setSelection(null);
  };
  const nav = async (action: () => void) => {
    if (await flush() && mounted.current) {
      if (unprotectedDrafts.current.size) setStatus('임시 보관하지 못한 원문이 있습니다. 이동 전에 프로젝트를 저장하세요.');
      else { action(); return true; }
    }
    return false;
  };
  const go = (destination: WorkspaceDestination) => {
    if (destination === 'editor') return;
    void nav(() => {
      if (destination === 'guide' && practice === 'example') onLessonGuide(coachRef.current?.guideStep());
      else if (onNavigate) onNavigate(destination);
      else onHome();
    }).then(moved => {
      if (!moved && mounted.current) setDrawer(false);
    });
  };
  function startGuidePractice(practice: 'example' | 'blank') {
    void nav(() => onGuidePractice(practice));
  }
  function openNextLesson(id: string) {
    void nav(() => onOpenTemplate(id));
  }
  const selectInspectorTab = (tab: InspectorTab, trigger?: HTMLElement | SVGElement) => {
    setOverview(false);
    inspectorFocus.rememberOpener(trigger);
    if (tab === 'results') {
      if (inspectorTab !== 'results' || trigger) setReviewedSources(null);
      setRunOpened(true);
    }
    setInspectorTab(tab);
    setPane('inspector');
  };
  const chooseTestSource = (edited: boolean) => {
    if (edited) {
      const current = docRef.current;
      const prepared = prepareSourceSave(current.graph, draftRef.current);
      if (prepared.invalid) return;
      apply({ ...current, graph: prepared.graph }, '수정한 원문을 시험 초안에 적용했습니다.');
    }
    setReviewedSources(sourceDrafts);
    setSourceChoice(value => value + 1);
    document.getElementById('ws-tab-results')?.focus();
  };
  const saveProject = async () => {
    const attempt = ++saveAttempt.current;
    const current = docRef.current;
    const { graph, invalid } = prepareSourceSave(current.graph, draftRef.current);
    if (invalid) {
      setPath(invalid.path);
      setSelection({ kind: 'node', id: invalid.id });
      selectInspectorTab('properties');
      setStatus('저장하려면 자료 원문을 입력하세요.');
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.ws-source-editor textarea')?.focus());
      return false;
    }
    if (graph !== current.graph) apply({ ...current, graph });
    if (!await flush() || !mounted.current || attempt !== saveAttempt.current) return false;
    setStatus('최신 설계를 저장했습니다.');
    return true;
  };
  const reopenDraft = async () => {
    if (!onReopenDraft || reopening) return;
    setReopening(true);
    try {
      await onReopenDraft();
    } finally {
      if (mounted.current) setReopening(false);
    }
  };
  useImperativeHandle(saveDraftRef, () => (includeEdited = true) => includeEdited ? saveProject() : flush());
  const launchRun = (trigger: HTMLButtonElement) => {
    selectInspectorTab('results', trigger);
    if (!inspectorFocus.mobile) requestAnimationFrame(() => document.getElementById('ws-tab-results')?.focus());
  };
  const closeInspector = () => {
    if (!inspectorFocus.mobile) {
      setInspectorTab('properties');
      inspectorFocus.restoreFocus('inspector');
    }
    setPane('canvas');
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented || dialog || connection || drawer || reopening || (event.target instanceof Element && event.target.closest('dialog'))) return;
      if (event.key === 'Escape' && pane === 'palette' && inspectorFocus.palette.current?.contains(document.activeElement)) {
        event.preventDefault();
        if (!inspectorFocus.paletteModal) inspectorFocus.restoreFocus('palette');
        setPane('canvas');
        return;
      }
      if (event.key === 'Escape' && (overlayOpen || inspectorFocus.panel.current?.contains(document.activeElement))) {
        event.preventDefault();
        if (inspectorFocus.paletteModal) setPane('canvas');
        else {
          if (!inspectorFocus.mobile && selection?.kind === 'edge') setSelection(null);
          closeInspector();
        }
        return;
      }
      const input = (event.target as HTMLElement | null)?.closest(
        'input,textarea,select,[contenteditable="true"]',
      );
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveProject();
        return;
      }
      if (input) return;
      if (overview && event.key === 'Escape' && !wireChoices.length) {
        event.preventDefault();
        closeOverview();
        return;
      }
      if (event.key !== 'Escape' && event.target instanceof Element && event.target.closest('#ws-panel-results, #ws-tab-results')) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')
      ) {
        event.preventDefault();
        undo(event.shiftKey || event.key.toLowerCase() === 'y');
      } else if (event.key === 'Escape') {
        if (pane === 'canvas' && selection?.kind === 'edge') setSelection(null);
        setPane('canvas');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  const inspect = (trigger?: HTMLElement | SVGElement, focusTab = true) => {
    setOverview(false);
    inspectorFocus.rememberOpener(trigger);
    setInspectorTab('properties');
    setPane(inspectorFocus.mobile ? 'inspector' : 'canvas');
    if (focusTab && !inspectorFocus.mobile) requestAnimationFrame(() => {
      if (!document.querySelector('dialog:modal')) document.getElementById('ws-tab-properties')?.focus();
    });
  };
  const add = (type: string, config?: Block['config']) => {
    const n = workspace.nodes.length;
    const node = placeNewBlock(
      createBlock(type, { x: 50 + (n % 3) * 210, y: 60 + Math.floor(n / 3) * 135, config }),
      workspace.nodes,
    );
    const item:Selection = {kind:'node', id:node.id};
    change({ ...workspace, nodes: [...workspace.nodes, node] }, node.title + ' 블록을 추가했습니다.',
      {path, before:selection ?? (workspace.nodes[0] ? {kind:'node',id:workspace.nodes[0].id} : null), after:item,
        undoText:node.title + ' 추가를 취소했습니다.', redoText:node.title + ' 블록을 다시 추가했습니다.'});
    setSelection(item);
    historyFocus.current = {item, inspect:true};
    inspect();
  };
  const duplicateBlock = (sourceText?:string) => {
    if (!chosen) return;
    const copy = placeNewBlock({
      ...clone(chosen), id:uniqueId(), title:chosen.title + ' 사본', x:chosen.x + 30, y:chosen.y + 100,
    },workspace.nodes);
    if (sourceText !== undefined) copy.config.content = sourceText;
    const item:Selection = {kind:'node', id:copy.id};
    change({...workspace, nodes:[...workspace.nodes, copy]}, copy.title + '을 만들었습니다.',
      {path, before:{kind:'node', id:chosen.id}, after:item,
        undoText:chosen.title + ' 복제를 취소했습니다.', redoText:copy.title + '을 복구했습니다.'});
    setDialog(null);
    setPane('canvas');
    setInspectorTab('properties');
    setSelection(item);
    historyFocus.current = {item};
  };
  const discardPair = (from:string, to:string) => {
    discard({kind:'edge', id:groupKey(from,to)});
    const item = {kind:'node', id:to} as const;
    setSelection(item);
    setPane('canvas');
    historyFocus.current = {item};
  };
  const connect = (from: string, to?: string, routeId?: string) => {
    if (to) {
      if (routeId && workspace.edges.some(e => e.from === from && e.to === to && e.kind === 'flow' && e.out === routeId)) {
        setSelection({ kind: 'edge', id: groupKey(from, to) });
        setStatus('이미 연결된 경로입니다.');
        return;
      }
      const options = connectionOptions(workspace, from, to, routeId);
      const defaults = options.filter((o) => o.automatic);
      const fromNode = workspace.nodes.find((n) => n.id === from);
      const isRef =
        fromNode &&
        ['instruction.skill', 'resource.context', 'connection.mcp', 'workflow.tool'].includes(
          fromNode.type,
        );
      const needsChoice = options.some(
        (o) =>
          !o.automatic &&
          !(
            o.kind === 'data' &&
            o.input === 'question' &&
            defaults.some((d) => d.kind === 'data' && d.input === 'input' && d.out === o.out)
          ) &&
          !(isRef && o.kind === 'data' && defaults.some((d) => d.kind === 'reference')),
      );
      if (defaults.length && !needsChoice) {
        const edges = connectBlocks(workspace, from, to, defaults);
        if (edges.length) {
          change({ ...workspace, edges: [...workspace.edges, ...edges] }, '블록을 연결했습니다.');
          setSelection({ kind: 'edge', id: groupKey(from, to) });
          return;
        }
      }
    }
    setConnection({ from, to, routeId });
  };
  const addSource = (target: Block, input: string, type: string) => {
    if (target.type === 'quality.evidence' && input === 'input' && type === 'knowledge.search') {
      const {graph, search} = insertEvidenceSearch(workspace,target);
      change(graph,'자료 검색 블록을 추가하고 연결했습니다.');
      setConnection(null);
      setSelection({kind:'node',id:search.id});
      inspect();
      return;
    }
    const source = placeNewBlock(createBlock(type, {x:Math.max(24,target.x - 240), y:target.y}), workspace.nodes);
    const next = {...workspace, nodes:[...workspace.nodes, source]};
    const needsStart = !workspace.edges.some(edge => edge.to === target.id && edge.kind === 'flow');
    const options = connectionOptions(next,source.id,target.id).filter(option =>
      option.input === input || (needsStart && option.kind === 'flow' && option.automatic));
    if (!options.some(option => option.input === input)) return;
    const edges = connectBlocks(next,source.id,target.id,options);
    change({...next, edges:[...workspace.edges, ...edges]}, source.title + ' 블록을 추가하고 연결했습니다.');
    setConnection(null);
    setSelection({kind:'edge', id:groupKey(source.id,target.id)});
    inspect();
  };
  const attach = (id: string, asset: AssetOption, replaceSource = false): Promise<void> => {
    // A reference block takes one edition. A work block can receive several independent links.
    const key = JSON.stringify([path, id, replaceSource ? 'source' : [asset.id, asset.version]]);
    const previous = pendingConnections.current.get(key);
    if (previous && !replaceSource) return previous.done;
    previous?.controller.abort();
    const controller = new AbortController();
    const original = workspace.nodes.find(node => node.id === id);
    const connect = async () => {
      let edition = asset;
      if (asset.kind !== 'mcp') {
        setStatus(asset.name + ' ' + asset.version + '판의 연결 권한을 확인하고 있습니다.');
        const current = await api<{asset:{name:string}; version:number}>(
          'asset.read', {id:asset.id, version:asset.version}, controller.signal);
        edition = {...asset, name:current.asset.name, version:current.version};
      }
      if (controller.signal.aborted || !mounted.current) return;
      const currentDoc = docRef.current;
      const scope = subgraph(currentDoc.graph, path);
      const target = scope.nodes.find(node => node.id === id);
      if (!target || target.type !== original?.type) throw Error('자료를 연결할 블록이 삭제되거나 변경되었습니다.');
      let next:Graph;
      if (replaceSource) {
        if (target.config.assetId !== original.config.assetId || target.config.version !== original.config.version)
          throw Error('블록의 자료판이 변경되었습니다. 연결할 판을 다시 선택하세요.');
        next = {...scope, nodes:scope.nodes.map(node => node === target
          ? {...node, config:{...node.config, assetId:edition.id, version:edition.version, assetGrant:undefined}} : node)};
      } else {
        next = attachAssetEdition(scope, id, edition).graph;
      }
      if (next === scope) setStatus('이미 연결한 자료판입니다.');
      else apply({...currentDoc, graph:updateSubgraph(currentDoc.graph, path, next)},
        edition.name + ' ' + edition.version + '판을 ‘' + target.title + '’에 연결했습니다.');
    };
    const done = connect().catch(error => {
      if (!controller.signal.aborted && mounted.current) {
        setStatus(asset.name + ' 연결 실패 · ' + message(error));
        throw error;
      }
    }).finally(() => {
      if (pendingConnections.current.get(key)?.controller === controller) pendingConnections.current.delete(key);
    });
    pendingConnections.current.set(key, {controller, done});
    return done;
  };
  const attachShared = (asset: SharedAssetPin, target?:AssetTarget) => {
    const current = docRef.current;
    const next = attachWorkflowAsset(current.graph, asset, target);
    const item: Selection = {kind:'node', id:next.source.id};
    const label = asset.name + ' ' + asset.version + '판';
    setDialog(null);
    setPane('canvas');
    setInspectorTab('properties');
    setPath(next.path);
    setSelection(item);
    if (next.graph === current.graph) {
      setStatus(label + '은 이미 이 블록에 연결되어 있습니다.');
      requestAnimationFrame(() => { canvas.current?.revealNode(item.id); canvas.current?.focusItem(item); });
    } else {
      historyFocus.current = {item};
      apply({...current, graph:next.graph}, label + '을 ‘' + next.targetTitle + '’에 연결했습니다.',
        {path:next.path, before:target ? {kind:'node', id:target.id} : selection, after:item,
          undoText:label + ' 연결을 취소했습니다.', redoText:label + '을 다시 연결했습니다.'});
    }
  };
  const openChild = (id: string) => {
    const node = workspace.nodes.find((n) => n.id === id);
    if (!node) return;
    if (canvas.current) parentViews.current.set(JSON.stringify(path), {bookmark: canvas.current.bookmark(), list});
    const childPath = [...path, id];
    const remembered = listPositions.current.get(JSON.stringify(childPath));
    const previous = validEditorFocus(doc.graph,{path:childPath,selection:remembered?.selection})?.selection;
    const first = subgraph(doc.graph, childPath).nodes[0];
    const next = previous ?? (first ? {kind:'node' as const,id:first.id} : null);
    setCanvasReturn({scope:JSON.stringify(childPath), id:next?.id ?? ''});
    setOverview(false);
    setPath(childPath);
    setSelection(next);
    setPane('canvas');
  };
  const returnToParent = () => {
    const id = path[path.length - 1];
    const parent = path.slice(0, -1);
    const previous = parentViews.current.get(JSON.stringify(parent));
    if (previous) setList(previous.list);
    setCanvasReturn({scope: JSON.stringify(parent), id, bookmark: previous?.bookmark});
    setPath(parent);
    setSelection({kind: 'node', id});
    setPane('canvas');
  };
  const propose = async () => {
    if (!prompt.trim() || thinking || (needsChangeAnswer && !clarificationAnswer.trim())) return;
    const request = ++aiRequest.current,
      root = docRef.current.graph,
      base = subgraph(root, path);
    setRequestedProposal(true);
    setThinking(true);
    setAiError('');
    setProposal(null);
    try {
      const next = await onPropose(prompt.trim(), clone(base), clarificationAnswer?.trim());
      if (request !== aiRequest.current) return;
      if ('clarification' in next) {
        if (needsChangeAnswer) throw new Error('보충 답변에 현재 설계로 만들거나 바꿀 일을 구체적으로 적어 주세요.');
        setClarificationAnswer('');
      } else {
        const graph = updateSubgraph(root, path, preservePositions(next.graph, base));
        const issues = validateGraph(graph).map(issue => proposalIssue(graph, issue));
        setProposal({graph, base:JSON.stringify(root), scope, prompt, issues});
      }
    } catch (error) {
      if (request === aiRequest.current) setAiError(message(error));
    } finally {
      if (request === aiRequest.current) setThinking(false);
    }
  };
  const closeAi = () => {
    aiRequest.current++;
    setThinking(false);
    setProposal(null);
    setDialog(null);
  };
  useEditorHistory(historyRef, {
    // An open panel remains the same history entry when a resize docks it beside the canvas.
    project:project.id, path, selection, pane,
    tab:inspectorTab, pendingRun, list, dialog, connection, wireChoices, wireSource:wireChoices.length ? wireSource : undefined, drawer,
  }, scope => JSON.stringify(scope) === JSON.stringify(path) ? canvas.current?.bookmark() :
    parentViews.current.get(JSON.stringify(scope))?.bookmark, destination => {
    const restored = validEditorFocus(docRef.current.graph, destination);
    if (!restored) return;
    const scope = JSON.stringify(restored.path);
    const sameScope = scope === JSON.stringify(path);
    const camera = canvas.current?.bookmark();
    if (!sameScope && camera) parentViews.current.set(JSON.stringify(path),{bookmark:camera,list});
    const previous = parentViews.current.get(scope);
    const parentId = path[restored.path.length];
    const goingUp = !sameScope && !!parentId && restored.path.every((id,i) => path[i] === id) &&
      subgraph(docRef.current.graph, restored.path).nodes.some(node => node.id === parentId);
    const nextSelection:Selection = goingUp ? {kind:'node', id:parentId} : restored.selection;
    if (!sameScope) {
      setCanvasReturn({scope, id:nextSelection?.id ?? '', bookmark:previous?.bookmark ?? destination.bookmark});
      setPath(restored.path);
    }
    setList(!sameScope && previous ? previous.list : destination.list);
    setOverview(false);
    if (sameScope && pane === 'inspector' && destination.pane === 'canvas' && nextSelection &&
        !inspectorFocus.opener.current?.isConnected) {
      const attribute = nextSelection.kind === 'node' ? 'data-canvas-block' : 'data-canvas-wire';
      inspectorFocus.opener.current = document.querySelector<HTMLElement|SVGElement>('[' + attribute + '="' + CSS.escape(nextSelection.id) + '"]');
    }
    setSelection(nextSelection);
    setPane(destination.pane);
    setInspectorTab(destination.tab);
    if (destination.tab === 'results') setRunOpened(true);
    if (dialog === 'ai' && destination.dialog !== 'ai') closeAi();
    setDialog(destination.dialog === 'attach-shared' && !sharedAsset ? null : destination.dialog);
    setConnection(destination.connection);
    const groups = groupEdges(subgraph(docRef.current.graph,restored.path));
    const choices = destination.wireChoices?.filter(id => groups.some(group => group.id === id));
    setWireChoices(choices && choices.length > 1 ? choices : []);
    setWireSource(destination.wireSource);
    setDrawer(!!destination.drawer);
  });
  const openAi = () => {
    setRequestedProposal(false);
    setAiError('');
    setProposal(null);
    setDialog('ai');
  };
  const editPrompt = (value: string, followUp = false) => {
    aiRequest.current++;
    setThinking(false);
    setProposal(null);
    setAiError('');
    if (followUp) setClarificationAnswer(value);
    else {
      setPrompt(value);
      setClarificationAnswer(undefined);
    }
  };
  const proposalMatches = proposal && proposal.scope === scope && proposal.prompt === prompt && JSON.stringify(doc.graph) === proposal.base;
  const applyProposal = () => {
    if (!proposal || proposal.scope !== scope || proposal.prompt !== prompt || JSON.stringify(docRef.current.graph) !== proposal.base) return;
    apply({ ...docRef.current, graph: proposal.graph }, 'AI 제안을 적용했습니다. 한 번에 되돌릴 수 있습니다.');
    if (needsChangeAnswer) {
      setPrompt('');
      setClarificationAnswer(undefined);
    }
    setSelection(validEditorFocus(proposal.graph, {path, selection})?.selection ?? null);
    closeAi();
    setLayoutRev(v => v + 1);
  };
  const exportGraph = (includeEdited = false) => {
    const prepared = includeEdited ? prepareSourceSave(doc.graph, sourceDrafts) : {graph:doc.graph};
    if ('invalid' in prepared && prepared.invalid) return;
    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify({ format: 'workflow-studio-v1', title: doc.title, graph: prepared.graph }, null, 2)],
        { type: 'application/json' },
      ),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = (doc.title.replace(/[\\/:*?"<>|]/g, '-') || 'Workflow') + '.json';
    a.click();
    setDialog(null);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importGraph = async () => {
    const check=++importCheck.current;
    setImportError('');
    try {
      const source = JSON.parse(importText),
        raw = source.graph ?? source;
      if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges))
        throw Error('블록과 연결선 목록을 포함한 설계 JSON이 필요합니다.');
      const graph=migrateGraph(raw);
      if(importWarning?.text!==importText){
        const missing=await api<string[]>('project.inspectImport',{id:project.id,graph});
        if(check!==importCheck.current)return;
        if(missing.length){setImportWarning({text:importText,missing});return;}
      }
      apply(
        { graph, title: typeof source.title === 'string' ? source.title : doc.title },
        '설계를 가져왔습니다.',
      );
      setImportWarning(undefined);
      setPath([]);
      setSelection(null);
      setDialog(null);
      setLayoutRev((v) => v + 1);
    } catch (e) {
      if(check===importCheck.current)setImportError(message(e));
    }
  };
  const openMenuAction = (action: WorkspaceMenuAction) => {
    if (action === 'import') {
      importCheck.current++;
      setImportText('');
      setImportError('');
      setImportWarning(undefined);
    }
    setDialog(action);
  };
  const [issueField, setIssueField] = useState<string>();
  useLayoutEffect(() => {
    if (!issueField) return;
    const field = inspectorFocus.panel.current?.querySelector<HTMLElement>('[data-field-key="' + CSS.escape(issueField) + '"]');
    const details = field?.closest('details');
    if (details) details.open = true;
    field?.querySelector<HTMLElement>('input,textarea,select')?.focus();
    setIssueField(undefined);
  }, [issueField, inspectorFocus.panel]);
  const openIssue = (issue: Issue) => {
    const id = issue.edgeId ?? issue.nodeId;
    if (!id) {
      setPath(issue.path ?? []);
      setSelection(null);
      setDialog(null);
      showPalette();
      return;
    }
    const location = issue.path ?? locate(doc.graph, id);
    if (!location) return;
    const scope = subgraph(doc.graph, location);
    const group = scope.edges.find((e) => e.id === id);
    setPath(location);
    setSelection(group ? { kind: 'edge', id: groupKey(group.from, group.to) } : { kind: 'node', id });
    setDialog(null);
    const node = scope.nodes.find((n) => n.id === id);
    const fieldKey = issue.fieldKey ?? (node && byType.get(node.type)?.fields.find(f => issue.message.includes(f.label))?.key);
    inspect(undefined, !fieldKey);
    if (!node) return;
    if (node.type === 'quality.evidence' && issue.message.includes('자료 검색')) return;
    if (issue.routeId) {
      setConnection({ from: node.id, routeId: issue.routeId });
      return;
    }
    const missing = portsFor(node).inputs.find(
      (p) =>
        p.required &&
        issue.message.includes(p.label) &&
        !scope.edges.some((e) => e.to === node.id && e.input === p.id && e.kind === p.kind),
    );
    if (missing) {
      setConnection({ to: node.id, input: missing.id });
      return;
    }
    if (fieldKey) setIssueField(fieldKey);
  };
  const pendingInitialIssue = useRef(initialIssue);
  useEffect(() => {
    if (pendingInitialIssue.current) {
      openIssue(pendingInitialIssue.current);
      pendingInitialIssue.current = undefined;
    }
  });
  const openPalette = (catalog:boolean) => {
    setOverview(false);
    const active = document.activeElement;
    if (active instanceof HTMLElement || active instanceof SVGElement) inspectorFocus.paletteOpener.current = active;
    setShowCatalog(catalog);
    setPane('palette');
    requestAnimationFrame(() => {
      const field = inspectorFocus.palette.current?.querySelector<HTMLInputElement>('input[type=search]');
      field?.focus();
      if (!catalog) field?.select();
    });
  };
  const showPalette = () => openPalette(true);
  const goToFoundBlock = (id:string) => {
    const item = {kind:'node', id} as const;
    setPane('canvas');
    setInspectorTab('properties');
    setSelection(item);
    requestAnimationFrame(() => {
      canvas.current?.focusItem(item);
      canvas.current?.revealNode(id);
    });
  };
  const parentBlock = path.length
    ? subgraph(doc.graph, path.slice(0, -1)).nodes.find(node => node.id === path[path.length - 1])
    : undefined;
  const coach = practice && <PracticeCoach ref={coachRef} practice={practice} projectId={project.id} userId={user.id}
    hasExampleAnswer={Boolean(project.hasExampleAnswer || answeredInEditor)}
    onOpenGuide={() => go('guide')} onStartBlank={() => startGuidePractice('blank')} onOpenTemplate={openNextLesson} />;
  const coachInCanvas = inspectorFocus.mobile && !overlayOpen && Boolean(coach);
  return (
    <div className="studio-shell" inert={reopening}>
      {!overlayOpen && !drawer && <button type="button" className="ws-skip-to-canvas" onClick={() => {
        const item = selection ?? (workspace.nodes[0] ? {kind:'node', id:workspace.nodes[0].id} as const : null);
        canvas.current?.focusItem(item);
        if (item?.kind === 'node') canvas.current?.revealNode(item.id);
      }}>캔버스로 바로 가기</button>}
      <WorkspaceNav
        active="editor"
        inert={overlayOpen}
        user={user}
        open={drawer}
        onClose={() => setDrawer(false)}
        onNavigate={go}
        onMenuAction={openMenuAction}
        onAccount={() => void nav(onAccount)}
      />
      <main id="workspace-content" tabIndex={-1} className="ws-editor" data-pane={pane} data-overview={overview || undefined}>
        <header className="ws-top" inert={overlayOpen}>
          <WorkspaceMenuButton open={drawer} onOpen={() => setDrawer(true)} />
          <button className="ws-crumb" aria-label="내 워크스페이스" onClick={() => go('projects')}>
            <span className="ws-crumb-full">내 워크스페이스</span><span className="ws-crumb-short">작업실</span>
          </button>
          <span aria-hidden="true">›</span>
          <strong>Workflow 편집기</strong>
          <span className={'ws-save-badge' + (saveState === '저장 실패' ? ' ws-danger' : '')} role="status">
            {saveState === '저장됨' && hasSourceDrafts ? '원문 편집 중' : saveState}
          </span>
          <div className="ws-history">
            <ToolButton icon="undo" label="실행 취소" onClick={() => undo()} disabled={!past.current.length} />
            <ToolButton icon="redo" label="다시 실행" onClick={() => undo(true)} disabled={!future.current.length} />
          </div>
          <ProjectMenu
            onSave={() => void saveProject()}
            onScope={() => setDialog('scope')}
            onVersions={() => void nav(onVersions)}
            onShare={() => void nav(onShare)}
            onExport={async () => {
              let last:TestSources|null;
              try { last=await api<TestSources|null>('run.lastTestSources',{id:project.id}); }
              catch(error) { setStatus(message(error)); return; }
              setTestedSources(last);
              if (!hasSourceDrafts && !last) {
                exportGraph();
                return;
              }
              setExportEdited(false);
              setDialog('export');
            }}
          />
        </header>
        <section className="ws-toolbar" aria-label="프로젝트 작업" inert={overlayOpen}>
          <div className="ws-identity">
            <h1>
              <button
                title="이름 변경"
                onClick={() => {
                  setName(doc.title);
                  setDialog('name');
                }}
              >
                {doc.title || '이름 없는 Agent'}
              </button>
            </h1>
            <div className="ws-authoring-actions">
              <ToolButton icon="spark" onClick={openAi}>AI 설계</ToolButton>
              <ToolButton icon="play" primary onClick={event => launchRun(event.currentTarget)}>시험 실행</ToolButton>
              <ToolButton icon="export" onClick={() => setDialog('agent-export')}>Agent 내보내기</ToolButton>
            </div>
          </div>
          <div className="ws-actions">
            {lesson?.task && <p className="ws-task">{lesson.task}</p>}
            <div className="ws-controls">
              {lesson && <ToolButton icon="book" label="실습 안내" onClick={() => void nav(() => onLessonGuide(practice === 'example' ? coachRef.current?.guideStep() : undefined))}>실습 안내</ToolButton>}
              <ToolButton icon="shield" onClick={() => setDialog('issues')}>설계 검사</ToolButton>
            </div>
          </div>
          {showRestoreNotice && onReopenDraft && <div className="ws-restore-notice">
            <span role="status">복원했습니다. 직전 초안을 보관했습니다.</span>
            <button className="ws-btn" type="button" onClick={() => void reopenDraft()}>직전 초안 다시 열기</button>
            <button className="ws-icon-button" type="button" aria-label="복원 안내 닫기" onClick={() => setShowRestoreNotice(false)}>
              <Icon name="close" />
            </button>
          </div>}
        </section>
        <div className="ws-workbench">
          <Palette level={level} tab={paletteTab} onTab={setPaletteTab} onAdd={add}
            panelRef={inspectorFocus.palette} modal={inspectorFocus.paletteModal} inert={inspectorFocus.modal}
            practiceCoach={inspectorFocus.paletteModal ? coach : undefined}
            graph={workspace} selection={selection} showCatalog={showCatalog} onShowCatalog={setShowCatalog}
            onFind={goToFoundBlock}
            onPick={id => {
              canvas.current?.revealNode(id);
              setSelection({kind:'node',id});
              inspect();
            }} onClose={() => setPane('canvas')} />
          <section className={'ws-stage' + (coachInCanvas ? ' ws-stage-with-coach' : '')} inert={overlayOpen} onKeyDown={event => {
            if (!['?', '/'].includes(event.key) || event.defaultPrevented || event.repeat || event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey || dialog || connection || wireChoices.length ||
              !(event.target instanceof Element) || event.target.closest('dialog,[role="dialog"],[data-practice-coach],input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
            event.preventDefault();
            if (event.key === '?') setDialog('shortcuts');
            else openPalette(false);
          }}>
            {coachInCanvas && coach}
            <div className="ws-canvas-head ws-canvas-tools">
              <div className="ws-graph-crumb">
                {path.length > 0 && (
                  <button
                    className="ws-icon-button"
                    aria-label="상위 Workflow로"
                    onClick={returnToParent}
                  >
                    <Icon name="back" size={14} />
                  </button>
                )}
                <Icon name="workflow" size={15}/>
                <h2>{overview ? '연결도 전체 보기' : path.length ? parentBlock?.title ?? '내부 설계' : '워크플로 캔버스'}</h2>
              </div>
              <div className="ws-controls">
                <button type="button" className="ws-icon-button" aria-label="키보드 단축키" aria-haspopup="dialog"
                  title="키보드 단축키 (?)" aria-keyshortcuts="Shift+/" onClick={() => setDialog('shortcuts')}>
                  <Icon name="keyboard" />
                </button>
                <button className="ws-btn ws-mobile-palette" onClick={showPalette} aria-haspopup="dialog">
                  <Icon name="plus" />
                  블록
                </button>
                <button
                  className="ws-btn"
                  title="자동 정렬"
                  disabled={!workspace.nodes.length}
                  onClick={() => {
                    change(arranged(workspace), '블록을 자동 정렬했습니다.');
                    const anchor = selection?.kind === 'node' ? selection.id
                      : groups.find(group => group.id === selection?.id)?.from ?? workspace.nodes[0]?.id;
                    if (anchor) {
                      if (!selection) setSelection({kind:'node',id:anchor});
                      requestAnimationFrame(() => canvas.current?.revealNode(anchor));
                    }
                  }}
                >
                  <Icon name="grid" />
                  <span>자동 정렬</span>
                </button>
                <button className="ws-btn ws-mobile-properties" title="속성 열기" ref={inspectorFocus.fallback}
                  aria-haspopup="dialog" onClick={event => inspect(event.currentTarget)}>
                  <Icon name="settings" />
                </button>
              </div>
              <div className="ws-viewbar">
                <div className="ws-view-modes" role="group" aria-label="캔버스 보기 방식">
                  <button type="button" aria-pressed={list && !overview} title="목록으로 편집" onClick={() => chooseView(true)}>
                    <Icon name="list" size={16}/><span>목록으로 편집</span>
                  </button>
                  <button type="button" aria-pressed={!list && !overview} title="캔버스로 보기" onClick={() => chooseView(false)}>
                    <Icon name="workflow" size={16}/><span>캔버스로 보기</span>
                  </button>
                </div>
                {overview
                  ? <button className="ws-return-view" type="button" ref={overviewExit} onClick={closeOverview} aria-label="편집기로 돌아가기"><Icon name="back" size={16}/><span>편집기로<span className="ws-return-tail"> 돌아가기</span></span></button>
                  : <button className="ws-return-view" type="button" ref={overviewTrigger} disabled={!workspace.nodes.length} onClick={openOverview} title="전체 보기"><Icon name="fit" size={16}/>전체 보기</button>}
              </div>
            </div>
            <Canvas
              key={scope}
              ref={canvas}
              initialListPosition={listPositions.current.get(scope)}
              onListPosition={position => listPositions.current.set(scope,position)}
              returning={canvasReturn?.scope === JSON.stringify(path) ? canvasReturn : undefined}
              graph={workspace}
              materialSources={materialSources}
              wireChoices={wireChoices}
              wireSource={wireSource}
              onWireChoicesChange={(ids,source) => {setWireChoices(ids); setWireSource(source);}}
              selection={selection}
              list={list && !overview}
              overview={overview}
              onSelect={next => {
                setSelection(next);
                if (next) setInspectorTab('properties');
              }}
              onInspect={inspect}
              onDeleteBlock={id => discard({kind:'node', id})}
              onAdd={showPalette}
              onConnect={connect}
              revision={layoutRev}
              onMove={(id, pos, keyHold) =>
                change({
                  ...workspace,
                  nodes: workspace.nodes.map((n) => (n.id === id ? { ...n, ...pos } : n)),
                }, undefined, undefined, keyHold)
              }
            />
          </section>
          <div className="ws-inspector" ref={inspectorFocus.panel} inert={inspectorFocus.paletteModal} role={inspectorFocus.modal ? 'dialog' : 'complementary'}
            aria-modal={inspectorFocus.modal || undefined} aria-label="속성 패널">
            <InspectorTabs selected={inspectorTab} onSelect={selectInspectorTab} onClose={closeInspector}/>
            {!coachInCanvas && !inspectorFocus.paletteModal && coach}
            <div id="ws-panel-properties" role="tabpanel" aria-labelledby="ws-tab-properties"
              className="ws-properties-content" hidden={inspectorTab !== 'properties'}>
              <Inspector
                rootScope={path.length === 0}
                key={JSON.stringify(path)}
                showExpertTools={level === '전문가' || paletteTab === 'all'}
                graph={workspace}
                selection={selection}
                agentContext={agentContextAt(doc.graph, path)}
                sourceDraftText={sourceKey ? sourceDrafts[sourceKey]?.text : undefined}
                onSaveReference={project.lesson === 'beginner' && !path.length && chosen?.id === 'rules' ? onSaveReference : undefined}
                onSourceEdit={editSource}
                sourceRecoveries={recoveries}
                onRecoverSource={text=>editSource(text,true)}
                assets={assets}
                materialLesson={!path.length && lesson?.optionalPractice && (lesson.id === 'peer-review' || lesson.id === 'dynamic' || lesson.id === 'beginner') ? lesson.id : undefined}
                onRefreshAssets={onRefreshAssets}
                inheritedConnectors={inheritedConnectors}
                inheritedTools={inheritedTools}
                onChange={change}
                onSelect={setSelection}
                onOpen={openChild}
                onDelete={() => {
                  const pair = selection?.kind === 'edge' && groups.find(group => group.id === selection.id);
                  if (pair) discardPair(pair.from,pair.to);
                  else discard(selection);
                }}
                onConnect={connect}
                onEditConnection={(from,to,edit) => setConnection({from,to,edit})}
                onIncoming={(to, input) => setConnection({ to, input })}
                onAttach={attach}
                onCopy={() => sourceKey && sourceDrafts[sourceKey] ? setDialog('copy-source') : duplicateBlock()}
              />
            </div>
            <div id="ws-panel-results" role="tabpanel" aria-labelledby="ws-tab-results" hidden={inspectorTab !== 'results'}>
              {needsSourceChoice && <SourceTestChoice graph={doc.graph} drafts={sourceDrafts} onChoose={chooseTestSource}/>}
              {runOpened && <div hidden={needsSourceChoice}><RunPanel project={project} api={api} initialInput={lesson?.question}
                initialPendingRun={resumeRun} onPendingRunChange={setPendingRun}
                onExampleAnswer={practice === 'example' ? recordExampleAnswer : undefined}
                editorDraft={{ graph: doc.graph, active: inspectorTab === 'results' && !needsSourceChoice, sourceChoice, save: flush,getDraftRevision,
                  issue: issues[0]?.message, onInspectIssues: () => setDialog('issues') }}/></div>}
            </div>
          </div>
        </div>
        <footer className="ws-footer">
          <span role="status">
            <Icon name="info" size={14} />
            {status ?? (hasSourceDrafts ? '자료 원문을 편집하고 있습니다.' : '자료 원문 편집을 마쳤습니다.')}
          </span>
          <span>
            {workspace.nodes.length}개 블록 · {groups.length}개 연결선
          </span>
        </footer>
        {pane !== 'canvas' && (
          <button className="ws-shade" aria-label="캔버스로 돌아가기" tabIndex={overlayOpen ? -1 : undefined}
            onClick={() => setPane('canvas')} />
        )}
        {connection?.edit === 'conditions' && connection.from && connection.to && (
          <FlowConditionsModal key={JSON.stringify(connection)} graph={workspace} from={connection.from} to={connection.to}
            onClose={() => setConnection(null)} onApply={(added,removed) => {
              const {from,to} = connection;
              if (!from || !to) return;
              const edges = [...workspace.edges.filter(edge => !removed.has(edge.id)), ...added];
              if (edges.some(edge => edge.from === from && edge.to === to)) {
                change({...workspace,edges},'실행 조건을 변경했습니다.');
              } else discardPair(from,to);
              setConnection(null);
            }}/>
        )}
        {connection && connection.edit !== 'conditions' && (
          <ConnectionModal
            key={JSON.stringify(connection)}
            graph={workspace}
            {...connection}
            transfersOnly={connection.edit === 'transfers'}
            onAddSource={addSource}
            onClose={() => {
              const input = connection.input;
              setConnection(null);
              // A design-check shortcut opens this dialog after its own trigger has unmounted.
              if (input) requestAnimationFrame(() =>
                inspectorFocus.panel.current?.querySelector<HTMLElement>('[data-receive-input="' + CSS.escape(input) + '"]')?.focus());
            }}
            onCommit={(edges) => {
              if (!edges.length) return;
              const target = workspace.nodes.find((n) => n.id === edges[0].to)!;
              const replaced = edges.filter(
                (e) =>
                  !portsFor(target).inputs.find((p) => p.kind === e.kind && p.id === e.input)?.multiple,
              );
              const kept = workspace.edges.filter(
                (prev) =>
                  !replaced.some(
                    (next) => next.to === prev.to && next.input === prev.input && next.kind === prev.kind,
                  ),
              );
              change({ ...workspace, edges: [...kept, ...edges] }, connection.edit === 'transfers' ? '전달 항목을 적용했습니다.' : '블록을 연결했습니다.');
              setSelection({ kind: 'edge', id: groupKey(edges[0].from, edges[0].to) });
              setConnection(null);
            }}
          />
        )}
        {dialog === 'attach-shared' && sharedAsset && <SharedAssetDialog graph={doc.graph} asset={sharedAsset}
          onClose={() => setDialog(null)} onAttach={attachShared}/>}
        {dialog === 'copy-source' && <Modal title="복제할 원문 선택" onClose={() => setDialog(null)}>
          {chosen && sourceKey && sourceDrafts[sourceKey]
            ? <SourceCopyChoice title={nodeTitle(chosen)} draft={sourceDrafts[sourceKey]} onChoose={duplicateBlock} onCancel={() => setDialog(null)}/>
            : <p>편집 중인 원문이 없습니다.</p>}
        </Modal>}
        {dialog === 'scope' && <AgentScopeDialog scope={doc.graph.agentScope} onClose={() => setDialog(null)}
          onApply={agentScope => {
            const current = docRef.current;
            apply({...current, graph:{...current.graph, agentScope}}, 'Agent 업무 범위를 적용했습니다.');
            setDialog(null);
          }}/>}
        {dialog === 'shortcuts' && <CanvasShortcuts onClose={() => setDialog(null)} />}
        {dialog === 'agent-export' && <AgentExportDialog projectId={project.id} title={doc.title} graph={doc.graph}
          hasSourceDrafts={hasSourceDrafts} onClose={() => setDialog(null)}
          onDownloaded={() => { setStatus('Agent ZIP 다운로드를 시작했습니다.'); setDialog(null); }}/>}
        {dialog === 'export' && <Modal title="설계 내보내기" onClose={()=>setDialog(null)}>
          <SourceOutputChoice data={describeSources()} action="내보내기" edited={exportEdited} onChoose={setExportEdited}/>
          <button className="ws-btn ws-primary" disabled={exportEdited && Object.values(sourceDrafts).some(d=>!d.text.trim())}
            onClick={()=>exportGraph(exportEdited)}>JSON 내려받기</button>
        </Modal>}
        {dialog === 'name' && (
          <Modal title="Agent 이름 변경" size="confirm" onClose={() => setDialog(null)}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) {
                  apply({ ...doc, title: name.trim() });
                  setDialog(null);
                }
              }}
            >
              <label className="ws-field">
                <span>이름</span>
                <input
                  autoFocus
                  value={name}
                  maxLength={120}
                  required
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div className="ws-modal-actions">
                <button type="button" className="ws-btn" onClick={() => setDialog(null)}>취소</button>
                <button className="ws-btn ws-primary" type="submit" disabled={!name.trim()}>적용</button>
              </div>
            </form>
          </Modal>
        )}
        {dialog === 'issues' && (
          <Modal title="설계 검사" size={issues.length ? 'form' : 'confirm'} onClose={() => setDialog(null)}>
            {issues.length ? (
              <>
                <p className="ws-hint">시험 실행 전에 아래 {issues.length}개 항목을 확인하세요.</p>
                <ul className="ws-issues">
                  {issues.map((i, k) => (
                    <li key={k}>
                      <button onClick={() => openIssue(i)}>{i.message}</button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>현재 설계가 실행 조건을 충족합니다.</p>
            )}
          </Modal>
        )}
        {dialog === 'import' && (
          <Modal title="설계 가져오기" size="form" onClose={() => {importCheck.current++;setImportWarning(undefined);setDialog(null);}}>
            <p>가져온 설계를 적용할 프로젝트는 <strong>{doc.title}</strong>입니다.</p>
            <label className="ws-field">
              <span>설계 JSON 파일</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  const check=++importCheck.current;
                  if(!file)return;
                  try{
                    const text=await file.text();
                    if(check===importCheck.current){setImportText(text);setImportError('');setImportWarning(undefined);}
                  }catch(error){if(check===importCheck.current)setImportError(message(error));}
                }}
              />
            </label>
            <button
              className="ws-btn"
              onClick={() => {
                importCheck.current++;
                try {
                  const value = localStorage.getItem('library-agent-studio.design.v2');
                  if (!value)
                    throw new Error(
                      '이 주소에 이전 초안이 없습니다. 기존 시안에서 내보낸 JSON 파일을 선택하세요.',
                    );
                  setImportText(value);
                  setImportError('');
                } catch (error) {
                  setImportError(message(error));
                }
              }}
            >
              이 브라우저의 이전 초안 불러오기
            </button>
            <label className="ws-field">
              <span>설계 내용</span>
              <textarea spellCheck={false} value={importText} onChange={(e) => {importCheck.current++;setImportText(e.target.value);}} rows={6} />
            </label>
            {importError && (
              <p role="alert" className="ws-danger">
                {importError}
              </p>
            )}
            {importWarning?.text===importText && <div role="alert">이 프로젝트에서 사용할 수 없는 자료가 있습니다.
              <ul>{importWarning.missing.map(value=><li key={value}>{value}</li>)}</ul>
              <p>자료를 포함하려면 원본 Agent에서 내 사본 만들기를 사용하거나 이 프로젝트에서 해당 자료판을 발행하세요.</p></div>}
            <div className="ws-modal-actions">
              <button className="ws-btn ws-primary" disabled={!importText.trim()} onClick={importGraph}>
                {importWarning?.text===importText?'자료 없이 현재 초안에 적용':'현재 초안에 적용'}
              </button>
            </div>
          </Modal>
        )}
        {dialog === 'ai' && (
          <Modal title="AI 설계 제안" size="form" onClose={closeAi}>
            {parentBlock && <p className="ws-hint">‘{parentBlock.title}’ 내부 설계에 적용할 변경을 제안합니다.</p>}
            <div className="ws-field">
              <label htmlFor={proposalFormId + '-prompt'}>만들거나 바꿀 일</label>
              <PromptTextarea
                id={proposalFormId + '-prompt'}
                expandLabel="만들거나 바꿀 일"
                value={prompt}
                onChange={(e) => editPrompt(e.target.value)}
                placeholder="회의 내용에서 결정 사항과 담당자를 뽑아 줘"
                rows={3}
              />
            </div>
            {needsChangeAnswer && <div className="ws-field">
              <label htmlFor={proposalFormId + '-answer'}>현재 설계에서 무엇을 바꾸고 싶으세요?</label>
              <PromptTextarea id={proposalFormId + '-answer'} expandLabel="현재 설계에서 무엇을 바꾸고 싶으세요?" ref={changeAnswerField} value={clarificationAnswer}
                onChange={e => editPrompt(e.target.value, true)} rows={2} />
            </div>}
            <button
              className="ws-btn"
              disabled={thinking || !prompt.trim() || (needsChangeAnswer && !clarificationAnswer.trim())}
              onClick={() => void propose()}
            >
              <Icon name="spark" />
              {thinking ? '제안 작성 중…' : needsChangeAnswer ? '답변으로 변경 제안받기' : requestedProposal ? '변경 제안 다시 받기' : '변경 제안 받기'}
            </button>
            {aiError && (
              <p className="ws-danger" role="alert">
                {aiError}
              </p>
            )}
            {proposal && !proposalMatches && (
              <p className="ws-danger" role="status">초안이 변경됐습니다. 현재 설계로 제안을 다시 요청하세요.</p>
            )}
            {proposal && proposalMatches && (
              <>
                <h3>적용할 변경</h3>
                <ul className="ws-diff">
                  {graphChanges(JSON.parse(proposal.base), proposal.graph).map((t, i) => (
                    <li key={i}>{t.length>320 ? <details><summary>{t.slice(0,140)}… · 전체 변경 보기</summary><p style={{whiteSpace:'pre-wrap'}}>{t}</p></details> : t}</li>
                  ))}
                </ul>
                {proposal.issues.length > 0 && <div role="status">
                  <strong>실행 전 수정 {proposal.issues.length}곳</strong>
                  <ul className="ws-issues">{proposal.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
                </div>}
                <div className="ws-modal-actions">
                  <button className="ws-btn" onClick={closeAi}>취소</button>
                  <button className="ws-btn ws-primary" onClick={applyProposal}>{proposal.issues.length ? '초안으로 적용해 수정' : '캔버스에 적용'}</button>
                </div>
              </>
            )}
          </Modal>
        )}
      </main>
    </div>
  );
}
