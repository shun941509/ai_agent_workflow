import {
  byType, canonicalErrorStrategy, createBlock, levels, portsFor, replyDeadlineDefaultMinutes,selectionSettings,
  terminalBehavior, terminalBehaviorOptions, type Block, type Edge, type Graph, type TerminalBehavior,
} from '../../domain/index';
import { toolName } from '../tool-name';
import { edgeGroupId, type EditorSelection } from '../../domain/editor-focus';
import { firstSourceSentence } from '../../domain/source-preview';
import { nodeLayout } from './node-layout';

export { levels };
export const specFor = (type: string) => byType.get(type);
export const formerNames: Record<string, string> = {
  'agent.coordinate':'작업 조정', 'agent.select_candidate':'후보 탐색·선택', 'control.wait':'조건 기다리기',
};

export function replyDeadlineMinutes(node: Block): number {
  if (node.type === 'control.wait') return node.config.timeoutMinutes ?? replyDeadlineDefaultMinutes;
  return node.type === 'input.form' ? node.config.replyTimeoutMinutes ?? 0 : 0;
}

export function editReplySettings(node: Block, patch: {replyTimeoutMinutes: number} | {fields: unknown}): Block {
  if (node.type !== 'control.wait') return {...node, config:{...node.config, ...patch}};
  if ('replyTimeoutMinutes' in patch && patch.replyTimeoutMinutes > 0)
    return {...node, config:{...node.config, timeoutMinutes:patch.replyTimeoutMinutes}};

  // Only switching off the legacy timer or adding form fields requires a new execution type.
  const {timeoutMinutes = replyDeadlineDefaultMinutes, ...preserved} = node.config;
  return {...node, type:'input.form', config:{...preserved, fields:[], replyTimeoutMinutes:timeoutMinutes, ...patch}};
}

export function changeBlockMode(node: Block, type: string): Block {
  const next = createBlock(type, { id:node.id });
  const config = {...next.config, ...node.config};
  const selection = node.type === 'agent.coordinate' || node.type === 'agent.select_candidate';
  if (selection) {
    // Older graphs can carry both field sets. Keep the values the runner uses.
    const {options,instruction}=selectionSettings(node);
    delete config.tasks;
    delete config.candidates;
    delete config.goal;
    delete config.criterion;
    if (type === 'agent.coordinate') Object.assign(config, {tasks:options, goal:instruction});
    else Object.assign(config, {candidates:options, criterion:instruction});
  }
  const tool = node.type === 'tool.invoke' || node.type === 'error.compensate';
  const defaultTitle = node.title === specFor(node.type)?.name || node.title === formerNames[node.type];
  return {...node, type, config, title:(selection || tool) && defaultTitle ? next.title : node.title};
}

export function changeTerminalBehavior(node: Block, behavior: TerminalBehavior): Block {
  if (behavior === terminalBehavior(node)) return node;
  const type = behavior === 'answer' ? 'output.answer' : 'control.terminate';
  const next = type === node.type ? node : changeBlockMode(node, type);
  return behavior === 'answer' ? next : {...next, config:{...next.config, status:behavior}};
}

export function nodeTitle(node: Block): string {
  if ((node.type === 'tool.invoke' || node.type === 'error.compensate') &&
      node.title === specFor(node.type)?.name && typeof node.config.tool === 'string' && node.config.tool.trim()) {
    return toolName(node.config.tool).replace(/^mcp\.[\w-]+\./, '');
  }
  return node.title;
}

