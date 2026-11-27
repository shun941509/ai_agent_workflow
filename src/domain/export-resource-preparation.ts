import {childAgentContext, emptyAgentContext, isDelegatedRole, modelBlocks, skillsForAgent, type AgentContext} from './agent-context';
import {exportStepNames, exportStepPaths, sharedExportDefinitions, type ExportMcp, type ExportPreparation, type ExportResource} from './agent-export';
import type {Block, Graph} from './types';

interface MaterialScope {
  documents: string[];
  connections?: string[];
  allowed?: string[];
  callers?: Map<string,string>;
  sharedCaller?: string;
  agent: AgentContext;
}

type Use = {step:string; stepPath:string[]; condition?:string; chooseEdition:boolean};
const unique = (keys: string[]) => [...new Set(keys)];
const collectionFields = ['exportCollection','exportDraft','exportIndex','exportPublished'];

/** Locate the stages that use each edition. A connector's own title can be private. */
function resourceUses(graph: Graph) {
  const consumers = new Map<string, Map<string,Use>>();
  const scripts = new Set<string>();
  const connectorIds = new Map<string,string>();
  const definitions=sharedExportDefinitions(graph);
  const visited=new Set<string>();
  function visit(current: Graph, path: string[], parentPath:string[], inherited: MaterialScope) {
    const names = exportStepNames(current);
    const paths = exportStepPaths(current, parentPath);
    const nodes = new Map(current.nodes.map(node => [node.id, node]));
    for (const node of current.nodes) {
      if (node.type === 'connection.mcp' && typeof node.config.assetId === 'string')
        connectorIds.set(node.config.exportResource, node.config.assetId);
    }
    const refs = new Map<string, Block[]>(), data = new Map<string, Block[]>();
    for (const edge of current.edges) {
      const source = nodes.get(edge.from);
      if (edge.kind === 'flow' || !source) continue;
      const edges = edge.kind === 'reference' ? refs : data;
      const linked = edges.get(edge.to) ?? [];
      linked.push(source);
      edges.set(edge.to, linked);
    }
    const children = new Map<string, MaterialScope>();
    const callers = new Map<string, {name:string; scope:MaterialScope}[]>();
    for (const node of current.nodes) {
      const step = [...path, names.get(node.id)!].join(' › ');
      const stepPath = paths.get(node.id)!;
      function record(key: unknown, condition?:string, chooseEdition = false) {
        if (typeof key !== 'string') return;
        const caller = inherited.callers?.get(key);
        const terms = [inherited.sharedCaller && '호출 경로가 ‘'+inherited.sharedCaller+'’인 경우', caller && '호출자가 ' + caller + '인 경우', condition].filter(Boolean);
        const use:Use = {step, stepPath, chooseEdition, ...(terms.length ? {condition:terms.join(' · ')} : {})};
        const steps = consumers.get(key) ?? new Map<string,Use>();
        steps.set(JSON.stringify([stepPath, use.condition]), use);
        consumers.set(key, steps);
      }
      const key = node.config.exportResource;
      if (node.type === 'workflow.call' || node.type === 'workflow.tool') record(key);
      if (node.type === 'instruction.skill' && node.config.requiresScripts === true) scripts.add(key);
      for (const field of collectionFields) {
        const binding = node.config[field];
        if (Array.isArray(binding)) for (const resource of binding) record(resource);
      }
      const linked = refs.get(node.id) ?? [];
      const linkedKeys = (type: string) => linked.filter(src => src.type === type && typeof src.config.exportResource === 'string').map(src => src.config.exportResource as string);
      const documents = unique([...inherited.documents, ...linkedKeys('resource.context')]);
      const localConnections = linkedKeys('connection.mcp');
      const connections = localConnections.length ? localConnections.filter(k => !inherited.connections || inherited.connections.includes(k)) : inherited.connections;
      const localSkills = linked.filter(src => src.type === 'instruction.skill').map(src => ({
        key:'block:' + src.id, title:src.config.exportResource, version:String(src.config.version || '1'),
      }));
      const skills = skillsForAgent(node, inherited.agent, localSkills);
      const model = modelBlocks.has(node.type) || isDelegatedRole(node.type) && !node.graph;
      const usesContext = model || node.type === 'knowledge.search' || node.type === 'knowledge.manage' && !['publish','withdraw'].includes(node.config.operation);
      if (usesContext) for (const k of documents) record(k);
      if (model) for (const skill of skills) record(skill.title);
      const allowed:string[]|undefined = Array.isArray(node.config.allowedTools)
        ? node.config.allowedTools.filter((t:unknown)=>typeof t==='string' && (!inherited.allowed || inherited.allowed.includes(t)))
        : inherited.allowed;
      const isAgent = node.type === 'agent.task';
      const selectedTools = Array.isArray(node.config.allowedTools) ? allowed ?? [] : [];
      const tools: unknown[] = isAgent ? selectedTools : [node.config.tool];
      const editions = new Map<string, Set<string>>();
      for (const k of connections ?? []) {
        const asset = connectorIds.get(k);
        if (!asset) continue;
        const keys = editions.get(asset) ?? new Set<string>();
        keys.add(k);
        editions.set(asset, keys);
      }
      for (const k of connections ?? []) {
        const asset = connectorIds.get(k);
        const callsTool = tools.some(t => typeof t === 'string' && (!allowed || allowed.includes(t)) &&
          (asset ? t.startsWith('mcp.' + asset + '.') : localConnections.includes(k) && t.startsWith('mcp.')));
        if (callsTool) record(k, isAgent ? '이 연결의 도구를 선택하면' : undefined, asset ? editions.get(asset)!.size > 1 : false);
      }
      for (const src of data.get(node.id) ?? []) {
        if (src.type === 'resource.context') record(src.config.exportResource);
      }
      const scope = {documents, connections, allowed, callers:inherited.callers, sharedCaller:inherited.sharedCaller, agent:childAgentContext(inherited.agent, node, skills)};
      children.set(node.id, scope);
      if (node.type === 'agent.task') for (const src of linked.filter(src => src.type === 'workflow.tool')) {
        const scopes = callers.get(src.id) ?? [];
        scopes.push({name:step,scope});
        callers.set(src.id, scopes);
      }
    }
    for (const node of current.nodes) {
      let scope = children.get(node.id)!;
      // A callable Workflow runs with the materials of the agent that chose it.
      const sites = callers.get(node.id);
      const edition=node.config.exportSharedEdition, definition=definitions.get(edition);
      if(definition) {
        const call=[...path,names.get(node.id)!].join(' › ');
        for(const site of sites?.length?sites:[{name:call,scope}]) {
          const caller=[site.scope.sharedCaller,site.name].filter(Boolean).join(' → ');
          const signature=JSON.stringify([edition, site.scope.documents,site.scope.connections,site.scope.allowed,site.scope.agent,
            [...(site.scope.callers??[])],caller]);
          if(visited.has(signature))continue;
          visited.add(signature);
          visit(definition.graph,definition.titles,definition.stepPath,{...site.scope,sharedCaller:caller});
        }
        continue;
      }
      if (!node.graph) continue;
      if (sites?.length) {
        const documents = unique(sites.flatMap(site => site.scope.documents));
        const connections = sites.some(site=>site.scope.connections) ? unique(sites.flatMap(site=>site.scope.connections ?? [])) : undefined;
        const allowed = sites.every(site=>site.scope.allowed) ? unique(sites.flatMap(site=>site.scope.allowed!)) : undefined;
        const restrictions = new Map(inherited.callers);
        for (const key of [...documents, ...(connections ?? [])]) {
          const using = sites.filter(({scope})=>scope.documents.includes(key) || scope.connections?.includes(key));
          if (using.length < sites.length) restrictions.set(key, using.map(site=>'‘'+site.name+'’').join(' 또는 '));
        }
        scope = {agent:inherited.agent, documents, connections, allowed, callers:restrictions,sharedCaller:inherited.sharedCaller};
      }
      visit(node.graph, [...path, names.get(node.id)!], paths.get(node.id)!, scope);
    }
  }
  visit(graph, [], [], {documents:[], agent:emptyAgentContext});
  return {consumers, scripts};
}

