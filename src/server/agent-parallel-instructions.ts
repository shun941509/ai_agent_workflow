import {isDelegatedRole} from '../domain/agent-context';
import type {Block, Edge, Graph} from '../domain/types';
import {integer} from '../engine/values';
import {defaultConcurrency} from '../engine/limits';

// A Studio frame stops applying a fork's limits at the first join on *each* flow path.
function parallelRegion(split: Block, outgoing: Map<string, Block[]>) {
  const pending = [...(outgoing.get(split.id) ?? [])];
  const seen = new Set<Block>();
  const joins: Block[] = [];
  let hasRole = false;
  for (let i = 0; i < pending.length; i++) {
    const node = pending[i];
    if (seen.has(node)) continue;
    seen.add(node);
    if (node.type === 'control.join') {
      joins.push(node);
      continue;
    }
    if (isDelegatedRole(node.type) && typeof node.config.role === 'string' && node.config.role.trim()) hasRole = true;
    pending.push(...(outgoing.get(node.id) ?? []));
  }
  return {joins, hasRole};
}

function stepName(node: Block) {
  // The export selection determines which MCP identities the recipient can see.
  if (node.type === 'connection.mcp') return 'MCP 연결 입력';
  return '‘' + node.title.replace(/[\r\n]+/g, ' ').trim() + '’ (' + node.id + ')';
}

function forkInstructions(node: Block, outgoing: Map<string, Block[]>) {
  const {joins, hasRole} = parallelRegion(node, outgoing);
  const width = integer(node.config.maxConcurrency, 2, 1, 10);
  const lines = [
    '연결된 실행 경로를 시작하고 각 작업의 값 전달 연결에서 입력을 받으세요. 블록 상한은 ' + width + '개입니다. Studio 기본값에서는 필요한 입력이 준비된 작업을 한 차수에 최대 ' + Math.min(width, defaultConcurrency) + '개까지 시작하세요. 클라이언트의 빈 자리와 같은 Workflow에서 겹치는 병렬 범위의 상한도 확인하세요. 하위 Workflow 안의 작업은 그 층의 상한과 전체 원격 호출 자리를 사용하세요.',
    '준비를 기다리는 경로는 대기 상태로 두고 독립된 경로는 동시 실행 상한 안에서 진행하세요. 준비를 완료할 수 없다고 확인한 경우에만 해당 경로의 실패로 처리하고 아래 정책을 적용하세요.',
  ];
  if (hasRole) lines.push('경로가 위임 단계에 도달하면 해당 단계가 지정한 하위 Agent를 실제로 호출하고 호출 식별자를 그 단계와 함께 기록하세요. 같은 차수의 위임을 모두 시작한 뒤 각 호출의 결과를 기다리세요. 일부 결과가 먼저 도착하면 그 결과를 보관하고 미완료 호출만 다시 기다리세요.');
  lines.push(node.config.failurePolicy === 'stop'
    ? '어느 경로에서든 실패하면 같은 차수에서 이미 시작한 작업의 상태를 확인하고 새 작업을 중단하세요. 전체 실행을 실패로 종료합니다. 하위 Workflow에서 발생해도 호출 부모의 오류 처리기와 후속 합류를 건너뛰고 남은 검토·승인 대기를 종료하세요. 이미 완료된 결과와 확인된 외부 작업의 처리 번호, 상태가 미확인인 작업을 구분해 호출자에게 알리세요.'
    : '일부 경로가 실패해도 성공한 결과와 실패한 단계의 이름·사유를 보관하고 남은 경로를 계속 진행하세요.');
  if (joins.length) lines.push('각 경로에서 처음 만나는 합류 단계는 ' + joins.map(stepName).join(', ') + '입니다. 실행 경로를 따라 해당 합류 단계에 결과를 전달하세요.');
  return lines;
}

function joinInstructions(node: Block, incoming: Edge[], nodes: Map<string, Block>) {
  const sourceNames = (edges: Edge[]) => edges.flatMap(edge => {
    const source = nodes.get(edge.from);
    return source ? [stepName(source)] : [];
  }).join(' → ');
  const dataInputs = sourceNames(incoming.filter(edge => edge.kind !== 'flow' && edge.input === 'input'));
  const flowInputs = sourceNames(incoming.filter(edge => edge.kind === 'flow'));
  const lines = [
    '실제로 시작한 선행 경로의 결과 또는 오류가 모두 도착할 때까지 합류를 기다리세요. 준비나 회신 대기 중인 경로는 회신 후 이어가고 이미 완료한 작업의 결과는 재사용하세요. 조건에서 제외된 경로는 건너뛰세요.',
    '조건 출구는 실행 경로를 정합니다. 완료된 조건 블록에서 합류에 직접 연결한 데이터선은 선택한 출구와 관계없이 그 값을 보냅니다. 실제 도착한 실행 경로의 담당자가 하나이면 그 담당자가, 서로 다르면 이 Workflow를 시작한 담당자(팀이면 팀의 최종 응답 담당)가 합류 후 응답합니다.',
    '실행 기록에서 실패한 경로만 오류로 집계하세요. 정상 결과에 error 또는 role 필드가 있으면 그 결과를 업무 데이터로 유지하세요.',
  ];
  if (dataInputs) lines.push('전달된 입력값을 연결 순서대로 모으세요 — ' + dataInputs);
  if (flowInputs) lines.push((dataInputs ? '전달된 입력값이 하나도 없을 때는 ' : '') + '실행 경로의 결과를 연결 순서대로 모으세요 — ' + flowInputs);
  lines.push(node.config.partialFailure === 'fail'
    ? '모은 입력에 오류가 하나라도 있으면 합류를 실패로 처리하고 성공 결과를 요구하는 다음 단계로 진행하지 마세요.'
    : '실패가 전달되면 해당 단계 이름(role)과 사유(error)를 성공한 결과와 함께 보존하세요.');
  if (node.config.merge === 'text') lines.push('중첩 목록을 펼쳐 각 항목의 본문을 줄바꿈으로 이어 붙인 텍스트를 다음 단계로 전달하세요.');
  else if (node.config.merge === 'sections') lines.push('중첩 목록을 펼쳐 각 객체의 항목 이름을 제목으로, 값을 본문으로 쓰세요. 오류는 해당 단계 이름과 사유로 작성하고 단락을 빈 줄로 구분해 전달하세요.');
  else lines.push('중첩 목록을 펼쳐 입력 순서와 각 항목의 자료형을 유지한 목록을 다음 단계로 전달하세요.');
  return lines;
}

/** A child graph has its own incoming edges, fork limits and joins, even when IDs repeat. */
export function parallelInstructions(graph: Graph): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  const controls = graph.nodes.filter(node => node.type === 'control.parallel' || node.type === 'control.join');
  if (!controls.length) return notes;
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, Block[]>();
  const incoming = new Map<string, Edge[]>();
  for (const edge of graph.edges) {
    const inputs = incoming.get(edge.to) ?? [];
    inputs.push(edge);
    incoming.set(edge.to, inputs);
    const target = nodes.get(edge.to);
    if (edge.kind === 'flow' && target) {
      const next = outgoing.get(edge.from) ?? [];
      next.push(target);
      outgoing.set(edge.from, next);
    }
  }
  for (const node of controls) {
    notes.set(node.id, node.type === 'control.parallel' ? forkInstructions(node, outgoing) :
      joinInstructions(node, incoming.get(node.id) ?? [], nodes));
  }
  return notes;
}
