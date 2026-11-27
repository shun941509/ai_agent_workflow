import {useLayoutEffect, useRef} from 'react';

export type CopyResult = 'copied' | 'selected' | 'manual';

/** Shares the latest copy request across the read-only fields in one view. */
export function useCopyField(view?: object | null) {
  const latest = useRef(0);
  useLayoutEffect(() => () => { latest.current++; }, [view]);

  return async function copy(field: HTMLInputElement | null, button: HTMLButtonElement, report: (result: CopyResult) => void) {
    if (!field) return;
    const value = field.value;
    const request = ++latest.current;
    const initialFocus = document.activeElement;
    const isCurrent = () => request === latest.current && field.isConnected && field.value === value;
    try {
      await navigator.clipboard.writeText(value);
      if (isCurrent()) report('copied');
    } catch {
      if (!isCurrent()) return;
      const focused = document.activeElement;
      if (focused === button || focused === field || (focused === document.body && initialFocus === focused)) {
        field.focus();
        field.select();
        report('selected');
      } else {
        report('manual');
      }
    }
  };
}
