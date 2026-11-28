import assert from 'node:assert/strict';
import test from 'node:test';
import {applyRecoveryDelivery, createRecoverySession, makeRecoveryDocuments, makeRecoveryRecord, recoveryScenarios, scenarioDeliveries, verifyRecoveryRecord} from '../src/domain/inspection-recovery.mjs';

function exercise(equipmentId:string) {
  const sessions = Object.fromEntries(recoveryScenarios.map(({id}) => {
    const session = createRecoverySession();
    for (const {event,fault} of scenarioDeliveries(id,equipmentId)) applyRecoveryDelivery(session,event,fault);
    return [id,session];
  }));
  return makeRecoveryRecord(equipmentId,sessions);
}

test('역순 알림과 두 실패 지점은 첫 시도부터 서로 다른 장비 상태와 이력을 남긴다', () => {
  for (const target of ['A-17','B-08']) {
    const record = exercise(target);
    assert.equal(record.verified,true);
    for (const scenario of record.scenarios) {
      const [first,second] = scenario.attempts;
      assert.deepEqual([first.result,second.result], {
        'out-of-order':['applied','stale'], 'before-save':['failed_before_commit','applied'], 'after-save':['response_lost','duplicate'],
      }[scenario.id]);
      assert.equal(first.history.length,scenario.id==='before-save' ? 0 : 1);
      assert.equal(first.equipment.find(row=>row.equipmentId===target)?.inspectionStatus,scenario.id==='before-save' ? '검수 대기' : '검수 완료');
      assert.equal(second.history.length,1);
      assert.equal(second.equipment.find(row=>row.equipmentId===target)?.lastSequence,2);
      for (const row of record.initialEquipment) {
        const observed=second.equipment.find(item=>item.equipmentId===row.equipmentId);
        if (row.equipmentId!==target) assert.deepEqual(observed,row);
        else assert.equal(observed?.rentalApproval,row.rentalApproval);
      }
    }
    const tampered = structuredClone(record);
    tampered.scenarios[1].attempts[0].history.push(tampered.scenarios[1].attempts[1].event);
    assert.equal(verifyRecoveryRecord(tampered),false);
    const changedApproval = structuredClone(record);
    changedApproval.scenarios[2].attempts[0].equipment[2].rentalApproval = '보류';
    assert.equal(verifyRecoveryRecord(changedApproval),false);
  }
});

test('같은 이벤트 ID로 내용을 바꾸면 처리 상태와 기록을 보존하고, 순번은 장비마다 독립적이다', () => {
  const session = createRecoverySession();
  const {event} = scenarioDeliveries('out-of-order','A-17')[0];
  applyRecoveryDelivery(session,event);
  const saved = structuredClone(session);
  assert.throws(()=>applyRecoveryDelivery(session,{...event,equipmentId:'B-08'}));
  assert.deepEqual(session,saved);
  const other=applyRecoveryDelivery(session,{...event,eventId:'another',equipmentId:'B-08',sequence:1,type:'inspection.started'});
  assert.equal(other.result,'applied');
  assert.equal(other.equipment.find(row=>row.equipmentId==='B-08')?.inspectionStatus,'검수 중');
  assert.deepEqual(session.attempts[0],saved.attempts[0]);
});

test('문서 결과는 모든 실측을 대조하고 고급 문서·기존 Skill 메타와 규칙을 보존한다', () => {
  const record = exercise('B-08');
  const source = '---\nname: daily-audit\ndescription: 현장 점검\n---\n\n# 고유 점검법\n검수자 서명을 확인하세요.';
  const report = '# 고급 보고서\n야간 창구 B-08을 선택했다.';
  const output = makeRecoveryDocuments(report,source,record);
  assert.ok(output.report.includes('야간 창구 B-08을 선택했다.'));
  assert.ok(output.skill.startsWith(source));
  for (const {title} of recoveryScenarios) assert.ok(output.report.includes(title) && output.skill.includes(title));
  assert.equal(makeRecoveryDocuments(report,output.skill,record).skill,output.skill);
  const custom=source+'  \r\n\r\n## 검수 알림의 역순 도착과 재전송 점검\r\n이전 점검 문구\r\n\r\n## 후속 사용자 지침\r\n담당자에게 이관';
  const imported=makeRecoveryDocuments(report,custom,record).skill;
  assert.equal(imported.match(/## 검수 알림의 역순 도착과 재전송 점검/g)?.length,1);
  assert.ok(imported.startsWith(source+'  \r\n'));
  assert.ok(imported.endsWith('## 후속 사용자 지침\r\n담당자에게 이관'));
  assert.ok(!imported.includes('이전 점검 문구'));
  assert.throws(()=>makeRecoveryDocuments('',source,record));
  assert.throws(()=>makeRecoveryDocuments(report,' ',record));
  const fake=structuredClone(record);
  fake.scenarios[0].attempts.pop();
  assert.throws(()=>makeRecoveryDocuments(report,source,fake));
});
