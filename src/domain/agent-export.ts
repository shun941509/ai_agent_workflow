import type {Graph} from './types';

export interface ExportResource {
  key: string;
  name: string;
  kind: 'document' | 'skill' | 'knowledge' | 'mcp' | 'workflow';
  version: string;
  steps: string[];
  available: boolean;
  mcpMode?: 'remote' | 'manual';
  mcpUrl?: string;
}

export interface ExportMcp {
  id: string;
  tools: string[];
  url?: string;
  tokenEnv?: string;
}

export interface ExportPackage {
  title: string;
  graph: Graph;
  resources: (ExportResource & {included: boolean; files: string[]; mcp?: ExportMcp})[];
  files: {path: string; data: string}[];
}
