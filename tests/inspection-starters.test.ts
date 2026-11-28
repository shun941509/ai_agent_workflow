import assert from 'node:assert/strict';
import test from 'node:test';
import {createInspectionSession} from '../src/domain/inspection-receiver.mjs';
import {makeStarterList, receiveStarterInspection, checkStarterInspection, advancedInspectionEvent} from '../src/domain/inspection-starters.mjs';

test('학습자가 만든 장비 목록에서 검수 한 건을 반영하고 처음 상태와 이력 한 건을 비교한다', () => {
  const rows=createInspectionSession().equipment;
  rows[1]={...rows[1],equipmentId:'LAB-9',name:'현장용 태블릿'};
  const initial=makeStarterList(rows);
  const record=receiveStarterInspection(initial,'LAB-9','desk-219');
  assert.deepEqual(initial.history,[]);
  assert.deepEqual(initial.equipment,rows);
  assert.deepEqual(record.equipment,[rows[0],{...rows[1],inspectionStatus:'검수 완료'},rows[2]]);
  assert.deepEqual(record.history,[{eventId:'desk-219',equipmentId:'LAB-9',type:'inspection.completed'}]);
  assert.deepEqual(record.deliveries,[{...record.history[0],result:'applied'}]);
  const result=checkStarterInspection(JSON.parse(JSON.stringify(record)));
  assert.deepEqual(result.event,record.history[0]);
  for (const expected of ['현장용 태블릿','LAB-9','desk-219','0건','1건','검수 대기','검수 완료','보류']) {
    assert.ok(result.report.includes(expected),expected);
  }
});

test('중급은 첫 이력과 수신 이벤트, 대상 외 장비와 재대여 승인까지 독립적으로 대조한다', () => {
  const initial=makeStarterList(createInspectionSession().equipment);
  const valid=receiveStarterInspection(initial,'B-08','counter-7');
  const edits:((record:typeof valid & {initialHistory?:unknown[]})=>void)[]=[
    record=>{delete (record as {initialHistory?:unknown[]}).initialHistory;},
    record=>{record.initialHistory=[record.history[0]];},
    record=>{record.equipment[0].inspectionStatus='검수 완료';},
    record=>{record.equipment[1].rentalApproval='승인';},
    record=>{record.equipment[2].equipmentId='B-08';},
    record=>{record.deliveries.push(record.deliveries[0]);},
    record=>{record.history[0].eventId='another-event';},
    record=>{record.initialEquipment[1].inspectionStatus='검수 완료';},
  ];
  for (const edit of edits) {
    const changed=structuredClone(valid);
    edit(changed);
    assert.throws(()=>checkStarterInspection({...changed,verified:true}));
  }
  assert.throws(()=>receiveStarterInspection(valid,'B-08','retry'));
});

test('고급 대기 장비를 그대로 쓸 때는 같은 사건을, 대상이 바뀔 때는 별도의 알림 ID를 전달한다', () => {
  const event={eventId:'desk-219',equipmentId:'B-08',type:'inspection.completed' as const};
  assert.deepEqual(advancedInspectionEvent(event),event);
  const custom={...event,equipmentId:'LAB-9'};
  assert.deepEqual(advancedInspectionEvent(custom),{...event,eventId:'desk-219-A-17',equipmentId:'A-17'});
  assert.deepEqual(custom,{eventId:'desk-219',equipmentId:'LAB-9',type:'inspection.completed'});
});
