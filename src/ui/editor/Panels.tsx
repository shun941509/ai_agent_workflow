'use client';
import { useEffect, useId, useRef, useState } from 'react';
import {
  canonicalErrorStrategy,
  answerFormat,
  changesKnowledgeRelease,
  evidenceNeedsSearch,
  connectionOptions,
  connectBlocks,
  groups as GROUPS,
  palette,
  portsFor,
  replyDeadlineDefaultMinutes,
  replyDeadlineMaxMinutes,
  terminalBehavior,
  terminalBehaviorOptions,
  type Block,
  type Edge,
  type Field,
  type Graph,
  type TerminalBehavior,
} from '../../domain/index';
import { BlockIcon, Icon } from './Icons';
import { PromptTextarea } from '../PromptTextarea';
import WorkflowRefPicker from './WorkflowRefPicker';
import McpToolPicker from './McpToolPicker';
import { InlineSourceEditor, type SaveReferenceDocument } from './InlineSourceEditor';
import { dynamicLessonRangeNote } from '../../domain/dynamic-lesson-policy';
import type { RecoveryDraft } from './source-drafts';
import { ReplyFieldsEditor } from './ReplyFieldsEditor';
import { CategoryEditor } from './CategoryEditor';
import { Modal } from './Modal';
import { ConnectionInspector } from './ConnectionInspector';
import type { PairEdit } from './use-editor-history';
import { insertEvidenceSearch } from './evidence-search';
import {AgentContextFields} from './AgentContextFields';
import {emptyAgentContext,type AgentContext} from '../../domain/agent-context';
import {nodeMcpScope,type McpPin} from '../../domain/mcp-scope';
import {AssetPicker, accessibleEditions, type AssetOption} from './AssetPicker';
import {
  changeBlockMode,
  changeTerminalBehavior,
  connectionKindLabels,
  editReplySettings,
  edgeLabel,
  formerNames,
  groupEdges,
  levels,
  replyDeadlineMinutes,
  titleById,
  specFor,
  type Selection,
} from './graph';

export type {AssetOption} from './AssetPicker';
export {Modal} from './Modal';
export type PaletteTab = 'level' | 'all' | 'star';

const paletteAliases: Record<string,string> = {
  'output.answer': [
    'output.answer', 'control.terminate', specFor('control.terminate')?.name,
    ...terminalBehaviorOptions.map(option => option.label),
  ].join(' '),
  'agent.team':'다중 에이전트 Multi Agent multiagent 여러 역할',
  'agent.delegate':'하위 Agent Sub Agent 인계',
  'control.parallel':'병렬 Agent 병령 Agent',
  'knowledge.search':'RAG 검색',
};

