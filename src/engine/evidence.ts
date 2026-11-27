import type {Block} from '../domain/types';
import {attachmentFrom} from '../domain/run-input';
import {editionIdentifier} from '../domain/reply-form';
import {token, type Session} from './session';
import type {OriginalRow, Passage, Source} from './types';
import {isPassage,record,rowNumber} from './values';

const editionKey=(p:Passage|Source)=>JSON.stringify([p.id,editionIdentifier(p.version)??'',p.assetId??null]);
const locationKey=(p:Passage)=>JSON.stringify([editionKey(p),rowNumber(p.location)??p.location]);
export const citationPosition=(p:Passage)=>JSON.stringify([p.id,p.version,rowNumber(p.location)??p.location]);

function lookupKeys(row:Passage){
  return row.assetId&&row.assetId===row.id?[locationKey(row),locationKey({...row,assetId:undefined})]:[locationKey(row)];
}

/** Only an independently supplied full document can establish a line. An indexed excerpt is a candidate. */
export function originalRows(passages:Passage[],documents:Source[],supplied=false):OriginalRow[] {
  const editions=new Map<string,Source[]>();
  for(const doc of documents){
    if(doc.location!==undefined || !editionIdentifier(doc.version))continue;
    // Retain the real edition for a later check if this candidate has not identified its edition yet.
    const identities=doc.assetId===doc.id?[doc,{...doc,assetId:undefined}]:[doc];
    const keys=identities.flatMap(item=>[editionKey(item),editionKey({...item,version:''})]);
    for(const key of keys){
      const items=editions.get(key)??[];items.push(doc);editions.set(key,items);
    }
  }
  const cache=new Map<Source,string[]>();
  const rows:OriginalRow[]=[];
  for(const p of passages){
    const sources=editions.get(editionKey(p));
    if(!sources)continue;
    const number=rowNumber(p.location);
    for(const doc of sources){
      let lines=cache.get(doc);
      if(!lines){lines=doc.content.split(/\r\n|\r|\n/);cache.set(doc,lines);}
      // An empty row records a known document with an absent location. Requesting another
      // copy would allow an attachment to override the connected edition.
      rows.push({id:p.id,version:doc.version,location:p.location,title:doc.title,quote:number?lines[number-1]??'':'',
        ...(p.assetId?{assetId:p.assetId}:{}),...(supplied?{supplied:true}:{})});
    }
  }
  return rows;
}

export function uniqueRows(rows:OriginalRow[]) {
  const entries=new Map<string,OriginalRow>();
  for(const row of rows){
    const key=JSON.stringify([locationKey(row),row.quote]);
    if(!entries.has(key)||!row.supplied)entries.set(key,row);
  }
  return [...entries.values()];
}

/** Keep provenance only while a downstream value or its evidence still refers to that row. */
export function referencedRows(rows:OriginalRow[],value:unknown,evidence:Passage[]|undefined) {
  if(!rows.length)return [];
  const keys=new Set((evidence??[]).map(locationKey));
  function collect(item:unknown){
    if(isPassage(item))keys.add(locationKey(item));
    else if(item&&typeof item==='object')for(const part of Object.values(item))collect(part);
  }
  collect(value);
  return uniqueRows(rows.filter(row=>[...lookupKeys(row),...lookupKeys({...row,version:''})].some(key=>keys.has(key))));
}

/** Match the exact edition, location and cited text. Ambiguous source rows cannot verify a quote. */
export function compareCitations(passages:Passage[],rows:OriginalRow[]) {
  const byLocation=new Map<string,OriginalRow|null>();
  for(const row of uniqueRows(rows)){
    if(!editionIdentifier(row.version))continue;
    for(const key of lookupKeys(row)){
      const previous=byLocation.get(key);
      byLocation.set(key,previous===undefined||previous?.quote===row.quote?row:null);
    }
  }
  const matched:Passage[]=[],originals:OriginalRow[]=[],missing:Passage[]=[];
  let mismatch=false;
  for(const p of passages){
    const row=byLocation.get(locationKey(p));
    if(row===undefined){missing.push(p);matched.push(p);}
    else if(row?.quote.includes(p.quote)){originals.push(row);matched.push({...p,title:row.title});}
    else mismatch=true;
  }
  return {matched,originals:uniqueRows(originals),missing,mismatch};
}

