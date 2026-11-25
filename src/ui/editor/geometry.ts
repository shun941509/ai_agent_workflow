import type { Block } from '../../domain/types';
import { portsFor } from '../../domain/catalog';
import { compactRouteLabels, routeLabelWidth, shortBranchLabel, type EdgeGroup } from './graph';
import { nodeLayout } from './node-layout';

export { H, W, ROUTE_H, nodeLayout } from './node-layout';
export const color = { flow: '#485568', data: '#367e80', reference: '#7064ae' };
export type Point = { x: number; y: number };
export type CanvasView = Point & { zoom: number };
export const PORT_DIRECTION_SIZE = 12;
function portDirectionGap(zoom: number) {
  return 4.5 * zoom + 1; // The 9px port scales with the block; the gap beyond its rim does not.
}
type Size = { width: number; height: number };
type Box = Point & Size;
type Card = Point & ReturnType<typeof nodeLayout>;

export function extent(nodes: Block[]) {
  if (!nodes.length) return { x: 0, y: 0, w: 550, h: 300 };
  const x = Math.min(...nodes.map(n => n.x)), y = Math.min(...nodes.map(n => n.y));
  return { x, y, w: Math.max(...nodes.map(n => n.x + nodeLayout(n).width)) - x, h: Math.max(...nodes.map(n => n.y + nodeLayout(n).height)) - y };
}

export function overviewZoom(bounds: ReturnType<typeof extent>, frame: Size) {
  return Math.min(1, Math.max(1, frame.width - 48) / Math.max(1, bounds.w),
    Math.max(1, frame.height - 100) / Math.max(1, bounds.h));
}

export function fittedView(nodes: Block[], frame: Size, readable = false): CanvasView {
  const bounds = extent(nodes);
  const fit = overviewZoom(bounds, frame);
  const zoom = readable && fit < 0.9 ? 1 : fit;
  const view = {
    x: (frame.width - bounds.w * zoom) / 2 - bounds.x * zoom,
    y: (frame.height - bounds.h * zoom) / 2 - bounds.y * zoom,
    zoom,
  };
  if (zoom > fit && nodes.length) {
    const entry = nodes.find(node => node.type === 'input.user_request') ?? nodes[0];
    if (bounds.w * zoom > frame.width - 48) view.x = 24 - entry.x * zoom;
    if (bounds.h * zoom > frame.height - 100) view.y = frame.height / 2 - (entry.y + nodeLayout(entry).portY) * zoom;
  }
  return view;
}

// Only pan far enough to expose the selection. Preserve manual zoom, including on small canvases.
export function revealBlock(view: CanvasView, frame: Size, node: Block, captions: Box[] = []): CanvasView {
  const layout = nodeLayout(node);
  return revealArea(view, frame, { x:node.x, y:node.y, width:layout.width, height:layout.height },
    captions, PORT_DIRECTION_SIZE + portDirectionGap(view.zoom));
}

// A long connection may span several viewports. Keep its midpoint visible at the user's zoom.
export function revealArea(view: CanvasView, frame: Size, primary: Box, context: Box[] = [], sideMargin = 12, topMargin = 12): CanvasView {
  function shift(axis: 'x' | 'y', length: 'width' | 'height', start: number, end: number) {
    const boxes = [primary, ...context];
    let min = Math.min(...boxes.map(box => box[axis]));
    let max = Math.max(...boxes.map(box => box[axis] + box[length]));
    if ((max - min) * view.zoom > end - start) {
      min = primary[axis];
      max = min + primary[length];
    }
    const before = min * view.zoom + view[axis], after = max * view.zoom + view[axis];
    if (before < start || after - before > end - start) return start - before;
    return after > end ? end - after : 0;
  }
  const dx = shift('x', 'width', sideMargin, frame.width - sideMargin);
  const dy = shift('y', 'height', topMargin, frame.height - 56);
  return dx || dy ? {...view, x:view.x + dx, y:view.y + dy} : view;
}

function corners(points: Point[]): Point[] {
  const turns: Point[] = [];
  for (const p of points) {
    const last = turns.at(-1), previous = turns.at(-2);
    if (last && last.x === p.x && last.y === p.y) continue;
    if (previous && last && (
      previous.x === last.x && last.x === p.x || previous.y === last.y && last.y === p.y
    )) {
      turns.pop();
      if (previous.x === p.x && previous.y === p.y) continue;
    }
    turns.push(p);
  }
  return turns;
}

