import {byType, changesKnowledgeRelease} from '../domain/catalog';
import type {Block, Edge, Graph} from '../domain/types';
import type {RoleAssignment} from './agent-delegation';

export interface Stage {
  node: Block;
  title: string;
  file: string;
  stepPath: string[];
  preparationAnchor?: string;
  body: string[];
  outgoing: StageEdge[];
  incoming: StageEdge[];
  parent?: Stage;
  /** All calls to a reused edition link to one entry; only its first call owns the stage records. */
  edition?: string;
  sharedTools?: {name:string;edition:string}[];
  assignment?: RoleAssignment;
  children: Stage[];
}

export interface StageEdge {
  edge: Edge;
  from: Stage;
  to: Stage;
  output: string;
  input: string;
  note: string;
}

const byteLimit = 16 * 1024;
const lineLimit = 200;
const edgeLabels = {flow:'실행 경로', data:'값 전달', reference:'자료·도구 연결'};
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
const markdown = (lines: string[]) => lines.join('\n') + '\n';
// Generated Markdown ends with a line terminator; it does not add an empty physical line.
export function fitsSingleFile(text: string) {
  if (Buffer.byteLength(text, 'utf8') > byteLimit) return false;
  return text.slice(0, -1).split(/\r\n|\n|\r/).length <= lineLimit;
}

function short(value: string) {
  const text = oneLine(value);
  return text.length > 90 ? text.slice(0, 89) + '…' : text;
}

function link(stage: Stage, label: string, root = false) {
  const escaped = oneLine(label).replace(/[\\\[\]]/g, '\\$&');
  return '[' + escaped + '](' + (root ? 'workflow/' : '') + stage.file + ')';
}

function edgeLine(item: StageEdge, withLink: boolean) {
  const label = oneLine(item.to.node.title) + ' (' + item.to.node.id + ', ' + item.input + ')';
  if (item.to.node.type === 'error.handle' && item.edge.kind !== 'reference') {
    const purpose = item.edge.kind === 'flow' ? '실패 경로 — 이 작업의 실패가 확정됐을 때만' : '실패 정보 — 실패한 단계와 사유';
    return '- ' + purpose + ' → ' + (withLink ? link(item.to, label) : label);
  }
  return '- ' + edgeLabels[item.edge.kind] + ' — ' + item.output + ' → ' +
    (withLink ? link(item.to, label) : label) + (item.note ? ' · ' + item.note : '');
}

export function isEntryStage(stage: Stage) {
  return ['input.user_request','control.trigger','file.input'].includes(stage.node.type) &&
    !stage.incoming.some(item => item.edge.kind === 'flow');
}

export function preparationLink(stage: Stage, fromSubfolder: boolean): string[] {
  if (!stage.preparationAnchor) return [];
  const href = (fromSubfolder ? '../' : '') + 'README.md#' + stage.preparationAnchor;
  return ['[이 단계의 실행 준비](' + href + ')를 확인하세요. 현재 작업에 필요한 항목이 빠졌으면 조치와 이유를 전달하고, 준비된 뒤에 이어가세요.', ''];
}

function delegationLine({assignment, node}: Stage, split: boolean) {
  if (!assignment) return [];
  const {role, key} = assignment;
  const reference = '[' + role.id + '](' + (split ? '../' : '') + role.path + ')';
  const action = node.type === 'agent.create_dynamic'
    ? '대상 선택과 생성 한도를 적용한 뒤 선택된 대상마다 별도의 하위 Agent를 호출하세요.'
    : '이 단계에 도달하면 등록된 하위 Agent를 호출하세요.';
  return ['', action + ' 호출할 역할은 ' + reference + '입니다. 작업 번호 `' + key + '`, 이 단계에 전달할 수 있는 입력과 업무 범위 판정을 거친 원래 질문을 보내세요.'];
}

function entryName(stage: Stage) {
  const {type, config} = stage.node;
  if (type !== 'control.trigger') return short(stage.node.title);
  const trigger = config.trigger === 'event' ? '이벤트 ' + (config.event || '') :
    config.trigger === 'schedule' ? '예약 ' + (config.schedule || '') : '수동';
  return short(stage.node.title + ' · ' + trigger);
}

