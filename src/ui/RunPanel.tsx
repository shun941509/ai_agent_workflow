'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { EngineEvent, Prompt } from '../engine/types';
import type { Graph } from '../domain/types';
import {beginnerRuleSource} from '../domain/source-preview';
import {runInputLimit,attachmentError,attachmentFrom,fileExtensions,encodeRunQuestion,literalRunQuestion,questionText,type Attachment,type FileExample} from '../domain/run-input';
import RunFileReply, {attachmentSizeMessage,ExampleFileButtons,readInputFile} from './RunFileReply';
import './run-panel.css';
import TriggerPane from './TriggerPane';
import {toolName} from './tool-name';
import {useConversationComposer} from './use-conversation-composer';
import {clearReplyDraft,useReplyDraft} from './use-reply-draft';
import {intentHash, StudioApiError} from './client';
import {FormattedAnswer} from './FormattedAnswer';

type RunState = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopped';
type Run = {
  id:string;conversation:string;state:RunState;input:string;output:string;error?:string;
  prompt?:Prompt|null;events?:EngineEvent[];operations?:{id:string;tool:string;status:string;result?:unknown}[];
  prompts?:Prompt[];files?:{path:string;fileName:string;content:string}[];outputFormat?:string;
  mode:'test'|'live';version?:number;created:string;updated:string;runNumber:number;
  usedEditions:{title:string;version:number}[];
  testCase?:{caseId:string|null;title:string;expected:string;fixture?:unknown};
  projectAccessRevoked?:boolean;isExampleAnswer?:boolean;beginnerRule?:string|null;
};
type Case={id:string;title:string;input:string;expected:string;fixture:unknown};
type CaseDraft={title:string;input:string;expected:string;fixture:string};
type Version={number:number;title:string;created:string};
export type RunProject = {id:string;title:string;mine:boolean;publicVersion?:number|null;releaseExercise?:object;shareGeneration?:string;savedVersions?:Version[]};
type EditorDraft = {
  graph:Graph;active:boolean;save:()=>Promise<boolean>;
  getDraftRevision:()=>number|undefined;
  issue?:string;onInspectIssues:()=>void;sourceChoice?:number;
};
type Props = {
  project:RunProject;
  api:(action:string,data?:any)=>Promise<any>; initialConversation?:string;
  initialPendingRun?:string;onPendingRunChange?:(id:string|undefined)=>void;
  sharingRevoked?:boolean; onAccessDenied?:()=>void;
  onExampleAnswer?: () => void;
  token?:string; viewerId?:string;initialInput?:string; initialCase?:string;initialMode?:'test'|'live';
} & ({editorDraft:EditorDraft;onClose?:never} | {editorDraft?:never;onClose:()=>void});
const states:Record<RunState,string>={queued:'시작 대기',running:'실행 중',waiting:'응답 대기',completed:'완료',failed:'실패',stopped:'중지됨'};
const active=(r:Run|null)=>r?.state==='running'||r?.state==='queued';
const newestFirst=(a:Run,b:Run)=>b.runNumber-a.runNumber;
const historyTime=new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'});
const show=(v:unknown)=>typeof v==='string'?v:JSON.stringify(v,null,2);
const msg=(e:unknown)=>e instanceof Error?e.message:String(e);
const revokedMessage='게시자가 공유를 철회했습니다';
const requestId=()=>crypto.randomUUID();
function parseFixture(text:string):Record<string,unknown>{
  try{
    const value=JSON.parse(text||'{}');
    if(value && typeof value==='object' && !Array.isArray(value))return value;
  }catch{}
  throw Error('시험 초기 데이터는 JSON 객체 형식으로 작성하세요.');
}
function EditionSummary({run}:{run:Run}){
  if(!run.usedEditions?.length)return null;
  return <small className="run-editions">사용한 자료판 · {run.usedEditions.map(item=>item.title+' '+item.version+'판').join(' · ')}</small>;
}
function CaseEvidence({run}:{run:Run}){
  const sample=run.testCase;
  if(!sample)return null;
  const file=attachmentFrom(run.input);
  return <>
    {sample.expected&&<p className="run-case-expectation">기대 결과 · {sample.expected}</p>}
    {sample.fixture!==undefined&&<details className="run-trace"><summary>실행한 시험 사례{sample.title?' · '+sample.title:''}</summary>
      {file&&<><strong>첨부 원문 · {file.fileName}</strong><pre>{file.content}</pre></>}
      <strong>시험 초기 데이터</strong><pre>{show(sample.fixture)}</pre>
    </details>}
  </>;
}
const eventKind:Record<EngineEvent['kind'],string>={start:'시작',result:'결과',error:'오류',wait:'대기',tool:'도구',role:'담당',lookup:'검색',stop:'중지'};
const argName=(key:string)=>({book:'도서명',branch:'수령 지점',reservationId:'예약 번호',storeKey:'자료집',version:'버전',snapshot:'자료판 식별자'}[key]||key);

function MobileRunHistory({children, onClose, opener}: {
  children:ReactNode; onClose:()=>void; opener:RefObject<HTMLButtonElement|null>;
}) {
  const ref=useRef<HTMLDialogElement>(null);
  useLayoutEffect(()=>{
    const panel=ref.current!;
    const breakpoint=window.matchMedia('(max-width: 700px)');
    function resize(){if(!breakpoint.matches)onClose();}
    panel.showModal();
    breakpoint.addEventListener('change',resize);
    return ()=>{
      breakpoint.removeEventListener('change',resize);
      panel.close();
      opener.current?.focus({preventScroll:true});
    };
  },[onClose,opener]);
  return <dialog ref={ref} className="run-history-dialog" aria-label="실행 기록"
    onClick={event=>{if(event.target===event.currentTarget)onClose();}}
    onCancel={event=>{event.preventDefault();event.stopPropagation();onClose();}}>
    <div className="run-history-sheet">
      <header><h3>내 실행 기록</h3><button type="button" onClick={onClose}>기록 닫기</button></header>
      {children}
    </div>
  </dialog>;
}

