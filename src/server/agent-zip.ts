import {strToU8, zipSync} from 'fflate';
import {childAgentContext, childScopeInstructions, emptyAgentContext, isDelegatedRole, modelBlocks, skillsForAgent, type AgentContext} from '../domain/agent-context';
import {activeExportPreparation, exportStepPaths, sharedEditionLabel, type ExportPackage, type ExportPreparation} from '../domain/agent-export';
import {designPreparation} from '../domain/export-design-preparation';
import {resourcePreparation} from '../domain/export-resource-preparation';
import {byType, canonicalSelectionConfig, changesKnowledgeRelease, portsFor, replyDeadlineDefaultMinutes, replyDeadlineMaxMinutes} from '../domain/catalog';
import {nodeMcpScope, toolPin, type McpPin} from '../domain/mcp-scope';
import type {Block, Graph} from '../domain/types';
import {integer} from '../engine/values';
import {mcpConfigFiles} from './agent-mcp-export';
import {prepareAgentSkills} from './agent-skill-export';
import {instructionFiles, type Stage} from './agent-instruction-layout';
import {assignedRole, roleDocuments} from './agent-delegation';
import {roleRegistrationFiles, type ExportRole} from './agent-role-files';
import {parallelInstructions} from './agent-parallel-instructions';
import {outputInstructions} from './agent-output-instructions';
import {budgetFieldValue, runBudgetInstruction, runBudgetReadme, stageBudgetInstruction} from './agent-budget-instructions';

type Resource = ExportPackage['resources'][number];
const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();

function materialInstruction(resource: Resource) {
  if (resource.kind === 'workflow' && !resource.available)
    return oneLine(resource.name) + ' — 이 호출에 도달하면 단계의 실행 준비 안내에 따라 하위 설계를 확인하세요.';
  if (resource.kind === 'mcp') {
    if (!resource.included || !resource.mcp) return '이 연결의 도구가 현재 작업에 필요할 때 사용자에게 연결을 요청하세요.';
    const {id, url, tools, readOnlyTools} = resource.mcp;
    const action = url ? '프로젝트에 등록된 서버입니다.' : '이 서버의 도구를 사용할 때 작업 환경에 직접 연결하세요.';
    const server = 'MCP ' + id + ' (' + oneLine(resource.name) + ') — ';
    return server + action + (tools.length ? ' 서버에 등록된 도구 — ' + tools.join(', ') : '') +
      (readOnlyTools ? ' · 읽기 전용 — '+(readOnlyTools.join(', ')||'없음')+' · 변경 도구는 실제 인자를 확인하고 승인을 받으세요.' : '')+
      (resource.requiresAuth?' · 이 서버는 인증이 필요합니다.':'');
  }
  const file = resource.files[0];
  if (!resource.included) return oneLine(resource.name) + ' — 필요할 때 사용자에게 ' + (file || '자료 원문') + '을 요청하세요.'+
    (resource.kind==='document'||resource.kind==='knowledge'?' 원문 식별자와 '+resource.version+'판을 함께 확인해 인용의 id와 version을 채우세요.':'');
  if (resource.kind === 'skill') return 'Skill 지침을 읽고 적용하세요 — ' + file;
  if (resource.source) {
    const identity = JSON.stringify({id:resource.source.id, version:resource.version});
    const location = resource.source.location;
    const material = '참고할 자료를 읽으세요 — ' + file + ' (' + oneLine(resource.name) + ') · 출처 ' + identity +
      (resource.source.assetId?' · 등록 자료 assetId='+JSON.stringify(resource.source.assetId):'');
    if (location) return material + ' · 발췌 위치 ' + oneLine(location) + '. 원문 대조에는 해당 판의 전체 문서를 사용하세요.';
    if (resource.source.candidateOnly) return material + ' · 자료판의 후보 문구입니다. 원문 대조에는 해당 판의 등록 원문이 필요합니다.';
    return material;
  }
  return '참고할 자료를 읽으세요 — ' + file + ' (' + oneLine(resource.name) + ')';
}

