import {createServer} from 'node:http';
import {applyInspectionDelivery, createInspectionSession, makeInspectionReceipt} from './inspection-receiver.mjs';

// A fresh server is one learner's exercise. The caller binds it to loopback.
export function createInspectionWebhook() {
  const session = createInspectionSession();
  return createInspectionHttpServer({
    receipt:() => makeInspectionReceipt(session),
    receive:event => ({status:200, body:{result:applyInspectionDelivery(session, event)}}),
  });
}

export function createInspectionHttpServer({receipt, receive}) {
  return createServer(async (request, response) => {
    function json(status, data) {
      response.writeHead(status, {'content-type':'application/json; charset=utf-8'});
      response.end(JSON.stringify(data));
    }
    if (request.url === '/receipt' && request.method === 'GET') return json(200, receipt());
    if (request.url !== '/inspection' || request.method !== 'POST') return json(404, {error:'알 수 없는 요청입니다.'});
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
      return json(415, {error:'JSON 형식으로 검수 알림을 보내세요.'});
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 8192) return json(413, {error:'검수 알림은 8 KiB 이내로 보내세요.'});
        chunks.push(chunk);
      }
      const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const reply = receive(event, request.headers);
      if (reply === null) return response.destroy();
      json(reply.status, reply.body);
    } catch (error) {
      json(400, {error:error instanceof SyntaxError ? '올바른 JSON을 입력하세요.' : error.message});
    }
  });
}
