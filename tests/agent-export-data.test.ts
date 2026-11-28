import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,posix} from 'node:path';
import {strFromU8,unzipSync} from 'fflate';
import {after,test} from 'node:test';
import {connectBlocks,createBlock,type Graph} from '../src/domain';
import {activeExportPreparation} from '../src/domain/agent-export';
import {token} from '../src/engine/session';
import {executeGraph,type Passage} from '../src/engine';
import {prepareAgentExport,previewAgentExport} from '../src/server/agent-export';
import {exportMcp,mcpConfigFiles} from '../src/server/agent-mcp-export';
import {buildAgentZip} from '../src/server/agent-zip';
import {assetShare,createLibraryLookupConnection,readAsset,writeAsset} from '../src/server/assets';
import {authenticate} from '../src/server/auth';
import {db,set} from '../src/server/db';
import {createProject,openProject,projectCopy,saveProject} from '../src/server/projects';
import {resolveWorkflowRefs} from '../src/server/workflow-refs';

const scratch=mkdtempSync(join(tmpdir(),'agent-export-'));
process.env.STUDIO_DATA_DIR=scratch;
after(()=>{db().close();rmSync(scratch,{recursive:true,force:true});});
const account=(name:string)=>authenticate('signup',name,'export-test-passphrase','').user;
const b64=(text:string)=>Buffer.from(text).toString('base64');

test('웹 개발 기초 세 사본의 ZIP에서 해당 실습 단계와 담당자의 원본 Skill을 연다', () => {
  const user = account('portable-inspection-starters');
  const page = 'equipment-inspection-starters.html';
  for (const [lesson,section,skill,directory] of [
    ['equipment-return-inventory','list','frontend-design','.agents/skills'],
    ['equipment-inspection-first','notify','webhook-handler-patterns','vendor/lesson-skills'],
    ['equipment-inspection-compare','check','test-driven-development','.agents/skills'],
  ]) {
    const project = createProject(user,{lesson});
    assert.ok(project.graph,lesson);
    const request = {id:project.id,title:project.title,graph:project.graph};
    const preview = previewAgentExport(user,request);
    const zip = unzipSync(buildAgentZip(prepareAgentExport(user,{...request, previewId:preview.previewId,
      selected:preview.resources.filter(resource=>resource.available).map(resource=>resource.key)})));
    assert.ok(zip[page],lesson);
    assert.ok(strFromU8(zip['README.md']).includes('('+page+'#'+section+')'),lesson);
    assert.deepEqual(preview.resources.filter(resource=>resource.kind==='skill').map(resource=>resource.name),[skill]);
    assert.deepEqual(Buffer.from(zip['.agents/skills/'+skill+'/SKILL.md']),readFileSync(join(directory,skill,'SKILL.md')));
    const pin = project.graph.nodes.find(node=>node.config.bundledSkill===skill);
    assert.ok(pin,skill);
    const {payload} = readAsset(user,pin.config.assetId,pin.config.version);
    for (const file of payload.files ?? []) {
      assert.deepEqual(Buffer.from(zip['.agents/skills/'+skill+'/'+file.path]),Buffer.from(file.data,'base64'),file.path);
    }
  }
});

