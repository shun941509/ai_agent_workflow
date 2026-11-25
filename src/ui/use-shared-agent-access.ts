import {useCallback, useEffect, useRef, useState} from 'react';
import {api} from './client';
import type {Project} from './studio-project';

// An open shared view keeps its conversation and draft mounted when access ends.
export function useSharedAgentAccess(project: Project | null, token?: string) {
  const [revokedProject, setRevokedProject] = useState<Project | null>(null);
  const currentCheck = useRef<(() => Promise<boolean>) | null>(null);
  const checkAccess = useCallback(() => currentCheck.current?.() ?? Promise.resolve(false), []);

  useEffect(() => {
    setRevokedProject(null);
    if (!project) return;
    const {id, shareGeneration} = project;
    const controller = new AbortController();
    let pending: Promise<boolean> | undefined;
    let revoked = false;

    function check() {
      if (revoked) return Promise.resolve(false);
      pending ??= api<{available: boolean}>('project.sharedAccess', {id, token, shareGeneration}, controller.signal)
        .then(({available}) => {
          if (controller.signal.aborted) return false;
          if (!available) {
            revoked = true;
            window.clearInterval(timer);
            setRevokedProject(project);
          }
          return available;
        }).catch(error => {
          if (controller.signal.aborted) return false;
          throw error;
        }).finally(() => { pending = undefined; });
      return pending;
    }
    function whenVisible() {
      // A temporary network failure leaves the current view intact until the next check.
      if (!document.hidden) void check().catch(() => {});
    }
    const timer = window.setInterval(whenVisible, 3000);
    currentCheck.current = check;
    document.addEventListener('visibilitychange', whenVisible);
    window.addEventListener('online', whenVisible);
    whenVisible();
    return () => {
      currentCheck.current = null;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', whenVisible);
      window.removeEventListener('online', whenVisible);
    };
  }, [project, token]);

  return {sharingRevoked: project !== null && project === revokedProject, checkAccess};
}
