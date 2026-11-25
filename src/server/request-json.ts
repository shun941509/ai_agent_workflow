import { requireThat } from './errors';

/** Bound the transferred bytes even if the sender omits or misstates Content-Length. */
export async function readJsonBody(
  request: Request,
  maxBytes: number
): Promise<any> {
  requireThat(
    Number(request.headers.get('content-length') || 0) <= maxBytes,
    413,
    '요청이 너무 큽니다.'
  );
  const reader = request.body?.getReader();
  requireThat(reader, 400, 'JSON 요청 내용이 필요합니다.');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        requireThat(false, 413, '요청이 너무 큽니다.');
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
