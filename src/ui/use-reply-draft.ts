import {useState} from 'react';
import type {Attachment} from '../domain/run-input';

type ReplyDraft={value?:string;selected?:string[];answers?:[string,string][];file?:Attachment};
const unsaved=new Map<string,ReplyDraft>();

export function clearReplyDraft(key:string){
  unsaved.delete(key);
  try{sessionStorage.removeItem(key);}catch{}
}

// Callers remount the form when the run or wait ID changes.
export function useReplyDraft(key:string){
  const [draft,setDraft]=useState<ReplyDraft>(()=>{
    const retained=unsaved.get(key);
    if(retained)return retained;
    try{return JSON.parse(sessionStorage.getItem(key)||'null')??{};}catch{return {};}
  });
  function update(change:Partial<ReplyDraft>){
    const next={...draft,...change};
    setDraft(next);
    try{sessionStorage.setItem(key,JSON.stringify(next));unsaved.delete(key);}
    catch{unsaved.set(key,next);}
  }
  return {draft,update};
}
