import assert from 'node:assert/strict';
import {once} from 'node:events';
import test from 'node:test';
import {createInspectionWebhook} from './inspection-webhook.mjs';
import {defaultInspectionEvent, verifyInspectionReceipt} from './inspection-receiver.mjs';

test('같은 검수 알림을 두 번 POST해도 해당 장비의 검수 상태만 갱신하고 이력은 한 건을 남긴다', async () => {
  const server = createInspectionWebhook();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const send = () => fetch(base + '/inspection', {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(defaultInspectionEvent),
    });
    for (const expected of ['applied','duplicate']) {
      const response = await send();
      assert.equal(response.status, 200);
      assert.equal((await response.json()).result, expected);
    }
    const receipt = await (await fetch(base + '/receipt')).json();
    assert.equal(receipt.history.length, 1);
    assert.equal(receipt.deliveries.length, 2);
    assert.ok(verifyInspectionReceipt(receipt));
    const expectedRows = receipt.initialEquipment.map(row => row.equipmentId === defaultInspectionEvent.equipmentId
      ? {...row, inspectionStatus:'검수 완료'} : row);
    assert.deepEqual(receipt.equipment, expectedRows);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