function rounded(turns: Point[], centerline?: Point[]): string {
  return moveTo(turns[0]) + roundedSegments(turns, centerline);
}

function moveTo(point: Point) {
  return `M${point.x} ${point.y}`;
}

function roundedSegments(turns: Point[], centerline?: Point[]): string {
  centerline?.push(turns[0]);
  let d = '';
  for (let i = 1; i < turns.length - 1; i++) {
    const before = turns[i - 1], p = turns[i], after = turns[i + 1];
    const dx = p.x - before.x, dy = p.y - before.y;
    const nextX = after.x - p.x, nextY = after.y - p.y;
    const radius = Math.min(7, Math.hypot(dx, dy) / 2, Math.hypot(nextX, nextY) / 2);
    const entry = {x:p.x - Math.sign(dx) * radius, y:p.y - Math.sign(dy) * radius};
    const exit = {x:p.x + Math.sign(nextX) * radius, y:p.y + Math.sign(nextY) * radius};
    d += ` L${entry.x} ${entry.y} Q${p.x} ${p.y} ${exit.x} ${exit.y}`;
    if (centerline) {
      centerline.push(entry);
      // Reuse the rendered quadratic. Eight chords stay within 0.04 design pixels at the maximum corner radius.
      for (let i = 1; i <= 8; i++) {
        const t = i / 8, u = 1 - t;
        centerline.push({x:u*u*entry.x + 2*u*t*p.x + t*t*exit.x, y:u*u*entry.y + 2*u*t*p.y + t*t*exit.y});
      }
    }
  }
  const last = turns[turns.length - 1];
  centerline?.push(last);
  return `${d} L${last.x} ${last.y}`;
}

export function route(from: Point, to: Point, offset = 0) {
  const x = (from.x + to.x) / 2 + offset;
  return rounded(corners([from, { x, y: from.y }, { x, y: to.y }, to]));
}

type Wire = { from: Point; sources: Point[]; to: Point; d: string; stems: string[]; outputPaths: Map<string, string>; centerlines: Point[][]; label: Point; labelAnchor?: Point };

type PortDirection = Point & { direction: 'incoming' | 'outgoing'; kind: EdgeGroup['kind'] | null };
export type DirectionBox = Box & Pick<PortDirection, 'direction' | 'kind'> & {
  route?: { id: string; label: string; displayLabel: string; source: Point; bounds: Box };
};

type Band = {top: number; bottom: number};

// Project only obstacles crossing the labels' column onto its vertical axis.
// Centerlines include the rounded trunk and each short stem before a merge.
function routeRowBands(left: number, right: number, clearance: number, cards: Box[], wires: Wire[]) {
  const bands: Band[] = [];
  function reserve(x1: number, x2: number, y1: number, y2: number) {
    if (Math.max(x1, x2) < left - clearance || Math.min(x1, x2) > right + clearance) return;
    bands.push({top: Math.min(y1, y2) - clearance, bottom: Math.max(y1, y2) + clearance});
  }
  for (const card of cards) reserve(card.x, card.x + card.width, card.y, card.y + card.height);
  for (const wire of wires) {
    for (const path of wire.centerlines) {
      for (let i = 1; i < path.length; i++) reserve(path[i - 1].x, path[i].x, path[i - 1].y, path[i].y);
    }
  }
  const merged: Band[] = [];
  for (const band of bands.sort((a, b) => a.top - b.top)) {
    const previous = merged.at(-1);
    if (previous && band.top <= previous.bottom) previous.bottom = Math.max(previous.bottom, band.bottom);
    else merged.push(band);
  }
  return merged;
}

function routeRowTops(count: number, center: number, height: number, pitch: number, bands: Band[]) {
  const middle = center - height / 2 + (count % 2 === 0 ? pitch / 2 : 0);
  // Build enough free slots on either side of the ports. This lets one group
  // of wires pass through a gap in the rows without moving all labels to one side.
  const below: number[] = [];
  let y = middle, i = 0;
  while (below.length < count) {
    while (i < bands.length && bands[i].top < y + height) {
      y = Math.max(y, bands[i++].bottom);
    }
    below.push(y);
    y += pitch;
  }
  const above: number[] = [];
  y = below[0] - pitch;
  i = bands.length - 1;
  while (above.length < count) {
    while (i >= 0 && bands[i].bottom > y) {
      y = Math.min(y, bands[i--].top - height);
    }
    above.push(y);
    y -= pitch;
  }
  const slots = above.reverse().concat(below);
  let start = 0, radius = Infinity;
  for (let offset = 0; offset <= count; offset++) {
    const span = Math.max(center - slots[offset], slots[offset + count - 1] + height - center);
    if (span < radius) { radius = span; start = offset; }
  }
  return slots.slice(start, start + count);
}

