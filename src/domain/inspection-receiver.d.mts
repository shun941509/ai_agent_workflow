interface EquipmentRow {
  equipmentId:string;
  name:string;
  inspectionStatus:string;
  rentalApproval:string;
}

interface InspectionEvent {
  eventId:string;
  equipmentId:string;
  type:'inspection.completed';
}

export interface InspectionSession {
  equipment:EquipmentRow[];
  history:InspectionEvent[];
  deliveries:(InspectionEvent & {result:'applied'|'duplicate'})[];
}

export const defaultInspectionEvent:InspectionEvent;
export function createInspectionSession():InspectionSession;
export function applyInspectionDelivery(session:InspectionSession, input:unknown):'applied'|'duplicate';
export function verifyInspectionReceipt(record:unknown):boolean;
export function makeInspectionReceipt(session:InspectionSession):InspectionSession & {initialEquipment:EquipmentRow[]; verified:boolean};
