import {useEffect,useRef, useState} from 'react';
import {attachmentError, runInputLimit, type Attachment, type FileExample} from '../domain/run-input';
import type {Prompt} from '../engine/types';
import {useReplyDraft} from './use-reply-draft';

export const attachmentSizeMessage='파일 이름, 본문, 질문을 합친 전송 내용은 40,000자까지 가능합니다. 입력을 줄여 주세요.';

export async function readInputFile(file:File):Promise<Attachment>{
  // A UTF-8 file that fits the serialized request has at most three bytes per UTF-16 unit, plus a BOM.
  if(file.size>runInputLimit*3+3)throw Error(attachmentSizeMessage);
  return {fileName:file.name,content:await file.text()};
}

export function ExampleFileButtons({examples,disabled,onPick}:{
  examples:FileExample[];disabled:boolean;onPick:(file:Attachment)=>void;
}){
  if(!examples.length)return null;
  return <div className="run-row">{examples.map((file,index)=>
    <button key={index} type="button" disabled={disabled} title={file.blockTitle+' · '+file.fileName}
      onClick={()=>onPick({fileName:file.fileName,content:file.content})}>
      예시 파일로 시험{examples.length>1?' · '+file.blockTitle+' ('+file.fileName+')':''}
    </button>)}</div>;
}

export default function RunFileReply({prompt,draftKey,examples,disabled,send}:{
  prompt:Prompt;draftKey:string;examples:FileExample[];disabled:boolean;send:(value:string)=>void;
}){
  const {draft:{file},update}=useReplyDraft(draftKey);
  const [reading,setReading]=useState(false);
  const [error,setError]=useState('');
  const picker=useRef<HTMLInputElement>(null);
  const readId=useRef(0);
  useEffect(()=>()=>{readId.current++;},[]);
  const accept=prompt.fileAccept??[];
  function select(next:Attachment){
    const issue=attachmentError(next,accept)||(JSON.stringify(next).length>runInputLimit?attachmentSizeMessage:'');
    setError(issue);
    if(!issue)update({file:next});
  }
  return <div className="run-wait">
    <strong>{prompt.prompt}</strong>
    <form onSubmit={event=>{event.preventDefault();if(file&&!reading&&!disabled)send(JSON.stringify(file));}}>
      <label>요청받은 파일
        <input ref={picker} type="file" accept={accept.join(',')||undefined} disabled={disabled}
          onChange={async event=>{
            const selected=event.currentTarget.files?.[0];
            const attempt=++readId.current;
            event.currentTarget.value='';setError('');setReading(Boolean(selected));
            if(!selected)return;
            try{const data=await readInputFile(selected);if(attempt===readId.current)select(data);}
            catch(e){if(attempt===readId.current)setError(e instanceof Error?e.message:'파일을 읽을 수 없습니다.');}
            finally{if(attempt===readId.current)setReading(false);}
          }}/>
      </label>
      {accept.length>0&&<small>허용 형식 · {accept.join(', ')}</small>}
      <ExampleFileButtons examples={examples.filter(sample=>!attachmentError(sample,accept))} disabled={disabled}
        onPick={sample=>{readId.current++;setReading(false);select(sample);}}/>
      {file&&<p role="status">첨부할 파일 · {file.fileName}</p>}
      {error&&<p className="run-error" role="alert">{error}{file&&' 기존 첨부 '+file.fileName+'을 유지했습니다.'}</p>}
      <button type="submit" className="run-primary" disabled={disabled||reading||!file}>첨부하고 같은 실행 이어가기</button>
    </form>
  </div>;
}
