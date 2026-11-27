import {scheduleSyntax,scheduleTime} from './schedule';
import {exportStepNames, exportStepPaths, sharedExportDefinitions, type ExportPreparation} from './agent-export';
import {byType, portsFor} from './catalog';
import {validateGraph} from './graph';
import {mcpScope, toolPin, type McpPin} from './mcp-scope';
import {fileExtensions} from './run-input';
import type {Block, Graph, Issue} from './types';

const libraryTools = new Map([
  ['reservations.list', '예약 조회'], ['reservations.create', '예약 생성'], ['reservations.cancel', '예약 취소'],
]);

// A top-level search of linked documents using only the user's question has a closed set of originals.
// Other inputs may carry an index, and nested calls can inherit different documents on every invocation.
function directEvidenceOriginals(graph: Graph, nodes: Map<string,Block>, check: Block): string[] {
  const input = graph.edges.filter(edge=>edge.to === check.id && edge.kind === 'data' && edge.input === 'input');
  if (input.length !== 1) return [];
  const search = nodes.get(input[0].from);
  if (search?.type !== 'knowledge.search' || search.config.storeKey) return [];
  const incoming = graph.edges.filter(edge=>edge.to === search.id);
  const queries = incoming.filter(edge=>edge.kind === 'data' && edge.input === 'input');
  if (queries.length !== 1 || nodes.get(queries[0].from)?.type !== 'input.user_request') return [];
  const references = incoming.filter(edge=>edge.input === 'context');
  const keys = new Set<string>();
  for (const edge of references) {
    const source = nodes.get(edge.from);
    if (edge.kind !== 'reference' || source?.type !== 'resource.context' || typeof source.config.exportResource !== 'string') return [];
    keys.add(source.config.exportResource);
  }
  return [...keys];
}

// The validator prefixes nested diagnostics with internal block IDs. Use the public step path instead.
function designIssue(issue: Issue, node: Block | undefined, step: string): ExportPreparation | undefined {
  const prefix = issue.path?.length ? issue.path.join(' › ') + ' › ' : '';
  const message = issue.message.slice(prefix.length);
  if (!issue.path?.length && node?.type==='control.trigger' && node.config.trigger==='schedule' &&
      (issue.fieldKey==='schedule' || message==='시작 일정을 지정하세요.')) return;
  if (issue.fieldKey === 'content' && ['resource.context','instruction.skill'].includes(node?.type ?? '') ||
      node?.type === 'connection.mcp' && message === '연결할 MCP 서버를 선택하세요.' ||
      (node?.config.exportResource || node?.config.exportSharedEdition) && message === '실행할 Workflow를 연결하세요.') return;
  if (message.startsWith('도구 연결 필요 · ')) return {step, action:'편집기에서 사용할 도구를 연결하고 이 단계의 허용 목록에 추가하세요.',
    reason:'설계에서 요구하는 도구가 이 단계에 연결되지 않았습니다.'};
  const missing = node && byType.get(node.type)?.fields.find(f => f.required && message === f.label + '을(를) 설정하세요.');
  if (missing) {
    if (missing.key === 'role') return {step, action:'편집기에서 이 업무를 위임할 역할의 이름을 입력하세요.',
      reason:'역할 이름이 있어야 ZIP에 하위 Agent의 지침과 호출 이름을 만들 수 있습니다.'};
    if (missing.key === 'goal' || missing.key === 'instruction') return {step, action:'편집기의 ‘' + missing.label + '’에 수행할 작업과 기대 결과를 적으세요.',
      reason:'이 단계를 맡을 Agent에게 전달할 업무가 비어 있습니다.'};
    if (missing.key === 'tool') return {step, action:'편집기에서 이 단계에 사용할 연결과 도구를 선택하세요.',
      reason:'이 단계에서 호출하거나 승인할 도구가 지정되지 않았습니다.'};
    return {step, action:'편집기의 ‘' + missing.label + '’ 항목을 설정하세요.', reason:'이 단계 실행에 필요한 ‘' + missing.label + '’ 값이 비어 있습니다.'};
  }
  if (issue.edgeId) return {step, action:'캔버스에서 이 연결의 출발 블록과 도착 블록, 전달 항목을 확인해 다시 연결하세요.', reason:message};
  if (message.startsWith('지원하지 않는 블록입니다')) return {step, action:'편집기에서 지원하는 블록으로 바꾸세요.',
    reason:'현재 버전에서 이 유형의 작업을 실행할 수 없습니다.'};
  if (issue.routeId || message === '다음 작업 또는 종료 경로를 연결하세요.') return {step, action:message,
    reason:'이 경로에서 이어갈 다음 단계가 지정되지 않았습니다.'};
  if (message === '이 블록까지 실행 순서를 연결하세요.') return {step, action:message, reason:'시작 단계에서 이 블록에 도달하는 실행 경로가 없습니다.'};
  if (message.includes('에 전달할 값을 연결하세요.')) return {step, action:message, reason:'이 단계에서 사용할 필수 입력값의 출처가 없습니다.'};
  if (message === '사용자 입력, 파일 입력 또는 시작 조건을 추가하세요.') return {step, action:message, reason:'이 설계에는 작업을 시작할 블록이 없습니다.'};
  if (message === '결과를 반환하거나 실행을 끝낼 답변 전달 블록을 추가하세요.') return {step, action:message, reason:'이 설계에는 실행 결과를 돌려줄 종료 단계가 없습니다.'};
  return {step, action:'편집기에서 설계 검사를 열고 해당 설정을 보완하세요.', reason:message};
}

