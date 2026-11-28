import {applyInspectionDelivery,createInspectionSession} from './inspection-receiver.mjs';

export const inspectionStatuses=['검수 대기','검수 완료'];
export const rentalApprovals=['미승인','보류','승인'];
const textValue=value=>typeof value==='string' && !!value.trim() && !/[\r\n]/.test(value);

function equipmentRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw Error('목록에 장비를 한 대 이상 넣어 주세요.');
  const seen=new Set();
  return rows.map((row,index)=>{
    if (!textValue(row?.equipmentId) || !textValue(row?.name)) throw Error((index+1)+'행의 장비 번호와 이름을 한 줄씩 입력하세요.');
    const {equipmentId,name,inspectionStatus,rentalApproval}=row;
    if (equipmentId!==equipmentId.trim() || seen.has(equipmentId)) throw Error('장비 번호의 앞뒤 공백이나 중복을 확인하세요. '+equipmentId);
    if (!inspectionStatuses.includes(inspectionStatus) || !rentalApprovals.includes(rentalApproval)) throw Error(equipmentId+'의 검수 상태와 재대여 승인을 확인하세요.');
    seen.add(equipmentId);
    return {equipmentId,name,inspectionStatus,rentalApproval};
  });
}

export function makeStarterList(rows) {
  const before=equipmentRows(rows);
  if (!before.some(item=>item.inspectionStatus==='검수 대기')) throw Error('검수 알림을 보낼 대기 장비를 한 대 이상 넣어 주세요.');
  return {initialEquipment:before,initialHistory:[],equipment:structuredClone(before),deliveries:[],history:[]};
}

function compareEquipment(before,after,targetId) {
  const actual=equipmentRows(after);
  if (before.length!==actual.length) throw Error('입력 전과 후의 장비 수가 다릅니다.');
  const byId=new Map(actual.map(row=>[row.equipmentId,row]));
  for (const original of before) {
    const current=byId.get(original.equipmentId);
    if (!current) throw Error('입력 후 목록에서 장비를 찾을 수 없습니다. '+original.equipmentId);
    if (current.name!==original.name) throw Error(original.equipmentId+'의 장비 이름이 바뀌었습니다.');
    if (current.rentalApproval!==original.rentalApproval) throw Error(original.equipmentId+'의 재대여 승인이 바뀌었습니다.');
    const expected=original.equipmentId===targetId ? '검수 완료' : original.inspectionStatus;
    if (current.inspectionStatus!==expected) throw Error(original.equipmentId+'의 검수 상태는 '+expected+'여야 합니다.');
  }
  return byId;
}

export function readStarterList(record) {
  const initial=makeStarterList(record?.initialEquipment);
  if ((record.initialHistory!==undefined && (!Array.isArray(record.initialHistory) || record.initialHistory.length)) ||
      !Array.isArray(record.deliveries) || record.deliveries.length || !Array.isArray(record.history) || record.history.length) {
    throw Error('입문 목록은 수신 기록과 처리 이력이 모두 0건이어야 합니다.');
  }
  compareEquipment(initial.initialEquipment,record.equipment);
  return initial;
}

export function receiveStarterInspection(record,equipmentId,eventId) {
  const session=readStarterList(record);
  const pending=session.equipment.find(row=>row.equipmentId===equipmentId);
  if (pending?.inspectionStatus!=='검수 대기') throw Error('목록에서 검수 대기 장비를 선택하세요.');
  if (!textValue(eventId)) throw Error('알림 ID를 한 줄로 입력하세요.');
  applyInspectionDelivery(session,{eventId,equipmentId,type:'inspection.completed'});
  return session;
}

const markdownCell=text=>text.replace(/[\\|`*_<>[\]]/g,char=>'\\'+char);

export function checkStarterInspection(record) {
  const before=equipmentRows(record?.initialEquipment);
  if (!Array.isArray(record.initialHistory) || record.initialHistory.length) throw Error('수신 전 처리 이력 0건을 확인할 수 없습니다.');
  if (!Array.isArray(record.deliveries) || record.deliveries.length!==1) throw Error('수신 기록에 알림 한 건이 있어야 합니다.');
  const delivery=record.deliveries[0];
  if (!delivery || !textValue(delivery.eventId) || delivery.result!=='applied' || delivery.type!=='inspection.completed') {
    throw Error('검수 완료 알림의 ID와 최초 반영 결과를 확인하세요.');
  }
  const {eventId,equipmentId,type}=delivery, event={eventId,equipmentId,type};
  const target=before.find(row=>row.equipmentId===equipmentId);
  if (target?.inspectionStatus!=='검수 대기') throw Error('검수 알림의 대상은 입력 전 목록의 대기 장비여야 합니다.');
  if (!Array.isArray(record.history) || record.history.length!==1 ||
      !Object.entries(event).every(([key,value])=>record.history[0]?.[key]===value)) {
    throw Error('처리 이력 한 건의 알림 ID·장비 번호·종류가 수신 기록과 일치해야 합니다.');
  }
  const after=compareEquipment(before,record.equipment,equipmentId);
  const report=['# 검수 알림 전후 검증','',
    '대상 장비 '+markdownCell(equipmentId)+' · 알림 '+markdownCell(eventId)+' · 검수 완료 알림 1회 반영.','',
    '| 장비 번호 | 이름 | 입력 전 검수 | 입력 후 검수 | 입력 전 재대여 | 입력 후 재대여 |',
    '| --- | --- | --- | --- | --- | --- |'];
  for (const row of before) {
    const current=after.get(row.equipmentId);
    report.push('| '+[row.equipmentId,row.name,row.inspectionStatus,current.inspectionStatus,row.rentalApproval,current.rentalApproval].map(markdownCell).join(' | ')+' |');
  }
  report.push('','처리 이력은 입문 목록의 0건에서 검수 알림 반영 직후 1건으로 늘었습니다.',
    '수신 기록 1건과 처리 이력 1건의 알림 ID·장비 번호·종류가 일치합니다. 모든 장비의 재대여 승인이 입력 전과 같습니다.','');
  return {event,report:report.join('\n')};
}

export function advancedInspectionEvent(event) {
  const pending=createInspectionSession().equipment.filter(row=>row.inspectionStatus==='검수 대기');
  if (pending.some(row=>row.equipmentId===event.equipmentId)) return {...event};
  const equipmentId=pending[0].equipmentId;
  return {...event,equipmentId,eventId:event.eventId+'-'+equipmentId};
}
