import { useEffect, useLayoutEffect, useState } from 'react';
import { Link2, Plus, Undo2 } from 'lucide-react';
import type { ReleaseAction } from '../domain/release-decision';
import { api, finishWrite, pendingWriteKey, StudioApiError } from './client';
import type { TestSources } from '../domain/source-preview';
import ReleaseDecisionForm from './ReleaseDecisionForm';
import { SourceOutputChoice } from './editor/SourceOutputChoice';
import type { SourceOutput } from './editor/source-comparison';
import { dateLabel, visibilityNames, type FullProject, type Project } from './studio-project';

type Version = { number: number; title: string; created: string };
type ArchivedDraft = { revision: number; title: string; created: string };
export type RestoreTarget = { version: number } | { archive: number };
type RunStat = { state: string; n: number };
type PublicationState = Pick<Project,'visibility'|'publicVersion'|'token'>;
export type VersionPanelMode = 'versions' | 'share';
export type VersionInfo = {
  versions: Version[];
  archives: ArchivedDraft[];
  stats: RunStat[];
  current: PublicationState;
  tested: TestSources|null;
  visibility: Project['visibility'];
  selectedVersion: number | undefined;
};

export async function readVersionInfo(project: Project, mode: VersionPanelMode): Promise<VersionInfo> {
  const [versions, stats, archives, current, tested] = await Promise.all([
    api<Version[]>('versions.list', { id: project.id }),
    api<RunStat[]>('project.stats', { id: project.id }),
    mode === 'versions' ? api<ArchivedDraft[]>('versions.archives', { id: project.id }) : [],
    api<PublicationState>('versions.state', {id:project.id}),
    api<TestSources|null>('run.lastTestSources', {id:project.id}),
  ]);
  const latest = versions[0]?.number;
  return {
    versions, stats, archives, current, tested, visibility:current.visibility,
    selectedVersion: mode === 'share' ? current.publicVersion ?? latest : latest,
  };
}

export async function saveProjectVersion({ id, revision }: FullProject) {
  const slot='studio.versionSave.'+id+'.'+revision;
  const requestKey=pendingWriteKey(slot);
  const { number } = await api<{ number: number }>('versions.save', { id, revision, requestKey });
  const versions = await api<Version[]>('versions.list', { id });
  finishWrite(slot,requestKey);
  return { number, versions };
}

type Props = {
  project: FullProject;
  mode: VersionPanelMode;
  initial: VersionInfo;
  busy: boolean;
  runAction: (perform: () => Promise<unknown>, successMessage: string) => void;
  onSaveVersion: (includeEdited:boolean) => ReturnType<typeof saveProjectVersion>;
  readSources: () => SourceOutput | undefined;
  onRestore: (target: RestoreTarget) => void;
  onSharingChanged: (project: FullProject) => Promise<void>;
  onDecisionRecorded: (project: FullProject) => void;
  onOpenShare: () => void;
};

