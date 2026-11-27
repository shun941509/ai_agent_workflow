'use client';

import { useEffect, useEffectEvent, useRef } from 'react';
import { LogOut, Menu, UserRound, X } from 'lucide-react';
import { Icon, type IconName } from './editor/Icons';
import StudioMark from './StudioMark';
import { cycleDialogFocus } from './dialog-focus';
import './workspace-nav.css';

export const workspaceLabels = {
  home: '작업실 홈',
  editor: 'Workflow 편집기',
  projects: '내 Agent',
  templates: '수준별 템플릿',
  assets: '도구 및 자료',
  shared: '공유 Agent',
  'shared-assets': '공유 도구 및 자료',
  guide: '가이드',
} as const;

export type WorkspaceDestination = keyof typeof workspaceLabels;

export type WorkspaceMenuAction = 'import';

const navigationId = 'workspace-navigation';

export function WorkspaceMenuButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="workspace-menu-button" aria-label="메뉴 열기"
      aria-expanded={open} aria-controls={navigationId} aria-haspopup="dialog" onClick={onOpen}>
      <Menu size={20} aria-hidden="true" />
    </button>
  );
}

export function WorkspaceNav({
  active, user, open, onClose, onNavigate, onMenuAction, onAccount, busy = false, inert = false,
}: {
  active: WorkspaceDestination;
  user: { login: string };
  open: boolean;
  onClose: () => void;
  onNavigate: (destination: WorkspaceDestination) => void;
  onMenuAction: (action: WorkspaceMenuAction) => void;
  onAccount: () => void;
  busy?: boolean;
  inert?: boolean;
}) {
  const drawer = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeOnResize = useEffectEvent(onClose);

  useEffect(() => {
    if (!open) return;
    const dialog = drawer.current;
    if (!dialog) return;
    const mobile = window.matchMedia('(max-width: 800px)');
    if (!mobile.matches) {
      closeOnResize();
      return;
    }
    dialog.showModal();
    closeButton.current?.focus();
    const handleResize = (event: MediaQueryListEvent) => {
      if (!event.matches) closeOnResize();
    };
    mobile.addEventListener('change', handleResize);
    return () => {
      mobile.removeEventListener('change', handleResize);
      if (dialog.open) dialog.close();
    };
  }, [open]);

  function closeDrawer() {
    if (open) {
      drawer.current?.close();
      onClose();
    }
  }

  function navigate(destination: WorkspaceDestination) {
    // The editor drawer has a browser-history entry. Going to the guide replaces that entry.
    if (!(active === 'editor' && destination === 'guide' && open)) closeDrawer();
    onNavigate(destination);
  }

  function pageButton(destination: WorkspaceDestination, icon: IconName) {
    return (
      <button type="button" data-guide-menu={destination === 'guide' || undefined} aria-current={active === destination ? 'page' : undefined}
        disabled={busy && destination === 'editor'} onClick={() => navigate(destination)}>
        <Icon name={icon} />{workspaceLabels[destination]}
      </button>
    );
  }

  function actionButton(action: WorkspaceMenuAction, label: string, icon: IconName) {
    return (
      <button type="button" aria-haspopup="dialog" onClick={() => {
        closeDrawer();
        onMenuAction(action);
      }}>
        <Icon name={icon} />{label}
      </button>
    );
  }

  const contents = (
    <>
      <div className="workspace-rail-head">
        <button className="workspace-brand" type="button" aria-label="Workflow Studio 홈"
          onClick={() => navigate('home')}>
          <StudioMark />
          <span>Workflow<br />Studio</span>
        </button>
        {open && (
          <button ref={closeButton} className="workspace-drawer-close" type="button"
            aria-label="메뉴 닫기" onClick={closeDrawer}>
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>
      <nav className="workspace-rail-links" aria-label="작업 화면">
        {pageButton('home', 'home')}
        {pageButton('editor', 'workflow')}
        {pageButton('projects', 'folder')}
        {pageButton('assets', 'file')}
        <div role="group" aria-labelledby="workspace-sharing-menu">
          <h2 id="workspace-sharing-menu">공유</h2>
          {pageButton('shared', 'users')}
          {pageButton('shared-assets', 'layers')}
        </div>
        <div role="group" aria-labelledby="workspace-examples-menu">
          <h2 id="workspace-examples-menu">예제</h2>
          {pageButton('templates', 'book')}
        </div>
        <div role="group" aria-labelledby="workspace-design-menu">
          <h2 id="workspace-design-menu">설계 도구</h2>
          {actionButton('import', '설계 가져오기', 'folder')}
          {pageButton('guide', 'info')}
        </div>
      </nav>
      <div className="workspace-rail-account">
        <div className="workspace-rail-identity">
          <span className="workspace-avatar"><UserRound size={17} aria-hidden="true" /></span>
          <div>
            <strong>{user.login}</strong>
            <small>개인 계정</small>
          </div>
        </div>
        <button type="button" onClick={() => { closeDrawer(); onAccount(); }}>
          <LogOut size={15} aria-hidden="true" />
          로그아웃
        </button>
      </div>
    </>
  );

  if (!open) {
    return <>
      <a className="workspace-skip" href="#workspace-content" inert={inert} onClick={event => {
        const main = document.getElementById('workspace-content');
        if (main) { event.preventDefault(); main.focus(); }
      }}>본문으로 이동</a>
      <aside id={navigationId} className="workspace-rail" inert={inert}>{contents}</aside>
    </>;
  }
  return (
    <dialog ref={drawer} id={navigationId} className="workspace-drawer" aria-label="작업실 메뉴" onKeyDown={cycleDialogFocus}
      onCancel={event => { event.preventDefault(); closeDrawer(); }}
      onClick={event => { if (event.target === event.currentTarget) closeDrawer(); }}>
      <div className="workspace-rail">{contents}</div>
    </dialog>
  );
}