export function Palette({
  level,
  tab,
  onTab,
  onAdd,
  graph,
  selection,
  showCatalog,
  onShowCatalog,
  onPick,
  onFind,
  onClose,
  panelRef, modal, inert, practiceCoach,
}: {
  level: string;
  tab: PaletteTab;
  onTab: (tab: PaletteTab) => void;
  onAdd: (type: string, config?: Block['config']) => void;
  graph: Graph;
  selection: Selection;
  showCatalog: boolean;
  onShowCatalog: (show: boolean) => void;
  onPick: (id: string) => void;
  onFind: (id: string) => void;
  onClose: () => void;
  panelRef: React.Ref<HTMLElement>;
  modal: boolean;
  inert: boolean;
  practiceCoach?: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [blockQuery, setBlockQuery] = useState('');
  const [group, setGroup] = useState('');
  const [stars, setStars] = useState<string[]>([]);
  useEffect(() => {
    try {
      const items = JSON.parse(localStorage.getItem('studio.editor.stars') || '[]');
      if (Array.isArray(items)) {
        const types = items.filter((type): type is string => typeof type === 'string');
        const menus = [...new Set(types.map(type => specFor(type)?.menuType || type))];
        setStars(menus);
        if (JSON.stringify(menus) !== JSON.stringify(items)) {
          localStorage.setItem('studio.editor.stars', JSON.stringify(menus));
        }
      }
    } catch {
      /* browser storage can be disabled */
    }
  }, []);
  const toggle = (type: string) => {
    const next = stars.includes(type) ? stars.filter((id) => id !== type) : [...stars, type];
    setStars(next);
    try {
      localStorage.setItem('studio.editor.stars', JSON.stringify(next));
    } catch {
      /* available for this session */
    }
  };
  const search = query.trim().toLowerCase();
  const blockSearch = blockQuery.trim().toLowerCase();
  const currentNodes = graph.nodes.filter(n => titleById(graph, n.id).toLowerCase().includes(blockSearch));
  const isReference = (n: Block) => ['resource.context', 'instruction.skill', 'connection.mcp', 'workflow.tool'].includes(n.type);
  const items = palette.flatMap(entry => {
    if (tab === 'star' && !stars.includes(entry.type)) return [];
    if (tab === 'level' && !search && levels.indexOf(entry.level) > levels.indexOf(level as (typeof levels)[number])) return [];
    const modes = (entry.modes ?? []).filter(mode => mode.value !== 'error.compensate' || level === '전문가' || tab === 'all');
    const matches = (parts: (string | undefined)[]) => parts.join(' ').toLowerCase().includes(search);
    const groupMatches = !group || entry.group === group;
    const timedForm = entry.type === 'input.form' && (
      search ? (groupMatches || group === 'flow') && matches(['회신 기다리기', formerNames['control.wait'], '회신 기한'])
        : group === 'flow'
    );
    const matchingMode = modes.find(mode => {
      const spec = specFor(mode.value);
      return (groupMatches || spec?.group === group) &&
        matches([mode.label, spec?.name, formerNames[mode.value]]);
    });
    const matchesMenu = groupMatches &&
      matches([entry.name, entry.description, paletteAliases[entry.type], formerNames[entry.type]]);
    if (!matchesMenu && !matchingMode && !timedForm) return [];
    const introRecommendedTask = entry.type === 'agent.task' && tab === 'level' && level === '입문';
    let mode = matchesMenu ? undefined : matchingMode;
    if (introRecommendedTask && !mode) {
      mode = modes.find(option => search && matches([option.label]))
        ?? modes.find(option => option.value === 'ai.single_task');
    }
    const type = mode?.value ?? entry.type;
    let description = entry.description;
    if (timedForm) description = `회신 기한 ${replyDeadlineDefaultMinutes}분으로 추가합니다. 기한은 속성에서 변경할 수 있습니다.`;
    else if (mode && (introRecommendedTask || type !== entry.type)) description = mode.label + ' · ' + specFor(type)!.description;
    else if (entry.type === 'tool.invoke' && modes.length > 1) description = '일반 도구 호출 또는 이전 행동을 되돌릴 보상 작업을 설정합니다.';
    return [{entry, type, description, timedForm}];
  });
  return (
    <aside ref={panelRef} className="ws-palette" aria-label="블록 팔레트" role={modal ? 'dialog' : undefined}
      aria-modal={modal || undefined} inert={inert}>
      <div className="ws-panel-heading">
        <h2><Icon name="layers" size={16} />블록 팔레트</h2>
        <button className="ws-icon-button ws-panel-close" onClick={onClose} aria-label="블록 목록 닫기">
          <Icon name="close" />
        </button>
      </div>
      {practiceCoach}
      <div className="ws-palette-mode">
        <button type="button" aria-pressed={!showCatalog} onClick={() => onShowCatalog(false)}>현재 블록</button>
        <button type="button" aria-pressed={showCatalog} onClick={() => onShowCatalog(true)}><Icon name="plus" size={13}/>블록 추가</button>
      </div>
      {!showCatalog ? <>
        <label className="ws-search">
          <Icon name="search" size={15}/><input type="search" aria-label="현재 블록 찾기" placeholder="블록 찾기" value={blockQuery}
            onChange={e => setBlockQuery(e.target.value)} onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 ||
                  event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              const first = currentNodes.find(n => !isReference(n)) ?? currentNodes[0];
              if (first) {
                event.preventDefault();
                onFind(first.id);
              }
            }} />
        </label>
        <div className="ws-current-nodes">
          {[
            { name: '실행 블록', nodes: currentNodes.filter(n => !isReference(n)) },
            { name: '자료와 지침', nodes: currentNodes.filter(isReference) },
          ].map(group => group.nodes.length > 0 && <section key={group.name}>
            <h3>{group.name}</h3>
            {group.nodes.map(n => <button type="button" key={n.id} aria-pressed={selection?.kind === 'node' && selection.id === n.id}
              onClick={() => onPick(n.id)}><BlockIcon type={n.type} /><span>{titleById(graph, n.id)}</span></button>)}
          </section>)}
          {!currentNodes.length && <p className="ws-hint">{graph.nodes.length ? '일치하는 블록이 없습니다.' : '블록 추가에서 첫 블록을 선택하세요.'}</p>}
        </div>
      </> : <>
      <label className="ws-search">
        <Icon name="search" />
        <input
          type="search"
          value={query}
          placeholder="블록 이름 검색"
          aria-label="블록 이름 검색"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="ws-tabs">
        <button aria-pressed={tab === 'level'} onClick={() => onTab('level')}>
          추천
        </button>
        <button aria-pressed={tab === 'all'} onClick={() => onTab('all')}>
          전체 {palette.length}종
        </button>
        <button aria-label="즐겨찾기 블록" aria-pressed={tab === 'star'} onClick={() => onTab('star')}>
          <Icon name="star" size={14} />
        </button>
      </div>
      <select
        className="ws-select"
        aria-label="블록 카테고리"
        value={group}
        onChange={(e) => setGroup(e.target.value)}
      >
        <option value="">모든 카테고리</option>
        {[...new Set(palette.map((p) => p.group))].map((g) => (
          <option key={g} value={g}>
            {GROUPS[g] ?? g}
          </option>
        ))}
      </select>
      <div className="ws-palette-list">
        {items.map(({entry, type, description, timedForm}) => (
          <div className="ws-palette-row" key={entry.type}>
            <button
              className="ws-palette-add"
              title={entry.name + ' 추가'}
              aria-label={entry.name + ' 추가'}
              onClick={() => onAdd(type, timedForm ? {replyTimeoutMinutes:replyDeadlineDefaultMinutes} : undefined)}
            >
              <BlockIcon type={entry.type} />
              <span>
                <strong>{entry.name}</strong>
                <small>{description}</small>
              </span>
            </button>
            <button
              className="ws-star"
              title="즐겨찾기"
              aria-label={entry.name + ' 즐겨찾기'}
              aria-pressed={stars.includes(entry.type)}
              onClick={() => toggle(entry.type)}
            >
              <Icon name="star" size={13} />
            </button>
          </div>
        ))}
        {!items.length && (
          <p className="ws-hint">
            {tab === 'star' ? '블록의 별을 눌러 추가하세요.' : '일치하는 블록이 없습니다.'}
          </p>
        )}
      </div>
      </>}
    </aside>
  );
}
function ConfigField({
  field,
  value,
  change,
  allowEmptyChoice = true,
}: {
  field: Field;
  value: unknown;
  change: (value: unknown) => void;
  allowEmptyChoice?: boolean;
}) {
  const stored = value ?? field.default;
  const savedJson = field.type === 'json' ? JSON.stringify(stored ?? null, null, 2) : '';
  const lastApplied = useRef(savedJson);
  const input = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const errorId = fieldId + '-error';
  const [raw, setRaw] = useState(savedJson),
    [error, setError] = useState(''),
    [item, setItem] = useState('');
  useEffect(() => {
    if (lastApplied.current === savedJson) return;
    lastApplied.current = savedJson;
    setRaw(savedJson);
    setError('');
  }, [savedJson]);
  const label = (
    <span>
      {field.label}
      {field.required && <small className="ws-required">필수</small>}
    </span>
  );
  const listKeys = ['categories', 'requiredFields', 'allowedTools', 'candidates', 'tasks'];
  if(field.key==='fields' && Array.isArray(stored))return <ReplyFieldsEditor entries={stored} onChange={change}/>;
  if (
    field.type === 'json' &&
    listKeys.includes(field.key) &&
    Array.isArray(stored) &&
    stored.every((v) => typeof v === 'string')
  ) {
    const add = () => {
      if (!item.trim() || stored.includes(item.trim())) return;
      change([...stored, item.trim()]);
      setItem('');
      input.current?.focus();
    };
    return (
      <fieldset className="ws-fieldset" data-field-key={field.key}>
        <legend>{label}</legend>
        <div className="ws-chips">
          {stored.map((entry, i) => (
            <button
              key={i}
              title={entry + ' 삭제'}
              aria-label={entry + ' 삭제'}
              onClick={event => {
                const chips = event.currentTarget.parentElement;
                change(stored.filter((_, n) => n !== i));
                requestAnimationFrame(() => {
                  const remaining = chips?.querySelectorAll('button');
                  (remaining?.[i] ?? remaining?.[i-1] ?? input.current)?.focus();
                });
              }}
            >
              {entry}
              <Icon name="close" size={12} />
            </button>
          ))}
        </div>
        <div className="ws-chip-add">
          <input
            ref={input}
            aria-label={field.label + ' 새 항목'}
            placeholder="항목 이름"
            value={item}
            onChange={(ev) => setItem(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) {
                ev.preventDefault();
                add();
              }
            }}
          />
          <button className="ws-btn" onClick={add} disabled={!item.trim() || stored.includes(item.trim())}>
            추가
          </button>
        </div>
        {stored.includes(item.trim()) && item.trim() && <small role="status">같은 이름의 항목이 있습니다.</small>}
      </fieldset>
    );
  }
  if (field.type === 'boolean')
    return (
      <label className="ws-check" data-field-key={field.key}>
        <input type="checkbox" checked={Boolean(stored)} onChange={(e) => change(e.target.checked)} />
        {label}
      </label>
    );
  if (field.type === 'textarea') {
    return <div className="ws-field" data-field-key={field.key}>
      <PromptTextarea id={fieldId} label={label} expandLabel={field.label} value={String(stored ?? '')}
        aria-required={field.required || undefined} onChange={event => change(event.target.value)} />
    </div>;
  }
  return (
    <label className="ws-field" data-field-key={field.key}>
      {label}
      {field.type === 'json' ? (
        <>
          <textarea
            className="ws-code-input"
            spellCheck={false}
            value={raw}
            aria-invalid={!!error}
            aria-required={field.required || undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => {
              const text = e.target.value;
              setRaw(text);
              try {
                const parsed = JSON.parse(text);
                lastApplied.current = JSON.stringify(parsed, null, 2);
                setError('');
                change(parsed);
              } catch {
                setError('JSON 형식을 확인하세요. 마지막 유효한 값이 저장됩니다.');
              }
            }}
          />
          {error && (
            <small id={errorId} role="alert" className="ws-danger">
              {error}
            </small>
          )}
        </>
      ) : field.type === 'select' ? (
        <select value={String(stored ?? '')} aria-required={field.required || undefined} onChange={(e) => change(e.target.value)}>
          {allowEmptyChoice && !field.required && <option value="">선택</option>}
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'number' ? 'number' : 'text'}
          aria-required={field.required || undefined}
          min={field.min}
          max={field.max}
          value={String(stored ?? '')}
          onChange={(e) =>
            change(
              field.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value,
            )
          }
        />
      )}
    </label>
  );
}
function ReplyDeadlineField({node, change}: {node: Block; change: (minutes: number) => void}) {
  const minutes = replyDeadlineMinutes(node);
  const enabled = node.type === 'control.wait' || minutes !== 0;
  const [invalidText, setInvalidText] = useState<string | null>(null);
  const fieldId = useId();
  useEffect(() => setInvalidText(null), [minutes, node.type]);
  const isValid = (value: number) => Number.isInteger(value) && value >= 1 && value <= replyDeadlineMaxMinutes;
  const invalid = invalidText !== null || !isValid(minutes);

  return <>
    <label className="ws-check">
      <input type="checkbox" checked={enabled} onChange={event => {
        setInvalidText(null);
        change(event.target.checked ? replyDeadlineDefaultMinutes : 0);
      }} />
      회신 기한 사용
    </label>
    {enabled && <div className="ws-field" data-field-key={node.type === 'control.wait' ? 'timeoutMinutes' : 'replyTimeoutMinutes'}>
      <label htmlFor={fieldId}>회신 기한(분)</label>
      <input id={fieldId} type="number" min={1} max={replyDeadlineMaxMinutes} step={1}
          value={invalidText ?? String(minutes)} aria-invalid={invalid} aria-describedby={invalid ? fieldId+'-error' : undefined}
          onChange={event => {
            const value = event.target.valueAsNumber;
            if (!isValid(value)) {
              setInvalidText(event.target.value);
              return;
            }
            setInvalidText(null);
            change(value);
          }} />
      {invalid && <small className="ws-danger" id={fieldId+'-error'} role="alert">
        1~10,080분 사이의 정수를 입력하세요.{invalidText !== null && isValid(minutes) && ` 현재 적용된 기한은 ${minutes}분입니다.`}
      </small>}
    </div>}
  </>;
}

