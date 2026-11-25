import { createServer, type IncomingMessage } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const token = process.env.STUDIO_MCP_TOKEN;
if (!token) throw new Error('STUDIO_MCP_TOKEN must be set by the launcher.');
const dir = resolve(process.env.STUDIO_DATA_DIR || '.studio-data');
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(join(dir, 'library.sqlite'));
db.exec(`PRAGMA busy_timeout=8000; PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,scope TEXT NOT NULL,book TEXT NOT NULL,branch TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, owner TEXT NOT NULL,scope TEXT NOT NULL,name TEXT NOT NULL,args TEXT NOT NULL,result TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS fixtures(scope TEXT PRIMARY KEY, owner TEXT NOT NULL);`);
const schema = (
  properties: Record<string, unknown>,
  required: string[] = []
) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' };
const tools = [
  {
    name: 'reservations.list',
    description: '실행자 본인의 예약을 조회합니다.',
    inputSchema: schema({}),
  },
  {
    name: 'reservations.create',
    description: '도서와 수령 지점으로 예약을 만듭니다.',
    inputSchema: schema({ book: str, branch: str }, ['book', 'branch']),
  },
  {
    name: 'reservations.cancel',
    description: '본인의 예약 번호를 취소합니다.',
    inputSchema: schema({ reservationId: str }, ['reservationId']),
  },
];
function bounded(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300)
    throw new Error(label + '을 확인하세요.');
  return value.trim();
}
function op(
  name: string,
  a: Record<string, unknown>,
  owner: string,
  scope: string,
  operation: string,
  approved: boolean
) {
  if (name === 'reservations.list')
    return {
      reservations: db
        .prepare(
          'SELECT id,book,branch,status FROM reservations WHERE owner=? AND scope=? ORDER BY created DESC'
        )
        .all(owner, scope),
    };
  if (name === 'studio.receipt') {
    const row = db
      .prepare('SELECT result FROM receipts WHERE id=? AND owner=? AND scope=?')
      .get(operation, owner, scope);
    return row
      ? { found: true, result: JSON.parse(String(row.result)) }
      : { found: false };
  }
  if (!approved || !operation) throw new Error('작업 승인이 필요합니다.');
  const args =
    name === 'reservations.create'
      ? {
          book: bounded(a.book, '도서명'),
          branch: bounded(a.branch, '수령 지점'),
        }
      : name === 'reservations.cancel'
        ? { reservationId: bounded(a.reservationId, '예약 번호') }
        : null;
  if (!args) throw new Error('알 수 없는 도구입니다.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const receipt = db
      .prepare('SELECT * FROM receipts WHERE id=?')
      .get(operation);
    if (receipt) {
      if (
        receipt.owner !== owner ||
        receipt.scope !== scope ||
        receipt.name !== name ||
        receipt.args !== JSON.stringify(args)
      )
        throw new Error('이 요청 번호의 내용이 다릅니다.');
      db.exec('COMMIT');
      return JSON.parse(String(receipt.result));
    }
    let result: Record<string, unknown>;
    if (
      'book' in args &&
      typeof args.book === 'string' &&
      typeof args.branch === 'string'
    ) {
      const id = randomUUID();
      db.prepare('INSERT INTO reservations VALUES(?,?,?,?,?,?,?)').run(
        id,
        owner,
        scope,
        args.book,
        args.branch,
        'confirmed',
        new Date().toISOString()
      );
      result = { reservationId: id, ...args, status: 'confirmed' };
    } else {
      const id = bounded(args.reservationId, '예약 번호');
      const changed = db
        .prepare(
          "UPDATE reservations SET status='cancelled' WHERE id=? AND owner=? AND scope=? AND status='confirmed'"
        )
        .run(id, owner, scope);
      if (!changed.changes)
        throw new Error('취소 가능한 본인의 예약을 찾을 수 없습니다.');
      result = { reservationId: id, status: 'cancelled' };
    }
    db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?)').run(
      operation,
      owner,
      scope,
      name,
      JSON.stringify(args),
      JSON.stringify(result)
    );
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
function seed(scope: string, owner: string, data: unknown) {
  if (scope === 'live' || !scope.startsWith('test:'))
    throw new Error('시험 범위를 확인하세요.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const seen = db
      .prepare('SELECT owner FROM fixtures WHERE scope=?')
      .get(scope);
    if (!seen) {
      db.prepare('INSERT INTO fixtures VALUES(?,?)').run(scope, owner);
      for (const [i, item] of (Array.isArray(data) ? data : [])
        .slice(0, 20)
        .entries()) {
        const id = scope + ':' + i;
        db.prepare('INSERT INTO reservations VALUES(?,?,?,?,?,?,?)').run(
          id,
          owner,
          scope,
          bounded(item.book, '도서명'),
          bounded(item.branch, '지점'),
          'confirmed',
          new Date().toISOString()
        );
      }
    }
    db.exec('COMMIT');
    return { ready: true };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
async function body(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 131072) throw new Error('Request too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
const server = createServer(async (req, res) => {
  const supplied = Buffer.from(String(req.headers.authorization || '')),
    expected = Buffer.from('Bearer ' + token);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    res.writeHead(401);
    res.end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/mcp') {
    res.writeHead(404);
    res.end();
    return;
  }
  let id: unknown = null;
  try {
    const message = await body(req);
    id = message.id ?? null;
    if (message.jsonrpc !== '2.0') throw new Error('JSON-RPC 2.0 required');
    if (message.method === 'notifications/initialized') {
      res.writeHead(202);
      res.end();
      return;
    }
    let result: unknown;
    if (message.method === 'initialize')
      result = {
        protocolVersion: message.params?.protocolVersion || '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'studio-library', version: '1.0.0' },
      };
    else if (message.method === 'tools/list') result = { tools };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/call') {
      const params = message.params || {};
      const scope = bounded(req.headers['x-studio-scope'], '범위'),
        owner = bounded(req.headers['x-studio-user'], '실행자');
      const operation = String(req.headers['x-studio-operation'] || '');
      const value =
        params.name === 'studio.seed'
          ? seed(scope, owner, params.arguments?.reservations)
          : op(
              params.name,
              params.arguments || {},
              owner,
              scope,
              operation,
              req.headers['x-studio-approved'] === '1'
            );
      result = {
        content: [{ type: 'text', text: JSON.stringify(value) }],
        structuredContent: value,
      };
    } else throw new Error('지원하지 않는 MCP 메서드입니다.');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32001,
          message: e instanceof Error ? e.message : 'MCP 오류',
        },
      })
    );
  }
});
server.listen(Number(process.env.STUDIO_MCP_PORT || 3101), '127.0.0.1', () =>
  console.log('도서관 MCP 준비 완료')
);