// Lay out the temporary route key in screen pixels, then return its boxes in
// world coordinates so wire captions and keyboard panning can use the same bounds.
function expandedRouteRows(node: Block, routes: ReturnType<typeof nodeLayout>['routes'], view: CanvasView, frame: Size, nodes: Block[], wires: Wire[]) {
  const {zoom} = view;
  const rowHeight = 24, pitch = 28, gutter = 32;
  const sourceX = node.x + nodeLayout(node).width, x = sourceX + 20 / zoom;
  const maxTextWidth = Math.max(40, Math.min(260, frame.width * .45) - gutter);
  const labels = compactRouteLabels(nodeLayout(node).routes.map(route => route.label), maxTextWidth);
  const widths = routes.map(route => routeLabelWidth(labels.get(route.label)!) + gutter);
  const width = Math.max(...widths) / zoom;
  const center = node.y + (routes[0].y + routes[routes.length - 1].y) / 2;
  const cards = nodes.filter(other => other.id !== node.id).map(other => ({x:other.x, y:other.y, ...nodeLayout(other)}));
  // The 8px destination arrow, 6px trace halo and row focus outline need clearance at every zoom.
  const bands = routeRowBands(x, x + width, 8 / zoom, cards, wires);
  const tops = routeRowTops(routes.length, center, rowHeight / zoom, pitch / zoom, bands);
  return new Map(routes.map((route, index) => [node.y + route.y, {
    id:route.id, label:route.label, displayLabel:labels.get(route.label)!, source:{x:sourceX, y:node.y + route.y},
    bounds:{x, y:tops[index], width:widths[index] / zoom, height:rowHeight / zoom},
  }]));
}

export function selectedPortDirections(id: string | undefined, groups: EdgeGroup[], lines: ReadonlyMap<string, Wire>, view: CanvasView, frame: Size, nodes: Block[]): DirectionBox[] {
  const node = nodes.find(n => n.id === id);
  if (!node) return [];
  const {zoom} = view;
  const ports: PortDirection[] = [];
  const outputWires: Wire[] = [];
  for (const group of groups) {
    if (group.from !== id && group.to !== id) continue;
    const line = lines.get(group.id);
    if (!line) continue;
    if (group.to === id) ports.push({...line.to, direction: 'incoming', kind: group.kind});
    if (group.from === id) {
      for (const source of line.sources) ports.push({...source, direction: 'outgoing', kind: group.kind});
      if (line.outputPaths.size) outputWires.push(line);
    }
  }
  ports.sort((a, b) => a.direction === b.direction ? a.y - b.y : a.direction === 'incoming' ? -1 : 1);
  const visible: PortDirection[] = [];
  for (const port of ports) {
    const previous = visible.at(-1);
    // Different destinations can genuinely share one physical port.
    if (previous?.direction === port.direction && previous.y === port.y) {
      if (previous.kind !== port.kind) previous.kind = null;
    } else visible.push(port);
  }
  const outgoing = visible.filter(p => p.direction === 'outgoing');
  const crowded = outgoing.some((p, i) => i > 0 && (p.y - outgoing[i - 1].y) * zoom < PORT_DIRECTION_SIZE);
  const connected = new Set(outgoing.map(port => port.y));
  const routes = crowded ? nodeLayout(node).routes.filter(route => connected.has(node.y + route.y)) : [];
  const rows = routes.length ? expandedRouteRows(node, routes, view, frame, nodes, outputWires) : undefined;
  const size = PORT_DIRECTION_SIZE / zoom, gap = portDirectionGap(zoom) / zoom;
  return visible.map(({x, y, direction, kind}) => {
    const route = direction === 'outgoing' ? rows?.get(y) : undefined;
    return {
      direction, kind, x:route ? route.bounds.x + 4 / zoom : direction === 'incoming' ? x - gap - size : x + gap,
      y:route ? route.bounds.y + (route.bounds.height - size) / 2 : y - size / 2,
      width:size, height:size, route,
    };
  });
}

