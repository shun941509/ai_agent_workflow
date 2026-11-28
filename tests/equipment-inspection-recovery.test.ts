import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {templates, validateGraph} from '../src/domain';
import {applyRecoveryDelivery,createRecoverySession,makeRecoveryRecord,recoveryScenarios,scenarioDeliveries} from '../src/domain/inspection-recovery.mjs';
import {executeGraph, type EngineServices} from '../src/engine';
import {completedRunFiles} from '../src/engine/legacy-files';
import {scopeModel} from './scope-fixture';

const lessonId = 'equipment-inspection-recovery';
const fields = ['고급 개발 보고서','고급 점검 Skill','시도별 검증 기록'];
const originalReport = '# 고급 개발 보고서\n현장 식별자 EQ-187. 검수 완료 후에도 재대여는 보류한다.';
const originalSkill = '---\nname: local-return-check\ndescription: 현장 검수 점검\n---\n\n# 현장 점검\n기존 고유 규칙 TRACK-29를 지킨다.';
const heading = '## 검수 알림의 역순 도착과 재전송 점검';
const section = ['<!-- inspection-recovery:begin -->',heading,'','첫 시도 직후와 두 번째 시도 직후의 전체 장비와 이력을 대조한다.','<!-- inspection-recovery:end -->'].join('\n');
const roles = {docs:'find-docs',design:'frontend-design',backend:'webhook-handler-patterns',
  developer:'test-driven-development',ui:'web-artifacts-builder',creator:'skill-creator'};

function lesson() {
  const entry = templates.find(item=>item.id===lessonId);
  assert.ok(entry,'웹 개발 전문가 예제가 필요합니다.');
  return entry;
}

test('전문가 실습은 고급 두 문서와 시도 기록을 직접 받고 여섯 원본을 담당별로 연결한다', () => {
  const item = lesson();
  assert.equal(item.title,'검수 알림이 뒤늦게 오거나 다시 오면 무엇이 남아야 할까?');
  assert.deepEqual([item.topic,item.level],['웹 개발','전문가']);
  assert.deepEqual(validateGraph(item.graph),[]);
  assert.deepEqual(item.graph.nodes.find(n=>n.id==='inputs')?.config.fields,fields.map(name=>({name,multiline:true})));
  for (const [id,skill] of Object.entries(roles)) {
    const target = item.skills?.find(material=>material.title===skill);
    assert.equal(target?.bundled,true,skill);
    assert.deepEqual(target?.targets.map(node=>node.id),[id]);
  }
});

function receipt() {
  const id='B-08';
  const sessions=Object.fromEntries(recoveryScenarios.map(scenario=>{
    const session=createRecoverySession();
    for(const {event,fault} of scenarioDeliveries(scenario.id,id)) applyRecoveryDelivery(session,event,fault);
    return [scenario.id,session];
  }));
  return makeRecoveryRecord(id,sessions);
}

function originalSource(skill:string) {
  const local=['test-driven-development','frontend-design','web-artifacts-builder'].includes(skill);
  return readFileSync(new URL('../'+(local?'.agents/skills/':'vendor/lesson-skills/')+skill+'/SKILL.md',import.meta.url),'utf8');
}

