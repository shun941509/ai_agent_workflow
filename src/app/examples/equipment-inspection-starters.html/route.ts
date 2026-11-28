import {inspectionStartersHtml} from '../../../domain/equipment-inspection-starters-example';

export const dynamic='force-static';

export function GET() {
  return new Response(inspectionStartersHtml,{headers:{'Content-Type':'text/html; charset=utf-8'}});
}