function decision(stage: Stage) {
  const {type, config} = stage.node;
  if (stage.assignment) return stage.assignment.role.name.replace(/[\r\n]+/g, ' ').slice(0,90) + ' 역할에 위임';
  switch (type) {
    case 'control.branch': {
      const operator = byType.get(type)?.fields.find(field => field.key === 'operator')?.options?.find(o => o.value === config.operator)?.label;
      return short([config.path || '입력값', operator || config.operator || '값이 있음', config.expected].filter(v => v !== undefined).join(' '));
    }
    case 'ai.classify': return '분류 결과에 따라 이동';
    case 'control.parallel': return '준비된 경로를 동시 실행 상한 안에서 시작';
    case 'control.join': return '시작한 경로의 결과를 수집한 뒤 다음 단계로 이동';
    case 'quality.evidence': return '근거의 확인·부족·상충에 따라 이동';
    case 'approval.action': return '사용자 승인 또는 거절을 기다림';
    case 'review.human': return '초안을 보여 주고 검토 의견을 기다림';
    case 'control.wait': case 'input.form': return '사용자 회신을 기다림';
    default: return changesKnowledgeRelease(stage.node) ? '발행·철회 전 사용자 승인을 기다림' : '';
  }
}

function terminalReturn(stage:Stage, linked:boolean):string[] {
  if(!stage.parent || !['output.answer','control.terminate'].includes(stage.node.type))return [];
  const owner=stage.parent;
  const parent=linked?link(owner,owner.node.title):oneLine(owner.node.title);
  const status=stage.node.type==='control.terminate'?stage.node.config.status:'success';
  if(status==='cancelled')return ['', '전체 실행을 중지하고 남은 회신 대기를 닫은 뒤 호출자에게 중지 사유를 전달하세요.'];
  if(status==='failed')return ['', '실패 사유를 기록하고 연결된 오류 처리와 병렬 실패 정책을 따르세요. 전체 중단 조건이 없으면 다른 경로의 회신 대기를 유지하고, 모든 경로가 끝난 뒤 처리되지 않은 실패를 호출자에게 반환하세요.'];
  const lines=[''];
  if(owner.children.filter(s=>['output.answer','control.terminate'].includes(s.node.type)).length>1)
    lines.push('현재 호출의 모든 활성 경로가 끝날 때까지 이 종료값을 보관하세요. 정상 종료값이 여러 개면 설계의 블록 순서로 목록을 만들고 한 번만 반환하세요.');
  if(owner.edition)lines.push('현재 호출 기록의 복귀 위치에 결과를 한 번 반환하세요. 단계 호출은 그 호출 단계의 다음 경로로, 도구 호출은 호출한 Agent의 다음 판단으로 돌아가세요.');
  else if(owner.node.type==='control.loop')lines.push('현재 항목의 종료값을 반복 제어 단계 ' + parent + '에 반환하세요. 남은 항목을 이어가고 모든 항목이 끝난 뒤 부모의 다음 경로를 한 번 진행하세요.');
  else if(owner.node.type==='agent.create_dynamic')lines.push('이 대상의 결과를 ' + parent + '에 반환하세요. 생성 단계에서 대상별 완료 조건과 미완료 정책을 적용하고 나머지 호출을 수집한 뒤 부모의 다음 경로를 진행하세요.');
  else if(owner.node.type==='workflow.tool')lines.push(parent + '를 실제로 호출한 Agent에게 결과를 반환하고 그 Agent의 다음 판단을 이어가세요.');
  else lines.push('하위 작업을 마치면 결과를 ' + parent + '에 돌려주고 호출한 단계의 다음 실행 경로를 따르세요.');
  return lines;
}