function BlockPosition({node,move}:{node:Block;move:(point:Pick<Block,'x'|'y'>)=>void}) {
  const x=useRef<HTMLInputElement>(null),y=useRef<HTMLInputElement>(null);
  const directions = [['왼쪽','←',-8,0],['위','↑',0,-8],['아래','↓',0,8],['오른쪽','→',8,0]] as const;
  return <details className="ws-detail"><summary>위치 조정</summary>
    <form className="ws-block-position" onSubmit={event=>{
      event.preventDefault();
      const nextX=x.current!.valueAsNumber,nextY=y.current!.valueAsNumber;
      if(!Number.isFinite(nextX)||!Number.isFinite(nextY)||(nextX===node.x&&nextY===node.y))return;
      event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
      move({x:nextX,y:nextY});
    }}>
      <label className="ws-field">가로 위치 (X)<input key={node.x} ref={x} type="number" required step="any" defaultValue={node.x} /></label>
      <label className="ws-field">세로 위치 (Y)<input key={node.y} ref={y} type="number" required step="any" defaultValue={node.y} /></label>
      <button type="submit" className="ws-btn">위치 적용</button>
    </form>
    <div className="ws-block-nudge" role="group" aria-label="블록을 8px씩 이동">
      {directions.map(([name,arrow,dx,dy])=><button type="button" className="ws-btn" key={name}
        title={name+' 방향으로 8px 이동'} aria-label={name+' 방향으로 8px 이동'} onClick={()=>move({x:node.x+dx,y:node.y+dy})}>{arrow}</button>)}
    </div>
  </details>;
}

