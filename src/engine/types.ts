import type { Block, Graph } from '../domain/types';
import type { IndexedPassage } from './values';
import type { McpPin } from '../domain/mcp-scope';
import type { ReplyField } from '../domain/reply-form';
export type Values = Record<string, unknown>;
export type History = { role: 'user' | 'assistant'; content: string }[];
export interface ToolDefinition {description:string;parameters?:Record<string,unknown>}
export interface ModelInput {
  instruction: string;
  input: string;
  context: string;
  tools: string[];
  toolDefinitions?:Record<string,ToolDefinition>;
  history?: History;
}
export interface ModelOutput { text: string; tool?: { name: string; args: Values } }
export interface Source { id: string; title: string; version: string; content: string; assetId?:string; location?:string }
export interface Passage { id: string; title: string; version: string; location: string; quote: string; assetId?:string; indexVersion?:string }
export interface OriginalRow extends Passage { supplied?:true }
export interface KnowledgeSnapshot { documents:Source[]; version:string; index:IndexedPassage[] }
export interface KnowledgeCollection {
  read():Promise<KnowledgeSnapshot & {originalDocuments?:Source[]}>;
  stage(key:string,value?:string):Promise<string|undefined>;
  release(operation:'publish'|'withdraw',approvedDigest:string,operationId:string):Promise<void>;
}
export interface EngineServices {
  model(request: ModelInput): Promise<ModelOutput>;
  scopeModel?(request: ModelInput): Promise<ModelOutput>;
  tool(name: string, args: Values, action: { operationId: string; approved: boolean; connector?:McpPin }): Promise<unknown>;
  /** Returns the resource from the exact pinned version after checking current access. */
  asset?(id: string, version?: string): Promise<Source>;
  workflow?(id:string, version:string):Promise<Graph>;
  memory?(key: string, value?: string): Promise<string | undefined>;
  knowledge?(node:Block):KnowledgeCollection;
  sourceIndex?(documents:Source[]):IndexedPassage[];
  isStopped?(): boolean | Promise<boolean>;
  save?(checkpoint: EngineCheckpoint): Promise<void>;
  /** Optional capability ceiling inherited by each descendant. */
  allowedTools?: string[];
  isReadOnlyTool?(name: string, connector?:McpPin): boolean;
  toolDefinition?(name:string,connector?:McpPin):Promise<ToolDefinition|undefined>;
  limits?: { modelCalls?: number; toolCalls?: number; steps?: number; agents?: number; concurrency?: number; depth?: number };
}
export interface EngineEvent {
  id: number; time: string; nodeId: string; blockType?: string; path: string; title: string;
  kind: 'start' | 'result' | 'error' | 'wait' | 'tool' | 'role' | 'lookup' | 'stop';
  detail: string; data?: unknown;
}
export interface Prompt {
  id: string; kind: 'question' | 'approval' | 'selection' | 'review' | 'event' | 'file';
  questionFileName?: string;
  filePurpose?: 'evidenceOriginal';
  fileAccept?: string[];
  fields?: ReplyField[]; fieldError?:string;
  reviewDraft?:string|null;
  showApprovalNote?:boolean;
  selectionPolicy?: { simultaneous: number; stopOnIncomplete: boolean };
  prompt: string; options?: string[]; selectionCount?: number; expiresAt?:string; operation?: { tool: string; args: Values; connector?:McpPin };
}
export interface Step {
  /** Original rows independently read by the engine, outside the user-controlled value. */
  originalRows?:OriginalRow[];
  evidence?:Passage[];
  evidenceStatus?:'verified'|'candidate_match'|'insufficient'|'conflicting';
  attachmentInput?:boolean;
  fileOrigins?: {keys:string[]; path:string}[];
  state: 'done' | 'failed' | 'skipped'; values: Values; routes: string[]; error?: string; responsible?:string;
}
export interface EngineCheckpoint {
  /** References the inspected input in existing step start events. */
  privacyChecks?: {event:number; categories:string[]; block:boolean}[];
  privacyVersion?:2;
  fileOriginVersion?:1;
  finalFilePaths?:string[];
  finalFileOverrides?:Record<string,{fileName:string;content:string}>;
  outputFormat?:'text'|'json'|'markdown';
  historyDetails?:Record<string,unknown>;
  version: 1; runId: string; input: string; events: EngineEvent[];
  scopeDecision?: {status:'in_scope'|'out_of_scope'} | {status:'mixed'; input:string};
  steps: Record<string, Step>; memo: Record<string, unknown>; waits: Record<string, Prompt>;
  replies: Record<string, {value:string;approved?:boolean}>;
  counts: { steps: number; modelCalls: number; toolCalls: number; agents:number };
}
export interface EngineRequest {
  runId: string; input: string; checkpoint?: EngineCheckpoint; history?: History;
  /** Includes prior turns and any decisions already recorded in this run. */
  restoredPrivacy?: import('./model-privacy').ModelPrivacy;
  retryScopeDecision?: EngineCheckpoint['scopeDecision'];
  reply?: { value: string; approved?: boolean; waitId?: string; receivedAt?: number };
  replies?:NonNullable<EngineRequest['reply']>[];
  trigger?:{kind:'manual'|'schedule'|'event'; nodeId?:string; name?:string; scheduledAt?:string};
}
export interface EngineResult {
  status: 'completed'|'waiting'|'failed'|'stopped'; output: string; events: EngineEvent[];
  checkpoint: EngineCheckpoint; wait?: Prompt; error?: string;
}