async function submit(receiptText:string,previousSkill=originalSkill,previousReport=originalReport,generatedSection=section) {
  const entry=lesson(), called=new Set<string>();
  const graph=entry.graph;
  const services:EngineServices={
    scopeModel,
    asset:async (id,version='1')=>({id,title:id,version,content:originalSource(id)}),
    tool:async name=>{throw Error('예상하지 않은 외부 도구 '+name);},
    model:async request=>{
      const role=graph.nodes.find(node=>node.type==='agent.delegate' && request.instruction.includes('역할: '+node.title+'\n'));
      assert.ok(role,'담당자를 확인할 수 있어야 합니다.');
      const id=role.id as keyof typeof roles;
      called.add(id);
      const materials=request.input+'\n'+request.context;
      for(const token of ['EQ-187','TRACK-29','B-08-out-of-order-1','B-08-before-save-2','B-08-after-save-2','failed_before_commit','response_lost','duplicate']) {
        assert.ok(materials.includes(token),id+'에게 직접 입력한 두 문서와 세 시나리오가 전달됩니다. '+token);
      }
      assert.equal(materials.split('EQ-187').length,2,id+'에게 원래 고급 보고서를 한 번 전달합니다.');
      assert.equal(materials.split('TRACK-29').length,2,id+'에게 원래 고급 Skill을 한 번 전달합니다.');
      for(const skill of Object.values(roles))assert.equal(request.instruction.includes(originalSource(skill)),skill===roles[id],id+' / '+skill);
      const dependencies:Record<string,string[]>={developer:['docs','design','backend'],ui:['docs','design','backend','developer'],creator:['docs','design','backend','developer','ui']};
      for(const prior of dependencies[id]??[])assert.ok(materials.includes('검토-'+prior),id+' ← '+prior);
      const text=id==='creator'?generatedSection:id==='developer'?'# 시도별 검증 보고서\n검토-developer':'검토-'+id;
      return {text};
    },
  };
  const run={runId:'recovery',input:entry.question};
  const wait=await executeGraph(graph,run,services);
  assert.equal(wait.status,'waiting',wait.error??'');
  assert.deepEqual(wait.wait?.fields?.map(field=>field.name),fields);
  assert.equal(called.size,0);
  const values=Object.fromEntries(fields.map((name,i)=>[name,[previousReport,previousSkill,receiptText][i]]));
  const result=await executeGraph(graph,{...run,checkpoint:wait.checkpoint,reply:{waitId:wait.wait!.id,value:JSON.stringify(values)}},services);
  return {result,called,files:completedRunFiles(graph,result.checkpoint)};
}

test('실제 여섯 시도와 두 고급 문서를 각 담당자가 한 번씩 받고 두 결과 파일을 전달한다',async()=>{
  const source=receipt();
  assert.equal(source.verified,true);
  const raw=JSON.stringify(source,null,2);
  const {result,called,files}=await submit(raw);
  assert.equal(result.status,'completed',result.error??'');
  assert.deepEqual([...called].sort(),Object.keys(roles).sort());
  assert.deepEqual(files.map(file=>file.fileName).sort(),['SKILL.md','시도별-검증-보고서.md'].sort());
  assert.equal(files.find(f=>f.fileName==='SKILL.md')?.content,originalSkill+'\n\n'+section+'\n');
  const report=files.find(f=>f.fileName==='시도별-검증-보고서.md')!.content;
  assert.ok(report.startsWith('# 시도별 검증 보고서\n'));
  assert.ok(report.includes('검토-ui'));
  assert.ok(report.includes(raw),'각 시도 직후의 전체 장비와 이력 원문이 파일에 남아야 합니다.');
});

test('마커 또는 이전 같은 제목이 있는 Skill은 기존 절을 갱신하고 뒤의 현장 규칙을 보존한다',async()=>{
  for(const old of [section,heading+'\n기존 초안']) {
    const previous=(originalSkill+'\n\n'+old+'\n\n## 현장 예외\n작업번호 기록  \n반납 창구 보존\n').replaceAll('\n','\r\n');
    const {result,files}=await submit(JSON.stringify(receipt()),previous);
    assert.equal(result.status,'completed',result.error??'');
    const updated=files.find(f=>f.fileName==='SKILL.md')!.content;
    assert.equal(updated,(originalSkill+'\n\n'+section+'\n\n## 현장 예외\n작업번호 기록  \n반납 창구 보존\n').replaceAll('\n','\r\n'));
  }
});

test('누락된 고급 보고서 또는 여섯 시도 중 빠진 스냅숏에는 검증 결과를 만들지 않는다',async()=>{
  const partial=receipt();
  partial.scenarios[1].attempts.shift();
  const wrongType=receipt();
  Object.assign(wrongType.scenarios[1].attempts[0],{history:{length:0}});
  for (const [raw,report] of [['{"verified":true}',originalReport],[JSON.stringify(partial),originalReport],[JSON.stringify(wrongType),originalReport],[JSON.stringify(receipt()),'']]) {
    const {result,called,files}=await submit(raw,originalSkill,report);
    assert.equal(result.status,report?'failed':'waiting');
    assert.equal(called.size,0);
    assert.deepEqual(files,[]);
  }
});

test('담당자가 복구 절 대신 다른 Skill 전체를 반환하면 원본 Skill을 덮어쓰지 않는다',async()=>{
  const {result,files}=await submit(JSON.stringify(receipt()),originalSkill,originalReport,'---\nname: other-check\n---\n# 새 문서');
  assert.equal(result.status,'failed');
  assert.match(result.error??'',/새 Markdown 절/);
  assert.ok(files.every(file=>file.fileName!=='SKILL.md'));
});
