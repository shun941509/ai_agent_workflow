import { CornerUpLeft, LocateFixed } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, Ref } from 'react';
import { compactDestinationLabels } from './graph';
import { color, PORT_DIRECTION_SIZE, type CanvasView, type DirectionBox } from './geometry';

export type RouteDestination = { id: string; title: string };

type RouteSelection = {
  ports: DirectionBox[];
  activeRouteId?: string;
  destinations: ReadonlyMap<string, readonly RouteDestination[]>;
};

type DetailProps = RouteSelection & {
  detailRef: Ref<HTMLDivElement>;
  viewedDestinationId?: string;
  onViewDestination: (id: string) => void;
  onReturnToRoute: () => void;
  onLeaveDetail: (backward: boolean) => void;
};

function revealDetailOption(option: HTMLElement | null) {
  const list = option?.closest<HTMLElement>('.ws-route-buttons');
  if (!option || !list) return;
  const frame = list.getBoundingClientRect(), item = option.getBoundingClientRect();
  // If the name is taller than the list, start at the short label and let the reader scroll.
  if (item.top < frame.top + 3 || item.height + 6 > frame.height) list.scrollTop += item.top - frame.top - 3;
  else if (item.bottom > frame.bottom - 3) list.scrollTop += item.bottom - frame.bottom + 3;
}

export function CanvasRouteDetail({ ports, activeRouteId, destinations, viewedDestinationId, detailRef,
  onViewDestination, onReturnToRoute, onLeaveDetail }: DetailProps) {
  const [previewId, setPreviewId] = useState<string>();
  const focusedOption = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (previewId) revealDetailOption(focusedOption.current);
  }, [previewId]);
  const routes = ports.flatMap(port => port.route ? [port.route] : []);
  const summaries = useMemo(() => new Map([...destinations].map(([id, targets]) => {
    const titles = targets.map(target => target.title);
    const labels = compactDestinationLabels(titles);
    const longest = titles.reduce((text, title) =>
      labels.get(title) !== title && title.length > text.length ? title : text, '');
    return [id, {labels, longest}] as const;
  })), [destinations]);
  if (!routes.length) return null;
  const viewed = activeRouteId && destinations.get(activeRouteId)?.find(item => item.id === viewedDestinationId);

  function navigateDetail(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const list = (event.target as HTMLElement).closest<HTMLElement>('.ws-route-buttons');
      if (list && list.scrollHeight > list.clientHeight) {
        // Native arrow scrolling can continue after Tab and hide the next focused button.
        event.preventDefault();
        list.scrollBy({top: event.key === 'ArrowDown' ? 40 : -40, behavior: 'instant'});
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onReturnToRoute();
    }
    if (event.key !== 'Tab') return;
    const buttons = [...event.currentTarget.querySelectorAll('button')];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = buttons[index + (event.shiftKey ? -1 : 1)];
    if (next) next.focus({preventScroll:true});
    else onLeaveDetail(event.shiftKey);
  }

  function showFullName(button: HTMLButtonElement, id: string) {
    focusedOption.current = button.closest<HTMLElement>('.ws-route-option');
    if (id === previewId) revealDetailOption(focusedOption.current);
    else setPreviewId(id);
  }

  return (
    <div className="ws-route-readout" ref={detailRef} data-awaiting-route={!activeRouteId || undefined}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPreviewId(undefined);
      }}>
      {/* Inactive details reserve their wrapped height without entering the focus order. */}
      {routes.map(route => {
        const active = route.id === activeRouteId;
        const targets = destinations.get(route.id) ?? [];
        const summary = summaries.get(route.id);
        return (
          <div key={route.id} className={'ws-route-pane' + (active ? ' ws-route-detail' : '')}
            role="group" aria-label="경로 상세" tabIndex={-1} inert={!active} aria-hidden={!active || undefined}
            onKeyDown={navigateDetail}>
            <div className="ws-route-title">
              <span>경로</span>
              <strong className={active ? 'ws-route-detail-name' : undefined}>{route.label}</strong>
            </div>
            <div className="ws-route-targets">
              <span>목적지 보기</span>
              <div className="ws-route-list-frame">
                {summary?.longest && <div className="ws-route-list-space" aria-hidden="true">
                  <div style={{paddingBlockStart: Math.min(targets.length, 8) * 32 + 6}}>{summary.longest}</div>
                </div>}
                <div className={'ws-route-buttons' + (active ? ' ws-route-detail-destinations' : '')}
                  tabIndex={-1} data-stacked={targets.length > 2 || !!summary?.longest || undefined}>
                  {targets.map(target => {
                    const label = summary?.labels.get(target.title) ?? target.title;
                    return <div className="ws-route-option" key={target.id}>
                      <button type="button" tabIndex={-1} disabled={!active}
                        data-route-destination={active ? target.id : undefined} aria-label={target.title + ' 목적지 보기'}
                        aria-current={active && target.id === viewedDestinationId ? 'location' : undefined}
                        onFocus={event => {
                          if (event.currentTarget.matches(':focus-visible')) showFullName(event.currentTarget, target.id);
                        }}
                        onClick={event => {
                          // Pointer focus precedes click: expand only once the button has received the click.
                          event.currentTarget.focus({preventScroll:true});
                          showFullName(event.currentTarget, target.id);
                          onViewDestination(target.id);
                        }}>
                        <LocateFixed size={14} aria-hidden="true" />{label}
                      </button>
                      {active && previewId === target.id && label !== target.title &&
                        <span className="ws-route-full-name">{target.title}</span>}
                    </div>;
                  })}
                </div>
              </div>
            </div>
            <button className="ws-route-return" type="button" tabIndex={-1} disabled={!active}
              data-route-return={active || undefined} onClick={onReturnToRoute}>
              <CornerUpLeft size={14} aria-hidden="true" />선택한 경로로 돌아가기
            </button>
          </div>
        );
      })}
      {!activeRouteId && <p>경로를 선택하면 전체 이름과 목적지를 볼 수 있습니다.</p>}
      <span className="ws-route-announcement" role="status" aria-atomic="true">
        {viewed && viewed.title + ' 목적지를 표시했습니다.'}
      </span>
    </div>
  );
}