type ToolScope = {pins?:McpPin[]; allowed?:string[]; caller?:string};
type ToolsByPin = ReadonlyMap<string,readonly string[]>;

// A callable Workflow inherits the tool scope of whichever Agent invokes it.
function scopeFor(parent: ToolScope, node: Block, references: Block[]): ToolScope {
  const connectors = references.filter(source => source.type === 'connection.mcp').map(source => source.config);
  const allowed = Array.isArray(node.config.allowedTools)
    ? node.config.allowedTools.filter((name:unknown): name is string => typeof name === 'string' && (!parent.allowed || parent.allowed.includes(name)))
    : parent.allowed;
  return {...parent, pins:mcpScope(parent.pins, connectors), allowed};
}

function portableToolSetup(node: Block, scopes: ToolScope[], step: string, record: (item:ExportPreparation)=>void, toolsByPin?:ToolsByPin) {
  const isAgent = node.type === 'agent.task';
  if (!isAgent && !['tool.invoke','approval.action','error.compensate'].includes(node.type)) return;
  for (const scope of scopes) {
    const allowed = Array.isArray(node.config.allowedTools) ? scope.allowed ?? [] : [];
    const names: unknown[] = isAgent ? allowed : [node.config.tool];
    for (const name of names) {
      if (typeof name !== 'string' || !name) continue;
      // A standalone approval describes the operation; it only resolves an external target if pinned.
      if (node.type === 'approval.action' && !(name.startsWith('mcp.') && scope.pins?.length)) continue;
      function add(item: ExportPreparation) {
        const conditions = [scope.caller && '호출자가 ‘' + scope.caller + '’인 경우', isAgent && '이 도구를 선택하면'].filter(Boolean);
        record(conditions.length ? {...item, action:conditions.join(' · ') + ', ' + item.action} : item);
      }
      if (scope.allowed && !scope.allowed.includes(name)) {
        add({step, action:'이 호출을 허용하는 상위 Agent와 도구 범위를 지정하세요.',
          reason:'호출자가 허용한 도구 목록에 이 단계의 작업이 없습니다.'});
        continue;
      }
      const library = libraryTools.get(name);
      if (library) add({step, action:'받는 환경에서 ' + library + '를 제공하는 도서관 서비스의 도구를 연결하세요.',
        reason:'이 단계가 사용하는 Studio 내장 ' + library + ' 도구는 ZIP에 포함되지 않습니다.'});
      else if (name.startsWith('mcp.')) {
        let pin:McpPin|undefined;
        try { pin = toolPin(name, scope.pins); }
        catch {
          add({step, action:'이 도구를 제공하는 MCP 연결의 버전 하나를 호출 단계 또는 상위 Agent에 지정하세요.',
            reason:'현재 도구 범위에서 호출할 MCP 연결 버전을 하나로 결정할 수 없습니다.'});
          continue;
        }
        if (pin) {
          const tools = toolsByPin?.get(JSON.stringify([pin.assetId,pin.version]));
          const tool = name.slice(('mcp.' + pin.assetId + '.').length);
          if (tools && !tools.includes(tool)) add({step, action:'이 단계의 도구를 제공하는 MCP 연결 버전을 선택하거나 호출할 도구를 바꾸세요.',
            reason:'지정한 MCP 버전의 허용 목록에 이 도구가 없습니다.'});
        }
      } else if (node.type !== 'approval.action' && !(isAgent && (name === 'knowledge.search' || name.startsWith('workflow.')))) {
        add({step, action:'이 호출에 사용할 도구를 정하고 받는 환경에서 연결하세요.',
          reason:'지정한 도구에 대응하는 연결 설정이 설계에 없습니다.'});
      }
    }
  }
}

