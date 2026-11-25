import {isDeepStrictEqual} from 'node:util';
import {all,db,digest,one,set,key,now,tx} from './db';
import {requireThat,stringArg} from './errors';
import {templates,blankPracticeLessonId,membershipQuestion,emptyGraph,isAgentScope,validateGraph,migrateGraph,releaseBaseline,releaseTestCases,type Graph} from '../domain';
import {isIntroExampleAnswer} from '../domain/intro-example-answer';
import {releaseDecisionLabels,type ReleaseAction,type ReleaseDecision} from '../domain/release-decision';
import {assetRow,copyAssetInTransaction,grant,pins,visibility,writeAsset,type Visibility} from './assets';
import type {User} from './auth';
import {resolveWorkflowRefs} from './workflow-refs';
import {bindRunAssets} from './run-assets';
import {missingImportedCollections,prepareKnowledgeCopy,validateKnowledgePublication} from './knowledge';
import {runInputLimit} from '../domain/run-input';
import {normalizeKnowledgeReferences} from '../domain/knowledge-reference';
import {isDynamicLessonPolicy} from '../domain/dynamic-lesson-policy';
import {installVisitMaterials} from './library-visit';
import {purgeProjectsInTransaction} from './project-purge';
import {isEditorFocus,validEditorFocus} from '../domain/editor-focus';
import {workDocumentBindings,workDocuments,type WorkDocument} from '../domain/work-documents';

export interface Project {id:string;owner:string;title:string;graph:string;revision:number;visibility:Visibility;token:string;public_version:number|null;lesson:string|null;updated:string}
export interface Version {project:string;number:number;title:string;graph:string;created:string}

/** Only disclose the owner's active Agents with a direct pin in their draft or a saved version. */
export function assetDeleteImpact(user: User, id: string) {
  const asset = assetRow(stringArg(id, '자료 번호', 150));
  requireThat(asset.owner === user.id, 403, '내 자료의 사용처만 확인할 수 있습니다.');
  const graphs = db().prepare(`
    SELECT id, title, graph FROM active_projects WHERE owner=? AND instr(graph, ?)>0
    UNION ALL
    SELECT p.id, p.title, v.graph FROM active_projects p JOIN versions v ON v.project=p.id
    WHERE p.owner=? AND instr(v.graph, ?)>0`);
  const matches = new Map<string,string>();
  function usesAsset(graph: Graph): boolean {
    return graph.nodes.some(node => node.config.assetId === asset.id || Boolean(node.graph && usesAsset(node.graph)));
  }
  const needle = JSON.stringify(asset.id);
  for (const row of graphs.iterate(user.id, needle, user.id, needle)) {
    const projectId = String(row.id);
    if (!matches.has(projectId) && usesAsset(JSON.parse(String(row.graph)))) matches.set(projectId, String(row.title));
  }
  return {projectTitles: [...matches.values()].sort((a, b) => a.localeCompare(b, 'ko'))};
}

