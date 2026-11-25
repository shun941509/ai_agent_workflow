import {createHash} from 'node:crypto';
import {isEntryStage, type Stage} from './agent-instruction-layout';
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

export function roleDocuments(stages: Stage[], split: boolean): Record<string,string> {
  const byRole = new Map<ExportRole,string[]>();
  for (const stage of stages) {
    if (!stage.assignment) continue;
    const {role, key, instructions} = stage.assignment;
    let lines = byRole.get(role);
    if (!lines) {
      lines = ['# ' + role.name.replace(/[\r\n]+/g, ' '), '',
        '등록 이름은 `' + role.id + '`입니다. 호출자가 전달한 작업 번호의 지침을 수행하세요. 입력, 연결 자료, Skill과 도구는 그 작업에 지정한 범위에서 사용하세요. 자료 경로는 프로젝트 루트 기준입니다.',
        '완료하면 작업 번호와 결과를 호출자에게 반환하세요. 실패하면 실제 사유를 반환하세요. 사람의 승인·검토가 필요한 단계에서는 확인할 대상과 인자를 호출자에게 보내고 사용자의 회신을 기다리세요.'];
      byRole.set(role, lines);
    }
    lines.push('', '## ' + key + ' · ' + stage.title, '', ...instructions);
    const inputs = stage.incoming.filter(item => item.edge.kind === 'data');
    if (inputs.length) lines.push('', '### 전달받을 값', '', ...inputs.map(item =>
      '- ' + item.from.title + ' (' + item.output + ') → ' + item.input));
    if (stage.node.graph) {
      const starts = stage.children.filter(isEntryStage);
      lines.push('', '### 이 역할의 하위 설계', '',
        '현재 입력으로 아래 시작 단계에서 작업하세요. 하위 설계의 종료값을 호출자에게 반환하세요.');
      for (const start of starts) {
        const target = split ? '../workflow/' + start.file : '../AGENTS.md#' + start.file.slice(0,-3);
        const label = start.title.replace(/[\\\[\]]/g, '\\$&');
        lines.push('- [' + label + '](' + target + ')');
      }
      if (!starts.length) lines.push('시작 블록이 없습니다. 이 상태를 호출자에게 알리세요.');
    }
    if (stage.node.type === 'agent.create_dynamic') {
      lines.push('', '전달받은 대상 하나만 처리해 그 대상의 결과와 근거를 반환하세요. 다른 대상의 배정과 수집은 호출자가 담당합니다.');
    }
  }
  return Object.fromEntries([...byRole].map(([role, lines]) => [role.path, lines.join('\n') + '\n']));
}
