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
function tableCells(line:string) {
  const cells=line.trim().replace(/^\|/, '').split(/(?<!\\)\|/);
  if(cells.at(-1)==='')cells.pop();
  return cells.map(cell=>cell.trim().replace(/\\\|/g,'|'));
}
function markdown(text:string) {
  const lines=text.split(/\r?\n/),blocks:ReactNode[]=[];
  let section='';
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
      section=heading[2];
      blocks.push(<H key={start}>{inline(heading[2])}</H>);continue;
    }
    if(line.includes('|') && lines[i]?.includes('|')){
      const headers=tableCells(line),separators=tableCells(lines[i]);
      if(headers.length && separators.length===headers.length && separators.every(cell=>/^:?-{3,}:?$/.test(cell))){
        i++;
        const rows:string[][]=[];
        while(i<lines.length && lines[i].includes('|')){
          const row=tableCells(lines[i]);
          if(row.length!==headers.length)break;
          rows.push(row);
          i++;
        }
        blocks.push(<div key={start} className="run-table-scroll" tabIndex={0} role="region" aria-label={(section||'표')+' 스크롤'}>
          <table aria-label={section||undefined}>
            <thead><tr>{headers.map((header,j)=><th key={j} scope="col">{inline(header)}</th>)}</tr></thead>
            <tbody>{rows.map((row,j)=><tr key={j}>{row.map((cell,k)=><td key={k}>{inline(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>);
        continue;
      }
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
