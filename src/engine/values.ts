import type { Passage, Source, Values } from './types';

export function object(value: unknown): Values {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Values : {};
}
export function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}
export function readable(value:unknown):string {
  if(Array.isArray(value)) return value.map(readable).filter(Boolean).join('\n');
  const o=object(value);
  // A model can add document-like fields to a scorecard. Render the actual verdict.
  if(typeof o.score==='number' && typeof o.reason==='string' && typeof o.passed==='boolean' && Object.hasOwn(o,'input'))
    return asText({score:o.score,threshold:o.threshold,reason:o.reason,passed:o.passed,input:o.input});
  if(typeof o.content==='string' && ('title' in o || 'fileName' in o)) return o.content;
  return asText(value);
}
export function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null || value === '' ? [] : [value];
}
export function strings(value: unknown): string[] {
  return (Array.isArray(value) ? value : asText(value).split(/[,\n]/)).map(v=>asText(v).trim()).filter(Boolean);
}
export function record(value: unknown): Values {
  if (typeof value !== 'string') return object(value);
  try { return object(JSON.parse(value.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''))); } catch { return {}; }
}
export function at(value: unknown, path: string): unknown {
  const parts=path.split('.').filter(Boolean);
  if(parts.some(part=>['__proto__','constructor','prototype'].includes(part)))return;
  let found=value;
  for(let i=0;i<parts.length;i++){
    if(found===null||typeof found!=='object')break;
    if(!Object.hasOwn(found,parts[i])){
      const literal=parts.slice(i).join('.');
      if(Object.hasOwn(found,literal))return (found as Values)[literal];
      break;
    }
    found=(found as Values)[parts[i]];
    if(i===parts.length-1)return found;
  }
  // A form or rename operation may have produced a single key containing dots.
  if(value!==null && typeof value==='object' && Object.hasOwn(value,path))return (value as Values)[path];
  return parts.length?undefined:value;
}

/** Data paths support JSON objects and arrays, including documents still encoded as text. */
export function structuredInput(input:unknown):unknown {
  if(typeof input!=='string')return input;
  try{return JSON.parse(input);}catch{return input;}
}
export function resolve(value: unknown, fields: Values): unknown {
  if (Array.isArray(value)) return value.map(v=>resolve(v,fields));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v,fields)]));
  if (typeof value !== 'string') return value;
  const exact = value.match(/^\{\{([^{}\r\n]+)\}\}$/);
  if (exact) return at(fields, exact[1].trim());
  return value.replace(/\{\{([^{}\r\n]+)\}\}/g, (_,key:string)=>asText(at(fields,key.trim())));
}
export function integer(value: unknown, fallback:number, min:number, max:number): number {
  const num = Number(value ?? fallback);
  return Math.max(min, Math.min(max, Number.isFinite(num) ? Math.trunc(num) : fallback));
}
export function flattened(value: unknown): unknown[] { return list(value).flatMap(item=>Array.isArray(item)?flattened(item):[item]); }

