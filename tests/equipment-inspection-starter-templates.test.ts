import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {templates, validateGraph} from '../src/domain';
import {executeGraph, type EngineServices} from '../src/engine';
import {completedRunFiles} from '../src/engine/legacy-files';
import {scopeModel} from './scope-fixture';

const levels = [
  ['equipment-return-inventory','입문','목록 디자인 담당','frontend-design','장비 반납 목록','장비-반납-목록.json'],
  ['equipment-inspection-first','초급','알림 처리 담당','webhook-handler-patterns','검수 알림 1회 기록','검수-알림-1회-기록.json'],
  ['equipment-inspection-compare','중급','검증 담당','test-driven-development','검수 알림 1회 기록','검수-알림-전후-검증.md'],
] as const;
const before = [
  {equipmentId:'CAM-52',name:'반납 창구 카메라',inspectionStatus:'검수 대기',rentalApproval:'보류'},
  {equipmentId:'SCAN-9',name:'예약 스캐너',inspectionStatus:'검수 완료',rentalApproval:'승인'},
];
const list = {initialEquipment:before,equipment:before,initialHistory:[],deliveries:[],history:[]};
const event = {eventId:'camera-check-104',equipmentId:'CAM-52',type:'inspection.completed'};
const receipt = {...list,equipment:[{...before[0],inspectionStatus:'검수 완료'},before[1]],
  deliveries:[{...event,result:'applied'}],history:[event]};

async function runLesson(index:number,raw:string) {
  const [id,level,role,skill,field]=levels[index];
  const item=templates.find(lesson=>lesson.id===id);
  assert.ok(item,'등록된 '+level+' 웹 개발 실습');
  assert.equal(item.level,level);
  assert.equal(item.topic,'웹 개발');
  assert.deepEqual(validateGraph(item.graph),[]);
  assert.deepEqual(item.skills?.map(s=>[s.title,s.bundled,s.targets.map(t=>t.title)]),[[skill,true,[role]]]);
  const root=skill==='webhook-handler-patterns'?'vendor/lesson-skills':'.agents/skills';
  const original=readFileSync(new URL('../'+root+'/'+skill+'/SKILL.md',import.meta.url),'utf8');
  let calls=0;
  const note=role+' 의견 · CAM-52와 SCAN-9의 실제 검수·승인 값을 확인했습니다.';
  const services:EngineServices={
    scopeModel, asset:async key=>{assert.equal(key,skill);return {id:key,title:key,version:'1',content:original};},
    model:async request=>{
      calls++;
      assert.ok(request.instruction.includes(original));
      assert.ok(request.instruction.includes(role));
      assert.ok(request.input.includes('CAM-52') && request.input.includes('SCAN-9'));
      if(index)assert.ok(request.input.includes(event.eventId));
      return {text:note};
    },
    tool:async name=>{throw Error('외부 도구가 호출되었습니다. '+name);},
  };
  const start={runId:id,input:item.question};
  const wait=await executeGraph(item.graph,start,services);
  assert.equal(wait.status,'waiting',wait.error??'');
  assert.deepEqual(wait.wait?.fields?.map(f=>f.name),[field]);
  const result=await executeGraph(item.graph,{...start,checkpoint:wait.checkpoint,
    reply:{waitId:wait.wait!.id,value:JSON.stringify({[field]:raw})}},services);
  return {result,calls,note,files:completedRunFiles(item.graph,result.checkpoint)};
}

test('입문·초급은 실제 입력 JSON을 보존하고 중급은 같은 알림과 장비별 전후 값으로 보고서를 만든다',async()=>{
  const intro=JSON.stringify(list,null,4);
  const first=JSON.stringify(receipt,null,2);
  const inventory=await runLesson(0,intro);
  assert.equal(inventory.result.status,'completed',inventory.result.error??'');
  assert.equal(inventory.files[0]?.content,intro);
  assert.deepEqual(JSON.parse(inventory.files[0].content).equipment,receipt.initialEquipment);
  const notified=await runLesson(1,first);
  assert.equal(notified.result.status,'completed',notified.result.error??'');
  assert.equal(notified.files[0]?.content,first);
  const verified=await runLesson(2,notified.files[0].content);
  assert.equal(verified.result.status,'completed',verified.result.error??'');
  for(const [i,out] of [inventory,notified,verified].entries()){
    assert.equal(out.calls,1);
    assert.deepEqual(out.files.map(f=>f.fileName),[levels[i][5]]);
    assert.ok(out.result.output.includes(out.note));
  }
  const report=verified.files[0].content;
  for(const evidence of ['CAM-52','반납 창구 카메라','검수 대기','검수 완료','SCAN-9','예약 스캐너','승인','보류','0건','1건',event.eventId])assert.ok(report.includes(evidence),evidence);
});

test('다른 수준의 기록, 중복 수신, 다른 장비나 승인이 바뀐 기록은 담당 의견과 파일 생성 전에 멈춘다',async()=>{
  const invalid:[number,unknown][]=[
    [0,receipt],[1,list],[2,{...receipt,deliveries:[...receipt.deliveries,...receipt.deliveries]}],
    [2,{...receipt,equipment:[receipt.equipment[0],{...before[1],inspectionStatus:'검수 대기'}],verified:true}],
    [2,{...receipt,equipment:[{...receipt.equipment[0],rentalApproval:'승인'},before[1]]}],
    [1,{...receipt,history:[{...event,eventId:'other-id'}]}],
  ];
  for(const [index,record] of invalid){
    const {result,calls,files}=await runLesson(index,JSON.stringify(record));
    assert.equal(result.status,'failed');
    assert.equal(calls,0);
    assert.deepEqual(files,[]);
  }
});