export function CanvasPortDirections({ ports, view, activeRouteId, destinations, onSelectRoute }: RouteSelection & {
  view: CanvasView;
  onSelectRoute: (id: string | undefined) => void;
}) {
  const screenX = (x: number) => view.x + x * view.zoom;
  const screenY = (y: number) => view.y + y * view.zoom;
  const selectedPort = ports.find(port => port.route && port.route.id === activeRouteId);
  const rows = ports.filter(port => port.route && port !== selectedPort);
  if (selectedPort) rows.push(selectedPort);
  const hasRows = rows.length > 0;
  return (
    <div className="ws-direction-overlay" role={hasRows ? 'group' : undefined}
      aria-label={hasRows ? '출력 경로 추적' : undefined} aria-hidden={hasRows ? undefined : true}>
      {hasRows && <svg className="ws-route-callout-lines" focusable="false" aria-hidden="true">
        {rows.map(({route, kind}) => {
          if (!route) return null;
          const active = route.id === activeRouteId;
          const ends = { x1:screenX(route.source.x), y1:screenY(route.source.y),
            x2:screenX(route.bounds.x), y2:screenY(route.bounds.y + route.bounds.height / 2) };
          return <g key={route.id}>
            {active && <line className="ws-route-leader-rim" {...ends} />}
            <line className="ws-route-callout-leader" data-output-port={route.id} data-route-active={active || undefined}
              stroke={kind ? color[kind] : 'var(--ws-ink)'} {...ends} />
          </g>;
        })}
      </svg>}
      {ports.map(port => {
        const ink = port.kind ? color[port.kind] : 'var(--ws-ink)';
        const route = port.route;
        const arrow = (
          <svg key={port.direction + port.y} className="ws-port-direction" data-direction={port.direction} focusable="false" aria-hidden="true"
            viewBox="0 0 12 12" width={PORT_DIRECTION_SIZE} height={PORT_DIRECTION_SIZE}
            style={{color:ink, left:screenX(port.x), top:screenY(port.y)}}>
            <path d="M1.5 4.5H6V1.5L11 6 6 10.5V7.5H1.5Z" />
          </svg>
        );
        if (!route) return arrow;
        const { bounds } = route;
        const targetNames = destinations.get(route.id)?.map(target => target.title) ?? [];
        const description = [route.label, targetNames.join(' · ')].filter(Boolean).join(' → ');
        const selected = route.id === activeRouteId;
        return (
          <button key={route.id} type="button" tabIndex={-1} className="ws-route-callout" data-output-port={route.id}
            aria-pressed={selected} aria-label={description} title={description}
            onClick={event => {
              event.stopPropagation();
              onSelectRoute(selected ? undefined : route.id);
            }}
            onKeyDown={event => {
              if (event.key === 'Escape' && activeRouteId) {
                event.preventDefault();
                event.stopPropagation();
                onSelectRoute(undefined);
              }
            }}
            style={{left:screenX(bounds.x), top:screenY(bounds.y), width:bounds.width * view.zoom, height:bounds.height * view.zoom}}>
            {arrow}
            <span className="ws-route-callout-label">{route.displayLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
