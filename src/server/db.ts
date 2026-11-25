import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { migrateDraftAgentScopes } from './migrate-agent-scopes';

let connection: DatabaseSync | undefined;
export const key = () => randomBytes(18).toString('base64url');
export const digest = (input:string) => createHash('sha256').update(input).digest('hex');
export const now = () => new Date().toISOString();
export function db() {
  if(connection) return connection;
  const dir=resolve(process.env.STUDIO_DATA_DIR || '.studio-data');
  mkdirSync(dir,{recursive:true});
  const sql=new DatabaseSync(join(dir,'studio.sqlite'));
  sql.exec(`PRAGMA busy_timeout=8000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, login TEXT UNIQUE COLLATE NOCASE, password TEXT, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES people, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS parked_guest_workspaces (
      session_hash TEXT PRIMARY KEY REFERENCES sessions(hash) ON DELETE CASCADE, guest TEXT NOT NULL REFERENCES people);
    CREATE TABLE IF NOT EXISTS quotas (owner TEXT NOT NULL, day TEXT NOT NULL, category TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(owner,day,category));
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES people, title TEXT NOT NULL, graph TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'private', token TEXT NOT NULL, public_version INTEGER, lesson TEXT, updated TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS projects_owner_lesson ON projects(owner,lesson);
    CREATE TABLE IF NOT EXISTS deleted_projects (project TEXT PRIMARY KEY REFERENCES projects, deleted TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_creation_requests (
      owner TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
      project TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, PRIMARY KEY(owner,request_key));
    CREATE TABLE IF NOT EXISTS editor_visits (visit INTEGER PRIMARY KEY, project TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE, focus TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS trash_expiry ON deleted_projects(deleted);
    CREATE TABLE IF NOT EXISTS project_restorations (project TEXT PRIMARY KEY REFERENCES projects, deleted_revision INTEGER NOT NULL);
    CREATE VIEW IF NOT EXISTS active_projects AS
      SELECT p.* FROM projects p WHERE NOT EXISTS (SELECT 1 FROM deleted_projects d WHERE d.project=p.id);
    CREATE TABLE IF NOT EXISTS versions (project TEXT NOT NULL REFERENCES projects, number INTEGER NOT NULL, title TEXT NOT NULL, graph TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(project,number));
    CREATE TABLE IF NOT EXISTS version_creation_requests (
      project TEXT NOT NULL, request_key TEXT NOT NULL, revision INTEGER NOT NULL, number INTEGER NOT NULL,
      PRIMARY KEY(project,request_key), FOREIGN KEY(project,number) REFERENCES versions(project,number) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS project_draft_archives (
      project TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, revision INTEGER NOT NULL,
      title TEXT NOT NULL, graph TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(project,revision));
    CREATE TABLE IF NOT EXISTS release_exercises (project TEXT PRIMARY KEY REFERENCES projects);
    CREATE TABLE IF NOT EXISTS release_decisions (
      project TEXT NOT NULL REFERENCES release_exercises, number INTEGER NOT NULL, action TEXT NOT NULL, version INTEGER NOT NULL,
      previous_version INTEGER, result_version INTEGER, reason TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(project,number));
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES people, name TEXT NOT NULL, kind TEXT NOT NULL, visibility TEXT NOT NULL, token TEXT NOT NULL, version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS asset_creation_requests (
      owner TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
      asset TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, PRIMARY KEY(owner,request_key));
    CREATE TABLE IF NOT EXISTS installed_lesson_materials (
      owner TEXT NOT NULL REFERENCES people, lesson TEXT NOT NULL, PRIMARY KEY(owner,lesson));
    CREATE TABLE IF NOT EXISTS work_document_materials (
      owner TEXT NOT NULL REFERENCES people, purpose TEXT NOT NULL,
      asset TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, PRIMARY KEY(owner,purpose));
    CREATE TABLE IF NOT EXISTS deleted_assets (asset TEXT PRIMARY KEY REFERENCES assets, deleted TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS asset_trash_expiry ON deleted_assets(deleted);
    CREATE TABLE IF NOT EXISTS asset_revisions (asset TEXT PRIMARY KEY REFERENCES assets ON DELETE CASCADE, revision INTEGER NOT NULL, restored_revision INTEGER);
    -- An edition identifies immutable content. The revision also tracks sharing and trash changes.
    -- Assets created before revision tracking start at 1 without rewriting their editions.
    CREATE TRIGGER IF NOT EXISTS asset_updated_revision AFTER UPDATE ON assets BEGIN
      INSERT INTO asset_revisions(asset,revision) VALUES(NEW.id,2)
      ON CONFLICT(asset) DO UPDATE SET revision=revision+1;
    END;
    CREATE VIEW IF NOT EXISTS active_assets AS
      SELECT a.*,coalesce(r.revision,1) AS revision FROM assets a LEFT JOIN asset_revisions r ON r.asset=a.id
      WHERE NOT EXISTS (SELECT 1 FROM deleted_assets d WHERE d.asset=a.id);
    CREATE TABLE IF NOT EXISTS asset_versions (asset TEXT NOT NULL REFERENCES assets, number INTEGER NOT NULL, payload TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(asset,number));
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES people, project TEXT NOT NULL REFERENCES projects, version INTEGER, graph TEXT NOT NULL, mode TEXT NOT NULL, scope TEXT NOT NULL, link_token TEXT, created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS conversation_project ON conversations(project);
    CREATE TABLE IF NOT EXISTS imported_tool_scopes (
      conversation TEXT PRIMARY KEY REFERENCES conversations ON DELETE CASCADE, guest TEXT NOT NULL REFERENCES people);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, conversation TEXT NOT NULL REFERENCES conversations, owner TEXT NOT NULL REFERENCES people, request_key TEXT NOT NULL, input TEXT NOT NULL, state TEXT NOT NULL, output TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', checkpoint TEXT, prompt TEXT, retries TEXT, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL, UNIQUE(owner,request_key));
    CREATE INDEX IF NOT EXISTS run_conv ON runs(conversation,created);
    CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, run TEXT NOT NULL REFERENCES runs, owner TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS operation_run ON operations(run);
    CREATE TABLE IF NOT EXISTS memory (owner TEXT NOT NULL, project TEXT NOT NULL, scope TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(owner,project,scope,name));
    CREATE INDEX IF NOT EXISTS memory_project ON memory(project);
    CREATE TABLE IF NOT EXISTS knowledge_reads (conversation TEXT NOT NULL REFERENCES conversations, project TEXT NOT NULL REFERENCES projects, scope TEXT NOT NULL, collection TEXT NOT NULL, version TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(conversation,project,scope,collection,version));
    CREATE INDEX IF NOT EXISTS knowledge_read_project ON knowledge_reads(project);
    CREATE TABLE IF NOT EXISTS revoked_knowledge_history (conversation TEXT PRIMARY KEY REFERENCES conversations);
    CREATE TABLE IF NOT EXISTS knowledge_source_reads (conversation TEXT NOT NULL REFERENCES conversations, asset TEXT NOT NULL, version TEXT NOT NULL, source_grant TEXT, PRIMARY KEY(conversation,asset,version));
    CREATE INDEX IF NOT EXISTS knowledge_read_asset ON knowledge_source_reads(asset);
    CREATE TABLE IF NOT EXISTS knowledge_document_indexes (digest TEXT PRIMARY KEY, entries TEXT NOT NULL);
    -- Each cached index is built from one source. Inline documents omit the asset identifier.
    CREATE INDEX IF NOT EXISTS knowledge_document_asset ON knowledge_document_indexes(json_extract(entries,'$[0].passage.assetId'));
    CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES people, project TEXT NOT NULL, title TEXT NOT NULL, input TEXT NOT NULL, expected TEXT NOT NULL, fixture TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS case_project ON cases(project);
    CREATE TABLE IF NOT EXISTS proposals (owner TEXT NOT NULL, id TEXT NOT NULL, result TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(owner,id));
    CREATE TABLE IF NOT EXISTS proposal_requests (owner TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,charge_day TEXT,attempt TEXT NOT NULL,PRIMARY KEY(owner,id));
    CREATE TABLE IF NOT EXISTS grants (owner TEXT NOT NULL,kind TEXT NOT NULL,target TEXT NOT NULL,token TEXT NOT NULL,PRIMARY KEY(owner,kind,target));
    CREATE INDEX IF NOT EXISTS grant_target ON grants(kind,target);
    -- Legacy tables lack project foreign keys. A delayed writer cannot reinsert data after a purge.
    CREATE TRIGGER IF NOT EXISTS memory_requires_project BEFORE INSERT ON memory
      WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project)
      BEGIN SELECT RAISE(ABORT,'Project no longer exists'); END;
    CREATE TRIGGER IF NOT EXISTS case_requires_project BEFORE INSERT ON cases
      WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project)
      BEGIN SELECT RAISE(ABORT,'Project no longer exists'); END;
    CREATE TRIGGER IF NOT EXISTS grant_requires_project BEFORE INSERT ON grants
      WHEN NEW.kind='project' AND NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.target)
      BEGIN SELECT RAISE(ABORT,'Project no longer exists'); END;
    CREATE TABLE IF NOT EXISTS asset_releases (asset TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(asset,version));
    CREATE TABLE IF NOT EXISTS asset_publications (asset TEXT PRIMARY KEY,version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS asset_edition_names (asset TEXT NOT NULL,version INTEGER NOT NULL,name TEXT NOT NULL,PRIMARY KEY(asset,version));
    CREATE TABLE IF NOT EXISTS asset_release_audiences (asset TEXT NOT NULL,version INTEGER NOT NULL,audience TEXT NOT NULL,PRIMARY KEY(asset,version));
    CREATE TABLE IF NOT EXISTS replies (run TEXT NOT NULL,wait_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(run,wait_id));
    CREATE TABLE IF NOT EXISTS run_fixtures (conversation TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_releases (project TEXT NOT NULL REFERENCES projects,version INTEGER NOT NULL,PRIMARY KEY(project,version));
    INSERT OR IGNORE INTO project_releases SELECT id,public_version FROM projects WHERE public_version IS NOT NULL AND visibility IN ('public','link');
    CREATE TABLE IF NOT EXISTS project_public_releases (project TEXT NOT NULL REFERENCES projects,version INTEGER NOT NULL,PRIMARY KEY(project,version));
    INSERT OR IGNORE INTO project_public_releases SELECT id,public_version FROM projects WHERE public_version IS NOT NULL AND visibility='public';
    CREATE TABLE IF NOT EXISTS run_origins (run TEXT PRIMARY KEY REFERENCES runs,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS run_intents (run TEXT PRIMARY KEY REFERENCES runs,fingerprint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS run_case_snapshots (run TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,case_id TEXT,title TEXT NOT NULL,expected TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES people,project TEXT NOT NULL REFERENCES projects,version INTEGER NOT NULL,node TEXT NOT NULL,
      kind TEXT NOT NULL,setting TEXT NOT NULL,input TEXT NOT NULL,enabled INTEGER NOT NULL,token_hash TEXT NOT NULL,
      next_at INTEGER,note TEXT NOT NULL DEFAULT '',UNIQUE(project,node));
    CREATE INDEX IF NOT EXISTS automation_due ON automations(enabled,next_at);
    CREATE TABLE IF NOT EXISTS throttles (name TEXT PRIMARY KEY, count INTEGER NOT NULL, deadline INTEGER NOT NULL);
  `);
  // Old gallery conversations sometimes omitted link_token. Bind only access that can be
  // attributed to the current link. An empty token denotes a permanently retired conversation.
  sql.exec('BEGIN IMMEDIATE');
  try {
    if (sql.prepare('PRAGMA user_version').get()?.user_version === 0) {
      sql.exec(`UPDATE conversations AS c SET link_token = CASE
        WHEN p.visibility = 'public' THEN p.token
        WHEN p.visibility = 'link' AND c.created > p.updated AND EXISTS (
          SELECT 1 FROM grants g WHERE g.owner=c.owner AND g.kind='project'
            AND g.target=c.project AND g.token=p.token
        ) THEN p.token
        ELSE '' END
        FROM projects AS p
        WHERE c.project=p.id AND c.owner<>p.owner AND c.mode='live' AND c.link_token IS NULL;
        PRAGMA user_version=1;`);
    }
    if (!sql.prepare("SELECT 1 FROM pragma_table_info('installed_lesson_materials') WHERE name='asset'").get()) {
      // Earlier receipts have no asset identity. Keep them to respect deletions and edits.
      sql.exec('ALTER TABLE installed_lesson_materials ADD COLUMN asset TEXT REFERENCES assets(id) ON DELETE SET NULL');
    }
    if (sql.prepare('PRAGMA user_version').get()?.user_version === 1) {
      migrateDraftAgentScopes(sql);
      sql.exec('PRAGMA user_version=2');
    }
    sql.exec('COMMIT');
  } catch (error) {
    sql.exec('ROLLBACK');
    throw error;
  }
  connection=sql;
  return sql;
}
export function one<T>(sql:string,...args:SQLInputValue[]):T|undefined { return db().prepare(sql).get(...args) as T|undefined; }
export function all<T>(sql:string,...args:SQLInputValue[]):T[] { return db().prepare(sql).all(...args) as T[]; }
export function set(sql:string,...args:SQLInputValue[]) {return db().prepare(sql).run(...args);}
export function tx<T>(body:()=>T):T {
  const conn=db(); conn.exec('BEGIN IMMEDIATE');
  try {const result=body();conn.exec('COMMIT');return result;} catch(e){conn.exec('ROLLBACK');throw e;}
}

