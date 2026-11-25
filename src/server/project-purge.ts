import {all, db, one, set} from './db';
import {evictInlineDocumentIndexes} from './knowledge';

const projects = 'SELECT value FROM json_each(?)';
const conversations = `SELECT id FROM conversations WHERE project IN (${projects})`;
const runs = `SELECT id FROM runs WHERE conversation IN (${conversations})`;

/** The caller validates ownership, the reviewed trash entry and expiry under the same write lock. */
export function purgeProjectsInTransaction(ids: readonly string[]): void {
  if (!ids.length) return;
  const conn = db();
  if (!conn.isTransaction) throw new Error('Project purge requires a transaction.');
  const trashed = all<{project:string}>(
    `SELECT project FROM deleted_projects WHERE project IN (${projects})`, JSON.stringify(ids)
  );
  if (!trashed.length) return;
  const selected = JSON.stringify(trashed.map(row => row.project));

  // This cache can include passages from inline documents. Published asset editions have their own lifecycle.
  if (one('SELECT 1 FROM knowledge_document_indexes LIMIT 1')) {
    const versions = conn.prepare(`SELECT graph FROM versions WHERE project IN (${projects})`);
    for (const row of versions.iterate(selected)) evictInlineDocumentIndexes(JSON.parse(String(row.graph)));
  }

  // A surviving conversation may contain excerpts from a deleted project. Keep the access revocation
  // after removing the original source receipt and its foreign key.
  set(`INSERT OR IGNORE INTO revoked_knowledge_history (conversation)
       SELECT conversation FROM knowledge_reads
       WHERE project IN (${projects}) AND conversation NOT IN (${conversations})`, selected, selected);
  set(`DELETE FROM knowledge_reads WHERE project IN (${projects})`, selected);

  for (const table of ['operations', 'replies', 'run_intents', 'run_origins'])
    set(`DELETE FROM ${table} WHERE run IN (${runs})`, selected);
  for (const table of ['runs', 'run_fixtures', 'knowledge_reads', 'knowledge_source_reads', 'revoked_knowledge_history'])
    set(`DELETE FROM ${table} WHERE conversation IN (${conversations})`, selected);
  for (const table of [
    'conversations', 'automations', 'cases', 'memory', 'release_decisions', 'release_exercises',
    'project_releases', 'project_public_releases', 'versions', 'project_restorations', 'deleted_projects',
  ])
    set(`DELETE FROM ${table} WHERE project IN (${projects})`, selected);
  set(`DELETE FROM grants WHERE kind='project' AND target IN (${projects})`, selected);
  set(`DELETE FROM projects WHERE id IN (${projects})`, selected);
}