interface InspectorProps {
  graph: Graph;
  rootScope: boolean;
  sourceDraftText?: string;
  onSaveReference?: SaveReferenceDocument;
  sourceRecoveries: RecoveryDraft[];
  onRecoverSource: (text: string) => void;
  onSourceEdit: (text: string) => void;
  showExpertTools: boolean;
  inheritedConnectors?:McpPin[];
  agentContext?:AgentContext;
  inheritedTools?:string[];
  selection: Selection;
  assets: AssetOption[];
  materialLesson?: 'beginner' | 'peer-review' | 'dynamic';
  onRefreshAssets: () => Promise<void>;
  onChange: (graph: Graph) => void;
  onSelect: (selection: Selection) => void;
  onOpen: (id: string) => void;
  onCopy: () => void;
  onDelete: () => void;
  onConnect: (from: string, to?: string) => void;
  onEditConnection: (from:string, to:string, edit:PairEdit) => void;
  onIncoming: (to: string, input: string) => void;
  onAttach: (id: string, asset: AssetOption, replaceSource?: boolean) => Promise<void>;
}
export function Inspector(props: InspectorProps) {
  const linksHeadingId = useId();
  const {
    graph,
    selection,
    assets,
    onChange,
    onSelect,
    onOpen,
    onCopy,
    onDelete,
    onConnect,
    onIncoming,
    onAttach,
  } = props;
  const node = selection?.kind === 'node' ? graph.nodes.find((n) => n.id === selection.id) : undefined;
  const groups = groupEdges(graph),
    edge = selection?.kind === 'edge' ? groups.find((g) => g.id === selection.id) : undefined;
  const titleOf = (id: string) => titleById(graph, id);
  const spec = node ? specFor(node.type) : undefined;
  const replyForm = node?.type === 'input.form' || node?.type === 'control.wait';
  const isTerminal = spec?.menuType === 'output.answer';
  const fields = replyForm
    ? specFor('input.form')!.fields.filter(field => field.key !== 'replyTimeoutMinutes')
    : (spec?.fields ?? []).filter(field => !isTerminal || field.key !== 'status');
  const menu = spec ? palette.find((p) => p.type === spec.menuType) : undefined;
  const modes = menu?.modes?.filter(mode => mode.value !== 'error.compensate' || props.showExpertTools || node?.type === mode.value);
  const update = (partial: Partial<Block>) => {
    if (node)
      onChange({
        ...graph,
        nodes: graph.nodes.map((n) => (n.id === node.id ? { ...n, ...partial } : n)),
      });
  };
  const setField = (key: string, val: unknown) => {
    if (node) update({ config: { ...node.config, [key]: val } });
  };
  const showField = (f: Field) => {
    if (!node) return null;
    if (node.type === 'ai.classify' && f.key === 'categories' && Array.isArray(node.config.categories) &&
        node.config.categories.every((entry: unknown) => typeof entry === 'string')) {
      return <CategoryEditor key={node.id} graph={graph} node={node} names={node.config.categories} onChange={onChange}/>;
    }
    const errorStrategy = node.type === 'error.handle' && f.key === 'strategy';
    let value = node.config[f.key];
    if(node.type==='output.answer'&&f.key==='format')value=answerFormat(value);
    if (errorStrategy) value = canonicalErrorStrategy(value || 'continue');
    if (node.type === 'control.wait' && f.key === 'fields') value = undefined;
    return (
      <ConfigField
        key={node.id + '-' + (f.key === 'tasks' ? 'candidates' : f.key)}
        field={f.key === 'storeKey' && changesKnowledgeRelease(node) ? { ...f, required: true } : f}
        value={value}
        allowEmptyChoice={!errorStrategy}
        change={(v) => {
          if (node.type === 'control.wait' && f.key === 'fields') update(editReplySettings(node, {fields:v}));
          else setField(f.key, v);
        }}
      />
    );
  };
  const canOpen =
    node &&
    ([
      'agent.team',
      'agent.delegate',
      'agent.handoff',
      'workflow.call',
      'workflow.tool',
      'agent.create_dynamic',
      'control.loop',
    ].includes(node.type) ||
      node.graph);
  const attachable=node?portsFor(node).inputs.filter(p=>p.kind==='reference').map(p=>p.id):[];
  const canPickTool=node&&['agent.task','tool.invoke','error.compensate','approval.action'].includes(node.type);
  const connectors=node&&canPickTool?nodeMcpScope(graph,node.id,props.inheritedConnectors):undefined;
  const isRef =
    node &&
    [
      'resource.context',
      'instruction.skill',
      'connection.mcp',
    ].includes(node.type);
  const assetFilter =
    node?.type === 'instruction.skill' ? 'skill' : node?.type === 'connection.mcp' ? 'mcp' : 'document';
  const inlineDocument = node?.type === 'resource.context' && !node.config.assetId;
  const passageInput = node?.type === 'quality.evidence'
    ? graph.edges.find(e => e.to === node.id && e.kind === 'data' && e.input === 'input') : undefined;
  const suggestSearch = node?.type === 'quality.evidence' && (!passageInput || evidenceNeedsSearch(
    graph.nodes.find(n => n.id === passageInput.from),
    graph.edges.some(e => e.to === node.id && e.kind === 'reference' && e.input === 'context'), props.rootScope));
  const filteredAssets = assets.filter((a) =>
    assetFilter === 'document' ? !['skill', 'mcp'].includes(a.kind) : a.kind === assetFilter,
  );
  const selectedAsset=filteredAssets.find(a=>a.id===node?.config.assetId);
  const accessibleVersions=selectedAsset ? accessibleEditions(selectedAsset) : [];
  const nameField = node && (
    <label className="ws-field">
      <span>이름</span>
      <input value={node.title} onChange={e => update({ title: e.target.value })} />
    </label>
  );
  const modeField = node && modes && modes.length > 1 && (
    <label className="ws-field">
      <span>작업 방식</span>
      <select value={node.type} onChange={e => update(changeBlockMode(node, e.target.value))}>
        {modes.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
      </select>
    </label>
  );
  const aiTask = node?.type === 'agent.task' || node?.type === 'ai.single_task';
  const taskPrompts = aiTask ? fields.filter(field => field.type === 'textarea' && !field.advanced) : [];
  const assetPicker = isRef && (
    <AssetPicker
      key={node.id}
      assets={filteredAssets}
      value={String(node.config.assetId ?? '')}
      label="연결할 자료"
      lesson={props.materialLesson === 'beginner' && node.id === 'rules' ? 'beginner' :
        node.config.assetId && !selectedAsset && (
          (props.materialLesson === 'peer-review' && assetFilter === 'skill') ||
          (props.materialLesson === 'dynamic' && assetFilter === 'document')
        ) ? props.materialLesson : undefined}
      refresh={props.onRefreshAssets}
      onChange={a => onAttach(node.id, a, true)}
    />
  );
  return (
    <>
      <div className="ws-panel-heading">
        <h2>{edge ? '연결 속성' : '블록 속성'}</h2>
        <div className="ws-inline">
          {node && (
            <button className="ws-icon-button" aria-label="블록 복제" onClick={onCopy}>
              <Icon name="copy" />
            </button>
          )}
          {(node || edge) && (
            <button
              className="ws-icon-button ws-danger"
              aria-label={node ? '블록 삭제' : '연결선 삭제'}
              onClick={onDelete}
            >
              <Icon name="trash" />
            </button>
          )}
        </div>
      </div>
      {!node && !edge && <p className="ws-hint">캔버스에서 블록이나 연결선을 선택하세요.</p>}
      {edge && <ConnectionInspector group={edge} graph={graph} incoming={groups.filter(link => link.to === edge.to)}
        onChange={onChange} onEdit={edit => props.onEditConnection(edge.from, edge.to, edit)} onDeleteGroup={onDelete}/>}
      <InlineSourceEditor node={node} draftText={props.sourceDraftText} onEdit={props.onSourceEdit}
        onSaveReference={props.onSaveReference}
        recoveries={props.sourceRecoveries} onRecover={props.onRecoverSource}
        onApply={text => setField('content', text)} />
      {node && (
        <>
          {!inlineDocument && <>
            <p className="ws-hint">
              {spec?.description || '이전 형식의 블록입니다. 대체할 블록을 추가한 뒤 연결을 수정하세요.'}
            </p>
            {aiTask ? <div className="ws-task-fields">{nameField}{modeField}</div> : nameField}
          </>}
          {isTerminal && (
            <label className="ws-field">
              <span>종료 방식</span>
              <select value={terminalBehavior(node)}
                onChange={event => update(changeTerminalBehavior(node, event.target.value as TerminalBehavior))}>
                {terminalBehaviorOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
          {!aiTask && modeField}
          {taskPrompts.map(showField)}
          {!inlineDocument && assetPicker}
          {suggestSearch && <div className="ws-missing">
            <small>근거를 확인하려면 검색된 구절이 필요합니다. 자료 검색에서 질문과 원문을 연결하세요.</small>
            <button className="ws-btn" onClick={() => {
              const result = insertEvidenceSearch(graph, node);
              onChange(result.graph);
              onSelect({ kind:'node', id:result.search.id });
            }}><Icon name="plus" size={14}/>자료 검색 추가</button>
          </div>}
          {isRef && node.config.assetId && (
            <label className="ws-field">
              <span>고정할 자료 버전</span>
              <select
                value={String(node.config.version ?? '')}
                onChange={(e) => setField('version', e.target.value)}
              >{!accessibleVersions.includes(Number(node.config.version))&&<option value={String(node.config.version??'')}>현재 설정 · {node.config.version||'미지정'}</option>}
                {accessibleVersions.map(version=><option key={version} value={version}>{version}판</option>)}
              </select>
            </label>
          )}
          {spec &&
            portsFor(node)
              .inputs.filter(
                (p) =>
                  p.required &&
                  !graph.edges.some((e) => e.kind === p.kind && e.to === node.id && e.input === p.id),
              )
              .map((p) => (
                <div className="ws-missing" key={p.kind + p.id}>
                  <small>{p.label}에 전달할 값이 필요합니다.</small>
                  <button className="ws-btn" data-receive-input={p.id} onClick={() => onIncoming(node.id, p.id)}>
                    <Icon name="link" size={14} />
                    {p.label} 받기
                  </button>
                </div>
              ))}
          {['workflow.call','workflow.tool'].includes(node.type)&&<WorkflowRefPicker id={String(node.config.workflowId||'')} version={String(node.config.version||'')} change={(workflowId,version)=>update({config:{...node.config,workflowId,version,workflowGrant:undefined}})}/>}
          {node.type==='agent.task'&&Array.isArray(node.config.requiredTools)&&node.config.requiredTools
            .filter((tool:string)=>!node.config.allowedTools?.includes(tool)).map((tool:string)=>
              <div key={tool} className="ws-missing"><small>도구 연결 필요 · {tool}</small>
                <button className="ws-btn" onClick={()=>setField('requiredTools',node.config.requiredTools.filter((name:string)=>name!==tool))}>이 제안 제외</button>
              </div>)}
          {!!connectors?.length&&canPickTool&&<McpToolPicker pins={connectors} ceiling={props.inheritedTools} allowMultiple={node.type==='agent.task'}
            chosen={node.type==='agent.task'?(Array.isArray(node.config.allowedTools)?node.config.allowedTools:[]):[String(node.config.tool??'')]}
            onChoose={tool=>{if(node.type==='agent.task')setField('allowedTools',Array.from(new Set([...(Array.isArray(node.config.allowedTools)?node.config.allowedTools:[]),tool])));
              else setField('tool',tool);}}/>}
          {fields
            .filter(
              (f) =>
                !f.advanced &&
                !taskPrompts.includes(f) &&
                !(isRef && ['assetId', 'version'].includes(f.key)) &&
                !(node.type === 'resource.context' && f.key === 'content') &&
                !(['workflow.call','workflow.tool'].includes(node.type)&&['workflowId','version'].includes(f.key)) &&
                !(
                  node.type === 'control.trigger' &&
                  ['schedule', 'event'].includes(f.key) &&
                  node.config.trigger !== f.key
                ),
            )
            .map(showField)}
          <AgentContextFields node={node} graph={graph} parent={props.agentContext??emptyAgentContext}
            onSelect={ids=>setField('inheritedSkillIds',ids)} />
          {replyForm && <ReplyDeadlineField key={node.id} node={node}
            change={minutes => update(editReplySettings(node,{replyTimeoutMinutes:minutes}))} />}
          {inlineDocument && <details className="ws-detail">
            <summary>이름·자료판 설정</summary>
            {nameField}
            {assetPicker}
          </details>}
          {canOpen && !(['workflow.call','workflow.tool'].includes(node.type)&&node.config.workflowId) && (
            <button className="ws-btn ws-full" onClick={() => onOpen(node.id)}>
              <Icon name="workflow" />
              {node.type === 'agent.team' ? '팀 열기' : '내부 Workflow 열기'}
            </button>
          )}
          {node.type !== 'quality.evidence' && attachable.some(id=>['context','skill','mcp'].includes(id)) && (
            <details className="ws-detail">
              <summary>도구 및 자료</summary>
              {(['skill', 'mcp', 'document'] as const).filter(kind=>attachable.includes(kind==='document'?'context':kind)).map((kind) => (
                <AssetPicker
                  key={node.id + kind}
                  refresh={props.onRefreshAssets}
                  lesson={props.materialLesson === 'peer-review' && node.id === 'team' && kind === 'skill' ? 'peer-review' :
                    props.materialLesson === 'dynamic' && node.id === 'spawn' && kind === 'document' ? 'dynamic' : undefined}
                  label={
                    kind === 'document' ? '참고 자료' : kind === 'skill' ? (node.type==='agent.team'?'팀에 연결할 Skill':'사용할 Skill') : '허용할 MCP'
                  }
                  assets={assets.filter((a) =>
                    kind === 'document' ? !['skill', 'mcp'].includes(a.kind) : a.kind === kind,
                  )}
                  value=""
                  onChange={(a) => onAttach(node.id, a)}
                />
              ))}
            </details>
          )}
          <details className="ws-detail ws-advanced-settings">
            <summary>고급 설정</summary>
            {fields.filter((f) => f.advanced).map(showField)}
            {props.materialLesson === 'dynamic' && node.id === 'spawn' && node.type === 'agent.create_dynamic' &&
              <small role="status">{dynamicLessonRangeNote(Number(node.config.maxCreatedAgents), Number(node.config.maxInFlightAgents))}</small>}
            <BlockPosition key={node.id} node={node} move={update}/>
          </details>
          <section className="ws-node-links" aria-labelledby={linksHeadingId}>
            <h3 id={linksHeadingId}>연결</h3>
            {groups
              .filter((g) => g.from === node.id || g.to === node.id)
              .map((g) => (
                <button key={g.id} onClick={() => onSelect({ kind: 'edge', id: g.id })}>
                  {titleOf(g.from)} → {titleOf(g.to)}
                </button>
              ))}
            <button className="ws-btn" onClick={() => onConnect(node.id)}>
              <Icon name="link" />
              연결 추가
            </button>
            {spec && (
              <details className="ws-detail">
                <summary>연결 가능한 항목 보기</summary>
                {(['inputs', 'outputs'] as const).map(side => (
                  <div key={side}>
                    <h4>{side === 'inputs' ? '받는 항목' : '보내는 항목'}</h4>
                    {portsFor(node)[side].filter(p => node.type !== 'quality.evidence' || p.id !== 'context').map(p => (
                      <div className="ws-port-row" key={p.kind + p.id}>
                        <span>{p.label}</span>
                        <small>{connectionKindLabels[p.kind]} · {p.valueType}</small>
                      </div>
                    ))}
                  </div>
                ))}
              </details>
            )}
          </section>
        </>
      )}
    </>
  );
}
const inputExamples = new Map([
  ['입력값', '글을 요약할 때는 원문을 여기에 연결하세요.'],
  ['원래 질문', '검색 후에도 처음 질문을 참고하려면 사용자 입력 블록의 결과를 연결하세요.'],
]);

export function ConnectionModal({
  graph,
  from,
  to,
  input,
  routeId,
  transfersOnly = false,
  onCommit,
  onAddSource,
  onClose,
}: {
  graph: Graph;
  from?: string;
  to?: string;
  input?: string;
  routeId?: string;
  transfersOnly?: boolean;
  onCommit: (edges: Edge[]) => void;
  onAddSource: (target: Block, input: string, type: string) => void;
  onClose: () => void;
}) {
  const [origin, setOrigin] = useState(from ?? ''),
    [target, setTarget] = useState(to ?? ''),
    [choices, setChoices] = useState<Record<string, boolean>>({});
  const optionsId = useId();
  const filter = (source: string, dest: string) =>
    connectionOptions(graph, source, dest, routeId).filter(
      (o) => (!transfersOnly || o.kind !== 'flow') && (!input || o.input === input || o.kind === 'flow'),
    );
  const options = origin && target ? filter(origin, target) : [];
  const key = (x: { kind: string; out: string; input: string }) =>
    JSON.stringify([x.kind, x.out, x.input]);
  const singleRouteInput = routeId !== undefined && options.filter(o => o.kind === 'flow').length === 1;
  const isPicked = (option: (typeof options)[number]) =>
    (singleRouteInput && option.kind === 'flow') || (choices[key(option)] ?? (!transfersOnly && option.automatic));
  const picked = options.filter(isPicked);
  const candidates = origin
    ? graph.nodes.filter((n) => n.id !== origin && filter(origin, n.id).length)
    : [];
  const sources = target
    ? graph.nodes.filter((n) => filter(n.id, target).some((o) => !input || o.input === input))
    : [];
  const source = graph.nodes.find((n) => n.id === origin);
  const routeLabel = routeId && source && portsFor(source).outputs.find(p => p.kind === 'flow' && p.id === routeId)?.label;
  const targetNode = graph.nodes.find((n) => n.id === target);
  const targetInputs = targetNode ? portsFor(targetNode).inputs : [];
  const missingSource = !from && !!input && !!targetNode && !sources.length;
  const inputPort = targetInputs.find(port => port.id === input);
  const suggestedType = inputPort?.valueType === 'passages' ? 'knowledge.search'
    : targetNode?.type === 'document.read' ? 'file.input' : 'input.user_request';
  const replacing = targetNode
    ? graph.edges.filter(
        (e) =>
          e.to === target &&
          picked.some(
            (o) =>
              o.kind === e.kind &&
              o.input === e.input &&
              !targetInputs.find((p) => p.kind === o.kind && p.id === o.input)?.multiple,
          ),
      )
    : [];
  return (
    <Modal title={transfersOnly ? '전달 항목 추가' : '연결 추가'} size="form" onClose={onClose}>
      {from ? (
        <p className="ws-hint">출발 블록 · {source && titleById(graph, source.id)}{routeLabel && <> · {routeLabel} 경로</>}</p>
      ) : !missingSource && (
        <label className="ws-field">
          <span>값을 보낼 블록</span>
          <select
            value={origin}
            onChange={(e) => {
              setOrigin(e.target.value);
              setChoices({});
            }}
          >
            <option value="">출발 블록 선택</option>
            {sources.map((n) => (
              <option key={n.id} value={n.id}>
                {titleById(graph, n.id)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="ws-field">
        <span>도착 블록</span>
        <select
          disabled={transfersOnly || (!from && !!to)}
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setChoices({});
          }}
        >
          <option value="">연결할 블록 선택</option>
          {target && !candidates.some((n) => n.id === target) && (
            <option value={target}>{titleById(graph, target)}</option>
          )}
          {candidates.map((n) => (
            <option key={n.id} value={n.id}>
              {titleById(graph, n.id)}
            </option>
          ))}
        </select>
      </label>
      {missingSource && <div className="ws-missing">
        <p>{inputPort?.label ?? '입력값'}을 보낼 블록이 없습니다.</p>
        <button type="button" className="ws-btn" onClick={() => onAddSource(targetNode, input, suggestedType)}>
          <Icon name="plus" size={14}/>{specFor(suggestedType)?.name} 추가 및 연결
        </button>
      </div>}
      {target &&
        (['flow', 'data', 'reference'] as const).map((kind) => {
          const available = options.filter((o) => o.kind === kind);
          return (
            available.length > 0 && (
              <fieldset key={kind} className="ws-fieldset">
                <legend>{connectionKindLabels[kind]}</legend>
                {available.map((o, index) => {
                  const port = targetInputs.find(p => p.kind === kind && p.id === o.input);
                  const example = port?.kind === 'data' ? inputExamples.get(port.label) : undefined;
                  const labelId = `${optionsId}-${kind}-${index}`;
                  return <label className="ws-check ws-connection-choice" key={key(o)}>
                    <input
                      type="checkbox"
                      aria-labelledby={labelId}
                      aria-describedby={example ? labelId + '-example' : undefined}
                      checked={isPicked(o)}
                      disabled={singleRouteInput && o.kind === 'flow'}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setChoices((old) => {
                          const next = { ...old };
                          if (checked && o.kind !== 'flow' && !port?.multiple)
                            for (const other of available)
                              if (other.input === o.input) next[key(other)] = false;
                          next[key(o)] = checked;
                          return next;
                        });
                      }}
                    />
                    <span>
                      <span id={labelId}>{o.label}</span>
                      {example && <small id={labelId + '-example'}>{example}</small>}
                    </span>
                  </label>;
                })}
              </fieldset>
            )
          );
        })}
      {target && origin && !options.length && <p className="ws-hint">
        {routeId && targetNode?.type === 'error.handle'
          ? '오류 처리는 출발 블록의 실행이 실패할 때 시작됩니다. 오류 연결은 블록 속성의 ‘연결 추가’에서 설정하세요.'
          : transfersOnly ? '이 두 블록 사이에 추가로 전달할 값이나 참조가 없습니다.' : '추가할 수 있는 연결이 없습니다.'}
      </p>}
      {!candidates.length && !target && <p className="ws-hint">먼저 호환되는 블록을 추가하세요.</p>}
      {replacing.length > 0 && (
        <p className="ws-hint">
          기존에 연결한 값을 교체합니다.{' '}
          {replacing
            .map(
              (e) =>
                titleById(graph, e.from) +
                ' · ' +
                edgeLabel(graph, e),
            )
            .join(', ')}
        </p>
      )}
      <div className="ws-modal-actions">
        <button className="ws-btn" onClick={onClose}>
          취소
        </button>
        {!missingSource && <button
          className="ws-btn ws-primary"
          disabled={!picked.length || (!!input && !picked.some((p) => p.input === input)) ||
            (routeId !== undefined && !picked.some(p => p.kind === 'flow' && p.out === routeId))}
          onClick={() => onCommit(connectBlocks(graph, origin, target, picked))}
        >
          연결 적용
        </button>}
      </div>
    </Modal>
  );
}