export function project(id:string){const p=one<Project>('SELECT * FROM active_projects WHERE id=?',id);requireThat(p,404,'Agent를 찾을 수 없습니다.');return p;}
export function owned(user:User,id:string){const p=project(id);requireThat(p.owner===user.id,403,'내 Agent만 편집할 수 있습니다.');return p;}
type ProjectAccess = Pick<Project, 'id' | 'owner' | 'public_version' | 'visibility' | 'token'>;
export function canProject(p: ProjectAccess, user: User, token?: string | null, shareGeneration?: string) {
  if (p.owner === user.id) return true;
  if (!p.public_version || p.visibility === 'private') return false;
  if (shareGeneration !== undefined && shareGeneration !== digest(p.token)) return false;
  // An explicit link belongs to one publication. Only a tokenless visit uses the account's grant.
  if (token != null) return token === p.token;
  return p.visibility === 'public' || Boolean(one(
    "SELECT 1 FROM grants WHERE kind='project' AND owner=? AND target=? AND token=?", user.id, p.id, p.token
  ));
}
export function projectSharedAccess(user: User, id: string, token?: string, shareGeneration?: string) {
  const p = one<ProjectAccess>(
    'SELECT id, owner, public_version, visibility, token FROM active_projects WHERE id=?',
    stringArg(id, '프로젝트 번호', 150)
  );
  return {available: Boolean(p?.public_version && p.visibility !== 'private' && canProject(p, user, token, shareGeneration))};
}
export function canReadProjectEdition(p:Project,user:User,version:number|null,token?:string|null){
  if(p.owner===user.id)return true;
  if(!version||!canProject(p,user,token))return false;
  if(version===p.public_version)return true;
  const table=p.visibility==='public'?'project_public_releases':'project_releases';
  return Boolean(one('SELECT 1 FROM '+table+' WHERE project=? AND version=?',p.id,version));
}
export function getVersion(id:string,n:number){const v=one<Version>('SELECT v.* FROM versions v JOIN active_projects p ON p.id=v.project WHERE v.project=? AND v.number=?',id,n);requireThat(v,404,'버전을 찾을 수 없습니다.');return v;}
export function graphShape(raw:unknown):Graph{
  let total=0;
  function check(v:any,level:number){requireThat(v&&typeof v==='object'&&Array.isArray(v.nodes)&&Array.isArray(v.edges)&&level<8,400,'올바른 Workflow 구조가 아닙니다.');total+=v.nodes.length;requireThat(total<=500&&v.edges.length<=1500,413,'설계 크기가 한도를 넘었습니다.');
    requireThat(v.agentScope === undefined || isAgentScope(v.agentScope),400,'Agent의 용도와 담당 업무 설정을 확인하세요.');
    const ids=new Set<string>();for(const n of v.nodes){requireThat(n&&typeof n.id==='string'&&n.id.length<=150&&!ids.has(n.id)&&typeof n.type==='string'&&typeof n.title==='string'&&Number.isFinite(n.x)&&Number.isFinite(n.y)&&n.config&&typeof n.config==='object'&&!Array.isArray(n.config),400,'블록 식별자·위치·속성을 확인하세요.');ids.add(n.id);if(n.graph)check(n.graph,level+1);}
    for(const e of v.edges){requireThat(e&&['flow','data','reference'].includes(e.kind)&&['id','from','to','out','input'].every(k=>typeof e[k]==='string'),400,'연결선 정보를 확인하세요.');}
  }
  check(raw,0);return raw as Graph;
}
export function runnable(raw:Graph){const graph=graphShape(raw);const issues=validateGraph(graph);requireThat(!issues.length,422,issues.slice(0,4).map(e=>e.message).join(' · '));return graph;}
export function stripGraphGrants(graph:Graph){
  for(const node of graph.nodes){
    delete node.config.assetGrant;delete node.config.workflowGrant;
    if(node.graph)stripGraphGrants(node.graph);
  }
}
function releaseExercise(id:string){
  if(!one('SELECT 1 FROM release_exercises WHERE project=?',id))return undefined;
  const decisions=all<ReleaseDecision>(
    'SELECT number,action,version,previous_version AS previousVersion,result_version AS resultVersion,reason,created FROM release_decisions WHERE project=? ORDER BY number DESC',id);
  return {decisions};
}
function hasIntroExampleAnswer(p: Project) {
  const candidates = db().prepare(`SELECT c.graph,r.output FROM conversations c JOIN runs r ON r.conversation=c.id
    WHERE c.project=? AND c.owner=? AND c.mode='test' AND r.owner=c.owner
      AND r.state='completed' AND trim(r.input)=?`);
  for (const row of candidates.iterate(p.id, p.owner, membershipQuestion)) {
    if (isIntroExampleAnswer(JSON.parse(String(row.graph)), String(row.output))) return true;
  }
  return false;
}
function view(p:Project,user:User,details=false,token?:string){
  requireThat(canProject(p,user,token),403,'공유 권한이 없습니다.');const mine=p.owner===user.id;const v=!mine&&p.public_version?getVersion(p.id,p.public_version):undefined;
  let graph:Graph|undefined;
  if(details){
    graph=normalizeKnowledgeReferences(JSON.parse(v?.graph??p.graph) as Graph);
    if(!mine){
      pins(resolveWorkflowRefs(graph,user,p.id,{expand:true}),user);
      stripGraphGrants(graph);
    }
  }
  const exercise=details&&mine&&p.lesson==='release'?releaseExercise(p.id):undefined;
  const hasExampleAnswer = details && mine && p.lesson === 'intro' ? hasIntroExampleAnswer(p) : undefined;
  const visit=mine&&graph?one<{focus:string}>('SELECT focus FROM editor_visits WHERE project=?',p.id):undefined;
  const editorFocus=visit&&graph?validEditorFocus(graph,JSON.parse(visit.focus)):undefined;
  return {
    id:p.id, title:v?.title??p.title, mine, revision:mine?p.revision:undefined,
    visibility:p.visibility, publicVersion:p.public_version, lesson:p.lesson, updated:p.updated,
    ...(mine ? {token:p.token} : {}),
    ...(!mine && details ? {shareGeneration:digest(p.token)} : {}),
    ...(graph ? {graph} : {}),
    ...(exercise ? {releaseExercise:exercise} : {}),
    ...(hasExampleAnswer !== undefined ? {hasExampleAnswer} : {}),
    ...(editorFocus ? {editorFocus} : {}),
  };
}
export function resumeWorkspace(user:User) {
  const recent=one<Project>(`SELECT p.* FROM editor_visits v JOIN active_projects p ON p.id=v.project
    WHERE p.owner=? ORDER BY v.visit DESC LIMIT 1`,user.id);
  // Workspaces edited before visit tracking can still resume their most recently saved draft.
  const p=recent??one<Project>(`SELECT * FROM active_projects WHERE owner=? AND revision>1
    ORDER BY updated DESC,id DESC LIMIT 1`,user.id);
  return p?view(p,user,true):null;
}
export function recordEditorVisit(user:User,id:string,focus:unknown) {
  owned(user,id);
  requireThat(isEditorFocus(focus),400,'편집 중인 블록 위치를 확인하세요.');
  const selection = focus.selection && { kind: focus.selection.kind, id: focus.selection.id };
  set('INSERT OR REPLACE INTO editor_visits(project,focus) VALUES(?,?)',id,JSON.stringify({path:focus.path,selection}));
  return true;
}
export function listProjects(user:User){return all<Project>("SELECT * FROM active_projects p WHERE owner=? OR (public_version IS NOT NULL AND (visibility='public' OR (visibility='link' AND EXISTS(SELECT 1 FROM grants g WHERE g.owner=? AND g.target=p.id AND g.kind='project' AND g.token=p.token)))) ORDER BY updated DESC",user.id,user.id).map(p=>view(p,user));}
type TrashedProject = {id:string;title:string;revision:number;deletedAt:string};
const trashRetentionMs = 72 * 60 * 60 * 1000;
const trashCleanupBatch = 50;

