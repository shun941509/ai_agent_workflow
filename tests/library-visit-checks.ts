import assert from 'node:assert/strict';
import type { Graph } from '../src/domain';
import type { EngineEvent } from '../src/engine/types';

export const visitCaseName = '토요일 방문과 예약 조회';

export function checkVisitResources(graph: Graph, events: EngineEvent[], pickupVersion: number) {
  function result(id: string, kind: EngineEvent['kind'] = 'result') {
    const found = events.filter(event => event.nodeId === id && event.kind === kind);
    assert.equal(found.length, 1, id + '의 ' + kind + ' 기록이 한 건이어야 합니다.');
    return found[0].data as Record<string, unknown>;
  }
  const assetId = (id: string) => graph.nodes.find(node => node.id === id)?.config.assetId;
  for (const id of ['pickup', 'format', 'hours', 'library']) {
    assert.ok(assetId(id), id + '에는 등록된 자료판이 필요합니다.');
    assert.equal(Number(result(id).version), id === 'pickup' ? pickupVersion : 1);
  }
  const passages = result('search-hours', 'lookup').passages;
  assert.ok(Array.isArray(passages) && passages.some(item =>
    item.assetId === assetId('hours') && item.version === '1' && item.quote.includes('토요일 오전 10시부터 오후 4시까지')),
    '지식 저장소 1판의 실제 운영시간 원문을 찾아야 합니다.');
  assert.ok(events.some(event => event.nodeId === 'lookup' && event.kind === 'tool' &&
    event.detail === 'mcp.' + assetId('library') + '.reservations.list 호출'), '연결한 MCP로 내 시험 예약을 조회해야 합니다.');
  const response = result('lookup').value as {reservations: {book: string; branch: string}[]};
  assert.deepEqual(response.reservations.map(({book, branch}) => ({book, branch})),
    [{book: '어린 왕자', branch: '중앙도서관'}]);
}

export function checkVisitAnswer(output: string, pickupVersion: number) {
  const lines = output.trim().split(/\r?\n/).map(line => line.replace(/\*\*/g, '').trim()).filter(Boolean);
  assert.equal(lines.length, 3, 'Skill에 따라 방문 시간, 준비물, 예약 내역을 세 줄로 안내해야 합니다.\n' + output);
  assert.match(lines[0], /^방문 시간\s*[:：]/);
  assert.match(lines[1], /^준비물\s*[:：]/);
  assert.match(lines[2], /^예약 내역\s*[:：]/);
  assert.match(lines[0], /토요일/);
  assert.match(lines[0], /10\s*(?:시|:00)/);
  assert.match(lines[0], /(?:오후\s*4|16)\s*(?:시|:00)/);
  const quote = pickupVersion === 1 ? '회원증이 필요합니다.' : '모바일 회원증도 가능합니다.';
  assert.ok(lines[1].includes(quote), '선택한 수령 규정의 원문이 필요합니다.\n' + output);
  if (pickupVersion === 1) assert.doesNotMatch(lines[1], /모바일/);
  assert.match(lines[2], /어린 왕자/);
  assert.match(lines[2], /중앙도서관/);
  return {hours: lines[0], reservations: lines[2]};
}
