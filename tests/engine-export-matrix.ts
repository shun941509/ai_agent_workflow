import assert from 'node:assert/strict';
import {posix} from 'node:path';
import {strFromU8,unzipSync} from 'fflate';
import {byType,catalog,palette,portsFor} from '../src/domain/catalog';
import {activeExportPreparation,sharedEditionLabel} from '../src/domain/agent-export';
import type {Graph} from '../src/domain/types';
import type {EngineResult} from '../src/engine/types';
import {prepareAgentExport,previewAgentExport} from '../src/server/agent-export';
import {buildAgentZip} from '../src/server/agent-zip';

/** Independently read the public ZIP for each SQLite-reopened engine fixture, including resumes. */
export class EngineExportMatrix {
  private observed=new Set<string>();
  private unavailable=new Map<string,number>();
  private runs=0;
  private single=0;
  private split=0;
  private stages=0;
  private links=0;
  private events=0;
  private wires=0;
  private designs=new Set<string>();

  compare(user:Parameters<typeof previewAgentExport>[0],id:string,graph:Graph,result:EngineResult){
    const request={id,title:'블록 검증',graph};
    const preview=previewAgentExport(user,request);
    const selected=preview.resources.filter(item=>item.available).map(item=>item.key);
    const pkg=prepareAgentExport(user,{...request,selected,previewId:preview.previewId});
    const zip=unzipSync(buildAgentZip(pkg));
    const docs=new Map(Object.entries(zip).filter(([path])=>/^(?:(?:workflow|agents)\/[^/]+|AGENTS|README)\.md$/.test(path))
      .map(([path,data])=>[path,strFromU8(data)]));
    assert.equal(strFromU8(zip['CLAUDE.md']).trim(),'@AGENTS.md');
    assert.ok(!Object.keys(zip).some(path=>path.startsWith('runtime/')));
    for(const [path,body] of docs){
      for(const [,file,anchor] of body.matchAll(/\]\(([^()\s#]*)(?:#([^()\s]+))?\)/g)){
        if(/^[a-z]+:/i.test(file))continue;
        const target=file?posix.join(posix.dirname(path),file):path;
        assert.ok(Object.hasOwn(zip,target),path+' → '+target);
        if(anchor)assert.ok(strFromU8(zip[target]).includes('<a id="'+anchor+'">'),path+' → '+target+'#'+anchor);
        this.links++;
      }
    }
    const readme=docs.get('README.md')!;
    const prep=activeExportPreparation(preview.preparation,selected);
    // README escapes Markdown metacharacters in step names and preparation text.
    const plain=readme.replace(/\\([\\`*_\[\]<>])/g,'$1');
    for(const item of prep){
      assert.ok(plain.includes(item.step)&&plain.includes(item.action)&&plain.includes(item.reason),JSON.stringify(item));
    }
    for(const item of preview.resources.filter(r=>!r.available)){
      const key=item.kind+' '+item.name;
      this.unavailable.set(key,(this.unavailable.get(key)??0)+1);
    }

    const pages=new Map<string,{path:string;lines:string[]}[]>();
    for(const [path,text] of docs){
      if(path==='AGENTS.md'||/^workflow\/(?:edition-|step-)/.test(path)){
        const sections=text.split(/^### /m);
        for(const section of sections){
          const lines=section.split('\n'),heading=lines[0].replace(/^# /,'');
          const entries=pages.get(heading)??[];
          entries.push({path,lines});
          pages.set(heading,entries);
        }
      }
    }
    const verified=new Set<string>(),omitted=new Set<string>();
    const visit=(design:Graph,parents:string[],positions:string[])=>{
      const nodes=new Map<string,{path:string;lines:string[]}>();
      for(const [index,node] of design.nodes.entries()){
        const title=node.title.replace(/[\r\n]+/g,' ').trim()||node.id;
        const path=[...parents,title],position=[...positions,String(index)];
        const definition=byType.get(node.type);
        assert.ok(definition,node.type);
        const marker=definition.name+' · '+node.id;
        const material=pkg.resources.find(r=>r.key===node.config.exportResource);
        if(node.type==='connection.mcp'&&material&&!material.included){
          assert.equal(material.available,false);
          omitted.add(marker);
        }else{
          const page=pages.get(path.join(' / '))?.find(entry=>entry.lines.includes(marker));
          assert.ok(page,path.join(' / ')+' → '+marker);
          nodes.set(node.id,page);
          verified.add(marker);
          this.stages++;
        }
        if(node.graph)visit(node.graph,node.config.exportSharedEdition?[sharedEditionLabel(node.config.version,position)]:path,position);
      }
      for(const wire of design.edges){
        const from=nodes.get(wire.from),to=nodes.get(wire.to);
        if(!from||!to)continue;
        const dest=design.nodes.find(n=>n.id===wire.to)!;
        const inputPort=portsFor(dest).inputs.find(p=>p.id===wire.input&&p.kind===wire.kind);
        const title=dest.title.replace(/[\r\n]+/g,' ').trim();
        const label=title+' ('+dest.id+', '+(inputPort?.label??wire.input)+')';
        const link=docs.has('workflow/index.md')?']('+posix.basename(to.path)+')':'';
        assert.ok(from.lines.some(line=>line.startsWith('- ')&&line.includes(' → ')&&line.includes(label)&&line.includes(link)),
          parents.concat(wire.from).join(' / ')+' → '+label);
        this.wires++;
      }
    };
    visit(pkg.graph,[],[]);
    for(const event of result.events){
      if(event.kind!=='result'||!event.blockType)continue;
      const marker=byType.get(event.blockType)?.name+' · '+event.nodeId;
      if(!verified.has(marker)){
        assert.ok(omitted.has(marker),'실행한 단계가 ZIP에서 누락됨 '+event.path+' '+marker);
        continue;
      }
      this.observed.add(event.blockType);this.events++;
    }
    this.runs++;
    this.designs.add(JSON.stringify(graph));
    if(docs.has('workflow/index.md'))this.split++;else this.single++;
  }

  finish(){
    assert.deepEqual(catalog.filter(def=>!this.observed.has(def.type)).map(def=>def.type),[],'실행 결과와 ZIP 본문을 함께 확인하지 못한 블록');
    const menus=palette.filter(menu=>this.observed.has(menu.type));
    assert.equal(menus.length,palette.length);
    console.info('SQLite engine and exported ZIP comparison '+JSON.stringify({runs:this.runs,designs:this.designs.size,single:this.single,split:this.split,types:this.observed.size,menus:menus.length,
      stageBodies:this.stages,resultEvents:this.events,wires:this.wires,links:this.links,unavailable:Object.fromEntries(this.unavailable)}));
  }
}
