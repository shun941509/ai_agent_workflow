import assert from 'node:assert/strict';
import test from 'node:test';
import {GET} from '../src/app/examples/equipment-inspection.html/route';
import {inspectionExampleHtml, inspectionReceiverModule} from '../src/domain/equipment-inspection-example';
import {applyInspectionDelivery, createInspectionSession, defaultInspectionEvent, makeInspectionReceipt, verifyInspectionReceipt} from '../src/domain/inspection-receiver.mjs';

test('두 검수 알림 사이에 저장한 첫 기록을 보존하고, 실제 두 번째 수신만 중복으로 남긴다', () => {
  const session = createInspectionSession();
  assert.equal(applyInspectionDelivery(session,defaultInspectionEvent),'applied');
  const first = makeInspectionReceipt(session);
  assert.equal(applyInspectionDelivery(session,defaultInspectionEvent),'duplicate');
  const second = makeInspectionReceipt(session);
  assert.equal(verifyInspectionReceipt({...first,verified:true}),false);
  assert.equal(second.verified,true);
  assert.deepEqual(second.history,[defaultInspectionEvent]);
  assert.deepEqual(second.deliveries.map(item=>item.result),['applied','duplicate']);
  assert.deepEqual(second.equipment,second.initialEquipment.map(item=>item.equipmentId==='A-17' ? {...item,inspectionStatus:'검수 완료'} : item));
});

test('재대여 승인·다른 장비·입력 전 원본·이력을 바꾼 기록과 이미 검수한 장비는 검증을 통과하지 않는다', () => {
  const session = createInspectionSession();
  const alternate = {...defaultInspectionEvent,equipmentId:'B-08'};
  applyInspectionDelivery(session,alternate);
  applyInspectionDelivery(session,alternate);
  const intact = makeInspectionReceipt(session);
  assert.equal(intact.verified,true);
  for (const change of [
    (report:typeof intact)=>{report.equipment[1].rentalApproval='승인';},
    (report:typeof intact)=>{report.equipment[0].inspectionStatus='검수 완료';},
    (report:typeof intact)=>{report.initialEquipment[1].rentalApproval='승인';},
    (report:typeof intact)=>{report.deliveries[1].eventId='다른 알림';},
    (report:typeof intact)=>{report.history.push(alternate);},
  ]) {
    const edited = structuredClone(intact);
    change(edited);
    assert.equal(verifyInspectionReceipt(edited),false);
  }
  const complete = createInspectionSession();
  const event = {...defaultInspectionEvent,equipmentId:'C-03'};
  applyInspectionDelivery(complete,event);
  applyInspectionDelivery(complete,event);
  assert.equal(makeInspectionReceipt(complete).verified,false);
});

test('충돌하거나 잘못된 알림은 수신 기록과 장비 상태를 변경하지 않는다', () => {
  const session = createInspectionSession();
  applyInspectionDelivery(session,defaultInspectionEvent);
  const original = makeInspectionReceipt(session);
  for (const invalid of [null, {}, {...defaultInspectionEvent,equipmentId:'B-08'}, {...defaultInspectionEvent,equipmentId:'F-4'},
    {...defaultInspectionEvent,type:'rental.approved'}, {...defaultInspectionEvent,eventId:'  '}]) {
    assert.throws(()=>applyInspectionDelivery(session,invalid));
    assert.deepEqual(makeInspectionReceipt(session),original);
  }
});

test('웹 실습과 ZIP에 들어갈 독립 HTML이 같은 검수 수신기 원문을 사용한다', async () => {
  const response = GET();
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'text/html; charset=utf-8');
  assert.equal(await response.text(),inspectionExampleHtml);
  assert.ok(inspectionExampleHtml.includes(inspectionReceiverModule));
});
