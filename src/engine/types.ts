import type { Block, Graph } from '../domain/types';
import type { IndexedPassage } from './values';
import type { McpPin } from '../domain/mcp-scope';
import type { ReplyField } from '../domain/reply-form';
export type Values = Record<string, unknown>;
export type History = { role: 'user' | 'assistant'; content: string }[];
export interface ModelInput {
  instruction: string;
  input: string;
  context: string;
  tools: string[];
  history?: History;
}
export interface ModelOutput { text: string; tool?: { name: string; args: Values } }
export interface Source { id: string; title: string; version: string; content: string; assetId?:string }
export interface Passage { id: string; title: string; version: string; location: string; quote: string; assetId?:string }
export interface KnowledgeSnapshot { documents:Source[]; version:string; index:IndexedPassage[] }
export interface KnowledgeCollection {
  read():Promise<KnowledgeSnapshot>;
  stage(key:string,value?:string):Promise<string|undefined>;
  release(operation:'publish'|'withdraw',approvedDigest:string,operationId:string):Promise<void>;
}
export interface EngineServices {
  model(request: ModelInput): Promise<ModelOutput>;
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
  limits?: { modelCalls?: number; toolCalls?: number; steps?: number; agents?: number; concurrency?: number; depth?: number };
}
export interface EngineEvent {
  id: number; time: string; nodeId: string; blockType?: string; path: string; title: string;
  kind: 'start' | 'result' | 'error' | 'wait' | 'tool' | 'role' | 'lookup' | 'stop';
  detail: string; data?: unknown;
}
export interface Prompt {
  id: string; kind: 'question' | 'approval' | 'selection' | 'review' | 'event' | 'file';
  fileAccept?: string[];
  fields?: ReplyField[]; fieldError?:string;
  reviewDraft?:string|null;
  showApprovalNote?:boolean;
  selectionPolicy?: { simultaneous: number; stopOnIncomplete: boolean };
  prompt: string; options?: string[]; selectionCount?: number; expiresAt?:string; operation?: { tool: string; args: Values; connector?:McpPin };
}
export interface Step {
  state: 'done' | 'failed' | 'skipped'; values: Values; routes: string[]; error?: string; responsible?:string;
}
export interface EngineCheckpoint {
  version: 1; runId: string; input: string; events: EngineEvent[];
  steps: Record<string, Step>; memo: Record<string, unknown>; waits: Record<string, Prompt>;
  replies: Record<string, {value:string;approved?:boolean}>;
  counts: { steps: number; modelCalls: number; toolCalls: number; agents:number };
}
export interface EngineRequest {
  runId: string; input: string; checkpoint?: EngineCheckpoint; history?: History;
  reply?: { value: string; approved?: boolean; waitId?: string; receivedAt?: number };
  trigger?:{kind:'manual'|'schedule'|'event'; nodeId?:string; name?:string; scheduledAt?:string};
}
export interface EngineResult {
  status: 'completed'|'waiting'|'failed'|'stopped'; output: string; events: EngineEvent[];
  checkpoint: EngineCheckpoint; wait?: Prompt; error?: string;
}