function trashCutoff(at = Date.now()) {
  // Deletion markers are stored as UTC ISO strings with millisecond precision.
  return new Date(at - trashRetentionMs).toISOString();
}

function purgeExpiredInTransaction(cutoff: string, owner?: string) {
  const ownerFilter = owner === undefined ? '' : 'AND project IN (SELECT id FROM projects WHERE owner=?)';
  const expired = all<{project:string}>(
    `SELECT project FROM deleted_projects WHERE deleted<=? ${ownerFilter} ORDER BY deleted LIMIT ?`,
    cutoff, ...(owner === undefined ? [] : [owner]), trashCleanupBatch
  );
  if (expired.length) purgeProjectsInTransaction(expired.map(row => row.project));
  return expired.length;
}

export function purgeExpiredProjects(at = Date.now()) {
  return tx(() => purgeExpiredInTransaction(trashCutoff(at)));
}

export function listTrashedProjects(user: User) {
  return tx(() => {
    const cutoff = trashCutoff();
    purgeExpiredInTransaction(cutoff, user.id);
    return all<TrashedProject>(
      `SELECT p.id, p.title, p.revision, d.deleted AS deletedAt
         FROM deleted_projects d JOIN projects p ON p.id=d.project
         WHERE p.owner=? AND d.deleted>? ORDER BY d.deleted DESC, p.id`,
      user.id, cutoff
    ).map(row => ({...row, expiresAt:new Date(Date.parse(row.deletedAt) + trashRetentionMs).toISOString()}));
  });
}
export function openProject(user:User,id:string,token?:string){const p=project(id);const v=view(p,user,true,token);if(token&&p.visibility==='link'&&p.token===token)grant(user,'project',id,token);return v;}
export function createProject(user:User,b:any) {
  const create = () => {
    if (b.requestKey === undefined) return insertProject(user,b);
    const requestKey = stringArg(b.requestKey, '요청 번호', 160);
    const inputs = [b.title,b.lesson,b.graph,b.legacy,b.dynamicPolicy];
    if (b.workDocument !== undefined) inputs.push(b.workDocument);
    const fingerprint = digest(JSON.stringify(inputs));
    const previous = one<{project:string;fingerprint:string}>(
      'SELECT project,fingerprint FROM project_creation_requests WHERE owner=? AND request_key=?', user.id,requestKey);
    if (previous) {
      requireThat(previous.fingerprint === fingerprint, 409, '다른 설계에 사용한 생성 요청입니다.');
      owned(user, previous.project);
      return openProject(user, previous.project);
    }
    const created = insertProject(user,b);
    set('INSERT INTO project_creation_requests(owner,request_key,fingerprint,project) VALUES(?,?,?,?)',user.id,requestKey,fingerprint,created.id);
    return created;
  };
  // Copies include their assets in the caller's transaction.
  return db().isTransaction ? create() : tx(create);
}

