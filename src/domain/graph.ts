import { answerFormat, byType, canonicalErrorStrategy, changesKnowledgeRelease, portsFor } from './catalog';
import type { AgentScope, Block, Edge, EdgeKind, Graph, Issue, Port } from './types';

export const emptyGraph = (): Graph => ({nodes:[],edges:[]});
function uid(prefix: string) { return prefix + '-' + crypto.randomUUID(); }
export function createBlock(type: string, options: Partial<Block> = {}): Block {
  const definition = byType.get(type);
  const defaults = Object.fromEntries((definition?.fields ?? []).map(f=>[f.key,structuredClone(f.default ?? '')]));
  const node: Block = {
    id:options.id ?? uid('block'),type,title:options.title ?? definition?.name ?? type,
    x:options.x ?? 48,y:options.y ?? 64,config:{...defaults,...options.config},
  };
  if (options.graph) node.graph=structuredClone(options.graph);
  return node;
}

export type ConnectionOption = Pick<Edge,'kind'|'out'|'input'> & {label:string;automatic:boolean};
function compatible(a: Port,b: Port): boolean {
  return a.kind===b.kind && (a.valueType===b.valueType || a.valueType==='any' || b.valueType==='any');
}
export function connectionOptions(graph: Graph, fromId: string, toId: string, routeId?: string): ConnectionOption[] {
  const source=graph.nodes.find(n=>n.id===fromId), target=graph.nodes.find(n=>n.id===toId);
  if (!source || !target || source===target) return [];
  // Error handlers run on predecessor failure regardless of its successful output route.
  if (routeId !== undefined && target.type === 'error.handle') return [];
  const options: ConnectionOption[] = [];
  const { inputs } = portsFor(target);
  const outputs = portsFor(source).outputs.filter(p => routeId === undefined || p.kind !== 'flow' || p.id === routeId);
  for (const a of outputs) for (const b of inputs) {
    // The context port is retained to open and repair older direct document links.
    if (target.type==='quality.evidence' && b.id==='context') continue;
    if (!compatible(a,b) || graph.edges.some(e=>e.from===fromId && e.to===toId && e.out===a.id && e.input===b.id && e.kind===a.kind)) continue;
    const occupied=!b.multiple && graph.edges.some(e=>e.to===toId && e.input===b.id && e.kind===b.kind);
    options.push({kind:a.kind,out:a.id,input:b.id,label:a.label+' → '+b.label,automatic:!occupied});
  }
  // A named route must actually reach the target, even if a data mapping would be compatible on its own.
  if (routeId !== undefined && !options.some(option => option.kind === 'flow')) return [];
  for (const option of options) {
    // Line records are an explicit mapping. A new document connection still defaults to its body.
    if(source.type==='document.read'&&option.out==='lines'){option.automatic=false;continue;}
    const alternatives=options.filter(o=>o.kind===option.kind&&!(source.type==='document.read'&&o.out==='lines'));
    if (alternatives.length<2) continue;
    // Original-question inputs supplement the primary work item. Only one source output
    // may be inferred; a block with two possible outputs still needs an explicit choice.
    const primary=alternatives.filter(o=>o.input==='input');
    option.automatic=option.automatic && option.kind==='data' && primary.length===1 && primary[0]===option
      && alternatives.every(o=>o.out===option.out && (o.input==='input'||o.input==='question'));
  }
  if (referenceTypes.has(source.type) && options.some(o=>o.kind==='reference')) {
    for(const option of options) if(option.kind==='data') option.automatic=false;
  }
  return options;
}
export function connectBlocks(graph: Graph, fromId: string, toId: string,
  choices?: Pick<Edge,'kind'|'out'|'input'>[]): Edge[] {
  const options=connectionOptions(graph,fromId,toId);
  return options.filter(o=>choices ? choices.some(c=>c.kind===o.kind && c.out===o.out && c.input===o.input) : o.automatic)
    .map(o=>({id:uid('edge'),from:fromId,to:toId,kind:o.kind,out:o.out,input:o.input,label:o.label}));
}