/** Pick the visible stroke, independently of SVG paint order and the wider pointer targets. */
export function nearestWires(lines: ReadonlyMap<string, Pick<Wire,'centerlines'>>, at: Point) {
  const hits: {id:string; point:Point; distance:number}[] = [];
  for (const [id, wire] of lines) {
    let distance = Infinity, point: Point | undefined;
    for (const line of wire.centerlines) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i-1], b = line[i], dx = b.x - a.x, dy = b.y - a.y;
        const lengthSquared = dx*dx + dy*dy;
        const t = lengthSquared ? Math.max(0, Math.min(1, ((at.x-a.x)*dx + (at.y-a.y)*dy) / lengthSquared)) : 0;
        const x = a.x + t*dx, y = a.y + t*dy;
        const d = (x-at.x)**2 + (y-at.y)**2;
        if (d < distance) { point = {x,y}; distance = d; }
      }
    }
    if (point) hits.push({id, point, distance});
  }
  const closest = hits.sort((a,b) => a.distance - b.distance)[0];
  if (!closest) return [];
  // Parallel lines equidistant from the cursor still have distinct nearest points.
  return hits.filter(hit => Math.hypot(hit.point.x - closest.point.x, hit.point.y - closest.point.y) < 0.05)
    .map(hit => hit.id);
}
type Caption = Pick<Wire, 'label'|'labelAnchor'> & { text: string; bounds: Box };
type Run = { axis: string; start: number; end: number };
const minSharedRun = 34;

function longRuns(points: Point[]): Run[] {
  const runs: Run[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const horizontal = a.y === b.y;
    const start = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const end = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    if (end - start > minSharedRun) runs.push({axis:horizontal ? 'y' + a.y : 'x' + a.x, start, end});
  }
  return runs;
}

function sharedLength(points: Point[], occupied: Map<string, Run[]>) {
  let total = 0;
  for (const run of longRuns(points)) {
    for (const other of occupied.get(run.axis) ?? []) {
      const common = Math.min(other.end, run.end) - Math.max(other.start, run.start);
      if (common > minSharedRun) total += common;
    }
  }
  return total;
}

// Parallel strokes are individually selectable; a short approach to the same handle can be shared.
function separatePath(from: Point, to: Point, interior: Point[], cards: Card[], occupied: Map<string, Run[]>) {
  let best = corners([from, ...interior, to]), overlap = sharedLength(best, occupied);
  if (!overlap) return best;
  for (const offset of [8, -8, 14, -14]) {
    const moved = interior.map(p => ({x:p.x + offset, y:p.y + offset}));
    const start = {x:moved[0].x, y:from.y}, end = {x:moved[moved.length - 1].x, y:to.y};
    if (start.x <= from.x + 3 || end.x >= to.x - 3) continue;
    const candidate = corners([start, ...moved, end]);
    if (cards.some(card => crossesCard(candidate, card))) continue;
    const path = corners([from, ...candidate, to]);
    const score = sharedLength(path, occupied);
    if (score < overlap) { best = path; overlap = score; }
    if (!overlap) break;
  }
  return best;
}

function crossesCard(points: Point[], card: Card) {
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1], p = points[i];
    if (Math.min(prev.x, p.x) < card.x + card.width + 3 && Math.max(prev.x, p.x) > card.x - 3 &&
        Math.min(prev.y, p.y) < card.y + card.height + 3 && Math.max(prev.y, p.y) > card.y - 3) return true;
  }
  return false;
}

// Route between the ends of the horizontal leads. Include the source and target cards here
// so backwards and vertically stacked connections go around their own blocks.
function clearPath(a: Point, b: Point, cards: Card[]): Point[] {
  const throughX = (x: number) => [a, {x, y:a.y}, {x, y:b.y}, b];
  const throughY = (y: number) => [a, {x:a.x, y}, {x:b.x, y}, b];
  let best = throughX((a.x + b.x) / 2);
  const blocked = cards.filter(card => crossesCard(best, card));
  if (!blocked.length) return best;
  const candidates = [
    throughY((a.y + b.y) / 2),
    [a, {x:a.x, y:b.y}, b], [a, {x:b.x, y:a.y}, b],
    throughY(Math.min(...blocked.map(p => p.y)) - 18),
    throughY(Math.max(...blocked.map(p => p.y + p.height)) + 18),
    throughX(Math.min(...blocked.map(p => p.x)) - 18),
    throughX(Math.max(...blocked.map(p => p.x + p.width)) + 18),
  ];
  const length = (path: Point[]) => path.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x-path[i].x) + Math.abs(p.y-path[i].y), 0);
  let hits = blocked.length, distance = length(best);
  for (const candidate of candidates) {
    const collisions = cards.filter(card => crossesCard(candidate, card)).length;
    const cost = length(candidate);
    if (collisions < hits || (collisions === hits && cost < distance)) {
      best = candidate; hits = collisions; distance = cost;
    }
  }
  return best;
}