function installWorkDocument(user:User, graph:Graph, doc:WorkDocument) {
  graph.agentScope ??= {mode:'dedicated', purpose:doc.prompt};
  const bindings = workDocumentBindings(graph, doc);
  requireThat(bindings, 422, '업무 입력과 작성 규칙이 연결된 설계를 선택하세요.');
  stringArg(bindings.input.config.question, doc.inputLabel, runInputLimit);
  const existing = one<{id:string}>(`SELECT a.id FROM work_document_materials m
    JOIN active_assets a ON a.id=m.asset AND a.owner=m.owner WHERE m.owner=? AND m.purpose=?`, user.id, doc.id);
  let assetId = existing?.id;
  if (!assetId) {
    const {name, kind, content} = doc.material;
    assetId = writeAsset(user, {name, kind, payload:{content}}).id;
    set('INSERT OR REPLACE INTO work_document_materials(owner,purpose,asset) VALUES(?,?,?)', user.id, doc.id, assetId);
  }
  // The guide examples are written for the original edition. The editor can select later editions.
  bindings.rules.title = doc.material.name;
  bindings.rules.config = {assetId, version:1};
}
function insertProject(user:User,b:any){
  const requirementsCopy = b.workDocument === 'sw-requirements';
  if (requirementsCopy) requireThat(!b.lesson && !b.graph && !b.legacy, 400, '요구사항 템플릿의 새 사본을 선택하세요.');
  const lesson=templates.find(t=>t.id===(requirementsCopy ? 'sw-requirements' : b.lesson));
  requireThat(!b.lesson||lesson||b.lesson===blankPracticeLessonId,400,'알 수 없는 실습입니다.');
  let graph=b.legacy?graphShape(migrateGraph(b.legacy)):b.graph?graphShape(b.graph):lesson?structuredClone(lesson.graph):emptyGraph();
  if (b.workDocument !== undefined && !requirementsCopy) {
    const doc = workDocuments.find(item => item.id === b.workDocument);
    requireThat(doc && b.graph && !b.lesson && !b.legacy, 400, '목적별 만들기에서 업무 문서를 선택하세요.');
    graph = structuredClone(graph);
    installWorkDocument(user, graph, doc);
  }
  if (b.dynamicPolicy !== undefined) {
    requireThat(lesson?.id === 'dynamic' && !b.legacy && !b.graph, 400, '동적 생성 실습의 새 사본에서 정책을 선택하세요.');
    const policy: unknown = b.dynamicPolicy;
    requireThat(isDynamicLessonPolicy(policy), 400, '총 생성 한도, 동시 실행 한도와 실패 처리 방식을 확인하세요.');
    const spawn = graph.nodes.find(node => node.type === 'agent.create_dynamic');
    requireThat(spawn, 500, '실습에 동적 생성 블록이 없습니다.');
    spawn.config.maxCreatedAgents = policy.maxCreatedAgents;
    spawn.config.maxInFlightAgents = policy.maxInFlightAgents;
    spawn.config.failurePolicy = policy.failurePolicy;
  }
  const id=key(),title=stringArg(b.title||lesson?.title||'이름 없는 Agent','Agent 이름',140);
  const newVisitLesson=lesson?.id==='library-visit'&&!b.graph&&!b.legacy;
  if(newVisitLesson)installVisitMaterials(user,graph);
  set('INSERT INTO projects VALUES(?,?,?,?,1,?,?,NULL,?,?)',id,user.id,title,JSON.stringify(graph),'private',key(),b.lesson||null,now());
  if(lesson?.sampleCase && !requirementsCopy && !b.graph && !b.legacy){
    caseSave(user,{id,...lesson.sampleCase,input:lesson.question});
  }
  if(newVisitLesson){
    caseSave(user,{id,title:'토요일 방문과 예약 조회',input:lesson.question,
      expected:'중앙도서관의 토요일 운영시간과 예약 도서 어린 왕자는 같고, 수령 규정의 판에 따라 준비물만 달라집니다.',
      fixture:{reservations:[{book:'어린 왕자',branch:'중앙도서관'}]}});
  }
  if(lesson?.id==='release'&&!b.graph&&!b.legacy){
    set('INSERT INTO release_exercises(project) VALUES(?)',id);
    for(const [index,edition] of [releaseBaseline(),graph].entries()){
      set('INSERT INTO versions(project,number,title,graph,created) VALUES(?,?,?,?,?)',id,index+1,title,JSON.stringify(edition),now());
    }
    for(const testCase of releaseTestCases)caseSave(user,{id,...testCase});
  }
  return openProject(user,id);
}
function updateDraft(user:User, p:Project, title:string, graph:Graph, revision:number) {
  const changed=set('UPDATE projects SET graph=?,title=?,revision=revision+1,updated=? WHERE id=? AND revision=?',JSON.stringify(graph),title,now(),p.id,revision);
  requireThat(changed.changes,409,'다른 화면에서 설계가 변경되었습니다. 최신 초안을 다시 열어 주세요.');
  set('INSERT OR REPLACE INTO editor_visits(project,focus) SELECT project,focus FROM editor_visits WHERE project=?',p.id);
  return openProject(user,p.id);
}
export function saveProject(user:User,b:any){return tx(()=>
  updateDraft(user,owned(user,b.id),stringArg(b.title,'Agent 이름',140),graphShape(b.graph),b.revision));}