export function designPreparation(graph: Graph, toolsByPin?:ToolsByPin): ExportPreparation[] {
  const definitions=sharedExportDefinitions(graph);
  const visited=new Set<string>();
  const items = new Map<string, ExportPreparation>();
  const locations = new Map<string, {node:Block; step:string; stepPath:string[]; graph:Graph}>();
  function record(item: ExportPreparation) { items.set(JSON.stringify(item), item); }
  function visit(current: Graph, ids: string[], titles: string[], parentPath: string[], parents: ToolScope[]) {
    const names = exportStepNames(current);
    const paths = exportStepPaths(current, parentPath);
    const byId = new Map(current.nodes.map(node => [node.id,node]));
    const sources = new Map<string,Block[]>(), callers = new Map<string,Block[]>();
    for (const edge of current.edges) {
      if (edge.kind !== 'reference') continue;
      const source = byId.get(edge.from), target = byId.get(edge.to);
      if (!source || !target) continue;
      if (edge.input === 'mcp' && source.type === 'connection.mcp') {
        const list = sources.get(target.id) ?? [];
        list.push(source); sources.set(target.id,list);
      }
      if (edge.input === 'workflow' && source.type === 'workflow.tool' && target.type === 'agent.task') {
        const list = callers.get(source.id) ?? [];
        list.push(target); callers.set(source.id,list);
      }
    }
    const scopeOf = (node:Block) => parents.map(parent => scopeFor(parent,node,sources.get(node.id) ?? []));
    for (const node of current.nodes) {
      const path = [...ids,node.id], pathNames = [...titles,names.get(node.id)!], step = pathNames.join(' › ');
      const stepPath = paths.get(node.id)!;
      locations.set(JSON.stringify(path), {node, step, stepPath, graph:current});
      const add = (item: ExportPreparation) => record({...item, stepPath});
      const config = node.config;
      if(Array.isArray(config.exportRequiredArgs)&&config.exportRequiredArgs.length)add({step,
        action:'실행 환경에서 실제 인자 '+config.exportRequiredArgs.join(', ')+' 값을 채운 후 승인할 대상과 인자를 확인하세요.',
        reason:'이 단계의 비밀값은 ZIP에서 자리표시자로 표시합니다. 실제 전송 전에 값을 준비해야 합니다.'});
      if (node.type === 'quality.evidence' && config.requireOriginal === true) {
        const note = {step, action:'이 단계에서 후보의 판 번호를 확인하세요. 해당 판의 연결 원문이 없으면 전체 원문 파일을 요청하세요.',
          reason:'원문 대조 필수 단계는 근거 후보만으로 완료할 수 없습니다. 판 번호와 해당 판의 원문 위치를 확인한 뒤 진행합니다.'};
        const originals = ids.length ? [] : directEvidenceOriginals(current, byId, node);
        if (!originals.length) add(note);
        else for (const key of originals) add({...note, when:{key, selected:false}});
      }
      if (node.type === 'agent.create_dynamic' && config.resultRequirement === 'evidence' && node.graph) {
        const child = node.graph;
        const returns = child.nodes.filter(n => n.type === 'output.answer' || n.type === 'control.terminate');
        const strict = new Set(child.nodes.filter(n => n.type === 'quality.evidence' && n.config.requireOriginal === true).map(n => n.id));
        const checkedAtSource = returns.length > 0 && returns.every(end => {
          const inputs = child.edges.filter(edge => edge.to === end.id && edge.kind === 'data' && edge.input === 'input');
          return inputs.length > 0 && inputs.every(edge => strict.has(edge.from));
        });
        if (!checkedAtSource) add({step, action:'담당자가 반환한 인용에 판이 빠지면 판 번호를 확인하고, 해당 판의 원문이 필요하면 이 배정에서 파일을 요청하세요.',
          reason:'이 배정은 반환된 인용을 같은 판의 원문 위치에서 확인해야 완료됩니다. 이미 대조한 인용은 그대로 사용합니다.'});
      }
      if (node.type === 'file.input') {
        const extensions = fileExtensions(config.accept);
        const file = (extensions.length ? extensions.join(', ') + ' 형식의 ' : '') + '실제 파일';
        add({step, action:(config.attachmentMode === 'request' ? '이 단계의 요청을 받으면 새 파일을 첨부하세요.' : '첫 요청에 ' + file + '을 첨부하세요.'),
          reason:config.attachmentMode === 'request' ? '해당 단계는 첫 첨부와 별도로 ' + file + '을 받아야 진행합니다.' : '이 단계는 실행할 때 받은 파일의 이름과 본문을 다음 작업으로 전달합니다.'});
      }
      if (node.type === 'control.trigger' && ['schedule','event'].includes(config.trigger)) {
        if (ids.length) add({step, action:'예약·이벤트의 시작 조건을 최상위 설계에 두고 이 설계를 호출하세요.',
          reason:'호출된 하위 설계는 수동 입력으로 시작합니다.'});
        else if (config.trigger === 'schedule') {
          const schedule = typeof config.schedule === 'string' ? config.schedule.trim() : '';
          const parsed=scheduleTime(schedule,Date.now());
          if('error' in parsed || parsed.time===null) add({step,action:'실행 일정을 '+scheduleSyntax+' 중 하나로 정하고 다음 실행 시각을 확인하세요.',
            reason:'error' in parsed?parsed.error:'저장된 단발 실행 시각이 지났습니다.'});
          else add({step, action:'받는 환경의 예약 서비스에 ‘' + schedule + '’ 일정과 시간대를 등록하세요. 매일 시각은 한국 표준시입니다.',
            reason:'이 단계는 예약 시각에 실행을 시작해 줄 서비스가 필요합니다.'});
        } else {
          const event = typeof config.event === 'string' ? config.event.trim() : '';
          add({step, action:'받는 환경에 ' + (event ? '‘' + event + '’ ' : '') + '이벤트를 수신해 Workflow를 시작할 연결을 등록하세요.',
            reason:'이 단계는 외부 이벤트가 도착할 때 실행을 시작합니다.'});
        }
      }
      if (node.type === 'memory.access') {
        const key = typeof config.key === 'string' ? config.key.trim() : '';
        add({step, action:'받는 환경에서 이용자와 Workflow별로 구분되는 기억 저장소를 연결하세요.',
          reason:'대화가 바뀌어도 ' + (key ? '‘' + key + '’ 이름으로 ' : '') + '저장한 값을 다시 읽을 수 있어야 합니다.'});
      }
      if (node.type === 'knowledge.manage' && typeof config.storeKey === 'string' && config.storeKey.trim())
        add({step, action:'받는 환경에서 ‘' + config.storeKey.trim() + '’ 자료집의 버전을 관리할 저장소를 연결하세요.',
          reason:'이 단계는 자료집의 원문과 색인 또는 발행 상태를 저장합니다.'});
      const scopes = scopeOf(node);
      portableToolSetup(node,scopes,step,add,toolsByPin);
      const edition=config.exportSharedEdition, definition=definitions.get(edition);
      if (!node.graph && !definition) continue;
      const callSites = callers.get(node.id) ?? [];
      const targets = callSites.length ? callSites : [node];
      if(definition) {
        for(const target of targets)for(const scope of scopeOf(target)){
          const caller=[scope.caller,[...titles,names.get(target.id)!].join(' › ')].filter(Boolean).join(' → ');
          const signature=JSON.stringify([edition,scope.pins,scope.allowed,caller]);
          if(visited.has(signature))continue;
          visited.add(signature);
          visit(definition.graph,definition.ids,definition.titles,definition.stepPath,[{...scope,caller}]);
        }
        continue;
      }
      const groups = new Map<string,{scope:ToolScope; callers:Set<string>}>();
      for (const target of targets) for (const scope of scopeOf(target)) {
        const signature = JSON.stringify([scope.pins, scope.allowed]);
        const entry = groups.get(signature) ?? {scope, callers:new Set<string>()};
        const caller = callSites.length > 1 ? [...titles, names.get(target.id)!].join(' › ') : undefined;
        const origin = [scope.caller, caller].filter(Boolean).join(' → ');
        if (origin) entry.callers.add(origin);
        groups.set(signature, entry);
      }
      const childScopes = [...groups.values()].map(({scope, callers})=>({
        pins:scope.pins, allowed:scope.allowed, caller:groups.size > 1 ? [...callers].join(' 또는 ') : scope.caller,
      }));
      visit(node.graph!, path,pathNames,stepPath,childScopes);
    }
  }
  visit(graph,[],[],[],[{}]);
  for (const issue of validateGraph(graph)) {
    const path = issue.path ?? [];
    const parent = locations.get(JSON.stringify(path));
    const location = issue.nodeId ? locations.get(JSON.stringify([...path,issue.nodeId])) : undefined;
    const item = designIssue(issue,location?.node,location?.step ?? parent?.step ?? 'Workflow 전체');
    if (!item) continue;
    item.stepPath = location?.stepPath ?? parent?.stepPath ?? [];
    // A missing destination on one exit does not prevent another exit from running.
    if (location && (issue.routeId || issue.edgeId)) {
      const edge = issue.edgeId && location.graph.edges.find(edge=>edge.id===issue.edgeId);
      const routeId = issue.routeId || (edge && edge.from===location.node.id && edge.kind==='flow' && edge.out);
      const routes = portsFor(location.node).outputs.filter(port=>port.kind==='flow');
      const route = routes.length > 1 && routes.find(port=>port.id===routeId);
      if (route) item.action = '‘' + route.label + '’ 경로를 선택했을 때 ' +
        (issue.routeId ? '해당 출구의 다음 블록을 연결하세요.' : item.action);
    }
    record(item);
  }
  return [...items.values()];
}
