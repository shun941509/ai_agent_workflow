import {useCallback, useLayoutEffect, useRef, useState, type RefObject} from 'react';

export interface ResourceLeaveGuard {
  (proceed: () => void): void;
  handleHistory(event: PopStateEvent): boolean;
}

export function useResourceLeave(dirty: boolean, guard: RefObject<ResourceLeaveGuard | null>, discard: () => void) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const discarding = useRef(false);
  const ask = useCallback((proceed: () => void) => setPending(() => proceed), []);
  useLayoutEffect(() => {
    if (!dirty) return;
    discarding.current = false;
    const address = window.location.href;
    const entryState = window.history.state;
    const index = window.navigation?.currentEntry?.index;
    let replay: (() => void) | undefined;

    function beforeUnload(event: BeforeUnloadEvent) {
      if (discarding.current) return;
      event.preventDefault();
      event.returnValue = true;
    }
    function onPop(event: PopStateEvent) {
      if (discarding.current) return false;
      // Studio reads the new URL on popstate. Keep the form mounted until its owner chooses.
      event.stopImmediatePropagation();
      if (replay && window.location.href === address) {
        ask(replay);
        replay = undefined;
        return true;
      }
      const destination = window.navigation?.currentEntry?.index;
      if (index !== undefined && destination !== undefined && index !== destination) {
        const distance = destination - index;
        replay = () => window.history.go(distance);
        window.history.go(-distance);
      } else {
        window.history.pushState(entryState, '', address);
        ask(() => window.history.back());
      }
      return true;
    }
    guard.current = Object.assign((proceed: () => void) => ask(proceed), {handleHistory:onPop});
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      guard.current = null;
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [ask, dirty, guard]);
  function proceed(action: () => void) {
    if (dirty) ask(action);
    else action();
  }
  function discardAndProceed() {
    if (!pending) return;
    discarding.current = true;
    setPending(null);
    discard();
    pending();
  }
  return {proceed, pending: !!pending, keep: () => setPending(null), discardAndProceed};
}
