import {strToU8, zipSync} from 'fflate';
import {childAgentContext, childScopeInstructions, emptyAgentContext, isDelegatedRole, skillsForAgent, type AgentContext} from '../domain/agent-context';
import type {ExportPackage} from '../domain/agent-export';
import {byType, changesKnowledgeRelease, portsFor} from '../domain/catalog';
import {nodeMcpScope, type McpPin} from '../domain/mcp-scope';
import type {Block, Graph} from '../domain/types';
import {mcpConfigFiles} from './agent-mcp-export';
import {prepareAgentSkills} from './agent-skill-export';
import {instructionFiles, type Stage} from './agent-instruction-layout';
import {assignedRole, roleDocuments} from './agent-delegation';
import {roleRegistrationFiles, type ExportRole} from './agent-role-files';
import {parallelInstructions} from './agent-parallel-instructions';

type Resource = ExportPackage['resources'][number];
const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();

function materialInstruction(resource: Resource, allowedMcpTools?: string[]) {
  if (resource.kind === 'mcp') {
    if (!resource.included || !resource.mcp) return '선택하지 않은 MCP 연결이 필요합니다. 이 작업에 도달하면 사용자에게 연결을 요청하세요.';
    const {id, url} = resource.mcp;
    const tools = allowedMcpTools ?? resource.mcp.tools;
    const action = url ? '연결된 서버에서 도구를 사용하세요.' : '이 서버를 작업 환경에 직접 연결한 뒤 도구를 사용하세요.';
    const server = 'MCP ' + id + ' (' + oneLine(resource.name) + ') — ';
    if (allowedMcpTools && !tools.length) return server + '이 작업에 허용된 MCP 도구가 없습니다.';
    return server + action + (tools.length ? ' 사용 가능한 도구: ' + tools.join(', ') : '');
  }
  const file = resource.files[0];
  if (!resource.included) return oneLine(resource.name) + ' — 필요할 때 사용자에게 ' + (file || '자료 원문') + '을 요청하세요.';
  if (resource.kind === 'skill') return 'Skill 지침을 읽고 적용하세요 — ' + file;
  return '참고할 자료를 읽으세요 — ' + file + ' (' + oneLine(resource.name) + ')';
}

// These result fields can be addressed by name by a later branch or transform.
const blockInstructions: Record<string, string> = {
  'agent.create_dynamic': '대상이 남은 생성 한도를 넘으면 사용자에게 처리할 대상을 선택받으세요. 각 대상별로 target(대상), role(역할), result(하위 결과)를 보관하고, 근거 확인 상태는 status, 미완료 사유는 error에 담으세요. 결과는 results 목록과 이번에 선택하지 않은 대상의 excluded 목록으로 반환하세요.',
  'quality.evaluate': '원래 입력을 input에 보존하고 평가 점수 score(0~100), 평가 이유 reason, 통과 점수 이상인지 나타내는 참·거짓 passed를 반환하세요.',
  'quality.evidence': '실제 원문의 인용과 위치를 확인하세요. 결과에는 status(verified, insufficient, conflicting), 확인한 구절 목록 passages, 판단 이유 reason을 담고 status에 해당하는 경로를 따르세요.',
  'knowledge.search': '찾은 구절을 목록으로 전달하세요. 각 항목에 원문 식별자 id, 제목 title, 자료판 version, 위치 location, 실제 인용문 quote를 담으세요.',
  'approval.action': '도구 이름, 대상 및 실제 인자를 보여 주고 회신을 기다리세요. 승인 또는 거절 경로로 approved와 args를 전달하세요. 승인은 확인한 연결·도구·인자가 모두 일치하는 한 번의 실행에만 적용하세요.',
  'input.form': '질문을 보여 주고 회신을 기다리세요. 입력 항목이 지정되면 각 항목의 이름을 키로 갖는 응답 객체를 다음 단계에 전달하세요.',
  'control.wait': '회신이 도착하면 회신 내용을 다음 단계의 값으로 전달하세요.',
  'review.human': '검토할 초안을 보여 주고 사용자가 남긴 검토 의견을 다음 단계의 값으로 전달하세요.',
  'workflow.tool': '이 내부 Workflow는 연결된 Agent가 도구로 선택했을 때만 실행하세요. 호출 인자를 시작 입력으로 쓰고 호출자의 참고 자료와 도구 제한을 이어받으세요.',
  'control.loop': '입력 항목 하나씩 내부 Workflow에 전달하고 각 종료값을 입력 순서대로 모아 목록을 반환하세요.',
  'agent.handoff': '이 역할에 응답 책임을 넘기세요. 인계한 경로에서는 이후 작업과 최종 응답에도 새 담당자를 유지하세요.',
};

