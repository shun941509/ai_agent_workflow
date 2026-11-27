'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Workflow,
  FolderOpen,
  UsersRound,
  BookOpen,
  LibraryBig,
  Plus,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  X,
  Waypoints,
  FileText,
  ScanSearch,
  GitFork,
  ClipboardCopy,
  PanelsTopLeft,
  Orbit,
  Play,
  History,
  Check,
  Search,
  Link2,
  Trash2,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import type { SharedAssetPin } from './editor/asset-attachment';
import type { SourceOutput } from './editor/source-comparison';
import {useSharedAgentAccess} from './use-shared-agent-access';
import DynamicLessonSetup from './DynamicLessonSetup';
import { dynamicLessonChecks } from '../domain/dynamic-lesson-policy';
import HomeDesignProposal, { proposalIntent } from './HomeDesignProposal';
import { newAgentPurpose, type DesignChangeContext, type DesignProposal } from '../domain/design-proposal';
import { workDocuments, type WorkDocument, type WorkPurpose } from '../domain/work-documents';
import ResourceLibrary, { AssetTrash, type AssetItem, type TrashedAsset } from './ResourceLibrary';
import {visitResource, type ResourceRoute, type ResourceView} from './resource-navigation';
import type { ResourceLeaveGuard } from './use-resource-leave';
import ProjectVersionPanel, {
  readVersionInfo,
  saveProjectVersion,
  type RestoreTarget,
  type VersionInfo,
  type VersionPanelMode,
} from './ProjectVersionPanel';
import ProjectTrash, { type TrashedProject } from './ProjectTrash';
import ProjectActionPicker, { type ProjectMenuAction } from './ProjectActionPicker';
import StudioDialog from './StudioDialog';
import WorkspaceHome from './WorkspaceHome';
import desk from './home/WorkspaceDesk.module.css';
import LessonHandout from './guide/LessonHandout';
import type { GuideLesson } from './WorkflowGuide';
import { guideAddress, guideLocation, guideSections, type GuidePosition, type GuideSection } from './guide/navigation';
import { WorkspaceMenuButton, WorkspaceNav, workspaceLabels as paths, type WorkspaceDestination, type WorkspaceMenuAction } from './WorkspaceNav';
import { subgraph } from './editor/graph';
import { validEditorFocus, type EditorFocus } from '../domain/editor-focus';
import { dateLabel, visibilityNames, type FullProject, type Project } from './studio-project';
import {
  type Graph,
  type Issue,
  type Lesson,
  blankPracticeLessonId,
  levels,
} from '../domain';
import { api, finishWrite, intentHash, message, pendingWriteKey, StudioApiError } from './client';
import { rememberedPosition, rememberWorkspacePosition, trackWorkspacePosition, visitLesson, workspaceListAt, type WorkspacePosition } from './workspace-history';

const Editor = dynamic(() => import('./editor/Editor'), {
  loading: () => <main className="loading"><p role="status">편집기를 여는 중입니다…</p></main>,
});
const GuidePage = dynamic(() => import('./guide/GuidePage').then(module => module.GuidePage), {
  loading: () => <p role="status">가이드를 여는 중입니다…</p>,
});
const RunPanel = dynamic(() => import('./RunPanel'), {
  loading: () => <p className="toast" role="status">실행 화면을 여는 중입니다…</p>,
});

type EditingSession = { project: FullProject; lastFocus?: string };
type EditorEntryOptions = { initialAction?: 'import'; archivedRevision?: number; issue?: Issue; sharedAsset?: SharedAssetPin; fromGuide?: boolean; guideStep?: number };
type ProposalTicket = {payload: string; key: string; newAgent?: true; changeContext?: DesignChangeContext; followUpFor?: string};
type ProposalSurface = 'home' | 'editor' | 'guide';
type Bootstrap = {
  user: { id: string; login: string };
  admin: boolean;
  modelReady: boolean;
  projects: Project[];
  resume: FullProject | null;
  assets: AssetItem[];
  sharedAssets: AssetItem[];
  lessons: Omit<Lesson, 'graph'>[];
};
type LessonGuide = Omit<Lesson, 'graph'>;
type GuideOrigin = {
  account: string;
  view: WorkspaceDestination;
  projectId?: string;
  projectLessonId?: string;
  lesson?: GuideLesson;
};