export function inspectImportedDesign(user:User,b:any){
  const projectId=b.id===undefined?'':owned(user,b.id).id,unavailable:string[]=[];
  const graph=resolveWorkflowRefs(graphShape(b.legacy?migrateGraph(b.legacy):b.graph),user,projectId,{expand:true,onUnavailable:node=>unavailable.push(node.title+' · 하위 Workflow 버전')});
  return [...unavailable,...missingImportedCollections(graph,projectId,user)];
}
export function projectCopy(user:User,b:any){return tx(()=>{
  const p=project(b.id);requireThat(canProject(p,user,b.token,b.shareGeneration),403,'사본을 만들 권한이 없습니다.');
  const sourceVersion=p.owner===user.id&&!b.published?null:(b.version??p.public_version);
  if(b.version!==undefined)requireThat(Number.isSafeInteger(b.version)&&b.version>0&&canReadProjectEdition(p,user,b.version,b.token),409,'본 버전을 복사할 수 없습니다. 현재 게시 버전을 다시 확인하세요.');
  const requestKey=b.requestKey===undefined?null:stringArg(b.requestKey,'요청 번호',160);
  const fingerprint=digest(JSON.stringify(['project.copy',p.id,sourceVersion,sourceVersion===null?p.revision:null]));
  if(requestKey){
    const previous=one<{project:string;fingerprint:string}>('SELECT project,fingerprint FROM project_creation_requests WHERE owner=? AND request_key=?',user.id,requestKey);
    if(previous){requireThat(previous.fingerprint===fingerprint,409,'다른 사본에 사용한 요청입니다.');return openProject(user,previous.project);}
  }
  const v=p.owner===user.id&&!b.published?null:getVersion(p.id,sourceVersion??0);
  const graph=pins(resolveWorkflowRefs(JSON.parse(v?.graph??p.graph),user,p.id,{expand:true}),user);
  const nodes:Graph['nodes']=[];
  function visit(g:Graph){for(const n of g.nodes){nodes.push(n);if(n.graph)visit(n.graph);}}
  visit(graph);
  const copies=new Map<string,{id:string;version:number}>(),connectors=new Map<string,string>(),destinations=new Map<string,string>();
  function copyResource(assetId:string,version:number|string,assetGrant?:string){
    const ident=assetId+':'+version;let copy=copies.get(ident);
    if(!copy){copy=copyAssetInTransaction(user,assetId,version,assetGrant,destinations.get(assetId));copies.set(ident,copy);destinations.set(assetId,copy.id);}
    return copy;
  }
  const dependencies=nodes.filter(n=>n.config.assetId).sort((a,b)=>a.config.version-b.config.version);
  for(const n of dependencies){
    const {assetId,version,assetGrant}=n.config,copy=copyResource(assetId,version,assetGrant);
    if(n.type==='connection.mcp')connectors.set(assetId,copy.id);
    n.config.assetId=copy.id;n.config.version=copy.version;delete n.config.assetGrant;
  }
  const installCollections=prepareKnowledgeCopy(graph,p.id,user,ref=>copyResource(ref.assetId,ref.version,ref.assetGrant));
  function remapTool(tool:unknown){if(typeof tool!=='string')return tool;const [,old,toolName]=/^mcp\.([\w-]+)\.(.+)$/.exec(tool)||[];
    return old&&connectors.has(old)?'mcp.'+connectors.get(old)+'.'+toolName:tool;}
  for(const n of nodes){
    if(n.graph&&(n.type==='workflow.call'||n.type==='workflow.tool')){delete n.config.workflowId;delete n.config.version;delete n.config.workflowGrant;}
    if(n.config.tool)n.config.tool=remapTool(n.config.tool);
    if(Array.isArray(n.config.allowedTools))n.config.allowedTools=n.config.allowedTools.map(remapTool);
  }
  // The visit exercise requires two editions and a saved case. A project copy has only the pinned materials.
  const lesson=p.lesson==='library-visit'?undefined:p.lesson;
  const copy=createProject(user,{graph,title:((v?.title??p.title).slice(0,136))+' 사본',lesson});
  installCollections(copy.id);
  if(requestKey)set('INSERT INTO project_creation_requests(owner,request_key,fingerprint,project) VALUES(?,?,?,?)',user.id,requestKey,fingerprint,copy.id);
  return copy;
});
}
export function versionList(user:User,id:string){owned(user,id);return all<Pick<Version,'number'|'title'|'created'>>('SELECT number,title,created FROM versions WHERE project=? ORDER BY number DESC',id);}
export function publicationState(user:User,id:string){
  const p=owned(user,id);
  return {publicVersion:p.public_version,visibility:p.visibility,token:p.token};
}
export function snapshot(user:User,b:any){return tx(()=>{const p=owned(user,b.id);
  const requestKey=b.requestKey===undefined?undefined:stringArg(b.requestKey,'요청 번호',160);
  if(requestKey){
    const previous=one<{revision:number;number:number}>('SELECT revision,number FROM version_creation_requests WHERE project=? AND request_key=?',p.id,requestKey);
    if(previous){
      requireThat(previous.revision===b.revision,409,'다른 초안에 사용한 버전 저장 요청 번호입니다.');
      return {number:previous.number};
    }
  }
  requireThat(b.revision===p.revision,409,'최신 초안을 저장한 뒤 다시 시도하세요.');
  const graph=pins(resolveWorkflowRefs(graphShape(JSON.parse(p.graph)),user,p.id,{expand:false}),user);const number=(one<{n:number}>('SELECT coalesce(max(number),0) n FROM versions WHERE project=?',p.id)?.n??0)+1;
  set('INSERT INTO versions VALUES(?,?,?,?,?)',p.id,number,p.title,JSON.stringify(graph),now());
  if(requestKey)set('INSERT INTO version_creation_requests(project,request_key,revision,number) VALUES(?,?,?,?)',p.id,requestKey,b.revision,number);
  return {number};});}
