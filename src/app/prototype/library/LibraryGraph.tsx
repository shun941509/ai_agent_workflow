import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { canvasSize, constrainPosition, graphWires, nodeIds, nodes, type NodeId, type NodeInfo, type Point, type Positions } from './graph-model';
import './graph.css';

export function NodeIcon({ node }: { node: NodeInfo }) {
  const Icon = node.icon;
  return <span aria-hidden="true" className={`le-icon le-color-${node.id}`}><Icon size={17} strokeWidth={1.8} /></span>;
}

type GraphProps = {
  positions: Positions;
  selected: NodeId;
  onSelect?: (id: NodeId) => void;
  onMove?: (id: NodeId, point: Point) => void;
};

type Drag = { id: NodeId; pointer: number; origin: Point; client: Point; scale: number; moved: boolean };
const directions: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowRight: { x: 1, y: 0 }, ArrowDown: { x: 0, y: 1 },
};

export default function LibraryGraph({ positions, selected, onSelect, onMove }: GraphProps) {
  const instance = useId();
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [moving, setMoving] = useState<{ id: NodeId; point: Point } | null>(null);
  const visible = moving ? { ...positions, [moving.id]: moving.point } : positions;
  const wires = graphWires(visible);
  const interactive = Boolean(onSelect || onMove);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const resize = () => element.style.setProperty('--graph-scale', String(element.getBoundingClientRect().width / canvasSize.width));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function begin(event: PointerEvent<HTMLButtonElement>, id: NodeId) {
    if (!onMove || !event.isPrimary || event.button !== 0 || !frame.current) return;
    const scale = frame.current.getBoundingClientRect().width / canvasSize.width;
    if (!scale) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClick.current = false;
    drag.current = { id, pointer: event.pointerId, origin: positions[id], client: { x: event.clientX, y: event.clientY }, scale, moved: false };
  }
  function update(event: PointerEvent<HTMLButtonElement>, finish = false) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    const dx = event.clientX - active.client.x, dy = event.clientY - active.client.y;
    if (Math.hypot(dx, dy) >= 3) active.moved = true;
    if (active.moved) {
      const point = constrainPosition(active.id, { x: active.origin.x + dx / active.scale, y: active.origin.y + dy / active.scale });
      if (finish) {
        if (point.x !== active.origin.x || point.y !== active.origin.y) onMove?.(active.id, point);
      } else setMoving({ id: active.id, point });
    }
    if (finish) {
      suppressClick.current = active.moved;
      drag.current = null;
      setMoving(null);
    }
  }
  function cancel(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setMoving(null);
  }
  function moveWithKey(event: KeyboardEvent<HTMLButtonElement>, id: NodeId) {
    const direction = directions[event.key];
    if (!onMove || !direction || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    const point = constrainPosition(id, { x: positions[id].x + direction.x * step, y: positions[id].y + direction.y * step });
    if (positions[id].x !== point.x || positions[id].y !== point.y) onMove(id, point);
  }

  return <div className="le-graph-holder" data-readonly={!interactive} role={interactive ? 'group' : 'img'}
    aria-label={interactive ? '워크플로 연결도' : `질문 입력, 도서관 안내 Agent, 대출 안내 파일 만들기, 답변 전달 순서로 실행합니다. Agent는 도서관 이용규정과 근거 인용 Skill을 참조합니다. 선택한 블록은 ${nodes[selected].name}입니다.`}>
    {onMove && <span id={`${instance}-help`} className="le-graph-help">블록을 끌거나 방향키로 이동하세요. Shift와 방향키를 함께 누르면 더 멀리 이동합니다.</span>}
    <div ref={frame} className="le-graph-frame">
      <div className="le-graph-world" style={{ width: canvasSize.width, height: canvasSize.height }}>
        <svg className="le-edges" viewBox="0 0 708 465" aria-hidden="true">
          <defs>{['flow', 'data', 'reference'].map(kind => <marker key={kind} id={`${instance}-${kind}`} className={`le-marker-${kind}`} viewBox="0 0 8 8" refX="7" refY="4" orient="auto" markerWidth="5.5" markerHeight="5.5"><path d="M0 0 8 4 0 8 2 4Z" /></marker>)}</defs>
          {wires.map(wire => <path key={wire.from + wire.kind} className={`le-wire le-wire-${wire.kind}`} data-from={wire.from} data-to={wire.to}
            data-connected={wire.from === selected || wire.to === selected} d={wire.path} markerEnd={`url(#${instance}-${wire.kind})`} />)}
        </svg>
        {nodeIds.map(id => {
          const node = nodes[id];
          const props = {
            className: 'le-graph-node', 'data-node-id': id, 'data-selected': selected === id,
            style: { left: visible[id].x, top: visible[id].y, width: node.width, height: node.height },
          };
          const content = <><NodeIcon node={node} /><span className="le-node-copy"><strong>{node.name}</strong><small>{node.role}</small></span></>;
          return interactive
            ? <button key={id} {...props} type="button" aria-label={node.name} aria-pressed={selected === id}
                aria-describedby={onMove ? `${instance}-help` : undefined} data-movable={Boolean(onMove)} data-moving={moving?.id === id}
                onPointerDown={event => begin(event, id)} onPointerMove={event => update(event)} onPointerUp={event => update(event, true)}
                onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={event => moveWithKey(event, id)}
                onClick={event => { if (!suppressClick.current || event.detail === 0) onSelect?.(id); suppressClick.current = false; }}>
                {content}
              </button>
            : <div key={id} {...props}>{content}</div>;
        })}
        <svg className="le-ports" viewBox="0 0 708 465" aria-hidden="true">
          {wires.map(wire => <circle key={wire.from + wire.kind} className={`le-port le-port-${wire.kind}`} cx={wire.port.x} cy={wire.port.y} r="3" />)}
        </svg>
      </div>
    </div>
  </div>;
}
