import {createInspectionSession} from './inspection-receiver.mjs';
import {updateMarkdownSection} from './markdown-section.mjs';

export const recoveryScenarios = [
  {id:'out-of-order', title:'역순 도착'},
  {id:'before-save', title:'저장 직전 실패 후 재전송'},
  {id:'after-save', title:'저장 후 응답 유실 후 재전송'},
];
export const recoveryResultNames = {
  applied:'반영', stale:'늦은 알림', failed_before_commit:'저장 직전 실패', response_lost:'저장 후 응답 유실', duplicate:'중복 수신',
};

function initialRows() {
  return createInspectionSession().equipment.map(row => ({...row,lastSequence:0}));
}
function eventFor(equipmentId,scenarioId,sequence,type) {
  return {eventId:[equipmentId,scenarioId,sequence].join('-'),equipmentId,sequence,type};
}
export function scenarioDeliveries(scenarioId,equipmentId='A-17') {
  const complete=eventFor(equipmentId,scenarioId,2,'inspection.completed');
  if (scenarioId==='out-of-order') return [
    {event:complete,fault:'none'}, {event:eventFor(equipmentId,scenarioId,1,'inspection.started'),fault:'none'},
  ];
  if (scenarioId!=='before-save' && scenarioId!=='after-save') throw new Error('시나리오를 선택하세요.');
  return [{event:complete,fault:scenarioId},{event:{...complete},fault:'none'}];
}
export function createRecoverySession() {
  return {equipment:initialRows(),history:[],attempts:[]};
}
const sameEvent=(a,b) => a && b && a.eventId===b.eventId && a.equipmentId===b.equipmentId && a.type===b.type && a.sequence===b.sequence;

export function applyRecoveryDelivery(session,input,fault='none') {
  const item=session.equipment.find(row=>row.equipmentId===input?.equipmentId);
  if (!item || typeof input.eventId!=='string' || !input.eventId.trim() || !Number.isSafeInteger(input.sequence) || input.sequence<1 ||
      !['inspection.started','inspection.completed'].includes(input.type) || !['none','before-save','after-save'].includes(fault)) {
    throw new Error('알림 ID, 장비 번호, 양의 정수 변경 순번, 검수 상태와 실패 지점을 확인하세요.');
  }
  const {eventId,equipmentId,sequence,type}=input;
  const event={eventId,equipmentId,sequence,type};
  const previous=session.attempts.find(attempt=>attempt.event.eventId===eventId);
  if (previous && !sameEvent(previous.event,event)) throw new Error('같은 알림 ID의 내용이 달라졌습니다.');
  let result;
  if (session.history.some(entry=>entry.eventId===eventId)) result='duplicate';
  else if (sequence<=item.lastSequence) result='stale';
  else if (fault==='before-save') result='failed_before_commit';
  else {
    // No work after this commit can roll back the business state when the response is lost.
    const changed={...item,lastSequence:sequence,inspectionStatus:type==='inspection.started' ? '검수 중' : '검수 완료'};
    session.equipment=session.equipment.map(row=>row===item ? changed : row);
    session.history=[...session.history,event];
    result=fault==='after-save' ? 'response_lost' : 'applied';
  }
  const attempt=structuredClone({event,fault,result,equipment:session.equipment,history:session.history});
  session.attempts.push(attempt);
  return structuredClone(attempt);
}

function sameRows(actual,expected) {
  return Array.isArray(actual) && actual.length===expected.length && expected.every(row=>{
    const observed=actual.find(item=>item?.equipmentId===row.equipmentId);
    return observed && Object.entries(row).every(([key,value])=>observed[key]===value);
  });
}
const expectedResults={
  'out-of-order':['applied','stale'], 'before-save':['failed_before_commit','applied'], 'after-save':['response_lost','duplicate'],
};
export function verifyRecoveryRecord(record) {
  const rows=initialRows();
  const target=rows.find(row=>row.equipmentId===record?.equipmentId && row.inspectionStatus==='검수 대기');
  if (!target || !sameRows(record.initialEquipment,rows) || !Array.isArray(record.scenarios) || record.scenarios.length!==3) return false;
  const completed=rows.map(row=>row===target ? {...row,lastSequence:2,inspectionStatus:'검수 완료'} : row);
  return recoveryScenarios.every(({id})=>{
    const attempts=record.scenarios.find(scenario=>scenario?.id===id)?.attempts;
    if (!Array.isArray(attempts) || attempts.length!==2) return false;
    const plan=scenarioDeliveries(id,target.equipmentId);
    return attempts.every((attempt,index)=>{
      const stored=id!=='before-save' || index===1;
      return attempt?.result===expectedResults[id][index] && attempt.fault===plan[index].fault &&
        sameEvent(attempt.event,plan[index].event) && sameRows(attempt.equipment,stored ? completed : rows) &&
        Array.isArray(attempt.history) && attempt.history.length===(stored ? 1 : 0) &&
        (!stored || sameEvent(attempt.history[0],plan[0].event));
    });
  });
}
export function makeRecoveryRecord(equipmentId,sessions) {
  const scenarios=recoveryScenarios.map(({id})=>({id,attempts:structuredClone(sessions[id].attempts)}));
  const record={equipmentId,initialEquipment:initialRows(),scenarios};
  return {...record,verified:verifyRecoveryRecord(record)};
}