export default function ProjectVersionPanel({
  project, mode, initial, busy, runAction, onSaveVersion, onRestore, readSources,
  onSharingChanged, onDecisionRecorded, onOpenShare,
}: Props) {
  const [versions, setVersions] = useState(initial.versions);
  const [sourceOutput, setSourceOutput] = useState(readSources);
  // Read the editor's source drafts after its ref is attached, including on return from sign-in.
  useLayoutEffect(() => { setSourceOutput(readSources()); },[]);
  const [includeEdited, setIncludeEdited] = useState(true);
  const invalidSource = includeEdited && Object.values(sourceOutput?.drafts ?? {}).some(draft=>!draft.text.trim());
  const [selectedVersion, setSelectedVersion] = useState(initial.selectedVersion);
  const [editionTest,setEditionTest]=useState<{version:number;label:string;test?:TestSources}>();
  useEffect(()=>{
    if(!selectedVersion)return;
    const controller=new AbortController(),version=selectedVersion;
    api<TestSources|null>('run.lastTestSources',{id:project.id,version},controller.signal).then(test=>{
      if(controller.signal.aborted)return;
      const labels:Record<string,string>={completed:'완료',failed:'실패',stopped:'중지',queued:'시작 대기',running:'실행 중',waiting:'응답 대기'};
      const label=test?[test.caseTitle,labels[test.state??''],dateLabel(test.created)].filter(Boolean).join(' · '):'시험 기록 없음';
      setEditionTest({version,label,test:test??undefined});
    }).catch(()=>{if(!controller.signal.aborted)setEditionTest({version,label:'시험 기록을 불러올 수 없습니다.'});});
    return ()=>controller.abort();
  },[project.id,selectedVersion]);
  const [selectedArchive, setSelectedArchive] = useState(initial.archives[0]?.revision);
  const [visibility, setVisibility] = useState(initial.visibility);
  const [current,setCurrent] = useState(initial.current);
  const exercise = project.releaseExercise;
  const lastDecisionNumber = exercise?.decisions[0]?.number ?? 0;
  const scopeChanged = visibility !== current.visibility;
  const versionChanged = selectedVersion !== undefined && selectedVersion !== current.publicVersion;
  const pending = scopeChanged || versionChanged;
  const publishedLabel = current.publicVersion ? 'v' + current.publicVersion : '없음';

  async function saveVersion() {
    const saved = await onSaveVersion(includeEdited);
    setSourceOutput(readSources());
    setVersions(saved.versions);
    setSelectedVersion(saved.number);
    return saved.number;
  }

  async function updateSharing(action:'versions.publish'|'project.revoke',changes:Record<string,unknown>) {
    try {
      const updated=await api<FullProject>(action,{id:project.id,...changes,expectedVisibility:current.visibility,
        expectedPublicVersion:current.publicVersion,expectedToken:current.token});
      setCurrent(updated);
      return updated;
    } catch(error) {
      if(error instanceof StudioApiError && error.status===409) {
        const fresh=await api<PublicationState>('versions.state',{id:project.id});
        if(current.visibility!==fresh.visibility || current.publicVersion!==fresh.publicVersion || current.token!==fresh.token) {
          setCurrent(fresh);
          setVersions(await api<Version[]>('versions.list',{id:project.id}));
        }
      }
      throw error;
    }
  }

  async function publish() {
    const version = selectedVersion ?? await saveVersion();
    const updated = await updateSharing('versions.publish',{version,visibility});
    setSelectedVersion(version);
    await onSharingChanged(updated);
  }

  async function revoke() {
    const updated = await updateSharing('project.revoke',{});
    setVisibility(updated.visibility);
    setSelectedVersion(updated.publicVersion ?? versions[0]?.number);
    await onSharingChanged(updated);
  }

  async function copyLink() {
    const address = new URL(window.location.origin);
    address.searchParams.set('agent', project.id);
    if (current.visibility === 'link' && current.token) address.searchParams.set('token', current.token);
    await navigator.clipboard.writeText(address.href);
  }

  async function recordDecision(action: ReleaseAction, reason: string) {
    const updated = await api<FullProject>('versions.decide', {
      id: project.id, version: selectedVersion, action, reason, visibility,
      expectedDecision: lastDecisionNumber,
      expectedPublicVersion: current.publicVersion,
      expectedVisibility: current.visibility,
    });
    setVisibility(updated.visibility);
    setCurrent(updated);
    onDecisionRecorded(updated);
  }

  return (
    <>
      {mode === 'share' && <>
        <p>공유할 프로젝트 <strong>{project.title}</strong></p>
        <section className="share-current" aria-label="현재 공유 상태">
          <div><span>현재 공개 범위</span><strong>{visibilityNames[current.visibility]}</strong></div>
          <span>현재 게시 버전 {publishedLabel}</span>
          {current.publicVersion && current.visibility !== 'private' && (
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => runAction(copyLink, '현재 공유 주소를 복사했습니다.')}>현재 공유 주소 복사</button>
              <button className="plain" disabled={busy} onClick={() => runAction(revoke, '공유를 철회했습니다.')}>공유 철회</button>
            </div>
          )}
        </section>
      </>}
      {sourceOutput && <SourceOutputChoice data={{...sourceOutput,tested:initial.tested}} action="버전 저장" edited={includeEdited} onChoose={setIncludeEdited}/>}
      <div className="row">
        {mode === 'versions' && <span>현재 게시 버전 {publishedLabel}</span>}
        <button className="btn" disabled={busy || invalidSource}
          onClick={() => runAction(saveVersion, '현재 설계를 버전으로 저장했습니다.')}>
          <Plus size={15} />현재 초안 버전 저장
        </button>
      </div>
      {versions.length > 0 && (
        <label className="field">
          대상 버전
          <select disabled={busy} value={selectedVersion || ''} onChange={e => setSelectedVersion(Number(e.target.value))}>
            {versions.map(version => (
              <option key={version.number} value={version.number}>
                v{version.number} · {version.title} · {dateLabel(version.created)}
              </option>
            ))}
          </select>
        </label>
      )}
      {selectedVersion && <p aria-live="polite">v{selectedVersion}의 최근 시험 · {editionTest?.version===selectedVersion?editionTest.label:'확인 중'}</p>}
      {editionTest?.version===selectedVersion && editionTest?.test?.question && <details>
        <summary>v{selectedVersion} 시험 질문과 답변</summary><p>{editionTest.test.question}</p>
        <p style={{whiteSpace:'pre-wrap'}}>{editionTest.test.answer || editionTest.test.error || '아직 답변이 없습니다.'}</p>
      </details>}
      {mode === 'versions' && (
        <div className="row">
          <button className="btn" disabled={!selectedVersion || busy}
            onClick={() => selectedVersion && onRestore({version:selectedVersion})}>
            <Undo2 size={16} />초안으로 복원
          </button>
          <button className="btn" onClick={onOpenShare}><Link2 size={16} />공유 설정</button>
        </div>
      )}
      {mode === 'versions' && selectedArchive !== undefined && (
        <details>
          <summary>복원 직전 초안 ({initial.archives.length})</summary>
          <label className="field">
            보관된 초안
            <select value={selectedArchive} onChange={event => setSelectedArchive(Number(event.target.value))}>
              {initial.archives.map(archive => (
                <option key={archive.revision} value={archive.revision}>
                  {archive.title} · {new Date(archive.created).toLocaleString('ko-KR')} · 수정 {archive.revision}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" disabled={busy} onClick={() => onRestore({archive:selectedArchive})}>선택한 초안 다시 열기</button>
        </details>
      )}
      {mode === 'share' && (
        <>
          <label className="field">
            공유 범위
            <select disabled={busy} value={visibility} onChange={e => setVisibility(e.target.value as Project['visibility'])}>
              {Object.entries(visibilityNames).map(([value, name]) => (
                <option key={value} value={value}>{name}</option>
              ))}
            </select>
          </label>
          {pending && <div className="share-pending" aria-live="polite">
            <strong>적용 전 변경</strong>
            {scopeChanged && <span>{visibilityNames[current.visibility]} → {visibilityNames[visibility]}</span>}
            {versionChanged && <span>게시 버전 {publishedLabel} → v{selectedVersion}</span>}
          </div>}
          {exercise && (
            <ReleaseDecisionForm
              key={[project.id, selectedVersion, lastDecisionNumber].join('/')}
              version={selectedVersion} published={current.publicVersion}
              audienceChanged={visibility !== current.visibility} decisions={exercise.decisions}
              busy={busy}
              onDecide={(action, reason) => runAction(() => recordDecision(action, reason), '게시 판단과 근거를 기록했습니다.')}
            />
          )}
          <div className="row">
            {!exercise && (
              <button className="btn primary" disabled={busy || (!selectedVersion && invalidSource) || (!pending && current.publicVersion !== null)}
                onClick={() => runAction(publish, '공유 설정을 적용했습니다.')}>
                {scopeChanged && selectedVersion === current.publicVersion ? '공유 설정 적용' : '선택한 버전 게시'}
              </button>
            )}
          </div>
        </>
      )}
      {initial.stats.length > 0 && (
        <small>실행 집계 · {initial.stats.map(stat => stat.state + ' ' + stat.n + '건').join(' / ')}</small>
      )}
    </>
  );
}
