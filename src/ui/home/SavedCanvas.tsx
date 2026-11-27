import { Layers3, MousePointer2 } from 'lucide-react';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { portsFor } from '../../domain/catalog';
import type { Graph } from '../../domain/types';
import { BlockIcon } from '../editor/Icons';
import { color, extent, groupedWireGeometry, nodeLayout, ROUTE_H } from '../editor/geometry';
import { groupEdges, materialPreview, shortBranchLabel, titleById, type Selection } from '../editor/graph';
import { useMaterialPreviews } from '../editor/use-material-previews';

// Keep the saved layout at reading size. If it extends past the frame, reveal the chosen block.
function cameraOrigin(start: number, span: number, centre: number, size: number) {
  const padding = 18;
  if (span + 2 * padding <= size) return start - (size - span) / 2;
  return Math.max(start - padding, Math.min(centre - size / 2, start + span + padding - size));
}

export default function SavedCanvas({ graph, selection }: { graph: Graph; selection: Selection }) {
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState({ width: 350, height: 230 });
  const [overview, setOverview] = useState(false);
  const [lookAt, setLookAt] = useState('');
  const hasNodes = graph.nodes.length > 0;
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const { width, height } = svg.getBoundingClientRect();
      if (width && height) setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [hasNodes]);
  const materialSources = useMaterialPreviews(graph);
  const { nodes, groups, geometry } = useMemo(() => {
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const groups = groupEdges(graph);
    return { nodes, groups, geometry: groupedWireGeometry(groups, nodes) };
  }, [graph]);
  const selectedNode = selection?.kind === 'node' ? nodes.get(selection.id) : undefined;
  const selectedGroup = selection?.kind === 'edge' ? groups.find(group => group.id === selection.id) : undefined;
  const selectedLine = selectedGroup && geometry.get(selectedGroup.id);
  const anchor = selectedNode ?? (selectedGroup && nodes.get(selectedGroup.from)) ??
    graph.nodes.find(node => node.type === 'input.user_request') ?? graph.nodes[0];
  const selectedTitle = selectedGroup ? [selectedGroup.from, selectedGroup.to].map(key => titleById(graph, key)).join(' → ') :
    anchor && titleById(graph, anchor.id);
  const selectedExcerpt = selectedNode && materialPreview(selectedNode, materialSources);
  const adjacent = groups.filter(group => selectedGroup ? group === selectedGroup : group.from === anchor?.id || group.to === anchor?.id);
  const nearbyIds = new Set([
    ...(anchor ? [anchor.id] : []),
    ...adjacent.filter(group => group.kind === 'flow').flatMap(group => [group.from, group.to]),
    ...adjacent.flatMap(group => [group.from, group.to]),
  ]);
  const nearbyNodes = [...nearbyIds].flatMap(key => {
    const node = nodes.get(key);
    return node ? [node] : [];
  });
  const visibleNodes = overview ? graph.nodes : nearbyNodes;
  const lines = (overview ? groups : adjacent).flatMap(group => {
    const line = geometry.get(group.id);
    if (!line) return [];
    const active = selectedGroup === group || selectedNode && (selectedNode.id === group.from || selectedNode.id === group.to);
    return [{ group, line, active }];
  });
  const frame = extent(visibleNodes);
  const padding = 28;
  const width = Math.max(470, frame.w + padding * 2);
  const height = Math.max(275, frame.h + padding * 2);
  const target = nearbyNodes.find(node => node.id === lookAt) ?? anchor;
  const targetLayout = target && nodeLayout(target);
  const viewBox = (overview || !target || !targetLayout ?
    [frame.x - (width - frame.w) / 2, frame.y - (height - frame.h) / 2, width, height] :
    [cameraOrigin(frame.x, frame.w, target.x + targetLayout.width / 2, viewport.width),
      cameraOrigin(frame.y, frame.h, target.y + targetLayout.height / 2, viewport.height), viewport.width, viewport.height]).join(' ');
  function connectionRole(nodeId: string) {
    if (selectedGroup) return nodeId === selectedGroup.from ? '출발' : '도착';
    if (nodeId === anchor?.id) return '기준';
    return [...new Set(adjacent.filter(group => group.from === nodeId || group.to === nodeId).map(group => {
      const incoming = group.from === nodeId;
      if (group.kind === 'reference') return incoming ? '참조 제공' : '참조 사용';
      if (group.kind === 'data') return incoming ? '데이터 제공' : '데이터 사용';
      return incoming ? '이전' : '다음';
    }))].join(' · ');
  }

  return <figure className="lh-saved-canvas" data-home-canvas="saved" data-preview={overview ? 'overview' : 'nearby'}>
    <figcaption>
      <span><Layers3 aria-hidden="true" size={16}/>마지막 블록 배치</span>
      {hasNodes && <button type="button" className="lh-view-toggle" aria-controls={id + '-diagram'} onClick={() => setOverview(!overview)}>
        {overview ? '주변 블록 보기' : '전체 배치 보기'}
      </button>}
      {selectedTitle && <span className="lh-selection"><MousePointer2 aria-hidden="true" size={14}/>
        {selectedGroup ? '선택한 연결' : selectedNode ? '선택한 블록' : '기준 블록'} <strong>{selectedTitle}</strong></span>}
      {selectedExcerpt && <span className="lh-selection">{selectedExcerpt}</span>}
    </figcaption>
    {hasNodes ? <svg className="lh-project-diagram" id={id + '-diagram'} ref={svgRef} viewBox={viewBox} role="img" aria-labelledby={id + '-title ' + id + '-description'}>
      <title id={id + '-title'}>{overview ? '마지막으로 편집한 Workflow 전체 배치' : '기준 블록과 직접 연결된 블록'}</title>
      <desc id={id + '-description'}>{visibleNodes.map(node => titleById(graph, node.id)).join(', ')}. 블록 {visibleNodes.length}개, 연결선 {lines.length}개.
        {lines.filter(({ group }) => group.branchLabel).map(({ group }) =>
          ` ${titleById(graph, group.from)}에서 ${group.branchLabel}이면 ${titleById(graph, group.to)}로 진행합니다.`)}
      </desc>
      <defs>{Object.entries(color).map(([kind, stroke]) => <marker key={kind} id={id + '-' + kind}
        viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto">
        <path fill={stroke} d="M0 0L10 5L0 10z"/>
      </marker>)}</defs>
      {lines.map(({group, line, active}) => <g key={group.id} fill="none" stroke={color[group.kind]}
        strokeWidth={active ? 2.5 : 1.7} opacity={active ? 1 : .72} strokeLinecap="round">
        {line.stems.map((d, i) => <path key={i} d={d}/>)}
        <path data-from={group.from} data-to={group.to} data-kind={group.kind} d={line.d}
          strokeDasharray={group.kind === 'reference' ? '2 5' : group.kind === 'data' ? '7 5' : undefined}
          markerEnd={'url(#' + id + '-' + group.kind + ')'}/>
      </g>)}
      {lines.map(({ group, line }) => group.branchLabel && <g key={group.id}>
        {line.labelAnchor && <line x1={line.labelAnchor.x} y1={line.labelAnchor.y} x2={line.label.x} y2={line.label.y + 3}
          stroke={color.flow} strokeWidth={1} opacity={.5} />}
        <text className="lh-branch-label" x={line.label.x} y={line.label.y}>
          <title>{group.branchLabel}</title>{shortBranchLabel(group.branchLabel)}
        </text>
      </g>)}
      {visibleNodes.map(node => {
        const layout = nodeLayout(node), ports = portsFor(node);
        const outputYs = layout.routes.length ? layout.routes.map(r => r.y) : ports.outputs.length ? [layout.portY] : [];
        const excerpt = materialPreview(node, materialSources);
        return <g key={node.id}>
          <foreignObject data-node-id={node.id} x={node.x} y={node.y} width={layout.width} height={layout.height}>
            <div className={'lh-mini-node' + ((selectedNode?.id === node.id || (!overview && target?.id === node.id)) ? ' lh-mini-selected' : '')}>
              <div className="lh-mini-header" style={{height:layout.bodyHeight}}>
                <BlockIcon type={node.type}/>
                <span className="lh-mini-copy"><strong>{titleById(graph, node.id)}</strong>{excerpt && <small>{excerpt}</small>}</span>
              </div>
              {layout.routes.map(r => <div className="lh-mini-route" key={r.id} style={{height:ROUTE_H}} title={r.label}>{r.label}</div>)}
            </div>
          </foreignObject>
          <g fill="white" stroke="#687587" strokeWidth="1.4">
            {ports.inputs.length > 0 && <circle cx={node.x} cy={node.y + layout.portY} r="3.1"/>}
            {outputYs.map(y => <circle key={y} cx={node.x + layout.width} cy={node.y + y} r="3.1"/>)}
          </g>
        </g>;
      })}
      {selectedGroup && selectedLine && [...selectedLine.sources, selectedLine.to].map((p, index) => (
        <circle key={index} cx={p.x} cy={p.y} r="6" fill="white" stroke={color[selectedGroup.kind]} strokeWidth="2.4"/>
      ))}
    </svg> : <p className="lh-canvas-empty">아직 배치한 블록이 없습니다.</p>}
    {!overview && nearbyNodes.length > 1 && <div className="lh-neighbors" role="group" aria-label="주변 블록 위치 보기">
      {nearbyNodes.map(node => <button type="button" key={node.id} onClick={() => setLookAt(node.id)}
        aria-pressed={node.id === target?.id} aria-controls={id + '-diagram'}>
        <small>{connectionRole(node.id)}</small>{' '}{titleById(graph, node.id)}
      </button>)}
    </div>}
  </figure>;
}