type PublicationExpectation = {expectedVisibility?:unknown;expectedPublicVersion?:unknown;expectedToken?:unknown};
function checkPublication(p:Project,b:PublicationExpectation){
  requireThat((b.expectedVisibility===undefined||b.expectedVisibility===p.visibility)&&
    (b.expectedPublicVersion===undefined||b.expectedPublicVersion===p.public_version)&&
    (b.expectedToken===undefined||b.expectedToken===p.token),409,
    '공유 상태가 변경되었습니다. 현재 공개 범위와 게시 버전을 확인한 뒤 다시 적용하세요.');
}
function publishInTransaction(user:User,b:any){
  requireThat(user.login,403,'공유하려면 계정을 만들어 주세요.');
  const p=owned(user,b.id),vis=visibility(b.visibility);
  checkPublication(p,b);
  const v=getVersion(p.id,Number(b.version));const pinned=pins(runnable(resolveWorkflowRefs(JSON.parse(v.graph),user,p.id,{expand:true,publication:vis})),user,vis);
  validateKnowledgePublication(pinned,p.id,user,vis);
  bindRunAssets(pinned,user).validate();const token=b.rotate||p.visibility!==vis?key():p.token;
  if(vis!=='private'){
    // Publication must also work for a brand-new visitor without the author's saved link grants.
    const visitor:User={id:'@publication-reader',login:null};
    try{pins(resolveWorkflowRefs(JSON.parse(v.graph),visitor,p.id,{expand:true}),visitor);}
    catch{requireThat(false,409,'공유받는 이용자가 읽을 수 없는 참조가 있습니다. 공유 설정을 확인하고 새 버전을 저장하세요.');}
  }
  if(vis==='private'){
    set('DELETE FROM project_releases WHERE project=?',p.id);set('DELETE FROM project_public_releases WHERE project=?',p.id);
  }else{
    set('INSERT OR IGNORE INTO project_releases VALUES(?,?)',p.id,v.number);
    if(vis==='public')set('INSERT OR IGNORE INTO project_public_releases VALUES(?,?)',p.id,v.number);
    else set('DELETE FROM project_public_releases WHERE project=? AND version=?',p.id,v.number);
  }
  set('UPDATE projects SET visibility=?,token=?,public_version=?,updated=? WHERE id=?',vis,token,v.number,now(),p.id);
  if(p.public_version!==v.number)set("UPDATE automations SET enabled=0,next_at=NULL,note='게시 버전이 변경되어 예약을 일시 중지했습니다.' WHERE project=? AND kind='schedule' AND enabled=1",p.id);
}
export function publish(user:User,b:any){return tx(()=>{publishInTransaction(user,b);return openProject(user,b.id);});}
export function decideRelease(user:User,b:any){return tx(()=>{
  const p=owned(user,b.id);
  requireThat(one('SELECT 1 FROM release_exercises WHERE project=?',p.id),400,'이 Agent는 게시 판단 실습으로 시작한 사본이 아닙니다.');
  const last=one<{number:number}>('SELECT coalesce(max(number),0) number FROM release_decisions WHERE project=?',p.id)!.number;
  requireThat(b.expectedDecision===last&&b.expectedPublicVersion===p.public_version&&b.expectedVisibility===p.visibility,
    409,'게시 상태 또는 판단 기록이 변경되었습니다. Agent를 다시 열어 확인하세요.');
  requireThat(typeof b.action==='string'&&Object.hasOwn(releaseDecisionLabels,b.action),400,'게시 판단을 선택하세요.');
  const action=b.action as ReleaseAction,reason=stringArg(b.reason,'판단 근거',1500);
  const version=getVersion(p.id,Number(b.version)).number;
  let result=p.public_version;
  switch(action){
    case 'hold':
      requireThat(version!==result,400,'보류할 후보판을 선택하세요.');
      break;
    case 'keep':
      requireThat(version===result,400,'유지하려는 현재 게시판을 선택하세요.');
      break;
    case 'rollback':
      requireThat(result!==null&&version<result,400,'현재 게시판보다 앞선 복구 대상 판을 선택하세요.');
      publishInTransaction(user,{id:p.id,version,visibility:p.visibility});
      result=version;
      break;
    case 'publish':
      requireThat(result===null||version>result||version===result&&visibility(b.visibility)!==p.visibility,400,'새로 게시할 판이나 변경할 공유 범위를 선택하세요. 이전 판에는 복구를 사용하세요.');
      publishInTransaction(user,{id:p.id,version,visibility:b.visibility});
      result=version;
      break;
  }
  set('INSERT INTO release_decisions(project,number,action,version,previous_version,result_version,reason,created) VALUES(?,?,?,?,?,?,?,?)',
    p.id,last+1,action,version,p.public_version,result,reason,now());
  return openProject(user,p.id);
});}
export function revoke(user:User,id:string,expected:PublicationExpectation={}){return tx(()=>{const p=owned(user,id);
  checkPublication(p,expected);
  set('DELETE FROM project_releases WHERE project=?',id);set('DELETE FROM project_public_releases WHERE project=?',id);
  set("UPDATE projects SET visibility='private',token=?,updated=? WHERE id=?",key(),now(),p.id);return openProject(user,p.id);});}