// These result fields can be addressed by name by a later branch or transform.
const blockInstructions: Record<string, string> = {
  'input.user_request': '최상위에서는 사용자가 적은 질문을 그대로 전달하세요. 실제 첨부와 함께 보낸 질문은 질문 부분만 전달하고, 빈 질문이면 빈 문자열을 유지하세요. 사용자가 직접 붙인 JSON은 입력 텍스트입니다. 하위 Workflow에서는 호출자가 전달한 값을 그대로 사용하세요.',
  'control.trigger': '선택된 최상위 시작점에서 해당 수동·예약·이벤트 입력을 그대로 전달하세요. 첨부가 있는 시작 입력에는 파일명·본문·질문이 함께 있을 수 있습니다. 하위 Workflow는 수동 입력으로 시작합니다. 매일 일정은 한국 표준시(UTC+09:00)이며 간격은 지정한 분, 단발 시각은 지정된 시간대를 따르세요.',
  'ai.classify': '선택한 범주의 실행 출구로 이동하고 후보에 없으면 미분류 출구로 가세요. 결과(value)는 원래 입력입니다. 선택한 범주(category) 데이터선에는 범주 이름을, 미분류이면 null을 전달하세요.',
  'data.transform': '선택 경로는 점으로 구분한 객체 필드나 배열 인덱스입니다. 이름 바꾸기는 지정한 이름 전체를 새 키로 사용합니다. 중첩 경로가 없으면 같은 이름의 점을 포함한 키를 확인하고, 선택할 필드가 없으면 실패 처리하세요.',
  'data.validate': '입력 객체와 배열의 필드·인덱스를 값 변환과 같은 경로로 확인하세요. 필수값은 null, 누락, 공백뿐인 문자열, 빈 배열이면 실패합니다. 0과 false는 값입니다. 숫자 문자열과 숫자는 서로 다른 형식입니다. 성공하면 검증한 값을 그대로 전달하세요.',
  'error.handle': '실패한 단계의 이름과 사유를 받으세요. 여러 실패가 모이면 각 단계의 사유를 모두 안내문에 넣으세요. 계속은 처리 결과를 전달하고 중단은 그 사유로 실패합니다.',
  'control.branch': '조건에 따라 예·아니요 실행 출구 하나를 선택하고, value 데이터선에는 원래 입력을 전달하세요. 값이 있음 조건에서 null, 빈 문자열, false, 숫자 0, 빈 목록은 거짓입니다. 문자열 "false"와 "0", 빈 객체는 참입니다.',
  'agent.select_candidate': '모델의 선택 목록에서 등록 후보만 응답 순서대로 남기세요. 첫 유효 후보의 이름을 문자열로 전달하세요. 유효 후보가 없으면 이 단계를 실패 처리하세요.',
  'agent.coordinate': '모델의 선택 목록에서 등록 후보만 남기고 중복은 첫 위치만 보존하세요. 최대 작업 수까지 응답 순서를 유지한 목록을 전달하세요. 유효 후보가 없으면 이 단계를 실패 처리하세요.',
  'agent.create_dynamic': '빈 항목과 중복 대상을 제거한 뒤 대상이 남은 생성 한도를 넘으면 사용자에게 처리할 대상을 선택받으세요. 각 대상별로 target(대상), role(역할), result(하위 결과)를 보관하고, 근거 확인 상태는 status, 미완료 사유는 error에 담으세요. 결과는 results 목록과 이번에 선택하지 않은 대상의 excluded 목록으로 반환하세요. 제외한 대상이 있으면 selection에 reason="creation_limit", requestedCount(중복 제거 후 전체 대상 수), selectedCount(선택한 수)를 담으세요.',
  'quality.evaluate': '원래 입력을 input에 보존하고 평가 점수 score(0~100), 실제 설정의 통과 기준 threshold, 평가 이유 reason, 점수가 그 기준 이상인지 나타내는 참·거짓 passed를 반환하세요. 점수는 숫자, 이유는 공백이 아닌 문자열이어야 합니다. 텍스트 답변과 JSON에 실제 점수·기준·판정·이유를 표시하세요.',
  'quality.evidence': '질문에 직접 답하는 인용이 후보 문구에 들어 있는지 확인하세요. 이번 호출에 연결된 자료에서 식별자·판·위치가 일치하는 원문 파일을 열어 그 위치의 문장과 대조하세요. 같은 제목의 다른 자료나 복사한 후보 문구만 있으면 원문 대조를 보류하세요. 결과에는 status, 확인 범위 verification, 채택한 구절 목록 passages, 판단 이유 reason을 담으세요.',
  'knowledge.search': '찾은 구절을 목록으로 전달하세요. 각 항목에 원문 식별자 id, 제목 title, 원문 판 version, 위치 location, 실제 인용문 quote를 담으세요. 등록 자료에만 assetId를 담고 자료집 색인에서 찾았으면 색인 판 indexVersion도 담으세요. 연결 자료에 표시된 출처의 id와 version을 복사하고 원문 파일의 첫 줄을 1행으로 셉니다. CRLF·LF·CR 모두 물리적 줄바꿈으로 세고 발췌 자료는 지정된 원래 위치를 유지하세요. 문구 일치와 관련도 검색 모두 같은 원문 식별자·판·위치·인용의 중복을 제거한 뒤 결과 수 상한을 적용하세요.',
  'knowledge.manage': '색인할 때 원문의 id, version과 등록 자료의 assetId를 보존하고 자료집의 판은 indexVersion에 기록하세요. 발행 승인은 이번에 색인한 스냅숏, 철회 승인은 현재 발행된 스냅숏의 내용과 식별값에 묶으세요. 이전에 발행한 같은 판을 다른 내용으로 바꿀 수 없습니다. 검색은 도달한 시점에 실제 발행 중인 판을 사용하세요.',
  'approval.action': '도구 이름, 대상 및 실제 인자를 보여 주고 회신을 기다리세요. 승인 또는 거절 경로로 approved, approvalId(이 실행과 승인 대상을 식별하는 값), args를 전달하세요. 후속 도구의 인자가 비어 있거나 승인과 같은 인자 식이면 이미 확인한 args를 사용하세요. 다른 식은 해당 단계에서 평가하고, 연결·도구·값이 달라지면 다시 승인받으세요. 승인 한 번은 한 호출에만 적용하세요.',
  'input.form': '질문을 보여 주고 회신을 기다리세요. 입력 항목이 지정되면 각 항목의 이름을 키로 갖는 응답 객체를 다음 단계에 전달하세요. 화면에 입력한 숫자도 문자열로 보존하고 필수 항목의 공백은 같은 회신에서 보완하세요.',
  'control.wait': '회신이 도착하면 회신 내용을 다음 단계의 값으로 전달하세요.',
  'file.input': '첫 질문 첨부 모드는 하위 Workflow에서도 최초 사용자가 첨부한 파일을 사용하세요. 새 파일 요청 모드는 이 단계에서 실제 첨부를 기다리세요. 시험 예시는 편집기용입니다. 실행 입력의 파일명과 허용 확장자를 대소문자 구분 없이 대조하세요.',
  'document.read': '파일 객체의 content를 읽으세요. 자동 형식은 fileName 확장자의 대소문자를 구분하지 않습니다. JSON은 해석한 값, CSV는 빈 셀·인용된 쉼표와 줄바꿈을 보존한 행별 셀 배열을 전달하세요. 원래 행 번호와 본문은 빈 줄을 포함해 첫 물리 행부터 1로 세고 CR, LF, CRLF를 구분하세요. 파싱이 실패하면 오류 경로를 따르세요.',
  'memory.access': '기억의 쓰기·읽기에서 문자열, 숫자, 참·거짓, null, 객체와 배열의 자료형을 그대로 유지하세요. 기존 텍스트 기억은 문자열로 읽고, 저장된 값이 없으면 빈 문자열을 반환하세요. 같은 이용자와 Workflow의 기억을 쓰고 시험 대화마다 별도로 보관하세요.',
  'review.human': '검토할 초안을 한 번 보여 주고 사용자가 남긴 검토 의견을 다음 단계의 값으로 전달하세요. 병렬 검토는 요청 번호별 회신을 해당 초안과 짝지으세요. 다른 경로가 실패해도 계속 진행하는 정책이면 이 검토의 회신을 기다리세요. 전체 중단이면 남은 검토 대기도 종료하세요.',
  'workflow.tool': '이 내부 Workflow는 연결된 Agent가 도구로 선택했을 때만 실행하세요. 호출 인자를 시작 입력으로 쓰고 호출자의 참고 자료와 도구 제한을 이어받으세요.',
  'control.loop': '목록은 각 항목, 단일 값은 한 항목으로 처리하세요. 입력 순서대로 한 항목씩 내부 Workflow에 전달하고 매번 반복 단계로 돌아오세요. 대기 중에는 현재 항목과 완료 결과를 보관하고, 모든 항목을 마치면 결과 목록으로 부모의 다음 경로를 한 번 진행하세요.',
  'agent.handoff': '이 경로의 후속 작업과 응답 책임을 지정한 역할에 넘기세요. 여러 경로가 합류하면 실제로 도착한 경로의 담당자가 같을 때 그 담당자가 계속합니다. 담당자가 다르면 현재 팀의 담당자 또는 이 Workflow를 시작한 담당자가 이어받습니다.',
  'context.compress': '보존할 항목을 입력과 대조해 요약에 남기세요. 파일 이름(fileName)과 원문 위치(location)를 보존 항목으로 지정하면 입력에 있는 해당 필드의 표기를 유지하세요. 길이는 한글 조합 자소처럼 함께 표시되는 문자 묶음을 한 글자로 셉니다. 요약이 비어 있거나 지정한 참조가 빠졌거나 길이 상한을 초과하면 실패 경로를 따르세요.',
};