function projectLesson(project: FullProject, lessons: LessonGuide[]): LessonGuide | undefined {
  const lesson = lessons.find(item => item.id === project.lesson);
  if (!lesson) return undefined;
  // Older projects and ordinary project copies continue to use their own saved graph and editions.
  if (lesson.id === 'beginner' && !project.graph.nodes.some(node => node.type === 'file.create')) {
    return { ...lesson, optionalPractice:undefined, optionalSteps:undefined,
      description:'도서관 규정을 고치고 화면에 표시된 답변과 인용을 비교합니다.',
      task:'대출 한도를 3권에서 5권으로 고친 뒤, 같은 질문의 답변과 인용을 비교하세요.',
      goal:'규정의 한 문장을 수정하면 답변과 인용이 어떻게 달라지는지 확인합니다.', steps: [
      '대출 질문을 실행하고 답변에 인용된 문장을 도서관 이용규정과 대조하세요.',
      '내 사본의 대출 한도를 3권에서 5권으로 바꾸고 같은 질문을 다시 보내세요.',
      '수정 전후의 답변과 인용을 비교하세요. 파일 만들기는 ‘수준별 템플릿 → 초급 → 내 자료로 안내하기 → 내 사본으로 시작’에서 실습할 수 있습니다.',
    ], checks: ['수정 전에는 3권, 수정 후에는 5권이라고 답하고 각 실행에 사용한 원문을 인용합니다.'] };
  }
  if (lesson.id === 'peer-review') {
    const team = project.graph.nodes.find(node => node.type === 'agent.team')?.graph;
    if (!team?.nodes.some(node => node.id === 'record-facts' && node.type === 'data.transform')) {
      return { ...lesson, optionalPractice:undefined, optionalSteps:undefined, steps: [
        '팀 내부에서 사실 검토 담당과 안내문 편집 담당이 만든 초안을 찾아보세요.',
        '예시 질문을 실행하고 실행 경로에서 두 동료 검토의 ‘입출력 보기’를 열어 각자 어느 초안을 받았는지 확인하세요.',
        '최종 안내에서 토요일 폐관 시각과 근거를 원문과 대조하세요. 두 검토 기록이 최종 답변에 표시되는 설계는 수준별 템플릿에서 새로 열 수 있습니다.',
      ], checks: ['두 담당자가 서로의 초안을 받습니다.', '최종 안내의 토요일 폐관 시각이 도서관 원문과 일치합니다.'],
        example: '도서관 원문에는 토요일에 오전 10시부터 오후 4시까지 연다고 적혀 있습니다.' };
    }
  }
  if (lesson.id === 'release' && !project.releaseExercise) {
    return { ...lesson, title: project.title,
      task:'현재 규정을 첫 버전으로 저장하고, 규정을 고친 뒤 두 버전에 같은 질문을 보내세요.',
      goal:'내가 저장한 두 버전에서 대출 한도와 휴관일 안내가 어떻게 달라졌는지 확인합니다.',
      steps: [
      '‘도서관 이용규정’에서 현재 대출 한도를 확인하세요. ‘프로젝트 메뉴 → 버전 → 현재 초안 버전 저장’으로 첫 버전을 만드세요. 이미 저장한 판이 있다면 그 판을 기준으로 삼아도 됩니다.',
      '‘도서관 이용규정’에서 대출 한도를 바꾸고 ‘변경 적용’을 누르세요. ‘현재 초안 버전 저장’으로 수정한 판도 저장하세요.',
      '‘시험 실행’에서 직접 저장한 두 판을 선택해 같은 대출 질문을 보내세요. 휴관일도 물어보고, 바꾸기로 한 규정만 달라졌는지 확인하세요.',
    ], checks: ['두 판이 각각 자기 규정에 적힌 대출 한도를 안내하고, 수정하지 않은 휴관일 안내는 일치합니다.'],
      example: '대출 한도를 바꿨을 때 휴관일 안내가 그대로인지 확인하세요.' };
  }
  if (lesson.id === 'dynamic') {
    const spawn = project.graph.nodes.find(node => node.type === 'agent.create_dynamic' && node.graph);
    if (spawn) {
      const maxCreatedAgents = Number(spawn.config.maxCreatedAgents);
      const maxInFlightAgents = Number(spawn.config.maxInFlightAgents);
      const {failurePolicy} = spawn.config;
      if (Number.isInteger(maxCreatedAgents) && maxCreatedAgents > 0 && Number.isInteger(maxInFlightAgents) && maxInFlightAgents > 0 &&
        (failurePolicy === 'collect' || failurePolicy === 'stop')) {
        return {...lesson, checks:dynamicLessonChecks({maxCreatedAgents, maxInFlightAgents, failurePolicy})};
      }
      return lesson;
    }
    return { ...lesson, optionalPractice:undefined, optionalSteps:undefined, title: project.title, question: '중앙도서관, 호수도서관', steps: [
      '지점을 한 곳, 두 곳 입력해 담당자가 몇 명 생성되는지 확인하세요.',
      '생성 상한보다 많은 지점을 입력하고, 이번 실행에서 조사할 지점을 선택하세요.',
      '실행 기록에서 선택한 지점과 제외한 지점을 확인하세요. 근거 부족 시 처리 정책을 비교하는 실습은 수준별 템플릿에서 새로 시작할 수 있습니다.',
    ], checks: ['선택한 지점만 조사하고 설정한 인원 한도를 지킵니다.'],
      example: '생성 한도가 3명이면 네 곳 중 세 곳을 고릅니다.' };
  }
  return lesson;
}
const lessonIcons: Record<string, typeof BookOpen> = {
  intro: BookOpen,
  beginner: FileText,
  intermediate: ScanSearch,
  'library-visit': LibraryBig,
  parallel: GitFork,
  'peer-review': UsersRound,
  dynamic: Orbit,
  release: History,
  'sw-requirements': FileText,
  'sw-release-notes': ClipboardCopy,
  'sw-bug-triage': ScanSearch,
  'sw-code-review': GitFork,
  'sw-release-impact': Orbit,
};
const DialogFeedback = React.createContext({ error: '', status: '' });
function Modal(props: React.ComponentProps<typeof StudioDialog>) {
  const feedback = React.useContext(DialogFeedback);
  return <StudioDialog {...props}>
    {feedback.error && <p className="modal-error" role="alert">{feedback.error}</p>}
    {feedback.status && <p role="status">{feedback.status}</p>}
    {props.children}
  </StudioDialog>;
}
export default function Studio({accountId}: {accountId: string}) {
  const [data, setData] = useState<Bootstrap | null>(null),
    [view, setView] = useState<WorkspaceDestination>('home'),
    [drawer, setDrawer] = useState(false),
    [resolvingEditor, setResolvingEditor] = useState(false),
    [selected, setSelected] = useState<FullProject | null>(null);
  const projectRef = useRef<FullProject | null>(null),
    editing = useRef<EditingSession | null>(null),
    saveChain = useRef<Promise<void>>(Promise.resolve()),
    visitChain = useRef<Promise<void>>(Promise.resolve());
  const [dialog, setDialog] = useState<
      | ''
      | 'create'
      | 'delete'
      | 'ai'
      | 'work-ai'
      | 'lesson'
      | 'versions'
      | 'share'
      | 'pickImport'
      | 'pickConnect'
      | 'public'
      | 'run'
    >(''),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [pagePosition, setPagePosition] = useState<WorkspacePosition | null>(null);
  const [guidePosition, setGuidePosition] = useState<GuidePosition>({section:'start', step:1});
  const [guideOrigin, setGuideOrigin] = useState<GuideOrigin>();
  const focusGuideMenu = useRef(false);
  const requestedPractice = useRef<{projectId: string; step: number} | null>(null);
  const readingFromProject = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    readingFromProject.current = view === 'guide' && !selected ? guideOrigin?.projectId : undefined;
  }, [view, selected, guideOrigin]);
  const [guideExampleId, setGuideExampleId] = useState<string | null>(null);
  const exampleKey = 'studio.guide.example.' + accountId;
  useEffect(() => {
    try { setGuideExampleId(localStorage.getItem(exampleKey)); } catch { /* The current tab still remembers its example. */ }
  }, [exampleKey]);
  const [inTrash, setInTrash] = useState(false);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null),
    cancelDeleteButton = useRef<HTMLButtonElement | null>(null),
    listSearch = useRef<HTMLInputElement | null>(null),
    listFocus = useRef<'trigger' | 'search' | null>(null),
    deleting = useRef(false);
  const [lessonId, setLessonId] = useState('intro'),
    [filter, setFilter] = useState('전체'),
    [search, setSearch] = useState('');
  const [homeDesign, setHomeDesign] = useState<{owner:string; title:string; prompt:string; answer?:string}>(),
    [newTitle, setNewTitle] = useState(''),
    [importFile, setImportFile] = useState<File | null>(null),
    [missingImport,setMissingImport]=useState<{file:File;missing:string[]}>(),
    [templateTitle, setTemplateTitle] = useState('');
  const creating = useRef(false);
  const [workDesign, setWorkDesign] = useState<{doc:WorkDocument; prompt:string; answer?:string; material?:string}>();
  const proposalRequests = useRef<Partial<Record<ProposalSurface, ProposalTicket>>>({});
  const [assetLink, setAssetLink] = useState<{
      id: string;
      token?: string;
      edition?: string;
    } | null>(null),
    [publicToken, setPublicToken] = useState<string>();
  const sharedProject = selected && !selected.mine && (dialog === 'public' || dialog === 'run') ? selected : null;
  const {sharingRevoked, checkAccess} = useSharedAgentAccess(sharedProject, publicToken);
  const recheckAccess = useCallback(() => { void checkAccess().catch(() => {}); }, [checkAccess]);
  const [versionPanel, setVersionPanel] = useState<{ key: number; info: VersionInfo; listProject: FullProject | null } | null>(null);
  const [savedDesigns, setSavedDesigns] = useState<{projectId:string; versions:VersionInfo['versions']} | null>(null);
  const sharingRow = useRef<{id: string} | null>(null);
  const restoreShareFocus = useRef<string | null>(null);
  const [pendingPin, setPendingPin] = useState<SharedAssetPin | null>(null);
  const resourceLeaveGuard = useRef<ResourceLeaveGuard | null>(null);
  const editorPop = useRef<(() => boolean) | null>(null);
  const saveEditorDraft = useRef<((includeEdited?:boolean) => Promise<boolean>) | null>(null);
  const editorSourceOutput = useRef<(() => SourceOutput) | null>(null);
  const [editorEntry, setEditorEntry] = useState<EditorEntryOptions & {key:number}>({ key: 0 });
  const [loadFailure, setLoadFailure] = useState('');
  const init = useRef<Promise<Bootstrap> | null>(null),
    routeGeneration = useRef(0),
    refreshGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++refreshGeneration.current;
    await visitChain.current;
    const updated = await api<Bootstrap>('bootstrap');
    if (updated.user.id !== accountId) window.location.reload();
    else if (request === refreshGeneration.current) setData(updated);
    return updated;
  }, [accountId]);
  function finishProposal(surface: ProposalSurface) {
    delete proposalRequests.current[surface];
    try { sessionStorage.removeItem('studio.proposal.' + surface); } catch { /* Tab storage is optional. */ }
  }
  function proposalTicket(surface: ProposalSurface) {
    const current = proposalRequests.current[surface];
    if (current) return current;
    try { return JSON.parse(sessionStorage.getItem('studio.proposal.' + surface) || 'null') as ProposalTicket | null; }
    catch { return undefined; }
  }
  async function requestProposal(surface: ProposalSurface, text: string, graph: Graph, signal?: AbortSignal, clarificationAnswer?: string): Promise<DesignProposal> {
    const {initial, payload} = await proposalIntent(data?.user.id, surface === 'editor' ? selected?.id : null, text, graph, clarificationAnswer);
    signal?.throwIfAborted();
    let ticket = proposalTicket(surface);
    const slot = 'studio.proposal.' + surface;
    if (!ticket || ticket.payload !== payload || (surface === 'home' && !ticket.newAgent)) {
      ticket = {payload, key: crypto.randomUUID(), newAgent:surface === 'home' ? true : undefined,
        changeContext:surface === 'editor' ? 'editor' : surface === 'guide' ? workDesign?.doc.id : undefined,
        ...(clarificationAnswer && {followUpFor:initial})};
      try { sessionStorage.setItem(slot, JSON.stringify(ticket)); } catch { /* The request can still be retried in this view. */ }
    }
    proposalRequests.current[surface] = ticket;
    try {
      const result = await api<DesignProposal>('propose', {
        prompt:text, graph, requestKey:ticket.key, newAgent:ticket.newAgent, changeContext:ticket.changeContext, clarificationAnswer,
      }, signal);
      if (surface === 'editor' && proposalRequests.current[surface] === ticket) finishProposal(surface);
      return result;
    } catch (error) {
      if (error instanceof StudioApiError && error.status === 503 && proposalRequests.current[surface] === ticket)
        finishProposal(surface);
      throw error;
    } finally {
      if (!signal?.aborted) void refresh().catch(e => notify(message(e)));
    }
  }
  const choose = useCallback((p: FullProject | null) => {
    if (p && editing.current?.project.id === p.id) editing.current.project = p;
    else editing.current = p ? { project: p } : null;
    projectRef.current = p;
    setSelected(p);
  }, []);
  const enterEditor = useCallback((p: FullProject, options:EditorEntryOptions = {}) => {
    choose(p);
    setEditorEntry(entry => ({ key: entry.key + 1, ...options }));
  }, [choose]);
  function notify(text: string) {
    setToast(text);
  }
  useLayoutEffect(() => {
    if (!pagePosition) return;
    if (pagePosition.projectId) {
      const row = document.querySelector<HTMLButtonElement>('[data-project-id="' + CSS.escape(pagePosition.projectId) + '"]');
      (row ?? listSearch.current)?.focus({preventScroll:true});
    } else if (pagePosition.lessonTrigger) {
      document.querySelector<HTMLButtonElement>('[data-lesson-trigger="' + CSS.escape(pagePosition.lessonTrigger) + '"]')?.focus({preventScroll:true});
    } else if (pagePosition.trashLink) {
      document.querySelector<HTMLAnchorElement>('.project-folder-link')?.focus({preventScroll:true});
    } else if (pagePosition.searchFocused) {
      listSearch.current?.focus({preventScroll:true});
    }
    window.scrollTo({top:pagePosition.y, behavior:'instant'});
  }, [pagePosition]);
  useLayoutEffect(() => {
    if (!focusGuideMenu.current || view === 'guide' || selected || !data) return;
    focusGuideMenu.current = false;
    const triggers = document.querySelectorAll<HTMLButtonElement>('[data-guide-menu], .workspace-top .workspace-menu-button');
    Array.from(triggers).find(button => button.getClientRects().length)?.focus({preventScroll:true});
  }, [data, selected, view]);
  const hasWorkspaceList = !!data && !selected && !inTrash && ['home','templates','projects','shared'].includes(view);
  useLayoutEffect(() => {
    const id = restoreShareFocus.current;
    if (dialog || !id) return;
    restoreShareFocus.current = null;
    const button = document.querySelector<HTMLButtonElement>('[data-share-project-id="' + CSS.escape(id) + '"]');
    button?.focus({preventScroll:true});
    button?.scrollIntoView({block:'nearest', inline:'nearest', behavior:'instant'});
  }, [dialog]);
  useEffect(() => {
    if (hasWorkspaceList) return trackWorkspacePosition(view);
  }, [hasWorkspaceList, view]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (dialog || !listFocus.current) return;
    const trigger = listFocus.current === 'trigger' && deleteTrigger.current;
    listFocus.current = null;
    if ((view === 'projects' || view === 'assets') && !inTrash) {
      (trigger && trigger.isConnected ? trigger : listSearch.current)?.focus();
    }
  }, [dialog, inTrash, view]);
  const readLocation = useCallback(async (fromHistory = false, initial?: Bootstrap) => {
    const visit = ++routeGeneration.current;
    sharingRow.current = null;
    const q = new URLSearchParams(window.location.search),
      token = q.get('token') ?? undefined;
    const folderView = q.get('view');
    const practiceRequest = requestedPractice.current;
    requestedPractice.current = null;
    const fromGuide = window.history.state?.returnFromGuide === accountId;
    if (fromGuide) {
      const state = {...window.history.state};
      delete state.returnFromGuide;
      window.history.replaceState(state, '');
      focusGuideMenu.current = !q.has('edit');
    }
    if (folderView === 'guide') {
      setGuidePosition(guideLocation(q, window.location.hash));
      const origin = window.history.state?.guideOrigin;
      setGuideOrigin(origin?.account === accountId ? origin : undefined);
    }
    setTemplateTitle(folderView === 'templates' ? window.history.state?.templateCreateTitle || '' : '');
    setInTrash(!q.has('asset') && (folderView === 'projects' || folderView === 'assets') && q.get('folder') === 'trash');
    setDrawer(false);
    setDialog('');
    setError('');
    setLoadFailure('');
    setAssetLink(null);
    setPublicToken(undefined);
    const lessonDetail = (!folderView || folderView === 'templates' || folderView === 'home') && q.get('lesson');
    const saved = (workspaceListAt(q) || lessonDetail) ? rememberedPosition() : undefined;
    setSearch(saved?.search ?? '');
    setFilter(saved?.level ?? '전체');
    setPagePosition(lessonDetail ? null : saved ?? null);
    const projectId = q.get('agent') || q.get('edit');
    if (projectId) {
      try {
        const p = await api<FullProject>('project.open', {
          id: projectId,
          token,
        });
        if (visit !== routeGeneration.current) return;
        setPublicToken(token);
        if (q.has('agent') || !p.mine) {
          choose(p);
          setView('shared');
          setDialog('public');
        } else {
          enterEditor(p, {fromGuide:fromGuide || readingFromProject.current === p.id,
            guideStep:practiceRequest?.projectId === p.id ? practiceRequest.step : undefined});
        }
      } catch (e) {
        if (visit !== routeGeneration.current) return;
        choose(null);
        setView('shared');
        setLoadFailure(message(e));
      }
    } else if (!q.has('asset') && q.get('view') === 'editor') {
      choose(null);
      setView('editor');
      // Back should restore the chooser even after a project was opened from it.
      if (fromHistory && window.history.state?.editorChooser) {
        setResolvingEditor(false);
        return;
      }
      setResolvingEditor(true);
      try {
        const { resume } = initial ?? await refresh();
        if (visit !== routeGeneration.current) return;
        if (resume) {
          window.history.replaceState(null, '', '/?edit=' + encodeURIComponent(resume.id));
          enterEditor(resume);
        } else {
          window.history.replaceState({ editorChooser: true }, '', window.location.href);
        }
      } catch (e) {
        if (visit === routeGeneration.current) setLoadFailure(message(e));
      } finally {
        if (visit === routeGeneration.current) setResolvingEditor(false);
      }
    } else {
      choose(null);
      if (q.has('asset')) {
        setAssetLink({ id: q.get('asset')!, token, edition: q.get('edition') ?? undefined });
        setView(folderView === 'shared-assets' ? 'shared-assets' : 'assets');
      } else {
        setView(
          Object.hasOwn(paths, q.get('view') ?? '')
            ? (q.get('view') as WorkspaceDestination)
            : 'home'
        );
        if (lessonDetail) {
          setLessonId(lessonDetail);
          setDialog('lesson');
        }
      }
    }
  }, [accountId, choose, enterEditor, refresh]);
  useEffect(() => {
    let alive = true;
    init.current ??= refresh();
    void init.current
      .then(initial => {
        if (alive) {
          init.current = null;
          void readLocation(false, initial);
        }
      })
      .catch((e) => {
        if (alive) setLoadFailure(message(e));
      });
    function refreshLandingPage() {
      const params = new URLSearchParams(window.location.search);
      const landing = params.get('view') ?? 'home';
      if (!params.has('edit') && !params.has('agent') && !params.has('asset') && ['home', 'shared', 'shared-assets'].includes(landing))
        void refresh().catch(e => setError(message(e)));
    }
    async function fromHistory(event: PopStateEvent) {
      if (resourceLeaveGuard.current?.handleHistory(event)) return;
      if (editorPop.current?.()) {
        ++routeGeneration.current;
        return;
      }
      const editor = projectRef.current;
      const saveApplied = saveEditorDraft.current;
      if (editor && saveApplied) {
        const visit = ++routeGeneration.current;
        const saved = await saveApplied(false);
        if (!alive || visit !== routeGeneration.current) return;
        if (!saved) {
          window.history.pushState(null, '', '/?edit=' + encodeURIComponent(editor.id));
          setError('이동 전에 설계를 저장하지 못했습니다. 저장 상태를 확인하세요.');
          return;
        }
      }
      await readLocation(true);
      refreshLandingPage();
    }
    async function checkCurrentAccount() {
      try {
        const current = await api<Bootstrap['user']>('auth.session');
        if (alive && current.id !== accountId) window.location.reload();
      } catch { /* The API redirects expired sessions. Network errors can be retried. */ }
    }
    function onVisibility() {
      if (document.visibilityState !== 'visible') return;
      void checkCurrentAccount();
      refreshLandingPage();
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) window.location.reload();
    }
    function onStorage(event: StorageEvent) {
      if (event.key === 'studio:logout') void checkCurrentAccount();
    }
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('storage', onStorage);
    window.addEventListener('popstate', fromHistory);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      routeGeneration.current++;
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('popstate', fromHistory);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [accountId, refresh, readLocation]);
  function modal(m: typeof dialog) {
    setError('');
    setDialog(m);
  }
  function close() {
    if (!busy) {
      if (dialog === 'lesson') {
        if (window.history.state?.fromLessonList) window.history.back();
        else {
          const address = new URL(window.location.href);
          address.searchParams.delete('lesson');
          window.history.replaceState(window.history.state, '', address);
          void readLocation();
        }
        return;
      }
      if (dialog === 'share' && sharingRow.current) {
        restoreShareFocus.current = sharingRow.current.id;
        sharingRow.current = null;
      }
      setDialog('');
      setError('');
      if (selected && (!selected.mine || dialog === 'public' || dialog === 'run')) {
        choose(null);
        setView('shared');
        url('view=shared');
      }
      if (dialog === 'public' || dialog === 'run') void refresh().catch(e => setError(message(e)));
    }
  }
  async function action(fn: () => Promise<unknown>, successMessage?: string) {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (successMessage) notify(successMessage);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function url(q: string, guideOrigin?: GuideOrigin) {
    routeGeneration.current++;
    const address = q ? '/?' + q : '/';
    if (window.location.pathname + window.location.search !== address) {
      if (guideOrigin && window.history.state?.studioEditor?.drawer) {
        // The underlying entry already remembers the editor before its mobile menu opened.
        window.history.replaceState({guideOrigin}, '', address);
        return true;
      }
      if (q.startsWith('edit=') && window.history.state?.fromLessonList && new URLSearchParams(window.location.search).has('lesson')) {
        window.history.replaceState(null, '', address);
        return true;
      }
      const from = workspaceListAt(new URLSearchParams(window.location.search));
      rememberWorkspacePosition();
      const state = guideOrigin ? {guideOrigin} : from === 'projects' && q === 'view=projects&folder=trash' ? {fromProjectList:true} : null;
      window.history.pushState(state, '', address);
      return true;
    }
    return false;
  }
  function withResourceLeave(proceed: () => void) {
    if (resourceLeaveGuard.current) resourceLeaveGuard.current(proceed);
    else proceed();
  }
  const navigate = (s: WorkspaceDestination, trash = false) => {
    withResourceLeave(() => s === 'guide' ? openGuide() : changeView(s, trash));
  };
  function openGuide(currentLesson = false, guideStep = 1) {
    if (view === 'guide' && !selected) return;
    const project = selected?.mine ? (editing.current?.project.id === selected.id ? editing.current.project : selected) : undefined;
    const lesson = currentLesson && project && projectLesson(project, data?.lessons ?? []);
    const origin: GuideOrigin = {
      account:accountId, view:project ? 'editor' : view, projectId:project?.id, projectLessonId:project?.lesson,
      ...(lesson && lesson.id !== 'intro' ? {lesson:{
        id:lesson.id, title:lesson.title, task:lesson.task, steps:lesson.steps, checks:lesson.checks,
        question:lesson.question, example:lesson.example, optionalPractice:lesson.optionalPractice, optionalSteps:lesson.optionalSteps,
        showPreparedRelease:lesson.id === 'release' && !project?.releaseExercise,
      }} : {}),
    };
    const section: GuideSection = origin.lesson ? 'goals' : 'start';
    const state = window.history.state;
    if (!state?.studioEditor?.drawer)
      window.history.replaceState({...state, returnFromGuide:accountId}, '');
    changeView('guide', false, {query:guideAddress(section, guideStep).slice(2), origin});
    setGuideOrigin(origin);
    setGuidePosition({section, step:guideStep});
  }
  function goToGuideSection(position: GuidePosition, href = guideAddress(position.section, position.step, position.issue, position.helpOrigin)) {
    window.history.replaceState(window.history.state, '', href);
    setGuidePosition(position);
  }
  function returnFromGuide() {
    if (guideOrigin) window.history.back();
    else navigate('home');
  }
  function changeView(s: WorkspaceDestination, trash = false, guideEntry?: {query:string; origin:GuideOrigin}) {
    sharingRow.current = null;
    setTemplateTitle('');
    if (s === 'editor') {
      url('view=editor');
      void readLocation();
      return;
    }
    setDialog('');
    setDrawer(false);
    setError('');
    setLoadFailure('');
    setSearch('');
    setFilter('전체');
    setPagePosition(s === 'assets' || s === 'shared-assets' ? null : {y:0});
    choose(null);
    setView(s);
    setInTrash(trash);
    setAssetLink(null);
    setPublicToken(undefined);
    const pushed = url(guideEntry?.query ?? (s === 'home' ? '' : 'view=' + s + (trash ? '&folder=trash' : '')), guideEntry?.origin);
    if (!pushed && !trash && s !== 'assets' && s !== 'shared-assets') {
      const state = {...window.history.state};
      delete state.workspacePosition;
      delete state.templateCreateTitle;
      delete state.lessonListKey;
      delete state.lessonPolicy;
      window.history.replaceState(state, '');
    }
    void refresh().catch((e) => notify(message(e)));
  }
  function edit(p: FullProject, options:EditorEntryOptions = {}) {
    enterEditor(p, options);
    setDialog('');
    setPublicToken(undefined);
    url('edit=' + encodeURIComponent(p.id));
    void refresh().catch((e) => notify(message(e)));
  }
  function handleMenuAction(command: WorkspaceMenuAction) {
    if (command === 'import') modal('pickImport');
  }
  async function openMenuProject(id: string, command: ProjectMenuAction) {
    const route = routeGeneration.current;
    const project = await api<FullProject>('project.open', { id });
    if (route !== routeGeneration.current) return;
    if (!project.mine) throw new Error('내 프로젝트를 선택하세요.');
    if (command === 'connect') {
      if (!pendingPin) throw new Error('연결할 자료판을 다시 선택하세요.');
      const detail = await api<{asset:AssetItem; version:number}>('asset.read', {
        id:pendingPin.id, version:pendingPin.version, sharedCatalog:true,
      });
      if (route !== routeGeneration.current) return;
      const pin = {id:detail.asset.id, kind:detail.asset.kind, name:detail.asset.name, version:detail.version};
      withResourceLeave(() => edit(project, {sharedAsset:pin}));
    } else {
      modal('');
      withResourceLeave(() => edit(project, {initialAction:'import'}));
    }
  }
  async function open(p: Project, options?: EditorEntryOptions) {
    const visit = routeGeneration.current;
    await action(async () => {
      await visitChain.current;
      const full = await api<FullProject>('project.open', { id: p.id });
      if (visit !== routeGeneration.current) return;
      if (full.mine) edit(full, options);
      else {
        choose(full);
        setPublicToken(undefined);
        modal('public');
      }
    });
  }
  function runSharedProjectAction(project: FullProject, command: 'run' | 'copy') {
    const visit = routeGeneration.current;
    return action(async () => {
      try {
        if (command === 'run') {
          const allowed = project.mine || await checkAccess();
          if (allowed && visit === routeGeneration.current) modal('run');
          return;
        }
        const copyDraft = project.mine && !project.publicVersion;
        const source = copyDraft ? 'draft-' + project.revision : project.publicVersion;
        const slot = 'studio.copy.' + JSON.stringify([accountId, project.id, source, project.shareGeneration]);
        const requestKey = pendingWriteKey(slot);
        const copy = await api<FullProject>('project.copy', {
          id:project.id, token:publicToken, shareGeneration:project.shareGeneration,
          published:!copyDraft, version:project.publicVersion ?? undefined, requestKey,
        });
        finishWrite(slot, requestKey);
        if (visit === routeGeneration.current) edit(copy);
        else void refresh().catch(() => {});
      } catch (error) {
        if (visit === routeGeneration.current) throw error;
      }
    });
  }
  async function create(body: {title?: string; lesson?: string; graph?: Graph; workDocument?:WorkPurpose; legacy?: unknown; dynamicPolicy?: import('../domain/dynamic-lesson-policy').DynamicLessonPolicy}, options?: EditorEntryOptions) {
    const visit = routeGeneration.current;
    const slot = 'studio.create.' + await intentHash([data?.user.id, body]);
    const requestKey = pendingWriteKey(slot);
    let p: FullProject;
    try { p = await api<FullProject>('project.create', {...body, requestKey}); }
    catch (error) {
      if (error instanceof TypeError) throw new Error('생성 결과를 받지 못했습니다. 같은 설정으로 다시 시작하면 처음 요청한 프로젝트를 엽니다.');
      throw error;
    }
    finishWrite(slot, requestKey);
    if (visit === routeGeneration.current) edit(p, options);
    else void refresh().catch(e => notify(message(e)));
    return p;
  }
  async function creationAction(perform: () => Promise<unknown>) {
    if (creating.current) return;
    creating.current = true;
    try { await action(perform); } finally { creating.current = false; }
  }
  function cancelDelete() {
    if (deleting.current) return;
    listFocus.current = 'trigger';
    setDialog('');
    setDeleteTarget(null);
    setError('');
  }
  async function confirmDelete(p: Project) {
    if (deleting.current) return;
    deleting.current = true;
    const visit = routeGeneration.current;
    await action(async () => {
      try {
        await api('project.delete', {
          id: p.id,
          revision: p.revision,
          expectedVisibility: p.visibility,
          expectedPublicVersion: p.publicVersion,
        });
      } catch (e) {
        await refresh().catch(() => {});
        throw e;
      } finally {
        deleting.current = false;
      }
      // An older list request must not put the deleted project back on screen.
      refreshGeneration.current++;
      setData(current => current && ({ ...current, projects: current.projects.filter(project => project.id !== p.id),
        resume: current.resume?.id === p.id ? null : current.resume }));
      if (routeGeneration.current === visit) {
        listFocus.current = 'search';
        setDeleteTarget(null);
        setDialog('');
        notify('프로젝트를 휴지통으로 이동했습니다.');
      }
    });
  }
  async function restoreFromTrash(item: TrashedProject) {
    const visit = routeGeneration.current;
    const currentRefresh = refreshGeneration.current;
    const owner = data?.user.id;
    const restored = await api<Project>('project.restore', { id: item.id, revision: item.revision });
    if (visit !== routeGeneration.current || currentRefresh !== refreshGeneration.current) {
      void refresh().catch(() => {});
      return;
    }
    refreshGeneration.current++;
    setData(current => current && current.user.id === owner
      ? { ...current, projects: [restored, ...current.projects.filter(project => project.id !== restored.id)] }
      : current);
    listFocus.current = 'search';
    returnToProjects();
    notify(restored.title + ' 프로젝트를 복구했습니다.');
  }
  function openResourceRoute(route:ResourceRoute,replace=false,destination:ResourceView = view === 'shared-assets' ? 'shared-assets' : 'assets') {
    if(!visitResource(route,replace,destination))return;
    routeGeneration.current++;
    setView(destination);
    setInTrash(route==='trash');
    setAssetLink(typeof route==='string'?null:route);
    if (route==='list' && destination==='shared-assets') void refresh().catch(e=>notify(message(e)));
  }
  function onAssetDeleted(item: AssetItem) {
    refreshGeneration.current++;
    setData(current => current && {...current, assets: current.assets.filter(asset => asset.id !== item.id),
      sharedAssets:current.sharedAssets.filter(asset => asset.id !== item.id)});
    if (new URLSearchParams(window.location.search).get('asset') === item.id) {
      openResourceRoute('list',true);
    }
    notify(item.name + ' 자료를 휴지통으로 이동했습니다.');
  }
  async function restoreAssetFromTrash(item: TrashedAsset) {
    const visit = routeGeneration.current;
    const owner = data?.user.id;
    const restored = await api<AssetItem>('asset.restore', {id: item.id, revision: item.revision});
    if (visit !== routeGeneration.current) {
      void refresh().catch(() => {});
      return;
    }
    setData(current => current && current.user.id === owner
      ? {...current, assets: [restored, ...current.assets.filter(asset => asset.id !== restored.id)]}
      : current);
    listFocus.current = 'search';
    openResourceRoute('list',true);
    notify(restored.name + ' 자료를 복구했습니다.');
  }
  function folderLink(section: 'projects' | 'assets', trash: boolean) {
    return <a className="btn project-folder-link" href={'/?view=' + section + (trash ? '&folder=trash' : '')}
      onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (section === 'projects' && !trash) { returnToProjects(); return; }
        if(section==='assets')openResourceRoute(trash?'trash':'list');
        else navigate(section, trash);
      }}>
      {trash ? <><Trash2 size={16} aria-hidden="true" />휴지통</> : <><FolderOpen size={16} aria-hidden="true" />{section === 'projects' ? '내 Agent' : '도구 및 자료'}로 돌아가기</>}
    </a>;
  }
  function returnToProjects() {
    if (window.history.state?.fromProjectList) window.history.back();
    else navigate('projects');
  }
  async function saveReferenceDocument(projectId: string, name: string, content: string) {
    const slot = 'studio.saveReference.' + await intentHash([accountId, projectId, name, content]);
    const requestKey = pendingWriteKey(slot);
    const saved = await api<AssetItem>('asset.save', {kind:'document', name, payload:{content}, requestKey});
    finishWrite(slot, requestKey);
    refreshGeneration.current++;
    setData(current => {
      if (!current || current.user.id !== accountId) return current;
      const existing = current.assets.find(item => item.id === saved.id);
      if (existing && (existing.version > saved.version || (existing.revision ?? 0) > (saved.revision ?? 0))) return current;
      return {...current, assets:[saved, ...current.assets.filter(item => item.id !== saved.id)]};
    });
    return saved;
  }
  function rememberFocus(session: EditingSession, focus: EditorFocus) {
    const fingerprint = JSON.stringify(focus);
    if (session.lastFocus === fingerprint) return;
    session.lastFocus = fingerprint;
    const project = session.project;
    const owner = data?.user.id;
    setData(current => current?.user.id === owner && current ? { ...current, resume: { ...project, editorFocus: focus } } : current);
    visitChain.current = visitChain.current
      .then(() => api('editor.visit', { id: project.id, focus }))
      .catch(e => {
        if (session.lastFocus === fingerprint) session.lastFocus = undefined;
        notify(message(e));
      });
  }
  function save(graph: Graph, title: string, session = editing.current) {
    if (!session) return Promise.reject(new Error('Agent를 찾을 수 없습니다.'));
    const owner = data?.user.id;
    const next = saveChain.current
      .catch(() => {})
      .then(async () => {
        const p = session.project;
        if (
          p.title === title &&
          JSON.stringify(p.graph) === JSON.stringify(graph)
        )
          return;
        const result = await api<FullProject>('project.save', {
          id: p.id,
          title,
          graph,
          revision: p.revision,
        });
        session.project = result;
        if (editing.current === session) choose(result);
        setData(current => current && current.user.id === owner && current.resume?.id === result.id
          ? { ...current, resume: { ...result, editorFocus: current.resume.editorFocus } }
          : current);
      });
    saveChain.current = next;
    return next;
  }
  function showVersions(mode: VersionPanelMode, info: VersionInfo, listProject: FullProject | null = null) {
    setVersionPanel(previous => ({ key: (previous?.key ?? 0) + 1, info, listProject }));
    modal(mode);
  }
  async function openListSharing(id: string) {
    const row = {id};
    sharingRow.current = row;
    setVersionPanel(null);
    modal('share');
    try {
      const project = await api<FullProject>('project.open', {id});
      if (!project.mine) throw new Error('내 프로젝트만 공유 설정을 변경할 수 있습니다.');
      const info = await readVersionInfo(project, 'share');
      if (sharingRow.current === row) showVersions('share', info, project);
    } catch (error) {
      if (sharingRow.current === row) setError(message(error));
    }
  }
  async function projectForVersionChange(includeEdited = true) {
    const p = projectRef.current;
    if (!p || (saveEditorDraft.current && !await saveEditorDraft.current(includeEdited)))
      throw Error('현재 초안을 저장할 수 없습니다. 편집기에서 원문과 저장 상태를 확인하세요.');
    const saved = projectRef.current;
    if (!saved || saved.id !== p.id) throw Error('작업 중인 프로젝트가 변경되었습니다.');
    return saved;
  }
  function restoreDraft(target: RestoreTarget) {
    const route = routeGeneration.current;
    return action(async () => {
      const p = await projectForVersionChange();
      if (route !== routeGeneration.current) return;
      const {archivedRevision, ...updated} = await api<FullProject & {archivedRevision: number | null}>('versions.restore', {
        id: p.id, revision: p.revision, ...target,
      });
      if (route !== routeGeneration.current || p.id !== projectRef.current?.id) return;
      if (archivedRevision === null) {
        modal('');
        notify('현재 초안이 선택한 내용과 같습니다.');
      } else edit(updated, {archivedRevision});
    });
  }
  async function versions(mode: VersionPanelMode) {
    const route = routeGeneration.current;
    await action(async () => {
      await saveChain.current;
      const p = projectRef.current;
      if (!p?.mine || route !== routeGeneration.current) return;
      const info = await readVersionInfo(p, mode);
      if (route === routeGeneration.current && p.id === projectRef.current?.id) showVersions(mode, info);
    });
  }
  function applyProjectSharing(updated: FullProject) {
    if (sharingRow.current?.id === updated.id) {
      setVersionPanel(panel => panel?.listProject?.id === updated.id ? {...panel, listProject:updated} : panel);
    } else if (projectRef.current?.id === updated.id) {
      const draft=projectRef.current;
      choose({...draft, publicVersion:updated.publicVersion, visibility:updated.visibility, token:updated.token, releaseExercise:updated.releaseExercise});
    }
    setData(current => current && ({
      ...current,
      projects: current.projects.map(project => project.id === updated.id
        ? { ...project, publicVersion: updated.publicVersion, visibility: updated.visibility, updated: updated.updated, token: updated.token }
        : project),
    }));
  }
  const lesson = data?.lessons.find((l) => l.id === lessonId);
  let pageLabel: string = paths[view];
  if (dialog === 'lesson' && lesson) pageLabel = lesson.title;
  else if (selected) pageLabel = selected.title + ' · ' + (dialog === 'run' ? '실행' : dialog === 'public' ? paths.shared : paths.editor);
  else if (inTrash) pageLabel += ' · 휴지통';
  else if (view === 'guide') pageLabel = guideSections[guidePosition.section] + ' · ' + paths.guide;
  else if (assetLink) {
    const assets = view === 'shared-assets' ? data?.sharedAssets : data?.assets;
    pageLabel = (assets?.find(asset => asset.id === assetLink.id)?.name ?? '자료 상세') + ' · ' + pageLabel;
  }
  useEffect(() => { document.title = pageLabel + ' · Workflow Studio'; }, [pageLabel]);
  const lessonsByLevel = [...(data?.lessons ?? [])].sort((a, b) => levels.indexOf(a.level) - levels.indexOf(b.level));
  const visibleLessons = lessonsByLevel.filter(l => filter === '전체' || l.level === filter);
  const mine = (data?.projects ?? []).filter((p) => p.mine),
    shared = (data?.projects ?? []).filter(
      (p) => p.publicVersion && p.visibility !== 'private'
    );
  function lessonCard(l: Omit<Lesson, 'graph'>) {
    const Icon = lessonIcons[l.id] ?? BookOpen;
    return (
      <button
        key={l.id}
        className={'lesson-tile ' + desk.lessonRow}
        data-lesson-trigger={l.id}
        onClick={() => openLesson(l.id, l.id)}
      >
        <strong><Icon size={19} aria-hidden="true"/>{l.title}</strong>
        <span className={desk.level}>{l.level}</span>
        <span className={desk.description}>{l.description}</span>
        <ChevronRight size={16} aria-hidden="true"/>
      </button>
    );
  }
  function lessonList(items: Omit<Lesson, 'graph'>[]) {
    return <div className={desk.lessonList}>
      <div className={desk.listHeading} aria-hidden="true"><span>실습 이름</span><span>수준</span><span>실습 내용</span></div>
      {items.map(lessonCard)}
    </div>;
  }
  function projects(items: Project[]) {
    const matches = items.filter((p) =>
      p.title.toLowerCase().includes(search.toLowerCase())
    );
    return matches.length ? (
      <div className="project-list">
        {matches.map((p) => (
          <div key={p.id} className="project-item">
            <button
              className="project-row"
              data-project-id={p.id}
              onClick={() => void open(p)}
            >
              <span className="project-icon">
                <Workflow size={19} />
              </span>
              <span className="project-name">
                <b>{p.title}</b>
                <small>
                  {p.lesson
                    ? (data?.lessons.find((l) => l.id === p.lesson)?.level ?? '입문') + ' 실습'
                    : '직접 만든 Workflow'}
                  {p.publicVersion && ' · 게시 v' + p.publicVersion}
                </small>
              </span>
              <span className="project-meta">
                <span className="project-visibility">{visibilityNames[p.visibility]}</span>
                <time className="project-date" dateTime={p.updated}>수정 {dateLabel(p.updated)}</time>
              </span>
              <ChevronRight size={16} />
            </button>
            {view === 'projects' && p.mine && (
              <div className="project-row-actions">
                <button type="button" className="project-share" data-share-project-id={p.id}
                  aria-label={p.title + ' 공유 설정'} aria-haspopup="dialog" onClick={() => void openListSharing(p.id)}>
                  <Link2 size={16} aria-hidden="true" />공유 설정
                </button>
                <button
                  type="button"
                  className="project-delete"
                  aria-label={p.title + ' 삭제'}
                  onClick={event => {
                    deleteTrigger.current = event.currentTarget;
                    setDeleteTarget(p);
                    modal('delete');
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />삭제
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    ) : (
      <div className="empty-state">
        <FolderOpen />
        <p>
          {search
            ? '검색 결과가 없습니다.'
            : view === 'shared'
              ? '아직 공유된 Agent가 없습니다.'
              : '아직 만든 Agent가 없습니다.'}
        </p>
        {search ? (
          <button className="btn" onClick={() => {
            setSearch('');
            rememberWorkspacePosition({search: ''});
            listSearch.current?.focus();
          }}>검색 지우기</button>
        ) : view !== 'shared' && (
          <button
            className="btn"
            onClick={newAgent}
          >
            <Plus size={15} />새 Agent 만들기
          </button>
        )}
      </div>
    );
  }
  function handleAccount() {
    withResourceLeave(() => {
      void action(async () => {
        await visitChain.current;
        await api('auth.logout');
        try { localStorage.setItem('studio:logout', crypto.randomUUID()); } catch { /* Sessions are also checked on return. */ }
        window.location.replace('/login');
      });
    });
  }
  function newAgent() {
    setNewTitle('');
    setImportFile(null);
    modal('create');
  }
  function openLesson(id: string, trigger: string) {
    visitLesson(id, trigger);
    setLessonId(id);
    modal('lesson');
  }
  function startGuideWork(id: WorkPurpose) {
    if (id === 'sw-requirements') {
      void creationAction(() => create({workDocument:id, title:'할 일 앱 요구사항'}));
      return;
    }
    const doc = workDocuments.find(item => item.id === id);
    if (doc) {
      setWorkDesign(previous => previous?.doc.id === doc.id ? previous : {doc, prompt:doc.prompt});
      modal('work-ai');
    }
  }
  function openGuideTemplate(id: string) {
    modal('');
    withResourceLeave(() => {
      if (selected || view !== 'templates') changeView('templates');
      openLesson(id, id);
    });
  }
  function startGuidePractice(practice: 'example' | 'blank') {
    if (practice === 'example') {
      const options = {fromGuide:true, guideStep:guidePosition.step};
      if (exampleProject) {
        if (exampleProject.id === guideOrigin?.projectId) {
          requestedPractice.current = {projectId:exampleProject.id, step:guidePosition.step};
          return returnFromGuide();
        }
        return void open(exampleProject, options);
      }
      return void creationAction(async () => {
        const project = await create({lesson:'intro'}, options);
        setGuideExampleId(project.id);
        try { localStorage.setItem(exampleKey, project.id); } catch { /* Tab state retains this project. */ }
      });
    }
    modal('');
    withResourceLeave(() => void creationAction(() =>
      create({ title: '도서관 안내 설계 실습', lesson: blankPracticeLessonId })));
  }
  function startLibraryLesson() {
    void creationAction(() => create({ lesson: 'beginner' }));
  }
  function chooseCreationTemplate() {
    navigate('templates');
    const title = newTitle.trim();
    setTemplateTitle(title);
    window.history.replaceState({...window.history.state, templateCreateTitle:title}, '', window.location.href);
  }
  const typedTitle = newTitle.trim();
  const ownDesign = homeDesign?.owner === accountId ? homeDesign : undefined;
  const currentDesign = ownDesign?.title === typedTitle ? ownDesign : undefined;
  const prompt = currentDesign?.prompt ?? '';
  const guideDesign = dialog === 'work-ai' ? workDesign : undefined;
  const designSurface = guideDesign ? 'guide' : 'home';
  const pendingProposal = (dialog === 'ai' || guideDesign) ? proposalTicket(designSurface) : undefined;
  const namedCreation = (title: string, fallback: string) => title ? '‘' + title + '’ 만들기' : fallback;
  if (!data)
    return (
      <main className="loading">
        <Workflow size={36} />
        <h1>Workflow Studio</h1>
        <p role="status">{loadFailure || '작업실을 여는 중입니다…'}</p>
        {loadFailure && (
          <button className="btn" onClick={() => location.reload()}>
            다시 열기
          </button>
        )}
      </main>
    );
  const inEditor = selected?.mine && dialog !== 'public' && dialog !== 'run';
  const versionProject = versionPanel?.listProject ?? selected;
  const currentSession = editing.current;
  const guide = selected && projectLesson(selected, data.lessons);
  const resume = data.resume;
  const homeFocus = resume && validEditorFocus(resume.graph, resume.editorFocus);
  const homeGuide = resume ? projectLesson(resume, data.lessons) : data.lessons.find(item => item.id === 'beginner');
  const exampleId = guideOrigin?.projectLessonId === 'intro' ? guideOrigin.projectId : guideExampleId;
  const exampleProject = data.projects.find(p => p.id === exampleId && p.mine && p.lesson === 'intro');
  function openHomeEditor() {
    if (resume) void open(resume);
    else startLibraryLesson();
  }
  const listedDeleteTarget = dialog === 'delete' && deleteTarget
    ? mine.find(project => project.id === deleteTarget.id) : undefined;
  const deleteTargetChanged = deleteTarget && (
    listedDeleteTarget?.revision !== deleteTarget.revision ||
    listedDeleteTarget?.publicVersion !== deleteTarget.publicVersion ||
    listedDeleteTarget?.visibility !== deleteTarget.visibility
  );
  return (
    <DialogFeedback.Provider value={{ error, status: toast }}>
      {inEditor && currentSession ? (
        <Editor
          key={selected.id + '-' + editorEntry.key}
          initialMenuAction={editorEntry.initialAction}
          initialSharedAsset={editorEntry.sharedAsset}
          initialIssue={editorEntry.issue}
          onReopenDraft={editorEntry.archivedRevision === undefined ? undefined : () => restoreDraft({archive:editorEntry.archivedRevision!})}
          project={savedDesigns?.projectId === selected.id ? {...selected, savedVersions:savedDesigns.versions} : selected}
          saveDraftRef={saveEditorDraft}
          historyRef={editorPop}
          sourceOutputRef={editorSourceOutput}
          lesson={guide ?? undefined}
          onLessonGuide={step => openGuide(true, step)}
          fromGuide={editorEntry.fromGuide}
          initialGuideStep={editorEntry.guideStep}
          assets={data.assets}
          onRefreshAssets={async () => { await refresh(); }}
          onSave={(graph, title) => save(graph, title, currentSession)}
          getDraftRevision={()=>currentSession.project.revision}
          onSaveReference={(name, content) => saveReferenceDocument(selected.id, name, content)}
          initialFocus={selected.editorFocus}
          onFocusChange={focus => rememberFocus(currentSession, focus)}
          onPropose={(text, graph, answer) => requestProposal('editor', text, graph, undefined, answer)}
          onShare={() => void versions('share')}
          onVersions={() => void versions('versions')}
          onHome={() => navigate('home')}
          onNavigate={navigate}
          onGuidePractice={startGuidePractice}
          onOpenTemplate={openGuideTemplate}
          user={data.user}
          onAccount={handleAccount}
        />
      ) : (
        <div className="studio-shell">
          <WorkspaceNav active={view} user={data.user} open={drawer} onClose={() => setDrawer(false)}
            onNavigate={navigate} onMenuAction={handleMenuAction} onAccount={handleAccount} busy={busy} />
          <div className="workspace-main">
            <header className="workspace-top">
              <WorkspaceMenuButton open={drawer} onOpen={() => setDrawer(true)} />
              <span className="workspace-parent">내 워크스페이스</span>
              <ChevronRight size={14} />
              <strong>{paths[view]}</strong>
              <div className="topgrow" />
              {view === 'home' && <button className="btn new-at-home" onClick={newAgent}><Plus size={15} />새 Agent</button>}
              <span
                className={'system-status' + (data.modelReady ? '' : ' off')}
              >
                <i />
                {data.modelReady ? '모델 설정됨' : '모델 설정 필요'}
              </span>
            </header>
            <main id="workspace-content" tabIndex={-1} className={view === 'home' ? 'workspace-home' : 'workspace-content'}>
              {view === 'guide' && <GuidePage {...guidePosition}
                lessons={data.lessons} lesson={guideOrigin?.lesson} userId={data.user.id}
                onNavigate={goToGuideSection} onOpenTemplate={openGuideTemplate} onStartWork={startGuideWork}
                hasExample={Boolean(exampleProject)} practiceProjectId={exampleProject?.id} modelReady={data.modelReady}
                onStartExample={() => startGuidePractice('example')}
                onStartBlank={() => startGuidePractice('blank')} busy={busy} onReturn={returnFromGuide}
                returnLabel={guideOrigin?.projectId ? (guideOrigin.projectLessonId === 'intro' || guideOrigin.projectLessonId === blankPracticeLessonId ? '현재 단계로 돌아가기' : '편집으로 돌아가기')
                  : guideOrigin ? paths[guideOrigin.view] + ' 돌아가기' : '작업실 홈으로 돌아가기'} />}
              {view === 'editor' && (resolvingEditor ? <p role="status">마지막 프로젝트를 확인하고 있습니다…</p> :
                <section className="editor-start" aria-labelledby="editor-start-title">
                  <div className="section-heading first">
                    <div>
                      <h1 id="editor-start-title">Workflow 편집기</h1>
                      <p>편집할 프로젝트를 고르거나 새로 시작하세요.</p>
                    </div>
                  </div>
                  <button type="button" aria-labelledby="choose-project" onClick={() => navigate('projects')}>
                    <FolderOpen aria-hidden="true" />
                    <span><strong id="choose-project">프로젝트 선택</strong><small>내 Agent 목록에서 편집할 프로젝트를 엽니다.</small></span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                  <button type="button" aria-labelledby="create-agent" onClick={newAgent}>
                    <Plus aria-hidden="true" />
                    <span><strong id="create-agent">새 Agent 만들기</strong><small>이름을 정하고 설계를 시작할 방법을 고릅니다.</small></span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                  <button type="button" aria-labelledby="start-library" disabled={busy} onClick={startLibraryLesson}>
                    <BookOpen aria-hidden="true" />
                    <span><strong id="start-library">도서관 실습 시작하기</strong><small>‘내 자료로 안내하기’ 사본에서 도서관 이용규정을 직접 수정합니다.</small></span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                </section>
              )}
              {view === 'home' && (
                <>
                  <WorkspaceHome project={resume ? { title: resume.title, graph: subgraph(resume.graph, homeFocus?.path ?? []) } : null}
                    lesson={homeGuide} selection={homeFocus?.selection} onOpen={openHomeEditor}
                    onNew={newAgent} onTemplates={() => navigate('templates')} busy={busy} />
                  <div className={desk.more}>
                  <section>
                    <div className="section-heading">
                      <div>
                        <h2>수준별 템플릿</h2>
                      </div>
                      <button
                        className="plain"
                        onClick={() => navigate('templates')}
                      >
                        전체 보기 <ArrowRight size={15} />
                      </button>
                    </div>
                    {lessonList(lessonsByLevel.slice(0, 3))}
                    {!resume && <div className={desk.quickPractice}>
                      <button className="plain" data-lesson-trigger="home-intro" onClick={() => openLesson('intro', 'home-intro')}>입문 실습 보기</button>
                      <button className="plain" disabled={busy} onClick={openHomeEditor}>도서관 실습 시작하기<ArrowUpRight size={15} aria-hidden="true"/></button>
                    </div>}
                  </section>
                  <section>
                    <div className="section-heading">
                      <div>
                        <h2>최근 Agent</h2>
                      </div>
                      <button
                        className="plain"
                        onClick={() => navigate('projects')}
                      >
                        내 Agent <ArrowRight size={15} />
                      </button>
                    </div>
                    {projects(mine.slice(0, 4))}
                  </section>
                  <form className="home-proposal" onSubmit={e => {
                    e.preventDefault(); setNewTitle(''); modal('ai');
                  }}>
                    <label htmlFor="home-agent-prompt">AI로 새 Agent 설계하기</label>
                    <div><input id="home-agent-prompt" aria-label="만들고 싶은 Agent" value={ownDesign?.title === '' ? ownDesign.prompt : ''}
                      onChange={e => setHomeDesign({owner:accountId, title:'', prompt:e.target.value})} placeholder="어떤 일을 맡기고 싶으세요?" />
                      <button className="icon-btn" aria-label="AI 설계 제안 열기"><ArrowRight size={18}/></button></div>
                  </form>
                  </div>
                </>
              )}
              {view === 'templates' && (
                <>
                  <div className="section-heading first">
                    <div>
                      <h1>수준별 템플릿</h1>
                      <p>
                        내가 만들 결과를 보고 실습을 고르세요. 내 사본에서 자료와 작업 지시를 바꿀 수 있습니다.
                      </p>
                    </div>
                  </div>
                  <div className={'filter-chips ' + desk.filters} role="group" aria-label="실습 수준">
                    {['전체', ...levels].map((v) => (
                      <button
                        key={v}
                        aria-pressed={filter === v}
                        onClick={() => { setFilter(v); rememberWorkspacePosition({level:v}); }}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <p className={desk.count} role="status">{visibleLessons.length}개 실습</p>
                  {lessonList(visibleLessons)}
                </>
              )}
              {(view === 'projects' || view === 'shared') && (
                <>
                  <div className="section-heading first">
                    <div>
                      <h1>{view === 'projects' && inTrash ? '휴지통' : paths[view]}</h1>
                      {!inTrash && <p>{view === 'projects' ? '내가 만든 Agent를 열고 공유 범위를 관리합니다.' : '공유된 Agent의 게시 버전을 확인하고 사용합니다.'}</p>}
                    </div>
                    {view === 'projects' && (
                      <div className="project-folder-actions">
                        {folderLink('projects', !inTrash)}
                        {!inTrash && (
                          <button className="btn primary" onClick={newAgent}>
                            <Plus size={16} />새 Agent
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {view === 'projects' && inTrash ? (
                    <ProjectTrash key={data.user.id} onRestore={restoreFromTrash} />
                  ) : (
                    <>
                      <label className="project-search-label" htmlFor="project-search">Agent 이름 검색</label>
                      <div className="list-search">
                        <Search size={16} aria-hidden="true" />
                        <input
                          id="project-search"
                          ref={listSearch}
                          value={search}
                          onChange={e => { setSearch(e.target.value); rememberWorkspacePosition({search:e.target.value}); }}
                        />
                      </div>
                      {projects(view === 'projects' ? mine : shared)}
                    </>
                  )}
                </>
              )}
              {(view === 'assets' || view === 'shared-assets') && (inTrash ? (
                <AssetTrash key={data.user.id} folderLink={folderLink('assets', false)} onRestore={restoreAssetFromTrash} />
              ) : (
                <ResourceLibrary
                  key={data.user.id + ':' + view}
                  sharedCatalog={view === 'shared-assets'}
                  assets={view === 'shared-assets' ? data.sharedAssets : data.assets}
                  onConnect={(asset, version) => {
                    setPendingPin({id:asset.id, kind:asset.kind, name:asset.name, version});
                    modal('pickConnect');
                  }}
                  onOpenCopy={copy => {
                    openResourceRoute({id:copy.id, edition:String(copy.version)}, false, 'assets');
                    notify('내 자료에 독립 사본을 만들었습니다.');
                  }}
                  onReceive={asset=>{
                    refreshGeneration.current++;
                    setData(current=>current?.user.id===data.user.id?{...current,
                      sharedAssets:[...current.sharedAssets.filter(item=>item.id!==asset.id),asset]
                        .sort((a,b)=>a.name.localeCompare(b.name,'ko')),
                      assets:[...current.assets.filter(item=>item.id!==asset.id),asset]
                        .sort((a,b)=>a.name.localeCompare(b.name,'ko'))}:current);
                  }}
                  leaveGuard={resourceLeaveGuard}
                  searchRef={listSearch}
                  folderLink={view === 'assets' ? folderLink('assets', true) : null}
                  onDeleted={onAssetDeleted}
                  onRoute={openResourceRoute}
                  isAdmin={Boolean(data.admin)}
                  api={api}
                  onChange={async () => { await refresh(); }}
                  initial={assetLink?.id}
                  initialVersion={assetLink?.edition}
                  token={assetLink?.token}
                />
              ))}
            </main>
          </div>
        </div>
      )}
      {(dialog === 'pickImport' || dialog === 'pickConnect') && (
        <ProjectActionPicker action={dialog === 'pickConnect' ? 'connect' : 'import'}
          resourceLabel={pendingPin && dialog === 'pickConnect' ? '‘' + pendingPin.name + '’ ' + pendingPin.version + '판' : undefined}
          onClose={close} onSelect={openMenuProject} />
      )}
      {dialog === 'delete' && deleteTarget && (
        <Modal title="Agent 프로젝트 삭제" size="confirm" onClose={cancelDelete} initialFocus={cancelDeleteButton}
          dismissDisabled={busy} descriptionId="delete-project-summary" footer={<>
            <button type="button" className="btn" ref={cancelDeleteButton} disabled={busy} onClick={cancelDelete}>취소</button>
            <button type="button" className="btn danger" disabled={busy || Boolean(deleteTargetChanged)}
              onClick={() => void confirmDelete(deleteTarget)}>{busy ? '삭제 중…' : '프로젝트 삭제'}</button>
          </>}>
          <p id="delete-project-summary" className="delete-project-name">
            <strong>{deleteTarget.title}</strong> 프로젝트를 삭제할까요? 현재 공유 범위는 ‘{visibilityNames[deleteTarget.visibility]}’입니다.
          </p>
          <p>삭제 후 3일 동안 내 Agent의 휴지통에서 복구할 수 있습니다. 3일이 지나면 프로젝트가 자동으로 영구 삭제됩니다. 진행 중이거나 대기 중인 작업과 등록한 자동 시작은 중지됩니다.</p>
          {deleteTarget.publicVersion && deleteTarget.visibility !== 'private' && (
            <p>이 프로젝트의 공유 주소도 사용할 수 없게 됩니다.</p>
          )}
          {deleteTargetChanged && <p>목록이 변경되었습니다. 취소한 뒤 삭제할 프로젝트를 다시 확인하세요.</p>}
        </Modal>
      )}
      {dialog === 'create' && (
        <Modal title="새 Agent 만들기" onClose={close} size="form" dismissDisabled={busy}>
          {busy && <p role="status" className="creation-status">설계를 준비하고 있습니다…</p>}
          <label className="field">
            Agent 이름
            <input
              disabled={busy}
              maxLength={140}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="내 Agent"
            />
          </label>
          <button
            className="choice"
            disabled={busy}
            onClick={() =>
              void creationAction(() => create({ title: typedTitle || '새 Agent' }))
            }
          >
            <PanelsTopLeft />
            <span>
              <b>빈 캔버스에서 시작</b>
              <small>{namedCreation(typedTitle, '블록을 직접 놓고 연결합니다.')}</small>
            </span>
            <ChevronRight />
          </button>
          <button
            className="choice"
            disabled={busy}
            onClick={() => {
              modal('ai');
            }}
          >
            <Waypoints />
            <span>
              <b>한 문장으로 시작</b>
              <small>AI가 제안한 설계를 확인한 뒤 적용합니다.</small>
            </span>
            <ChevronRight />
          </button>
          <button className="choice" disabled={busy} onClick={chooseCreationTemplate}>
            <BookOpen />
            <span>
              <b>수준별 템플릿에서 시작</b>
            </span>
            <ChevronRight />
          </button>
          <label className="file-import">
            기존 설계 JSON 가져오기
            <input
              type="file"
              accept=".json"
              disabled={busy}
              onChange={event => {
                setImportFile(event.target.files?.[0] ?? null);
                setError('');
              }}
            />
          </label>
          {importFile && missingImport?.file===importFile && <p role="alert">이 설계에는 {missingImport.missing.join(', ')} 자료가 필요합니다. 자료를 함께 가져오려면 원본 Agent에서 내 사본 만들기를 사용하세요.</p>}
          {importFile && <button className="btn primary" disabled={busy} onClick={() => void creationAction(async () => {
            const fileText = await importFile.text();
            let raw;
            try {
              raw = JSON.parse(fileText);
            } catch {
              throw new Error('설계 파일을 읽을 수 없습니다. 내보낸 설계 JSON 파일을 다시 선택하세요.');
            }
            if (!raw || typeof raw !== 'object' || Array.isArray(raw))
              throw new Error('설계가 들어 있는 JSON 파일을 선택하세요.');
            const graph = raw.graph ?? raw;
            const title = typedTitle || raw.title || importFile.name;
            const design=graph.nodes?.every((node: any) => node.config && Number.isFinite(node.x))?{graph,title}:{legacy:raw,title};
            if(missingImport?.file!==importFile){
              const missing=await api<string[]>('project.inspectImport',design);
              if(missing.length){setMissingImport({file:importFile,missing});return;}
            }
            await create(design);
          })}>{missingImport?.file===importFile?'자료 없이 설계 가져오기':namedCreation(typedTitle, '이 설계 가져오기')}</button>}
          <button
            className="plain"
            disabled={busy}
            onClick={() =>
              void creationAction(async () => {
                const old = localStorage.getItem(
                  'library-agent-studio.design.v2'
                );
                if (!old)
                  throw new Error('이 브라우저에 가져올 이전 시안이 없습니다.');
                await create({
                  legacy: JSON.parse(old),
                  title: typedTitle || '이전 도서관 설계',
                });
              })
            }
          >
            이 브라우저의 이전 시안{typedTitle ? '으로 ' + namedCreation(typedTitle, '') : ' 가져오기'}
          </button>
        </Modal>
      )}
      {(dialog === 'ai' || guideDesign) && (
        <Modal title={guideDesign ? guideDesign.doc.title + ' 설계하기' : '한 문장으로 Agent 만들기'} size="form" onClose={close} dismissDisabled={busy}>
          <HomeDesignProposal key={guideDesign?.doc.id ?? 'home'} prompt={guideDesign?.prompt ?? prompt}
            workDocument={guideDesign?.doc} onEdit={text => guideDesign ? setWorkDesign({...guideDesign, prompt:text, answer:undefined})
              : setHomeDesign({owner:accountId, title:typedTitle, prompt:text})}
            answer={guideDesign ? guideDesign.answer : currentDesign?.answer}
            onAnswer={answer => guideDesign
              ? setWorkDesign(current => current?.doc.id === guideDesign.doc.id ? {...current, answer} : current)
              : setHomeDesign({owner:accountId, title:typedTitle, prompt, answer})}
            material={guideDesign?.material ?? guideDesign?.doc.sample}
            onMaterialEdit={guideDesign ? material => setWorkDesign({...guideDesign, material}) : undefined}
            onClose={close} creating={busy}
            modelReady={data.modelReady} userId={data.user.id} pendingPayload={pendingProposal?.payload} pendingFollowUpFor={pendingProposal?.followUpFor}
            onBlank={() => void creationAction(async () => {
              await create({title:typedTitle || (currentDesign?.answer?.trim() || prompt.trim()).slice(0, 45) || '새 Agent'});
              setHomeDesign(undefined);
              finishProposal('home');
            })}
            onTemplates={chooseCreationTemplate}
            createLabel={guideDesign ? '내 Agent로 만들기' : namedCreation(typedTitle, '캔버스에 적용')}
            onRequest={(text, graph, signal, answer) => requestProposal(designSurface, text, graph, signal, answer)}
            onCreate={(graph, issue) => void creationAction(async () => {
              if (guideDesign) {
                await create({graph, title:guideDesign.doc.title, workDocument:guideDesign.doc.id}, {issue});
                setWorkDesign(undefined);
              } else {
                const task = currentDesign?.answer?.trim() || prompt.trim();
                const designed: Graph = {...graph, agentScope:{mode:'dedicated', purpose:newAgentPurpose(prompt, currentDesign?.answer, graph)}};
                await create({graph:designed, title:typedTitle || task.slice(0, 45)}, {issue});
                setHomeDesign(undefined);
              }
              finishProposal(designSurface);
            })} />
        </Modal>
      )}
      {dialog === 'lesson' && lesson && (
        <Modal title={lesson.title} displayHeading="실습 상세" onClose={close} size="settings" wide>
          <LessonHandout lesson={lesson} busy={busy} actionLabel={namedCreation(templateTitle, '내 사본으로 시작')}
            onStart={() => void creationAction(() => create({ lesson: lesson.id, title:templateTitle || undefined }))}
            setup={lesson.id === 'dynamic' && <DynamicLessonSetup busy={busy} label={namedCreation(templateTitle, '내 사본으로 시작')}
              onStart={dynamicPolicy => void creationAction(() => create({ lesson: lesson.id, title:templateTitle || undefined, dynamicPolicy }))} />}/>
        </Modal>
      )}
      {dialog === 'public' && selected && (
        <Modal title={selected.title} onClose={close} dismissDisabled={busy}>
          {sharingRevoked ? <p className="modal-error" role="alert">게시자가 공유를 철회했습니다</p> : <p>
            게시 버전 {selected.publicVersion ?? '없음'} ·{' '}
            {visibilityNames[selected.visibility]}
          </p>}
          <div className="row">
            <button
              className="btn primary"
              disabled={busy || sharingRevoked}
              onClick={() => void runSharedProjectAction(selected, 'run')}
            >
              <Play size={16} />
              {selected.mine && !selected.publicVersion ? '초안 시험' : 'Agent 사용'}
            </button>
            <button
              className="btn"
              disabled={busy || sharingRevoked}
              onClick={() => void runSharedProjectAction(selected, 'copy')}
            >
              <ClipboardCopy size={16} />내 사본 만들기
            </button>
          </div>
        </Modal>
      )}
      {(dialog === 'versions' || dialog === 'share') && (
        <Modal title={dialog === 'share' ? 'Agent 공유 설정' : '버전 및 복구'} size="settings" onClose={close} dismissDisabled={busy}>
          {versionProject && versionPanel ? (
            <ProjectVersionPanel
              key={versionPanel.key}
              project={versionProject}
              mode={dialog}
              initial={versionPanel.info}
              busy={busy}
              runAction={action}
              readSources={() => versionPanel.listProject ? undefined : editorSourceOutput.current?.()}
              onSaveVersion={async includeEdited => {
                const project = versionPanel.listProject ?? await projectForVersionChange(includeEdited);
                const saved = await saveProjectVersion(project);
                setSavedDesigns({projectId:project.id, versions:saved.versions});
                return saved;
              }}
              onRestore={restoreDraft}
              onSharingChanged={async updated => {
                applyProjectSharing(updated);
                await refresh();
              }}
              onDecisionRecorded={applyProjectSharing}
              onOpenShare={() => modal('share')}
            />
          ) : error ? sharingRow.current && (
            <button type="button" className="btn" onClick={event => {
              const row = sharingRow.current;
              event.currentTarget.closest('dialog')?.querySelector<HTMLButtonElement>('header button')?.focus();
              if (row) void openListSharing(row.id);
            }}>공유 설정 다시 불러오기</button>
          ) : <p role="status">공유 설정을 불러오는 중입니다…</p>}
        </Modal>
      )}
      {dialog === 'run' && selected && (
        <RunPanel
          key={selected.id+'.'+data?.user.id}
          viewerId={data?.user.id}
          project={selected}
          api={api}
          initialMode={selected.mine && !selected.publicVersion ? 'test' : 'live'}
          token={publicToken}
          sharingRevoked={sharingRevoked}
          onAccessDenied={sharedProject ? recheckAccess : undefined}
          onClose={close}
        />
      )}
      {((error && !dialog) || loadFailure) && (
        <div className="global-feedback" role="alert">
          {error || loadFailure}
          <button
            onClick={() => {
              setError('');
              setLoadFailure('');
            }}
            aria-label="알림 닫기"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {toast && !dialog && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
    </DialogFeedback.Provider>
  );
}