export function originalDetails(rows:OriginalRow[],includeLines:boolean) {
  const supplied=rows.filter(row=>row.supplied).length;
  return {...(supplied?{originalSource:supplied===rows.length?'supplied':'mixed'}:{}),
    ...(includeLines?{sourceLines:[...new Map(rows.map(row=>[citationPosition(row),row.quote])).values()]}:{})};
}

/** Resolve only the adopted citations at the step that actually requires an original. */
export async function checkRequiredOriginals(s:Session,node:Block,path:string,passages:Passage[],inherited:OriginalRow[],documents:Source[],conflicting:boolean) {
  const rowsFor=(items:Passage[])=>[...inherited,...originalRows(items,documents)];
  let rows=rowsFor(passages);
  let comparison=compareCitations(passages,rows);
  if(comparison.mismatch || !comparison.missing.length)return comparison;

  const confirmed:Passage[]=[];
  for(const p of passages){
    if(editionIdentifier(p.version)){confirmed.push(p);continue;}
    // Two excerpts with the same document ID may refer to different editions.
    const editionPath=path+'#edition:'+token([p.id,p.assetId,p.location,p.quote]);
    if(!Object.keys(s.state.replies).some(id=>id.startsWith(editionPath+'#'))){
      // Retire a legacy, editionless file request when replacing it with the edition question.
      for(const [id,prompt] of Object.entries(s.state.waits)){
        if(id.startsWith(path+'#original:') && prompt.filePurpose==='evidenceOriginal')delete s.state.waits[id];
      }
    }
    const reply=await s.ask(node,editionPath,{kind:'question',
      prompt:'‘'+node.title+'’에서 '+(p.title||p.id)+' ('+p.id+') '+p.location+'의 인용 “'+p.quote+'”이 실린 원문을 확인하고 판 번호 또는 판 이름을 입력하세요.'},
      {fields:[{name:'판 번호',required:true,format:'edition'}]});
    confirmed.push({...p,version:editionIdentifier(record(reply.value)['판 번호'])!.trim()});
  }
  rows=rowsFor(confirmed);
  comparison=compareCitations(confirmed,rows);
  if(comparison.mismatch || !comparison.missing.length || conflicting && new Set(confirmed.map(citationPosition)).size<2)return comparison;
  rows.push(...await requestOriginalRows(s,node,path,comparison.missing));
  return compareCitations(confirmed,rows);
}

async function requestOriginalRows(s:Session,node:Block,path:string,missing:Passage[]) {
  const groups=new Map<string,Passage[]>();
  for(const p of missing){
    const key=editionKey(p),items=groups.get(key)??[];items.push(p);groups.set(key,items);
  }
  const rows:OriginalRow[]=[];
  for(const [key,items] of groups){
    const p=items[0],locations=[...new Set(items.map(item=>item.location))].join(', ');
    const edition=p.version?' · '+p.version+'판':'';
    const reply=await s.ask(node,path+'#original:'+token(key),{kind:'file',filePurpose:'evidenceOriginal',
      prompt:'‘'+node.title+'’에서 '+(p.title||p.id)+' ('+p.id+edition+')의 전체 원문 파일을 첨부하세요. '+locations+'의 인용을 원문과 대조해야 합니다.'});
    const file=attachmentFrom(reply.value);
    if(!file?.fileName.trim())throw new Error('근거 확인에 사용할 원문 파일을 첨부하세요.');
    const supplied=originalRows(items,[{id:p.id,assetId:p.assetId,title:p.title||file.fileName,version:p.version,content:file.content}],true);
    rows.push(...supplied);
    if(compareCitations(items,supplied).mismatch)break;
  }
  return rows;
}