type ProjectDeletion = {id:string;revision:number;expectedVisibility?:Visibility;expectedPublicVersion?:number|null};
export function deleteProject(user:User,request:ProjectDeletion) {
  const id=stringArg(request.id,'프로젝트 번호',150);
  return tx(()=>{
    // A repeated owner request may arrive after the first response was lost.
    const deleted=one('SELECT 1 FROM deleted_projects d JOIN projects p ON p.id=d.project WHERE d.project=? AND p.owner=?',id,user.id);
    if(deleted)return {id};
    const p=owned(user,id);
    requireThat(p.revision===request.revision &&
      (request.expectedVisibility===undefined||request.expectedVisibility===p.visibility) &&
      (request.expectedPublicVersion===undefined||request.expectedPublicVersion===p.public_version),
      409,'프로젝트가 변경되었습니다. 목록에서 최신 상태를 확인한 뒤 다시 삭제하세요.');
    const timestamp=now();
    // Keep receipts for actions already sent. Invalidating the lease stops further work.
    set(`UPDATE runs SET state='stopped',prompt=NULL,lease=NULL,lease_until=0,updated=?
      WHERE state IN ('queued','running','waiting') AND conversation IN
      (SELECT id FROM conversations WHERE project=?)`,timestamp,id);
    set("UPDATE automations SET enabled=0,next_at=NULL,token_hash='' WHERE project=?",id);
    set('DELETE FROM project_releases WHERE project=?',id);
    set('DELETE FROM project_public_releases WHERE project=?',id);
    set("DELETE FROM grants WHERE kind='project' AND target=?",id);
    set("UPDATE projects SET visibility='private',public_version=NULL,token=?,revision=revision+1,updated=? WHERE id=?",key(),timestamp,id);
    set('INSERT INTO deleted_projects(project,deleted) VALUES(?,?)',id,timestamp);
    return {id};
  });
}
export function restoreProject(user: User, request: {id:string; revision:number}) {
  const id = stringArg(request.id, '프로젝트 번호', 150);
  requireThat(Number.isSafeInteger(request.revision) && request.revision > 0, 400, '휴지통에서 복구할 프로젝트를 다시 선택하세요.');
  const restored = tx(() => {
    const state = one<{revision:number; deleted:string|null; lastRestored:number|null}>(
      `SELECT p.revision, d.deleted, r.deleted_revision AS lastRestored
         FROM projects p LEFT JOIN deleted_projects d ON d.project=p.id
         LEFT JOIN project_restorations r ON r.project=p.id
         WHERE p.id=? AND p.owner=?`,
      id, user.id
    );
    requireThat(state, 404, '휴지통에서 프로젝트를 찾을 수 없습니다.');
    if (state.deleted === null) {
      // A lost response may be retried after the owner has already edited the restored project.
      requireThat(state.lastRestored === request.revision, 409, '이 프로젝트는 휴지통에 없습니다.');
    } else {
      if (state.deleted <= trashCutoff()) {
        purgeProjectsInTransaction([id]);
        return;
      }
      requireThat(state.revision === request.revision, 409, '휴지통 목록이 변경되었습니다. 최신 목록에서 다시 선택하세요.');
      set("UPDATE projects SET visibility='private', public_version=NULL, token=?, revision=revision+1, updated=? WHERE id=?", key(), now(), id);
      set('DELETE FROM deleted_projects WHERE project=?', id);
      set(`INSERT INTO project_restorations(project,deleted_revision) VALUES(?,?)
           ON CONFLICT(project) DO UPDATE SET deleted_revision=excluded.deleted_revision`, id, request.revision);
    }
    return view(project(id), user);
  });
  requireThat(restored, 404, '보관 기간이 지나 프로젝트를 복구할 수 없습니다.');
  return restored;
}

