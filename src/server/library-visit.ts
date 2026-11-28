import type { Graph } from '../domain';
import { createLibraryLookupConnection, writeAsset } from './assets';
import type { User } from './auth';
import { requireThat } from './errors';

/** Install the selected editions in the same transaction as this new template project. */
export function installVisitMaterials(user: User, graph: Graph) {
  function node(id: string) {
    const found = graph.nodes.find(item => item.id === id);
    requireThat(found, 500, '방문 준비 실습의 블록 구성을 확인하세요.');
    return found;
  }
  function add(id: string, kind: 'document' | 'knowledge' | 'skill', content: string) {
    const source = node(id);
    const asset = writeAsset(user, {kind, name:source.title, payload:{content}});
    source.config = {assetId:asset.id, version:asset.version};
    return asset;
  }

  const pickup = add('pickup', 'document', '회원증이 필요합니다.');
  writeAsset(user, {id:pickup.id, baseVersion:1, name:pickup.name, payload:{content:'등록된 학생증도 가능합니다.'}});
  add('hours', 'knowledge', '중앙도서관은 토요일 오전 10시부터 오후 4시까지 엽니다.');
  add('format', 'skill', [
    '# 방문 안내 작성',
    '방문 시간, 준비물, 예약 내역 순서로 정확히 세 줄을 작성하세요.',
    '첫 줄은 “방문 시간: ” 다음에 운영 안내에서 검색한 문장을 그대로 적으세요.',
    '둘째 줄은 “준비물: ” 다음에 연결된 수령 규정 원문을 그대로 적으세요.',
    '셋째 줄은 “예약 내역: ” 다음에 조회한 도서명과 지점을 “도서명 (지점)”으로 적으세요. 여러 권이면 쉼표로 구분하고, 빈 목록이면 “예약 없음”이라고 적으세요.',
  ].join('\n'));
  const library = node('library');
  const connection = createLibraryLookupConnection(user, library.title);
  library.config = {assetId:connection.id, version:connection.version};
  node('lookup').config.tool = 'mcp.' + connection.id + '.reservations.list';
}
