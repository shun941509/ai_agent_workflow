import assert from 'node:assert/strict';
import {once} from 'node:events';
import test from 'node:test';
import {createInspectionRecoveryWebhook} from './inspection-recovery-webhook.mjs';

const completed = {eventId:'verify-complete', equipmentId:'B-08', sequence:2, type:'inspection.completed'};
const started = {eventId:'verify-start', equipmentId:'B-08', sequence:1, type:'inspection.started'};

async function localReceiver(t) {
  const server = createInspectionRecoveryWebhook();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = 'http://127.0.0.1:' + server.address().port;
  return {
    send:(event, fault='none') => fetch(base + '/inspection', {
      method:'POST', headers:{'content-type':'application/json','x-practice-fault':fault}, body:JSON.stringify(event),
    }),
    state:async () => (await fetch(base + '/receipt')).json(),
  };
}

function checkState(initial, current, committed, results) {
  const expected = initial.equipment.map(row => row.equipmentId === completed.equipmentId && committed
    ? {...row, inspectionStatus:'검수 완료', lastSequence:completed.sequence} : row);
  assert.deepEqual(current.equipment, expected);
  assert.deepEqual(current.history, committed ? [completed] : []);
  assert.deepEqual(current.attempts.map(attempt => attempt.result), results);
  const latest = current.attempts.at(-1);
  assert.deepEqual(latest.equipment, current.equipment);
  assert.deepEqual(latest.history, current.history);
}

test('완료 2번 뒤에 시작 1번이 도착해도 완료를 유지하고 늦은 알림은 수신 기록에 남는다', async t => {
  const receiver = await localReceiver(t);
  const initial = await receiver.state();
  assert.equal((await receiver.send(completed)).status, 200);
  checkState(initial, await receiver.state(), true, ['applied']);
  assert.equal((await receiver.send(started)).status, 200);
  const final = await receiver.state();
  checkState(initial, final, true, ['applied','stale']);
  assert.deepEqual(final.attempts.map(attempt => attempt.event), [completed, started]);
});

test('저장 직전 실패는 HTTP 503과 이력 0건을 남기고 같은 본문의 재전송을 한 번 반영한다', async t => {
  const receiver = await localReceiver(t);
  const initial = await receiver.state();
  const failure = await receiver.send(completed,'before-save');
  assert.equal(failure.status, 503);
  assert.equal((await failure.json()).result, 'failed_before_commit');
  checkState(initial, await receiver.state(), false, ['failed_before_commit']);
  const success = await receiver.send(completed);
  assert.equal(success.status, 200);
  assert.equal((await success.json()).result, 'applied');
  const final = await receiver.state();
  checkState(initial, final, true, ['failed_before_commit','applied']);
  assert.deepEqual(final.attempts.map(attempt => attempt.event), [completed, completed]);
});

test('저장 후 응답 유실은 소켓을 끊고 이미 반영된 상태와 이력을 재전송 뒤에도 유지한다', async t => {
  const receiver = await localReceiver(t);
  const initial = await receiver.state();
  await assert.rejects(receiver.send(completed,'after-save'), error =>
    error.cause?.code === 'UND_ERR_SOCKET' || error.cause?.code === 'ECONNRESET');
  checkState(initial, await receiver.state(), true, ['response_lost']);
  const repeated = await receiver.send(completed);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).result, 'duplicate');
  const final = await receiver.state();
  checkState(initial, final, true, ['response_lost','duplicate']);
  assert.deepEqual(final.attempts.map(attempt => attempt.event), [completed, completed]);
});