// All canvas and picker labels in a team use the same order, including legacy blocks
// whose displayed name comes from their tool configuration. Stored block names stay editable.
const labelsByNodes = new WeakMap<Block[], Map<string, string>>();
export function titleById(graph: Graph, id: string): string {
  let labels = labelsByNodes.get(graph.nodes);
  if (!labels) {
    labels = new Map();
    const titles = graph.nodes.map(node => nodeTitle(node).trim().replace(/\s+/g, ' ').normalize('NFC'));
    const totals = new Map<string, number>();
    const ordinals = new Map<string, number>();
    for (const title of titles) totals.set(title, (totals.get(title) ?? 0) + 1);
    for (const [index, node] of graph.nodes.entries()) {
      const title = titles[index];
      let label = nodeTitle(node);
      if ((totals.get(title) ?? 0) > 1) {
        let ordinal = ordinals.get(title) ?? 0;
        do { label = ++ordinal + '번 · ' + title; } while (totals.has(label));
        ordinals.set(title, ordinal);
      }
      labels.set(node.id, label);
    }
    labelsByNodes.set(graph.nodes, labels);
  }
  return labels.get(id) ?? id;
}
export const edgeNames = { flow: '진행', data: '데이터', reference: '참조' };
export const connectionKindLabels = { flow: '실행 순서', data: '전달할 값', reference: '참조' };
export const clone = <T>(value: T): T => structuredClone(value);
export const empty = (): Graph => ({ nodes: [], edges: [] });
export const uniqueId = () => crypto.randomUUID();
export const groupKey = edgeGroupId;
export type Selection = EditorSelection;
export type EdgeGroup = {
  id: string;
  from: string;
  to: string;
  kind: Edge['kind'];
  members: Edge[];
  caption: string;
  branchLabel: string;
  flowConditions: string[];
};
export function edgePortLabels(graph: Graph, edge: Edge) {
  const source = graph.nodes.find(node => node.id === edge.from);
  const target = graph.nodes.find(node => node.id === edge.to);
  return {
    output: source && portsFor(source).outputs.find(port => port.id === edge.out)?.label || edge.out,
    input: target && portsFor(target).inputs.find(port => port.id === edge.input)?.label || edge.input,
  };
}
export function edgeLabel(graph: Graph, edge: Edge): string {
  const { output, input } = edgePortLabels(graph, edge);
  return output + ' → ' + input;
}

export function shortBranchLabel(label: string): string {
  const chars = Array.from(label);
  return chars.length > 24 ? chars.slice(0, 23).join('') + '…' : label;
}

/** Width estimate at the 12px type size used by expanded route rows. */
export function routeLabelWidth(label: string): number {
  let width = 0;
  for (const ch of label) width += ch.codePointAt(0)! > 255 ? 12 : 9;
  return width;
}

function fitRouteLabel(label: string, maxWidth: number): string {
  if (routeLabelWidth(label) <= maxWidth) return label;
  const chars = Array.from(label);
  let left = 0, right = chars.length, used = 12;
  while (left < right) {
    const takeLeft = left <= chars.length - right;
    const next = routeLabelWidth(chars[takeLeft ? left : right - 1]);
    if (used + next > maxWidth) break;
    used += next;
    if (takeLeft) left++; else right--;
  }
  return chars.slice(0, left).join('') + '…' + chars.slice(right).join('');
}

/** Compare siblings before abbreviating. Only ambiguous excerpts need a different window. */
export function compactRouteLabels(names: string[], maxWidth: number): Map<string, string> {
  const result = new Map<string, string>();
  function assign(entries: {name: string; part: string}[]) {
    const buckets = new Map<string, typeof entries>();
    for (const entry of entries) {
      const leading = entry.name.startsWith(entry.part) ? '' : '…';
      const trailing = entry.name.endsWith(entry.part) ? '' : '…';
      const text = leading + fitRouteLabel(entry.part, maxWidth - routeLabelWidth(leading + trailing)) + trailing;
      result.set(entry.name, text);
      const bucket = buckets.get(text);
      if (bucket) bucket.push(entry); else buckets.set(text, [entry]);
    }
    for (const duplicates of buckets.values()) {
      if (duplicates.length < 2) continue;
      const chars = duplicates.map(entry => Array.from(entry.part));
      const shortest = Math.min(...chars.map(word => word.length));
      let start = 0, tail = 0;
      while (start < shortest && chars.every(word => word[start] === chars[0][start])) start++;
      while (tail < shortest - start && chars.every(word => word.at(-1-tail) === chars[0].at(-1-tail))) tail++;
      // Keep whole differing words when the common prefix/suffix ends inside a word.
      let wordStart = start, wordTail = tail;
      while (wordStart && !/\s/u.test(chars[0][wordStart - 1])) wordStart--;
      while (wordTail && !/\s/u.test(chars[0][chars[0].length - wordTail])) wordTail--;
      const trimWords = wordStart > 0 || wordTail > 0;
      const smaller = duplicates.flatMap((entry, i) => {
        const part = trimWords ? chars[i].slice(wordStart, chars[i].length - wordTail).join('').trim()
          : chars[i].slice(start, chars[i].length - tail).join('');
        return part && part !== entry.part ? [{name:entry.name, part}] : [];
      });
      if (smaller.length) assign(smaller);
    }
  }
  assign([...new Set(names)].map(name => ({name, part:name})));
  return distinctLabels(result, maxWidth);
}

