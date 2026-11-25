import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { externalMcp } from '../src/server/mcp';

test('MCP 스트림은 같은 요청의 응답을 찾아 서버가 연결을 닫기 전에 도구 결과를 돌려준다', async (t) => {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { method, id } = JSON.parse(Buffer.concat(chunks).toString());
    if (method === 'initialize') {
      res
        .writeHead(200, {
          'content-type': 'application/json',
          'mcp-session-id': 'studio-sse',
        })
        .end(
          JSON.stringify({
            id,
            jsonrpc: '2.0',
            result: { protocolVersion: '2025-03-26' },
          })
        );
      return;
    }
    assert.equal(req.headers['mcp-session-id'], 'studio-sse');
    if (method === 'notifications/initialized') {
      res.writeHead(202).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const notify = {
      id: 'unrelated',
      jsonrpc: '2.0',
      result: { structuredContent: '다른 요청' },
    };
    res.write('data: ' + JSON.stringify(notify) + '\r\n\r\n');
    const reply = Buffer.from(
      'data: ' +
        JSON.stringify({
          id,
          jsonrpc: '2.0',
          result: { structuredContent: '도서 3권' },
        }) +
        '\r\n\r\n'
    );
    const split = reply.indexOf(Buffer.from('도서')) + 1;
    res.write(reply.subarray(0, split));
    setImmediate(() => res.write(reply.subarray(split)));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const result = await externalMcp(
    { url: 'http://127.0.0.1:' + address.port },
    'book.limit',
    {},
    false
  );
  assert.equal(result, '도서 3권');
});
