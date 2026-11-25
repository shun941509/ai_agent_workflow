import {useCallback, useRef, useState, type SetStateAction} from 'react';
import {attachmentFrom, type Attachment} from '../domain/run-input';

type Draft = {question?:string;attachment:Attachment|null;updated?:string;failedQuestions?:string[]};
const emptyDraft:Draft={attachment:null};

// Only the signed-in viewer and this Agent can reopen these tab-local drafts.
export function useConversationComposer(enabled:boolean,prefix:string|undefined, initial:string) {
  const memory=useRef(new Map<string,Draft>());
  const read=useCallback((key:string):Draft=>{
    const retained=memory.current.get(key);
    if(retained)return retained;
    if(prefix)try{
      const value=JSON.parse(sessionStorage.getItem(prefix+key)||'null');
      if(value)return {question:typeof value.question==='string'?value.question:undefined,attachment:attachmentFrom(value.attachment)??null,updated:typeof value.updated==='string'?value.updated:undefined,
        failedQuestions:Array.isArray(value.failedQuestions)?value.failedQuestions.filter((q:unknown)=>typeof q==='string'):[]};
    }catch{}
    return emptyDraft;
  },[prefix]);
  const write=useCallback((key:string,value:Draft)=>{
    if(!enabled)return;
    const empty=!value.question && !value.attachment && !value.failedQuestions?.length;
    if(empty)memory.current.delete(key);else memory.current.set(key,value);
    if(prefix)try{
      if(empty)sessionStorage.removeItem(prefix+key);
      else sessionStorage.setItem(prefix+key,JSON.stringify(value));
    }catch{/* The open dialog retains drafts even if session storage is full. */}
  },[enabled,prefix]);
  const [value,setValue]=useState(()=>read(initial));
  const live=useRef(value),location=useRef(initial);
  const change=useCallback((patch:Partial<Draft>)=>{
    const next={...live.current,...patch,updated:new Date().toISOString()};
    live.current=next;setValue(next);write(location.current,next);
  },[write]);
  const setInput=useCallback((next:SetStateAction<string|undefined>)=>{
    change({question:typeof next==='function'?next(live.current.question):next});
  },[change]);
  const setAttachment=useCallback((attachment:Attachment|null)=>change({attachment}),[change]);
  const rememberSubmission=useCallback((question:string,retain:boolean)=>{
    const questions=(live.current.failedQuestions??[]).filter(q=>q!==question);
    if(retain)questions.push(question);
    change({failedQuestions:questions});
  },[change]);
  const enter=useCallback((key:string,promoteNew=false)=>{
    if(!enabled || location.current===key)return;
    const promote=promoteNew && location.current.startsWith('new/');
    const next=promote?live.current:read(key);
    if(promote){write(location.current,emptyDraft);write(key,next);}
    location.current=key;live.current=next;setValue(next);
  },[enabled,read,write]);
  return {typedInput:value.question,attachment:value.attachment,setInput,setAttachment,enter,readDraft:read,failedQuestions:value.failedQuestions??[],rememberSubmission};
}
