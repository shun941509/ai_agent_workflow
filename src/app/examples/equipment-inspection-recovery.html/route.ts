import {inspectionRecoveryHtml} from '../../../domain/equipment-inspection-recovery-example';

export const dynamic='force-static';

export function GET() {
  return new Response(inspectionRecoveryHtml,{headers:{'Content-Type':'text/html; charset=utf-8'}});
}
