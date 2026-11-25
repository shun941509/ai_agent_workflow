import { BookOpen, Bot, FilePlus2, MessageSquare, Send, SquareTerminal, type LucideIcon } from 'lucide-react';

export const nodeIds = ['input', 'agent', 'file', 'output', 'rules', 'skill'] as const;
export type NodeId = typeof nodeIds[number];
export type Point = { x: number; y: number };
export type Positions = Record<NodeId, Point>;
export type NodeInfo = Point & {
  id: NodeId;
  name: string;
  role: string;
  icon: LucideIcon;
  width: number;
  height: number;
};

export const nodes: Record<NodeId, NodeInfo> = {
  input: { id: 'input', name: '질문 입력', role: '사용자 입력', icon: MessageSquare, x: 23, y: 40, width: 147, height: 60 },
  agent: { id: 'agent', name: '도서관 안내 Agent', role: 'AI 작업', icon: Bot, x: 247, y: 129, width: 187, height: 70 },
  file: { id: 'file', name: '대출 안내 파일 만들기', role: '파일 생성', icon: FilePlus2, x: 499, y: 237, width: 186, height: 64 },
  output: { id: 'output', name: '답변 전달', role: '최종 출력', icon: Send, x: 520, y: 368, width: 144, height: 62 },
  rules: { id: 'rules', name: '도서관 이용규정', role: '참고 자료', icon: BookOpen, x: 23, y: 245, width: 179, height: 64 },
  skill: { id: 'skill', name: '근거 인용 Skill', role: '작업 지침', icon: SquareTerminal, x: 43, y: 369, width: 159, height: 62 },
};
export const initialPositions: Positions = Object.fromEntries(
  nodeIds.map(id => [id, { x: nodes[id].x, y: nodes[id].y }]),
) as Positions;

export const canvasSize = { width: 708, height: 465 };

export function constrainPosition(id: NodeId, point: Point): Point {
  return {
    x: Math.max(5, Math.min(canvasSize.width - nodes[id].width - 5, Math.round(point.x))),
    y: Math.max(5, Math.min(canvasSize.height - nodes[id].height - 5, Math.round(point.y))),
  };
}

type Edge = { from: NodeId; to: NodeId; kind: 'flow' | 'data' | 'reference' };
const edges: Edge[] = [
  { from: 'input', to: 'agent', kind: 'flow' }, { from: 'input', to: 'agent', kind: 'data' },
  { from: 'agent', to: 'file', kind: 'flow' }, { from: 'agent', to: 'file', kind: 'data' },
  { from: 'file', to: 'output', kind: 'flow' }, { from: 'file', to: 'output', kind: 'data' },
  { from: 'rules', to: 'agent', kind: 'reference' }, { from: 'skill', to: 'agent', kind: 'reference' },
];

// The two channels have separate ports and bend at different points between cards.
function route(edge: Edge, positions: Positions): Point[] {
  const a = positions[edge.from], b = positions[edge.to];
  const source = nodes[edge.from], target = nodes[edge.to];
  const right = b.x + target.width / 2 >= a.x + source.width / 2;
  const down = b.y + target.height / 2 >= a.y + source.height / 2;
  const data = edge.kind === 'data';
  const xGap = right ? b.x - a.x - source.width : a.x - b.x - target.width;
  const yGap = down ? b.y - a.y - source.height : a.y - b.y - target.height;

  if (edge.kind === 'reference') {
    const end = { x: b.x + (edge.from === 'rules' ? 44 : 103), y: b.y + (down ? -2 : target.height + 2) };
    if (end.x < a.x || end.x > a.x + source.width) {
      const start = { x: a.x + (end.x > a.x ? source.width : 0), y: a.y + source.height / 2 };
      return [start, { x: end.x, y: start.y }, end];
    }
    const start = { x: end.x, y: a.y + (down ? source.height : 0) };
    return [start, end];
  }

  const vertical = edge.from === 'file' ? yGap >= 15 || xGap < yGap : xGap < 15 && yGap > xGap;
  if (vertical) {
    const start = { x: a.x + Math.round(source.width / 2) + (data ? 13 : -19), y: a.y + (down ? source.height : 0) };
    const end = { x: b.x + Math.round(target.width / 2) + (data ? 13 : -19), y: b.y + (down ? -2 : target.height + 2) };
    const middle = Math.round(start.y + (end.y - start.y) * (data ? .4 : .58));
    return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
  }

  const start = { x: a.x + (right ? source.width : 0), y: a.y + (source.id === 'input' ? 22 : 23) + (data ? 17 : 0) };
  const end = { x: b.x + (right ? -2 : target.width + 2), y: b.y + (target.id === 'file' ? (data ? 38 : 20) : (data ? 40 : 23)) };
  const fraction = source.id === 'input' ? (data ? 1 / 3 : .5) : (data ? .43 : .635);
  const middle = Math.trunc(start.x + (end.x - start.x) * fraction);
  return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
}

function roundedPath(points: Point[], radius: number) {
  let path = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1], corner = points[i], after = points[i + 1];
    const dx = corner.x - before.x, dy = corner.y - before.y;
    const nextX = after.x - corner.x, nextY = after.y - corner.y;
    const r = Math.min(radius, Math.hypot(dx, dy) / 2, Math.hypot(nextX, nextY) / 2);
    path += ` L${corner.x - Math.sign(dx) * r} ${corner.y - Math.sign(dy) * r}`;
    if (r) path += ` Q${corner.x} ${corner.y} ${corner.x + Math.sign(nextX) * r} ${corner.y + Math.sign(nextY) * r}`;
  }
  const end = points[points.length - 1];
  return `${path} L${end.x} ${end.y}`;
}

export function graphWires(positions: Positions) {
  return edges.map(edge => {
    const points = route(edge, positions);
    return { ...edge, port: points[0], path: roundedPath(points, edge.kind === 'reference' ? 7 : 6) };
  });
}