interface InstructionScope {
  agent: AgentContext;
  documents: string[];
  tools?: string[];
  pins?: McpPin[];
  mcpKeys?: string[];
}

function agentInstructions({title, graph, resources}: ExportPackage) {
  const byKey = new Map(resources.map(resource => [resource.key, resource]));
  const pins = new Map<string, Resource>();
  const common = [
    '# ' + oneLine(title), '',
    '사용자가 작업을 요청하면 시작 블록에 입력을 전달하세요. 실행 경로의 조건을 따라 다음 단계를 선택하고, 값 전달 연결에 지정된 결과를 다음 블록의 입력으로 사용하세요.',
    '실행한 경로의 값만 사용하세요. 입력값 연결이 없으면 현재 Workflow의 시작 입력을 사용하세요. 검색어·질문·도구 인자에 있는 {{input}}, {{question}}, {{필드.경로}}를 현재 입력값, 원래 질문, 해당 필드값으로 채우세요. 인자 전체가 자리표시자이면 값의 원래 자료형을 유지하세요.',
    '각 단계에 지정된 Skill과 자료는 이 폴더를 기준으로 해당 파일을 열어 읽으세요. 승인·검토 단계에서는 작업 대상과 초안을 보여 주고 사용자가 대화에서 직접 회신할 때까지 멈추세요.',
    '도구로 외부 상태를 바꾸거나 이전 작업을 되돌리기 전에는 사용할 연결·도구·실제 인자를 보여 주고 명시적 승인을 받으세요. 승인한 대상이나 인자가 달라지면 다시 확인하세요.',
    '필요한 자료나 도구에 접근할 수 없으면 해당 단계를 알리고 연결을 요청하세요. 파일 만들기 단계에서는 지정된 형식과 이름으로 결과를 저장하고, 종료 단계에서 답변이나 결과 파일 경로를 전달하세요.',
  ];
  const stages: Stage[] = [];
  const roles = new Map<string,ExportRole>();
  let ordinal = 0;

  function visit(current: Graph, path: string[], idPath: string[], inherited: InstructionScope, parent?: Stage) {
    const nodes = new Map(current.nodes.map(node => [node.id, node]));
    const local = new Map<string, Stage>();
    const references = new Map<string, Block[]>();
    const parallel = parallelInstructions(current);
    for (const node of current.nodes) {
      const material = byKey.get(node.config.exportResource);
      if (material?.kind === 'mcp' && node.config.assetId) pins.set(node.config.assetId + ':' + node.config.version, material);
      if (node.type === 'connection.mcp' && !material?.included) continue;
      const title = [...path, oneLine(node.title) || node.id].join(' / ');
      const file = 'step-' + String(++ordinal).padStart(3, '0') + '.md';
      const stage: Stage = {node, title, file, body:[], outgoing:[], incoming:[], children:[], parent};
      local.set(node.id, stage);
      parent?.children.push(stage);
    }
    for (const edge of current.edges) {
      const from = local.get(edge.from), to = local.get(edge.to);
      if (from && to) {
        const output = portsFor(from.node).outputs.find(port => port.id === edge.out && port.kind === edge.kind)?.label ?? edge.out;
        const input = portsFor(to.node).inputs.find(port => port.id === edge.input && port.kind === edge.kind)?.label ?? edge.input;
        const label = typeof edge.label === 'string' ? oneLine(edge.label) : '';
        const link = {edge, from, to, output, input, note:label === output + ' → ' + input ? '' : label};
        from.outgoing.push(link);
        to.incoming.push(link);
      }
      const source = nodes.get(edge.from);
      if (edge.kind === 'reference' && source) {
        const linked = references.get(edge.to) ?? [];
        linked.push(source);
        references.set(edge.to, linked);
      }
    }
    for (const node of current.nodes) {
      const config = node.config;
      const stage = local.get(node.id);
      if (!stage) continue;
      stages.push(stage);
      const lines = stage.body;
      const delegated = isDelegatedRole(node.type) && typeof config.role === 'string' && config.role.trim().length > 0;
      const roleLines: string[] = [];
      const work = delegated ? roleLines : lines;
      const definition = byType.get(node.type);
      lines.push((definition?.name ?? node.type) + ' · ' + node.id);
      if (definition) lines.push('', definition.description);
      if (blockInstructions[node.type]) lines.push('', blockInstructions[node.type]);
      work.push(...childScopeInstructions(node.graph));
      for (const paragraph of parallel.get(node.id) ?? []) lines.push('', paragraph);
      if (node.type === 'quality.evidence' && config.includeSourceLines === true) {
        lines.push('', '인용한 원문 행 전체를 중복 없이 sourceLines 목록에도 담으세요.');
      }
      if (changesKnowledgeRelease(node)) {
        lines.push('', '발행·철회하기 전에 자료집 이름, 버전, 해당 판의 내용을 제시하고 사용자 승인을 기다리세요. 거절하면 변경을 중단하세요.');
      }
      if (node.graph && !delegated) {
        lines.push('', '이 블록의 하위 설계에 입력값과 연결된 참고 자료를 전달하세요. 하위 작업은 상위 팀 목표, 배정된 역할·업무, 도구 제한을 이어받고 종료값을 호출한 단계에 돌려주세요.');
      }
      const linked = references.get(node.id) ?? [];
      const localSkills = linked.filter(source => source.type === 'instruction.skill').map(source => ({
        key: 'block:' + source.id, title: source.config.exportResource, version: String(source.config.version || '1'),
      }));
      const skills = skillsForAgent(node, inherited.agent, localSkills);
      const documents = [...new Set([...inherited.documents,
        ...linked.filter(source => source.type === 'resource.context').map(source => source.config.exportResource as string)])];
      const scope = nodeMcpScope(current, node.id, inherited.pins);
      const tools = Array.isArray(config.allowedTools)
        ? config.allowedTools.filter((tool: string) => !inherited.tools || inherited.tools.includes(tool)) : inherited.tools;
      const localMcps = linked.filter(source => source.type === 'connection.mcp').map(source => source.config.exportResource as string);
      const mcpKeys = localMcps.length ? localMcps.filter(key => !inherited.mcpKeys || inherited.mcpKeys.includes(key)) : inherited.mcpKeys;
      const materialKeys = new Set([
        ...documents, config.exportResource, config.exportCollection, config.exportDraft, config.exportIndex, config.exportPublished,
        ...linked.filter(source => source.type !== 'connection.mcp').map(source => source.config.exportResource),
        ...(mcpKeys ?? []), ...skills.map(skill => skill.title),
      ].flat());
      if (delegated) {
        const role = assignedRole(roles, idPath, stage, [...materialKeys].filter(k => byKey.has(k)), tools);
        stage.assignment = {role, key:stage.file.slice(0,-3), instructions:roleLines};
        for (const goal of inherited.agent.goals) work.push('- 팀 목표 — ' + goal);
        for (const assignment of inherited.agent.assignments) work.push('- 상위 담당자가 맡긴 일 — ' + assignment);
      }
      for (const key of materialKeys) {
        const material = byKey.get(key);
        if (!material) continue;
        const pin = material.mcp && scope?.find(p => pins.get(p.assetId + ':' + p.version)?.key === key);
        const allowedMcpTools = material.mcp && delegated && tools ? material.mcp.tools.filter(tool =>
          tools.includes(tool) || (pin && tools.includes('mcp.' + pin.assetId + '.' + tool))) : undefined;
        work.push('', '- ' + materialInstruction(material, allowedMcpTools));
      }
      function toolName(name: unknown) {
        if (typeof name !== 'string' || !name.startsWith('mcp.')) return name;
        for (const pin of scope ?? []) {
          const prefix = 'mcp.' + pin.assetId + '.';
          const resource = pins.get(pin.assetId + ':' + pin.version);
          if (name.startsWith(prefix) && resource?.included && resource.mcp?.tools.includes(name.slice(prefix.length))) {
            return resource.mcp.id + ' / ' + name.slice(prefix.length);
          }
        }
        return '연결이 필요한 MCP 도구';
      }
      for (const field of definition?.fields ?? []) {
        if (['assetId','workflowId','content','server','allowedTools'].includes(field.key)) continue;
        const value = field.key === 'tool' ? toolName(config.tool) : config[field.key];
        if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
        const option = field.options?.find(item => item.value === value)?.label;
        const content = option ?? (typeof value === 'object' ? JSON.stringify(value) : String(value));
        const destination = ['role','goal','task','instruction','criterion'].includes(field.key) ? work : lines;
        destination.push('', '- ' + field.label + ' — ' + content.replace(/\n/g, '\n  '));
      }
      if (['ai.single_task','agent.task','agent.delegate','agent.handoff','agent.create_dynamic'].includes(node.type)) {
        for (const [field, caption] of [['role','역할'],['goal','목표'],['task','작업 내용'],['instruction','작업 지시'],['criterion','완료 기준']]) {
          if (config[field] && !definition?.fields.some(item => item.key === field)) {
            work.push('', '- ' + caption + ' — ' + String(config[field]).replace(/\n/g, '\n  '));
          }
        }
      }
      if (tools) work.push('', '- 허용할 도구 — ' + (tools.map(toolName).join(', ') || '없음'));
      if (node.type === 'agent.task' && linked.some(source => source.type === 'workflow.tool')) {
        lines.push('', '- 호출 가능한 Workflow — ' + linked.filter(source => source.type === 'workflow.tool')
          .map(source => 'workflow.' + String(source.config.name || source.id)).join(', '));
      }
      if (node.graph) visit(node.graph, [...path, oneLine(node.title) || node.id], [...idPath, node.id],
        {agent:childAgentContext(inherited.agent, node, skills), documents, tools, pins:scope, mcpKeys}, stage);
    }
  }
  visit(graph, [], [], {agent:emptyAgentContext, documents:[]});
  const lines: string[] = [];
  const listed = resources.filter(resource => resource.kind !== 'mcp' || resource.included);
  if (listed.length) lines.push('', '## 연결 자료');
  for (const resource of listed) {
    lines.push('', '### ' + oneLine(resource.name), '', '- 사용 단계 — ' + resource.steps.join(', '));
    if (resource.version) lines.push('- 자료 버전 — ' + resource.version);
    lines.push('- ' + materialInstruction(resource));
  }
  if (roles.size) common.push(
    '위임 단계에 도달하면 현재 클라이언트의 하위 Agent 호출 기능으로 단계에 지정된 등록 이름과 작업 번호를 사용하세요. 역할에 원래 질문, 해당 입력값, 자료 경로와 결과 반환 위치를 전달하고 호출 ID를 단계·대상별로 기록하세요.',
    '담당자는 결과나 실패 사유를 반환합니다. 대표는 호출 식별자로 응답을 원래 단계에 대응시키고, 결과값을 설계에 지정된 다음 입력으로 전달하세요. 하위 Agent가 직접 재위임할 수 없으면 대표가 지정된 역할을 대신 호출해 원래 담당자에게 결과를 전달하세요. 사용자 승인은 대표가 받아 회신하세요. 현재 환경에서 역할을 호출할 수 없으면 그 사실을 알리고 해당 단계에서 멈추세요.');
  const files = instructionFiles(common, graph.agentScope, stages, lines);
  const split = Object.hasOwn(files, 'workflow/index.md');
  return {files:{...files, ...roleDocuments(stages, split), ...roleRegistrationFiles([...roles.values()])}, split, roles:[...roles.values()]};
}

