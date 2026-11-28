import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, sep} from 'node:path';
import {after, test} from 'node:test';
import {strFromU8, unzipSync} from 'fflate';
import nextConfig from '../next.config';
import {prepareAgentExport, previewAgentExport} from '../src/server/agent-export';
import {buildAgentZip} from '../src/server/agent-zip';
import {readAsset} from '../src/server/assets';
import {authenticate} from '../src/server/auth';
import {db} from '../src/server/db';
import {createProject} from '../src/server/projects';

const scratch = mkdtempSync(join(tmpdir(), 'equipment-inspection-skills-'));
process.env.STUDIO_DATA_DIR = scratch;
after(() => {db().close(); rmSync(scratch, {recursive:true, force:true});});

const sources = [
  ['developer','test-driven-development','.agents/skills/test-driven-development'],
  ['docs','find-docs','vendor/lesson-skills/find-docs'],
  ['design','frontend-design','.agents/skills/frontend-design'],
  ['ui','web-artifacts-builder','.agents/skills/web-artifacts-builder'],
  ['backend','webhook-handler-patterns','vendor/lesson-skills/webhook-handler-patterns'],
  ['creator','skill-creator','vendor/lesson-skills/skill-creator'],
] as const;

function sourceFiles(root:string, relative = ''):string[] {
  return readdirSync(join(root, relative), {withFileTypes:true}).flatMap(entry => {
    const path = relative + entry.name;
    return entry.isDirectory() ? sourceFiles(root, path + '/') : [path];
  });
}

test('Next 파일 추적은 Skill 파일만 포함하고 작업실 DB와 환경 설정을 패키지 밖에 둔다', async () => {
  const root = join(scratch,'trace');
  const skillFiles = ['vendor/lesson-skills/find-docs/SKILL.md','.agents/skills/web-artifacts-builder/scripts/init-artifact.sh'];
  for (const file of [...skillFiles,'.env.local','.studio-data/studio.sqlite','.local/private.txt']) {
    const path = join(root,file);
    mkdirSync(dirname(path),{recursive:true});
    writeFileSync(path,'fixture');
  }
  const ts = await import('typescript');
  const source = readFileSync('src/server/lesson-original-skills.ts','utf8');
  const compiled = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  const entry = join(root,'skills.mjs');
  writeFileSync(entry,compiled.outputText);
  const {nodeFileTrace} = createRequire(import.meta.url)('next/dist/compiled/@vercel/nft');
  const {fileList} = await nodeFileTrace([entry],{base:root,processCwd:root}) as {fileList:Set<string>};
  assert.deepEqual([...fileList].map(file => file.split(sep).join('/')).sort(), ['skills.mjs',...skillFiles].sort());
});

test('ZIP과 독립 HTML 라우트는 번들된 Markdown 모듈의 배포용 원문도 포함한다', () => {
  const source = './src/domain/markdown-section.mjs';
  for (const route of ['/api/studio', '/examples/equipment-inspection-recovery.html']) {
    assert.ok(nextConfig.outputFileTracingIncludes?.[route]?.includes(source), route);
  }
});

for (const lesson of ['equipment-inspection-web','equipment-inspection-recovery']) test(lesson + ' 사본과 ZIP에서 여섯 담당자가 배정된 원본 지침과 부속 파일을 그대로 받는다', () => {
  const user = authenticate('signup',lesson,'inspection-skill-test','').user;
  const project = createProject(user,{lesson});
  assert.ok(project.graph);
  const graph = project.graph;
  const request = {id:project.id, title:project.title, graph};
  const preview = previewAgentExport(user, request);
  const selected = preview.resources.filter(resource => resource.available).map(resource => resource.key);
  const files = unzipSync(buildAgentZip(prepareAgentExport(user,{...request, previewId:preview.previewId, selected})));
  const roles = Object.entries(files).filter(([path]) => /^agents\/.*\.md$/.test(path)).map(([,bytes]) => strFromU8(bytes));
  assert.equal(roles.length, sources.length);
  assert.deepEqual(preview.resources.filter(resource => resource.kind === 'skill').map(resource => resource.name).sort(),
    sources.map(([,skill]) => skill).sort());
  for (const [roleId,skill,directory] of sources) {
    const pin = graph.nodes.find(node => node.config.bundledSkill === skill);
    assert.ok(pin, skill);
    assert.deepEqual(graph.edges.filter(edge => edge.from === pin.id && edge.input === 'skill').map(edge => edge.to),[roleId]);
    const role = graph.nodes.find(node => node.id === roleId);
    const roleText = roles.find(text => text.split('\n', 1)[0] === '# ' + role?.config.role);
    assert.ok(roleText, roleId);
    assert.deepEqual([...roleText.matchAll(/Skill 지침을 읽고 적용하세요 — (\S+)/g)].map(match => match[1]),
      [`.agents/skills/${skill}/SKILL.md`]);
    const asset = readAsset(user,pin.config.assetId,pin.config.version);
    assert.equal(asset.asset.visibility,'private');
    assert.equal(pin.config.version,1);
    assert.equal(asset.payload.content,readFileSync(join(directory,'SKILL.md'),'utf8'));
    const originals = new Map(sourceFiles(directory).map(path => {
      const bytes = readFileSync(join(directory,path));
      return [path,path.endsWith('.sh') ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n')) : bytes];
    }));
    if (skill === 'test-driven-development') originals.set('LICENSE',readFileSync('vendor/lesson-skills/licenses/superpowers-LICENSE'));
    const bundled = asset.payload.files ?? [];
    assert.deepEqual(bundled.map(file => file.path).sort(), [...originals.keys()].sort());
    const prefix = '.agents/skills/' + skill + '/';
    assert.deepEqual(Object.keys(files).filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length)).sort(), [...originals.keys()].sort());
    for (const {path,data} of bundled) {
      assert.deepEqual(Buffer.from(data,'base64'), originals.get(path), path);
      assert.deepEqual(Buffer.from(files[prefix + path]), originals.get(path), prefix + path);
    }
    if (skill === 'web-artifacts-builder') {
      const upstream = {'scripts/bundle-artifact.sh':'c13d229e0523623a23f979771ccf99ac149c8bfb',
        'scripts/init-artifact.sh':'7d1022d88bec529f00ef385e10ed6084601d710b'};
      for (const [path,hash] of Object.entries(upstream)) {
        const file = files[prefix + path];
        assert.equal(createHash('sha1').update('blob ' + file.length + '\0').update(file).digest('hex'), hash, path);
      }
    }
  }
});