const entryTypes=new Set(['input.user_request','control.trigger','file.input']);
const referenceTypes=new Set(['resource.context','instruction.skill','connection.mcp','workflow.tool']);
export function evidenceNeedsSearch(source: Block | undefined, directDocument: boolean, root: boolean): boolean {
  if (!source) return directDocument;
  if (source.type==='resource.context') return true;
  return (root || directDocument) && (source.type==='input.user_request' || source.type==='control.trigger');
}
const emptyValue=(v: unknown)=>v==null || (typeof v==='string'&&!v.trim()) || (Array.isArray(v)&&v.length===0);
const record=(v: unknown): v is Record<string,any>=>!!v && typeof v==='object' && !Array.isArray(v);

export const agentPurposeLimit = 12000;
export function isAgentScope(value: unknown): value is AgentScope {
  return record(value) && (value.mode === 'dedicated' || value.mode === 'general') &&
    typeof value.purpose === 'string' && value.purpose.length <= agentPurposeLimit;
}

export function validateGraph(graph: Graph): Issue[] {
  const issues: Issue[]=[];
  function visit(g: Graph,parents:string[],depth:number) {
    const add=(message:string, nodeId?:string, edgeId?:string, routeId?:string, fieldKey?:string)=>issues.push({
      message:(parents.length?parents.join(' › ')+' › ':'')+message,nodeId,edgeId,path:parents,...(routeId?{routeId}:{}),...(fieldKey?{fieldKey}:{}),
    });
    if (depth>12) {add('내부 설계가 너무 깊습니다.'); return;}
    if (!record(g)|| !Array.isArray(g.nodes)|| !Array.isArray(g.edges)) {add('블록·연결 목록이 필요한 설계입니다.');return;}
    if (g.agentScope !== undefined && !isAgentScope(g.agentScope)) add('Agent의 용도와 담당 업무 설정을 확인하세요.');
    else if (g.agentScope?.mode === 'dedicated' && !g.agentScope.purpose.trim()) add('전용 Agent의 담당 업무를 입력하세요.');
    if (g.nodes.length>512 || g.edges.length>5000) {add('설계의 블록 또는 연결 수가 처리 범위를 넘었습니다.');return;}
    const nodes=new Map<string,Block>(), outgoing=new Map<string,Edge[]>(), incoming=new Map<string,Edge[]>();
    let structurallyValid=true;
    for (const n of g.nodes) {
      if (!record(n)|| typeof n.id!=='string'|| !n.id||typeof n.type!=='string'||!record(n.config)) {add('읽을 수 없는 블록이 있습니다.');structurallyValid=false;continue;}
      if (nodes.has(n.id)) add('블록 식별자가 중복되었습니다.',n.id);
      nodes.set(n.id,n); outgoing.set(n.id,[]); incoming.set(n.id,[]);
      const def=byType.get(n.type);
      if (!def) {add(n.type==='tool.code_task'?'이전 코드·계산 블록을 지원되는 작업으로 교체하세요.':'지원하지 않는 블록입니다: '+n.type,n.id);continue;}
      if (typeof n.title!=='string'|| !n.title.trim()) add('블록 이름을 입력하세요.',n.id);
      if (!Number.isFinite(n.x)||!Number.isFinite(n.y)) add('블록 위치가 올바르지 않습니다.',n.id);
      for (const f of def.fields) {
        const raw=n.config[f.key];
        const v=n.type==='output.answer'&&f.key==='format'&&typeof raw==='string'?answerFormat(raw):
          n.type==='error.handle' && f.key==='strategy' && typeof raw==='string' ? canonicalErrorStrategy(raw) : raw;
        if (f.required && emptyValue(v)) {
          if(f.key==='tool'&&typeof n.config.suggestedTool==='string')add('도구 연결 필요 · '+n.config.suggestedTool,n.id,undefined,undefined,'tool');
          else add(f.label+'을(를) 설정하세요.',n.id);
          continue;
        }
        if (emptyValue(v)) continue;
        if (f.type==='number' && (!Number.isFinite(v)|| !Number.isInteger(v) || v<(f.min??-Infinity)||v>(f.max??Infinity))) add(f.label+'의 범위를 확인하세요.',n.id);
        if (f.type==='select' && !f.options?.some(o=>o.value===v)) add(f.label+'의 옵션을 다시 선택하세요.',n.id);
        const objectPlaceholder=f.key==='args'&&typeof v==='string'&&/^\{\{[^{}\r\n]+\}\}$/.test(v);
        if (f.type==='json' && !objectPlaceholder && (typeof v!=='object'|| v===null || (Array.isArray(f.default)!==Array.isArray(v)))) add(f.label+'의 자료 형식이 올바르지 않습니다.',n.id);
        if ((f.type==='text'||f.type==='textarea') && typeof v!=='string' && !(f.key==='version' && Number.isInteger(v) && v>0)) add(f.label+'에 글을 입력하세요.',n.id);
        if (f.type==='boolean' && typeof v!=='boolean') add(f.label+'에 참 또는 거짓을 지정하세요.',n.id);
      }
      if (['resource.context','instruction.skill'].includes(n.type) && !n.config.assetId && emptyValue(n.config.content)) add('참조할 자료판을 선택하거나 내용을 입력하세요.',n.id,undefined,undefined,'content');
      if (n.type==='connection.mcp'&&!n.config.assetId&&!n.config.server) add('연결할 MCP 서버를 선택하세요.',n.id);
      if (changesKnowledgeRelease(n) && emptyValue(n.config.storeKey)) add('발행·철회할 자료집 이름을 입력하세요.',n.id);
      if (n.type==='ai.classify' && Array.isArray(n.config.categories)) {
        const cats=n.config.categories;
        if (cats.some(v=>typeof v!=='string'||!v.trim()) || new Set(cats.map(v=>v.trim())).size!==cats.length) add('분류 이름은 비어 있지 않고 서로 달라야 합니다.',n.id);
      }
      if (n.type==='control.trigger' && n.config.trigger==='schedule' && !n.config.schedule) add('시작 일정을 지정하세요.',n.id);
      if (n.type==='control.trigger' && n.config.trigger==='event' && emptyValue(n.config.event)) add('시작 이벤트를 지정하세요.',n.id);
      if (n.type==='agent.team'&&!n.graph) add('팀을 열어 담당자와 결과 경로를 설정하세요.',n.id);
      if (n.type==='agent.create_dynamic' && n.config.resultRequirement==='evidence' && !n.graph)
        add('원문 근거 확인을 완료 조건으로 쓰려면 하위 설계를 연결하세요.',n.id,undefined,undefined,'resultRequirement');
      if (n.type==='control.loop'&&!n.graph) add('반복할 내부 Workflow를 설정하세요.',n.id);
      if (['workflow.call','workflow.tool'].includes(n.type)&&!n.graph&&!n.config.workflowId) add('실행할 Workflow를 연결하세요.',n.id);
      if (n.graph) visit(n.graph,[...parents,n.id],depth+1);
    }
    if (!structurallyValid) return;
    const edgeIds=new Set<string>(), signatures=new Set<string>();
    for (const e of g.edges) {
      if (!record(e)||typeof e.id!=='string'||!e.id) {add('읽을 수 없는 연결이 있습니다.');continue;}
      const a=nodes.get(e.from),b=nodes.get(e.to);
      if (edgeIds.has(e.id)) add('연결 식별자가 중복되었습니다.',e.to,e.id);
      edgeIds.add(e.id);
      if (!a||!b) {add('연결할 블록을 찾을 수 없습니다.',a?.id??b?.id,e.id);continue;}
      const out=portsFor(a).outputs.find(p=>p.kind===e.kind&&p.id===e.out);
      const input=portsFor(b).inputs.find(p=>p.kind===e.kind&&p.id===e.input);
      const legacyDocumentInput=a.type==='resource.context' && b.type==='quality.evidence' && e.kind==='data' && e.input==='input';
      if (!out||!input||(!compatible(out,input)&&!legacyDocumentInput)) {add('연결의 출발·도착 항목 또는 형식을 다시 선택하세요.',b.id,e.id);continue;}
      const signature=JSON.stringify([e.from,e.to,e.kind,e.out,e.input]);
      if (signatures.has(signature)) add('같은 전달 항목이 중복되었습니다.',b.id,e.id);
      signatures.add(signature);outgoing.get(a.id)!.push(e);incoming.get(b.id)!.push(e);
    }
    const starts=[...nodes.values()].filter(n=>entryTypes.has(n.type));
    if (!starts.length) add('사용자 입력, 파일 입력 또는 시작 조건을 추가하세요.');
    if (![...nodes.values()].some(n=>['output.answer','control.terminate'].includes(n.type))) add('결과를 반환하거나 실행을 끝낼 답변 전달 블록을 추가하세요.');
    const visited=new Set<string>();
    const pending=starts.map(n=>n.id);
    for(let i=0;i<pending.length;i++) {
      const id=pending[i];if(visited.has(id))continue;
      visited.add(id);
      for(const edge of outgoing.get(id)??[])if(edge.kind==='flow')pending.push(edge.to);
    }
    // Scheduling also waits for incoming values. A backwards data wire alone can deadlock
    // a flow with perfectly valid arrows, and must be reported during the design check.
    const checked=new Set<string>(),checking=new Set<string>();
    function dependencies(id:string) {
      if(checking.has(id)){add('순환 경로는 반복 처리 블록의 내부 Workflow로 구성하세요.',id);return;}
      if(checked.has(id))return;
      checking.add(id);
      for(const edge of outgoing.get(id)??[])if(edge.kind!=='reference')dependencies(edge.to);
      checking.delete(id);checked.add(id);
    }
    for(const id of nodes.keys())dependencies(id);
    for (const n of nodes.values()) {
      const def=byType.get(n.type);if (!def) continue;
      const ins=incoming.get(n.id)!,outs=outgoing.get(n.id)!;
      if(n.type==='agent.task'){
        const missing=Array.isArray(n.config.requiredTools)?n.config.requiredTools.filter(name=>!n.config.allowedTools?.includes(name)):[];
        if(missing.length)add('도구 연결 필요 · '+missing.join(', '),n.id,undefined,undefined,'allowedTools');
        const names=ins.filter(e=>e.kind==='reference'&&e.input==='workflow').map(e=>nodes.get(e.from)?.config.name);
        if(new Set(names).size!==names.length)add('호출 가능한 Workflow 도구 이름이 중복되었습니다.',n.id);
      }
      const missingSearch=n.type==='quality.evidence' && evidenceNeedsSearch(
        nodes.get(ins.find(e=>e.kind==='data' && e.input==='input')?.from??''),
        ins.some(e=>e.kind==='reference' && e.input==='context'), depth===0);
      if (missingSearch) add('질문과 원문을 자료 검색에 연결하고 검색된 구절을 근거 확인으로 보내세요.',n.id);
      if (!visited.has(n.id)&&!referenceTypes.has(n.type)) add('이 블록까지 실행 순서를 연결하세요.',n.id);
      for (const p of portsFor(n).inputs) {
        const count=ins.filter(e=>e.kind===p.kind&&e.input===p.id).length;
        if (p.required&&!count && !(missingSearch && p.id==='input')) add('‘'+n.title+'’의 '+p.label+'에 전달할 값을 연결하세요.',n.id);
        if (count>1&&!p.multiple) add('‘'+p.label+'’에 연결된 여러 값 중 하나를 선택하세요.',n.id);
      }
      const normalRoutes=new Set(outs.filter(e=>e.kind==='flow'&&nodes.get(e.to)?.type!=='error.handle').map(e=>e.out));
      const routes=portsFor(n).outputs.filter(p=>p.kind==='flow');
      if (!(n.type==='error.handle' && n.config.strategy==='stop')) for(const route of routes){
        if (!normalRoutes.has(route.id)) add(routes.length===1?'다음 작업 또는 종료 경로를 연결하세요.':'‘'+route.label+'’ 경로의 다음 블록을 연결하세요.',n.id,undefined,route.id);
      }
    }
  }
  visit(graph,[],0);
  return issues;
}

