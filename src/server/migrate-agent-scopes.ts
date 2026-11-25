import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';
import {templates} from '../domain/templates';
import type {Graph} from '../domain/types';
import {workDocumentBindings, workDocumentGraph, workDocuments} from '../domain/work-documents';

function matchesLesson(graph:Graph, template:Graph):boolean {
  if (graph.nodes.length !== template.nodes.length || JSON.stringify(graph.edges) !== JSON.stringify(template.edges)) return false;
  return template.nodes.every((expected, index) => {
    const actual = graph.nodes[index];
    return actual.id === expected.id && actual.type === expected.type && actual.title === expected.title &&
      isDeepStrictEqual(actual.config, expected.config) &&
      (expected.graph ? Boolean(actual.graph && matchesLesson(actual.graph, expected.graph)) : !actual.graph);
  });
}

// Old guide projects did not persist a lesson ID. Match their original creation request
// so an imported graph with identical blocks or a reused private asset stays unscoped.
function creationFingerprint(inputs:unknown[]) {
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
}

export function migrateDraftAgentScopes(sql:DatabaseSync) {
  const drafts = sql.prepare(`SELECT p.id,p.owner,p.title,p.lesson,p.graph,p.revision,r.fingerprint FROM active_projects p
    LEFT JOIN project_creation_requests r ON r.project=p.id AND r.owner=p.owner
    WHERE json_type(p.graph,'$.agentScope') IS NULL AND (p.lesson IS NOT NULL OR r.fingerprint IS NOT NULL)`);
  const material = sql.prepare('SELECT asset FROM work_document_materials WHERE owner=? AND purpose=?');
  const update = sql.prepare("UPDATE projects SET graph=json_set(graph,'$.agentScope',json(?)), revision=revision+1 WHERE id=?");
  const requirementsReceipt = creationFingerprint(['할 일 앱 요구사항', null, null, null, null, 'sw-requirements']);
  for (const row of drafts.all()) {
    const graph:Graph = JSON.parse(String(row.graph));
    const lesson = templates.find(t => t.id === (row.fingerprint === requirementsReceipt ? 'sw-requirements' : row.lesson));
    // The visit template installs private material IDs at creation, so its serialized graph differs.
    const originalVisit = row.lesson === 'library-visit' && row.revision === 1 && [row.title, null].some(title =>
      row.fingerprint === creationFingerprint([title, row.lesson, null, null, null]));
    if (lesson?.graph.agentScope && (originalVisit || matchesLesson(graph, lesson.graph))) {
      update.run(JSON.stringify(lesson.graph.agentScope), row.id);
      continue;
    }
    if (row.lesson || !row.fingerprint) continue;
    for (const doc of workDocuments) {
      const pin = workDocumentBindings(graph, doc)?.rules;
      if (!pin?.config.assetId || material.get(row.owner, doc.id)?.asset !== pin.config.assetId) continue;
      const inline = workDocumentBindings(workDocumentGraph(doc), doc)!.rules.config;
      // Basic and AI-proposed guide drafts used different inline configs before pinning.
      const stored = pin.config;
      const receiptMatches = [inline, {content:doc.material.content, version:1}].some(config => {
        pin.config = config;
        return row.fingerprint === creationFingerprint([doc.title, null, graph, null, null, doc.id]);
      });
      pin.config = stored;
      if (receiptMatches) {
        update.run(JSON.stringify({mode:'dedicated', purpose:doc.prompt}), row.id);
        break;
      }
    }
  }
}
