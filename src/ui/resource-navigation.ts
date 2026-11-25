export type ResourceKind = 'document' | 'knowledge' | 'skill' | 'mcp';

export interface ResourceListPosition {
  scope: 'all' | 'mine' | 'shared' | 'public';
  kind: ResourceKind | 'all';
  query: string;
  focus?: string;
  scrollY: number;
}

export type ResourceRoute = { id: string; edition?: string; token?: string } | 'list' | 'trash';
export type ResourceView = 'assets' | 'shared-assets';
type Viewport = Pick<ResourceListPosition, 'scrollY' | 'focus'>;
const viewportPrefix = 'studio:resource-list:';

export function resourceListKey(): string {
  const existing = window.history.state?.studioResourceListKey;
  if (existing) return existing;
  const key = crypto.randomUUID();
  window.history.replaceState({ ...window.history.state, studioResourceListKey: key }, '');
  return key;
}

// popstate already points at the destination. Preserve the departing list's viewport
// under its own entry key, including when the visitor later reloads a detail page.
export function rememberResourceViewport(key: string, viewport: Viewport) {
  try {
    window.sessionStorage.setItem(viewportPrefix + key, JSON.stringify(viewport));
  } catch {
    // When tab storage is unavailable the history entry still holds the last clicked position.
  }
}

export function resourceListPosition(): ResourceListPosition {
  const state = window.history.state;
  const position = state?.studioResourceList ?? { scope: 'all', kind: 'all', query: '', scrollY: 0 };
  if (state?.studioResourceListKey) {
    try {
      const raw = window.sessionStorage.getItem(viewportPrefix + state.studioResourceListKey);
      if (raw) return { ...position, ...JSON.parse(raw) };
    } catch {
      // Restore the position recorded on the history entry.
    }
  }
  return position;
}

export function rememberResourceList(position: ResourceListPosition) {
  rememberResourceViewport(resourceListKey(), { scrollY: position.scrollY, focus: position.focus });
  window.history.replaceState({ ...window.history.state, studioResourceList: position }, '');
}

/** Returns false when Studio will receive the requested list through popstate. */
export function visitResource(route: ResourceRoute, replace = false, view: ResourceView = 'assets') {
  const current = new URLSearchParams(window.location.search);
  const sameView = (current.get('view') === 'shared-assets') === (view === 'shared-assets');
  const depth: number | undefined = sameView ? window.history.state?.studioResourceDepth : undefined;
  if (route === 'list' && depth) {
    if (replace) {
      // After a deletion the row can be missing. Set focus before Studio restores the list.
      window.addEventListener('popstate', () => {
        if (new URLSearchParams(window.location.search).get('view') === view) {
          rememberResourceList({ ...resourceListPosition(), focus: 'search' });
        }
      }, { once: true, capture: true });
    }
    window.history.go(-depth);
    return false;
  }

  const next = new URLSearchParams();
  if (view === 'shared-assets') next.set('view', view);
  if (typeof route === 'string') {
    next.set('view', view);
    if (route === 'trash') next.set('folder', 'trash');
  } else {
    next.set('asset', route.id);
    if (route.token) next.set('token', route.token);
    if (route.edition) next.set('edition', route.edition);
  }

  const address = '/?' + next.toString();
  const replacing = replace || route === 'list' || window.location.pathname + window.location.search === address;
  const fromList = current.get('view') === view && !current.has('folder') && !current.has('asset');
  let nextDepth: number | undefined;
  if (route !== 'list') {
    if (fromList) nextDepth = 1;
    else if (depth) nextDepth = replacing ? depth : depth + 1;
  }
  const position = resourceListPosition();
  const state = {
    ...(replacing ? window.history.state : {}),
    studioResourceListKey: sameView ? window.history.state?.studioResourceListKey : undefined,
    studioResourceList: sameView ? (replace && route === 'list' ? { ...position, focus: 'search' } : position) : undefined,
    studioResourceDepth: nextDepth,
  };
  if (replacing) window.history.replaceState(state, '', address);
  else window.history.pushState(state, '', address);
  return true;
}
