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
