import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

const mobileQuery = '(max-width:680px)';
const paletteQuery = '(max-width:1130px)';
const viewport = () => window.matchMedia(mobileQuery).matches ? 'mobile'
  : window.matchMedia(paletteQuery).matches ? 'tablet' : 'desktop';
const desktopSnapshot = () => 'desktop';
function subscribeViewport(notify: () => void) {
  const queries = [mobileQuery, paletteQuery].map(query => window.matchMedia(query));
  queries.forEach(media => media.addEventListener('change', notify));
  return () => queries.forEach(media => media.removeEventListener('change', notify));
}

type FocusTarget = HTMLElement | SVGElement;

export function useInspectorFocus(pane: 'canvas' | 'palette' | 'inspector') {
  const size = useSyncExternalStore(subscribeViewport, viewport, desktopSnapshot);
  const mobile = size === 'mobile';
  const modal = mobile && pane === 'inspector';
  const paletteModal = size !== 'desktop' && pane === 'palette';
  const panel = useRef<HTMLDivElement>(null);
  const palette = useRef<HTMLElement>(null);
  const paletteOpener = useRef<FocusTarget | null>(null);
  const opener = useRef<FocusTarget | null>(null);
  const fallback = useRef<HTMLButtonElement>(null);
  const previous = useRef<'palette' | 'inspector' | null>(null);

  function rememberOpener(trigger?: FocusTarget) {
    const target = trigger ?? document.activeElement;
    if (target && panel.current?.contains(target)) return;
    opener.current = target instanceof SVGElement || (target instanceof HTMLElement && target !== document.body)
      ? target : fallback.current;
  }
  function restoreFocus(which: 'palette' | 'inspector') {
    const target = which === 'palette' ? paletteOpener.current : opener.current;
    target?.focus();
    if (!target || document.activeElement !== target) {
      const backup = which === 'palette' || (target && palette.current?.contains(target))
        ? document.querySelector<HTMLElement>('.ws-mobile-palette') : fallback.current;
      backup?.focus();
      if (document.activeElement !== backup) document.querySelector<HTMLElement>('.ws-node-body[aria-pressed="true"],.ws-stage button:not(:disabled)')?.focus();
    }
  }

  useLayoutEffect(() => {
    const activePane = paletteModal ? 'palette' : modal ? 'inspector' : null;
    const surface = activePane === 'palette' ? palette.current : panel.current;
    if (!activePane || !surface) {
      if (previous.current && pane === 'canvas') restoreFocus(previous.current);
      previous.current = null;
      return;
    }
    previous.current = activePane;
    const firstControl = () => surface.querySelector<HTMLElement>(paletteModal ? 'input[type="search"]' : '[role="tab"][aria-selected="true"]');
    if (!document.querySelector('dialog:modal')) firstControl()?.focus();
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !surface.contains(event.target) && !document.querySelector('dialog:modal')) {
        firstControl()?.focus();
      }
    };
    const cycleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented || document.querySelector('dialog:modal')) return;
      const candidates = surface.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary, [tabindex]');
      const controls = [...candidates].filter(el =>
        el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('details:not([open]) > :not(summary)') &&
        el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible'
      );
      const first = controls[0], last = controls.at(-1);
      const active = document.activeElement;
      if (!surface.contains(active) || active === (event.shiftKey ? first : last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('focusin', containFocus);
    document.addEventListener('keydown', cycleTab);
    return () => {
      document.removeEventListener('focusin', containFocus);
      document.removeEventListener('keydown', cycleTab);
    };
  }, [modal, paletteModal, pane]);

  return { mobile, modal, paletteModal, panel, palette, paletteOpener, opener, fallback, rememberOpener, restoreFocus };
}
