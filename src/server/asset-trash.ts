import type {User} from './auth';
import type {MaterialLesson} from '../domain/optional-lesson-materials';
import {assetDto, assetRow, type AssetKind} from './assets';
import {all, key, now, one, set, tx} from './db';
import {requireThat, stringArg} from './errors';
import {evictAssetKnowledgeInTransaction} from './knowledge';

const retentionMs = 72 * 60 * 60 * 1000;
const cleanupBatch = 50;
const selectedIds = 'SELECT value FROM json_each(?)';
type Selection = {id:string; revision:number};
type TrashEntry = Selection & {name:string; kind:AssetKind; version:number; deletedAt:string; exampleLesson:MaterialLesson|null};

function cutoff(at = Date.now()) {
  return new Date(at - retentionMs).toISOString();
}

function reviewed(item: Selection) {
  requireThat(item && typeof item === 'object', 400, '선택한 자료 정보를 확인하세요.');
  const id = stringArg(item.id, '자료 번호', 150);
  requireThat(Number.isSafeInteger(item.revision) && item.revision > 0, 400, '목록에서 자료를 다시 선택하세요.');
  return {id, revision:item.revision};
}

export function deleteAsset(user: User, request: Selection) {
  const {id, revision} = reviewed(request);
  return tx(() => {
    const deleted = one<{revision:number}>(`SELECT r.revision FROM deleted_assets d
      JOIN assets a ON a.id=d.asset JOIN asset_revisions r ON r.asset=d.asset
      WHERE d.asset=? AND a.owner=?`, id, user.id);
    if (deleted) {
      // Retry only the delete that created this marker, even across multiple trash cycles.
      requireThat(deleted.revision === revision + 1, 409, '자료 상태가 변경되었습니다. 목록을 다시 확인하세요.');
      return {id};
    }
    const asset = assetRow(id);
    requireThat(asset.owner === user.id, 403, '내 자료만 삭제할 수 있습니다.');
    requireThat(asset.revision === revision, 409, '자료가 변경되었습니다. 최신 상태를 확인한 뒤 다시 삭제하세요.');
    set("UPDATE assets SET visibility='private', token=? WHERE id=?", key(), id);
    for (const table of ['asset_publications', 'asset_releases', 'asset_release_audiences'])
      set(`DELETE FROM ${table} WHERE asset=?`, id);
    set("DELETE FROM grants WHERE kind='asset' AND target=?", id);
    set('INSERT INTO deleted_assets(asset,deleted) VALUES(?,?)', id, now());
    return {id};
  });
}

// All callers select eligible trash markers under the same SQLite write lock.
function purgeInTransaction(ids: string[]) {
  if (!ids.length) return;
  const selected = JSON.stringify(ids);
  evictAssetKnowledgeInTransaction(ids);
  for (const table of [
    'asset_publications', 'asset_releases', 'asset_release_audiences',
    'asset_versions', 'asset_edition_names', 'deleted_assets',
  ])
    set(`DELETE FROM ${table} WHERE asset IN (${selectedIds})`, selected);
  set(`DELETE FROM grants WHERE kind='asset' AND target IN (${selectedIds})`, selected);
  set(`DELETE FROM assets WHERE id IN (${selectedIds})`, selected);
}

function purgeExpiredInTransaction(deadline: string, owner?: string) {
  const ownerFilter = owner === undefined ? '' : 'AND asset IN (SELECT id FROM assets WHERE owner=?)';
  const expired = all<{asset:string}>(`SELECT asset FROM deleted_assets WHERE deleted<=? ${ownerFilter}
      ORDER BY deleted,asset LIMIT ?`, deadline, ...(owner === undefined ? [] : [owner]), cleanupBatch);
  purgeInTransaction(expired.map(row => row.asset));
  return expired.length;
}

export function purgeExpiredAssets(at = Date.now()) {
  return tx(() => purgeExpiredInTransaction(cutoff(at)));
}

export function listTrashedAssets(user: User) {
  return tx(() => {
    const deadline = cutoff();
    purgeExpiredInTransaction(deadline, user.id);
    return all<TrashEntry>(`SELECT a.id,a.name,a.kind,a.version,r.revision,d.deleted AS deletedAt,m.lesson AS exampleLesson
      FROM deleted_assets d JOIN assets a ON a.id=d.asset JOIN asset_revisions r ON r.asset=a.id
      LEFT JOIN installed_lesson_materials m ON m.owner=a.owner AND m.asset=a.id
      WHERE a.owner=? AND d.deleted>? ORDER BY d.deleted DESC,a.id`, user.id, deadline)
      .map(row => ({...row, expiresAt:new Date(Date.parse(row.deletedAt) + retentionMs).toISOString()}));
  });
}

export function restoreAsset(user: User, request: Selection) {
  const {id, revision} = reviewed(request);
  const restored = tx(() => {
    const state = one<{revision:number; restored_revision:number|null; deleted:string|null}>(
      `SELECT coalesce(r.revision,1) AS revision,r.restored_revision,d.deleted FROM assets a
       LEFT JOIN deleted_assets d ON d.asset=a.id LEFT JOIN asset_revisions r ON r.asset=a.id
       WHERE a.id=? AND a.owner=?`, id, user.id);
    requireThat(state, 404, '휴지통에서 자료를 찾을 수 없습니다.');
    if (state.deleted === null) {
      requireThat(state.restored_revision === revision, 409, '이 자료는 휴지통에 없습니다.');
    } else {
      if (state.deleted <= cutoff()) {
        purgeInTransaction([id]);
        return;
      }
      requireThat(state.revision === revision, 409, '휴지통 목록이 변경되었습니다. 최신 목록에서 다시 선택하세요.');
      set("UPDATE assets SET visibility='private',token=? WHERE id=?", key(), id);
      set('UPDATE asset_revisions SET restored_revision=? WHERE asset=?', revision, id);
      set('DELETE FROM deleted_assets WHERE asset=?', id);
    }
    return assetDto(assetRow(id), user);
  });
  requireThat(restored, 404, '보관 기간이 지나 자료를 복구할 수 없습니다.');
  return restored;
}

export function purgeTrashedAssets(user: User, request: {items?:unknown}) {
  requireThat(Array.isArray(request.items) && request.items.length > 0, 400, '영구 삭제할 자료를 선택하세요.');
  const revisions = new Map<string, number>();
  for (const item of request.items) {
    const {id, revision} = reviewed(item);
    requireThat(!revisions.has(id), 400, '같은 자료가 여러 번 선택되었습니다.');
    revisions.set(id, revision);
  }
  const ids = [...revisions.keys()];
  return tx(() => {
    const deadline = cutoff();
    const rows = all<{id:string; revision:number; deleted:string|null}>(`SELECT a.id,r.revision,d.deleted FROM assets a
      LEFT JOIN asset_revisions r ON r.asset=a.id LEFT JOIN deleted_assets d ON d.asset=a.id
      WHERE a.owner=? AND a.id IN (${selectedIds})`, user.id, JSON.stringify(ids));
    requireThat(rows.length === ids.length, 404, '휴지통에서 선택한 자료를 찾을 수 없습니다.');
    for (const row of rows) {
      requireThat(row.deleted !== null, 409, '선택한 자료가 휴지통에 없습니다. 목록을 다시 확인하세요.');
      requireThat(row.deleted > deadline, 404, '선택한 자료의 보관 기간이 지났습니다.');
      requireThat(row.revision === revisions.get(row.id), 409, '휴지통 목록이 변경되었습니다. 최신 목록에서 다시 선택하세요.');
    }
    purgeInTransaction(ids);
    return {ids};
  });
}
