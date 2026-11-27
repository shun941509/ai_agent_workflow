import { portsFor } from '../../domain/catalog';
import type { Block } from '../../domain/types';

export const W = 176;
export const H = 48;
export const ROUTE_H = 24;

export function nodeLayout(node: Block) {
  const material = node.type === 'resource.context';
  const width = material ? 220 : W;
  const bodyHeight = material ? 68 : H;
  const outputs = node.type === 'control.branch' || node.type === 'ai.classify'
    ? portsFor(node).outputs.filter(port => port.kind === 'flow')
    : [];
  const routes = outputs.map(({ id, label }, i) => ({ id, label, y: bodyHeight + (i + 0.5) * ROUTE_H }));
  return { width, bodyHeight, portY: bodyHeight / 2, height: bodyHeight + routes.length * ROUTE_H, routes };
}

interface OverviewTargetLimits {
  above: number;
  below: number;
  maxPortOutside: number;
  namePortOutside?: number;
}

// Clearances are in graph units. A card can use free space on either side
// without moving its saved wire anchors.
export function overviewTargetLimits(nodes: readonly Block[], minimumHeight = 0): Map<string, OverviewTargetLimits> {
  const limits = new Map<string, OverviewTargetLimits>();
  const maxOutside = 34;
  const cards = nodes.map(node => {
    const {height, width, routes} = nodeLayout(node);
    const growth = Math.max(0, (128 - height) / 2);
    const target: OverviewTargetLimits | undefined = routes.length ? undefined : {above: growth, below: growth, maxPortOutside: maxOutside};
    if (target) limits.set(node.id, target);
    return {
      left: node.x, right: node.x + width, top: node.y, bottom: node.y + height,
      target, height, neighborsAbove: 0, neighborsBelow: 0, belowRoutes: false, coveredLeft: 0,
      minTop: node.y - (target ? 2 * growth : 0), maxBottom: node.y + height + (target ? 2 * growth : 0),
    };
  }).sort((a, b) => a.left - b.left);

  type Card = (typeof cards)[number];
  const shared: {upper: Card; lower: Card}[] = [];
  const beside: {left: Card; right: Card; gap: number}[] = [];
  for (let i = 0; i < cards.length; i++) {
    const a = cards[i];
    for (let j = i + 1; j < cards.length; j++) {
      const b = cards[j];
      const horizontalGap = b.left - a.right;
      if (horizontalGap >= 2 * maxOutside) break;
      if (a.maxBottom <= b.minTop || b.maxBottom <= a.minTop) continue;

      // Named route rows already have a 12-unit hit area beyond their card.
      if (horizontalGap >= (a.target ? 0 : 12)) {
        if (a.target) beside.push({left: a, right: b, gap: horizontalGap});
        continue;
      }
      // Two cards in the same row may share a thin vertical strip at their
      // edges. Keep the left port on its anchor, but let both cards use the
      // free space above and below their row for a full-height touch target.
      if (a.target && b.target && a.top === b.top && b.left >= a.right - maxOutside) {
        a.target.maxPortOutside = 0;
        b.coveredLeft = Math.max(b.coveredLeft, a.right - b.left);
        continue;
      }
      const [upper, lower] = a.top <= b.top ? [a, b] : [b, a];
      upper.neighborsBelow++;
      lower.neighborsAbove++;
      const gap = lower.top - upper.bottom;
      if (gap < 0) {
        for (const card of [upper, lower]) {
          if (card === b && b.left >= a.right - maxOutside && a.top === b.top) {
            b.coveredLeft = Math.max(b.coveredLeft, a.right - b.left);
            continue;
          }
          if (card.target) {
            card.target.above = card.target.below = 0;
            card.target.maxPortOutside = 0;
          }
          card.neighborsAbove++;
          card.neighborsBelow++;
        }
      } else {
        // Named-route cards retain their height, leaving the adjacent card the
        // full clearance. Two growing cards divide the same gap.
        lower.belowRoutes ||= !upper.target && !!lower.target;
        const keep = !upper.target && lower.target && minimumHeight ? 16 : 4;
        const available = Math.max(0, gap - keep) / (upper.target && lower.target ? 2 : 1);
        if (upper.target) upper.target.below = Math.min(upper.target.below, available);
        if (lower.target) lower.target.above = Math.min(lower.target.above, available);
        if (upper.target && lower.target && minimumHeight) shared.push({upper, lower});
      }
    }
  }
  // A fixed-height branch can leave the next card with no space on one side.
  // Reassign part of a shared gap only when both cards border it exclusively
  // and the donor keeps its own usable target.
  for (const {upper, lower} of shared) {
    if (upper.neighborsBelow !== 1 || lower.neighborsAbove !== 1) continue;
    const up = upper.target!, down = lower.target!;
    const upperRoom = upper.height + up.above + up.below - minimumHeight;
    const lowerRoom = lower.height + down.above + down.below - minimumHeight;
    // Give the control directly under named outputs extra separation from the
    // tiny row above it. Chrome also considers nearby controls on touch.
    const preferredExtra = upper.belowRoutes ? minimumHeight * 0.25 : 0;
    const takeUp = Math.max(0, Math.min(preferredExtra - upperRoom, lowerRoom, down.above));
    const takeDown = Math.max(0, Math.min(-lowerRoom, upperRoom, up.below));
    up.below += takeUp - takeDown;
    down.above += takeDown - takeUp;
  }
  for (const {left, right, gap} of beside) {
    const port = left.target!;
    if (left.bottom + port.below > right.top - (right.target?.above ?? 0)
      && right.bottom + (right.target?.below ?? 0) > left.top - port.above) {
      // A wider neighbour may cover part of this card's left edge. Offset its
      // output zone into the opposite gap, retaining at least a quarter for wires.
      port.maxPortOutside = Math.min(port.maxPortOutside, gap / 2 + Math.min(left.coveredLeft, gap / 4));
      // A name that needs more room may use a wider body. Move its output
      // into the adjacent gap, stopping short of the next card's touch area.
      if (minimumHeight && port.maxPortOutside > 0) {
        port.namePortOutside = Math.min(port.namePortOutside ?? maxOutside, gap * .9);
      }
    }
  }
  return limits;
}

// The route buttons keep their saved vertical coordinates. Only the heading
// can grow into clear space above a compact multi-output block.
export function overviewRouteHeadroom(block: Block, nodes: readonly Block[], limits: ReadonlyMap<string, OverviewTargetLimits>) {
  const right = block.x + nodeLayout(block).width;
  let space = 32;
  for (const other of nodes) {
    if (other === block || other.y >= block.y) continue;
    const otherLayout = nodeLayout(other);
    const limit = limits.get(other.id);
    if (other.x >= right || other.x + otherLayout.width + (limit?.maxPortOutside ?? 12) <= block.x) continue;
    const bottom = other.y + otherLayout.height + (limit?.below ?? 0);
    space = Math.min(space, Math.max(0, block.y - bottom - 4));
    if (!space) break;
  }
  return space;
}

export function placeNewBlock(block: Block, existing: Block[]): Block {
  const { height, width } = nodeLayout(block);
  const column = existing.filter(n => n.x < block.x + width && block.x < n.x + nodeLayout(n).width).sort((a, b) => a.y - b.y);
  let y = block.y;
  for (const node of column) {
    if (node.y >= y + height) break;
    const bottom = node.y + nodeLayout(node).height;
    if (bottom > y) y = bottom + 16;
  }
  return y === block.y ? block : { ...block, y };
}