function distinctLabels(result: Map<string, string>, maxWidth: number) {
  // A designer can give a different route the literal name of another route's
  // abbreviation. Reserve actual names first, then disambiguate any such collision.
  const used = new Set<string>();
  for (const name of [...result.keys()].sort((a, b) => a.length - b.length)) {
    const label = result.get(name)!;
    let text = label;
    for (let i = 2; used.has(text); i++) {
      const suffix = ' (' + i + ')';
      text = fitRouteLabel(label, maxWidth - routeLabelWidth(suffix)) + suffix;
    }
    result.set(name, text);
    used.add(text);
  }
  return result;
}

// "지점01번" needs its prefix, but in "운영 창구 제001지점" the number already names its unit.
const destinationNumber = /(?:(?:지점|창구)(?![ \t]*제?\d+[ \t]*(?:지점|창구|호점|분관))[ \t]*)?제?\d+(?:[ \t]*(?:지점|호점|창구|분관|호실|호선|번째|번지|번|호|층|차|팀|동|실))?/gu;

/** For titles with the same wording, keep each varying number together with its original unit. */
function numberedDestinationLabels(bodies: string[]): Map<string, string> {
  const families = new Map<string, {body: string; numbers: string[]}[]>();
  for (const body of bodies) {
    const numbers = body.match(destinationNumber) ?? [];
    if (!numbers.length) continue;
    const pattern = body.replace(/\d+/gu, '\u0000');
    const family = families.get(pattern);
    if (family) family.push({body, numbers});
    else families.set(pattern, [{body, numbers}]);
  }

  const labels = new Map<string, string>();
  for (const family of families.values()) {
    if (bodies.length === 1) {
      labels.set(family[0].body, family[0].numbers.join(' · '));
      continue;
    }
    if (family.length < 2) continue;
    const varying = family[0].numbers.map((token, i) => family.some(entry => entry.numbers[i] !== token));
    for (const {body, numbers} of family) {
      labels.set(body, numbers.filter((_, i) => varying[i]).join(' · '));
    }
  }
  return labels;
}

/** Prefer distinguishing words unless sibling destinations differ only by their numbers. */
export function compactDestinationLabels(titles: string[], maxWidth = 168): Map<string, string> {
  const entries = [...new Set(titles)].map(title => {
    const ordinal = title.match(/^\d+번 · /u)?.[0] ?? '';
    return {title, ordinal, body:title.slice(ordinal.length)};
  });
  const width = maxWidth - entries.reduce((max, item) => Math.max(max, routeLabelWidth(item.ordinal)), 0);
  const wordsByBody = new Map<string, Map<string, number>>();
  const frequency = new Map<string, number>();
  for (const {body} of entries) {
    if (wordsByBody.has(body)) continue;
    const words = new Map<string, number>();
    for (const match of body.matchAll(/[\p{L}\p{M}]+/gu)) {
      const word = match[0];
      if (word.length <= 2 * width / 9 && !words.has(word)) words.set(word, match.index);
    }
    wordsByBody.set(body, words);
    for (const word of words.keys()) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }

  const numbered = numberedDestinationLabels([...wordsByBody.keys()]);
  const labels = new Map(numbered);
  const groups = new Map<string, string[]>();
  for (const [body, words] of wordsByBody) {
    if (routeLabelWidth(body) <= width) { labels.set(body, body); continue; }
    if (numbered.has(body)) continue;
    // Prefer whole infrequent words; when each is shared, their combination can distinguish the destination.
    const ranked = [...words].map(([word, start]) => ({word, start, count:frequency.get(word)!}))
      .filter(item => item.count < wordsByBody.size)
      .sort((a, b) => a.count - b.count);
    const picked: typeof ranked = [];
    let remaining = width - 2 * routeLabelWidth('…');
    for (const item of ranked) {
      const cost = routeLabelWidth(item.word) + (picked.length ? routeLabelWidth('…') : 0);
      if (cost > remaining) continue;
      picked.push(item);
      remaining -= cost;
      if (item.count === 1) break;
    }
    picked.sort((a, b) => a.start - b.start);
    const excerpt = picked.map(({word, start}, index) => {
      const previous = picked[index - 1];
      if (!previous) return word;
      const between = body.slice(previous.start + previous.word.length, start);
      return (between.trim() ? '…' : ' ') + word;
    }).join('');
    const last = picked.at(-1);
    const snippet = last ? (picked[0].start ? '…' : '') + excerpt
      + (last.start + last.word.length < body.length ? '…' : '') : '';
    const group = groups.get(snippet);
    if (group) group.push(body); else groups.set(snippet, [body]);
  }
  for (const [snippet, bodies] of groups) {
    if (snippet && bodies.length === 1) labels.set(bodies[0], snippet);
    else {
      for (const [body, label] of compactRouteLabels(bodies, width)) labels.set(body, label);
    }
  }
  const result = new Map(entries.map(({title, ordinal, body}) =>
    [title, routeLabelWidth(title) <= maxWidth ? title : ordinal + labels.get(body)!]));
  // Separate numbering schemes can both have an "001번". Add the part that
  // distinguishes their names, leaving the complete number at the end.
  const sameLabel = new Map<string, typeof entries>();
  for (const entry of entries) {
    const label = result.get(entry.title)!;
    const siblings = sameLabel.get(label);
    if (siblings) siblings.push(entry); else sameLabel.set(label, [entry]);
  }
  for (const [label, siblings] of sameLabel) {
    if (siblings.length < 2) continue;
    const contexts = new Map<string, string>();
    for (const {title, body} of siblings) {
      if (title === label || !numbered.has(body)) continue;
      const tokens = new Set(numbered.get(body)!.split(' · '));
      contexts.set(title, body.replace(destinationNumber, token => tokens.has(token) ? '' : token).trim());
    }
    const excerpts = compactRouteLabels([...contexts.values()], Math.max(48, maxWidth - routeLabelWidth(label + ' · ')));
    for (const {title, ordinal, body} of siblings) {
      const context = contexts.get(title);
      if (context) result.set(title, ordinal + excerpts.get(context) + ' · ' + numbered.get(body));
    }
  }
  return distinctLabels(result, maxWidth);
}

