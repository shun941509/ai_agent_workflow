import {createHash} from 'node:crypto';
import {containingEdition, fitsSingleFile, isEntryStage, preparationLink, type Stage} from './agent-instruction-layout';
import type {ExportRole} from './agent-role-files';

export interface RoleAssignment {
  role: ExportRole;
  key: string;
  instructions: string[];
}

export function assignedRole(roles: Map<string,ExportRole>, graphPath: string[], stage: Stage, materialKeys: string[], tools?: string[]): ExportRole {
  const name = String(stage.node.config.role).trim();
  // Two teams can use the same role name with different input material or tool permissions.
  const signature = JSON.stringify([graphPath, name, materialKeys.sort(), tools ? [...tools].sort() : null]);
  const existing = roles.get(signature);
  if (existing) return existing;
  const slug = (value: string) => value.normalize('NFKD').toLowerCase().match(/[a-z0-9]+/g)?.join('-');
  const stem = (slug(name) || slug(stage.node.id) || 'role').slice(0, 30).replace(/-+$/, '');
  const digest = createHash('sha256').update(signature).digest('hex').slice(0, 12);
  const id = 'wf-' + stem + '-' + digest;
  const role = {id, name, path:'agents/' + id + '.md'};
  roles.set(signature, role);
  return role;
}

export function roleDocuments(stages: Stage[], split: boolean, checksPrivacy: boolean): Record<string,string> {
  const byRole = new Map<ExportRole,{header:string[]; assignments:Map<string,string[]>}>();
  for (const stage of stages) {
    if (!stage.assignment) continue;
    const {role, key, instructions} = stage.assignment;
    let document = byRole.get(role);
    if (!document) {
      const header = ['# ' + role.name.replace(/[\r\n]+/g, ' '), '',
        '등록 이름은 `' + role.id + '`입니다. 호출자가 전달한 작업 번호의 지침을 수행하세요. 입력, 연결 자료, Skill과 도구는 그 작업에 지정한 범위에서 사용하세요. 자료 경로는 프로젝트 루트 기준입니다.',
        '완료하면 작업 번호와 결과를 호출자에게 반환하세요. 실패하면 실제 사유를 반환하세요. 사람의 승인·검토가 필요한 단계에서는 확인할 대상과 인자를 호출자에게 보내고 사용자의 회신을 기다리세요.',
        '전체 호출 횟수와 동시 실행 자리는 대표가 관리합니다. [실행 한도와 기록](../README.md#run-limits)에 따라 호출 경로, 작업 번호, 차수와 용도로 배정받은 모델·외부 도구 작업만 시작하세요. 추가 배정이 필요하면 대표에게 요청하거나 다음에 필요한 호출을 결과와 함께 반환하세요. 같은 허가를 한 번만 쓰고 결과·실패·대기 상태와 호출 ID를 돌려주세요.'];
      header.push('재개할 때는 작업 번호와 현재 반복 항목, 대기 중인 호출 ID·승인, 완료 결과와 전체 잔여 횟수를 호출자와 확인하세요.');
      if (checksPrivacy) header.push('민감정보 검사 뒤에는 호출자가 차단·가림을 적용한 질문·입력·이력으로 작업하세요. 다음 호출에 이전 대화 원문이 자동 첨부되면 처리된 인계값만 받는 새 세션에서 재개하세요. 격리할 수 없으면 호출을 멈추고 대표에게 알리세요.');
      document = {header,assignments:new Map()};
      byRole.set(role, document);
    }
    const lines = ['## ' + key + ' · ' + stage.title, '', ...preparationLink(stage, true), ...instructions];
    document.assignments.set(key,lines);
    if (stage.node.type==='agent.handoff') lines.push('', '인계한 경로의 결과를 호출자에게 반환하세요. 서로 다른 담당자의 경로가 합류하면 팀 또는 현재 Workflow의 담당자가 후속 응답을 이어갑니다.');
    if (stage.preparationAnchor) lines.push('', '준비 요청은 작업 번호와 함께 호출자에게 전달하세요. 호출자가 이미 확인한 항목은 그 결과를 사용하고 응답을 받으면 같은 작업을 이어가세요.');
    const inputs = stage.incoming.filter(item => item.edge.kind === 'data');
    if (inputs.length) lines.push('', '### 전달받을 값', '', ...inputs.map(item =>
      '- ' + item.from.title + ' (' + item.output + ') → ' + item.input));
    if (stage.node.graph) {
      const starts = stage.children.filter(isEntryStage);
      lines.push('', '### 이 역할의 하위 설계', '',
        '현재 입력으로 아래 시작 단계에서 작업하세요. 하위 설계의 종료값을 호출자에게 반환하세요.');
      for (const start of starts) {
        const edition=containingEdition(start);
        const target = split ? '../workflow/' + start.file :
          (edition ? '../workflow/'+edition+'.md' : '../AGENTS.md') + '#' + start.file.slice(0,-3);
        const label = start.title.replace(/[\\\[\]]/g, '\\$&');
        lines.push('- [' + label + '](' + target + ')');
      }
      if (!starts.length) lines.push('시작 블록이 없습니다. 이 상태를 호출자에게 알리세요.');
    }
    if (stage.node.type === 'agent.create_dynamic') {
      lines.push('', '전달받은 대상 하나만 처리해 그 대상의 ' +
        (stage.node.config.resultRequirement==='evidence'?'결과와 확인한 원문 근거':'결과') + '를 반환하세요. 다른 대상의 배정과 수집은 호출자가 담당합니다.');
    }
  }
  const files:Record<string,string>={};
  for(const [role,{header,assignments}] of byRole){
    const body=[...header,...[...assignments.values()].flatMap(lines=>['',...lines])].join('\n')+'\n';
    if(fitsSingleFile(body)){files[role.path]=body;continue;}
    // Assignment pages and role documents are both one level below the ZIP root.
    const keys=[...assignments.keys()];
    const index=[...header,'','호출자가 지정한 작업 번호의 배정 문서를 여세요.'];
    for(let i=0;i<keys.length;i+=100){
      const group=keys.slice(i,i+100);
      const links=group.map(key=>'- ['+key+'](../workflow/assignment-'+key+'.md)');
      if(keys.length<=100)index.push('',...links);
      else{
        const path='workflow/assignments-'+role.id+'-'+(i/100+1)+'.md';
        files[path]=['# '+group[0]+' ~ '+group.at(-1),'',...links].join('\n')+'\n';
        index.push('- ['+group[0]+' ~ '+group.at(-1)+'](../'+path+')');
      }
    }
    files[role.path]=index.join('\n')+'\n';
    for(const [key,lines] of assignments)files['workflow/assignment-'+key+'.md']=lines.join('\n')+'\n';
  }
  return files;
}
