import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { once } from 'node:events';
import { createServer } from 'node:net';

const require = createRequire(import.meta.url);
let supervisor;
let isolated;
const inherited = process.env.STUDIO_TEST_URL;
const live = process.argv.includes('--live');
const testConnectorCredential = 'shared-regression-fixture';
function started(args, env = process.env, ipc = false) {
  return spawn(process.execPath, args, {
    env,
    stdio: ipc ? ['ignore', 'inherit', 'inherit', 'ipc'] : 'inherit',
    windowsHide: true,
  });
}
async function successful(args, env) {
  const child = started(args, env);
  const [status, signal] = await once(child, 'exit');
  if (status !== 0)
    throw Error(
      '검증 명령 실패 (' + (signal || status) + '): ' + args.join(' ')
    );
}
async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const assigned = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
  return assigned;
}
try {
  let url = inherited;
  if (!url) {
    await successful(
      [require.resolve('next/dist/bin/next'), 'build', '--webpack'],
      { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
    );
    isolated = await mkdtemp(join(tmpdir(), 'studio-browser-'));
    const webPort = await port();
    let mcpPort = await port();
    while (mcpPort === webPort) mcpPort = await port();
    url = 'http://127.0.0.1:' + webPort;
    const serviceEnv = {
      ...process.env,
      PORT: String(webPort),
      STUDIO_MCP_PORT: String(mcpPort),
      STUDIO_DATA_DIR: isolated,
    };
    if (!live)
      Object.assign(serviceEnv, {
        STUDIO_DISABLE_MODEL: '1',
        STUDIO_CONNECTOR_GALLERY_FIXTURE: testConnectorCredential,
        OPENAI_API_KEY: '',
        OPENAI_MODEL: '',
      });
    supervisor = started(
      ['scripts/start.mjs', '--production'],
      serviceEnv,
      true
    );
    const deadline = Date.now() + 60000;
    for (;;) {
      if (supervisor.exitCode !== null || supervisor.signalCode !== null)
        throw Error('격리 시험 서버가 종료되었습니다.');
      try {
        const response = await fetch(url + '/login', {
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) break;
      } catch {}
      if (Date.now() >= deadline)
        throw Error('격리 시험 서버를 시작할 수 없습니다.');
      await wait(300);
    }
  }
  const env = { ...process.env, STUDIO_TEST_URL: url, ...(isolated ? { STUDIO_TEST_DATA_DIR: isolated } : {}) };
  const scripts = live
    ? ['live-service', 'live-tool-approval']
    : [
        'browser-smoke',
        'run-recovery-browser',
        'agent-decisions-browser',
        'creation-sharing-browser',
        'home-lesson-browser',
        'workflow-guide-browser',
        'beginner-reference-browser',
        'lesson-run-context-browser',
        'optional-practice-browser',
        'dynamic-policy-browser',
        'library-visit-browser',
        'editor-focus-proposal-browser',
        'editor-contracts-browser',
        'editor-source-navigation-browser',
        'canvas-editing-browser',
        'canvas-keyboard-browser',
        'canvas-zoom-browser',
        'canvas-placement-names-browser',
        'canvas-copy-browser',
        'canvas-connection-edit-browser',
        'canvas-placement-path-browser',
        'canvas-gesture-browser',
        'canvas-wire-browser',
        'canvas-history-browser',
        'engine-run-browser',
        'run-case-conversation-browser',
        'decision-csv-browser',
        'editor-repair-browser',
        'resource-library-browser',
        'shared-resource-gallery-browser',
        ...(env.STUDIO_TEST_DATA_DIR ? ['shared-mcp-copy-browser'] : []),
        'trigger-browser',
      ];
  for (const script of scripts) {
    const testEnv = isolated && script === 'shared-mcp-copy-browser'
      ? {...env, STUDIO_CONNECTOR_GALLERY_FIXTURE: testConnectorCredential} : env;
    await successful(['--import', 'tsx', 'tests/' + script + '.ts'], testEnv);
  }
} finally {
  if (
    supervisor &&
    supervisor.exitCode === null &&
    supervisor.signalCode === null
  ) {
    const closed = once(supervisor, 'exit');
    supervisor.send('stop');
    await closed;
  }
  if (isolated) {
    const target = await realpath(isolated);
    if (
      dirname(target) !== (await realpath(tmpdir())) ||
      !basename(target).startsWith('studio-browser-')
    )
      throw Error('시험 자료 경로를 확인하세요.');
    await rm(target, {
      recursive: true,
      force: true,
      maxRetries: 4,
      retryDelay: 200,
    });
  }
}