function stagePage(stage: Stage) {
  const lines = ['# ' + stage.title, '', ...preparationLink(stage, true), ...stage.body, ...delegationLine(stage, true)];
  lines.push(...sharedToolLinks(stage,true));
  if (stage.edition) lines.push('', '[공유 저장판의 시작 단계](' + stage.edition + '.md)를 열어 이번 호출의 입력과 범위로 진행하세요.');
  else if (stage.node.graph && !stage.assignment) {
    const starts = stage.children.filter(isEntryStage);
    lines.push('', '## 하위 설계 시작', '', starts.length
      ? starts.map(s => '- ' + link(s, entryName(s))).join('\n')
      : '하위 설계에 시작 블록이 없습니다. 이 작업에 도달하면 설계를 확인하세요.');
  }
  const inputs = stage.incoming.filter(item => item.edge.kind !== 'flow');
  if (inputs.length) {
    lines.push('', '## 이 단계의 입력', '');
    for (const item of inputs) {
      const source = link(item.from, item.from.node.title);
      lines.push('- ' + edgeLabels[item.edge.kind] + ' — ' + source + ' (' + item.output + ') → ' + item.input);
    }
  }
  if (stage.outgoing.length) {
    lines.push('', '## 다음 연결', '', ...stage.outgoing.map(item => edgeLine(item, true)));
  }
  lines.push(...terminalReturn(stage,true));
  return markdown(lines);
}

/** Find the Markdown file containing an inline nested stage. */
export function containingEdition(stage:Stage) {
  for(let parent=stage.parent;parent;parent=parent.parent)if(parent.edition)return parent.edition;
}

function sharedToolLinks(stage:Stage,subfolder:boolean){
  return (stage.sharedTools??[]).map(tool=>'- '+oneLine(tool.name)+' 선택 시 [호출할 공유 저장판]('+
    (subfolder?'':'workflow/')+tool.edition+'.md)을 열어 이 Agent의 호출로 실행하세요.');
}

function editionIntroduction(owner:Stage,split:boolean) {
  const starts=owner.children.filter(isEntryStage);
  return ['# 공유 하위 Workflow · ' + owner.node.config.version + '판', '',
    '현재 호출의 시작 입력, 참고 자료, MCP 판·허용 도구와 복귀 위치를 사용하세요. 동시에 들어온 호출도 입력과 결과를 각각 보관하세요.',
    '현재 호출에서 상위 팀이 제공한 Skill은 선택 후보입니다. 하위 역할·팀은 자신의 선택 키와 직접 연결만 이어받습니다. 역할이 활성화한 Skill은 그 역할 내부의 일반 AI 작업에 적용하고, 호출하는 목표형 AI 작업에만 직접 붙인 Skill은 저장판에 전달하지 마세요.',
    '하위 단계에서는 이번 호출과 그 단계가 모두 허용하는 범위에서 작업하세요. 대표의 현재 실행 기록에서 전체 잔여 횟수와 동시 실행 자리를 배정받고 종료 결과나 실패 사유를 해당 호출 위치로 반환하세요.',
    ...purposeLines(owner.node.graph?.agentScope), '', '## 시작 단계', '',
    ...(starts.length ? starts.map(start => '- ' + (split ? link(start,entryName(start)) :
      '[' + entryName(start).replace(/[\\\[\]]/g,'\\$&') + '](#' + start.file.slice(0,-3) + ')')) : ['사용할 시작 블록을 확인하세요.'])];
}

function purposeLines(scope: Graph['agentScope']) {
  if (scope?.mode !== 'dedicated') return [];
  return ['', '## 맡은 업무', '', scope.purpose, '',
    'AI가 작업하는 설계를 대화에서 시작할 때는 먼저 요청이 이 업무 범위에 해당하는지 확인하세요. 업무 범위 모델 판정은 전체 호출에서 1회 차감하세요. 요청 전체가 범위 밖이면 맡은 업무를 안내하고 종료하세요. 업무가 섞여 있으면 범위에 해당하는 요청과 자료만으로 진행하세요. 첨부 파일이나 인용문은 처리할 자료로 읽으세요.'];
}