interface InstructionScope {
  agent: AgentContext;
  documents: string[];
  tools?: string[];
  pins?: McpPin[];
  mcpKeys?: string[];
  fromCallable?: boolean;
}

// Use only positions in this export snapshot for public anchors. Node IDs and MCP names can be private.
const preparationAnchor = (path: string[]) => path.length ? 'prep-' + path.join('-') : 'prep-workflow';

function preparationSections(pkg: ExportPackage) {
  const items = pkg.preparation ?? [...designPreparation(pkg.graph), ...resourcePreparation(pkg.graph, pkg.resources)];
  const selected = pkg.resources.filter(resource => resource.included).map(resource => resource.key);
  const sections = new Map<string, ExportPreparation[]>();
  for (const item of activeExportPreparation(items, selected)) {
    const anchor = preparationAnchor(item.stepPath ?? []);
    const section = sections.get(anchor) ?? [];
    section.push(item);
    sections.set(anchor, section);
  }
  return sections;
}

function agentInstructions({title, graph, resources}: ExportPackage, preparation: Map<string, ExportPreparation[]>) {
  const byKey = new Map(resources.map(resource => [resource.key, resource]));
  const pins = new Map<string, Resource>();
  const common = [
    '# ' + oneLine(title), '',
    '사용자가 작업을 요청하면 시작 블록에 입력을 전달하세요. 실행 경로의 조건을 따라 다음 단계를 선택하고, 값 전달 연결에 지정된 결과를 다음 블록의 입력으로 사용하세요.',
    '실행한 경로의 값만 사용하세요. 입력값 연결이 없으면 현재 Workflow의 시작 입력을 사용하세요. 검색어·질문·도구 인자에 있는 {{input}}은 현재 단계의 입력값, {{question}}은 연결된 질문 또는 현재 Workflow 호출의 시작 질문, {{필드.경로}}는 해당 필드값으로 채우세요. 인자 전체가 자리표시자이면 값의 원래 자료형을 유지하세요.',
    '각 단계에 지정된 Skill과 자료는 이 폴더를 기준으로 해당 파일을 열어 읽으세요. 승인·검토 단계에서는 작업 대상과 초안을 보여 주고 사용자가 대화에서 직접 회신할 때까지 멈추세요.',
    '도구로 외부 상태를 바꾸거나 이전 작업을 되돌리기 전에는 사용할 연결·도구·실제 인자를 보여 주고 명시적 승인을 받으세요. 승인한 대상이나 인자가 달라지면 다시 확인하세요.',
    '변경 작업이 성공하면 호출 ID·도구 이름·확인된 처리 결과를 기록하세요. 이후 단계가 실패하거나 중단되어도 사용자에게 이미 처리된 작업과 처리 번호를 알리세요. 응답을 잃으면 같은 호출 ID로 상태를 확인하고, 확인 전까지 변경을 다시 보내지 마세요.',
    '현재 단계에 필요한 준비가 부족하면 작업을 시작하기 전에 단계 이름·필요한 조치·이유를 사용자에게 알려 회신을 기다리세요. 준비되면 대기한 단계부터 재개하세요. 준비할 수 없다고 확인되면 사유를 기록하고 설계의 오류 경로와 병렬 실패 정책을 따르세요.',
    '현재 Workflow의 활성 경로를 모두 마친 뒤 결과를 한 번 전달하세요. 정상 종료가 하나면 그 값, 여러 개면 설계의 블록 순서대로 모은 목록을 사용하세요. 일반 실패 경로가 있어도 대기 중인 다른 경로는 회신 후 처리하고, 전체 중지·병렬 전체 중단이면 남은 대기를 닫으세요. 최종 결과에 포함된 생성 파일은 실제 저장 경로로 안내하세요.',
    runBudgetInstruction,
  ];
  if (preparation.size) common.push(
    '선택한 실행 경로에서 준비 링크가 있는 단계에 도달하면 [README의 실행 준비](README.md#workflow-preparation) 중 그 단계의 항목만 확인하세요. 현재 입력·호출자·선택한 출구에 필요한 조건이 갖춰져 있으면 바로 진행하세요.');
  if (preparation.has('prep-workflow')) common.push(
    '작업을 시작하거나 결과를 반환할 경로를 정할 수 없으면 [Workflow 전체 준비](README.md#prep-workflow)를 확인하세요.');
  const stages: Stage[] = [];
  const exampleFiles = new Set<string>();
  const roles = new Map<string,ExportRole>();
  let ordinal = 0;

  // A shared definition can be visited before the caller that provides its selected connection.
  function indexConnections(current:Graph) {
    for (const node of current.nodes) {
      const material = byKey.get(node.config.exportResource);
      if (material?.kind === 'mcp' && node.config.assetId) pins.set(node.config.assetId + ':' + node.config.version, material);
      if (node.graph) indexConnections(node.graph);
    }
  }
  indexConnections(graph);

  function visit(current: Graph, path: string[], idPath: string[], inherited: InstructionScope, parent?: Stage) {
    const paths = exportStepPaths(current, parent?.stepPath);
    const nodes = new Map(current.nodes.map(node => [node.id, node]));
    const local = new Map<string, Stage>();
    const references = new Map<string, Block[]>();
    const parallel = parallelInstructions(current);
    for (const node of current.nodes) {
      const material = byKey.get(node.config.exportResource);
      if (node.type === 'connection.mcp' && !material?.included) continue;
      const title = [...path, oneLine(node.title) || node.id].join(' / ');
      const file = 'step-' + String(++ordinal).padStart(3, '0') + '.md';
      const stepPath = paths.get(node.id)!;
      const anchor = preparationAnchor(stepPath);
      const stage: Stage = {node, title, file, stepPath, preparationAnchor:preparation.has(anchor) ? anchor : undefined,
        body:[], outgoing:[], incoming:[], children:[], parent, edition:node.config.exportSharedEdition};
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
      const config = canonicalSelectionConfig(node.type,node.config);
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
      if (node.type === 'control.wait' || node.type === 'input.form') {
        const event = node.type === 'control.wait';
        const configured = event ? config.timeoutMinutes : config.replyTimeoutMinutes;
        if (event || configured > 0) {
          const minutes = integer(configured, replyDeadlineDefaultMinutes, 1, replyDeadlineMaxMinutes);
          lines.push('', '- ' + (event ? '대기 제한(분)' : '회신 기한(분)') + ' — ' + minutes,
            '처음 회신을 요청할 때부터 ' + minutes + '분 뒤의 마감 시각을 기록해 사용자에게 보여 주세요. 재개하거나 양식 항목을 보완해도 같은 회신 번호와 마감 시각을 유지하세요.',
            '마감 시각 전에 접수한 유효한 회신은 마감 후에 처리해도 유효합니다. 정확히 마감 시각부터 새 회신의 접수를 종료하세요. 그전에 접수한 유효한 회신이 없으면 ‘대기 기한이 지났습니다.’로 실패 처리하고 연결된 오류 경로를 따르세요.');
        } else lines.push('', '이 양식은 회신 기한 없이 같은 회신 번호에서 유효한 응답을 기다립니다.');
      }
      if (node.type === 'safety.redact') {
        lines.push('', '입력 전체의 문자열을 검사하세요. 객체의 모든 키와 값, 중첩 배열, 파일명과 첨부 본문도 포함합니다. 가릴 때 객체와 배열 구조, 다른 필드, 숫자와 빈값을 보존하세요. 가린 키가 겹치면 기존 키를 보존하고 뒤에 (2), (3)을 붙여 모든 항목을 남기세요.');
        lines.push('', config.operation === 'block'
          ? '지정한 검사 항목을 발견하면 입력의 전달을 중단하고 오류 경로를 따르세요. 발견한 원문이 이전 질문·답변이나 보존 항목에도 있으면 그 값은 [민감정보 차단]으로 대체하세요.'
          : '지정한 검사 항목에서 발견한 이메일은 [이메일 가림], 전화번호는 [전화번호 가림]으로 바꾸세요. 이전 질문·답변과 보존 항목에 같은 값이 있으면 같은 가림 표시를 사용하세요.');
        lines.push('다른 분기나 값 변환이 나중에 같은 원문을 보존해도 검사 결과를 우선하세요. 후속 모델과 하위 Agent에는 처리한 값만 전달하세요.');
      }
      if (node.type === 'data.transform' && config.operation === 'select' && config.path)
        lines.push('', '첨부에서 읽은 항목을 선택하면 선택한 값도 다음 문답에 남기세요. 이 값에 적용된 민감정보 차단·가림을 유지하세요.');
      if (['input.form','file.input'].includes(node.type) && config.historyFields)
        lines.push('', '다음 문답에는 지정한 항목을 남기세요. *는 전체를 선택합니다. 민감정보 검사 단계에서 발견한 값에는 차단·가림 결과를 우선하세요.');
      const budget = stageBudgetInstruction(node);
      if (budget) lines.push('', budget);
      if (budget && delegated && !node.graph) work.push('',budget);
      if (node.type === 'file.create') lines.push('', ...outputInstructions(config));
      if (node.type === 'agent.create_dynamic' && config.resultRequirement === 'evidence') {
        lines.push('', '각 담당 작업의 완료 조건은 하위 설계가 반환한 인용의 원문 대조입니다. 판 번호 또는 해당 판의 원문이 필요하면 그 대상의 완료를 보류하고 회신을 기다리세요. 판과 위치를 대조한 결과를 evidence에, 하위 설계의 반환값을 result에 담으세요. 위치가 다르면 근거 부족으로 처리하고 지정된 미완료 정책을 따르세요.');
        if (delegated) work.push('담당 작업을 마칠 때 반환하는 인용의 판 번호와 해당 위치의 원문을 확인하세요. 후보만 일치하면 대상·자료·인용 위치와 필요한 판 번호 또는 원문을 호출자에게 보내고 같은 작업에서 회신을 기다리세요.');
      }
      work.push(...childScopeInstructions(node.graph));
      for (const paragraph of parallel.get(node.id) ?? []) lines.push('', paragraph);
      if (node.type === 'quality.evidence') {
        lines.push('', '인용한 위치의 원문까지 확인하면 verification=original, 후보 문구만 확인하면 verification=candidate, 채택한 인용이 없으면 verification=none으로 기록하세요.');
        lines.push('', config.requireOriginal === true
          ? '원문 대조 필수 단계입니다. 채택할 인용이 없으면 바로 근거 부족 경로를 따르세요. 후보의 판 번호가 비어 있으면 이 단계에서 자료 식별자·위치·인용을 보여 주고 실제 판 번호 또는 판 이름을 확인할 때까지 기다리세요. 파일명이나 같은 제목에서 판을 추측하지 마세요. 확인한 판의 연결 원문이 없으면 해당 판의 전체 원문 파일을 요청하고 기다리세요. 받으면 같은 단계에서 대조하고 passages에 확인한 판을 기록하세요.'
          : '질문에 답하는 인용이 후보에만 일치하면 status=candidate_match로 반환하고 “후보 문구와 일치”로 표시해 ‘근거 있음’ 경로를 따르세요.');
        lines.push('', '대조한 원문에 해당 위치가 없거나 인용이 일치하지 않으면 status=insufficient로 ‘근거 부족’ 경로를 따르세요. 같은 인용의 다른 파일을 다시 요청하지 마세요.');
        lines.push('', '질문에 답하는 인용을 원문에서도 확인하면 status=verified와 “원문 대조 완료”로 ‘근거 있음’ 경로를 따르세요. 사용자가 해당 판의 전체 원문으로 첨부한 파일에서 대조했으면 originalSource=supplied로 표시하고 연결된 원문도 함께 사용했으면 mixed로 표시하세요. 서로 다른 위치의 인용들이 상충하면 status=conflicting과 ‘근거 상충’, 근거가 부족하면 status=insufficient와 ‘근거 부족’ 경로를 사용하세요.');
        if (config.includeSourceLines === true) lines.push('', '실제 원문에서 대조한 인용의 전체 행을 중복 없이 sourceLines 목록에도 담으세요. 후보 문구만 확인했으면 빈 목록을 반환하세요.');
      }
      if (changesKnowledgeRelease(node)) {
        lines.push('', '발행·철회하기 전에 자료집 이름, 버전, 해당 판의 내용을 제시하고 사용자 승인을 기다리세요. 거절하면 변경을 중단하세요.');
        if(config.exportPublication==='already-published')lines.push('내보낸 시점에 현재 색인은 이미 발행 중인 스냅숏입니다. 이 단계에 도달하면 실제 상태를 확인하고 같은 발행본의 중복 발행은 오류로 처리하세요.');
        if(config.exportPublication==='different-edition')lines.push('내보낸 시점에 현재 색인은 이 판에서 처음 발행한 스냅숏과 다릅니다. 같은 판에 변경 내용을 발행할 수 없으므로 새 판을 준비하세요.');
      }
      if (node.graph && !delegated && !stage.edition) {
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
      if (node.type==='agent.task')stage.sharedTools=linked.flatMap(source=>source.type==='workflow.tool'&&source.config.exportSharedEdition
        ? [{name:'workflow.'+(source.config.name||source.id),edition:source.config.exportSharedEdition}] : []);
      const callsWorkflowTool = node.type==='agent.task' && linked.some(source=>source.type==='workflow.tool');
      if (stage.edition || callsWorkflowTool) {
        lines.push('', '하위 저장판을 호출할 때마다 이 단계와 입력값, 참고 자료, 상위 팀·배정에서 물려받은 Skill, 허용된 MCP 판과 도구, 복귀 위치를 함께 기록하세요. 목표형 AI 작업에 직접 연결한 Skill은 그 작업의 판단에만 적용하세요.');
        if (callsWorkflowTool) lines.push('Workflow 도구를 선택하면 이번 호출 인자와 이 담당자의 범위를 전달하세요. 결과를 받아 현재 담당자의 다음 판단을 이어가세요.');
        else if (node.type === 'workflow.tool') lines.push('도구로 선택한 Agent가 전달한 인자와 그 Agent의 범위를 사용하고, 결과를 그 Agent의 다음 판단에 돌려주세요.');
        else lines.push('이 단계의 값 전달 연결로 받은 입력을 사용하고, 종료값을 이 호출 단계의 다음 경로에 전달하세요.');
        for (const skill of inherited.agent.availableSkills) {
          const material = byKey.get(skill.title);
          if (material) lines.push('- 하위 담당자가 선택할 수 있는 Skill — ' + skill.key + ' · ' + oneLine(material.name) +
            (material.included ? ' · ' + material.files[0] : ' · 선택해서 사용할 때 원문을 준비하세요.'));
        }
        if (!inherited.fromCallable || inherited.agent.availableSkills.length)
          lines.push('- 상위 배정에서 활성화된 Skill 키 — ' + (inherited.agent.activeSkills.map(skill=>skill.key).join(', ') || '없음'));
        for (const key of mcpKeys ?? []) {
          const connection = byKey.get(key);
          if (connection?.included && connection.mcp) lines.push('- 호출에 전달할 MCP 판 — ' + oneLine(connection.name) + ' ' + connection.version + '판 (' + connection.mcp.id + ')');
          else lines.push('- 이번 호출에서 제외된 MCP 판이 실제로 필요해지면 해당 연결을 요청하세요.');
        }
      }
      if (inherited.fromCallable && (isDelegatedRole(node.type) || node.type==='agent.team' || config.inheritedSkillIds?.length))
        work.push('', '- 호출자가 전달한 Skill 중 이 단계에서 선택할 키 — ' + (Array.isArray(config.inheritedSkillIds) && config.inheritedSkillIds.length ? config.inheritedSkillIds.join(', ') : '없음'));
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
        if (node.type === 'file.input' && key === config.exportResource) {
          exampleFiles.add(key);
          if (material.included) lines.push('', '시험용 예시 — ' + material.files[0] + '. 이 단계에서는 지정한 방식으로 받은 실제 첨부를 사용하세요.');
          continue;
        }
        // Connection blocks describe an edition. Only a consuming step may grant use of a tool.
        if (material.kind === 'mcp' && node.type !== 'connection.mcp') continue;
        if (material.kind === 'skill' && !modelBlocks.has(node.type) && !isDelegatedRole(node.type)) {
          if (node.type==='instruction.skill' && material.included) lines.push('', '- 지침 원문 — ' + material.files[0]);
          continue;
        }
        work.push('', '- ' + materialInstruction(material));
      }
      function toolName(name: unknown) {
        if (typeof name !== 'string' || !name.startsWith('mcp.')) return name;
        let pin: McpPin | undefined;
        try { pin = toolPin(name, scope); }
        catch {
          const assetId = name.split('.')[1];
          const operation = name.slice(('mcp.' + assetId + '.').length);
          const matches = (scope ?? []).filter(candidate => candidate.assetId === assetId);
          if (matches.length > 1) {
            const included = matches.flatMap(candidate => {
              const edition = pins.get(assetId + ':' + candidate.version);
              return edition?.included && edition.mcp ? [{
                label:oneLine(edition.name) + ' ' + edition.version + '판 (' + edition.mcp.id + ')',
                tools:edition.mcp.tools,
              }] : [];
            });
            const editions = included.map(edition => edition.label);
            const tool = included.some(edition => edition.tools.includes(operation)) ? '‘' + operation + '’ 도구' : '이 작업의 도구';
            return '호출 직전에 사용자에게 연결 버전 하나를 선택받으세요.' +
              (editions.length ? ' ZIP에 포함된 후보 — ' + editions.join(', ') + '.' : '') +
              ' 선택한 판이 ' + tool + '를 제공하는지 확인한 뒤 호출하세요.';
          }
          if (inherited.fromCallable && !scope && [...pins].some(([key, material]) =>
            key.startsWith(assetId + ':') && material.included && material.mcp?.tools.includes(operation)))
            return '이번 호출자가 전달한 연결의 ' + operation + ' (호출자가 지정한 판과 허용 범위를 사용하세요)';
          return '연결이 필요한 MCP 도구 (사용할 때 사용자에게 연결을 요청하세요)';
        }
        if (pin) {
          const operation = name.slice(('mcp.' + pin.assetId + '.').length);
          const resource = pins.get(pin.assetId + ':' + pin.version);
          if (resource?.included && resource.mcp?.tools.includes(operation)) return resource.mcp.id + ' / ' + operation +
            (resource.mcp.readOnlyTools ? (resource.mcp.readOnlyTools.includes(operation)?' (읽기 전용)':' (변경 작업 · 승인 필요)') : '');
        }
        return '연결이 필요한 MCP 도구 (사용할 때 사용자에게 연결을 요청하세요)';
      }
      for (const field of definition?.fields ?? []) {
        if (['assetId','workflowId','content','server','allowedTools','timeoutMinutes','replyTimeoutMinutes'].includes(field.key)) continue;
        if (node.type === 'file.create' && field.key === 'fileName') continue;
        const value = field.key === 'tool' ? toolName(config.tool) : budgetFieldValue(field, config[field.key]);
        if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
        const option = field.options?.find(item => item.value === value)?.label;
        const content = option ?? (typeof value === 'object' ? JSON.stringify(value) : String(value));
        const destination = ['role','goal','task','instruction','criterion'].includes(field.key) ? work : lines;
        const label = node.type === 'file.input' && field.key === 'fileName' ? '시험 파일 이름' : field.label;
        destination.push('', '- ' + label + ' — ' + content.replace(/\n/g, '\n  '));
      }
      if (['ai.single_task','agent.task','agent.delegate','agent.handoff','agent.create_dynamic'].includes(node.type)) {
        for (const [field, caption] of [['role','역할'],['goal','목표'],['task','작업 내용'],['instruction','작업 지시'],['criterion','완료 기준']]) {
          if (config[field] && !definition?.fields.some(item => item.key === field)) {
            work.push('', '- ' + caption + ' — ' + String(config[field]).replace(/\n/g, '\n  '));
          }
        }
      }
      if (node.type === 'ai.single_task') work.push('', '- 이 단발 작업에서 호출할 도구 — 없음');
      else if (isDelegatedRole(node.type) && !node.graph) work.push('', '- 이 배정의 단일 응답에서 호출할 도구 — 없음');
      else if (node.type === 'agent.task' || tools) {
        const permitted = node.type==='agent.task' && !Array.isArray(config.allowedTools) ? [] : tools ?? [];
        work.push('', '- 허용할 도구 — ' + (permitted.map(toolName).join(', ') || '없음') +
          (inherited.fromCallable && permitted.length ? ' (이번 호출자가 허용한 도구만 사용하세요.)' : ''));
      }
      if (node.type === 'agent.task' && linked.some(source => source.type === 'workflow.tool')) {
        lines.push('', '- 호출 가능한 Workflow — ' + linked.filter(source => source.type === 'workflow.tool')
          .map(source => 'workflow.' + String(source.config.name || source.id)).join(', '));
      }
      if (node.graph) {
        const childScope:InstructionScope = stage.edition ? {agent:emptyAgentContext, documents:[], fromCallable:true} :
          {agent:childAgentContext(inherited.agent, node, skills), documents, tools, pins:scope, mcpKeys,
            fromCallable:node.type === 'workflow.tool' || inherited.fromCallable};
        visit(node.graph, stage.edition ? [sharedEditionLabel(config.version,stage.stepPath)] : [...path, oneLine(node.title) || node.id],
          stage.edition ? [stage.edition] : [...idPath, node.id], childScope, stage);
      }
    }
  }
  visit(graph, [], [], {agent:emptyAgentContext, documents:[]});
  const checksPrivacy = stages.some(stage => stage.node.type === 'safety.redact');
  const createsFiles = stages.some(stage => stage.node.type === 'file.create');
  if (createsFiles) common.push('파일 만들기 결과는 생성 호출과 함께 메모리에 보관하세요. 하위 종료·회신 대기·실패·중지 시 파일을 쓰지 마세요. 최상위 실행의 민감정보 검사와 최종 결과 선택이 끝나면 대표가 실제 생성 호출에서 전달된 파일만 outputs/에 저장하세요. 결과에서 빠졌거나 차단된 파일은 제외하고 가린 이름과 본문을 반영하세요. 여러 파일의 최종 저장 도중 실패하면 이번 전달에서 새로 만든 파일만 정리하고 실패를 알리세요. 저장을 완료한 파일의 실제 경로를 답변하세요.');
  if (checksPrivacy) common.push(
    '민감정보 검사에서 발견한 값은 이후 모델 호출, 하위 Agent 인계와 다음 문답에서도 차단·가림 결과를 유지하세요. 원래 질문·답변·첨부·회신·보존 항목을 포함해 전달할 문맥 전체를 확인하세요.',
    '클라이언트가 이전 대화 원문을 자동으로 모델에 첨부하면 후속 호출 전에 멈추세요. 처리된 값과 진행 위치만 담은 인계 내용을 준비해 이전 대화를 포함하지 않는 새 세션에서 재개하세요. 새 세션이나 격리된 인계가 지원되지 않으면 원문이 재전달되기 전에 중단하세요.');
  const lines: string[] = [];
  const listed = resources.filter(resource => resource.kind !== 'mcp' || resource.included);
  if (listed.length) lines.push('', '## 연결 자료');
  for (const resource of listed) {
    lines.push('', '### ' + oneLine(resource.name), '', '- 사용 단계 — ' + resource.steps.join(', '));
    if (resource.version) lines.push('- 자료 버전 — ' + resource.version);
    if (exampleFiles.has(resource.key)) lines.push(resource.included
      ? '- 시험용 예시 파일 — ' + resource.files[0] : '- 시험용 예시 파일은 선택에서 제외했습니다.');
    else if (resource.kind==='skill') lines.push(resource.included ? '- 선택한 담당 단계의 지침 원문 — ' + resource.files[0] : '- 내보내기 선택에서 제외된 Skill입니다.');
    else lines.push('- ' + materialInstruction(resource));
  }
  if (roles.size) common.push(
    '위임 단계에 도달하면 현재 클라이언트의 하위 Agent 호출 기능으로 단계에 지정된 등록 이름과 작업 번호를 사용하세요. 역할에 전달할 수 있는 원래 질문, 해당 입력값, 자료 경로와 결과 반환 위치를 전달하고 호출 ID를 단계·대상별로 기록하세요.',
    '담당자는 결과나 실패 사유를 반환합니다. 대표는 호출 식별자로 응답을 원래 단계에 대응시키고, 결과값을 설계에 지정된 다음 입력으로 전달하세요. 하위 Agent가 직접 재위임할 수 없으면 대표가 지정된 역할을 대신 호출해 원래 담당자에게 결과를 전달하세요. 사용자 승인과 역할 실행 환경 준비는 대표가 요청하고, 준비 여부에 따라 해당 단계를 재개하거나 설계의 실패 정책을 따르세요.');
  const files = instructionFiles(common, graph.agentScope, stages, lines);
  const split = Object.hasOwn(files, 'workflow/index.md');
  return {files:{...files, ...roleDocuments(stages, split, checksPrivacy), ...roleRegistrationFiles([...roles.values()])}, split, shared:stages.some(stage=>stage.edition), roles:[...roles.values()],
    createsFiles};
}

