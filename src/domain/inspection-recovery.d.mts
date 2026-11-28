export type ScenarioId = 'out-of-order'|'before-save'|'after-save';
export type Fault = 'none'|'before-save'|'after-save';
export type RecoveryResult = 'applied'|'stale'|'failed_before_commit'|'response_lost'|'duplicate';
export interface RecoveryEvent {eventId:string;equipmentId:string;sequence:number;type:'inspection.started'|'inspection.completed'}
export interface RecoveryEquipment {equipmentId:string;name:string;inspectionStatus:string;rentalApproval:string;lastSequence:number}
export interface RecoveryAttempt {event:RecoveryEvent;fault:Fault;result:RecoveryResult;equipment:RecoveryEquipment[];history:RecoveryEvent[]}
export interface RecoverySession {equipment:RecoveryEquipment[];history:RecoveryEvent[];attempts:RecoveryAttempt[]}
export interface RecoveryRecord {equipmentId:string;initialEquipment:RecoveryEquipment[];scenarios:{id:ScenarioId;attempts:RecoveryAttempt[]}[];verified:boolean}
export const recoveryScenarios:readonly {id:ScenarioId;title:string}[];
export const recoveryResultNames:Record<RecoveryResult,string>;
export function scenarioDeliveries(id:ScenarioId,equipmentId?:string):{event:RecoveryEvent;fault:Fault}[];
export function createRecoverySession():RecoverySession;
export function applyRecoveryDelivery(session:RecoverySession,event:RecoveryEvent,fault?:Fault):RecoveryAttempt;
export function makeRecoveryRecord(equipmentId:string,sessions:Record<string,RecoverySession>):RecoveryRecord;
export function verifyRecoveryRecord(record:unknown):boolean;
export function makeRecoveryDocuments(previousReport:string,previousSkill:string,record:RecoveryRecord):{report:string;skill:string};
