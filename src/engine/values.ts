import type { Passage, Source, Values } from './types';

export function object(value: unknown): Values {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Values : {};
}
export function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
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
  let found = value;
  for (const part of path.split('.').filter(Boolean)) {
    if (!part || ['__proto__', 'constructor', 'prototype'].includes(part) ||
      !found || typeof found !== 'object' || !Object.hasOwn(found, part)) return undefined;
    found = (found as Values)[part];
  }
  return found;
}
export function resolve(value: unknown, fields: Values): unknown {
  if (Array.isArray(value)) return value.map(v=>resolve(v,fields));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v,fields)]));
  if (typeof value !== 'string') return value;
  const exact = value.match(/^\{\{([\w가-힣.-]+)\}\}$/);
  if (exact) return at(fields, exact[1]);
  return value.replace(/\{\{([\w가-힣.-]+)\}\}/g, (_,key:string)=>asText(at(fields,key)));
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
export function buildIndex(documents:Source[]):IndexedPassage[] {
  return documents.flatMap(doc=>doc.content.split(/\r?\n/).flatMap((line,index)=>{
    const quote=line.trim();if(!quote)return [];
    const passage={id:doc.id,title:doc.title,version:doc.version,location:String(index+1)+'행',quote,...(doc.assetId?{assetId:doc.assetId}:{})};
    return [{passage,titleTerms:[...new Set(words(doc.title))],bodyTerms:[...new Set(words(quote))]}];
  }));
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
  return scored.sort((a,b)=>b.score-a.score).slice(0,topK).map(x=>x.passage);
}
export function retrieve(query:string,documents:Source[],topK:number) {return searchIndex(query,buildIndex(documents),topK);}
export function isPassage(v:unknown): v is Passage {
  const p=object(v);
  return typeof p.id==='string' && typeof p.quote==='string' && typeof p.location==='string';
}
