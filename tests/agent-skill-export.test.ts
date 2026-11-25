import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parse} from 'yaml';
import type {ExportPackage} from '../src/domain/agent-export';
import {prepareAgentSkills} from '../src/server/agent-skill-export';

function skill(key: string, name: string, included = true): ExportPackage['resources'][number] {
  return {key, name, kind: 'skill', version: '1', steps: ['답변 작성'], available: true, included,
    files: ['resources/' + key + '/SKILL.md']};
}
function file(path: string, text: string | Buffer) {
  return {path, data: Buffer.from(text).toString('base64')};
}
function prepare(resources: ExportPackage['resources'], files: ExportPackage['files']) {
  return prepareAgentSkills({title: '도서관', graph: {nodes: [], edges: []}, resources, files});
}
function markdown(pkg: ExportPackage, path: string) {
  const item = pkg.files.find(entry => entry.path === path);
  assert.ok(item, path);
  return Buffer.from(item.data, 'base64').toString('utf8');
}
function frontmatter(markdown: string) {
  return parse(markdown.split(/\r?\n---\r?\n/)[0].replace(/^---\r?\n/, ''));
}

test('같은 Skill 원본을 세 도구에서 참조하고 Claude 참조는 호출 조건만 이어받는다', () => {
  const item = skill('a', '근거 인용');
  const imagePath = 'resources/a/references/그림.png';
  item.files.push(imagePath);
  const body = [
    '---', 'name: cite-sources', 'description: >', '  Cite sources', '  from the library.',
    'manual-only: &manual true', 'disable-model-invocation: *manual', 'user-invocable: false', 'argument-hint: "[query]"',
    'allowed-tools: Bash', 'hooks: {}', '---', '', '지침 원문. [그림](references/그림.png)', '',
  ].join('\r\n');
  const blob = Buffer.from([0,255,42]);
  const pkg = prepare([item], [file(item.files[0], body), file(imagePath, blob)]);
  const [primary, image] = pkg.resources[0].files;
  assert.equal(primary, '.agents/skills/cite-sources/SKILL.md');
  assert.equal(markdown(pkg, primary), body);
  assert.equal(image, '.agents/skills/cite-sources/references/그림.png');
  assert.equal(pkg.files.find(f => f.path === image)?.data, blob.toString('base64'));
  const pointer = markdown(pkg, '.claude/skills/cite-sources/SKILL.md');
  assert.ok(pointer.includes(primary));
  assert.ok(!pointer.includes('지침 원문'));
  assert.deepEqual(frontmatter(pointer), {name:'cite-sources',description:'Cite sources from the library.\n',
    'disable-model-invocation':true, 'user-invocable':false, 'argument-hint':'[query]'});
  assert.ok(!pkg.files.some(f => f.path.startsWith('resources/a/')));
});

test('이름 없는 기존 Markdown도 고유한 Skill로 발견되고 일반 문서는 같은 위치를 유지한다', () => {
  const one = skill('1', '근거 인용');
  const two = skill('2', '근거 인용');
  const unsafe = skill('3', 'CoN');
  const doc = {...skill('4', '대출 규정'), kind: 'document' as const, files:['resources/4/source.md']};
  const originals = [one,two,unsafe,doc];
  const pkg = prepare(originals, originals.map(r => file(r.files[0], '제목\n\n본문')));
  const ids = pkg.resources.slice(0,3).map(r => r.files[0].split('/')[2]);
  assert.equal(new Set(ids).size, 3);
  assert.equal(ids[2], 'skill-con');
  for (const [i, id] of ids.entries()) {
    assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    const content = markdown(pkg, pkg.resources[i].files[0]);
    assert.equal(frontmatter(content).name, id);
    assert.ok(frontmatter(content).description.includes(originals[i].name));
    assert.ok(content.endsWith('제목\n\n본문'));
  }
  assert.equal(markdown(pkg, doc.files[0]), '제목\n\n본문');
});

test('같은 이름의 여러 판과 제외한 Skill도 충돌 없이 연결하고 본문과 부속 자료를 분리한다', () => {
  const removed = skill('old', 'citations', false);
  const first = skill('one', '첫 판');
  const second = {...skill('two', '두 번째 판'), version:'2'};
  const body = '---\nname: citations\ndescription: 인용할 때 사용\n---\n실제 지침';
  const pkg = prepare([removed, first, second], [file(first.files[0], body), file(second.files[0], body)]);
  const targets = pkg.resources.map(r => r.files[0]);
  assert.equal(new Set(targets).size, 3);
  assert.equal(pkg.files.length, 4);
  assert.equal(pkg.files.find(f => f.path === targets[0]), undefined);
  assert.equal(frontmatter(markdown(pkg, targets[2])).name, 'citations-2');
  assert.ok(markdown(pkg, '.claude/skills/citations-2/SKILL.md').includes(targets[2]));
});
