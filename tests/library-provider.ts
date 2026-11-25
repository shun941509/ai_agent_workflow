import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

export async function port() {
  const s = createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const value = s.address();
  assert.ok(value && typeof value === 'object');
  const n = value.port;
  await new Promise<void>((resolve, reject) =>
    s.close((e) => (e ? reject(e) : resolve()))
  );
  return String(n);
}
export async function stop(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.kill();
  await exit;
}
export async function provider() {
  const child = spawn(
    process.execPath,
    ['src/mcp/server.ts'],
    { stdio:'pipe',windowsHide:true,env:{
      NODE_ENV:'test',SystemRoot:process.env.SystemRoot,
      STUDIO_DATA_DIR:process.env.STUDIO_DATA_DIR,STUDIO_MCP_PORT:process.env.STUDIO_MCP_PORT,
      STUDIO_MCP_TOKEN:process.env.STUDIO_MCP_TOKEN,
    }}
  );
  let resolve!: () => void, reject!: (err: Error) => void;
  const ready = new Promise<void>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  const timer = setTimeout(
    () => reject(new Error('시험 MCP 시작 시간 초과')),
    10_000
  );
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (line: string) => {
    if (line.includes('준비 완료')) resolve();
  });
  child.once('error', reject);
  child.once('exit', (code) => reject(new Error('MCP 종료 ' + code)));
  try {
    await ready;
    return child;
  } catch (e) {
    await stop(child);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
