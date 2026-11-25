import {stringify} from 'yaml';

export interface ExportRole {
  id: string;
  name: string;
  path: string;
}

function agentMarkdown(metadata: Record<string,string>, instructions: string) {
  return '---\n' + stringify(metadata, {lineWidth:0}) + '---\n\n' + instructions + '\n';
}

export function roleRegistrationFiles(roles: ExportRole[]): Record<string,string> {
  const files: Record<string,string> = {};
  for (const {id, name, path} of roles) {
    const codexPath = '.codex/agents/' + id + '.toml';
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id) || path !== 'agents/' + id + '.md' || Object.hasOwn(files, codexPath)) {
      throw Error('위임 역할의 식별자와 지침 경로를 확인하세요.');
    }
    const title = name.replace(/[\x00-\x1f\x7f-\x9f\s]+/g, ' ').trim().slice(0, 120).toWellFormed();
    const description = 'Workflow에서 ' + (title || id) + ' 역할에 위임한 작업을 수행합니다.';
    const instructions = '작업을 시작할 때 프로젝트 루트(AGENTS.md가 있는 폴더)를 기준으로 `' + path +
      '` 파일을 먼저 여세요. 이 역할 지침을 위임받은 입력에 적용하고 지정된 결과를 호출자에게 반환하세요.';
    files[codexPath] = [
      'name = ' + JSON.stringify(id),
      'description = ' + JSON.stringify(description),
      'developer_instructions = ' + JSON.stringify(instructions),
    ].join('\n') + '\n';
    files['.claude/agents/' + id + '.md'] = agentMarkdown({name:id, description}, instructions);
    files['.opencode/agents/' + id + '.md'] = agentMarkdown({description, mode:'subagent'}, instructions);
  }
  return files;
}
