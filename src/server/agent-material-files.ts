import {posix} from 'node:path';
import type {ExportPackage} from '../domain/agent-export';

type Resource=ExportPackage['resources'][number];
export type MaterialFiles={scope:string; content:string; sidecars?:{path:string;data:string}[]};

function documentPath(name:string){
  if(!/\.[\p{L}\d]{1,12}$/u.test(name))return;
  const parts=name.split('/');
  if(parts.some(p=>!p||p.startsWith('.')||/[<>:"\\|?*\x00-\x1f]|[. ]$/.test(p)||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))return;
  return name;
}

/** Read local Markdown destinations without modifying the source text used for citations. */
function localLinks(text:string){
  const links=new Set<string>();
  let fence='';
  for(const line of text.split(/\r\n|\r|\n/)){
    const mark=/^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if(mark){if(!fence)fence=mark;else if(mark.startsWith(fence))fence='';continue;}
    if(fence||/^(?: {4}|\t)/.test(line))continue;
    const prose=line.replace(/(`+).*?\1/g,'');
    for(const match of prose.matchAll(/(?:\]\(\s*|^ {0,3}\[[^\]]+\]:\s*)(?:<([^>]+)>|((?:\\.|[^\s()<>]|\([^()\s]*\))+))/g)){
      const href=(match[1]??match[2]).split(/[?#]/,1)[0];
      if(!href||/^(?:[\w+.-]+:|[/\\])/.test(href))continue;
      try{
        const path=decodeURIComponent(href.replace(/\\([()])/g,'$1'));
        if(path&&!/[\\\x00-\x1f]/.test(path)&&!path.startsWith('/'))links.add(path);
      }catch{ /* An invalid percent escape is not a portable file name. */ }
    }
  }
  return links;
}

/** Place uniquely named authored files next to one another so links and original bytes survive. */
export function locateMaterialFiles(resources:Resource[],files:ExportPackage['files'],sources:Map<string,MaterialFiles>){
  const grouped=new Map<string,Resource[]>();
  for(const resource of resources){
    const material=sources.get(resource.key),name=documentPath(resource.name);
    if(material&&name&&resource.kind==='document'){
      const path='resources/'+material.scope+'/'+name;
      const key=path.normalize('NFC').toLowerCase();
      grouped.set(key,[...(grouped.get(key)??[]),resource]);
    }
  }
  const renamed=new Map<string,string>();
  const paths=new Map<string,Resource>();
  const spellings=new Map<string,string>();
  const directories=new Set([...grouped.keys()].flatMap(path=>{
    const parts=path.split('/');
    return parts.slice(1).map((_,i)=>parts.slice(0,i+1).join('/'));
  }));
  for(const [path,items] of grouped){
    if(items.length!==1||directories.has(path))continue;
    const resource=items[0],main='resources/'+sources.get(resource.key)!.scope+'/'+resource.name;
    renamed.set(resource.files[0],main);resource.files[0]=main;paths.set(main,resource);
    spellings.set(path,main);
  }
  for(const file of files)file.path=renamed.get(file.path)??file.path;
  for(const resource of resources){
    const material=sources.get(resource.key);
    if(!material||!resource.available)continue;
    const dir=posix.dirname(resource.files[0]);
    const bundled=new Set<string>([resource.files[0]]);
    const bundledNames=new Map<string,string>();
    const documents=[{path:resource.files[0],text:material.content}];
    for(const file of material.sidecars??[]){
      const path=posix.join(dir,file.path);
      bundled.add(path);
      bundledNames.set(path.normalize('NFC').toLowerCase(),path);
      if(/\.(?:md|markdown|mdown|mdx)$/i.test(path))documents.push({path,text:Buffer.from(file.data,'base64').toString('utf8')});
    }
    const issues=new Map<string,{path:string;target?:string;actualPath?:string}>();
    for(const doc of documents){
      for(const relative of localLinks(doc.text)){
        const targetPath=posix.join(posix.dirname(doc.path),relative);
        if(bundled.has(targetPath))continue;
        const target=paths.get(targetPath);
        const path=posix.relative(dir,targetPath);
        const folded=targetPath.normalize('NFC').toLowerCase();
        const spelling=bundledNames.get(folded)??spellings.get(folded);
        const actualPath=spelling&&spelling!==targetPath?posix.relative(dir,spelling):undefined;
        issues.set(path,{path,...(target?.available?{target:target.key}:{}),...(actualPath?{actualPath}:{})});
      }
    }
    if(issues.size)resource.linkedFiles=[...issues.values()];
  }
}
