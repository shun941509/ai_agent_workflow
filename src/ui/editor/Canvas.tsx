'use client';
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboard, type PointerEvent as ReactPointer, type Ref } from 'react';
import type { Block, Graph } from '../../domain/index';
import { portsFor } from '../../domain/index';
import { BlockIcon, Icon } from './Icons';
import { CanvasPortDirections, CanvasRouteDetail, type RouteDestination } from './CanvasPortDirections';
import { Modal } from './Modal';
import type { WireChoiceSource } from './use-editor-history';
import { edgeNames, groupEdges, materialPreview, nodeCaption, nodeSummary, titleById, type EdgeGroup, type Selection } from './graph';

import { ROUTE_H, color, extent, fittedView, groupedWireGeometry, nearestWires, nodeLayout, overviewZoom, revealArea, revealBlock, route, selectedPortDirections, wireCaptions, type CanvasView, type Point } from './geometry';
import './schematic.css';

type Gesture = { kind: 'move' | 'pan' | 'wire'; pointerId: number; capture: HTMLElement; id?: string; outputId?: string; start: Point; origin: Point };
function touchPair(points: Map<number, Point>) {
  const [first, second] = points.values();
  if (!first || !second) return;
  return {
    x: (first.x + second.x) / 2, y: (first.y + second.y) / 2,
    distance: Math.hypot(first.x - second.x, first.y - second.y),
  };
}
type RouteOutput = ReturnType<typeof nodeLayout>['routes'][number];
type TracedRoute = {nodeId:string; outputId:string; visit?:{destination:string; origin:CanvasView}};
export type CanvasBookmark = {view: CanvasView; overview: boolean; manualZoom?: boolean; scroll: number};
export type CanvasListPosition = {scroll: number; selection: Selection};
export type CanvasHandle = {
  bookmark: () => CanvasBookmark;
  revealNode: (id: string) => void;
  focusItem: (selection: Selection) => void;
};
const lineNames = { flow: '실행 경로', data: '데이터 전달', reference: '참조' };
const browseKeys = ['PageUp', 'PageDown', 'Home', 'End'];
const browseShortcuts = browseKeys.join(' ');
function composing(event: ReactKeyboard) {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}
const canvasItemSelector = '[data-canvas-block],[data-canvas-wire]';
const zoomItemSelector = canvasItemSelector + ',.ws-port-out';
const zoomStep = 1.2;
const maxZoom = 2;

// Reserve the space below the canvas for the route details before a row opens them.
// The collapsed prompt stays small while every row that fits remains clear of the controls.
function routeViewport(rect: DOMRect, readout: HTMLElement | null) {
  if (!readout?.hasAttribute('data-awaiting-route')) return rect;
  const heights = Array.from(readout.querySelectorAll('.ws-route-pane'), pane => pane.getBoundingClientRect().height);
  const detailHeight = Math.max(readout.clientHeight, ...heights);
  return {width:rect.width, height:rect.height - (detailHeight - readout.clientHeight)};
}

function itemZoomPoint(item: Element, frame: DOMRect): Point | undefined {
  if (item.hasAttribute('data-canvas-wire')) {
    const path = item.querySelector<SVGPathElement>('.ws-channel');
    const matrix = path?.getScreenCTM();
    if (!path || !matrix) return;
    const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(matrix);
    return {x:point.x - frame.left, y:point.y - frame.top};
  }
  const bounds = (item.querySelector('.ws-output-dot') ?? item).getBoundingClientRect();
  return {x:bounds.left + bounds.width / 2 - frame.left, y:bounds.top + bounds.height / 2 - frame.top};
}

function connectionDescription(group: EdgeGroup) {
  const kind = group.kind === 'flow' && group.members.some(edge => edge.kind === 'data')
    ? '진행과 데이터 전달' : lineNames[group.kind];
  return group.caption && group.caption !== edgeNames[group.kind] ? kind + ' · ' + group.caption : kind;
}

