import {Fragment,type ReactNode} from 'react';

// Model output is untrusted. Render the supported Markdown as React text nodes.
function inline(text:string):ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part,i)=>{
    if(part.startsWith('**')&&part.endsWith('**'))return <strong key={i}>{part.slice(2,-2)}</strong>;
    if(part.startsWith('`')&&part.endsWith('`'))return <code key={i}>{part.slice(1,-1)}</code>;
    const link=part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    return link?<a key={i} href={link[2]} rel="noreferrer">{link[1]}</a>:part;
  });
}
function markdown(text:string) {
  const lines=text.split(/\r?\n/),blocks:ReactNode[]=[];
  for(let i=0;i<lines.length;){
    const start=i,line=lines[i++];
    if(!line.trim())continue;
    if(line.startsWith('```')){
      const body=[];
      while(i<lines.length&&!lines[i].startsWith('```'))body.push(lines[i++]);
      if(i<lines.length)i++;
      blocks.push(<pre key={start}><code>{body.join('\n')}</code></pre>);
      continue;
    }
    const heading=line.match(/^(#{1,6})\s+(.+)/);
    if(heading){
      const H=(['h1','h2','h3','h4','h5','h6'] as const)[heading[1].length-1];
      blocks.push(<H key={start}>{inline(heading[2])}</H>);continue;
    }
    const ordered=/^\d+[.)]\s+/,unordered=/^[-*+]\s+/;
    if(ordered.test(line)||unordered.test(line)){
      const numbered=ordered.test(line),marker=numbered?ordered:unordered,List=numbered?'ol':'ul',items=[line];
      while(i<lines.length&&marker.test(lines[i]))items.push(lines[i++]);
      blocks.push(<List key={start} start={numbered?parseInt(line,10):undefined}>{items.map((v,j)=><li key={j}>{inline(v.replace(marker,''))}</li>)}</List>);
      continue;
    }
    blocks.push(<p key={start}>{inline(line)}</p>);
  }
  return blocks;
}
export function FormattedAnswer({text,format}:{text:string;format?:string}){
  if(format==='json')return <pre className="run-output" aria-label="JSON 답변"><code>{text}</code></pre>;
  return <div className="run-output">{format==='markdown'?<Fragment>{markdown(text)}</Fragment>:text}</div>;
}