function Trace({run}:{run:Run}) {
  const events=run.events||[];
  return <details className="run-trace"><summary>실행 경로 <span>{events.length}개 기록</span></summary>
    <ol>{events.map(item=>{
      const stop=item.kind==='stop' && item.blockType==='agent.create_dynamic'
        ? item.data as {notStarted?:string[];excluded?:string[]}|undefined : undefined;
      return <li key={item.id}><strong>{item.title}</strong><i>{eventKind[item.kind]||item.kind}</i>
        <small>{item.detail}</small>
        {stop?.notStarted && <small>선택 후 미시작 · {stop.notStarted.join(', ')||'없음'}</small>}
        {stop?.excluded && <small>선택 제외 · {stop.excluded.join(', ')||'없음'}</small>}
        {item.data!==undefined&&<details><summary>입출력 보기</summary><pre>{show(item.data)}</pre></details>}
      </li>;
    })}</ol>
  </details>;
}
function Operations({run}:{run:Run}){
  if(!run.operations?.length)return null;
  return <section className="run-ops"><h4>전송한 작업</h4>{run.operations.map(op=>
    <details key={op.id}><summary>{toolName(op.tool)} · {({confirmed:'처리 확인',unknown:'결과 미확인',rejected:'거절됨'}[op.status]||op.status)}</summary><pre>{show(op.result??'처리 결과 확인 중')}</pre></details>)}</section>;
}
function Files({run}:{run:Run}){
  const files=(run.files??[]).map(file=>({id:file.path,name:file.fileName,content:file.content}));
  if(!files.length)return null;
  return <div className="run-row">{files.filter((f,i)=>files.findIndex(t=>t.name===f.name&&t.content===f.content)===i).map(f=><button key={f.id}
    onClick={()=>{const url=URL.createObjectURL(new Blob([f.content],{type:'application/octet-stream'}));const a=document.createElement('a');a.download=f.name.replace(/[\\/]/g,'_');a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>
    {f.name} 내려받기</button>)}</div>;
}
function PromptReply({prompt,draftKey,disabled,send}:{prompt:Prompt;draftKey:string;disabled:boolean;send:(value:string,approved?:boolean)=>void}){
  const {draft,update}=useReplyDraft(draftKey);
  const {value='',selected=[]}=draft,answers=new Map(draft.answers??[]);
  const fields=prompt.fields??[];
  const selectionReady=prompt.selectionCount?selected.length===prompt.selectionCount:selected.length>0;
  const width=prompt.selectionPolicy?.simultaneous;
  function submit(){
    if(prompt.kind==='selection')send(JSON.stringify(selected));
    else if(fields.length)send(JSON.stringify(Object.fromEntries([...answers].filter(([,answer])=>answer.trim()))));
    else send(value);
  }
  return <div className="run-wait">
    {prompt.kind==='review'?<>
      {prompt.reviewDraft!=null&&<div className="run-decision-detail"><strong>검토할 초안</strong><pre>{prompt.reviewDraft || '내용이 비어 있습니다.'}</pre></div>}
      <div className="run-decision-detail"><strong>검토할 사항</strong><p>{prompt.prompt}</p></div>
    </>:<strong>{prompt.operation?toolName(prompt.operation.tool)+' 작업을 승인할까요?':prompt.prompt}</strong>}
    {prompt.operation&&prompt.showApprovalNote!==false&&<div className="run-decision-detail"><strong>승인 안내</strong><p>{prompt.prompt}</p></div>}
    {prompt.expiresAt && <p>회신 기한 <time dateTime={prompt.expiresAt}>
      {new Date(prompt.expiresAt).toLocaleString('ko-KR', {timeZoneName:'short'})}
    </time></p>}
    {prompt.operation&&<dl>{prompt.operation.connector&&<div><dt>MCP 연결 버전</dt><dd>{prompt.operation.connector.version}</dd></div>}{Object.entries(prompt.operation.args).map(([key,val])=><div key={key}><dt>{argName(key)}</dt><dd>{show(val)}</dd></div>)}</dl>}
    {prompt.kind==='approval'?<div className="run-row">
      <button className="run-primary" disabled={disabled} onClick={()=>send('승인',true)}>이 작업 승인</button>
      <button disabled={disabled} onClick={()=>send('거절',false)}>거절</button></div>:
      <form onSubmit={e=>{e.preventDefault();if(!disabled)submit();}}>
        {prompt.kind==='selection'?<fieldset disabled={disabled}><legend>이번 실행에 포함할 항목</legend>{(prompt.options||[]).map(item=>
          <label key={item} className="run-check"><input type="checkbox" checked={selected.includes(item)} disabled={!selected.includes(item)&&!!prompt.selectionCount&&selected.length>=prompt.selectionCount} onChange={e=>update({selected:e.target.checked?[...selected,item]:selected.filter(x=>x!==item)})}/>{item}</label>)}
          <p>고른 순서대로 조사합니다. 순서를 바꾸려면 선택을 해제한 뒤 다시 고르세요.</p>
          <div aria-live="polite">{selected.length>0 && <><strong>조사 순서</strong>
            {width ? <ol>{Array.from({length:Math.ceil(selected.length/width)},(_,i)=>
              <li key={i}>{i+1}차 · {selected.slice(i*width,(i+1)*width).join(', ')}</li>)}</ol> : <p>{selected.join(' → ')}</p>}
          </>}</div>
          {prompt.selectionPolicy?.stopOnIncomplete && <p>한 차수에서 미완료가 나오면 다음 차수의 조사를 중단합니다.</p>}
        </fieldset>:
          fields.length?<fieldset className="run-reply-fields" disabled={disabled}><legend>회신 항목</legend>
            {fields.map(field=><label key={field.name}><span>{field.name} <small>{field.required?'필수':'선택'}</small></span>
              <input type="text" required={field.required} pattern={field.required?'.*\\S.*':undefined}
                value={answers.get(field.name)??''} onChange={event=>{
                  const answer=event.target.value;
                  update({answers:[...answers.set(field.name,answer)]});
                }}/></label>)}
            {prompt.fieldError&&<p role="alert">{prompt.fieldError}</p>}
          </fieldset>:prompt.kind==='review'
          ?<label>검토 의견<textarea disabled={disabled} value={value} onChange={e=>update({value:e.target.value})} required rows={3}/></label>
          :<textarea disabled={disabled} aria-label="대기 중인 요청에 답하기" value={value} onChange={e=>update({value:e.target.value})} required rows={3}/>}
        <button className="run-primary" disabled={disabled||(prompt.kind==='selection'?!selectionReady:!fields.length&&!value.trim())}>같은 실행 이어가기</button>
      </form>}
  </div>;
}

export default function RunPanel({project,api,onClose,editorDraft,initialConversation,initialPendingRun,onPendingRunChange,token,viewerId,initialInput='',initialCase,initialMode=project.mine?'test':'live',sharingRevoked=false,onAccessDenied,onExampleAnswer}:Props){
  const dialog=useRef<HTMLDialogElement>(null),apiRef=useRef(api);
  apiRef.current=api;
  const sharing=useRef({revoked:sharingRevoked,onAccessDenied});
  sharing.current={revoked:sharingRevoked,onAccessDenied};
  const [history,setHistory]=useState<Run[]>([]),[current,setCurrent]=useState<Run|null>(null);
  const [restoringRun,setRestoringRun]=useState(Boolean(initialPendingRun));
  const [restoreError,setRestoreError]=useState(''),[restoreAttempt,setRestoreAttempt]=useState(0);
  const focusRestoredReply=useRef(initialPendingRun);
  useEffect(() => {
    if (current?.isExampleAnswer) onExampleAnswer?.();
  }, [current?.isExampleAnswer, onExampleAnswer]);
  const [cases,setCases]=useState<Case[]>([]),[loadedVersions,setVersions]=useState<Version[]>([]);
  const savedVersions=project.savedVersions;
  const versions=savedVersions && (savedVersions[0]?.number??0)>(loadedVersions[0]?.number??0)
    ? savedVersions : loadedVersions;
  const [conversation,setConversation]=useState(initialConversation||'');
  const {typedInput,attachment,setInput,setAttachment,enter,readDraft,failedQuestions,rememberSubmission}=useConversationComposer(
    !editorDraft,viewerId?'studio.chat-draft.'+viewerId+'.'+project.id+'.':undefined,initialConversation||'new/'+initialMode);
  const [fileExamples,setFileExamples]=useState<FileExample[]>([]);
  const [accept,setAccept]=useState<string|null|undefined>(undefined);
  const [inputSetupError,setInputSetupError]=useState(''),[inputSetupAttempt,setInputSetupAttempt]=useState(0);
  const [sending,setSending]=useState<{question:string;failed:boolean}|null>(null);
  const draftEdits=useRef(0),fileRead=useRef(0);
  const [fileLoading,setFileLoading]=useState(false);
  const [fileError,setFileError]=useState('');
  const fileInput=useRef<HTMLInputElement>(null);
  const fileStatusId=useId();
  const [mode,setMode]=useState<'test'|'live'>(initialMode);
  const testingRelease = Boolean(project.mine && project.releaseExercise && initialMode === 'test');
  const [version,setVersion]=useState(''),[selectedCase,setSelectedCase]=useState(initialCase||'');
  const example=mode==='test' && !version
    ? editorDraft?.graph.nodes.find(node=>node.type==='input.user_request' && typeof node.config.question==='string' && node.config.question.trim())?.config.question
    : undefined;
  const input=typedInput??(conversation?'':example??initialInput);
  const [caseTitle,setCaseTitle]=useState(''),[expected,setExpected]=useState(''),[fixture,setFixture]=useState('{}');
  const caseDrafts=useRef(new Map<string,CaseDraft>());
  const caseQuestion=useRef('');
  const [compareWith,setCompareWith]=useState(''),[pair,setPair]=useState<string[]>([]);
  const [comparisonExpected,setComparisonExpected]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [showTests,setShowTests]=useState(testingRelease),[selectedHistory,setSelectedHistory]=useState(false);
  const historyToggle=useRef<HTMLButtonElement>(null);
  const transcript=useRef<HTMLDivElement>(null);
  const scrolledTurn=useRef('');
  const [newAnswer,setNewAnswer]=useState(''),[answerOffscreen,setAnswerOffscreen]=useState(false);
  const [jump,setJump]=useState<string|null>(null);
  const closeHistory=useCallback(()=>setSelectedHistory(false),[]);
  const [showTriggers,setShowTriggers]=useState(false);
  const [showSettings,setShowSettings]=useState(testingRelease);
  const [testedDraft,setTestedDraft]=useState<Graph|null>(null);
  const [continueWithOriginal,setContinueWithOriginal]=useState<Graph|null>(null);
  const saveDraft=useRef(editorDraft?.save);
  saveDraft.current=editorDraft?.save;
  // A conversation pins its graph. After an edit the next draft test needs a fresh snapshot.
  const ruleChanged=Boolean(editorDraft && current?.beginnerRule!==undefined && current.beginnerRule!==beginnerRuleSource(editorDraft.graph));
  const draftChanged=Boolean(editorDraft && mode==='test' && !version &&
    (ruleChanged || (testedDraft && testedDraft!==editorDraft.graph)) &&
    !(ruleChanged && continueWithOriginal===editorDraft.graph));
  const nextConversation=draftChanged?'':conversation;
  const visibleDraft=editorDraft?.active?editorDraft.graph:undefined;
  const embedded=Boolean(editorDraft);
  const draftIssue=mode==='test'&&!version&&!nextConversation?editorDraft?.issue:undefined;
  const previousInput=current?.input;
  useEffect(()=>{
    if(draftChanged && visibleDraft && previousInput && !attachmentFrom(previousInput)){
      setInput(typed=>typed??literalRunQuestion(previousInput)??previousInput);
    }
  },[draftChanged,visibleDraft,previousInput]);
  const activeId=useRef(''),mounted=useRef(true),contextGeneration=useRef(0);
  const pendingKeys=useRef(new Map<string,string>());
  const base=useCallback(async(action:string,body:Record<string,unknown>={})=>{
    // The viewer can still stop their own queued or running work.
    if(sharing.current.revoked && action!=='run.stop')throw new Error(revokedMessage);
    try {
      const result=await apiRef.current(action,{id:project.id,...body,token,shareGeneration:project.shareGeneration});
      // Keep displayed turns if a poll returns a revoked run. History may also contain older, closed conversations.
      if(action!=='run.stop' && sharing.current.onAccessDenied && result?.projectAccessRevoked)
        throw new StudioApiError(403,'이 Agent를 사용할 권한이 없습니다.');
      return result;
    } catch(err) {
      if(mounted.current && !sharing.current.revoked && err instanceof StudioApiError && err.status===403)sharing.current.onAccessDenied?.();
      throw err;
    }
  },[project.id,project.shareGeneration,token]);
  const resetPicker=useCallback(()=>{
    fileRead.current++;
    setFileLoading(false);setFileError('');
    if(fileInput.current)fileInput.current.value='';
  },[]);
  const clearAttachment=useCallback(()=>{resetPicker();setAttachment(null);},[resetPicker,setAttachment]);
  const clearCase=useCallback(()=>{
    setSelectedCase('');
    setCaseTitle('');
    setExpected('');
    setFixture('{}');
  },[]);
  const resetConversation=useCallback(()=>{
    contextGeneration.current++;
    draftEdits.current++;
    activeId.current='';
    onPendingRunChange?.(undefined);
    scrolledTurn.current='';
    setNewAnswer('');setAnswerOffscreen(false);
    setCurrent(null);setConversation('');setTestedDraft(null);setPair([]);
    setRestoreError('');
    setContinueWithOriginal(null);
    setSending(null);setSelectedHistory(false);setJump(null);setError('');setNotice('');
  },[onPendingRunChange]);
  const appliedChoice=useRef(0);
  const sourceChoice=editorDraft?.sourceChoice??0;
  useLayoutEffect(()=>{
    if(!sourceChoice || sourceChoice===appliedChoice.current)return;
    appliedChoice.current=sourceChoice;
    resetConversation();
    setMode('test');setVersion('');setCompareWith('');
    clearCase();
    if(previousInput && !attachmentFrom(previousInput)){
      setInput(typed=>typed??literalRunQuestion(previousInput)??previousInput);
    }
  },[sourceChoice,previousInput,resetConversation,clearCase]);
  useEffect(()=>{
    if(sharingRevoked || restoringRun || restoreError || (embedded && !visibleDraft))return;
    setInputSetupError('');
    if(draftIssue){setAccept(null);return;}
    let relevant=true;
    setAccept(undefined);
    const readInputFiles=async()=>{
      if(saveDraft.current && !nextConversation && !version && mode==='test' && !(await saveDraft.current())) {
        throw Error('편집 내용을 저장한 후 다시 시험하세요.');
      }
      return base('run.inputFiles',{mode,...(version?{version:Number(version)}:{}),conversation:nextConversation,examples:embedded&&mode==='test'});
    };
    readInputFiles().then((result:{accept:string|null;examples?:FileExample[]})=>{
      if(!relevant)return;
      setAccept(result.accept);
      setFileExamples(result.examples??[]);
      if(result.accept===null)clearAttachment();
    }).catch(err=>{if(relevant)setInputSetupError(msg(err));});
    return()=>{relevant=false;};
  },[base,mode,version,nextConversation,visibleDraft,embedded,draftIssue,clearAttachment,inputSetupAttempt,sharingRevoked,restoringRun,restoreError]);
  const keep=useCallback((r:Run,focus=false,promoteNew=false)=>{
    if(!mounted.current||!r?.id)return;
    setHistory(old=>[r,...old.filter(x=>x.id!==r.id)].sort(newestFirst));
    if(focus){enter(r.conversation,promoteNew);activeId.current=r.id;setCurrent(r);setConversation(r.conversation);setMode(r.mode);setVersion(r.version?String(r.version):'');setRestoreError('');}
    else if(activeId.current===r.id)setCurrent(r);
    if(activeId.current===r.id)onPendingRunChange?.(active(r)||r.state==='waiting'?r.id:undefined);
  },[enter,onPendingRunChange]);
  const load=useCallback(async(id:string,focus=true)=>{
    const r=await base('run.get',{runId:id}) as Run;keep(r,focus);return r;
  },[base,keep]);
  useEffect(()=>{
    if(!initialPendingRun)return;
    let relevant=true;
    base('run.get',{runId:initialPendingRun}).then((r:Run & {project:string})=>{
      if(!relevant)return;
      if(r.project!==project.id)throw Error('현재 프로젝트의 실행을 찾을 수 없습니다.');
      keep(r,true);
    }).catch(err=>{
      if(relevant)setRestoreError(msg(err));
    }).finally(()=>{if(relevant)setRestoringRun(false);});
    return ()=>{relevant=false;};
  },[base,initialPendingRun,keep,project.id,restoreAttempt]);
  useEffect(()=>{
    if(!current || current.id!==focusRestoredReply.current || active(current) || restoringRun)return;
    focusRestoredReply.current=undefined;
    const prompt=transcript.current?.querySelector<HTMLElement>('.run-wait input:not(:disabled), .run-wait textarea:not(:disabled), .run-wait button:not(:disabled)');
    (prompt ?? transcript.current?.querySelector<HTMLElement>('.run-answer'))?.focus();
  },[current,restoringRun]);
  async function openRecord(run:Run){
    const generation=contextGeneration.current;
    // The sidebar only has the 100 most recent runs across all conversations.
    const [record,turns]=await Promise.all([
      base('run.get',{runId:run.id}) as Promise<Run>,
      embedded?null:base('run.list',{conversation:run.conversation}) as Promise<Run[]>,
    ]);
    if(!mounted.current||contextGeneration.current!==generation)return;
    if(turns)setHistory(old=>[...turns,...old.filter(r=>r.conversation!==run.conversation)].sort(newestFirst));
    setNewAnswer('');setAnswerOffscreen(false);
    if(conversation!==run.conversation){resetPicker();draftEdits.current++;}
    keep(record,true);
    setJump(run.id);setSelectedHistory(false);setSending(null);setTestedDraft(null);setPair(ids=>ids.includes(run.id)?ids:[]);
    setContinueWithOriginal(null);
    if(embedded && conversation!==run.conversation)clearCase();
  }
  useLayoutEffect(()=>{
    if(embedded || !current || selectedHistory)return;
    if(!jump && scrolledTurn.current===current.id)return;
    const turn=transcript.current?.querySelector<HTMLElement>('[data-run-turn="'+current.id+'"]');
    if(!turn)return;
    scrolledTurn.current=current.id;
    if(transcript.current)transcript.current.scrollTop+=turn.getBoundingClientRect().top-transcript.current.getBoundingClientRect().top-8;
    if(jump===current.id){turn.focus({preventScroll:true});setJump(null);}
  },[embedded,current?.id,jump,selectedHistory]);
  useEffect(()=>{
    mounted.current=true;dialog.current?.showModal();let relevant=true;
    (async()=>{
      try{
        const rows=await base('run.list') as Run[];if(!relevant)return;
        setHistory(old=>{
          const known=new Set(old.map(run=>run.id));
          return [...old,...rows.filter(run=>!known.has(run.id))].sort(newestFirst);
        });
        if(initialConversation){
          const turns=await base('run.list',{conversation:initialConversation}) as Run[];
          if(!relevant)return;
          setHistory([...turns,...rows.filter(r=>r.conversation!==initialConversation)].sort(newestFirst));
          const latest=turns[0];
          if(latest)await load(latest.id);
        }
      }catch(err){if(relevant)setError(msg(err));}
    })();
    if(project.mine){
      base('versions.list').then((rows:Version[])=>{
        if(!relevant)return;
        setVersions(rows);
        if(testingRelease && !initialConversation && !initialPendingRun && !appliedChoice.current) {
          const baseline = project.publicVersion ?? rows.at(-1)?.number;
          const candidate = rows.find(row => row.number !== baseline);
          setVersion(baseline ? String(baseline) : '');
          setCompareWith(candidate ? String(candidate.number) : '');
        }
      }).catch(e=>{if(relevant)setError(msg(e));});
      base('cases.list').then((rs:Case[])=>{if(relevant){setCases(rs);const chosen=rs.find(c=>c.id===initialCase);if(chosen&&!appliedChoice.current)selectCase(chosen);}}).catch(e=>{if(relevant)setError(msg(e));});
    }
    return()=>{relevant=false;mounted.current=false;};
  // Initial case is restored only when this agent or conversation opens.
  },[base,load,initialCase,initialConversation,initialPendingRun,project.mine,project.publicVersion,testingRelease]);
  const chatTurns=!embedded&&current?history.filter(r=>r.conversation===current.conversation).reverse():[];
  const completedAnswer=!embedded&&current?.id===newAnswer&&current.state==='completed'?newAnswer:'';
  useEffect(()=>{
    const container=transcript.current;
    const answer=completedAnswer&&container?.querySelector<HTMLElement>('[data-run-turn="'+completedAnswer+'"] .run-answer');
    if(!container||!answer){setAnswerOffscreen(false);return;}
    const observer=new IntersectionObserver(entries=>setAnswerOffscreen(!entries[0].isIntersecting),{root:container});
    observer.observe(answer);
    return ()=>observer.disconnect();
  },[completedAnswer]);
  function viewNewAnswer(){
    const container=transcript.current;
    const answer=container?.querySelector<HTMLElement>('[data-run-turn="'+completedAnswer+'"] .run-answer');
    if(!container||!answer)return;
    container.scrollTop+=answer.getBoundingClientRect().top-container.getBoundingClientRect().top-8;
    answer.focus({preventScroll:true});
    setNewAnswer('');setAnswerOffscreen(false);
  }
  const pendingTurn=chatTurns.find(r=>active(r)||r.state==='waiting');
  const pollIds=[...new Set([...((active(current)||current?.state==='waiting')&&current?[current.id]:[]),...chatTurns.filter(active).map(r=>r.id),...pair.filter(id=>{
    const item=history.find(r=>r.id===id);return item&&(active(item)||item.state==='waiting');
  })])].sort().join('|');
  useEffect(()=>{
    if(sharingRevoked || !pollIds)return;
    let alive=true, timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{await Promise.all(pollIds.split('|').map(id=>load(id,false)));}
      catch(err){if(alive)setError(msg(err));}
      if(alive)timer=setTimeout(poll,900);
    };
    timer=setTimeout(poll,500);return()=>{alive=false;clearTimeout(timer);};
  },[pollIds,load,sharingRevoked]);
  const waiting = current?.state==='waiting'?current:pendingTurn?.state==='waiting'?pendingTurn:null;
  const waitingRun = waiting?.id;
  const deadline = waiting?.prompt?.expiresAt;
  useEffect(() => {
    if (sharingRevoked || !waitingRun || !deadline) return;
    let open = true;
    const refresh = async () => {
      try {
        const run = await load(waitingRun, false);
        if (run.state !== 'waiting' || run.prompt?.expiresAt !== deadline) return;
      } catch (err) {
        if (open) setError(msg(err));
      }
      // The worker may still be processing the deadline or its error-handling path.
      if (open) timer = setTimeout(refresh, 1000);
    };
    let timer = setTimeout(refresh, Math.max(0, Date.parse(deadline) - Date.now()));
    return () => { open = false; clearTimeout(timer); };
  }, [waitingRun, deadline, load, sharingRevoked]);
  function showCaseInput(q:string){
    draftEdits.current++;
    const file=attachmentFrom(q);
    clearAttachment();setAttachment(file??null);
    setInput(file?String(JSON.parse(q).question??''):literalRunQuestion(q)??q);
  }
  function selectCase(c:Case){
    const draft=caseDrafts.current.get(c.id);
    caseQuestion.current=draft?.input??c.input;
    showCaseInput(caseQuestion.current);
    setSelectedCase(c.id);setExpected(draft?.expected??c.expected);
    setCaseTitle(draft?.title??c.title);setFixture(draft?.fixture??show(c.fixture??{}));
  }
  function rememberCase(){
    if(mode==='test')caseDrafts.current.set(selectedCase,{
      title:caseTitle,input:conversation?caseQuestion.current:encodedInput,expected,fixture
    });
  }
  function chooseCase(next?:Case,remember=true){
    if(remember)rememberCase();
    resetConversation();
    if(!embedded)enter('new/test');
    if(mode==='live')setVersion('');
    setMode('test');
    if(next)selectCase(next);
    else {
      const direct=caseDrafts.current.get('');
      if(direct){
        caseQuestion.current=direct.input;
        showCaseInput(direct.input);setSelectedCase('');
        setExpected(direct.expected);setCaseTitle(direct.title);setFixture(direct.fixture);
        return;
      }
      caseQuestion.current='';setInput(undefined);clearAttachment();
      clearCase();
    }
  }
  function editCase(change:()=>void){
    if(conversation){
      const q=encodedInput||caseQuestion.current||current?.input||'';
      resetConversation();
      if(!embedded)enter('new/test');
      showCaseInput(q);
    }
    change();
  }
  async function action(work:()=>Promise<void>){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{await work();}catch(err){setError(msg(err));}finally{if(mounted.current)setBusy(false);}
  }
  function waitDraftKey(turn:Run){
    return 'studio.wait-draft.'+JSON.stringify([project.id,turn.id,turn.prompt!.id]);
  }
  function reply(turn:Run,value:string,approved?:boolean){
    void action(async()=>{
      try{
        const result=await base('run.reply',{runId:turn.id,waitId:turn.prompt!.id,value,approved});
        clearReplyDraft(waitDraftKey(turn));keep(result,true);
      }catch(err){
        if(err instanceof StudioApiError&&err.status===409)await load(turn.id,false);
        throw err;
      }
    });
  }
  async function stop(turn:Run){
    const stopped:Run=await base('run.stop',{runId:turn.id});
    if(stopped.projectAccessRevoked && sharing.current.onAccessDenied){
      if(!sharing.current.revoked)sharing.current.onAccessDenied();
      // Only the run status comes back after revocation. Retain the previously displayed question and answer.
      keep({...turn,state:stopped.state,updated:stopped.updated,prompt:null},true);
    } else keep(stopped,true);
  }
  const newConversation=()=>{
    if(embedded){setInput(undefined);clearAttachment();}
    else{resetPicker();enter('new/'+initialMode);}
    resetConversation();
    setMode(initialMode);
    if (!testingRelease) { setVersion(''); setCompareWith(''); }
    const selected = cases.find(item => item.id === selectedCase);
    if (selected && initialMode==='test'){rememberCase();selectCase(selected);}
    else if(selected){rememberCase();clearCase();}
  };
  const encodedInput=attachment?JSON.stringify({...attachment,question:input.trim()||attachment.fileName}):encodeRunQuestion(input.trim());
  const oversized=encodedInput.length>runInputLimit;
  const sizeError=attachmentSizeMessage;
  const visibleExamples=embedded&&mode==='test'?fileExamples:[];
  const storedCase=cases.find(c=>c.id===selectedCase);
  const caseInput=encodedInput || (conversation?caseQuestion.current:'');
  const editedCase=storedCase && (caseTitle!==storedCase.title || expected!==storedCase.expected ||
    fixture!==show(storedCase.fixture??{}) || (conversation?caseQuestion.current:encodedInput)!==storedCase.input);
  const start=async(options:{retry?:Run;retest?:Run;compare?:boolean;question?:string;caseSource?:'edited'|'saved'}={})=>{
    const generation=contextGeneration.current;
    const revision=draftEdits.current;
    const startingCase=mode==='test'&&!options.retry&&!options.retest&&(!nextConversation||options.compare||options.caseSource);
    const saved=startingCase&&storedCase&&(options.caseSource==='saved'||(!options.caseSource&&!editedCase))?storedCase:undefined;
    const q=(options.retest?.input??options.retry?.input??saved?.input??options.question??(options.caseSource||options.compare?caseInput:encodedInput)).trim();
    if(!q)throw Error('질문을 입력하세요.');
    if(q.length>runInputLimit)throw Error(sizeError);
    const args:Record<string,unknown>={input:q,mode:options.retry?.mode||mode};
    if(startingCase){
      if(selectedCase)args.caseId=selectedCase;
      if(saved)delete args.input;
      else if(selectedCase||expected||caseTitle||fixture.trim()!=='{}'){
        args.caseFixture=parseFixture(fixture);args.caseTitle=caseTitle;args.caseExpected=expected;
      }
      if(!conversation)caseQuestion.current=encodedInput;
    }
    if(options.retest){delete args.input;args.caseFromRun=options.retest.id;args.mode='test';}
    else if(options.retry){args.retryOf=options.retry.id;if(options.retry.version)args.version=options.retry.version;}
    else if(version && mode==='test')args.version=Number(version);
    if(nextConversation&&!options.compare&&!options.retry&&!options.retest&&!options.caseSource)args.conversation=nextConversation;
    const startsDraft=mode==='test'&&!args.version&&!args.conversation&&!options.retry;
    if(editorDraft && (startsDraft || (options.compare && compareWith==='draft'))){
      if(editorDraft.issue)throw Error(editorDraft.issue);
      if(!(await editorDraft.save()))throw Error('편집 내용을 저장한 후 다시 시험하세요.');
    }
    const draftRevision=editorDraft?.getDraftRevision();
    if(startsDraft && draftRevision!==undefined)args.draftRevision=draftRevision;
    const shareScope=project.shareGeneration ? project.shareGeneration+'.' : '';
    const slot='studio.pending-run.'+project.id+'.'+shareScope+await intentHash([args,options.compare?compareWith:'']);
    let requestKey=pendingKeys.current.get(slot);
    try{requestKey??=sessionStorage.getItem(slot)||undefined;}catch{}
    requestKey??=requestId();pendingKeys.current.set(slot,requestKey);try{sessionStorage.setItem(slot,requestKey);}catch{}
    const first=await base('run.start',{...args,requestKey}) as Run;
    if(contextGeneration.current!==generation){
      keep(first);pendingKeys.current.delete(slot);try{sessionStorage.removeItem(slot);}catch{}
      return;
    }
    if(startsDraft && editorDraft){setTestedDraft(editorDraft.graph);setContinueWithOriginal(null);}
    keep(first,true,!conversation&&!options.caseSource);
    if(!embedded)setNewAnswer(first.id);
    if(options.caseSource && revision===draftEdits.current){setInput(undefined);clearAttachment();}
    if(options.compare){
      setComparisonExpected(first.testCase?.expected??'');
      setPair([first.id]);
      const second=await base('run.start',{mode:'test',caseFromRun:first.id,requestKey:requestKey+'-comparison',version:compareWith==='draft'?undefined:Number(compareWith),
        ...(compareWith==='draft'&&{draftRevision})}) as Run;
      keep(second);
      if(contextGeneration.current===generation)setPair([first.id,second.id]);
      if(revision===draftEdits.current){setInput(undefined);clearAttachment();}
    }else setPair([]);
    pendingKeys.current.delete(slot);try{sessionStorage.removeItem(slot);}catch{}
  };
  async function submitQuestion(previous?:string){
    const question=previous??encodedInput;
    const revision=draftEdits.current,generation=contextGeneration.current;
    setSending({question,failed:false});
    rememberSubmission(question,true);
    if(previous===undefined){setInput('');clearAttachment();}
    try {
      await start({question});
      if(contextGeneration.current!==generation)return;
      rememberSubmission(question,false);
      setSending(null);
      if(previous===undefined && revision===draftEdits.current)setInput(undefined);
    } catch(err) {
      if(contextGeneration.current!==generation)return;
      if(previous===undefined && revision===draftEdits.current) {
        setInput(input);setAttachment(attachment);rememberSubmission(question,false);setSending(null);
      } else setSending({question,failed:true});
      throw err;
    }
  }
  async function chooseFile(file:File|undefined){
    draftEdits.current++;
    const read=++fileRead.current;
    setFileError('');setFileLoading(Boolean(file));
    if(!file)return;
    try {
      const data=await readInputFile(file);
      if(read!==fileRead.current)return;
      const issue=attachmentError(data,fileExtensions(accept));
      if(issue)throw Error(issue);
      if(attachment && JSON.stringify({...data,question:input.trim()||data.fileName}).length>runInputLimit)throw Error(sizeError);
      setAttachment(data);
    } catch(err){if(read===fileRead.current)setFileError(msg(err));}
    finally{if(read===fileRead.current)setFileLoading(false);}
  }
  const saveCase=async(update:boolean)=>{
    const q=(caseInput||(conversation?current?.input:'' )||'').trim();
    if(q.length>runInputLimit)throw Error(sizeError);
    if(!caseTitle.trim()||!q||!expected.trim())throw Error('사례 이름, 시험 입력, 기대 결과를 작성하세요.');
    let title=caseTitle.trim();
    if(!update && selectedCase && cases.some(c=>c.title===title)){
      let suffix=2;
      while(cases.some(c=>c.title===title.slice(0,128)+' ('+suffix+')'))suffix++;
      title=title.slice(0,128)+' ('+suffix+')';
    }
    const saved=await base('cases.save',{title,input:q,expected,fixture:parseFixture(fixture),
      ...(update?{caseId:selectedCase,original:storedCase}:{})});
    const rows=await base('cases.list') as Case[];setCases(rows);
    if(!update)rememberCase();
    caseDrafts.current.delete(saved.id);
    chooseCase(rows.find(item=>item.id===saved.id),false);setNotice(update?'시험 사례를 업데이트했습니다.':'시험 사례를 저장했습니다.');
  };
  const editorTurn=current && (!draftIssue || active(current) || current.state==='waiting') ? [current] : [];
  const visibleTurns=embedded?editorTurn:chatTurns;
  const runActionsDisabled=busy||sharingRevoked||restoringRun;
  const historyRecord=(r:Run)=><button className={'run-history '+(current?.id===r.id?'selected':'')} key={r.id} aria-current={current?.id===r.id?'true':undefined}
        onClick={()=>void action(()=>openRecord(r))} disabled={runActionsDisabled||fileLoading||r.projectAccessRevoked}>
        <strong>{r.projectAccessRevoked?'공유가 종료된 문답':questionText(r.input)||'열 수 없는 문답'}</strong>
        <small>{embedded && '실행 '+r.runNumber+' · '}{states[r.state]} · {r.mode==='test'?'시험':'사용'}{r.version?' · 설계 '+r.version+'판':''}</small>
        {embedded && <><EditionSummary run={r}/>{r.output && <span className="run-history-preview">답변 · {r.output.replace(/\s+/g,' ').slice(0,140)}</span>}</>}
      </button>;
  const groups=new Map<string,Run[]>();
  if(!embedded)for(const r of history){
    const turns=groups.get(r.conversation);
    if(turns)turns.push(r);else groups.set(r.conversation,[r]);
  }
  const conversations=Array.from(groups,([id,turns])=>{
    const latest=turns[0];
    if(latest.projectAccessRevoked)
      return {id,turns,latest,updated:latest.updated,title:'공유가 종료된 대화',preview:'새 대화를 시작하세요.'};
    const draft=readDraft(id);
    const preview=draft.question?.trim()||draft.attachment?.fileName;
    const updated=turns.reduce((last,r)=>r.updated>last?r.updated:last,draft.updated??latest.created);
    return {id,turns,latest,updated,title:questionText(turns.at(-1)!.input)||'열 수 없는 대화',
      preview:preview?'작성 중 · '+preview:latest.output?'답변 · '+latest.output:states[latest.state]+' · '+questionText(latest.input)};
  }).sort((a,b)=>b.updated.localeCompare(a.updated));
  const sameTitles=new Map<string,string[]>();
  for(const group of [...conversations].sort((a,b)=>a.turns.at(-1)!.created.localeCompare(b.turns.at(-1)!.created)||a.id.localeCompare(b.id))){
    const ids=sameTitles.get(group.title);
    if(ids)ids.push(group.id);else sameTitles.set(group.title,[group.id]);
  }
  const historyContents=<>
      <button className="run-new" disabled={runActionsDisabled||fileLoading} onClick={newConversation}>＋ 새 대화</button>
    {history.some(r=>r.state==='waiting'&&r.prompt)&&<section aria-label="응답 필요"><h4>응답 필요</h4>{history.filter(r=>r.state==='waiting'&&r.prompt).map(historyRecord)}</section>}
    {history.length===0?<p>아직 실행한 질문이 없습니다.</p>:embedded?history.map(historyRecord):conversations.map(group=>
      <div className="run-conversation" key={group.id}>
        <button type="button" className={'run-history '+(group.id===conversation?'selected':'')} aria-current={group.id===conversation?'true':undefined}
          disabled={runActionsDisabled||fileLoading||group.latest.projectAccessRevoked} onClick={()=>void action(()=>openRecord(group.latest))}>
          <strong>{group.title}</strong>
          {sameTitles.get(group.title)!.length>1&&<small>같은 제목의 대화 {sameTitles.get(group.title)!.indexOf(group.id)+1}</small>}
          <span className="run-history-preview">{group.preview.replace(/\s+/g,' ').slice(0,140)}</span>
          <small>{group.latest.mode==='test'?'시험':'사용'}{group.latest.version?' · '+group.latest.version+'판':''} · <time dateTime={group.updated}>{historyTime.format(new Date(group.updated))}</time></small>
        </button>
        {group.turns.length>1&&<details><summary>문답 {group.turns.length}개</summary>{group.turns.map(historyRecord)}</details>}
      </div>)}
    </>;
  const historyPanel=<aside className={'run-sidebar '+(embedded&&selectedHistory?'show':'')}><h3>내 실행 기록</h3>{historyContents}</aside>;
  const sendingBlocked=runActionsDisabled||Boolean(restoreError)||fileLoading||Boolean(draftIssue)||accept===undefined||Boolean(active(current))||current?.state==='waiting'||Boolean(pendingTurn);
  const composingNext=Boolean(nextConversation || (sending && !sending.failed));
  const composerHint=pendingTurn && pendingTurn.id!==current?.id?'진행 중인 문답을 열어 상태를 확인하세요.':current?.state==='waiting'?'위 요청에 회신하면 다음 질문을 이어서 보낼 수 있습니다.'
    :active(current)||(sending && !sending.failed)?'다음 질문을 미리 작성할 수 있습니다.'
    :nextConversation?'대화의 시작 버전으로 실행합니다.':draftChanged?'수정한 초안으로 실행합니다.':mode==='test'?'시험 실행':'실제 사용';
  const body=<div className="run-grid">
    {!embedded&&historyPanel}
    <div className="run-main">
      {embedded&&<div className="run-editor-tools">
        <button type="button" aria-expanded={selectedHistory} onClick={()=>setSelectedHistory(!selectedHistory)}>실행 기록</button>
        <button type="button" aria-expanded={showSettings} onClick={()=>setShowSettings(!showSettings)}>실행 설정</button>
      </div>}
      {embedded&&selectedHistory&&historyPanel}
      {restoringRun&&<p role="status">진행하던 실행을 여는 중입니다.</p>}
      {restoreError&&<div className="run-reconnect" role="alert">{restoreError}
        <button type="button" onClick={()=>{setRestoreError('');setRestoringRun(true);setRestoreAttempt(n=>n+1);}}>진행하던 실행 다시 열기</button>
      </div>}
      {(!embedded||showSettings)&&<div className="run-bar">{!embedded&&<button type="button" ref={historyToggle} className="run-history-toggle" aria-haspopup="dialog" aria-expanded={selectedHistory} onClick={()=>setSelectedHistory(true)}>실행 기록</button>}
        {project.mine?<label>실행 환경 <select value={mode} disabled={busy||fileLoading||Boolean(conversation)} onChange={e=>{
          const next=e.target.value as 'test'|'live';
          if(embedded)clearAttachment();else{resetPicker();enter('new/'+next);}
          setMode(next);
        }}>
          <option value="test">시험 데이터</option><option value="live" disabled={!project.publicVersion}>실제 사용 · 게시 버전</option></select></label>:<span>게시된 Agent</span>}
        {project.mine&&mode==='test'&&!conversation&&<label>설계 <select aria-label="실행할 설계 버전" value={version} disabled={busy} onChange={e=>{clearAttachment();setVersion(e.target.value);if(compareWith===(e.target.value||'draft'))setCompareWith('');}}><option value="">현재 초안</option>
          {versions.map(v=><option key={v.number} value={v.number}>{v.number}판 · {v.title}</option>)}</select></label>}
        {project.mine&&<button onClick={()=>setShowTests(!showTests)} aria-expanded={showTests}>시험 사례</button>}
        {project.mine&&<button onClick={()=>setShowTriggers(!showTriggers)} aria-expanded={showTriggers}>자동 시작</button>}
      </div>}
      {draftIssue&&<div className="run-draft-issue" role="alert">
        <strong>초안을 실행하려면 설계를 수정하세요.</strong><p>{draftIssue}</p>
        <button type="button" onClick={editorDraft?.onInspectIssues}>설계 검사</button>
      </div>}
      {(sharingRevoked||error)&&<p role="alert" className="run-error">{sharingRevoked?revokedMessage:error}</p>}{notice&&<p role="status" className="run-note">{notice}</p>}
      {(!embedded||showSettings)&&showTriggers&&<TriggerPane id={project.id} api={api} onRun={async id=>{await load(id);setTestedDraft(null);setShowTriggers(false);}}/>}
      {(!embedded||showSettings)&&showTests&&<section className="run-cases"><h3>내 시험 사례</h3>
        <select aria-label="시험 사례 선택" value={selectedCase} disabled={busy} onChange={e=>chooseCase(cases.find(x=>x.id===e.target.value))}>
          <option value="">직접 작성</option>{cases.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select>
        <label>사례 이름<input disabled={busy} value={caseTitle} onChange={e=>setCaseTitle(e.target.value)}/></label>
        <label>기대 결과<textarea disabled={busy} value={expected} onChange={e=>editCase(()=>setExpected(e.target.value))} rows={2}/></label>
        <details><summary>시험 초기 데이터</summary><textarea disabled={busy} value={fixture} aria-label="시험 초기 데이터 JSON" onChange={e=>editCase(()=>setFixture(e.target.value))} rows={3}/></details>
        {storedCase&&mode==='test'&&<>
          {editedCase&&<p className="run-note">저장 전 변경이 있습니다. 각 시험은 새 대화에서 시작합니다.</p>}
          <div className="run-row run-case-actions">
          <button disabled={sendingBlocked||!caseInput||oversized} onClick={()=>void action(()=>start({caseSource:'edited'}))}>현재 편집값으로 시험</button>
          <button disabled={sendingBlocked} onClick={()=>void action(()=>start({caseSource:'saved'}))}>저장된 사례로 시험</button>
        </div></>}
        <div className="run-row">{storedCase&&<button disabled={busy||fileLoading||oversized} onClick={()=>void action(()=>saveCase(true))}>이 사례 업데이트</button>}
          <button disabled={busy||fileLoading||oversized} onClick={()=>void action(()=>saveCase(false))}>{storedCase?'새 사례로 저장':'현재 입력으로 사례 저장'}</button>
        {versions.length>0&&mode==='test'&&<><select aria-label="비교할 버전" value={compareWith} onChange={e=>setCompareWith(e.target.value)}>
          <option value="">비교할 버전 선택</option>{version&&<option value="draft">현재 초안</option>}{versions.filter(v=>String(v.number)!==version).map(v=><option key={v.number} value={v.number}>{v.number}판</option>)}</select>
          <button disabled={busy||fileLoading||accept===undefined||Boolean(editorDraft?.issue&&(!version||compareWith==='draft'))||!compareWith||compareWith===(version||'draft')||!caseInput||oversized||!selectedCase} onClick={()=>void action(()=>start({compare:true}))}>같은 사례로 두 번 시험</button></>}</div>
      </section>}
      <div ref={transcript} className="run-transcript">
        {!embedded&&!current&&!sharingRevoked&&<div className="run-empty"><strong>Agent에게 첫 질문을 보내세요.</strong><p>{mode==='test'?'시험 실행은 분리된 데이터에서 처리합니다.':'승인이 필요한 작업은 실행 내용을 확인한 후 진행합니다.'}</p></div>}
        {visibleTurns.map(turn=>{
          const selected=turn.id===current?.id;
          return <section key={turn.id} data-run-turn={turn.id} className="run-turn" tabIndex={-1} aria-label={embedded?'시험 문답':questionText(turn.input).slice(0,140)}>
            {embedded&&<h3>{draftChanged?'이전 실행의 질문':'보낸 질문'}</h3>}
            <div className="run-question">{questionText(turn.input)}</div>
            <article className="run-answer" tabIndex={-1} aria-live={selected?'polite':'off'}>
              <div className="run-answer-meta"><strong>{embedded?'답변':project.title}</strong><span>{states[turn.state]}</span>
                {selected&&(active(turn)||turn.state==='waiting')&&<button disabled={busy} onClick={()=>void action(()=>stop(turn))}>실행 중지</button>}</div>
              {active(turn)&&!sharingRevoked&&<p className="run-note">실행 경로를 업데이트하고 있습니다.</p>}
              {turn.output&&<FormattedAnswer text={turn.output} format={turn.outputFormat}/>}{turn.error&&<p className="run-error">{turn.error}</p>}
              {embedded&&<EditionSummary run={turn}/>}
              <CaseEvidence run={turn}/>
              {selected?<>
                {turn.state==='waiting'&&(turn.prompts?.length?turn.prompts:turn.prompt?[turn.prompt]:[]).map(prompt=>{
                  const request={...turn,prompt};
                  return prompt.kind==='file'?<RunFileReply key={prompt.id} draftKey={waitDraftKey(request)} prompt={prompt} examples={visibleExamples} disabled={runActionsDisabled}
                    send={value=>reply(request,value)}/>:<PromptReply key={prompt.id} draftKey={waitDraftKey(request)} prompt={prompt} disabled={runActionsDisabled}
                    send={(value,approved)=>reply(request,value,approved)}/>;
                })}
                {(turn.state==='stopped'||turn.state==='failed')&&<button disabled={runActionsDisabled} onClick={()=>void action(()=>start({retry:turn}))}>같은 입력으로 새 실행</button>}
                {embedded&&turn.mode==='test'&&!active(turn)&&turn.state!=='waiting'&&<button disabled={runActionsDisabled} onClick={()=>void action(()=>start({retest:turn}))}>같은 질문·첨부·시험 자료로 현재 초안 다시 시험</button>}
                <Files run={turn}/><Operations run={turn}/>
                {turn.operations?.some(o=>o.status==='unknown')&&<button disabled={runActionsDisabled} onClick={()=>void action(async()=>{keep(await base('run.receipts',{runId:turn.id}),true);})}>원래 요청의 처리 결과 다시 확인</button>}
                <Trace run={turn}/>
              </>:<button type="button" className="run-turn-details" disabled={runActionsDisabled} onClick={()=>void action(()=>openRecord(turn))}>이 문답의 실행 상세 보기</button>}
            </article>
          </section>;
        })}
        {!draftIssue&&pair.length>0&&<section className="run-comparison"><h3>버전 비교</h3>{comparisonExpected&&<p>기대 결과 · {comparisonExpected}</p>}
          {pair.map(id=>{const r=history.find(x=>x.id===id);return r&&<article key={id}><b>{r.version?r.version+'판':'초안'} · {states[r.state]}</b>
            {r.state==='waiting'?<ul>{(r.prompts?.length?r.prompts:r.prompt?[r.prompt]:[]).map(prompt=><li key={prompt.id}>{prompt.prompt}
              {prompt.expiresAt&&<> · 회신 기한 <time dateTime={prompt.expiresAt}>{new Date(prompt.expiresAt).toLocaleString('ko-KR')}</time></>}</li>)}</ul>:<p>{r.output||r.error||states[r.state]}</p>}
            {r.state==='waiting'&&r.id!==current?.id&&<button type="button" disabled={busy} onClick={()=>void action(()=>openRecord(r))}>이 비교 실행에 회신</button>}</article>;})}</section>}
      </div>
      {completedAnswer&&answerOffscreen&&<div className="run-jump-answer">
        <button type="button" onClick={viewNewAnswer}>새 답변 보기</button>
      </div>}
      <form className="run-compose" onSubmit={e=>{e.preventDefault();if(!sendingBlocked && encodedInput && !oversized)void action(()=>submitQuestion());}}>
        {ruleChanged && editorDraft && current && !active(current) && current.state!=='waiting' &&
          <label>시험에 사용할 원문 <select value={draftChanged?'current':'original'} disabled={busy||fileLoading}
            onChange={event=>setContinueWithOriginal(event.target.value==='original'?editorDraft.graph:null)}>
            <option value="current">현재 원문 · 새 대화</option>
            <option value="original">이전 원문 · 같은 대화</option>
          </select></label>}
        {!sharingRevoked&&inputSetupError&&<div className="run-reconnect" role="alert"><span>{inputSetupError}</span>
          <button type="button" onClick={()=>setInputSetupAttempt(n=>n+1)}>다시 연결</button></div>}
        {sending&&!sending.failed&&<div className="run-submission" role="status"><strong>접수 중인 질문</strong><span>{questionText(sending.question)}</span></div>}
        {failedQuestions.filter(q=>sending?.failed||q!==sending?.question).map(q=><div key={q} className="run-submission" role="status"><strong>접수를 확인하지 못한 질문</strong>
          <span>{questionText(q)}</span><button type="button" disabled={sendingBlocked} onClick={()=>void action(()=>submitQuestion(q))}>이 질문 다시 보내기</button></div>)}
        {embedded&&<label className="run-input-label" htmlFor="editor-run-question">{composingNext?'다음 질문':'시험 질문'}</label>}
        {typeof accept==='string'&&<div><label className="run-file-picker">{attachment?'입력 파일 바꾸기':'입력 파일 첨부'}
          <input ref={fileInput} type="file" accept={accept||undefined} aria-describedby={attachment ? fileStatusId : undefined}
            onChange={e=>void chooseFile(e.target.files?.[0])}/></label>
          {attachment&&<><span id={fileStatusId} className="run-attached-name">첨부됨 · {attachment.fileName}</span>
            <button type="button" aria-label={attachment.fileName+' 첨부 해제'} onClick={()=>{draftEdits.current++;clearAttachment();}}>첨부 해제</button></>}
          {current?.state!=='waiting'&&<ExampleFileButtons examples={visibleExamples} disabled={busy||Boolean(active(current))}
            onPick={file=>{draftEdits.current++;clearAttachment();setAttachment(file);}}/>}</div>}
        {fileError&&<p className="run-error" role="alert">{fileError}{attachment&&' 기존 첨부 '+attachment.fileName+'을 유지했습니다.'}</p>}
        {oversized&&<p id="run-input-limit" className="run-error" role="alert">{sizeError}</p>}
        <textarea id={embedded?'editor-run-question':undefined} aria-label={composingNext?'같은 대화의 새 질문':'Agent에게 보낼 질문'} rows={3} placeholder={composingNext?'다음 질문 입력':'Agent에게 보낼 질문 입력'}
          value={input} aria-invalid={oversized||undefined} aria-describedby={oversized?'run-input-limit':undefined} onChange={e=>{draftEdits.current++;setInput(e.target.value);}}/>
        <div>{!sharingRevoked&&<small>{composerHint}</small>}<button className="run-primary" disabled={sendingBlocked||!encodedInput||oversized}>질문 실행</button></div>
      </form>
    </div></div>;
  if(editorDraft)return <div className="studio-run-panel run-editor">{body}</div>;
  return <dialog ref={dialog} className="studio-run-panel" aria-labelledby="run-title" onCancel={e=>{
    if(e.target===e.currentTarget){e.preventDefault();onClose();}
  }}>
    <header className="run-head"><div><span>Agent 실행</span><h2 id="run-title">{project.title}</h2></div><button type="button" onClick={onClose} aria-label="실행 화면 닫기">닫기</button></header>
    {body}
    {selectedHistory&&<MobileRunHistory onClose={closeHistory} opener={historyToggle}>{historyContents}</MobileRunHistory>}
  </dialog>;
}
