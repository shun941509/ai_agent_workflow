import { useRef } from 'react';

type FocusTarget = HTMLElement | SVGElement;

export function useInspectorFocus() {
  const panel = useRef<HTMLDivElement>(null);
  const palette = useRef<HTMLElement>(null);
  const paletteOpener = useRef<FocusTarget | null>(null);
  const opener = useRef<FocusTarget | null>(null);

  function rememberOpener(trigger?: FocusTarget) {
    const target = trigger ?? document.activeElement;
    if (target && !panel.current?.contains(target) &&
        (target instanceof SVGElement || (target instanceof HTMLElement && target !== document.body))) {
      opener.current = target;
    }
  }
  function restoreFocus(which: 'palette' | 'inspector') {
    const target = which === 'palette' ? paletteOpener.current : opener.current;
    target?.focus();
    if (!target || document.activeElement !== target) {
      const selected = document.querySelector<HTMLElement | SVGElement>('[data-canvas-block][aria-pressed="true"], [data-canvas-wire][aria-pressed="true"]');
      const fallback = selected ?? document.querySelector<HTMLElement>('.ws-stage button:not(:disabled)');
      fallback?.focus();
    }
  }

  return { panel, palette, paletteOpener, opener, rememberOpener, restoreFocus };
}
