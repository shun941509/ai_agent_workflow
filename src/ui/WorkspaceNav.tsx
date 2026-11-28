'use client';

import { LogOut, Menu, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './editor/Icons';
import StudioMark from './StudioMark';
import { ThemeSwitch } from './ThemeSwitch';
import './workspace-nav.css';

export const workspaceLabels = {
  home: '작업실 홈',
  editor: 'Workflow 편집기',
  projects: '내 Agent',
  templates: '예제 템플릿',
  assets: '도구 및 자료',
  shared: '공유 Agent',
  'shared-assets': '공유 도구 및 자료',
  guide: '가이드',
} as const;

export type WorkspaceDestination = keyof typeof workspaceLabels;

export type WorkspaceMenuAction = 'import';

export function WorkspaceNav({
  active, user, onNavigate, onMenuAction, onAccount, busy = false,
}: {
  active: WorkspaceDestination;
  user: { login: string };
  onNavigate: (destination: WorkspaceDestination) => void;
  onMenuAction: (action: WorkspaceMenuAction) => void;
  onAccount: () => void;
  busy?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const rail = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) return;
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rail.current?.contains(event.target) &&
        !document.querySelector('dialog:modal')) setExpanded(false);
    }
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [expanded]);

  function closeMenu() {
    setExpanded(false);
    const button = toggle.current;
    if (button?.getClientRects().length) button.focus({preventScroll: true});
  }

  function navigate(destination: WorkspaceDestination) {
    if (expanded) closeMenu();
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
      <button type="button" aria-haspopup="dialog" onClick={() => onMenuAction(action)}>
        <Icon name={icon} />{label}
      </button>
    );
  }

  return (
    <>
      <a className="workspace-skip" href="#workspace-content" onClick={event => {
        const main = document.getElementById('workspace-content');
        if (main) { event.preventDefault(); main.focus(); }
      }}>본문으로 이동</a>
      <aside ref={rail} id="workspace-navigation" className="workspace-rail" data-menu-open={expanded || undefined}
        onKeyDown={event => {
          if (event.key !== 'Escape' || !expanded || !toggle.current?.getClientRects().length) return;
          event.preventDefault();
          closeMenu();
        }}
        onBlur={event => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) &&
            !document.querySelector('dialog:modal')) setExpanded(false);
        }}>
        <div className="workspace-rail-head">
          <button className="workspace-brand" type="button" aria-label="Workflow Studio 홈"
            onClick={() => navigate('home')}>
            <StudioMark />
            <span>Workflow <br />Studio</span>
          </button>
          <button ref={toggle} className="workspace-rail-toggle" type="button"
            aria-label="작업실 메뉴" aria-expanded={expanded} aria-controls="workspace-rail-content"
            onClick={() => setExpanded(!expanded)}>
            {expanded ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
            메뉴
          </button>
        </div>
        <div id="workspace-rail-content" className="workspace-rail-content">
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
            <ThemeSwitch />
            <div className="workspace-rail-identity">
              <span className="workspace-avatar"><UserRound size={17} aria-hidden="true" /></span>
              <div>
                <strong>{user.login}</strong>
                <small>개인 계정</small>
              </div>
            </div>
            <button className="workspace-logout" type="button" onClick={onAccount}>
              <LogOut size={15} aria-hidden="true" />
              로그아웃
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
