import {createHash} from 'node:crypto';
import {isMap, parseDocument, stringify} from 'yaml';
import type {ExportPackage} from '../domain/agent-export';
import {StudioError} from './errors';

type Resource = ExportPackage['resources'][number];
const encode = (text: string) => Buffer.from(text).toString('base64');

function readSkill(text: string) {
  const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(text);
  if (!opening) return {body: text};
  const remainder = text.slice(opening[0].length);
  const ending = /^---[ \t]*(?:\r?\n|$)/m.exec(remainder);
  if (!ending) return {body: text};
  const document = parseDocument(remainder.slice(0, ending.index));
  if (document.errors.length || !isMap(document.contents)) return {body: text};
  try {
    const fields: Record<string, unknown> = document.toJS();
    return {document, fields, body: remainder.slice(ending.index + ending[0].length)};
  } catch {
    throw new StudioError(422, '선택한 SKILL.md의 YAML 참조를 확인하세요.');
  }
}

function skillId(name: string, key: string, used: Set<string>) {
  const words = name.normalize('NFKD').toLowerCase().match(/[a-z0-9]+/g);
  const slug = words?.join('-') || 'skill-' + createHash('sha256').update(key).digest('hex').slice(0, 10);
  const base = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slug) ? 'skill-' + slug : slug;
  let id = base.slice(0, 64).replace(/-+$/, '');
  for (let number = 2; used.has(id); number++) {
    const suffix = '-' + number;
    id = base.slice(0, 64 - suffix.length).replace(/-+$/, '') + suffix;
  }
  used.add(id);
  return id;
}

/** Convert the pinned Studio Skill files into project-local skills for all three hosts. */
export function prepareAgentSkills(pkg: ExportPackage): ExportPackage {
  const files = new Map(pkg.files.map(file => [file.path, file.data]));
  const used = new Set<string>();
  const converted = new Map<string, Resource>();
  const skills = pkg.resources.filter(resource => resource.kind === 'skill');
  // Give included Skills their own name even when an omitted edition has the same title.
  for (const resource of skills.sort((a, b) => Number(b.included) - Number(a.included))) {
    const main = resource.files[0];
    const original = files.get(main);
    if (resource.included && original === undefined) throw Error('Skill 지침 파일을 찾을 수 없습니다.');
    const text = Buffer.from(original ?? '', 'base64').toString('utf8');
    const {document, fields, body} = readSkill(text);
    const authoredName = fields?.name;
    const id = skillId(typeof authoredName === 'string' && authoredName.trim() ? authoredName : resource.name, resource.key, used);
    const directory = '.agents/skills/' + id + '/';
    const canonical = directory + 'SKILL.md';
    const paths = [canonical];
    converted.set(resource.key, {...resource, files: paths});
    if (!resource.included) {
      for (const path of resource.files) files.delete(path);
      continue;
    }

    const authoredDescription = fields?.description;
    const description = (typeof authoredDescription === 'string' && authoredDescription.trim()
      ? authoredDescription : resource.name + ' — AGENTS.md에 지정된 단계에서 사용하는 작업 지침입니다.').slice(0, 1024);
    const metadata = {name: id, description};
    let canonicalText = text;
    if (!document) {
      canonicalText = '---\n' + stringify(metadata) + '---\n\n' + body;
    } else if (authoredName !== id || authoredDescription !== description) {
      document.set('name', id);
      document.set('description', description);
      canonicalText = '---\n' + document.toString() + '---\n' + body;
    }
    files.delete(main);
    files.set(canonical, encode(canonicalText));
    const originalDirectory = main.slice(0, main.lastIndexOf('/') + 1);
    for (const path of resource.files.slice(1)) {
      const data = files.get(path);
      if (!path.startsWith(originalDirectory) || data === undefined) throw Error('Skill 부속 파일 경로를 확인하세요.');
      const relative = path.slice(originalDirectory.length);
      if (relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) {
        throw Error('Skill 부속 파일 경로를 확인하세요.');
      }
      files.delete(path);
      paths.push(directory + relative);
      files.set(directory + relative, data);
    }

    // Carry invocation restrictions, while leaving executable frontmatter and tool grants out of the pointer.
    const pointerMetadata: Record<string, string | boolean> = {...metadata};
    for (const field of ['disable-model-invocation', 'user-invocable']) {
      const setting = fields?.[field];
      if (typeof setting === 'boolean') pointerMetadata[field] = setting;
    }
    const hint = fields?.['argument-hint'];
    if (typeof hint === 'string') pointerMetadata['argument-hint'] = hint;
    const pointer = '---\n' + stringify(pointerMetadata) + '---\n\n' +
      '프로젝트 루트 기준 `' + canonical + '`를 열고 현재 요청에 그 지침을 적용하세요. ' +
      '원본 지침의 상대경로는 원본 SKILL.md가 있는 폴더를 기준으로 읽으세요.\n';
    files.set('.claude/skills/' + id + '/SKILL.md', encode(pointer));
  }
  return {...pkg, resources: pkg.resources.map(resource => converted.get(resource.key) ?? resource),
    files: Array.from(files, ([path, data]) => ({path, data}))};
}