function captionAnchor(points: Point[]): Point {
  const ends = [points[0], points[points.length - 1]];
  let longest = 0, anchor = ends;
  if (!points.every(p => p.y === ends[0].y) && !points.every(p => p.x === ends[0].x)) {
    for (let i = 1; i < points.length; i++) {
      const p = points[i], previous = points[i - 1];
      const length = Math.hypot(p.x - previous.x, p.y - previous.y);
      if (length > longest) { longest = length; anchor = [previous, p]; }
    }
  }
  return { x:(anchor[0].x + anchor[1].x)/2, y:(anchor[0].y + anchor[1].y)/2 };
}

// Independently place the captions at the displayed type size. Zooming leaves the
// wire paths fixed, while the text avoids the cards and other branch captions.
export function wireCaptions(groups: EdgeGroup[], lines: ReadonlyMap<string, Wire>, nodes: Block[], fontSize: number, selectedNodeId?: string, portDirections: (Box & Pick<DirectionBox, 'route'>)[] = [], activeOutputId?: string) {
  const obstacles: Box[] = nodes.map(node => ({...nodeLayout(node), x:node.x, y:node.y}));
  // Allow for the font's overhang and the light outline around the visible caption.
  const clearance = fontSize / 3;
  for (const port of portDirections) {
    const bounds = port.route?.bounds ?? port;
    const x = Math.min(bounds.x, port.route?.source.x ?? bounds.x);
    const top = Math.min(bounds.y, port.route?.source.y ?? bounds.y);
    const bottom = Math.max(bounds.y + bounds.height, port.route?.source.y ?? bounds.y);
    obstacles.push({x:x - clearance, y:top - clearance,
      width:bounds.x + bounds.width - x + 2 * clearance, height:bottom - top + 2 * clearance});
  }
  const result = new Map<string, Caption>();
  const recipient = nodes.find(node => node.id === selectedNodeId);
  const expanded = new Map(portDirections.flatMap(port => port.route ? [[port.route.label, port.route.displayLabel] as const] : []));
  const active = portDirections.find(port => port.route && port.route.id === activeOutputId)?.route;
  const compactBySource = new Map<string, { names: Map<string,string>; joinedNames: Map<string,string> }>();
  for (const node of nodes) {
    const routes = nodeLayout(node).routes;
    if (!routes.length) continue;
    const labels = routes.map(route => route.label);
    compactBySource.set(node.id, {names:compactRouteLabels(labels, 180), joinedNames:compactRouteLabels(labels, 96)});
  }
  for (const group of groups) {
    const line = lines.get(group.id);
    if (!line) continue;
    let text = group.branchLabel;
    if (!text && recipient?.id === group.to && group.members.every(edge => edge.kind === 'data')) {
      const sender = nodes.find(node => node.id === group.from);
      const inputs = portsFor(recipient).inputs;
      const names = group.members.map(edge => {
        if (edge.label?.trim()) return edge.label.trim();
        if (recipient.type === 'agent.delegate' && sender?.type === 'agent.delegate' &&
          edge.out === 'value' && edge.input === 'input') return sender.title;
        return inputs.find(port => port.kind === 'data' && port.id === edge.input)?.label ?? edge.input;
      });
      text = [...new Set(names)].join(' · ');
    }
    if (!text) continue;
    const compact = compactBySource.get(group.from);
    if (compact && group.branchLabel) {
      const names = group.flowConditions;
      text = names.map(name => (group.from === selectedNodeId ? expanded.get(name) : undefined)
        ?? compact.names.get(name) ?? shortBranchLabel(name)).join(' 또는 ');
      if (names.length > 1 && routeLabelWidth(text) > 260) {
        text = names.slice(0, 2).map(name => compact.joinedNames.get(name) ?? shortBranchLabel(name)).join(' 또는 ');
        if (names.length > 2) text += ' 외 ' + (names.length - 2) + '개';
      }
      if (active && group.from === selectedNodeId && line.sources.some(p => p.y === active.source.y)) text = active.displayLabel;
    } else text = shortBranchLabel(text);
    const anchor = group.branchLabel ? line.labelAnchor ?? { x:line.label.x, y:line.label.y + 6 }
      : { x:line.to.x - 8, y:line.to.y };
    const width = Array.from(text)
      .reduce((sum, ch) => sum + (ch.codePointAt(0)! > 255 ? 1 : .57), 0) * fontSize + 6;
    const x = anchor.x - (group.branchLabel ? width / 2 : width);
    const height = fontSize * 1.2 + 4;
    const nearby = obstacles.filter(box => x < box.x + box.width + 2 && x + width > box.x - 2);
    const preferred = anchor.y - 6 - fontSize;
    const candidates = [preferred, ...nearby.flatMap(box => [box.y - height - 2, box.y + box.height + 2])];
    const top = candidates.filter(y => nearby.every(box => y + height <= box.y - 2 || y >= box.y + box.height + 2))
      .sort((a,b) => Math.abs(a - preferred) - Math.abs(b - preferred))[0];
    const bounds = {x, y:top, width, height};
    obstacles.push(bounds);
    result.set(group.id, {text, bounds, label:{x:x + width / 2, y:top + fontSize}, ...(top !== preferred ? {labelAnchor:anchor} : {})});
  }
  return result;
}

