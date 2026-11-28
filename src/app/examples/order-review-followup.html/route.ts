import { reviewFollowupHtml } from '../../../domain/web-design-example';

export const dynamic = 'force-static';

export function GET() {
  return new Response(reviewFollowupHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': 'attachment; filename="order-review-followup.html"',
    },
  });
}
