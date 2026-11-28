type CanvasMode = 'list' | 'diagram';

function preferenceKey(userId: string, projectId: string) {
  return 'workflow-studio:canvas-view:' + JSON.stringify([userId, projectId]);
}

export function preferredList(userId: string, projectId: string) {
  try {
    const mode = window.localStorage.getItem(preferenceKey(userId, projectId));
    if (mode === 'list' || mode === 'diagram') return mode === 'list';
  } catch {
    // Private or restricted browser sessions still get the appropriate initial view.
  }
  return false;
}

export function rememberCanvasMode(userId: string, projectId: string, mode: CanvasMode) {
  try {
    window.localStorage.setItem(preferenceKey(userId, projectId), mode);
  } catch {
    // Switching the view also works when this browser cannot persist the preference.
  }
}
