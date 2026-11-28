// Each browser history entry remembers the workspace list that the user left.
export interface WorkspacePosition {
  y: number;
  search?: string;
  level?: string;
  topic?: string;
  projectId?: string;
  lessonTrigger?: string;
  trashLink?: boolean;
  searchFocused?: boolean;
}

export function workspaceListAt(params: URLSearchParams) {
  if (['edit', 'agent', 'asset', 'folder', 'lesson'].some(key => params.has(key))) return null;
  const view = params.get('view') || 'home';
  return ['home', 'templates', 'projects', 'shared'].includes(view) ? view : null;
}

export function rememberedPosition(): WorkspacePosition | undefined {
  return window.history.state?.workspacePosition;
}

export function rememberWorkspacePosition(change: Partial<WorkspacePosition> = {}) {
  if (!workspaceListAt(new URLSearchParams(window.location.search))) return;
  const trigger = document.activeElement;
  const position: WorkspacePosition = {
    ...rememberedPosition(),
    y: window.scrollY,
    projectId: trigger instanceof HTMLElement ? trigger.closest<HTMLElement>('[data-project-id]')?.dataset.projectId : undefined,
    lessonTrigger: trigger instanceof HTMLElement ? trigger.closest<HTMLElement>('[data-lesson-trigger]')?.dataset.lessonTrigger : undefined,
    trashLink: trigger?.matches('a.project-folder-link') ?? false,
    searchFocused: trigger?.matches('.list-search input') ?? false,
    ...change,
  };
  window.history.replaceState({...window.history.state, workspacePosition: position}, '');
}

// The detail and its originating list share one policy draft, including after reload or Forward.
export function visitLesson(id: string, trigger: string) {
  rememberWorkspacePosition({lessonTrigger:trigger});
  const state = window.history.state ?? {};
  const listKey = state.lessonListKey || crypto.randomUUID();
  window.history.replaceState({...state, lessonListKey:listKey}, '');
  const address = new URL(window.location.href);
  address.searchParams.set('lesson', id);
  // Pass only workspace state so Next registers the detail URL after the list navigation.
  window.history.pushState({
    fromLessonList:true, lessonListKey:listKey, lessonPolicy:state.lessonPolicy,
    templateCreateTitle:state.templateCreateTitle, workspacePosition:state.workspacePosition,
  }, '', address);
}

export interface LessonPolicyDraft { total: string; simultaneous: string; failurePolicy: string; reselectLimit?: boolean }
function policyDraftKey(create: boolean) {
  const state = window.history.state ?? {};
  if (!state.lessonListKey) {
    if (!create) return null;
    window.history.replaceState({...state, lessonListKey:crypto.randomUUID()}, '');
  }
  return 'studio:lesson-policy:' + window.history.state.lessonListKey;
}
export function readLessonPolicy(): LessonPolicyDraft {
  let draft = window.history.state?.lessonPolicy;
  try {
    const key = policyDraftKey(false);
    const saved = key && sessionStorage.getItem(key);
    if (saved) draft = JSON.parse(saved);
  } catch { /* The detail entry also carries its draft when tab storage is unavailable. */ }
  return {total:draft?.total ?? '', simultaneous:draft?.simultaneous ?? '', failurePolicy:draft?.failurePolicy ?? '', reselectLimit:draft?.reselectLimit === true};
}
export function rememberLessonPolicy(draft: LessonPolicyDraft) {
  const key = policyDraftKey(true);
  window.history.replaceState({...window.history.state, lessonPolicy:draft}, '');
  try { if (key) sessionStorage.setItem(key, JSON.stringify(draft)); } catch { /* The detail entry retains its draft. */ }
}

export function trackWorkspacePosition(view: string) {
  function capture() {
    if (workspaceListAt(new URLSearchParams(window.location.search)) === view && !document.querySelector('dialog[open]'))
      rememberWorkspacePosition();
  }
  document.addEventListener('focusin', capture);
  document.addEventListener('scrollend', capture);
  window.addEventListener('pagehide', capture);
  return () => {
    document.removeEventListener('focusin', capture);
    document.removeEventListener('scrollend', capture);
    window.removeEventListener('pagehide', capture);
  };
}