interface Props {
  ref?: Ref<CanvasHandle>;
  returning?: {id: string; bookmark?: CanvasBookmark};
  initialListPosition?: CanvasListPosition;
  onListPosition: (position:CanvasListPosition) => void;
  graph: Graph;
  wireChoices: string[];
  wireSource?: WireChoiceSource;
  onWireChoicesChange: (ids: string[], source?: WireChoiceSource) => void;
  materialSources?: Readonly<Record<string, string>>;
  selection: Selection;
  list: boolean;
  onSelect: (sel: Selection) => void;
  onDeleteBlock: (id: string) => void;
  onMove: (id: string, p: Point, keyHold?: symbol) => void;
  onConnect: (from: string, to?: string, outputId?: string) => void;
  onAdd: () => void;
  onInspect: (trigger: HTMLElement | SVGElement) => void;
  revision?: number;
}
export function Canvas({
  ref,
  returning,
  initialListPosition,
  onListPosition,
  graph,
  wireChoices = [],
  wireSource,
  onWireChoicesChange,
  materialSources,
  selection,
  list,
  onSelect,
  onDeleteBlock,
  onMove,
  onConnect,
  onAdd,
  onInspect,
  revision,
}: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const labelPrefix = useId();
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const initialReturn = useRef(returning).current;
  const listFrame = useRef<HTMLDivElement>(null);
  const browsedItem = useRef<HTMLElement | SVGElement | null>(null);
  const lastZoomItem = useRef<Element | null>(null);
  const returnToWire = useRef<string | null>(null);
  const lastWireSource = useRef<WireChoiceSource | undefined>(undefined);
  const [focusedCard, setFocusedCard] = useState<string>();
  const [traceReplay, setTraceReplay] = useState(0);
  const [tracedRoute, setTracedRoute] = useState<TracedRoute>();
  const [navigationNotice, setNavigationNotice] = useState('');
  const listPosition = useRef<CanvasListPosition>(initialListPosition ?? {scroll:0, selection:null});
  const [view, setView] = useState<CanvasView>(initialReturn?.bookmark?.view ?? { x: 25, y: 25, zoom: 1 });
  const [drag, setDrag] = useState<({ id: string } & Point) | null>(null);
  const [wire, setWire] = useState<{ start: Point; end: Point } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<{ pair: NonNullable<ReturnType<typeof touchPair>>; view: CanvasView } | null>(null);
  const suppressPointerClick = useRef(false);
  const [dimension, setDimension] = useState({ width: 640, height: 500 });
  const fitted = useRef(false);
  const revealOverviewRows = useRef(false);
  const zoomMode = useRef<'readable' | 'overview' | 'manual'>(initialReturn?.bookmark?.manualZoom
    ? 'manual' : initialReturn?.bookmark?.overview ? 'overview' : 'readable');
  const lastRevision = useRef(revision);
  const justMoved = useRef(false);
  const heldArrow = useRef<{node:string; key:string; token:symbol} | null>(null);
  const wasEmpty = useRef(!graph.nodes.length);
  const groups = useMemo(() => groupEdges(graph), [graph]);
  const previews = useMemo(() => new Map(graph.nodes.map(node => [node.id, materialPreview(node, materialSources)])), [graph.nodes, materialSources]);
  const nodes = useMemo(() => drag
    ? graph.nodes.map(n => n.id === drag.id ? { ...n, x: drag.x, y: drag.y } : n)
    : graph.nodes, [drag, graph.nodes]);
  const b = useMemo(() => extent(nodes), [nodes]);
  const minZoom = Math.min(0.17, overviewZoom(b, dimension));
  const percent = view.zoom * 100;
  const zoomLabel = percent < 0.1 ? '<0.1%' : (percent < 1 ? Number(percent.toFixed(1)) : Math.round(percent)) + '%';
  const geometry = useMemo(() => groupedWireGeometry(groups, new Map(nodes.map(n => [n.id, n]))), [groups, nodes]);
  const labelFontSize = Math.max(12, 10.5 / view.zoom);
  const selectedNodeId = selection?.kind === 'node' ? selection.id : undefined;
  const portDirections = useMemo(() => selectedPortDirections(selectedNodeId, groups, geometry, view, dimension, nodes),
    [selectedNodeId, groups, geometry, view, dimension, nodes]);
  const activeRouteId = !list && tracedRoute && selectedNodeId === tracedRoute.nodeId &&
    portDirections.some(port => port.route?.id === tracedRoute.outputId) ? tracedRoute.outputId : undefined;
  useEffect(() => {
    if (tracedRoute && !activeRouteId) setTracedRoute(undefined);
  }, [tracedRoute, activeRouteId]);
  const destinations = useMemo(() => {
    const byOutput = new Map<string, RouteDestination[]>();
    for (const group of groups) {
      if (group.from !== selectedNodeId) continue;
      const paths = geometry.get(group.id)?.outputPaths;
      if (!paths?.size) continue;
      const target = {id:group.to, title:titleById(graph, group.to)};
      for (const output of paths.keys()) {
        const targets = byOutput.get(output);
        if (targets) targets.push(target);
        else byOutput.set(output, [target]);
      }
    }
    return byOutput;
  }, [groups, selectedNodeId, geometry, graph]);
  const activePaths = useMemo(() => {
    const paths = new Map<string, string>();
    if (activeRouteId) for (const group of groups) {
      const path = group.from === selectedNodeId && geometry.get(group.id)?.outputPaths.get(activeRouteId);
      if (path) paths.set(group.id, path);
    }
    return paths;
  }, [groups, selectedNodeId, geometry, activeRouteId]);
  const routeTargets = useMemo(() => new Set(groups.filter(group => activePaths.has(group.id)).map(group => group.to)), [groups, activePaths]);
  const viewedDestinationId = activeRouteId && tracedRoute?.visit && routeTargets.has(tracedRoute.visit.destination)
    ? tracedRoute.visit.destination : undefined;
  function selectRoute(outputId: string | undefined) {
    setTracedRoute(outputId && selectedNodeId ? {nodeId:selectedNodeId, outputId} : undefined);
  }
  function activateBlock(id: string) {
    setTracedRoute(undefined);
    if (id === selectedNodeId) setTraceReplay(count => count + 1);
    onSelect({kind:'node', id});
  }
  const frontId = drag?.id ?? focusedCard ?? viewedDestinationId;
  const overlapNames = useMemo(() => {
    const front = !list && nodes.find(node => node.id === frontId);
    if (!front) return [];
    const box = nodeLayout(front);
    return nodes.filter(node => {
      if (node.id === front.id) return false;
      const other = nodeLayout(node);
      return front.x < node.x + other.width && node.x < front.x + box.width &&
        front.y < node.y + other.height && node.y < front.y + box.height;
    }).map(node => titleById(graph, node.id));
  }, [frontId, nodes, graph, list]);
  const selectedGroup = selection?.kind === 'edge' && groups.find(group => group.id === selection.id);
  const anchorId = selectedNodeId ?? (selectedGroup ? selectedGroup.from : undefined);
  const captions = useMemo(() => wireCaptions(groups, geometry, nodes, labelFontSize, selectedNodeId, portDirections, activeRouteId),
    [groups, geometry, nodes, labelFontSize, selectedNodeId, portDirections, activeRouteId]);
  const routeRows = useMemo(() => portDirections.flatMap(port => port.route ? [port.route.bounds] : []), [portDirections]);
  const focus = useMemo(() => ({
    node: graph.nodes.find(node => node.id === anchorId),
    captions: [...routeRows, ...groups.flatMap(group => {
      const caption = group.kind === 'data' && group.to === selectedNodeId && captions.get(group.id);
      return caption ? [caption.bounds] : [];
    })],
  }), [graph.nodes, anchorId, selectedNodeId, groups, captions, routeRows]);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const previousFrame = useRef(dimension);
  useLayoutEffect(() => {
    const resized = previousFrame.current.width !== dimension.width || previousFrame.current.height !== dimension.height;
    previousFrame.current = dimension;
    if (!resized || !activeRouteId || !frame.current) return;
    if (viewedDestinationId) {
      revealRouteDestination(viewedDestinationId);
      return;
    }
    // A resize should keep the route being inspected in view.
    const focused = frame.current.querySelector<HTMLButtonElement>('.ws-route-callout:focus');
    const row = portDirections.find(port => port.route?.id === (focused?.dataset.outputPort ?? activeRouteId))?.route;
    if (row) setView(current => revealArea(current, dimension, row.bounds));
  }, [dimension, activeRouteId, portDirections, viewedDestinationId]);
  function revealRouteDestination(id: string) {
    const target = graphRef.current.nodes.find(node => node.id === id);
    const rect = frame.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height || !target) return;
    const box = {x:target.x, y:target.y, ...nodeLayout(target)};
    const path = frame.current?.querySelector<SVGPathElement>('[data-to="' + CSS.escape(id) + '"] > .ws-route-traced-path')?.getBBox();
    const source = graphRef.current.nodes.find(node => node.id === selectedNodeId);
    // Include the width of the source card beside its output, even on tall classifiers.
    const context = path && source
      ? [path, {x:source.x, y:path.y, width:nodeLayout(source).width, height:0}]
      : [];
    const map = frame.current?.querySelector('.ws-minimap')?.getBoundingClientRect();
    const topMargin = map ? Math.min(rect.height / 4, map.bottom - rect.top + 8) : 12;
    setView(current => {
      // Center the destination, then bring the highlighted line into view wherever it also fits.
      const centered = {x:rect.width / 2 - (box.x + box.width / 2) * current.zoom,
        y:rect.height / 2 - (box.y + box.height / 2) * current.zoom, zoom:current.zoom};
      return revealArea(centered, rect, box, context, 12, topMargin);
    });
  }
  function viewDestination(id: string) {
    if (!activeRouteId || !tracedRoute || !routeTargets.has(id)) return;
    setTracedRoute({...tracedRoute, visit:{destination:id, origin:tracedRoute.visit?.origin ?? view}});
    revealRouteDestination(id);
  }
  function returnToRoute() {
    if (!activeRouteId || !tracedRoute) return;
    const row = portDirections.find(port => port.route?.id === activeRouteId)?.route;
    const rect = frame.current?.getBoundingClientRect();
    if (!row || !rect) return;
    const button = frame.current?.querySelector<HTMLButtonElement>('.ws-route-callout[data-output-port="' + CSS.escape(row.id) + '"]');
    button?.focus({preventScroll:true});
    const origin = tracedRoute.visit?.origin;
    setView(current => revealArea(origin?.zoom === current.zoom ? origin : current, rect, row.bounds));
    if (tracedRoute.visit) selectRoute(row.id);
  }
  function itemElement(item: NonNullable<Selection>) {
    const attribute = item.kind === 'node' ? 'data-canvas-block' : 'data-canvas-wire';
    return frame.current?.querySelector<HTMLElement | SVGElement>('[' + attribute + '="' + CSS.escape(item.id) + '"]');
  }
  function revealNode(id: string) {
    if (listFrame.current) {
      itemElement({kind:'node',id})?.scrollIntoView({block:'nearest'});
      return;
    }
    const node = graphRef.current.nodes.find(item => item.id === id);
    const rect = frame.current?.getBoundingClientRect();
    if (rect?.width && node) {
      const available = routeViewport(rect, detailRef.current);
      setView(current => revealBlock(current, available, node, focusRef.current.node?.id === id ? focusRef.current.captions : []));
    }
  }
  function revealOutput(node: Block, outputId?: string) {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const layout = nodeLayout(node);
    const y = layout.routes.find(route => route.id === outputId)?.y ?? layout.portY;
    setView(current => revealArea(current, rect,
      {x:node.x + layout.width - 12, y:node.y + y - 12, width:24, height:24},
      [{x:node.x, y:node.y, width:layout.width, height:layout.height}]));
  }
  useImperativeHandle(ref, () => ({
    bookmark: () => ({view, overview: zoomMode.current === 'overview', manualZoom: zoomMode.current === 'manual',
      scroll: listFrame.current?.scrollTop ?? listPosition.current.scroll}),
    revealNode,
    focusItem(item) {
      const element = item ? itemElement(item) : frame.current?.querySelector<HTMLButtonElement>('.ws-canvas-empty button');
      element?.focus({preventScroll:true});
      if (listFrame.current) element?.scrollIntoView({block:'nearest'});
    },
  }), [view]);
  const selectedLine = selectedGroup && geometry.get(selectedGroup.id);
  const fit = useCallback(() => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const readable = zoomMode.current !== 'overview';
    revealOverviewRows.current = !readable;
    const next = fittedView(graphRef.current.nodes, rect, readable);
    const {node, captions} = focusRef.current;
    setView(readable && node ? revealBlock(next, routeViewport(rect, detailRef.current), node, captions) : next);
  }, []);
  const showOverview = useCallback(() => {
    zoomMode.current = 'overview';
    fit();
  }, [fit]);
  const revealSelection = useCallback(() => {
    const rect = frame.current?.getBoundingClientRect();
    const { node, captions } = focusRef.current;
    if (node && rect?.width && rect.height) {
      const available = routeViewport(rect, detailRef.current);
      setView(view => revealBlock(view, available, node, captions));
    }
  }, []);
  const zoomItem = useCallback(() => {
    const canvas = frame.current;
    const last = lastZoomItem.current;
    if (last && canvas?.contains(last)) return last;
    return canvas?.querySelector('.ws-world [aria-pressed="true"]');
  }, []);
  // Rows have a fixed screen size. Their world bounds are valid once the new overview zoom has rendered.
  useLayoutEffect(() => {
    if (!revealOverviewRows.current) return;
    revealOverviewRows.current = false;
    const rect = frame.current?.getBoundingClientRect();
    const node = focus.node;
    if (!list && routeRows.length && node && rect?.width && rect.height) {
      const available = routeViewport(rect, detailRef.current);
      setView(current => revealBlock(current, available, node, routeRows));
    }
  }, [view, routeRows, focus.node, list]);
  useLayoutEffect(() => {
    if (!frame.current) return;
    let previous = {width:0, height:0};
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      // Opening route details uses part of the stage without changing the user's fit scale.
      const stageHeight = frame.current?.parentElement?.clientHeight ?? rect.height;
      const changed =
        Math.abs(previous.width - rect.width) > 80 ||
        Math.abs(previous.height - stageHeight) > 120;
      previous = { width: rect.width, height: stageHeight };
      setDimension({width:rect.width, height:rect.height});
      if (rect.width && (!fitted.current || changed)) {
        if (!fitted.current && initialReturn?.bookmark) revealSelection();
        else if (zoomMode.current === 'manual') {
          const item = zoomItem();
          if (item?.hasAttribute('data-canvas-wire')) revealConnection(item);
          else if (item?.matches('.ws-port-out')) {
            const id = item.closest<HTMLElement>('[data-workflow-node]')?.dataset.workflowNode;
            const node = graphRef.current.nodes.find(node => node.id === id);
            if (node) revealOutput(node, (item as HTMLElement).dataset.outputPort);
          }
          else if (item instanceof HTMLElement && item.dataset.canvasBlock) revealNode(item.dataset.canvasBlock);
        } else fit();
        fitted.current = true;
      }
    });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [fit, initialReturn, revealSelection, zoomItem]);
  useLayoutEffect(() => {
    const panel = listFrame.current;
    if (panel) {
      const previous = listPosition.current;
      panel.scrollTop = previous.scroll;
      if (selection && (selection.id !== previous.selection?.id || selection.kind !== previous.selection.kind))
        itemElement(selection)?.scrollIntoView({block:'nearest'});
    }
    // Restore on entering list mode. Free scrolling within the list belongs to the user.
  }, [list]);
  const rememberList = () => {
    if (!listFrame.current) return;
    const position = {scroll:listFrame.current.scrollTop, selection};
    listPosition.current = position;
    onListPosition(position);
  };
  useLayoutEffect(() => {
    if (list) rememberList();
  }, [list, selection]);
  useLayoutEffect(() => {
    if (!initialReturn) return;
    const target = frame.current?.querySelector<HTMLButtonElement>('[data-canvas-block="' + CSS.escape(initialReturn.id) + '"]');
    const list = frame.current?.querySelector<HTMLElement>('.ws-graph-list');
    if (list) list.scrollTop = initialReturn.bookmark?.scroll ?? 0;
    target?.focus({preventScroll:true});
    if (target && list) target.scrollIntoView({block:'nearest'});
  }, [initialReturn]);
  useEffect(() => {
    if (lastRevision.current !== revision) showOverview();
    lastRevision.current = revision;
  }, [revision, showOverview]);
  useEffect(() => {
    if (wasEmpty.current && graph.nodes.length) fit();
    wasEmpty.current = !graph.nodes.length;
  }, [graph.nodes.length, fit]);
  useLayoutEffect(() => {
    if (fitted.current && !list && !gesture.current) revealSelection();
  }, [selectedNodeId, focus.node?.x, focus.node?.y, list, revealSelection]);
  const changeZoom = (action: 'in' | 'out' | 'reset') => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height || gesture.current || pinch.current) return;
    if ((action === 'out' && view.zoom <= minZoom) || (action === 'in' && view.zoom >= maxZoom)) return;
    const item = zoomItem();
    const point = item && itemZoomPoint(item, rect);
    const anchor = point && point.x >= 0 && point.x <= rect.width && point.y >= 0 && point.y <= rect.height
      ? point : {x:rect.width / 2, y:rect.height / 2};
    zoomMode.current = 'manual';
    setView(current => {
      const zoom = action === 'reset' ? 1 : action === 'in' ? Math.min(maxZoom, current.zoom * zoomStep)
        : Math.min(current.zoom, Math.max(minZoom, current.zoom / zoomStep));
      if (zoom === current.zoom) return current;
      const ratio = zoom / current.zoom;
      return {x:anchor.x - (anchor.x - current.x) * ratio, y:anchor.y - (anchor.y - current.y) * ratio, zoom};
    });
  };
  const relative = (clientX: number, clientY: number): Point => {
    const rect = frame.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.zoom,
      y: (clientY - rect.top - view.y) / view.zoom,
    };
  };
  const clearPreview = useCallback(() => {
    gesture.current = null;
    setWire(null);
    setDrag(null);
  }, []);
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      const active = gesture.current;
      if (event.key !== 'Escape' || !active) return;
      event.preventDefault();
      event.stopPropagation();
      suppressPointerClick.current = true;
      touches.current.delete(active.pointerId);
      clearPreview();
      if (active.capture.hasPointerCapture(active.pointerId)) active.capture.releasePointerCapture(active.pointerId);
    }
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [clearPreview]);
  const pointerDownCapture = (event: ReactPointer<HTMLDivElement>) => {
    if ((event.target as Element).closest('dialog')) return;
    setNavigationNotice('');
    browsedItem.current = null;
    if (list) return;
    if (!pinch.current) suppressPointerClick.current = false;
    if (event.pointerType !== 'touch') return;
    const points = touches.current;
    if (!points.size && (event.target as Element).closest('.ws-zoom,.ws-canvas-jumps')) return;
    points.set(event.pointerId, { x:event.clientX, y:event.clientY });
    const pair = touchPair(points);
    if (!pair) return;
    // Once a second finger lands, only the camera can move until every finger is lifted.
    if (points.size === 2) pinch.current = {pair, view};
    suppressPointerClick.current = true;
    clearPreview();
    for (const id of points.keys()) event.currentTarget.setPointerCapture(id);
    event.preventDefault();
    event.stopPropagation();
  };
  const start = (event: ReactPointer<HTMLElement>, kind: Gesture['kind'], node?: Block, output?: RouteOutput) => {
    if (event.button !== 0 || list || pinch.current || gesture.current) return;
    event.stopPropagation();
    justMoved.current = false;
    if (kind === 'move' && node) onSelect({ kind: 'node', id: node.id });
    let origin: Point = kind === 'pan' ? view : (node ?? { x: 0, y: 0 });
    if (kind === 'wire' && node) {
      const layout = nodeLayout(node);
      origin = { x: node.x + layout.width, y: node.y + (output?.y ?? layout.portY) };
      setWire({ start: origin, end: relative(event.clientX, event.clientY) });
    }
    gesture.current = { kind, pointerId:event.pointerId, capture:event.currentTarget, id: node?.id, outputId: output?.id, start: { x: event.clientX, y: event.clientY }, origin };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointer) => {
    const points = touches.current;
    if (points.has(event.pointerId)) {
      points.set(event.pointerId, {x:event.clientX, y:event.clientY});
      if (pinch.current) {
        const next = touchPair(points);
        if (next) {
          const {pair, view:initial} = pinch.current;
          const rect = event.currentTarget.getBoundingClientRect();
          const zoom = Math.max(minZoom, Math.min(maxZoom, initial.zoom * next.distance / (pair.distance || 1)));
          zoomMode.current = 'manual';
          setView({
            zoom,
            x:next.x - rect.left - (pair.x - rect.left - initial.x) * zoom / initial.zoom,
            y:next.y - rect.top - (pair.y - rect.top - initial.y) * zoom / initial.zoom,
          });
        }
        return;
      }
    }
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const dx = event.clientX - g.start.x,
      dy = event.clientY - g.start.y;
    if (g.kind === 'pan') {
      if (Math.hypot(dx, dy) > 3) justMoved.current = true;
      if (justMoved.current) setView((v) => ({ ...v, x: g.origin.x + dx, y: g.origin.y + dy }));
    }
    if (g.kind === 'move' && g.id && Math.abs(dx) + Math.abs(dy) > 3)
      setDrag({
        id: g.id,
        x: Math.round(g.origin.x + dx / view.zoom),
        y: Math.round(g.origin.y + dy / view.zoom),
      });
    if (g.kind === 'wire')
      setWire({ start: g.origin, end: relative(event.clientX, event.clientY) });
  };
  const finishTouch = (event: ReactPointer) => {
    touches.current.delete(event.pointerId);
    if (!pinch.current) return false;
    const remaining = touchPair(touches.current);
    if (remaining) pinch.current = {pair:remaining,view};
    if (!touches.current.size) pinch.current = null;
    return true;
  };
  const end = (event: ReactPointer) => {
    if (finishTouch(event)) return;
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    gesture.current = null;
    const distance = Math.hypot(event.clientX - g.start.x, event.clientY - g.start.y);
    if (g.kind === 'pan' && selection?.kind === 'edge' && !justMoved.current && distance <= 3) onSelect(null);
    if (g.kind === 'move' && g.id && (drag || distance > 3)) {
      justMoved.current = true;
      onMove(g.id, {
        x: Math.round(g.origin.x + (event.clientX - g.start.x) / view.zoom),
        y: Math.round(g.origin.y + (event.clientY - g.start.y) / view.zoom),
      });
    }
    if (g.kind === 'wire' && g.id) {
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-workflow-node]')
        ?.getAttribute('data-workflow-node');
      onConnect(g.id, target && target !== g.id ? target : undefined, g.outputId);
    }
    setWire(null);
    setDrag(null);
  };
  const cancel = (event: ReactPointer) => {
    if (finishTouch(event)) return;
    if (gesture.current?.pointerId === event.pointerId) {
      suppressPointerClick.current = true;
      clearPreview();
    }
  };
  const titleOf = (id: string) => titleById(graph, id);
  function choiceDescription(group: EdgeGroup) {
    if (!wireSource) return connectionDescription(group);
    const source = nodes.find(node => node.id === group.from);
    const routes = source && nodes.find(node => node.id === group.to)?.type !== 'error.handle'
      ? nodeLayout(source).routes.filter(route => group.members.some(e => e.kind === 'flow' && e.out === route.id))
      : [];
    const description = routes.length ? routes.map(route => route.label).join(' · ') + ' 경로' : connectionDescription(group);
    return (group.from === wireSource.node ? '보내는 연결 · ' : '받는 연결 · ') + description;
  }
  function selectWire(id: string, inspect = window.matchMedia('(max-width:680px)').matches) {
    const element = frame.current?.querySelector<SVGGElement>('g[data-canvas-wire="' + CSS.escape(id) + '"]');
    if (!element) return;
    if (wireChoices.length) onWireChoicesChange([]);
    element.focus({preventScroll:true});
    onSelect({kind:'edge', id});
    if (inspect) onInspect(element);
  }
  function revealConnection(element: Element, scroll: Point = {x:0, y:0}) {
    const line = element.querySelector<SVGPathElement>('path.ws-channel');
    const rect = frame.current?.getBoundingClientRect();
    if (!line || !rect?.width || !rect.height) return;
    const middle = line.getPointAtLength(line.getTotalLength() / 2);
    const bounds = line.getBBox();
    setView(current => revealArea({...current, x:current.x-scroll.x, y:current.y-scroll.y}, rect,
      {x:middle.x - 8, y:middle.y - 8, width:16, height:16}, [bounds]));
  }
  function focusCanvasItem(item: HTMLElement | SVGElement, browse = false) {
    // Returning from a dialog must preserve the distinction between a browsed item and the inspected one.
    if (browse) browsedItem.current = item;
    else if (document.activeElement !== item) browsedItem.current = null;
    item.focus({preventScroll:true});
    if (list) item.scrollIntoView({block:'nearest'});
    else if (item.dataset.canvasBlock !== undefined) revealNode(item.dataset.canvasBlock);
    else revealConnection(item);
  }
  useLayoutEffect(() => {
    const previous = lastWireSource.current;
    lastWireSource.current = wireChoices.length ? wireSource : undefined;
    if (wireChoices.length) return;
    const chosen = returnToWire.current;
    returnToWire.current = null;
    if (chosen) {
      const target = itemElement({kind:'edge',id:chosen});
      if (target) focusCanvasItem(target, true);
    } else if (previous && document.activeElement === document.body) {
      // A restored history entry may have opened the dialog without a focused trigger.
      const block = itemElement({kind:'node',id:previous.node});
      const outputs = block?.closest('[data-workflow-node]')?.querySelectorAll<HTMLButtonElement>('.ws-port-out');
      const output = outputs && [...outputs].find(el => previous.output === (el.dataset.outputPort ?? ''));
      if (output) output.focus({preventScroll:true});
      else if (block) focusCanvasItem(block, true);
    }
  }, [wireChoices, wireSource]);
  function jumpTo(kind: 'block' | 'wire') {
    const active = document.activeElement;
    const port = active?.closest<HTMLButtonElement>('.ws-port-out,.ws-route-callout');
    const focusedBlock = active?.getAttribute('data-canvas-block') ??
      (port?.matches('.ws-route-callout') ? selectedNodeId : port?.closest('[data-workflow-node]')?.getAttribute('data-workflow-node'));
    const focusedWire = active?.getAttribute('data-canvas-wire');
    const current = focusedBlock ? {kind:'node', id:focusedBlock} :
      focusedWire ? {kind:'edge', id:focusedWire} : selection;
    let preferred = current?.id;
    if (kind === 'block' && current?.kind === 'edge') preferred = groups.find(g => g.id === current.id)?.to;
    if (kind === 'wire' && current?.kind === 'node') {
      const route = port?.dataset.outputPort;
      const candidates = groups.filter(group => {
        if (!port) return group.from === current.id || group.to === current.id;
        if (group.from !== current.id) return false;
        if (!route) return true;
        return graph.nodes.find(node => node.id === group.to)?.type !== 'error.handle' &&
          group.members.some(edge => edge.kind === 'flow' && edge.out === route);
      });
      if (!candidates.length) {
        setNavigationNotice(titleOf(current.id) + (route ? '의 이 경로' : '') + '에 연결된 선이 없습니다.');
        return;
      }
      if (candidates.length > 1) {
        onWireChoicesChange(candidates.map(group => group.id), {node:current.id, output:port ? route ?? '' : undefined});
        return;
      }
      preferred = candidates[0].id;
    }
    const attr = kind === 'block' ? 'data-canvas-block' : 'data-canvas-wire';
    const target = (preferred ? frame.current?.querySelector<HTMLElement | SVGElement>('[' + attr + '="' + CSS.escape(preferred) + '"]') : null)
      ?? frame.current?.querySelector<HTMLElement | SVGElement>('[' + attr + ']');
    if (target) focusCanvasItem(target);
  }
  // The labels are painted above the world. Insert them into the keyboard order
  // between their block and its connection-editing buttons.
  function adjacentRouteControl(active: Element | null, backward: boolean) {
    if (!selectedNodeId || !routeRows.length || !frame.current || !active) return;
    const body = itemElement({kind:'node', id:selectedNodeId});
    const firstPort = body?.closest('[data-workflow-node]')?.querySelector<HTMLButtonElement>('.ws-port-out');
    if (!body || !firstPort) return;
    const controls: (HTMLElement | SVGElement)[] = [body];
    for (const row of frame.current.querySelectorAll<HTMLButtonElement>('.ws-route-callout')) {
      controls.push(row);
      if (row.dataset.outputPort === activeRouteId && detailRef.current)
        controls.push(...detailRef.current.querySelectorAll<HTMLButtonElement>('[data-route-destination],[data-route-return]'));
    }
    controls.push(firstPort);
    const index = controls.findIndex(item => item === active);
    if (index >= 0) return controls[index + (backward ? -1 : 1)];
  }
  function leaveRouteDetail(backward: boolean) {
    if (backward) return returnToRoute();
    const next = adjacentRouteControl(document.activeElement, false);
    if (tracedRoute?.visit) selectRoute(activeRouteId);
    next?.focus({preventScroll:true});
  }
  function navigateItems(event: ReactKeyboard<HTMLDivElement>) {
    const active = event.target;
    if (event.defaultPrevented || composing(event) || !(active instanceof Element) ||
      active !== document.activeElement || active.closest('dialog,[role="dialog"]')) return;
    if (event.key === 'Tab') {
      browsedItem.current = null;
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const next = adjacentRouteControl(active, event.shiftKey);
        if (next) {
          event.preventDefault();
          next.focus({preventScroll:true});
        }
      }
      return;
    }
    if (!list && graph.nodes.length && !event.ctrlKey && !event.metaKey && !event.altKey &&
      active.matches(zoomItemSelector + ',.ws-zoom button,.ws-canvas-jumps button')) {
      const action = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd' ? 'in'
        : event.key === '-' || event.code === 'NumpadSubtract' ? 'out' : event.key === '0' ? 'reset' : undefined;
      if (action) {
        event.preventDefault();
        changeZoom(action);
        return;
      }
    }
    if (event.shiftKey || event.altKey) return;
    if ((event.ctrlKey || event.metaKey) && active.matches(canvasItemSelector + ',.ws-port-out,.ws-route-callout')) {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      jumpTo(event.key === 'ArrowUp' ? 'block' : 'wire');
      return;
    }
    if (event.ctrlKey || event.metaKey || !active.matches(canvasItemSelector) || !browseKeys.includes(event.key)) return;
    const attr = active.hasAttribute('data-canvas-block') ? 'data-canvas-block' : 'data-canvas-wire';
    const items = [...event.currentTarget.querySelectorAll<HTMLElement | SVGElement>('[' + attr + ']')];
    const index = items.findIndex(item => item === active);
    const last = items.length - 1;
    let next = index;
    switch (event.key) {
      case 'Home': next = 0; break;
      case 'End': next = last; break;
      case 'PageUp': next = Math.max(0, index - 1); break;
      case 'PageDown': next = Math.min(last, index + 1); break;
    }
    event.preventDefault();
    focusCanvasItem(items[next], true);
  }
  function deleteFocusedBlock(event: ReactKeyboard<HTMLButtonElement>, id: string) {
    if (event.key !== 'Delete' || event.currentTarget !== document.activeElement ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || composing(event)) return;
    event.preventDefault();
    if (event.repeat) return;
    const buttons = Array.from(frame.current?.querySelectorAll<HTMLButtonElement>('button[data-canvas-block]') ?? []);
    const index = buttons.indexOf(event.currentTarget);
    const neighbor = buttons[index + 1] ?? buttons[index - 1];
    onDeleteBlock(id);
    requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      (neighbor?.isConnected ? neighbor : frame.current?.querySelector<HTMLButtonElement>('.ws-canvas-empty button'))?.focus();
    });
  }
  function outputButton(node: Block, output?: RouteOutput) {
    const label = titleOf(node.id) + (output ? ' · ' + output.label + ' 경로' : '') + '에서 연결 추가';
    const layout = nodeLayout(node);
    const portY = output?.y ?? layout.portY;
    return (
      <button key={output?.id} type="button" className={'ws-port-out' + (output ? ' ws-route-output' : '')}
        data-output-port={output?.id} aria-label={label} title={(output ? output.label + ' · ' : '') + '끌어서 연결 · 클릭해서 대상 선택'}
        data-route-active={activeRouteId && node.id === selectedNodeId && output?.id === activeRouteId || undefined}
        style={{ top: portY - 1, height: output && ROUTE_H }}
        onFocus={event => {
          if (event.currentTarget.matches(':focus-visible')) revealOutput(node, output?.id);
        }}
        onPointerDown={event => start(event, 'wire', node, output)}
        onClick={event => {
          event.stopPropagation();
          if (event.detail === 0) onConnect(node.id, undefined, output?.id);
        }}>
        {output && <span className="ws-route-label">{output.label}</span>}
        <span className="ws-output-dot" aria-hidden="true" />
      </button>
    );
  }
  return (<>
    <div
      ref={frame}
      className={'ws-canvas ws-schematic' + (list ? ' ws-canvas-list' : '')}
      aria-label="Workflow 캔버스"
      onFocusCapture={event => {
        const target = event.target as Element;
        if (target.matches('.ws-route-callout:focus-visible')) {
          const port = portDirections.find(port => port.route?.id === (target as HTMLElement).dataset.outputPort);
          const rect = event.currentTarget.getBoundingClientRect();
          const bounds = port?.route?.bounds;
          if (bounds) {
            const available = routeViewport(rect, detailRef.current);
            setView(current => revealArea(current, available, bounds));
          }
        }
        if (!target.closest('.ws-zoom')) lastZoomItem.current = target.matches(zoomItemSelector) &&
          target.closest('.ws-world') ? target : null;
        const card = target.closest<HTMLElement>('[data-workflow-node]');
        setFocusedCard(card?.dataset.workflowNode);
        setNavigationNotice('');
      }}
      onBlurCapture={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          lastZoomItem.current = null;
          setFocusedCard(undefined);
          setNavigationNotice('');
        }
      }}
      onScroll={event => {
        // Native focus and scrollIntoView can reveal a partially clipped block. Keep one camera
        // position for drawing, pointer coordinates and returning from a child Workflow.
        const element = event.currentTarget;
        if (list || event.target !== element || (!element.scrollLeft && !element.scrollTop)) return;
        const x = element.scrollLeft, y = element.scrollTop;
        element.scrollTo(0, 0);
        const wire = element.querySelector('.ws-wire:focus-visible');
        if (wire) revealConnection(wire, {x, y});
        else setView(current => ({...current, x:current.x - x, y:current.y - y}));
      }}
      onKeyDown={event => {
        if (composing(event) && (event.key === 'Enter' || event.key === ' ') &&
          (event.target as Element).matches(canvasItemSelector + ',.ws-port-out')) {
          // Native button activation must wait for the IME to finish, including its final Enter.
          event.preventDefault();
          return;
        }
        navigateItems(event);
      }}
      onClickCapture={event => {
        const target = event.target as Element;
        const modifiedKey = event.detail === 0 && (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) &&
          target.closest(canvasItemSelector + ',.ws-port-out');
        if (modifiedKey || (event.detail > 0 && suppressPointerClick.current && !target.closest('dialog'))) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerDownCapture={pointerDownCapture}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={cancel}
      onLostPointerCapture={event => {
        if (gesture.current?.pointerId === event.pointerId) cancel(event);
      }}
      onPointerDown={(e) => {
        if ((e.target as Element).closest('button,[role="button"],dialog,.ws-world,.ws-graph-list')) return;
        start(e, 'pan');
      }}
      onWheel={(e) => {
        if (!list && !e.ctrlKey && !e.metaKey && !(e.target as Element).closest('dialog')) {
          setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
        }
      }}
    >
      {groups.length > 0 && <div className="ws-canvas-jumps" role="group" aria-label="캔버스 키보드 이동">
        <button type="button" aria-keyshortcuts="Control+ArrowUp Meta+ArrowUp" title="Ctrl 또는 ⌘ + ↑" onClick={() => jumpTo('block')}>블록으로 이동</button>
        <button type="button" aria-keyshortcuts="Control+ArrowDown Meta+ArrowDown" title="Ctrl 또는 ⌘ + ↓" onClick={() => jumpTo('wire')}>연결선으로 이동</button>
      </div>}
      {!list && graph.nodes.length > 0 && (
        <>
          <div
            className="ws-world"
            style={{
              '--ws-trace-ring': (2 / view.zoom) + 'px',
              '--ws-screen-pixel': (1 / view.zoom) + 'px',
              transform: 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.zoom + ')',
            } as CSSProperties}
          >
            <svg className="ws-wires" aria-label="Workflow 연결">
              <defs>
                <marker id={labelPrefix + '-trace-arrow'} viewBox="0 0 10 10" refX="9" refY="5" orient="auto"
                  markerUnits="userSpaceOnUse" markerWidth={8 / view.zoom} markerHeight={8 / view.zoom}>
                  <path fill="context-stroke" d="M0 0L10 5L0 10z" />
                </marker>
                {Object.entries(color).map(([kind, c]) => (
                  <marker
                    key={kind}
                    id={'ws-arrow-' + kind}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="5.5"
                    markerHeight="5.5"
                    orient="auto"
                  >
                    <path fill={c} d="M0 0L10 5L0 10z" />
                  </marker>
                ))}
              </defs>
              {groups.map((g, index) => {
                const line = geometry.get(g.id);
                if (!line) return null;
                const caption = captions.get(g.id);
                const selected = selection?.kind === 'edge' && selection.id === g.id;
                const connected = activeRouteId ? activePaths.has(g.id) :
                  selection?.kind === 'node' && (selection.id === g.from || selection.id === g.to);
                const description = titleOf(g.from) + ' → ' + titleOf(g.to) + ' · ' + connectionDescription(g);
                const combinedPath = [line.d, ...line.stems].join(' ');
                return (
                  <g
                    key={g.id}
                    className="ws-wire"
                    data-from={g.from}
                    data-canvas-wire={g.id}
                    data-to={g.to}
                    data-kind={g.kind}
                    data-route-muted={activeRouteId && !connected || undefined}
                    data-highlighted={selected || connected}
                    role="button"
                    tabIndex={0}
                    aria-keyshortcuts={browseShortcuts}
                    aria-pressed={selected}
                    aria-label={description}
                    onFocus={event => { if (event.currentTarget.matches(':focus-visible')) revealConnection(event.currentTarget); }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      const matrix = e.currentTarget.getScreenCTM();
                      if (!matrix || e.detail === 0) { selectWire(g.id); return; }
                      const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
                      const candidates = nearestWires(geometry, point);
                      if (candidates.length > 1) onWireChoicesChange(candidates);
                      else selectWire(candidates[0] ?? g.id);
                    }}
                    onKeyDown={(e) => {
                      if (!composing(e) && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey &&
                        (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onSelect({ kind: 'edge', id: g.id });
                        onInspect(e.currentTarget);
                      }
                    }}
                  >
                    <title>{description}</title>
                    {selected && <path className="ws-wire-glow" d={combinedPath} />}
                    {/* Stroke width alone leaves a horizontal or vertical SVG button with zero-area bounds. */}
                    <circle cx={line.from.x} cy={line.from.y} r={8} fill="none" pointerEvents="none" aria-hidden="true" />
                    <path className="ws-wire-hit" d={combinedPath} />
                    <path className="ws-wire-keyboard-focus" d={combinedPath} aria-hidden="true" />
                    <g id={labelPrefix + '-line-' + index}>
                      {line.stems.length > 0 && <path d={line.stems.join(' ')} fill="none" stroke={color[g.kind]}
                        strokeWidth={selected || connected ? 2.5 : 1.7} />}
                      <path className="ws-channel" data-kind={g.kind} fill="none" d={line.d} stroke={color[g.kind]}
                        strokeWidth={selected || connected ? 2.5 : 1.7}
                        strokeDasharray={g.kind === 'data' ? '7 4' : g.kind === 'reference' ? '1.5 4' : undefined}
                        strokeLinecap="round" markerEnd={g.to === selectedNodeId ? 'none' : 'url(#ws-arrow-' + g.kind + ')'} />
                    </g>
                    {caption && (
                      <g opacity="0" pointerEvents="none"><g id={labelPrefix + index}>
                        {caption.labelAnchor && <line className="ws-wire-leader" x1={caption.labelAnchor.x} y1={caption.labelAnchor.y}
                          x2={caption.label.x} y2={caption.label.y + 3} />}
                        <text className="ws-wire-label" data-kind={g.kind} x={caption.label.x} y={caption.label.y}
                          style={{fontSize: labelFontSize}}>
                          {caption.text}
                        </text>
                      </g></g>
                    )}
                  </g>
                );
              })}
              {/* Paint selected routes above crossings without changing wire hit targets or tab order. */}
              {selectedNodeId && <g key={JSON.stringify([selectedNodeId, traceReplay, activeRouteId])} aria-hidden="true" pointerEvents="none">
                {groups.map((group, index) => {
                  if (group.from !== selectedNodeId && group.to !== selectedNodeId) return null;
                  const line = geometry.get(group.id);
                  if (!line) return null;
                  const traced = activePaths.get(group.id);
                  if (activeRouteId && !traced) return null;
                  const path = traced ?? [line.d, ...line.stems].join(' ');
                  return <g key={group.id} data-from={group.from} data-to={group.to} stroke={color[group.kind]}>
                    {traced ? <>
                      <path className="ws-route-traced-halo" d={path} />
                      <path className="ws-route-traced-path" data-output-port={activeRouteId} d={path}
                        markerEnd={'url(#' + labelPrefix + '-trace-arrow)'} />
                    </> : <>
                      <path className="ws-wire-trail-halo" d={path} />
                      <use href={'#' + labelPrefix + '-line-' + index} />
                    </>}
                    <path className="ws-wire-trace-rim" d={path} />
                    <path className="ws-wire-trace" d={path} />
                  </g>;
                })}
              </g>}
              {/* A visible caption directly identifies its wire, even above a crossing. */}
              {groups.map((g, index) => captions.has(g.id) &&
                <use key={g.id} href={'#' + labelPrefix + index} className="ws-caption-link"
                  opacity={activeRouteId && !activePaths.has(g.id) ? .48 : undefined}
                  aria-hidden="true" onPointerDown={e => e.stopPropagation()} onClick={() => selectWire(g.id)} />)}
              {wire && (
                <path
                  d={route(wire.start, wire.end)}
                  fill="none"
                  stroke="var(--ws-accent)"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                />
              )}
            </svg>
            {nodes.map((n) => {
              const ports = portsFor(n);
              const layout = nodeLayout(n);
              const preview = previews.get(n.id);
              return (
                <div
                  key={n.id}
                  data-workflow-node={n.id}
                  data-route-target={routeTargets.has(n.id) || undefined}
                  data-route-viewed={viewedDestinationId === n.id || undefined}
                  data-front={frontId === n.id || undefined}
                  data-material={n.type === 'resource.context' || undefined}
                  className={
                    'ws-node' + (selection?.kind === 'node' && selection.id === n.id ? ' ws-chosen' : '')
                  }
                  style={{ left: n.x, top: n.y, width: layout.width, height: layout.height }}
                >
                  <button
                    className="ws-node-body"
                    data-canvas-block={n.id}
                    style={layout.routes.length ? { height: layout.bodyHeight - 1 } : undefined}
                    aria-label={titleOf(n.id) + ' 블록 속성'}
                    aria-keyshortcuts={browseShortcuts}
                    title={n.type === 'resource.context' ? preview || titleOf(n.id) : layout.routes.length ? nodeCaption(n) : nodeSummary(n)}
                    aria-pressed={selection?.kind === 'node' && selection.id === n.id}
                    type="button"
                    onFocus={e => { if (browsedItem.current !== e.currentTarget) onSelect({kind:'node', id:n.id}); }}
                    onPointerDown={(e) => start(e, 'move', n)}
                    onClick={(e) => {
                      activateBlock(n.id);
                      if (!justMoved.current) {
                        // Reposition after the tap reaches this button, including at the canvas edge.
                        revealSelection();
                        if (window.matchMedia('(max-width:680px)').matches) onInspect(e.currentTarget);
                      }
                    }}
                    onDoubleClick={e => onInspect(e.currentTarget)}
                    onBlur={() => { heldArrow.current = null; }}
                    onKeyUp={e => {
                      if (heldArrow.current?.key === e.key) heldArrow.current = null;
                    }}
                    onKeyDown={(e) => {
                      if (composing(e) || e.altKey || e.ctrlKey || e.metaKey) return;
                      deleteFocusedBlock(e, n.id);
                      if (!e.shiftKey && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        activateBlock(n.id);
                        onInspect(e.currentTarget);
                      }
                      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                        e.preventDefault();
                        setNavigationNotice('');
                        onSelect({ kind: 'node', id: n.id });
                        const step = e.shiftKey ? 24 : 8;
                        if (!e.repeat || heldArrow.current?.node !== n.id || heldArrow.current.key !== e.key) {
                          heldArrow.current = {node:n.id, key:e.key, token:Symbol()};
                        }
                        onMove(n.id, {
                          x: n.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0),
                          y: n.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0),
                        }, heldArrow.current.token);
                      }
                    }}
                  >
                    <BlockIcon type={n.type} />
                    <span className="ws-node-copy">
                      <strong>{titleOf(n.id)}</strong>
                    </span>
                    {preview && <small className="ws-material-preview">{preview}</small>}
                  </button>
                  {ports.inputs.length > 0 && <span className="ws-port-in" style={{ top: layout.portY - 1 }} aria-hidden="true" />}
                  {layout.routes.length ? layout.routes.map(output => outputButton(n, output)) : ports.outputs.length > 0 && outputButton(n)}
                </div>
              );
            })}
            {selectedLine && selectedGroup && (
              <>
                {selectedLine.sources.map(point => <span key={point.x + ',' + point.y} className="ws-wire-endpoint"
                  data-endpoint="source" data-node-id={selectedGroup.from} style={{ left: point.x, top: point.y }} aria-hidden="true" />)}
                <span className="ws-wire-endpoint" data-endpoint="target" data-node-id={selectedGroup.to}
                  style={{ left: selectedLine.to.x, top: selectedLine.to.y }} aria-hidden="true" />
              </>
            )}
          </div>
          <CanvasPortDirections ports={portDirections} view={view} activeRouteId={activeRouteId}
            destinations={destinations} onSelectRoute={selectRoute} />
          <svg
            className="ws-minimap"
            aria-hidden="true"
            viewBox={[b.x - 12, b.y - 12, b.w + 24, b.h + 24].join(' ')}
          >
            {nodes.map((n) => (
              <rect
                key={n.id}
                x={n.x}
                y={n.y}
                width={nodeLayout(n).width}
                height={nodeLayout(n).height}
                rx="4"
                fill={selection?.id === n.id ? '#4057ac' : '#bdc6d8'}
              />
            ))}
          </svg>
          <div className="ws-zoom" role="group" aria-label="캔버스 배율">
            <button type="button" aria-label="축소" aria-keyshortcuts="-" title="축소 (-)"
              aria-disabled={view.zoom <= minZoom} onClick={() => changeZoom('out')}>
              <Icon name="minus" />
            </button>
            <button type="button" className="ws-zoom-percent" aria-keyshortcuts="0"
              aria-label={'현재 배율 ' + (percent < 0.1 ? '0.1% 미만' : zoomLabel) + ', 100%로 맞추기'} title="100%로 맞추기 (0)"
              onClick={() => changeZoom('reset')}>
              <span aria-live="polite" aria-atomic="true">{zoomLabel}</span>
            </button>
            <button type="button" aria-label="확대" aria-keyshortcuts="= Plus" title="확대 (+ 또는 =)"
              aria-disabled={view.zoom >= maxZoom} onClick={() => changeZoom('in')}>
              <Icon name="plus" />
            </button>
            <button type="button" aria-label="전체 보기" title="전체 보기" onClick={showOverview}>
              <Icon name="fit" />
            </button>
          </div>
          <div className="ws-legend" role="group" aria-label="연결선 종류">
            {Object.entries(lineNames).map(([kind, title]) => (
              <span key={kind}>
                <i className={'ws-swatch ws-' + kind} />
                {title}
              </span>
            ))}
          </div>
        </>
      )}
      {list && graph.nodes.length > 0 && (
        <div ref={listFrame} className="ws-graph-list" onScroll={rememberList}>
          <h3>블록</h3>
          {graph.nodes.map((n) => (
            <button
              key={n.id}
              data-canvas-block={n.id}
              onFocus={e => { if (browsedItem.current !== e.currentTarget) onSelect({kind:'node', id:n.id}); }}
              onKeyDown={event => deleteFocusedBlock(event, n.id)}
              aria-keyshortcuts={browseShortcuts}
              aria-pressed={selection?.id === n.id}
              onClick={e => {
                onSelect({ kind: 'node', id: n.id });
                onInspect(e.currentTarget);
              }}
            >
              <BlockIcon type={n.type} />
              <span>
                {titleOf(n.id)}
                {previews.get(n.id) && <small className="ws-material-preview">{previews.get(n.id)}</small>}
              </span>
            </button>
          ))}
          <h3>연결선</h3>
          {groups.map((g) => (
            <button
              key={g.id}
              data-canvas-wire={g.id}
              aria-keyshortcuts={browseShortcuts}
              aria-pressed={selection?.kind === 'edge' && selection.id === g.id}
              onClick={e => {
                onSelect({ kind: 'edge', id: g.id });
                onInspect(e.currentTarget);
              }}
            >
              <i className={'ws-swatch ws-' + g.kind} aria-hidden="true" />
              <span>
                {titleOf(g.from)} → {titleOf(g.to)}
                <small>{connectionDescription(g)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="ws-canvas-notice" role="status">
        {navigationNotice || (frontId && overlapNames.length > 0
          ? '‘' + titleOf(frontId) + '’ 블록이 ‘' + overlapNames.join('’, ‘') + '’ 블록과 겹칩니다.' : '')}
      </div>
      {!!wireChoices.length && <Modal title={wireSource ? '따라갈 연결선 선택' : '겹친 연결선 선택'} onClose={() => onWireChoicesChange([])}>
        <div className="ws-wire-choices">
          {groups.filter(g => wireChoices.includes(g.id)).map(g =>
            <button type="button" key={g.id} className="ws-btn" onClick={() => {
              if (wireSource) {
                returnToWire.current = g.id;
                onWireChoicesChange([]);
              } else selectWire(g.id, true);
            }}>
              <strong>{titleOf(g.from)} → {titleOf(g.to)}</strong>
              <small>{choiceDescription(g)}</small>
            </button>
          )}
        </div>
      </Modal>}
      {!graph.nodes.length && (
        <div className="ws-canvas-empty">
          <span className="ws-empty-icon">
            <Icon name="workflow" size={26} />
          </span>
          <h3>첫 블록을 추가하세요</h3>
          <button className="ws-btn ws-primary" onClick={onAdd}>
            <Icon name="plus" />
            블록 선택
          </button>
        </div>
      )}
    </div>
    {!list && <CanvasRouteDetail detailRef={detailRef} ports={portDirections} activeRouteId={activeRouteId}
      destinations={destinations} viewedDestinationId={viewedDestinationId} onViewDestination={viewDestination}
      onReturnToRoute={returnToRoute} onLeaveDetail={leaveRouteDetail} />}
  </>);
}