function words(text: string): string[] {
  const tokens=text.normalize('NFKC').toLocaleLowerCase().match(/[가-힣a-z0-9]+/g) ?? [];
  return tokens.flatMap(word=>{
    const root=word.replace(/(에서는|이라고|인가요|에도|에는|에서|까지|부터|으로|하면|나요|인가|의|을|를|가|이|과|와|은|는|로|에|도)$/u,'') || word;
    if (/^(뭘|뭐|무엇|어떤|어디|언제|어떻게|몇|할|수|있|좀|제|저|내|가요|그|the|how|a|and|what)$/u.test(root)) return [];
    const bigrams=Array.from({length:Math.max(0,root.length-1)},(_,i)=>root.slice(i,i+2));
    return [root,...bigrams];
  });
}
export interface IndexedPassage { passage:Passage; titleTerms:string[]; bodyTerms:string[] }
/** Early indexes trimmed lines and numbered re-indexed excerpts from one. Keep the saved edition immutable. */
export function originalPassageLines(index:IndexedPassage[],documents:Source[]):IndexedPassage[]{
  // Indexes created before standalone CR was recognized can also have wrong offsets after the CR.
  if(documents.some(doc=>/\r(?!\n)/.test(doc.content)))return buildIndex(documents,index[0]?.passage.indexVersion);
  const raw=new Map<string,{quote:string;location:string}|null>();
  const key=(s:Source|Passage,location:string,quote:string)=>JSON.stringify([s.id,s.assetId??null,s.version,s.title,location,quote]);
  for(const doc of documents){
    doc.content.split(/\r\n|\r|\n/).forEach((quote,i)=>{
      if(!quote.trim())return;
      const row=(i+1)+'행',location=doc.location??row;
      if(location===row&&quote===quote.trim()&&documents.length===1)return;
      for(const lookup of new Set([row,location])){
        const id=key(doc,lookup,quote.trim()),old=raw.get(id);
        if(old===undefined)raw.set(id,{quote,location});
        else if(old&&(old.quote!==quote||old.location!==location))raw.set(id,null);
      }
    });
  }
  if(!raw.size)return index;
  return index.map(entry=>{
    const p=entry.passage,line=raw.get(key(p,p.location,p.quote));
    return line&&(line.quote!==p.quote||line.location!==p.location)?{...entry,passage:{...p,...line}}:entry;
  });
}
export function buildIndex(documents:Source[],indexVersion?:string):IndexedPassage[] {
  return documents.flatMap(doc=>doc.content.split(/\r\n|\r|\n/).flatMap((line,index)=>{
    if(!line.trim())return [];
    const quote=line;
    const passage={id:doc.id,title:doc.title,version:doc.version,location:doc.location??String(index+1)+'행',quote,...(doc.assetId?{assetId:doc.assetId}:{}),...(indexVersion?{indexVersion}:{})};
    return [{passage,titleTerms:[...new Set(words(doc.title))],bodyTerms:[...new Set(words(quote))]}];
  }));
}
export function rowNumber(location:string) {
  const match=/^(?:([1-9]\d*)\s*행|line[- :]*([1-9]\d*)|([1-9]\d*))$/i.exec(location.trim());
  return match?Number(match[1]??match[2]??match[3]):undefined;
}
export function distinctPassages(passages:Passage[],limit:number):Passage[] {
  const found=new Map<string,Passage>();
  for(const p of passages){
    const key=JSON.stringify([p.id,p.assetId??p.id,p.version,rowNumber(p.location)??p.location,p.quote]);
    const existing=found.get(key);
    if(existing){
      if(!existing.indexVersion&&p.indexVersion)found.set(key,p);
    }else if(found.size<limit)found.set(key,p);
  }
  return [...found.values()];
}
/** Rank existing index entries and return exact text anchors for citation checks. */
export function searchIndex(query:string,index:IndexedPassage[],topK:number):Passage[] {
  const terms=new Set(words(query));
  const scored: {passage:Passage; score:number}[]=[];
  for(const {passage,titleTerms,bodyTerms} of index){
      const title=new Set(titleTerms),tokens=new Set(bodyTerms);
      let score=0;
      for(const term of terms) {
        score+=(tokens.has(term)?2:0)+(title.has(term)?0.5:0);
        // Korean counter nouns often occur directly after a number (e.g. '3권').
        if(term.length===1 && passage.quote.includes(term))score+=0.75;
      }
      if(score>0)scored.push({score,passage});
  }
  return distinctPassages(scored.sort((a,b)=>b.score-a.score).map(x=>x.passage),topK);
}
export function retrieve(query:string,documents:Source[],topK:number) {return searchIndex(query,buildIndex(documents),topK);}
export function isPassage(v:unknown): v is Passage {
  const p=object(v);
  return typeof p.id==='string' && typeof p.quote==='string' && typeof p.location==='string';
}
