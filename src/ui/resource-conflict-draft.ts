export interface ResourceFile {path:string; data:string}
export interface ResourcePayload {
  content:string; files?:ResourceFile[]; requiresScripts?:boolean;
  builtin?:'library'; url?:string; testUrl?:string; credentialEnv?:string; tools?:string[]; readOnlyTools?:string[];
}

export interface ConflictDraft {
  id:string; baseVersion:number; name:string; payload:ResourcePayload; toolsText:string; readOnlyText:string;
}

// Keep a conflict local to this history entry, including binary Skill attachments larger
// than sessionStorage's quota. An independent tab can edit another draft of the same asset.
let database:Promise<IDBDatabase>|undefined;
function openDrafts() {
  if (!database) database=new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('studio-resource-conflicts',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>resolve(request.result);
  }).catch(error=>{database=undefined;throw error;});
  return database;
}

export function conflictEntry(assetId:string, create=false):string|undefined {
  const entry=window.history.state?.resourceConflict;
  if (entry?.id===assetId) return entry.key;
  if (!create) return;
  const key=crypto.randomUUID();
  window.history.replaceState({...window.history.state,resourceConflict:{id:assetId,key}},'');
  return key;
}

export function clearConflictDraft(key:string) {
  const state=window.history.state;
  if(state?.resourceConflict?.key===key){
    const next={...state};delete next.resourceConflict;
    window.history.replaceState(next,'');
  }
  return writeConflictDraft(key);
}

export async function readConflictDraft(key:string):Promise<ConflictDraft|undefined> {
  const db=await openDrafts();
  return new Promise((resolve,reject)=>{
    const request=db.transaction('drafts').objectStore('drafts').get(key);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

export async function writeConflictDraft(key:string, draft?:ConflictDraft) {
  const db=await openDrafts();
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('drafts','readwrite');
    const store=tx.objectStore('drafts');
    if (draft) store.put(draft,key);
    else store.delete(key);
    tx.oncomplete=()=>resolve();
    tx.onabort=()=>reject(tx.error);
  });
}