export function branchPredicate(node: Block): string {
  const { path, expected, operator } = node.config;
  const field = String(path || '입력값');
  const value = String(expected ?? '');
  if (operator === 'equals') return field + ' = ' + (value || '빈 문자열');
  if (operator === 'greater') return field + ' > ' + (value || '0');
  if (operator === 'contains') return field + '에 ‘' + value + '’ 포함';
  return field + '에 값이 있음';
}
export function groupEdges(graph: Graph): EdgeGroup[] {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const errorSources = new Set<string>();
  const pairs = new Map<string, Edge[]>();
  for (const e of graph.edges) {
    const key = groupKey(e.from, e.to);
    const members = pairs.get(key) ?? [];
    members.push(e);
    pairs.set(key, members);
    if (e.kind === 'flow' && nodes.get(e.to)?.type === 'error.handle') errorSources.add(e.from);
  }
  return [...pairs].map(([id, members]) => {
    const head =
      members.find((e) => e.kind === 'flow') ?? members.find((e) => e.kind === 'data') ?? members[0];
    const flows = members.filter((e) => e.kind === 'flow');
    const source = nodes.get(head.from), target = nodes.get(head.to);
    const outputs = source ? portsFor(source).outputs : [];
    const conditional = outputs.some(port => port.kind === 'flow' && port.id !== 'next');
    const hasErrorPath = errorSources.has(head.from);
    const routes = new Set<string>();
    for (const flow of flows) {
      if (target?.type === 'error.handle') {
        routes.add('오류 발생');
        continue;
      }
      const port = outputs.find(port => port.id === flow.out);
      if (source?.type === 'control.branch' && flow.out === 'yes' && port?.label === '맞음') {
        routes.add(branchPredicate(source));
      } else if (flow.out === 'next' && hasErrorPath) {
        routes.add('작업 성공');
      } else if (source?.type === 'control.parallel') {
        routes.add('병렬 시작');
      } else {
        routes.add(port?.label || flow.out);
      }
    }
    // A join can also be activated by a failed predecessor, independently of its output route.
    if (flows.length && target?.type === 'control.join') routes.add('오류 발생');
    const flowConditions = [...routes];
    const branchLabel = conditional || hasErrorPath ? flowConditions.join(' 또는 ') : '';
    const data = members.find((e) => e.kind === 'data');
    const text =
      data?.label ||
      head.label ||
      (data
        ? source?.type === 'input.user_request'
          ? '질문 전달'
          : target?.type === 'output.answer'
            ? '작성한 답변 전달'
            : edgeLabel(graph, data)
        : edgeNames[head.kind]);
    return { id, from: head.from, to: head.to, kind: head.kind, members, caption: branchLabel || text, branchLabel, flowConditions };
  });
}
export function subgraph(root: Graph, path: string[]): Graph {
  let current = root;
  for (const id of path) {
    const child = current.nodes.find((n) => n.id === id)?.graph;
    if (!child) return empty();
    current = child;
  }
  return current;
}
export function updateSubgraph(root: Graph, path: string[], next: Graph): Graph {
  if (!path.length) return next;
  const [id, ...rest] = path;
  return {
    ...root,
    nodes: root.nodes.map((n) =>
      n.id === id ? { ...n, graph: updateSubgraph(n.graph ?? empty(), rest, next) } : n,
    ),
  };
}
export function nodeSummary(node: Block): string {
  const c = node.config;
  if (specFor(node.type)?.menuType === 'output.answer') {
    const behavior = terminalBehavior(node);
    const label = terminalBehaviorOptions.find(option => option.value === behavior)!.label;
    return behavior !== 'answer' && c.message ? label + ' · ' + c.message : label;
  }
  const deadline = replyDeadlineMinutes(node);
  if (deadline > 0) return [`회신 기한 ${deadline}분`, c.prompt].filter(Boolean).join(' · ');
  if (node.type === 'tool.invoke' || node.type === 'error.compensate') {
    const mode = node.type === 'error.compensate' ? '보상 작업' : '도구 호출';
    return c.tool && node.title !== specFor(node.type)?.name ? mode + ' · ' + toolName(c.tool) : mode;
  }
  if (node.type === 'ai.classify' && Array.isArray(c.categories) && c.categories.length)
    return c.categories.join(' · ');
  if (node.type === 'control.branch') return [c.path, c.yesLabel, c.noLabel].filter(Boolean).join(' / ');
  if (node.type === 'agent.create_dynamic' && c.role) {
    if (!c.failurePolicy) return c.role + ' · 최대 ' + (c.maxAgents ?? c.maxCreatedAgents ?? 3) + '명';
    const policy = c.failurePolicy === 'collect' ? '일부 결과 수집' : '미완료 시 중단';
    return '총 ' + (c.maxCreatedAgents ?? 3) + '명 · 동시 ' + (c.maxInFlightAgents ?? 2) + '명 · ' + policy;
  }
  if (node.type === 'control.parallel')
    return (
      '동시 ' +
      (c.maxConcurrency ?? 2) +
      '개 · ' +
      (c.failurePolicy === 'stop' ? '실패 시 멈춤' : '일부 실패 시 수집')
    );
  if (node.type === 'error.handle') {
    const strategy = canonicalErrorStrategy(c.strategy || 'continue');
    if (strategy === 'continue') return '실패 시 후속 단계로 계속';
    if (strategy === 'stop') return '실패 시 중단';
    return '오류 처리 방식 확인 필요';
  }
  const values: unknown[] = node.graph
    ? [c.goal, c.task, node.graph.nodes.length + '개 블록']
    : [c.goal, c.role, c.instruction, c.prompt, c.question, c.content];
  if (node.type.startsWith('input.')) values.unshift(c.label);
  const text = values.find((v) => typeof v === 'string' && v.trim());
  return typeof text === 'string' ? text : (specFor(node.type)?.description ?? '지원 종료 · 수정 필요');
}
const cardRoles: Record<string, string> = {
  'input.user_request': '사용자 입력',
  'ai.single_task': 'AI 작업',
  'resource.context': '참고 자료',
  'instruction.skill': '작업 지침',
  'file.create': '파일 생성',
};
export function materialPreview(node: Block, materialSources?: Readonly<Record<string, string>>): string {
  if (node.type !== 'resource.context') return '';
  return firstSourceSentence(node.config.assetId ? materialSources?.[node.id] : node.config.content);
}

