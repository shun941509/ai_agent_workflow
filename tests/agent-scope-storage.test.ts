import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { migrateGraph, templates, type AgentScope } from '../src/domain';
import { workDocumentGraph, workDocuments } from '../src/domain/work-documents';
import { db } from '../src/server/db';
import { createProject, getVersion, openProject, projectCopy, restore, runnable, saveProject, snapshot } from '../src/server/projects';
import { reviewProposal } from '../src/server/proposal';
import { legacyGuestSession } from './legacy-guest';

const dir = mkdtempSync(join(tmpdir(), 'studio-agent-scope-'));
process.env.STUDIO_DATA_DIR = dir;
after(() => { db().close(); rmSync(dir, {recursive:true, force:true}); });

test('lesson and guide copies have a declared purpose, custom and imported designs keep the creator choice', () => {
  const user = legacyGuestSession().user;
  for (const template of templates) {
    assert.equal(template.graph.agentScope?.mode, 'dedicated', template.id);
    assert.ok(template.graph.agentScope.purpose.trim(), template.id);
  }
  const intro = createProject(user, {lesson:'intro'});
  assert.deepEqual(intro.graph?.agentScope, templates.find(t => t.id === 'intro')?.graph.agentScope);
  const general: AgentScope = {mode:'general', purpose:''};
  for (const doc of workDocuments) {
    const graph = workDocumentGraph(doc);
    assert.equal(graph.agentScope?.mode, 'dedicated');
    assert.equal(graph.agentScope.purpose, doc.prompt);
    delete graph.agentScope;
    assert.equal(createProject(user, {workDocument:doc.id, graph}).graph?.agentScope?.purpose, doc.prompt);
    assert.deepEqual(createProject(user, {workDocument:doc.id, graph:{...graph, agentScope:general}}).graph?.agentScope, general);
    assert.equal(createProject(user, {graph}).graph?.agentScope, undefined);
  }
  assert.deepEqual(migrateGraph({...intro.graph, agentScope:general}).agentScope, general);
});

test('AI proposals preserve the creator scope and cannot introduce a scope into an unscoped graph', () => {
  const graph = templates[0].graph;
  const proposed = {...graph, agentScope:{mode:'general' as const, purpose:''}};
  assert.deepEqual(reviewProposal(proposed, graph).agentScope, graph.agentScope);
  assert.equal(reviewProposal(proposed, {nodes:[], edges:[]}).agentScope, undefined);
  const team = structuredClone(templates.find(t => t.id === 'parallel')!.graph);
  const inner = team.nodes.find(n => n.type === 'agent.team')!.graph!;
  inner.agentScope = {mode:'dedicated', purpose:'회원증 발급 안내'};
  const changed = structuredClone(team);
  changed.nodes.find(n => n.type === 'agent.team')!.graph!.agentScope = proposed.agentScope;
  assert.deepEqual(reviewProposal(changed, team).nodes.find(n => n.type === 'agent.team')?.graph?.agentScope, inner.agentScope);
});

test('draft scope survives saving, reopening, saving a version, copying and restoring', () => {
  const user = legacyGuestSession().user;
  const initial = createProject(user, {lesson:'intro'});
  const graph = initial.graph!;
  const general: AgentScope = {mode:'general', purpose:'이전 설정'};
  const changed = saveProject(user, {...initial, graph:{...graph, agentScope:general}});
  assert.deepEqual(openProject(user, initial.id).graph?.agentScope, general);
  const version = snapshot(user, changed).number;
  assert.deepEqual(JSON.parse(getVersion(initial.id, version).graph).agentScope, general);
  assert.deepEqual(projectCopy(user, {id:initial.id}).graph?.agentScope, general);
  assert.throws(() => saveProject(user, {...changed, graph:{...graph, agentScope:{mode:'unknown', purpose:''}}}), {status:400});
  const unfinished = saveProject(user, {...changed, graph:{...graph, agentScope:{mode:'dedicated', purpose:' '}}});
  assert.throws(() => runnable(unfinished.graph!), /담당 업무/);
  assert.deepEqual(restore(user, {id:initial.id, version, revision:unfinished.revision}).graph?.agentScope, general);
});

test('upgrading old drafts recognizes lessons and guide receipts, preserving imported graphs, editions and repurposed lessons', () => {
  const owner = legacyGuestSession().user;
  const lesson = createProject(owner, {lesson:'intro'});
  const edition = snapshot(owner, lesson).number;
  const repurposed = createProject(owner, {lesson:'intro'});
  const graph = repurposed.graph!;
  graph.nodes.find(n => n.id === 'agent')!.config.instruction = '이전 자료를 쓰지 말고 영어 문장을 한국어로 번역하세요.';
  saveProject(owner, {...repurposed, graph});
  const rewired = createProject(owner, {lesson:'intro'});
  saveProject(owner, {...rewired, graph:{...rewired.graph, edges:[]}});
  const visit = createProject(owner, {lesson:'library-visit', requestKey:'old-visit'});
  const explicit = createProject(owner, {lesson:'intro'});
  saveProject(owner, {...explicit, graph:{...explicit.graph, agentScope:{mode:'general', purpose:''}}});
  const doc = workDocuments[0];
  const input = workDocumentGraph(doc);
  delete input.agentScope;
  const guide = createProject(owner, {workDocument:doc.id, graph:input, title:doc.title, requestKey:'old-guide'});
  const requirements = createProject(owner, {workDocument:'sw-requirements', title:'할 일 앱 요구사항', requestKey:'old-requirements'});
  const imported = createProject(owner, {graph:guide.graph, title:doc.title, requestKey:'old-import'});
  const conn = db();
  for (const p of [lesson, repurposed, rewired, visit, guide, requirements, imported]) {
    conn.prepare("UPDATE projects SET graph=json_remove(graph,'$.agentScope') WHERE id=?").run(p.id);
  }
  conn.prepare("UPDATE versions SET graph=json_remove(graph,'$.agentScope') WHERE project=?").run(lesson.id);
  conn.exec('PRAGMA user_version=1');
  execFileSync(process.execPath,['--import','tsx','--input-type=module','-e', 'import {db} from "./src/server/db.ts"; db().close();']);
  assert.equal(openProject(owner, lesson.id).graph?.agentScope?.mode, 'dedicated');
  assert.equal(openProject(owner, repurposed.id).graph?.agentScope, undefined);
  assert.equal(openProject(owner, rewired.id).graph?.agentScope, undefined);
  assert.equal(openProject(owner, visit.id).graph?.agentScope?.mode, 'dedicated');
  assert.equal(openProject(owner, explicit.id).graph?.agentScope?.mode, 'general');
  assert.equal(openProject(owner, guide.id).graph?.agentScope?.purpose, doc.prompt);
  assert.equal(openProject(owner, requirements.id).graph?.agentScope?.mode, 'dedicated');
  assert.equal(openProject(owner, imported.id).graph?.agentScope, undefined);
  assert.equal(JSON.parse(getVersion(lesson.id, edition).graph).agentScope, undefined);
});
