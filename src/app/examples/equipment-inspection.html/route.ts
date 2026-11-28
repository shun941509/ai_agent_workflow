import {inspectionExampleHtml} from '../../../domain/equipment-inspection-example';

export const dynamic = 'force-static';

export function GET() {
  return new Response(inspectionExampleHtml, {
    headers: {'Content-Type':'text/html; charset=utf-8'},
  });
}