export function resourcePreparation(graph: Graph, resources: (ExportResource & {mcp?: ExportMcp})[]): ExportPreparation[] {
  const {consumers, scripts} = resourceUses(graph);
  const rows: ExportPreparation[] = [];
  for (const resource of resources) {
    const {key, kind, available} = resource;
    const steps = [...(consumers.get(key)?.values() ?? [])];
    if (!steps.length) continue;
    const label = '‘' + resource.name + '’' + (resource.version ? ' ' + resource.version + '판' : '');
    function add(action: string, reason: string, selected?: boolean, unlessSelected?:string) {
      for (const {step,stepPath,condition,chooseEdition} of steps) {
        const edition = selected ? label : 'ZIP에 포함되지 않은 판';
        const apply = [condition, chooseEdition && '이번 호출에 ' + edition + '을 선택했을 때'].filter(Boolean).join(' · ');
        const instruction = chooseEdition && selected && action.startsWith(label) ? action.slice(label.length).trimStart() : action;
        rows.push({step, stepPath, action:apply ? apply + ', ' + instruction : instruction, reason,
          ...(selected === undefined ? {} : {when:{key, selected, ...(unlessSelected?{unlessSelected}:{})}})});
      }
    }
    if (kind === 'mcp') {
      const mode = resource.mcpMode ?? (resource.mcp && (resource.mcp.url ? 'remote' : 'manual'));
      const missingEdition=steps.some(s=>s.condition?.includes('호출 경로'))?' '+resource.version+'판':'';
      add('이 단계에서 사용할 MCP 서버'+missingEdition+'를 작업 환경에 연결하세요.', available
        ? '현재 ZIP 선택에서 이 단계의 MCP 연결 설정이 빠져 있습니다.' : '이 설계에서 사용할 수 있는 MCP 연결을 확인할 수 없습니다.', available ? false : undefined);
      if (available && mode === 'manual') add(label + ' MCP 서버의 주소나 시작 명령을 준비해 직접 연결하세요.',
        '이 연결은 받는 사람의 환경에 맞춰 등록해야 합니다.', true);
      if (available && (resource.requiresAuth || resource.mcp?.tokenEnv)) add(label + ' MCP 서버용 인증 정보를 작업 환경에 설정하세요.',
        '이 서버는 인증을 요구합니다. ZIP에는 인증에 사용할 환경 변수 이름이 들어갑니다.', true);
      continue;
    }
    if (resource.unavailableReason === 'recursive-workflow') {
      add('호출 대상을 바꾸거나 반복 처리 블록을 사용하세요.', '이 단계가 자신이나 상위 Workflow를 다시 호출해 하위 설계를 펼칠 수 없습니다.');
      continue;
    }
    if (resource.unavailableReason === 'workflow-limit') {
      add(label + '의 하위 설계를 별도로 준비한 뒤 이 호출을 이어가세요.',
        '이 호출에서 내보낼 수 있는 깊이 또는 전체 블록 수를 넘어서 해당 하위 설계의 지침이 ZIP에 없습니다.');
      continue;
    }
    if(resource.unavailableReason==='unpublished'||resource.unavailableReason==='unindexed'){
      const action=resource.unavailableReason==='unpublished'?'발행':'색인';
      add('이 단계에 도달하기 전에 '+label+' 자료집을 '+action+'하세요.',
        '현재 실행 경로에서 이 단계에 필요한 '+action+' 상태를 확인할 수 없습니다.');
      continue;
    }
    const item = {document:'자료 원문을', skill:'Skill 지침과 부속 파일을', knowledge:'자료판 원문을', workflow:'하위 Workflow 설계를'}[kind];
    add(label + '의 ' + item + ' 준비하세요.', available
      ? '현재 ZIP 선택에서 이 단계에 연결된 자료가 빠져 있습니다.' : '내보내기 시점에 이 단계에 연결된 자료판을 가져올 수 없습니다.', available ? false : undefined);
    if (available && scripts.has(key)) add(label + '의 필수 스크립트를 실행할 수 있는 환경을 준비하세요.',
      '이 Skill은 작업을 완료하려면 부속 스크립트를 실행해야 합니다.', true);
    for(const link of resource.linkedFiles??[]){
      const action=link.actualPath?'자료의 링크 ‘'+link.path+'’을 실제 파일명 ‘'+link.actualPath+'’과 일치시키세요.':
        label+'에서 참조한 상대 파일 ‘'+link.path+'’을 준비하세요.';
      add(action,'이 단계의 자료에서 해당 로컬 파일을 엽니다.',true,link.target);
    }
  }
  return rows;
}