test('검수 실습 사본의 ZIP에는 외부 계정 없이 여는 HTML과 실행 가능한 HTTP 시험이 들어간다', () => {
  const user = account('portable-inspection');
  for (const lesson of ['equipment-inspection-web', 'equipment-inspection-recovery', 'equipment-return-memo']) {
    const project = createProject(user, {lesson});
    const request = {id:project.id, title:project.title, graph:project.graph};
    const preview = previewAgentExport(user, request);
    const zip = unzipSync(buildAgentZip(prepareAgentExport(user, {...request, previewId:preview.previewId,
      selected:preview.resources.filter(resource => resource.available).map(resource => resource.key)})));
    if (lesson === 'equipment-return-memo') {
      assert.equal(zip['equipment-inspection-starters.html'], undefined);
      assert.equal(zip['equipment-inspection.html'], undefined);
      assert.equal(zip['equipment-inspection-recovery.html'], undefined);
      continue;
    }
    const recovery = lesson === 'equipment-inspection-recovery';
    const page = recovery ? 'equipment-inspection-recovery.html' : 'equipment-inspection.html';
    const script = recovery ? 'inspection-recovery-webhook.test.mjs' : 'inspection-webhook.test.mjs';
    assert.ok(zip[page], '실습용 HTML을 ZIP 루트에서 바로 열 수 있어야 한다');
    assert.match(strFromU8(zip[page]), /검수 알림/);
    if (recovery) {
      const stages = Object.entries(zip).filter(([name])=>name.startsWith('workflow/step-')).map(([,bytes])=>strFromU8(bytes));
      assert.ok(stages.some(body=>body.includes('원본 Skill의 복구 점검 절 갱신') && body.includes('원래 줄바꿈과 앞뒤 내용을 보존')));
    }
    const readme = strFromU8(zip['README.md']);
    assert.ok(readme.includes(page) && readme.includes(script));
    assert.doesNotMatch(readme, /order-management\.html/);
    const work = mkdtempSync(join(scratch,'inspection-'));
    for (const [path, bytes] of Object.entries(zip).filter(([path])=>/^[\w-]+(?:\.test)?\.mjs$/.test(path))) {
      writeFileSync(join(work,path), bytes);
    }
    // Start an independent test runner for the learner's unpacked folder.
    const childEnv = {...process.env};
    delete childEnv.NODE_TEST_CONTEXT;
    const tap = execFileSync(process.execPath, ['--test','--test-reporter=tap',script],
      {cwd:work, env:childEnv, encoding:'utf8', timeout:30000});
    assert.match(tap, recovery ? /# pass 3\b/ : /# pass 1\b/);
  }
});

test('웹 디자인 개선 사본의 ZIP은 단일 응답과 실제 프로젝트에서 수행할 작업을 구분한다',()=>{
  const user = account('web-project-export');
  for (const [lesson, expected] of [
    ['web-design-diagnose', ['소스와 화면 조사']],
    ['web-design-component', ['소스 수정과 화면 검증']],
    ['web-design-flow', ['소스 수정과 화면 검증']],
    ['web-design-shared-ui', ['소스 수정', '화면 검증']],
    ['web-design-single-screen', ['소스와 화면 조사', '소스 수정', '화면 검증']],
    ['web-design-tdd-review', ['실패 테스트부터 수정·재검증', '변경 차이 검토']],
    ['web-design-review-followup', ['실패 테스트부터 수정·재검증', '변경 차이 검토']],
    ['web-design-rollout', ['소스와 화면 조사', '소스 수정', '화면 검증']],
  ] as const) {
    const project = createProject(user, {lesson});
    assert.ok(project.graph);
    const request = {id:project.id, title:project.title, graph:project.graph};
    const preview = previewAgentExport(user, request);
    const pkg = prepareAgentExport(user, {...request, previewId:preview.previewId, selected:preview.resources.map(r=>r.key)});
    const zip = unzipSync(buildAgentZip(pkg));
    assert.match(strFromU8(zip['README.md']), /대상 프로젝트/);
    const stages = Object.entries(zip).filter(([file])=>file === 'AGENTS.md' || file.startsWith('workflow/'))
      .map(([,bytes])=>strFromU8(bytes)).join('\n');
    for (const action of expected) assert.ok(stages.includes('대표 Agent의 프로젝트 작업 · '+action), lesson + ' · ' + action);
    if (lesson === 'web-design-diagnose') assert.doesNotMatch(stages, /대표 Agent의 프로젝트 작업 · 소스 수정/);
    if (lesson === 'web-design-tdd-review' || lesson === 'web-design-review-followup') {
      assert.match(stages, /테스트 하나를 먼저 작성하고 실행[\s\S]*그 실패를 RED로 기록[\s\S]*같은 테스트를 다시 실행[\s\S]*GREEN으로 기록/);
      assert.equal(stages.split('대표 Agent의 프로젝트 작업 · 변경 차이 검토').length - 1, 2);
      assert.match(stages, /읽기 전용[\s\S]*스테이징한 변경, 작업 트리의 변경, 새 파일 내용/);
    }
    if (lesson === 'web-design-review-followup') {
      assert.match(stages, /코딩 규칙만 지적받은 경우[\s\S]*수정 전에 통과[\s\S]*같은 테스트를 다시 실행/);
    }
  }
});

test('한 화면 개선 ZIP의 네 담당자가 맡은 단계의 원본 Skill을 읽을 수 있다', () => {
  const user = account('web-single-screen-export');
  const project = createProject(user, {lesson:'web-design-single-screen'});
  const request = {id:project.id, title:project.title, graph:project.graph};
  const preview = previewAgentExport(user, request);
  const pkg = prepareAgentExport(user, {...request, previewId:preview.previewId, selected:preview.resources.map(r => r.key)});
  const files = unzipSync(buildAgentZip(pkg));
  const roles = Object.entries(files).filter(([path]) => /^agents\/.*\.md$/.test(path)).map(([,bytes]) => strFromU8(bytes));
  const expected: Record<string, string[]> = {
    '시각 디자인 담당':['frontend-design'], '접근성 검토 담당':['frontend-ui-engineering'],
    'UI 개발 담당':['frontend-design', 'frontend-ui-engineering'], '화면 검증 담당':['frontend-ui-engineering'],
  };
  assert.equal(roles.length, Object.keys(expected).length);
  for (const [role, skills] of Object.entries(expected)) {
    const body = roles.find(text => text.split('\n', 1)[0] === '# ' + role);
    assert.ok(body, role);
    const attached = [...body.matchAll(/Skill 지침을 읽고 적용하세요 — \.agents\/skills\/(frontend-[^/]+)\/SKILL\.md/g)].map(match => match[1]);
    assert.deepEqual(attached.sort(), skills, role);
  }
  for (const name of ['frontend-design', 'frontend-ui-engineering']) {
    const path = '.agents/skills/' + name + '/SKILL.md';
    assert.deepEqual(Buffer.from(files[path]), readFileSync(path), path);
  }
});

test('초급 사본에서 수정한 Skill 원문을 선택해 내보내고 같은 템플릿에서 새 사본을 만들 수 있다', () => {
  const user = account('web-skill-copy');
  const lesson = 'web-design-component';
  const project = createProject(user, {lesson});
  assert.ok(project.graph);
  const skill = project.graph.nodes.find(node => node.id === 'skill-component');
  assert.ok(skill);
  const original = String(skill.config.content);
  const edited = original + '\n선택 상태를 색과 글자로 함께 표시한다.';
  skill.config.content = edited;
  const saved = saveProject(user, project);
  const request = {id:saved.id, title:saved.title, graph:saved.graph};
  const preview = previewAgentExport(user, request);
  const selection = preview.resources.find(resource => resource.kind === 'skill' && resource.name === skill.title);
  assert.ok(selection?.available);
  assert.ok(selection.steps.includes('대상 컴포넌트 개선'));
  const archive = (keys: string[]) => unzipSync(buildAgentZip(prepareAgentExport(user, {
    ...request, selected: keys, previewId: preview.previewId,
  })));
  const keys = preview.resources.map(resource => resource.key);
  const included = archive(keys);
  const path = '.agents/skills/web-component-improvement/SKILL.md';
  assert.equal(strFromU8(included[path]), edited);
  const omitted = archive(keys.filter(key => key !== selection.key));
  assert.ok(!omitted[path]);
  const fresh = createProject(user, {lesson});
  assert.equal(fresh.graph?.nodes.find(node => node.id === 'skill-component')?.config.content, original);
});

const originalSkillLessons = [
  {id:'equipment-return-memo', singleTasks:true, packages:[
    {name:'domain-modeling', paths:['SKILL.md', 'ADR-FORMAT.md', 'GLOSSARY-FORMAT.md', 'agents/openai.yaml'], agents:[['memo','용어 후보 메모 작성']]},
  ]},
  {id:'equipment-return-questions', singleTasks:true, packages:[
    {name:'grilling', paths:['SKILL.md', 'agents/openai.yaml'], agents:[['interviewer','학습자에게 확인할 질문 만들기'],['confirm','답변을 되짚고 확인하기'],['handoff','중급에 보낼 질문 정리']]},
  ]},
  {id:'equipment-relending-agreement', packages:[
    {name:'to-questionnaire', paths:['SKILL.md', 'agents/openai.yaml'], agents:[['writer','합의 질문 담당']]},
    {name:'domain-modeling', paths:['SKILL.md', 'ADR-FORMAT.md', 'GLOSSARY-FORMAT.md', 'agents/openai.yaml'], agents:[['modeler','기준 갱신 담당'],['judge','사례 재판정 담당']]},
  ]},
  {id:'equipment-return-cases', packages:[
    {name:'domain-modeling', paths:['SKILL.md', 'ADR-FORMAT.md', 'GLOSSARY-FORMAT.md', 'agents/openai.yaml'], agents:[['judge','사례 판정 담당'],['rejudge','회신 반영 담당']]},
    {name:'to-questionnaire', paths:['SKILL.md', 'agents/openai.yaml'], agents:[['writer','재질문 담당']]},
  ]},
  {id:'equipment-return-terms', packages:[
    {name:'to-questionnaire', paths:['SKILL.md', 'agents/openai.yaml'], agents:[['writer','질문지 작성 담당']]},
    {name:'domain-modeling', paths:['SKILL.md', 'ADR-FORMAT.md', 'GLOSSARY-FORMAT.md', 'agents/openai.yaml'], agents:[['modeler','용어 정리 담당']]},
  ]},
  {id:'web-design-questions', packages:[
    {name:'grilling', paths:['SKILL.md', 'agents/openai.yaml'], agents:[['interviewer','요구사항 확인 담당']]},
    {name:'domain-modeling', paths:['SKILL.md', 'ADR-FORMAT.md', 'GLOSSARY-FORMAT.md', 'agents/openai.yaml'], agents:[['modeler','용어 정리 담당']]},
  ]},
  {id:'web-design-tdd-review', packages:[
    {name:'tdd', paths:['SKILL.md', 'tests.md', 'mocking.md', 'agents/openai.yaml'], agents:[['developer','TDD 개발 담당']]},
    {name:'code-review', paths:['SKILL.md', 'agents/openai.yaml'], agents:[['standards','코딩 규칙 검토 담당'], ['spec','개선 기준 검토 담당']]},
  ]},
  {id:'web-design-review-followup', packages:[
    {name:'tdd', paths:['SKILL.md', 'tests.md', 'mocking.md', 'agents/openai.yaml'], agents:[['developer','TDD 수정 담당']]},
    {name:'code-review', paths:['SKILL.md', 'agents/openai.yaml'], agents:[['standards','코딩 규칙 재검토 담당'], ['spec','개선 기준 재검토 담당']]},
  ]},
] as const;

for (const lesson of originalSkillLessons) test(lesson.id + ' 사본과 ZIP에는 각 담당자에게 배정한 원본 Skill 패키지가 들어간다', () => {
  const user = account(lesson.id);
  const project = createProject(user, {lesson:lesson.id});
  assert.ok(project.graph);
  const graph: Graph = project.graph;
  const request = {id:project.id, title:project.title, graph};
  const preview = previewAgentExport(user, request);
  const pkg = prepareAgentExport(user, {...request, previewId:preview.previewId, selected:preview.resources.map(r => r.key)});
  const files = unzipSync(buildAgentZip(pkg));
  const roles = Object.entries(files).filter(([path]) => /^agents\/.*\.md$/.test(path)).map(([,bytes]) => strFromU8(bytes));
  const singleTasks = 'singleTasks' in lesson;
  const stages = Object.entries(files).filter(([path]) => path === 'AGENTS.md' || /^workflow\/step-.*\.md$/.test(path))
    .flatMap(([,bytes]) => strFromU8(bytes).split(/^### /m));
  assert.equal(roles.length, singleTasks ? 0 : lesson.packages.reduce((total, pkg) => total + pkg.agents.length, 0));
  assert.deepEqual(preview.resources.filter(r => r.kind === 'skill').map(r => r.name).sort(), lesson.packages.map(p => p.name).sort());
  for (const {name:skill, paths, agents} of lesson.packages) {
    const pin = graph.nodes.find(node => node.config.bundledSkill === skill);
    assert.ok(pin, skill);
    const targets = graph.edges.filter(edge => edge.from === pin.id && edge.kind === 'reference' && edge.input === 'skill').map(edge => edge.to);
    assert.deepEqual(targets.sort(), agents.map(([id]) => id).sort());
    assert.equal(pin.config.version, 1);
    const installed = readAsset(user, pin.config.assetId, pin.config.version);
    const bundle = installed.payload.files;
    assert.ok(bundle);
    assert.deepEqual(bundle.map(file => file.path).sort(), [...paths].sort());
    for (const [id, role] of agents) {
      const body = singleTasks
        ? stages.find(stage => stage.split('\n').includes('AI 한 번 작업 · ' + id))
        : roles.find(text => text.split('\n', 1)[0] === '# ' + role);
      assert.ok(body, role);
      const instructions = [...body.matchAll(/Skill 지침을 읽고 적용하세요 — (\.agents\/skills\/[^/]+\/SKILL\.md)/g)];
      assert.deepEqual(instructions.map(match => match[1]), ['.agents/skills/' + skill + '/SKILL.md']);
    }
    for (const file of bundle) {
      const path = '.agents/skills/' + skill + '/' + file.path;
      const expected = readFileSync(path);
      assert.deepEqual(Buffer.from(file.data, 'base64'), expected, path);
      assert.deepEqual(Buffer.from(files[path]), expected, path);
    }
  }
});

test('주제가 달라도 같은 원본 판을 재사용하고 기존 설계의 수정된 Skill 연결을 보존한다', () => {
  const user = account('cross-topic-skill-copy');
  const skill = (graph: Graph) => {
    const node = graph.nodes.find(n => n.config.bundledSkill === 'domain-modeling');
    assert.ok(node);
    return node;
  };
  const web = createProject(user, {lesson:'web-design-questions'});
  const lesson = 'equipment-return-terms';
  const equipment = createProject(user, {lesson});
  const graph = equipment.graph!;
  const model = skill(graph);
  assert.equal(model.config.assetId, skill(web.graph!).config.assetId);
  const edited = writeAsset(user, {id:model.config.assetId, baseVersion:1, name:'업무 용어 정리', payload:{content:'우리 팀 용어집 작성법'}});
  model.config.version = edited.version;
  const copy = createProject(user, {lesson, graph});
  assert.equal(skill(copy.graph!).config.version, edited.version);
  const duplicated = projectCopy(user,{id:copy.id});
  const copiedModel = duplicated.graph!.nodes.find(node => node.id === model.id)!;
  assert.equal(copiedModel.config.version, 1);
  assert.equal(copiedModel.config.bundledSkill, undefined);
  assert.equal(duplicated.graph!.nodes.find(node => node.id === 'skill-to-questionnaire')?.config.bundledSkill, 'to-questionnaire');
  const fresh = createProject(user, {lesson});
  assert.equal(skill(fresh.graph!).config.version, 1);
});

test('전문가 ZIP에는 담당자별 원본 Skill과 선택한 패키지의 부속 파일이 들어간다', () => {
  const user = account('web-skill-roles');
  const project = createProject(user, {lesson:'web-design-rollout'});
  const request = {id:project.id, title:project.title, graph:project.graph};
  const preview = previewAgentExport(user, request);
  const pkg = prepareAgentExport(user, {...request, previewId:preview.previewId, selected:preview.resources.map(r => r.key)});
  const files = unzipSync(buildAgentZip(pkg));
  const roles = Object.entries(files).filter(([name]) => /^agents\/.*\.md$/.test(name)).map(([,bytes]) => strFromU8(bytes));
  assert.equal(roles.length, 3);
  assert.equal(Object.keys(files).filter(path => /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(path)).length, 5);
  const originals = {
    'frontend-design': ['SKILL.md', 'LICENSE.txt'],
    'frontend-ui-engineering': ['SKILL.md', 'references/shared/accessibility-checklist.md'],
  };
  for (const [name, paths] of Object.entries(originals)) {
    const resource = preview.resources.find(r => r.kind === 'skill' && r.name === name);
    assert.ok(resource?.available, name);
    const selected = preview.resources.filter(r => r.key !== resource.key).map(r => r.key);
    const omitted = unzipSync(buildAgentZip(prepareAgentExport(user, {...request, previewId:preview.previewId, selected})));
    for (const relative of paths) {
      const path = '.agents/skills/' + name + '/' + relative;
      assert.deepEqual(Buffer.from(files[path]), readFileSync(path), path);
      assert.ok(!omitted[path], path);
    }
  }
  for (const role of roles) {
    const names = [...role.matchAll(/Skill 지침을 읽고 적용하세요 — \.agents\/skills\/([^/]+)\/SKILL\.md/g)].map(match => match[1]);
    const expected = role.startsWith('# 화면 개편 개발자')
      ? ['web-shared-ui', 'frontend-design', 'frontend-ui-engineering']
      : ['web-screen-verification', 'frontend-ui-engineering'];
    assert.deepEqual(names.sort(), expected.sort(), role.split('\n')[0]);
  }
});

test('웹 실습은 같은 계정의 원본 Skill 판을 재사용하고 다른 계정에는 사유 사본을 연결한다', () => {
  const owner = account('web-original-owner');
  const another = account('web-original-another');
  const findPin = (user: typeof owner, lesson: string) => {
    const project = createProject(user, {lesson});
    const node = project.graph?.nodes.find(n => n.config.bundledSkill === 'frontend-ui-engineering');
    assert.ok(node);
    return {id:String(node.config.assetId), version:Number(node.config.version)};
  };
  const pin = findPin(owner, 'web-design-component');
  const installed = readAsset(owner, pin.id, pin.version);
  assert.equal(installed.asset.visibility, 'private');
  assert.equal(installed.payload.content, readFileSync('.agents/skills/frontend-ui-engineering/SKILL.md', 'utf8'));
  writeAsset(owner, {id:pin.id, baseVersion:pin.version, name:'내가 수정한 지침', payload:{content:'개인 작업 지침'}});
  assert.deepEqual(findPin(owner, 'web-design-flow'), pin);
  assert.notEqual(findPin(another, 'web-design-component').id, pin.id);
  assert.throws(() => readAsset(another, pin.id, pin.version));
});

test('등록 자료와 직접 입력 원문의 1판을 7판 색인에서 찾아 등록 자료의 assetId만 읽는다',async()=>{
  const user=account('index-edition'),project=createProject(user,{title:'원문 판'});
  const asset=writeAsset(user,{name:'원문',kind:'document',payload:{content:'반납 기한'}});
  for(const registered of [true,false]){
    const graph:Graph={nodes:[createBlock('input.user_request',{id:'in'}),createBlock('knowledge.manage',{id:'index',config:{operation:'index',version:'7'}}),
      createBlock('knowledge.search',{id:'search',config:{query:'반납'}}),createBlock('data.transform',{id:'pick',config:{operation:'select',path:'0.assetId'}}),
      createBlock('output.answer',{id:'out'}),createBlock('resource.context',{id:'source',title:'원문',config:{version:'1',...(registered?{assetId:asset.id}:{content:'반납 기한'})}})],edges:[]};
    for(const [from,to] of [['in','index'],['index','search'],['search','pick'],['pick','out'],['source','index']])
      graph.edges.push(...connectBlocks(graph,from,to));
    const result=await executeGraph(graph,{runId:'index-'+registered,input:'반납'},{asset:async()=>({id:asset.id,title:'원문',version:'1',content:'반납 기한'}),
      model:async()=>{throw Error('unexpected model');},tool:async()=>{throw Error('unexpected tool');}});
    const passage=(result.checkpoint.steps['root/search'].values.value as Passage[])[0];
    assert.deepEqual([passage.id,passage.version,passage.indexVersion,passage.assetId],[registered?asset.id:'source','1','7',registered?asset.id:undefined]);
    if(registered){assert.equal(result.status,'completed',result.error??'');assert.equal(result.output,asset.id);}
    else{assert.equal(result.status,'failed');assert.match(result.error??'',/0.assetId/);}
    for(const split of [false,true]){
      if(split)graph.agentScope={mode:'dedicated',purpose:'원문 확인 '.repeat(1800)};
      const req={id:project.id,title:'원문',graph},preview=previewAgentExport(user,req);
      const zip=unzipSync(buildAgentZip(prepareAgentExport(user,{...req,previewId:preview.previewId,selected:preview.resources.filter(r=>r.available).map(r=>r.key)})));
      const instructions=Object.values(zip).map(bytes=>strFromU8(bytes)).join('\n');
      assert.ok(instructions.includes('indexVersion')&&instructions.includes('원문 판 version'));
      assert.equal(instructions.includes('assetId='+JSON.stringify(asset.id)),registered);
    }
  }
});

test('비밀 인자의 실제 값은 환경에서 채우고 연결된 요청식과 인자 필드는 두 ZIP 배치에 보존한다',()=>{
  const user=account('secret-placeholders'),project=createProject(user,{title:'승인'});
  const graph:Graph={nodes:[createBlock('approval.action',{id:'approve',title:'변경 승인',config:{tool:'write',
    args:{query:'page',filter:{token:'test-sensitive-value',password:'{{input.pass}}'}}}})],edges:[]};
  for(const split of [false,true]){
    if(split)graph.agentScope={mode:'dedicated',purpose:'변경 승인 '.repeat(1800)};
    const req={id:project.id,title:'승인',graph},preview=previewAgentExport(user,req);
    const pkg=prepareAgentExport(user,{...req,previewId:preview.previewId,selected:[]});
    assert.deepEqual(pkg.graph.nodes[0].config.args,{query:'page',filter:{token:'<실행 환경에서 입력>',password:'{{input.pass}}'}});
    const zip=unzipSync(buildAgentZip(pkg)),texts=Object.values(zip).map(bytes=>strFromU8(bytes)).join('\n');
    assert.ok(!texts.includes('test-sensitive-value')&&texts.includes('{{input.pass}}'));
    assert.ok(strFromU8(zip['README.md']).includes('filter.token'));
    assert.ok(!strFromU8(zip['README.md']).includes('filter.password'));
  }
});

test('두 ZIP 배치에서 원문 링크와 Skill 이름을 보존하고 사용 단계에 누락 부속 파일을 표시한다',()=>{
  const user=account('material-links'),p=createProject(user,{title:'자료'});
  const body='---\nname: check-edition\ndescription: 판 확인\n---\n[예시](references/yes.md) [양식](references/missing.md)';
  const skill=writeAsset(user,{name:'Department guide',kind:'skill',payload:{files:[
    {path:'SKILL.md',data:b64(body)},{path:'references/yes.md',data:b64('예시')},
  ]}});
  const graph:Graph={nodes:[createBlock('input.user_request',{id:'q'}),createBlock('ai.single_task',{id:'a',title:'검토',config:{goal:'자료를 읽기'}}),
    createBlock('ai.single_task',{id:'b',title:'검토',config:{goal:'확인'}}),createBlock('output.answer',{id:'out'}),
    createBlock('resource.context',{id:'g',title:'Guide.md',config:{content:'[부록](appendix.md#day)'}}),
    createBlock('resource.context',{id:'d',title:'appendix.md',config:{content:'# Day'}}),
    createBlock('resource.context',{id:'d1',title:'규정',config:{content:'월요일'}}),
    createBlock('resource.context',{id:'d2',title:'규정',config:{content:'금요일'}}),
    createBlock('instruction.skill',{id:'s',config:{assetId:skill.id,version:1}})],edges:[]};
  for(const [from,to] of [['q','a'],['a','b'],['b','out'],['s','b'],['g','a'],['d','b'],['d1','a'],['d2','b']]){
    graph.edges.push(...connectBlocks(graph,from,to));
  }
  for(const split of [false,true]){
    if(split)graph.agentScope={mode:'dedicated',purpose:'자료 업무 '.repeat(1800)};
    const req={id:p.id,title:'자료',graph},preview=previewAgentExport(user,req);
    const rules=preview.resources.filter(r=>r.name==='규정');
    assert.ok(rules[0].steps.includes('검토 (1)')&&rules[1].steps.includes('검토 (2)'));
    const guide=preview.resources.find(r=>r.name==='Guide.md')!,appendix=preview.resources.find(r=>r.name==='appendix.md')!;
    const keys=preview.resources.map(r=>r.key);
    const archive=(selected:string[])=>{
      const pkg=prepareAgentExport(user,{...req,selected,previewId:preview.previewId});
      return {pkg,zip:unzipSync(buildAgentZip(pkg)),prep:activeExportPreparation(preview.preparation,selected)};
    };
    const all=archive(keys);
    assert.equal(Boolean(all.zip['workflow/index.md']),split);
    const guidePath=all.pkg.resources.find(r=>r.key===guide.key)!.files[0];
    assert.equal(strFromU8(all.zip[guidePath]),'[부록](appendix.md#day)');
    assert.equal(strFromU8(all.zip[posix.join(posix.dirname(guidePath),'appendix.md')]),'# Day');
    assert.ok(all.zip['.agents/skills/check-edition/references/yes.md']);
    assert.ok(all.prep.some(x=>x.step==='검토 (2)'&&x.action.includes('references/missing.md')));
    assert.ok(!all.prep.some(x=>x.action.includes('appendix.md')||x.action.includes('references/yes.md')));
    const except=archive(keys.filter(k=>k!==appendix.key&&k!==preview.resources.find(r=>r.kind==='skill')!.key));
    assert.ok(except.prep.some(x=>x.step==='검토 (1)'&&x.action.includes('appendix.md')));
    assert.ok(!except.prep.some(x=>x.action.includes('references/missing.md')));
    assert.ok(!except.zip['.agents/skills/check-edition/SKILL.md']);
    assert.ok(Object.values(except.zip).some(bytes=>strFromU8(bytes).includes('.agents/skills/check-edition/SKILL.md')));
  }
});

test('중첩 폴더와 한글·공백 파일 링크는 원문 그대로 열리고 대소문자 오류와 누락은 소비 단계에 표시된다',()=>{
  const user=account('nested-file-links'),project=createProject(user,{title:'부속 문서'});
  const annotated='[부록](../%EC%9E%90%EB%A3%8C%20%EB%AA%A8%EC%9D%8C/Appendix.MD#part)\r\n'+
    '[철자](<../자료 모음/appendix.md>) [누락](<누락 파일.md>)\r\n`[예시](fake.md)`';
  const graph:Graph={nodes:[createBlock('resource.context',{id:'guide',title:'manual/지침/Guide.md',config:{content:annotated}}),
    createBlock('resource.context',{id:'note',title:'manual/자료 모음/Appendix.MD',config:{content:'# part'}}),
    createBlock('ai.single_task',{id:'check',title:'서식 확인',config:{goal:'파일을 확인'}})],edges:[]};
  graph.edges.push(...connectBlocks(graph,'guide','check'));
  for(const split of [false,true]){
    if(split)graph.agentScope={mode:'dedicated',purpose:'부속 문서 '.repeat(1800)};
    const req={id:project.id,title:'부속 문서',graph},preview=previewAgentExport(user,req);
    const keys=preview.resources.map(r=>r.key),guide=preview.resources.find(r=>r.name.endsWith('Guide.md'))!;
    const pkg=prepareAgentExport(user,{...req,selected:keys,previewId:preview.previewId}),zip=unzipSync(buildAgentZip(pkg));
    const path=pkg.resources.find(r=>r.key===guide.key)!.files[0];
    assert.equal(strFromU8(zip[path]),annotated);
    const relative=decodeURIComponent(annotated.match(/\[부록\]\(([^#]+)/)![1]);
    assert.equal(strFromU8(zip[posix.join(posix.dirname(path),relative)]),'# part');
    const links=(selected:string[])=>activeExportPreparation(preview.preparation,selected).filter(x=>x.reason.includes('로컬 파일'));
    assert.equal(links(keys).length,2);
    assert.ok(links(keys).every(x=>x.step==='서식 확인'));
    assert.ok(links(keys).some(x=>x.action.includes('appendix.md')&&x.action.includes('Appendix.MD')));
    assert.ok(links(keys).some(x=>x.action.includes('누락 파일.md')));
    assert.equal(links([guide.key]).length,3);
    assert.equal(links(keys.filter(k=>k!==guide.key)).length,0);
  }
});

test('draft exports preserve a broken connection and recursive call as actionable preparation in the preview and README',()=>{
  const owner=account('unfinished-export'), project=createProject(owner,{title:'작성 중'});
  const graph:Graph={nodes:[
    createBlock('input.user_request',{id:'start',title:'문의 접수'}),
    createBlock('workflow.call',{id:'cycle',title:'자기 설계 호출',config:{workflowId:project.id}}),
  ],edges:[{id:'broken',from:'start',to:'missing',out:'next',input:'in',kind:'flow'}]};
  const request={id:project.id,title:'',graph};
  assert.throws(()=>resolveWorkflowRefs(graph,owner,project.id,{expand:true,onUnavailable:()=>assert.fail()}),{status:422});
  const preview=previewAgentExport(owner,request);
  const expected=activeExportPreparation(preview.preparation,[]);
  assert.ok(expected.some(item=>item.step==='문의 접수'&&item.reason.includes('연결할 블록')));
  assert.ok(expected.some(item=>item.step==='자기 설계 호출'&&item.reason.includes('상위 Workflow')));
  assert.ok(expected.every(item=>item.action&&item.reason));
  const pkg=prepareAgentExport(owner,{...request,selected:[],previewId:preview.previewId});
  const zip=unzipSync(buildAgentZip(pkg));
  const readme=strFromU8(zip['README.md']);
  for(const item of expected) assert.ok(readme.includes(item.step)&&readme.includes(item.action)&&readme.includes(item.reason));
  assert.ok(!readme.includes(project.id));
  assert.ok(zip['AGENTS.md']);
});

test('a complete question-to-answer graph exports without a preparation notice',()=>{
  const owner=account('ready-export'), project=createProject(owner,{title:'응답'});
  const graph:Graph={nodes:[createBlock('input.user_request',{id:'start'}),createBlock('output.answer',{id:'out'})],edges:[
    {id:'flow',from:'start',to:'out',out:'next',input:'in',kind:'flow'},
    {id:'data',from:'start',to:'out',out:'value',input:'input',kind:'data'},
  ]};
  const request={id:project.id,title:'바로 응답',graph}, preview=previewAgentExport(owner,request);
  assert.deepEqual(preview.preparation,[]);
  const zip=unzipSync(buildAgentZip(prepareAgentExport(owner,{...request,selected:[],previewId:preview.previewId})));
  assert.doesNotMatch(strFromU8(zip['README.md']),/## 실행 준비/);
});

test('preparation checks the resolved MCP edition and keeps missing tool names out of the ZIP',()=>{
  const owner=account('readiness-mcp-version'), project=createProject(owner,{title:'도구 준비'});
  const connection=createLibraryLookupConnection(owner,'도서관');
  const tool=createBlock('tool.invoke',{id:'lookup',title:'예약 확인',config:{tool:'mcp.'+connection.id+'.reservations.list'}});
  const graph:Graph={nodes:[
    createBlock('input.user_request',{id:'start'}),tool,createBlock('output.answer',{id:'out'}),
    createBlock('connection.mcp',{id:'mcp',config:{assetId:connection.id,version:''}}),
  ],edges:[
    {id:'start',from:'start',to:'lookup',kind:'flow',out:'next',input:'in'},
    {id:'input',from:'start',to:'lookup',kind:'data',out:'value',input:'input'},
    {id:'done',from:'lookup',to:'out',kind:'flow',out:'next',input:'in'},
    {id:'output',from:'lookup',to:'out',kind:'data',out:'value',input:'input'},
    {id:'pin',from:'mcp',to:'lookup',kind:'reference',out:'ref',input:'mcp'},
  ]};
  const request={id:project.id,title:'도구 준비',graph};
  const good=previewAgentExport(owner,request);
  assert.ok(!good.preparation.some(item=>!item.when&&item.step==='예약 확인'));
  tool.config.tool='mcp.'+connection.id+'.missing-private-operation';
  const bad=previewAgentExport(owner,request);
  const issue=bad.preparation.find(item=>!item.when&&item.step==='예약 확인');
  assert.ok(issue);
  const zip=unzipSync(buildAgentZip(prepareAgentExport(owner,{...request,previewId:bad.previewId,selected:[]})));
  const readme=strFromU8(zip['README.md']);
  assert.ok(readme.includes(issue.reason));
  assert.ok(!readme.includes(connection.id)&&!readme.includes('missing-private-operation'));
});

test('export rechecks pinned MCP access and emits host settings for selected remote editions only',()=>{
  const owner=account('mcp-export-owner'),peer=account('mcp-export-peer');
  const project=createProject(peer,{title:'선택한 MCP'});
  const oldAdmins=process.env.STUDIO_ADMIN_IDS;
  process.env.STUDIO_ADMIN_IDS=owner.id;
  const remote=(name:string,url:string,tool:string)=>writeAsset(owner,{name,kind:'mcp',
    payload:{url,tools:[tool],testUrl:'http://localhost:45100/test-only',credentialEnv:'STUDIO_CONNECTOR_OWNER_SETTING'}});
  try{
    const pub=remote('Catalog','https://catalog.example.org/mcp','catalog.lookup');
    const omitted=remote('Catalog','https://omitted.example.org/mcp','tool.omitted');
    const local=remote('LAN','http://192.168.1.41/mcp','inventory.read');
    const denied=remote('Private asset','https://denied.example.org/mcp','tool.secret');
    const builtin=createLibraryLookupConnection(peer,'도서관');
    for(const asset of [pub,omitted,local])assetShare(owner,asset.id,'public',false,1);
    const mcp=(id:string,assetId:string)=>createBlock('connection.mcp',{id,config:{assetId,version:1}});
    const graph={nodes:[mcp('one',pub.id),mcp('duplicate',pub.id),mcp('omit',omitted.id),mcp('private',denied.id),
      mcp('lan',local.id),mcp('builtin',builtin.id),createBlock('connection.mcp',{id:'named',config:{server:'library'}})],edges:[]};
    const request={id:project.id,title:'선택한 MCP',graph};
    const {resources,previewId}=previewAgentExport(peer,request);
    assert.equal(resources.length,6);
    const picked=resources.find(r=>r.mcpUrl==='https://catalog.example.org/mcp')!;
    assert.equal(picked.mcpMode,'remote');
    assert.equal(resources.filter(r=>r.mcpMode==='manual'&&r.available).length,3);
    assert.doesNotMatch(JSON.stringify(resources),/STUDIO_CONNECTOR|localhost|192\.168|denied\.example|test-only|tool\.secret/);
    const selected=[picked.key,...resources.filter(r=>r.mcpMode==='manual').map(r=>r.key)];
    const decisions={...request,previewId,selected};
    const pkg=prepareAgentExport(peer,decisions);
    assert.deepEqual(pkg.files,[]);
    assert.doesNotMatch(JSON.stringify(pkg),/omitted\.example|tool\.omitted|192\.168|STUDIO_CONNECTOR|test-only|denied\.example/);
    const {id,tokenEnv}=pkg.resources.find(r=>r.key===picked.key)!.mcp!;
    assert.match(tokenEnv!,/^MCP_[A-Z0-9_]+_TOKEN$/);
    assert.deepEqual(pkg.resources.find(r=>r.name==='도서관')!.mcp!.tools,['reservations.list']);
    const config=mcpConfigFiles(pkg.resources);
    assert.deepEqual(Object.keys(config).sort(),['.codex/config.toml','.mcp.json','opencode.json']);
    const claude=JSON.parse(config['.mcp.json']).mcpServers,opencode=JSON.parse(config['opencode.json']).mcp;
    assert.deepEqual(Object.keys(claude),[id]);
    assert.deepEqual(claude[id],{type:'http',url:picked.mcpUrl,headers:{Authorization:'Bearer $'+'{'+tokenEnv+'}'}});
    assert.deepEqual(Object.keys(opencode),[id]);
    assert.deepEqual(opencode[id],{type:'remote',url:picked.mcpUrl,oauth:false,headers:{Authorization:'Bearer {env:'+tokenEnv+'}'}});
    assert.ok(config['.codex/config.toml'].includes('url = "'+picked.mcpUrl+'"'));
    assert.ok(config['.codex/config.toml'].includes('bearer_token_env_var = "'+tokenEnv+'"'));
    assert.ok(config['.codex/config.toml'].includes('enabled_tools = ["catalog.lookup"]'));
    assert.deepEqual(mcpConfigFiles(prepareAgentExport(peer,{...decisions,selected:[]}).resources),{});
    const archive=unzipSync(buildAgentZip(pkg));
    for(const [path,expected] of Object.entries(config))assert.equal(strFromU8(archive[path]),expected);
    const text=Object.values(archive).map(bytes=>strFromU8(bytes)).join('\n');
    assert.doesNotMatch(text,/omitted\.example|tool\.omitted|denied\.example|tool\.secret|STUDIO_CONNECTOR|test-only|192\.168|localhost/);
    assert.match(strFromU8(archive['README.md']),/inventory\.read/);
    assetShare(owner,pub.id,'private',false);
    assert.throws(()=>prepareAgentExport(peer,decisions),{status:409});
  }finally{
    if(oldAdmins===undefined)delete process.env.STUDIO_ADMIN_IDS;
    else process.env.STUDIO_ADMIN_IDS=oldAdmins;
  }
});

test('machine-local MCP endpoints and URLs containing credentials are manual connections',()=>{
  for(const url of [
    'http://localhost:4490/mcp','http://host.localhost/mcp','http://host.local/mcp','http://mcp-server/mcp',
    'http://[::1]/mcp','http://[fc00::1]/mcp','http://[::ffff:127.0.0.1]/mcp','http://127.1/mcp',
    'http://169.254.169.254/mcp','http://172.16.33.7/mcp','http://100.64.0.1/mcp',
    'https://mcp.example.org/source?token=secret','https://user:secret@mcp.example.org/mcp',
  ]){
    const mcp=exportMcp('r-123456789abc','외부 조회',{content:'',url,tools:['read'],credentialEnv:'STUDIO_CONNECTOR_PRIVATE'});
    assert.deepEqual(mcp,{id:'mcp-123456789abc',tools:['read'],tokenEnv:'MCP_MCP_123456789ABC_TOKEN'},url);
  }
  const connection=exportMcp('r-123456789abc','공개 조회',{content:'',url:'https://mcp.example.org',tools:['search']});
  assert.deepEqual(connection,{id:'mcp-123456789abc',url:'https://mcp.example.org/',tools:['search']});
});

test('current canvas and pinned editions export only the selected originals and safe Skill paths',()=>{
  const user=account('agent-export-data');
  const project=createProject(user,{title:'저장한 설계'});
  const skill=writeAsset(user,{name:'작성법',kind:'skill',payload:{files:[
    {path:'SKILL.md',data:b64('# 판 1')},{path:'examples/example.txt',data:b64('예시')},{path:'.env',data:b64('비밀 설정')},
  ]}});
  writeAsset(user,{id:skill.id,baseVersion:1,name:'다른 이름',payload:{content:'# 판 2'}});
  const child={nodes:[createBlock('instruction.skill',{id:'skill',config:{assetId:skill.id,version:1,assetGrant:'secret-grant'}})],edges:[]};
  const graph={nodes:[
    createBlock('agent.team',{id:'team',title:'검토팀',graph:child}),
    createBlock('resource.context',{id:'source',title:'내부 규정',config:{content:'공유하지 않는 원문'}}),
    createBlock('file.input',{id:'file',config:{content:'공유하지 않는 시험 파일'}}),
    createBlock('tool.invoke',{id:'tool',config:{args:{authorization:'secret-header',book:'A'}}}),
    createBlock('quality.validate',{id:'schema',config:{types:{password:'string'}}}),
  ],edges:[]};
  const request={id:project.id,title:'지금 캔버스',graph};
  const {resources,previewId}=previewAgentExport(user,request);
  assert.equal(resources.length,3);
  assert.doesNotMatch(JSON.stringify(resources),/공유하지 않는|secret-|판 1/);
  const picked=resources.find(r=>r.kind==='skill')!;
  assert.equal(picked.version,'1');
  assert.deepEqual(picked.steps,['검토팀 › 작업 지침·Skill']);
  const pkg=prepareAgentExport(user,{...request,previewId,selected:[picked.key]});
  assert.equal(pkg.title,'지금 캔버스');
  assert.deepEqual(pkg.files.map(f=>f.path),['resources/'+picked.key+'/SKILL.md','resources/'+picked.key+'/examples/example.txt']);
  assert.equal(Buffer.from(pkg.files[0].data,'base64').toString(),'# 판 1');
  assert.doesNotMatch(JSON.stringify(pkg),/공유하지 않는|secret-|\.env|assetGrant/);
  assert.deepEqual(pkg.graph.nodes[4].config.types,{password:'string'});
  assert.equal(openProject(user,project.id).graph!.nodes.length,0);
  assert.throws(()=>prepareAgentExport(user,{...request,selected:['bogus']}),{status:409});
});

test('read permissions are checked per pinned child and material again at download',()=>{
  const who=account('agent-export-owner'),peer=account('agent-export-peer');
  const root=createProject(who,{title:'부모'}),privateChild=createProject(peer,{title:'닫힌 Agent'});
  const doc=writeAsset(peer,{kind:'document',name:'공유 자료',payload:{content:'외부 원문'}});
  const share=assetShare(peer,doc.id,'link',false,1);
  const graph={nodes:[
    createBlock('resource.context',{id:'linked',config:{assetId:doc.id,version:1,assetGrant:share.token}}),
    createBlock('workflow.call',{id:'nested',config:{workflowId:privateChild.id,version:1},graph:{
      nodes:[createBlock('resource.context',{id:'fake',config:{content:'옛 사본'}})],edges:[],
    }}),
  ],edges:[]};
  const request={id:root.id,title:'부모',graph},preview=previewAgentExport(who,request);
  const selected=preview.resources.filter(r=>r.available).map(r=>r.key);
  assert.equal(selected.length,1);
  assert.equal(preview.resources.find(r=>r.kind==='workflow')?.available,false);
  const pkg=prepareAgentExport(who,{...request,previewId:preview.previewId,selected});
  assert.equal(pkg.graph.nodes[1].graph,undefined);
  assert.match(pkg.resources.find(r=>r.kind==='workflow')!.files[0],/^resources\/[^/]+\/AGENTS\.md$/);
  assert.doesNotMatch(JSON.stringify(pkg),/옛 사본/);
  assert.throws(()=>previewAgentExport(peer,request),{status:403});
  assetShare(peer,doc.id,'private',false);
  assert.throws(()=>prepareAgentExport(who,{...request,previewId:preview.previewId,selected}),{status:409});
  const omitted=prepareAgentExport(who,{...request,previewId:previewAgentExport(who,request).previewId,selected:[]});
  assert.equal(omitted.files.length,0);
  assert.doesNotMatch(JSON.stringify(omitted),/외부 원문|공유 자료|옛 사본/);
});

test('linked Workflow exports its pinned edition and missing collections identify steps to reconnect',()=>{
  const user=account('agent-export-child');
  const root=createProject(user,{title:'부모'}),child=createProject(user,{title:'하위 설계'});
  for(const version of [1,2]){
    const childGraph={nodes:[createBlock('resource.context',{id:'doc',title:'하위 자료',config:{content:'하위 원문 '+version}})],edges:[]};
    set('INSERT INTO versions(project,number,title,graph,created) VALUES(?,?,?,?,?)',child.id,version,'하위 설계',JSON.stringify(childGraph),new Date().toISOString());
  }
  const graph={nodes:[
    createBlock('workflow.call',{id:'nested',title:'하위 호출',config:{workflowId:child.id,version:1}}),
    createBlock('knowledge.search',{id:'external',title:'외부 자료 검색',config:{storeKey:'외부 자료집',version:'1'}}),
    createBlock('knowledge.search',{id:'internal',config:{storeKey:'생성할 자료집',version:'1'}}),
    createBlock('knowledge.manage',{id:'publish',config:{operation:'publish',storeKey:'생성할 자료집',version:'1'}}),
    createBlock('knowledge.manage',{id:'index',config:{operation:'index',storeKey:'생성할 자료집',version:'1'}}),
  ],edges:[]};
  const request={id:root.id,title:'부모',graph};
  const preview=previewAgentExport(user,request);
  assert.equal(preview.resources.length,4);
  const selected=preview.resources.filter(r=>r.available).map(r=>r.key);
  const pkg=prepareAgentExport(user,{...request,previewId:preview.previewId,selected});
  assert.equal(pkg.graph.nodes[0].config.workflowId,undefined);
  assert.equal(pkg.graph.nodes[0].graph?.nodes[0].config.exportResource,selected[0]);
  assert.equal(Buffer.from(pkg.files[0].data,'base64').toString(),'하위 원문 1');
  assert.deepEqual(pkg.graph.nodes[1].config.exportCollection,[pkg.resources.find(r=>r.name==='외부 자료집')!.key]);
  assert.equal(pkg.graph.nodes[2].config.exportCollection.length,1);
  assert.equal(pkg.graph.nodes[3].config.exportIndex.length,1);
  const connected={...graph,edges:[
    {id:'indexed',kind:'flow' as const,from:'index',to:'publish',out:'next',input:'in'},
    {id:'published',kind:'flow' as const,from:'publish',to:'internal',out:'next',input:'in'},
  ]};
  const ordered=previewAgentExport(user,{...request,graph:connected});
  assert.equal(ordered.resources.length,2);
});

test('published collection and direct references share one selection and enforce source permissions',()=>{
  const user=account('agent-export-rag'),other=account('agent-export-rag-peer');
  const p=createProject(user,{title:'RAG'});
  const asset=writeAsset(other,{name:'규정',kind:'document',payload:{content:'원본 판'}});
  const share=assetShare(other,asset.id,'link',false,1);
  const docs=[{id:asset.id,assetId:asset.id,title:'규정',version:'1',content:'원본 판'}];
  const hash='snapshot-edition',prefix='knowledge:'+token('규정집')+':';
  function store(key:string,value:string){
    set('INSERT INTO memory VALUES (?,?,?,?,?)',user.id,p.id,'live',prefix+key,value);
  }
  store('release:1',hash);
  store('snapshot:'+hash,JSON.stringify({documents:docs,version:'1',index:[]}));
  store('sources:'+hash,JSON.stringify([{assetId:asset.id,version:'1',assetGrant:share.token}]));
  const graph={nodes:[
    createBlock('knowledge.search',{id:'lookup',config:{storeKey:'규정집',version:'1'}}),
    createBlock('resource.context',{id:'doc',config:{assetId:asset.id,assetGrant:share.token,version:1}}),
  ],edges:[]};
  const request={id:p.id,title:'RAG',graph};
  const {resources,previewId}=previewAgentExport(user,request);
  assert.equal(resources.length,1);
  const pkg=prepareAgentExport(user,{...request,previewId,selected:[resources[0].key]});
  assert.deepEqual(pkg.graph.nodes[0].config.exportCollection,[pkg.graph.nodes[1].config.exportResource]);
  assert.equal(pkg.files.length,1);
  const instructions=strFromU8(unzipSync(buildAgentZip(pkg))['AGENTS.md']);
  assert.ok(instructions.includes(JSON.stringify({id:asset.id,version:'1'})) && instructions.includes(pkg.files[0].path));
  const omitted=prepareAgentExport(user,{...request,previewId,selected:[]});
  assert.equal(omitted.files.length,0);
  assert.ok(!Object.values(unzipSync(buildAgentZip(omitted))).some(body=>strFromU8(body).includes(asset.id)));

  const excerpt={...docs[0],location:'2행',content:'발췌 구절'};
  set("UPDATE memory SET value=? WHERE owner=? AND project=? AND scope='live' AND name=?",
    JSON.stringify({documents:[excerpt],version:'1',index:[]}),user.id,p.id,prefix+'snapshot:'+hash);
  const withExcerpt=previewAgentExport(user,request);
  const both=prepareAgentExport(user,{...request,previewId:withExcerpt.previewId,selected:withExcerpt.resources.map(r=>r.key)});
  const exported=unzipSync(buildAgentZip(both));
  const excerptKey=both.graph.nodes[0].config.exportCollection[0];
  assert.notEqual(excerptKey,both.graph.nodes[1].config.exportResource);
  assert.equal(strFromU8(exported[both.resources.find(r=>r.key===excerptKey)!.files[0]]),'발췌 구절');
  assert.match(strFromU8(exported['AGENTS.md']),/발췌 위치 2행/);

  set("UPDATE memory SET value=? WHERE owner=? AND project=? AND scope='live' AND name=?",
    JSON.stringify({documents:[{...docs[0],content:'입력으로 바뀐 후보 문구'}],version:'1',index:[]}),user.id,p.id,prefix+'snapshot:'+hash);
  const changed=previewAgentExport(user,request);
  const changedPkg=prepareAgentExport(user,{...request,previewId:changed.previewId,selected:changed.resources.map(r=>r.key)});
  assert.equal(changedPkg.resources.filter(r=>r.source?.candidateOnly).length,1);
  assert.equal(changedPkg.files.length,2);
  assert.match(strFromU8(unzipSync(buildAgentZip(changedPkg))['AGENTS.md']),/자료판의 후보 문구/);
  assetShare(other,asset.id,'private',false);
  assert.throws(()=>prepareAgentExport(user,{...request,previewId,selected:[resources[0].key]}),{status:409});
  assert.doesNotMatch(JSON.stringify(previewAgentExport(user,request)),/원본 판/);
});

test('a newer unpinned child invalidates the preview even with no selected resources',()=>{
  const user=account('agent-export-preview'),p=createProject(user,{title:'부모'}),child=createProject(user,{title:'자식'});
  function addVersion(n:number){
    const graph={nodes:[createBlock('control.terminate',{id:'end',config:{message:'결과 '+n}})],edges:[]};
    set('INSERT INTO versions(project,number,title,graph,created) VALUES(?,?,?,?,?)',child.id,n,'자식',JSON.stringify(graph),new Date().toISOString());
  }
  addVersion(1);
  const graph={nodes:[createBlock('workflow.call',{config:{workflowId:child.id,version:''}})],edges:[]};
  const request={id:p.id,title:'부모',graph};
  const original=previewAgentExport(user,request);
  assert.equal(original.resources.length,0);
  addVersion(2);
  assert.throws(()=>prepareAgentExport(user,{...request,previewId:original.previewId,selected:[]}),{status:409});
  const refreshed=previewAgentExport(user,request);
  const pkg=prepareAgentExport(user,{...request,previewId:refreshed.previewId,selected:[]});
  assert.equal(pkg.graph.nodes[0].graph?.nodes[0].config.message,'결과 2');
});

test('a withdrawal design carries its published source and workflow instructions into the native folder',async()=>{
  const user=account('agent-export-withdraw'),p=createProject(user,{title:'자료집 철회'});
  const docs=[{id:'sourceA',title:'규정',version:'1',content:'연결할 규정 원문'}];
  const prefix='knowledge:'+token('규정집')+':';
  const store=(key:string,value:string)=>set('INSERT INTO memory VALUES (?,?,?,?,?)',user.id,p.id,'live',prefix+key,value);
  store('release:1','stored-snapshot');
  store('snapshot:stored-snapshot',JSON.stringify({documents:docs,version:'1',index:[]}));
  store('draft:1',JSON.stringify([{...docs[0],title:'다음 초안',content:'아직 발행하지 않은 자료'}]));
  const graph:Graph={nodes:[
    createBlock('input.user_request',{id:'start'}),
    createBlock('knowledge.manage',{id:'withdraw',config:{operation:'withdraw',storeKey:'규정집',version:'1'}}),
    createBlock('control.terminate',{id:'done',config:{status:'success',message:'철회 완료'}}),
  ],edges:[
    {id:'a',kind:'flow',from:'start',to:'withdraw',out:'next',input:'in'},
    {id:'b',kind:'data',from:'start',to:'withdraw',out:'value',input:'input'},
    {id:'c',kind:'flow',from:'withdraw',to:'done',out:'next',input:'in'},
  ]};
  const request={id:p.id,title:'자료집 철회',graph};
  const {resources,previewId}=previewAgentExport(user,request);
  assert.equal(resources.length,1);
  const selected=resources.map(r=>r.key);
  assert.equal(prepareAgentExport(user,{...request,previewId,selected:[]}).files.length,0);
  const pkg=prepareAgentExport(user,{...request,previewId,selected});
  assert.deepEqual(pkg.graph.nodes[1].config.exportCollection,selected);
  const files=unzipSync(await buildAgentZip(pkg));
  assert.equal(strFromU8(files[pkg.resources[0].files[0]]),'연결할 규정 원문');
  assert.match(strFromU8(files['AGENTS.md']),/자료집 철회/);
  assert.doesNotMatch(Object.keys(files).join('\n'),/^(?:runtime\/|workflow\.json|run\.mjs)/m);
});

test('staged publish data stays private to the project owner and checks pinned input permissions',()=>{
  const owner=account('agent-export-stage'),peer=account('agent-export-stage-peer');
  const project=createProject(owner,{title:'새 자료판 발행'}),p=createProject(peer,{title:'다른 프로젝트'});
  const asset=writeAsset(peer,{name:'발행할 규정',kind:'document',payload:{content:'색인한 자료 원문'}});
  const grant=assetShare(peer,asset.id,'link',false);
  const refs=[{assetId:asset.id,version:'1',assetGrant:grant.token}];
  const docs=[{id:asset.id,assetId:asset.id,title:'발행할 규정',version:'1',content:'색인한 자료 원문'}];
  const node=createBlock('knowledge.manage',{id:'publish',config:{operation:'publish',storeKey:'미발행',version:'2'}});
  const graph={nodes:[node],edges:[]},request={id:project.id,title:'발행',graph};
  const store=(key:string,value:string)=>set('INSERT INTO memory VALUES (?,?,?,?,?)',owner.id,project.id,'live','knowledge:'+token('미발행')+':'+key,value);
  store('draft:2',JSON.stringify(docs));store('sources-draft:2',JSON.stringify(refs));
  store('index:2','index-digest');store('snapshot:index-digest',JSON.stringify({documents:docs,version:'2',index:[]}));
  store('sources:index-digest',JSON.stringify(refs));
  const preview=previewAgentExport(owner,request);
  assert.equal(preview.resources.length,1);
  const keys=preview.resources.map(r=>r.key);
  const pkg=prepareAgentExport(owner,{...request,previewId:preview.previewId,selected:keys});
  assert.equal(pkg.graph.nodes[0].config.exportDraft,undefined);
  assert.deepEqual(pkg.graph.nodes[0].config.exportIndex,keys);
  assert.equal(pkg.graph.nodes[0].config.exportCollection,undefined);
  assert.equal(pkg.graph.nodes[0].config.exportPublished,undefined);
  store('release:2','previous-release');store('published-digest:2','previous-release');
  store('snapshot:previous-release',JSON.stringify({documents:[{id:'old',title:'과거 원문',version:'4',content:'이전 문서 본문'}],version:'2',index:[]}));
  const changed=previewAgentExport(owner,request);
  assert.equal(changed.resources.length,1);
  const changedPkg=prepareAgentExport(owner,{...request,previewId:changed.previewId,selected:keys});
  assert.equal(changedPkg.graph.nodes[0].config.exportPublication,'different-edition');
  const pages=Object.values(unzipSync(buildAgentZip(changedPkg))).map(bytes=>strFromU8(bytes)).join('\n');
  assert.ok(pages.includes('이 판에서 처음 발행한 스냅숏과 다릅니다')&&!pages.includes('이전 문서 본문'));
  const stamp=new Date().toISOString();
  set('INSERT INTO versions VALUES(?,?,?,?,?)',project.id,1,'발행',JSON.stringify(graph),stamp);
  set("UPDATE projects SET visibility='public',public_version=1 WHERE id=?",project.id);
  set('INSERT INTO project_releases VALUES(?,?)',project.id,1);
  set('INSERT INTO project_public_releases VALUES(?,?)',project.id,1);
  const ref={id:p.id,title:'읽기',graph:{nodes:[createBlock('workflow.call',{config:{workflowId:project.id,version:1}})],edges:[]}};
  assert.ok(previewAgentExport(peer,ref).resources.every(r=>!r.available));
  assetShare(peer,asset.id,'private',false);
  assert.throws(()=>prepareAgentExport(owner,{...request,previewId:preview.previewId,selected:keys}),{status:409});
});
