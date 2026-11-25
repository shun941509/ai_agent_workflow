import { key } from './db';
import { requireThat, StudioError } from './errors';
export async function library(
  name: string,
  args: Record<string, unknown>,
  owner: string,
  scope: string,
  operationId = '',
  approved = false
) {
  const token = process.env.STUDIO_MCP_TOKEN;
  requireThat(
    token,
    503,
    '도서관 MCP가 준비되지 않았습니다. start.cmd로 실행하세요.'
  );
  const response = await fetch(
    'http://127.0.0.1:' + Number(process.env.STUDIO_MCP_PORT || 3101) + '/mcp',
    {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + token,
        'x-studio-user': owner,
        'x-studio-scope': scope,
        'x-studio-operation': operationId,
        'x-studio-approved': approved ? '1' : '0',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: key(),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }
  );
  requireThat(response.ok, 502, '도서관 서비스 연결을 확인하세요.');
  const data = await response.json();
  requireThat(
    !data.error && !data.result?.isError,
    422,
    data.error?.message || '도서관 요청을 처리하지 못했습니다.'
  );
  return data.result.structuredContent;
}
function matchingReply(raw: string, id: string) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StudioError(502, '외부 MCP 응답 형식을 확인하세요.');
  }
  return (Array.isArray(parsed) ? parsed : [parsed]).find(
    (message) =>
      message?.jsonrpc === '2.0' &&
      message.id === id &&
      ('result' in message || 'error' in message)
  );
}
async function readRpcReply(response: Response, id: string) {
  const stream = response.headers
    .get('content-type')
    ?.includes('text/event-stream');
  const reader = response.body?.getReader();
  requireThat(reader, 502, '외부 MCP 응답이 비어 있습니다.');
  const decoder = new TextDecoder();
  let pending = '',
    bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) {
        pending += decoder.decode();
        if (!stream) return matchingReply(pending, id);
        break;
      }
      bytes += part.value.byteLength;
      requireThat(bytes <= 2_000_000, 502, 'MCP 결과가 너무 큽니다.');
      pending += decoder.decode(part.value, { stream: true });
      if (!stream) continue;
      // JSON-RPC notifications and requests may precede the response on the same SSE stream.
      const events = pending.split(/\r?\n\r?\n/);
      pending = events.pop()!;
      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (!data) continue;
        const reply = matchingReply(data, id);
        if (reply) return reply;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function rpc(
  url: string,
  method: string,
  params: unknown,
  headers: Record<string, string>,
  notification = false
) {
  const id = key();
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      ...headers,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      ...(notification ? {} : { id }),
      method,
      params,
    }),
  });
  requireThat(response.ok, 502, '외부 MCP 연결에 실패했습니다.');
  if (notification) {
    await response.body?.cancel();
    return { value: {}, session: '' };
  }
  const payload = await readRpcReply(response, id);
  requireThat(
    payload?.result && !payload.error && !payload.result.isError,
    502,
    '외부 MCP가 요청을 처리하지 못했습니다.'
  );
  return {
    value: payload.result,
    session: response.headers.get('mcp-session-id') || '',
  };
}
export async function externalMcp(
  payload: Record<string, any>,
  tool: string,
  args: Record<string, unknown>,
  test: boolean
) {
  const url = test ? payload.testUrl : payload.url;
  requireThat(url, 409, '이 연결은 격리 시험 환경을 제공하지 않습니다.');
  const headers: Record<string, string> = {};
  const credential = payload.credentialEnv;
  if (credential) {
    requireThat(
      /^STUDIO_CONNECTOR_[A-Z0-9_]+$/.test(credential),
      400,
      '자격증명 이름을 확인하세요.'
    );
    const secret = process.env[credential];
    requireThat(secret, 503, '운영자 자격증명이 설정되지 않았습니다.');
    headers.authorization = 'Bearer ' + secret;
  }
  const init = await rpc(
    url,
    'initialize',
    {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'workflow-studio', version: '1' },
    },
    headers
  );
  if (init.session) headers['mcp-session-id'] = init.session;
  headers['mcp-protocol-version'] = init.value.protocolVersion || '2025-03-26';
  await rpc(url, 'notifications/initialized', {}, headers, true);
  const call = await rpc(
    url,
    'tools/call',
    { name: tool, arguments: args },
    headers
  );
  return call.value.structuredContent ?? call.value.content;
}
