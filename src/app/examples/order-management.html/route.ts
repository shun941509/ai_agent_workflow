import { orderManagementHtml } from '../../../domain/web-design-example';

export const dynamic = 'force-static';

export function GET() {
  return new Response(orderManagementHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': 'attachment; filename="order-management.html"',
    },
  });
}