function readme(pkg: ExportPackage, split: boolean, roles: ExportRole[]) {
  const lines = [
    '# ' + oneLine(pkg.title) + ' 사용법', '',
    '1. ZIP 전체를 새 폴더에 푸세요.',
    '2. Codex, Claude Code 또는 OpenCode에서 AGENTS.md가 있는 폴더를 작업 폴더로 열고 새 대화를 시작하세요.',
    '3. “이 Workflow로 다음 내용을 처리해 줘”라고 요청하고 작업할 내용을 입력하거나 파일을 첨부하세요.',
    '', '각 도구의 기존 로그인과 모델 설정을 사용합니다. CLAUDE.md도 AGENTS.md를 참조합니다. 검토 요청이 나오면 대화에서 승인 또는 수정 의견을 보내세요.',
    split ? 'AGENTS.md에서 시작 단계를 찾아 여세요. 상세 지침은 workflow/ 안에 있으며 현재 단계에 연결된 파일을 따라 읽으면 됩니다.' :
      '단계·분기·승인 조건은 AGENTS.md에서 확인할 수 있습니다.',
  ];
  if (roles.length) lines.push('', '## 위임 역할', '',
    '압축을 푼 폴더에서 프로젝트의 하위 Agent 기능을 사용할 수 있는 세션을 시작하세요. 프로젝트를 신뢰할지 묻는 경우 폴더와 역할 파일을 확인하세요. 역할 원문은 agents/에 있습니다. Codex는 .codex/agents/, Claude Code는 .claude/agents/, OpenCode는 .opencode/agents/에서 같은 역할을 등록합니다.',
    '', ...roles.map(role => '- ' + oneLine(role.name) + ' · [역할 지침](' + role.path + ') · 호출 이름 `' + role.id + '`'));
  if (pkg.resources.some(resource => resource.kind === 'skill' && resource.included)) {
    lines.push('', '## Skill', '', '공통 Skill 원문과 부속 파일은 .agents/skills/ 안에 있습니다. Claude Code의 .claude/skills/ 항목도 같은 원문을 안내합니다.');
  }
  const connections = pkg.resources.filter(resource => resource.included && resource.mcp);
  if (connections.length) {
    lines.push('', '## MCP 연결');
    lines.push('', '프로젝트의 MCP 설정 경로는 Codex의 `.codex/config.toml`, Claude Code의 `.mcp.json`, OpenCode의 `opencode.json`입니다. 폴더 신뢰 또는 서버 연결 승인을 요청하면 대상과 주소를 확인하세요.');
    if (connections.some(resource => !resource.mcp?.url)) lines.push('', '수동 연결 항목은 아래에 적힌 도구를 제공하는 서버의 주소나 시작 명령을 준비하세요. 사용할 클라이언트의 프로젝트 MCP 설정에 아래 식별자로 서버를 등록하고 새 대화에서 도구 목록을 확인하세요.');
    for (const resource of connections) {
      const mcp = resource.mcp!;
      lines.push('', '- ' + resource.name + ' (' + mcp.id + ') — ' + (mcp.url ? '프로젝트 설정에 등록됨' : '사용할 서버를 이 도구에서 직접 연결하세요.') + ' · 사용 단계 — ' + resource.steps.join(', '));
      if (mcp.tokenEnv) lines.push('  인증에는 실행 환경에 설정한 ' + mcp.tokenEnv + ' 변수를 사용합니다.');
      if (mcp.tools.length) lines.push('  사용 가능한 도구 — ' + mcp.tools.join(', '));
    }
  }
  return lines.join('\n') + '\n';
}

export function buildAgentZip(input: ExportPackage): Uint8Array<ArrayBuffer> {
  const pkg = prepareAgentSkills(input);
  const entries: Record<string, Uint8Array> = Object.create(null);
  const instructions = agentInstructions(pkg);
  for (const [path, body] of Object.entries(instructions.files)) entries[path] = strToU8(body);
  entries['CLAUDE.md'] = strToU8('@AGENTS.md\n');
  entries['README.md'] = strToU8(readme(pkg, instructions.split, instructions.roles));
  for (const [path, content] of Object.entries(mcpConfigFiles(pkg.resources))) entries[path] = strToU8(content);
  for (const file of pkg.files) {
    if (!/^(?:resources|\.(?:agents|claude)\/skills)\//.test(file.path) || Object.hasOwn(entries, file.path) ||
        file.path.split('/').some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part))) {
      throw Error('ZIP 안의 파일 경로를 확인하세요.');
    }
    entries[file.path] = Buffer.from(file.data, 'base64');
  }
  return Uint8Array.from(zipSync(entries, {level: 3}));
}