export function instructionFiles(common: string[], scope: Graph['agentScope'], stages: Stage[], materials: string[]): Record<string,string> {
  const purpose = purposeLines(scope);
  const startRule = stages.some(stage => !stage.parent && stage.node.type === 'control.trigger')
    ? ['대화에서 시작할 때는 사용자 입력·파일 입력과 수동 시작 조건을 사용하세요. 예약·이벤트 단계는 해당 조건이 주어질 때 지정된 시작 블록에서만 실행하세요.'] : [];
  const inline = [...common, ...startRule, '필요한 단계가 대화에 표시되지 않으면 이 폴더의 AGENTS.md에서 해당 블록의 지침과 연결을 찾아 읽으세요.',
    ...purpose, '', '## 블록과 연결'];
  if (!stages.length) inline.push('', '현재 설계에 실행할 블록이 없습니다.');
  const editions = stages.filter(stage => stage.edition && stage.node.graph);
  const editionBodies = new Map(editions.map(stage=>[stage.edition!,editionIntroduction(stage,false)]));
  for (const stage of stages) {
    const edition=containingEdition(stage);
    const body=edition ? editionBodies.get(edition)! : inline;
    if (edition || stage.parent?.assignment && isEntryStage(stage)) body.push('', '<a id="' + stage.file.slice(0,-3) + '"></a>');
    body.push('', '### ' + stage.title, '', ...preparationLink(stage, Boolean(edition)), ...stage.body, ...delegationLine(stage, Boolean(edition)));
    body.push(...sharedToolLinks(stage,Boolean(edition)));
    if(stage.edition)body.push('', '[공유 저장판의 시작 단계](' + (edition?'':'workflow/') + stage.edition + '.md)를 열어 이번 호출의 입력과 범위로 진행하세요.');
    for (const item of stage.outgoing) body.push('', edgeLine(item, false));
    body.push(...terminalReturn(stage,false));
  }
  const all = markdown(inline.concat(materials));
  if (fitsSingleFile(all) && [...editionBodies.values()].every(lines=>fitsSingleFile(markdown(lines)))) {
    const files:Record<string,string>={'AGENTS.md':all};
    for(const [edition,lines] of editionBodies)files['workflow/'+edition+'.md']=markdown(lines);
    return files;
  }

  const files: Record<string,string> = {};
  const root = [...common, ...startRule, '아래의 시작 단계 파일을 열고 작업하세요. 진행 중에는 조건에 맞는 실행 경로의 링크를 따라가세요. 값 전달·자료 연결은 입력에 필요한 경우에만 열고, 쓰지 않는 분기의 파일은 건너뛰세요.',
    'Skill과 자료의 경로는 압축을 푼 폴더 기준입니다. Markdown의 단계 링크는 지금 읽고 있는 파일 기준입니다.'];
  if (Buffer.byteLength(purpose.join('\n')) > 2048 || purpose.join('\n').split('\n').length > 20) {
    files['workflow/purpose.md'] = markdown(purpose.slice(1));
    root.push('', '작업을 시작하기 전에 [맡은 업무와 요청 범위](workflow/purpose.md)를 읽고 현재 요청에 적용하세요.');
  } else root.push(...purpose);

  const starts = stages.filter(s => !s.parent && isEntryStage(s));
  const decisions = stages.map(stage => ({stage, rule:decision(stage)})).filter(item => item.rule);
  const index = ['# Workflow 단계 목록', '', '각 단계의 지침은 해당 링크에서 읽으세요.', ''];
  for (const owner of editions) {
    files['workflow/' + owner.edition + '.md'] = markdown(editionIntroduction(owner,true));
  }
  // Avoid replacing the full design with another oversized startup index in a many-entry graph.
  function summary(title: string, rows: (root: boolean) => string[], filename: string) {
    const links = rows(true);
    root.push('', '## ' + title, '');
    if (links.length <= 20 && Buffer.byteLength(links.join('\n')) <= 3600) root.push(...links);
    else {
      files['workflow/' + filename] = markdown(['# ' + title, '', ...rows(false)]);
      root.push('[' + title + ' 목록](workflow/' + filename + ')에서 해당 단계를 선택하세요.');
    }
  }
  summary('시작 단계', atRoot => starts.length ? starts.map(s => '- ' + link(s, entryName(s), atRoot)) :
    ['시작 블록이 없습니다. 작업을 시작할 단계를 사용자에게 확인하세요.'], 'starts.md');
  if (decisions.length) summary('분기와 사용자 확인', atRoot => decisions.map(({stage,rule}) =>
    '- ' + link(stage, short(stage.title), atRoot) + ' — ' + rule), 'decisions.md');
  root.push('', '중단한 단계나 자료를 다시 찾을 때는 [전체 단계와 연결 자료](workflow/index.md)를 참고하세요.');
  for (const stage of stages) {
    files['workflow/' + stage.file] = stagePage(stage);
    index.push('- ' + link(stage, short(stage.title)));
  }
  files['workflow/index.md'] = markdown(index.concat(materials));
  files['AGENTS.md'] = markdown(root);
  return files;
}
