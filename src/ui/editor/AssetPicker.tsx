import {useEffect, useRef, useState} from 'react';
import {optionalLessonMaterials, type MaterialLesson} from '../../domain/optional-lesson-materials';
import {api, message, StudioApiError} from '../client';
import {assetNumber, duplicateAssetNames} from '../resource-labels';
import type {SharedAssetPin} from './asset-attachment';

export type AssetOption = SharedAssetPin & {mine?:boolean; releasedVersions?:number[]; exampleLesson?:MaterialLesson};

export function accessibleEditions(item:AssetOption) {
  return item.mine ? Array.from({length:item.version}, (_, i) => item.version - i) : item.releasedVersions ?? [item.version];
}

type PickerLesson = MaterialLesson | 'beginner';
function Recovery({lesson, refresh}: {lesson:PickerLesson; refresh:()=>Promise<void>}) {
  const [notice, setNotice] = useState('');
  const example = lesson === 'beginner' ? undefined : optionalLessonMaterials[lesson];
  return <details className="ws-detail">
    <summary>{example ? '예제 자료 찾기·복구' : '저장한 자료 찾기·복구'}</summary>
    <p>삭제한 내 자료는 <a href="/?view=assets&folder=trash" target="_blank" rel="noreferrer">자료 휴지통 열기 (새 탭)</a>에서 3일 안에 복구할 수 있습니다.</p>
    {example ? <>
      <p>이전 실습에서 받은 자료는 ‘내 자료’에도 있을 수 있습니다. 1판 원문을 아래 예시와 대조하세요.</p>
      <p>영구 삭제했다면 <a href="/?view=assets" target="_blank" rel="noreferrer">도구 및 자료 (새 탭)</a>에서 ‘자료 등록 → {example.kind === 'skill' ? 'Skill' : '참고 자료'}’를 고르세요. 이름에 ‘{example.name}’을 쓰고 아래 원문을 붙여 넣어 등록하세요.</p>
      <blockquote className="ws-picker-text">{example.payload.content}</blockquote>
    </> : <p>영구 삭제했다면 초급 사본의 ‘도서관 이용규정’에서 대출 한도를 5권으로 고치고 ‘내 참고 자료로 저장’을 누르세요.</p>}
    <button type="button" className="ws-btn" onClick={async () => {
      try { await refresh(); setNotice('자료 목록을 새로 불러왔습니다.'); }
      catch (error) { setNotice(message(error)); }
    }}>자료 목록 새로고침</button>
    <small role="status">{notice}</small>
  </details>;
}

interface ReadEdition {asset:{name:string}; version:number; payload:{content:string}}
function EditionPreview({id, version, connect}: {id:string; version:number; connect?:(edition:ReadEdition)=>Promise<void>}) {
  const [detail, setDetail] = useState<ReadEdition>();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const preview = useRef<HTMLElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<ReadEdition>('asset.read', {id, version}, controller.signal)
      .then(result => { if (!controller.signal.aborted) setDetail(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(message(cause)); });
    return () => controller.abort();
  }, [id, version, attempt]);
  async function attach() {
    if (!detail || !connect || checking) return;
    setChecking(true);
    setConnectionError('');
    try {
      await connect(detail);
    } catch (cause) {
      if (cause instanceof StudioApiError && [401, 403, 404].includes(cause.status)) {
        setDetail(undefined);
        setError(message(cause));
      } else setConnectionError(message(cause));
    } finally {
      setChecking(false);
    }
  }
  return <section ref={preview} tabIndex={-1} className="ws-field ws-picker-preview" aria-label={connect ? '연결 전 원문' : '연결된 SKILL.md 지침'}>
    {error ? <>
      <small role="alert">{error}</small>
      <button type="button" className="ws-btn" onClick={() => {
        preview.current?.focus();
        setError('');
        setAttempt(value => value + 1);
      }}>원문 다시 불러오기</button>
    </> : detail ? <>
      <strong>{detail.asset.name} · {detail.version}판{!connect && ' · SKILL.md'}</strong>
      <div className="ws-picker-text" tabIndex={0}>{detail.payload.content}</div>
      {connectionError && <small role="alert">{connectionError}</small>}
      {connect && <button type="button" className="ws-btn ws-primary" disabled={checking} onClick={() => void attach()}>{checking ? '자료판 확인 중' : '이 판 연결'}</button>}
    </> : <small role="status">원문을 불러오는 중입니다.</small>}
  </section>;
}

export function AssetPicker({assets, value, label, lesson, pinnedSkillVersion, refresh, onChange}: {
  assets:AssetOption[]; value:string; label:string; lesson?:PickerLesson;
  pinnedSkillVersion?: number;
  refresh:()=>Promise<void>; onChange:(item:AssetOption)=>Promise<void>;
}) {
  const [choice, setChoice] = useState<{id:string; version:number}>();
  const candidate = choice && assets.find(item => item.id === choice.id);
  const duplicates = duplicateAssetNames(assets);
  return <div>
    <label className="ws-field"><span>{label}</span>
      <select value={candidate?.id ?? value} onChange={event => {
        const item = assets.find(asset => asset.id === event.target.value);
        if (item?.kind === 'mcp') void onChange(item).catch(() => { /* The editor displays the connection error. */ });
        else setChoice(item ? {id:item.id, version:item.exampleLesson ? 1 : item.version} : undefined);
      }}>
        <option value="">자료함에서 선택</option>
        {value && !assets.some(item => item.id === value) && <option value={value}>연결한 자료 · 접근할 수 없음</option>}
        {assets.map(item => <option key={item.id} value={item.id}>
          {item.name} · {item.exampleLesson ? '실습 예제 · 원본 1판' : (item.mine ? '내 자료 · 최신 ' : '공유 자료 · 게시 ') + item.version + '판'}
          {duplicates.has(item.name) && ' · 자료 번호 ' + assetNumber(item.id)}
        </option>)}
      </select>
    </label>
    {candidate && choice ? <>
      <label className="ws-field"><span>미리 볼 자료판</span>
        <select value={choice.version} onChange={event => setChoice({id:candidate.id, version:Number(event.target.value)})}>
          {accessibleEditions(candidate).map(version => <option key={version} value={version}>{version}판</option>)}
        </select>
      </label>
      <EditionPreview key={JSON.stringify([candidate.id, choice.version])} id={candidate.id} version={choice.version}
        connect={async detail => {
          const item = {...candidate, name:detail.asset.name, version:detail.version};
          await onChange(item);
          setChoice(current => current?.id === item.id && current.version === item.version ? undefined : current);
        }}/>
    </> : value && pinnedSkillVersion ? <EditionPreview key={JSON.stringify([value, pinnedSkillVersion])}
      id={value} version={pinnedSkillVersion}/> : null}
    {lesson && <Recovery lesson={lesson} refresh={async () => { await refresh(); setChoice(undefined); }}/>}
  </div>;
}
