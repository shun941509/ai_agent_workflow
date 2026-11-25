import type { SourceSnapshot, TestSources } from '../../domain/source-preview';
import type { SourceDrafts } from './source-drafts';

export { sourceSnapshot } from '../../domain/source-preview';
export type SourceOutput = { applied:SourceSnapshot; drafts:SourceDrafts; tested:TestSources|null };

/** The excerpt includes the surrounding line, but only the differing characters are marked. */
export function firstSourceChange(before:string,after:string) {
  let index=0,endBefore=before.length,endAfter=after.length;
  while(index<endBefore && index<endAfter && before[index]===after[index])index++;
  while(endBefore>index && endAfter>index && before[endBefore-1]===after[endAfter-1]) {
    endBefore--; endAfter--;
  }
  function excerpt(source:string,changedEnd:number) {
    const start=source.slice(0,index).lastIndexOf('\n')+1;
    const next=source.indexOf('\n',index+(source[index]==='\n'?1:0));
    const end=next===-1?source.length:next;
    const left=Math.max(start,index-36),right=Math.min(end,index+66);
    const visible=(text:string)=>text.replace(/\n/g,' ↵ ');
    const prefix=(left>start?'…':'')+source.slice(left,index);
    const marked=visible(source.slice(index,Math.min(changedEnd,right)));
    const suffix=visible(source.slice(Math.min(changedEnd,right),right))+(right<end?'…':'');
    return {prefix,marked,suffix:suffix || (!prefix && !marked ? '(빈 줄)' : ''),text:prefix+marked+suffix || '(빈 줄)'};
  }
  const original=excerpt(before,endBefore),edited=excerpt(after,endAfter);
  const lines=before.slice(0,index).split('\n');
  const nextLine=before.indexOf('\n',index);
  lines[lines.length-1]+=before.slice(index,nextLine<0?undefined:nextLine);
  const article=lines.map(line=>line.match(/^\s*(제\s*\d+\s*조(?:의\s*\d+)?)(?=\s|[（(.]|$)/u)?.[1]).filter(Boolean).at(-1);
  return {label:article ?? lines.length+'번째 줄',before:original.text,after:edited.text,original,edited};
}
