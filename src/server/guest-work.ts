import { one, set } from './db';
import { requireThat } from './errors';

export function guestWorkSummary(guest: string) {
  return one<{ projects: number; assets: number; conversations: number; links: number }>(
    `SELECT (SELECT count(*) FROM projects WHERE owner=?) AS projects,
            (SELECT count(*) FROM assets WHERE owner=?) AS assets,
            (SELECT count(*) FROM conversations WHERE owner=?) AS conversations,
            (SELECT count(*) FROM grants WHERE owner=?) AS links`,
    guest, guest, guest, guest
  )!;
}

/** Run inside the successful login transaction. Keep object IDs so versions, trash, and graph references still resolve. */
export function importGuestWork(guest: string, member: string) {
  requireThat(!one("SELECT 1 FROM runs WHERE owner=? AND state='running' LIMIT 1", guest), 409,
    '진행 중인 실행을 마치거나 중지한 뒤 다시 로그인하세요. 브라우저에 보관하고 로그인할 수도 있습니다.');

  // Existing isolated MCP fixtures and receipts belong to the guest at the tool provider.
  set(`INSERT INTO imported_tool_scopes(conversation,guest)
       SELECT id,owner FROM conversations WHERE owner=? AND scope='test:' || id`, guest);

  // Request keys belong to each workspace. Keep both runs when the same key was used in each.
  set(`UPDATE runs AS r SET request_key='import:' || hex(randomblob(24))
       WHERE r.owner=? AND EXISTS (SELECT 1 FROM runs m WHERE m.owner=? AND m.request_key=r.request_key)`, guest, member);

  // A member may already have memory for a shared Agent. Preserve the member's existing value there.
  set(`INSERT OR IGNORE INTO memory(owner,project,scope,name,value)
       SELECT ?,project,scope,name,value FROM memory WHERE owner=?`, member, guest);
  set('DELETE FROM memory WHERE owner=?', guest);

  // Carry over currently valid secret links only; an old grant must not replace a renewed link.
  set(`INSERT INTO grants(owner,kind,target,token)
       SELECT ?,g.kind,g.target,g.token FROM grants g WHERE g.owner=? AND (
         (g.kind='project' AND EXISTS(SELECT 1 FROM active_projects p WHERE p.id=g.target AND p.visibility='link' AND p.token=g.token))
         OR (g.kind='asset' AND EXISTS(SELECT 1 FROM active_assets a WHERE a.id=g.target AND a.visibility='link' AND a.token=g.token)))
       ON CONFLICT(owner,kind,target) DO UPDATE SET token=excluded.token`, member, guest);
  set('DELETE FROM grants WHERE owner=?', guest);

  for (const table of ['projects', 'assets', 'cases', 'conversations', 'runs', 'operations', 'automations']) {
    set('UPDATE ' + table + ' SET owner=? WHERE owner=?', member, guest);
  }
}

export function toolScopeOwner(owner: string, scope: string) {
  if (!scope.startsWith('test:')) return owner;
  // A retry shares its original conversation's scope.
  const original = one<{ guest: string }>(
    `SELECT i.guest FROM imported_tool_scopes i JOIN conversations c ON c.id=i.conversation
     WHERE c.id=? AND c.owner=?`, scope.slice(5), owner
  );
  return original?.guest ?? owner;
}