/** Old design-only files used individual wires without port IDs and stored B positions separately. */
export function migrateGraph(raw: unknown): Graph {
  if (!record(raw)||!Array.isArray(raw.nodes)||!Array.isArray(raw.edges)) throw new Error('블록과 연결이 담긴 Workflow JSON을 선택하세요.');
  if (raw.agentScope !== undefined && !isAgentScope(raw.agentScope)) throw new Error('Agent의 용도와 담당 업무 설정을 확인하세요.');
  const old=raw.nodes.some((n: unknown)=>record(n)&&(!record(n.config)||n.kind!==undefined));
  const legacySlots:Record<string,[number,number]>={input:[0,0],agent:[206,144],output:[402,310],resource:[5,285]};
  const usedKinds=new Set<string>();let extras=0;
  const nodes: Block[]=raw.nodes.map((n: unknown,i:number)=>{
    if (!record(n)||typeof n.type!=='string'||typeof n.id!=='string') throw new Error('블록의 유형과 식별자가 필요합니다.');
    const position=raw.layout?.b?.[n.id]??{};
    let xy=[40+(i%3)*248,52+Math.floor(i/3)*150];
    if(old){
      const slot=legacySlots[n.kind];
      if(slot && !usedKinds.has(n.kind)) xy=slot;
      else {xy=[extras%3*202,475+Math.floor(extras/3)*140];extras++;}
      usedKinds.add(n.kind);
    }
    const legacy={...n};for(const k of ['id','type','title','kind','graph','x','y','config']) delete legacy[k];
    return createBlock(n.type,{id:n.id,title:n.title??byType.get(n.type)?.name??n.type,
      x:Number.isFinite(position.x)?position.x:Number.isFinite(n.x)?n.x:xy[0],
      y:Number.isFinite(position.y)?position.y:Number.isFinite(n.y)?n.y:xy[1],
      config:{...legacy,...(n.config??{})},graph:n.graph?migrateGraph(n.graph):undefined});
  });
  const g:Graph={nodes,edges:[]};
  if (raw.agentScope) g.agentScope = {...raw.agentScope};
  for (const [i,e] of raw.edges.entries()) {
    if (!record(e)||typeof e.from!=='string'||typeof e.to!=='string'|| !['flow','data','reference'].includes(e.kind)) throw new Error('연결 데이터가 올바르지 않습니다.');
    const options=connectionOptions(g,e.from,e.to).filter(o=>o.kind===e.kind);
    const unambiguous=options.length===1?options[0]:undefined;
    const a=nodes.find(n=>n.id===e.from), b=nodes.find(n=>n.id===e.to);
    // The old library exercise had exactly one implicit question carried by its flow wire.
    const oldQuestion=old&&a?.type==='input.user_request'&&['agent.task','ai.single_task'].includes(b?.type??'');
    const out=e.out??unambiguous?.out??'', input=e.input??unambiguous?.input??'';
    g.edges.push({id:e.id??'old-'+i,from:e.from,to:e.to,kind:e.kind as EdgeKind,out,input,...(typeof e.label==='string'?{label:e.label}:{})});
    if (oldQuestion && e.kind==='flow' && !raw.edges.some(x=>record(x)&&x.from===e.from&&x.to===e.to&&x.kind==='data')) {
      g.edges.push({id:(e.id??'old-'+i)+'-value',from:e.from,to:e.to,kind:'data',out:'value',input:'input',label:'사용자의 질문'});
    }
    if (old&&e.kind==='data' && a?.type!=='resource.context' && b?.type==='output.answer' &&
      !raw.edges.some(x=>record(x)&&x.from===e.from&&x.to===e.to&&x.kind==='flow')) {
      g.edges.push({id:(e.id??'old-'+i)+'-order',from:e.from,to:e.to,kind:'flow',out:'next',input:'in'});
    }
  }
  return g;
}