function readme(pkg: ExportPackage, {split, shared, roles, createsFiles}: ReturnType<typeof agentInstructions>, preparation: Map<string, ExportPreparation[]>) {
  const lines = [
    '# ' + oneLine(pkg.title) + ' 사용법', '',
    '1. ZIP 전체를 새 폴더에 푸세요.',
    '2. Codex, Claude Code 또는 OpenCode에서 AGENTS.md가 있는 폴더를 작업 폴더로 열고 새 대화를 시작하세요.',
    '3. “이 Workflow로 다음 내용을 처리해 줘”라고 요청하고 작업할 내용을 입력하거나 파일을 첨부하세요.',
    '', '각 도구의 기존 로그인과 모델 설정을 사용합니다. CLAUDE.md도 AGENTS.md를 참조합니다. 검토 요청이 나오면 대화에서 승인 또는 수정 의견을 보내세요.',
    split ? 'AGENTS.md에서 시작 단계를 찾아 여세요. 상세 지침은 workflow/ 안에 있으며 현재 단계에 연결된 파일을 따라 읽으면 됩니다.' :
      '단계·분기·승인 조건은 AGENTS.md에서 확인할 수 있습니다.',
  ];
  if (shared) lines.push('같은 하위 저장판을 여러 번 쓰는 단계는 workflow/의 같은 저장판 문서로 연결됩니다. 호출한 단계에서 입력과 허용 범위를 전달하고 그 위치에서 결과를 이어받으세요.');
  if (createsFiles) lines.push('최상위 실행이 완료되면 최종 답변에 포함된 생성 파일만 민감정보 처리를 거친 이름과 본문으로 작업 폴더의 `outputs/`에 저장합니다. 최종 답변에서 실제 저장 경로를 확인하세요.');
  lines.push(...runBudgetReadme);
  if (preparation.size) {
    const plain = (text: string) => oneLine(text).replace(/[\\`*_\[\]<>]/g, '\\$&');
    lines.push('', '<a id="workflow-preparation"></a>', '', '## 실행 준비', '',
      '선택한 단계에 도달했을 때 그 단계에서 실제로 필요한 항목을 확인하세요. 준비를 기다리는 동안에는 다른 분기의 준비를 요청할 필요가 없습니다.');
    for (const [anchor, items] of preparation) {
      lines.push('', '<a id="' + anchor + '"></a>', '', '### ' + plain(items[0].step), '');
      for (const item of items) lines.push('- ' + plain(item.action) + ' ' + plain(item.reason));
    }
  }
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
    lines.push('Claude Code와 OpenCode에서 서버의 다른 도구가 보이더라도 현재 호출의 역할과 허용 목록에 지정된 도구만 사용하세요.');
    if (connections.some(resource => !resource.mcp?.url)) lines.push('', '수동 연결 항목은 아래에 적힌 도구를 제공하는 서버의 주소나 시작 명령을 준비하세요. 사용할 클라이언트의 프로젝트 MCP 설정에 아래 식별자로 서버를 등록하고 새 대화에서 도구 목록을 확인하세요.');
    for (const resource of connections) {
      const mcp = resource.mcp!;
      lines.push('', '- ' + oneLine(resource.name) + ' ' + resource.version + '판 (' + mcp.id + ') — ' + (mcp.url ? '프로젝트 설정에 등록됨' : '사용할 서버를 이 도구에서 직접 연결하세요.') + ' · 사용 단계 — ' + resource.steps.join(', '));
      if (mcp.tokenEnv) lines.push('  인증에는 실행 환경에 설정한 ' + mcp.tokenEnv + ' 변수를 사용합니다.'+
        (mcp.url?'':' 수동 등록한 서버의 인증 설정에서 이 변수를 참조하세요.'));
      if (mcp.tools.length) lines.push('  사용 가능한 도구 — ' + mcp.tools.join(', '));
    }
  }
  return lines.join('\n') + '\n';
}

export function buildAgentZip(input: ExportPackage): Uint8Array<ArrayBuffer> {
  const pkg = prepareAgentSkills(input);
  const entries: Record<string, Uint8Array> = Object.create(null);
  const preparation = preparationSections(pkg);
  const instructions = agentInstructions(pkg, preparation);
  for (const [path, body] of Object.entries(instructions.files)) entries[path] = strToU8(body);
  entries['CLAUDE.md'] = strToU8('@AGENTS.md\n');
  entries['README.md'] = strToU8(readme(pkg, instructions, preparation));
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