export function purgeTrashedProjects(user: User, request: {items?:unknown}) {
  requireThat(Array.isArray(request.items) && request.items.length > 0, 400, '영구 삭제할 프로젝트를 선택하세요.');
  const revisions = new Map<string, number>();
  for (const item of request.items) {
    requireThat(item && typeof item === 'object', 400, '선택한 프로젝트 정보를 확인하세요.');
    const id = stringArg(item.id, '프로젝트 번호', 150);
    requireThat(Number.isSafeInteger(item.revision) && item.revision > 0, 400, '휴지통에서 프로젝트를 다시 선택하세요.');
    requireThat(!revisions.has(id), 400, '같은 프로젝트가 여러 번 선택되었습니다.');
    revisions.set(id, item.revision);
  }

  const ids = [...revisions.keys()];
  return tx(() => {
    const cutoff = trashCutoff();
    const rows = all<{id:string; revision:number; deleted:string|null}>(
      `SELECT p.id, p.revision, d.deleted FROM projects p
         LEFT JOIN deleted_projects d ON d.project=p.id
         WHERE p.owner=? AND p.id IN (SELECT value FROM json_each(?))`,
      user.id, JSON.stringify(ids)
    );
    requireThat(rows.length === ids.length, 404, '휴지통에서 선택한 프로젝트를 찾을 수 없습니다.');
    for (const row of rows) {
      requireThat(row.deleted !== null, 409, '선택한 프로젝트가 휴지통에 없습니다. 목록을 다시 확인하세요.');
      requireThat(row.deleted > cutoff, 404, '선택한 프로젝트의 보관 기간이 지났습니다.');
      requireThat(row.revision === revisions.get(row.id), 409, '휴지통 목록이 변경되었습니다. 최신 목록에서 다시 선택하세요.');
    }
    purgeProjectsInTransaction(ids);
    return {ids};
  });
}
export function draftArchiveList(user:User, id:string) {
  owned(user,id);
  return all<{revision:number;title:string;created:string}>(
    'SELECT revision,title,created FROM project_draft_archives WHERE project=? ORDER BY revision DESC',id);
}
export function restore(user:User,b:any) {
  return tx(() => {
    const p=owned(user,b.id);
    requireThat(b.revision===p.revision,409,'다른 화면에서 설계가 변경되었습니다. 최신 초안을 다시 열어 주세요.');
    requireThat((b.archive!==undefined)!==(b.version!==undefined),400,'복원할 버전이나 보관된 초안 하나를 선택하세요.');
    if (b.archive!==undefined) requireThat(Number.isSafeInteger(b.archive) && b.archive>0,400,'보관된 초안을 선택하세요.');
    const target = b.archive===undefined ? getVersion(p.id,Number(b.version))
      : one<{title:string;graph:string}>('SELECT title,graph FROM project_draft_archives WHERE project=? AND revision=?',p.id,b.archive);
    requireThat(target,404,'보관된 초안을 찾을 수 없습니다.');
    const graph=graphShape(JSON.parse(target.graph));
    if (target.title===p.title && (target.graph===p.graph || isDeepStrictEqual(graph,JSON.parse(p.graph)))) {
      return {...openProject(user,p.id),archivedRevision:null};
    }
    // Preserve the editable graph verbatim, including unfinished blocks and floating references.
    set('INSERT INTO project_draft_archives(project,revision,title,graph,created) VALUES(?,?,?,?,?)',p.id,p.revision,p.title,p.graph,now());
    return {...updateDraft(user,p,target.title,graph,p.revision),archivedRevision:p.revision};
  });
}
export function caseList(user:User,projectId:string){owned(user,projectId);return all<{id:string;title:string;input:string;expected:string;fixture:string}>('SELECT id,title,input,expected,fixture FROM cases WHERE owner=? AND project=? ORDER BY rowid DESC',user.id,projectId).map(x=>({...x,fixture:JSON.parse(x.fixture)}));}
export function caseSave(user:User,b:any){
  const save=()=>{
    owned(user,b.id);
    const title=stringArg(b.title,'시험 이름',140),input=stringArg(b.input,'시험 입력',runInputLimit);
    const expected=stringArg(b.expected,'기대 결과',30000),fixture=JSON.stringify(b.fixture??{});
    if(b.caseId){
      const current=one<{title:string;input:string;expected:string;fixture:string}>(
        'SELECT title,input,expected,fixture FROM cases WHERE id=? AND owner=? AND project=?',b.caseId,user.id,b.id);
      requireThat(current,404,'내 시험 사례를 확인하세요.');
      requireThat(b.original && current.title===b.original.title && current.input===b.original.input &&
        current.expected===b.original.expected && isDeepStrictEqual(JSON.parse(current.fixture),b.original.fixture),
        409,'다른 화면에서 사례가 변경되었습니다. 작성한 값은 새 사례로 저장할 수 있습니다.');
      set('UPDATE cases SET title=?,input=?,expected=?,fixture=? WHERE id=? AND owner=? AND project=?',
        title,input,expected,fixture,b.caseId,user.id,b.id);
      return {id:b.caseId};
    }
    const id=key();
    set('INSERT INTO cases VALUES(?,?,?,?,?,?,?)',id,user.id,b.id,title,input,expected,fixture);
    return {id};
  };
  return db().isTransaction?save():tx(save);
}

