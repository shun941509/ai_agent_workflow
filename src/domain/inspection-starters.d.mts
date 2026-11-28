import type {InspectionSession} from './inspection-receiver.mjs';

export type StarterEquipment=InspectionSession['equipment'][number];
export type StarterRecord=InspectionSession & {initialEquipment:StarterEquipment[];initialHistory:InspectionSession['history']};
export const inspectionStatuses:string[];
export const rentalApprovals:string[];
export function makeStarterList(rows:unknown):StarterRecord;
export function readStarterList(record:unknown):StarterRecord;
export function receiveStarterInspection(record:unknown,equipmentId:string,eventId:string):StarterRecord;
export function checkStarterInspection(record:unknown):{event:InspectionSession['history'][number];report:string};
export function advancedInspectionEvent(event:InspectionSession['history'][number]):InspectionSession['history'][number];
