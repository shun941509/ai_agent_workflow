import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lessonTopics, templates, validateGraph} from '../src/domain';
import type {Lesson, LessonSkill} from '../src/domain';
import {applyInspectionDelivery, createInspectionSession, defaultInspectionEvent, makeInspectionReceipt} from '../src/domain/inspection-receiver.mjs';
import {executeGraph, type EngineServices} from '../src/engine';
import {completedRunFiles} from '../src/engine/legacy-files';
import {scopeModel} from './scope-fixture';

const roles = {
  docs:['문서 담당','find-docs'], design:['디자인 담당','frontend-design'],
  developer:['개발 담당','test-driven-development'], ui:['UI 담당','web-artifacts-builder'],
  backend:['백엔드 담당','webhook-handler-patterns'], creator:['도구 제작 담당','skill-creator'],
};

function skillSource(skill:string) {
  const local = ['test-driven-development','frontend-design','web-artifacts-builder'].includes(skill);
  return readFileSync(new URL('../'+(local?'.agents/skills/':'vendor/lesson-skills/')+skill+'/SKILL.md',import.meta.url),'utf8');
}

function inspectionLesson():Lesson {
  const lesson = templates.find(item => item.id === 'equipment-inspection-web');
  assert.ok(lesson, '검수 알림을 시험하는 고급 실습이 목록에 있어야 합니다.');
  return lesson;
}

test('웹 개발 고급 실습의 여섯 담당자에게 각자 필요한 원본 Skill만 연결한다', () => {
  const lesson = inspectionLesson();
  assert.ok(lessonTopics.includes('웹 개발'));
  assert.equal(lesson.topic,'웹 개발');
  assert.equal(lesson.level,'고급');
  assert.equal(lesson.title,'검수가 끝나면 장비 반납 목록은 어떻게 바뀔까?');
  assert.deepEqual(validateGraph(lesson.graph), []);
  assert.equal(lesson.graph.nodes.filter(node => node.type === 'agent.delegate').length,6);
  assert.equal(lesson.graph.nodes.find(node => node.id === 'developer')?.config.projectWork, 'tdd');
  assert.equal(lesson.skills?.length,6);
  for (const [id,[role,skill]] of Object.entries(roles)) {
    assert.equal(lesson.graph.nodes.find(node=>node.id===id)?.config.role,role);
    const pin:LessonSkill|undefined = lesson.skills?.find(item=>item.title===skill);
    assert.equal(pin?.bundled,true,skill);
    assert.deepEqual(pin?.targets.map(target=>target.id),[id],role);
  }
});

async function submitReceipt(receipt:string) {
  const lesson = inspectionLesson();
  const called = new Set<string>();
  const skillBody = '---\nname: inspect-equipment-sync\ndescription: 같은 검수 알림의 중복 반영 확인\n---\n장비별 검수 상태와 처리 이력을 대조하세요.';
  const services:EngineServices = {
    scopeModel,
    asset:async (id,version='1')=>({id,title:id,version,content:skillSource(id)}),
    tool:async name=>{throw Error('예상하지 않은 도구 호출 '+name);},
    model:async request => {
      const entry = Object.entries(roles).find(([, [name]])=>request.instruction.includes('역할: '+name+'\n'));
      assert.ok(entry,'고정 배정한 역할 중 하나가 처리합니다.');
      const [id,[name,skill]]=entry;
      called.add(id);
      const materials=request.input+'\n'+request.context;
      assert.ok(materials.includes('test-B-08'),name+'에게 실제 장비의 원문 알림이 도착해야 합니다.');
      assert.ok(materials.includes('duplicate'),name+'가 두 번째 수신의 결과를 볼 수 있어야 합니다.');
      for(const [,assigned] of Object.values(roles)) {
        assert.equal(request.instruction.includes(skillSource(assigned)),assigned===skill,name+' / '+assigned);
      }
      const dependencies:Record<string,string[]>={developer:['docs','design'],ui:['docs','design','developer'],backend:['docs','design','developer'],creator:['docs','design','developer','ui','backend']};
      for(const prior of dependencies[id]??[]) assert.ok(materials.includes('결과-'+prior),id+' ← '+prior);
      return {text:id==='creator'?skillBody:'결과-'+id};
    },
  };
  const run = {runId:'equipment-inspection',input:lesson.question};
  const wait = await executeGraph(lesson.graph,run,services);
  assert.equal(wait.status,'waiting',wait.error??'');
  assert.equal(called.size,0);
  const result = await executeGraph(lesson.graph,{...run,checkpoint:wait.checkpoint,
    reply:{waitId:wait.wait!.id,value:JSON.stringify({'검증 기록':receipt})}},services);
  return {result, called, skillBody, files:completedRunFiles(lesson.graph,result.checkpoint)};
}

test('실습 수신기의 실제 B-08 중복 기록과 선행 담당자 결과를 전달하고 점검 Skill과 보고서를 내려받는다',async () => {
  const state = createInspectionSession();
  const event = {...defaultInspectionEvent,eventId:'test-B-08',equipmentId:'B-08'};
  applyInspectionDelivery(state,event);
  applyInspectionDelivery(state,event);
  const receipt = JSON.stringify(makeInspectionReceipt(state),null,2);
  const {result,called,files,skillBody} = await submitReceipt(receipt);
  assert.equal(result.status,'completed',result.error??'');
  assert.deepEqual([...called].sort(),Object.keys(roles).sort());
  assert.deepEqual(files.map(f=>f.fileName).sort(),['SKILL.md','검수-알림-개발-보고서.md'].sort());
  assert.equal(files.find(f=>f.fileName==='SKILL.md')?.content,skillBody);
  const report=files.find(f=>f.fileName==='검수-알림-개발-보고서.md')!.content;
  assert.ok(report.includes(receipt));
  for(const [id,[role]] of Object.entries(roles)) {
    assert.ok(report.includes(role),role);
    assert.ok(report.includes(id==='creator'?skillBody:'결과-'+id),id);
  }
});

test('검증 기록 구조가 없으면 담당자가 결과를 추측하거나 파일을 만들지 않는다',async () => {
  const {result,called,files} = await submitReceipt('{"verified":true}');
  assert.equal(result.status,'failed');
  assert.match(result.error??'',/초기|initialEquipment/);
  assert.equal(called.size,0);
  assert.deepEqual(files,[]);
});