const skillStart='<!-- inspection-recovery:begin -->';
const skillEnd='<!-- inspection-recovery:end -->';
const skillHeading='## 검수 알림의 역순 도착과 재전송 점검';
const skillUpdate=[skillStart,skillHeading,'',
  '시나리오별로 초기 상태를 복원한다. 검수 대기 장비 한 대를 고르고, 모든 장비의 검수 상태와 재대여 승인 및 초기 처리 이력을 기록한다.',
  '',
  '- 역순 도착 — 같은 장비의 완료(변경 순번 2)를 먼저 보내고 시작(순번 1)을 보낸다. 늦은 시작을 수신 기록에 남기고, 저장된 검수 상태와 순번 및 처리 이력이 첫 반영 이후와 같은지 대조한다.',
  '- 저장 직전 실패 후 재전송 — 첫 시도의 저장을 실패시킨다. 장비가 검수 대기이고 이력이 비어 있는지 확인한다. 같은 ID로 재전송하고 완료 상태와 이력 한 건을 대조한다.',
  '- 저장 후 응답 유실 후 재전송 — 첫 저장이 끝난 뒤 응답을 유실시킨다. 재전송 전에 이미 완료 상태와 이력 한 건인지 확인한다. 같은 ID의 재전송이 중복으로 기록되고 이력이 한 건인지 확인한다.',
  '',
  '각 시도 직후 알림 ID, 장비별 변경 순번, 수신 결과, 전체 장비 상태와 처리 이력을 남긴다. 대상 이외 장비와 모든 재대여 승인 값은 초기 기록에 대조한다. 관찰하지 못한 시점은 미검증으로 기록한다.',skillEnd].join('\n');

export function makeRecoveryDocuments(previousReport,previousSkill,record) {
  if (!previousReport?.trim() || !previousSkill?.trim()) throw new Error('고급 개발 보고서와 고급 점검 Skill을 입력하세요.');
  if (!verifyRecoveryRecord(record)) throw new Error('세 시나리오의 두 시도를 모두 검증하세요.');
  const report=['# 시도별 검증 보고서','','대상 장비 '+record.equipmentId+' · 시나리오 3건, 수신 시도 6회 검증 통과.','',
    '## 고급 개발 보고서 원문','',...previousReport.split(/\r?\n/).map(line=>'> '+line),'','## 초기 장비 상태',''];
  function addRows(rows) {
    report.push('| 장비 | 검수 상태 | 적용 순번 | 재대여 승인 |','| --- | --- | --- | --- |',
      ...rows.map(row=>'| '+row.equipmentId+' '+row.name+' | '+row.inspectionStatus+' | '+row.lastSequence+' | '+row.rentalApproval+' |'),'');
  }
  addRows(record.initialEquipment);
  for (const {id,title} of recoveryScenarios) {
    report.push('## '+title,'');
    const attempts=record.scenarios.find(scenario=>scenario.id===id).attempts;
    for (const [i,attempt] of attempts.entries()) {
      report.push('### '+(i+1)+'차 수신 · '+recoveryResultNames[attempt.result],'',
        '알림 '+attempt.event.eventId+' · '+attempt.event.type+' · 변경 순번 '+attempt.event.sequence+'.','');
      addRows(attempt.equipment);
      report.push('처리 이력 '+attempt.history.length+'건'+(attempt.history.length?' — '+attempt.history.map(entry=>entry.eventId).join(', '):'')+'.','');
    }
  }
  report.push('각 시도에서 대상 이외 장비의 상태와 모든 재대여 승인 값이 초기 목록과 일치했다.');
  const updated=updateMarkdownSection(previousSkill,skillUpdate,skillHeading,'inspection-recovery');
  return {report:report.join('\n')+'\n',skill:updated};
}
