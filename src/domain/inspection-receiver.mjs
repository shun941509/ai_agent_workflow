const inventory = [
  {equipmentId:'A-17', name:'노트북', inspectionStatus:'검수 대기', rentalApproval:'미승인'},
  {equipmentId:'B-08', name:'태블릿', inspectionStatus:'검수 대기', rentalApproval:'보류'},
  {equipmentId:'C-03', name:'카메라', inspectionStatus:'검수 완료', rentalApproval:'승인'},
];

export const defaultInspectionEvent = {eventId:'inspect-101', equipmentId:'A-17', type:'inspection.completed'};

function copyRows(rows) {
  return rows.map(row => ({...row}));
}

export function createInspectionSession() {
  return {equipment:copyRows(inventory), deliveries:[], history:[]};
}

/** Each accepted delivery is recorded; only the first delivery of an event changes business state. */
export function applyInspectionDelivery(session, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.eventId !== 'string' || !input.eventId.trim() || typeof input.equipmentId !== 'string') {
    throw new Error('알림 ID(eventId), 장비 번호(equipmentId), 종류(type)를 확인하세요.');
  }
  if (input.type !== 'inspection.completed') throw new Error('검수 완료 알림의 종류는 inspection.completed입니다.');
  const item = session.equipment.find(row => row.equipmentId === input.equipmentId);
  if (!item) throw new Error('장비 목록에 있는 장비 번호를 입력하세요.');
  const event = {eventId:input.eventId, equipmentId:input.equipmentId, type:input.type};
  const prior = session.history.find(entry => entry.eventId === event.eventId);
  if (prior && prior.equipmentId !== event.equipmentId) throw new Error('같은 알림 ID가 다른 장비에 사용됐습니다. 장비 번호를 확인하세요.');
  if (!prior) {
    item.inspectionStatus = '검수 완료';
    session.history.push(event);
  }
  const result = prior ? 'duplicate' : 'applied';
  session.deliveries.push({...event, result});
  return result;
}

function containsRow(candidate, expected) {
  return candidate != null && Object.entries(expected).every(([key,value]) => candidate[key] === value);
}

// Verify the two deliveries and snapshots independently of the learner-supplied summary flag.
export function verifyInspectionReceipt(record) {
  if (!record || !Array.isArray(record.initialEquipment) || !Array.isArray(record.equipment) ||
      !Array.isArray(record.deliveries) || !Array.isArray(record.history) ||
      record.initialEquipment.length !== inventory.length || record.equipment.length !== inventory.length ||
      record.deliveries.length !== 2 || record.history.length !== 1) return false;
  const [first, second] = record.deliveries;
  if (!first || typeof first.eventId !== 'string' || !first.eventId.trim() || first.type !== 'inspection.completed' ||
      first.result !== 'applied' || !inventory.some(row => row.equipmentId === first.equipmentId && row.inspectionStatus === '검수 대기')) return false;
  const event = {eventId:first.eventId, equipmentId:first.equipmentId, type:first.type};
  return containsRow(second, {...event, result:'duplicate'}) && containsRow(record.history[0],event) &&
    inventory.every(before => {
      const initial = record.initialEquipment.find(row => row?.equipmentId === before.equipmentId);
      const current = record.equipment.find(row => row?.equipmentId === before.equipmentId);
      const expected = before.equipmentId === event.equipmentId ? {...before, inspectionStatus:'검수 완료'} : before;
      return containsRow(initial,before) && containsRow(current,expected);
    });
}

export function makeInspectionReceipt(session) {
  const record = {initialEquipment:copyRows(inventory), equipment:copyRows(session.equipment),
    deliveries:copyRows(session.deliveries), history:copyRows(session.history)};
  return {...record, verified:verifyInspectionReceipt(record)};
}