export function groupedWireGeometry(groups: EdgeGroup[], positions: ReadonlyMap<string, Block>): Map<string, Wire> {
  const layouts = new Map(Array.from(positions, ([id, node]) => [id, { x:node.x, y:node.y, ...nodeLayout(node) }]));
  const cards = [...layouts.values()];
  const lines = new Map<string, Wire>();
  const occupied = new Map<string, Run[]>();
  for (const group of groups) {
    const a = layouts.get(group.from), b = layouts.get(group.to);
    if (!a || !b) continue;
    const flowOutputs = new Set(group.members.filter(e => e.kind === 'flow').map(e => e.out));
    const namedOutputs = positions.get(group.to)?.type === 'error.handle' ? [] : a.routes.filter(r => flowOutputs.has(r.id));
    const sources = namedOutputs.map(r => ({ x:a.x + a.width, y:a.y + r.y }));
    if (!sources.length) sources.push({ x:a.x + a.width, y:a.y + a.portY });
    const from = sources[0], to = { x:b.x, y:b.y + b.portY };
    const gap = to.x - from.x;
    const lead = gap > 0 ? Math.min(18, gap / 2) : 18;
    const interior = clearPath({x:from.x + lead, y:from.y}, {x:to.x - lead, y:to.y}, cards);
    const points = separatePath(from, to, interior, cards, occupied);
    for (const run of longRuns(points)) {
      const row = occupied.get(run.axis);
      if (row) row.push(run);
      else occupied.set(run.axis, [run]);
    }
    // Multiple named exits to one target share the destination arrow. The short stems
    // meet the trunk before its first bend, even when the cards are close together.
    const firstBend = points[1]?.x ?? from.x;
    const junctionX = from.x + Math.min(lead, firstBend - from.x) / 2;
    const centerlines: Point[][] = [];
    function traced(turns:Point[]) {
      const line: Point[] = [];
      centerlines.push(line);
      return rounded(turns, line);
    }
    const stems = sources.slice(1).map(p => traced(corners([p, {x:junctionX, y:p.y}, {x:junctionX, y:from.y}])));
    const trunkPoints: Point[] = [];
    centerlines.push(trunkPoints);
    const trunk = roundedSegments(points, trunkPoints);
    const d = moveTo(from) + trunk;
    // Each secondary stem ends on the first straight segment, before its first bend.
    const outputPaths = new Map(namedOutputs.map((output, index) =>
      [output.id, index === 0 ? d : stems[index - 1] + trunk]));
    const anchor = captionAnchor(points);
    lines.set(group.id, { from, sources, to, d, stems, outputPaths, centerlines, label:{x:anchor.x, y:anchor.y - 6} });
  }
  for (const [id, {label, labelAnchor}] of wireCaptions(groups, lines, [...positions.values()], 12))
    Object.assign(lines.get(id)!, {label, labelAnchor});
  return lines;
}