export function nodeCaption(node: Block): string {
  if (node.type === 'control.branch') return branchPredicate(node);
  if (node.type === 'ai.classify') {
    const instruction = node.config.instruction;
    return typeof instruction === 'string' && instruction.trim() ? instruction : '질문의 범주를 선택합니다.';
  }
  if (node.type === 'output.answer' && terminalBehavior(node) === 'answer') return '최종 출력';
  return cardRoles[node.type] ?? nodeSummary(node);
}
export function arranged(graph: Graph): Graph {
  const owner = new Map<string, string>();
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  for (const edge of graph.edges) {
    if (edge.kind === 'reference' && edge.from !== edge.to && byId.has(edge.to) && !owner.has(edge.from))
      owner.set(edge.from, edge.to);
  }
  const runnable = graph.nodes.filter(n => !owner.has(n.id));
  const ids = new Set(runnable.map((n) => n.id));
  const children = new Map<string, Set<string>>(),
    indegree = new Map(runnable.map((n) => [n.id, 0]));
  for (const edge of graph.edges) {
    if (edge.kind === 'reference' || edge.from === edge.to || !ids.has(edge.from) || !ids.has(edge.to))
      continue;
    const bucket = children.get(edge.from) ?? new Set();
    if (!bucket.has(edge.to)) {
      bucket.add(edge.to);
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }
    children.set(edge.from, bucket);
  }
  const queue = runnable.filter((n) => !indegree.get(n.id)).map((n) => n.id);
  const column = new Map(queue.map((id) => [id, 0]));
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const child of children.get(id) ?? []) {
      column.set(child, Math.max(column.get(child) ?? 0, (column.get(id) ?? 0) + 1));
      indegree.set(child, (indegree.get(child) ?? 1) - 1);
      if (!indegree.get(child)) queue.push(child);
    }
  }
  const nextY = new Map<number, number>();
  const positioned = new Map<string, Block>();
  const references = new Map<string, Block[]>();
  for (const node of graph.nodes) {
    const target = owner.get(node.id);
    if (!target) continue;
    const row = references.get(target) ?? [];
    row.push(node);
    references.set(target, row);
  }
  for (const node of runnable) {
    const col = column.get(node.id) ?? 0, x = 40 + col * 245;
    let y = nextY.get(col) ?? 50;
    positioned.set(node.id, { ...node, x, y });
    y += nodeLayout(node).height;
    for (const ref of references.get(node.id) ?? []) {
      y += 40;
      positioned.set(ref.id, { ...ref, x, y });
      y += nodeLayout(ref).height;
    }
    nextY.set(col, y + 68);
  }
  // Incomplete or imported reference-only chains may have no runnable consumer.
  let spareY = Math.max(50, ...nextY.values());
  return { ...graph, nodes: graph.nodes.map(node => {
    const placed = positioned.get(node.id);
    if (placed) return placed;
    const y = spareY;
    spareY += nodeLayout(node).height + 40;
    return { ...node, x: 40, y };
  }) };
}
export function graphChanges(before: Graph, after: Graph): string[] {
  const changes: string[] = [];
  const describe = (value: unknown) => {
    if (value === undefined || value === null || value === '') return '비어 있음';
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  for (const n of before.nodes)
    if (!after.nodes.some((m) => m.id === n.id)) changes.push('블록 삭제 · ' + n.title);
  for (const n of after.nodes) {
    const old = before.nodes.find((m) => m.id === n.id);
    if (!old) {
      changes.push('블록 추가 · ' + n.title + ' — ' + nodeSummary(n));
      if (n.graph) changes.push(...graphChanges(empty(), n.graph).map((s) => n.title + ' › ' + s));
      continue;
    }
    const spec = specFor(n.type);
    if (old.type !== n.type) changes.push(n.title + ' · ' + (spec?.name ?? n.type) + ' 방식으로 변경');
    if (old.title !== n.title) changes.push('이름 · ' + old.title + ' → ' + n.title);
    for (const key of new Set([...Object.keys(old.config), ...Object.keys(n.config)])) {
      if (JSON.stringify(old.config[key]) !== JSON.stringify(n.config[key])) {
        const label = spec?.fields.find((f) => f.key === key)?.label || key;
        changes.push(
          n.title + ' · ' + label + ' · ' + describe(old.config[key]) + ' → ' + describe(n.config[key]),
        );
      }
    }
    if (JSON.stringify(old.graph) !== JSON.stringify(n.graph)) {
      changes.push(
        ...graphChanges(old.graph ?? empty(), n.graph ?? empty()).map((s) => n.title + ' › ' + s),
      );
    }
  }
  const edgeKey = (e: Edge) => JSON.stringify([e.from, e.to, e.kind, e.out, e.input, e.label]);
  const oldKeys = new Set(before.edges.map(edgeKey)),
    newKeys = new Set(after.edges.map(edgeKey));
  for (const [g, other, action] of [
    [before, newKeys, '삭제'],
    [after, oldKeys, '추가'],
  ] as const) {
    for (const e of g.edges)
      if (!other.has(edgeKey(e)))
        changes.push(
          '연결 ' +
            action +
            ' · ' +
            (g.nodes.find((n) => n.id === e.from)?.title ?? e.from) +
            ' → ' +
            (g.nodes.find((n) => n.id === e.to)?.title ?? e.to),
        );
  }
  return changes;
}
