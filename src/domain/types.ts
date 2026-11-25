export const levels = ['입문', '초급', '중급', '고급', '전문가'] as const;
export type Level = typeof levels[number];
export const groups = {
  input: '시작·입력·종료', agent: 'AI·Agent·협업', resource: '도구·자료·기억',
  file: '파일·문서·RAG', flow: '흐름 제어·재사용', quality: '검토·승인·품질', error: '오류·보상',
} as const;
export type Group = keyof typeof groups;
export type EdgeKind = 'flow' | 'data' | 'reference';
export type FieldValue = string | number | boolean | object | null;
export type Choice = {value: string; label: string};
export type Field = {
  key: string; label: string; type: 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'json';
  required?: boolean; advanced?: boolean; default?: FieldValue; options?: Choice[]; min?: number; max?: number;
};
export type Port = {
  id: string; label: string; kind: EdgeKind; valueType: string; required?: boolean; multiple?: boolean;
};
export type Definition = {
  type: string; name: string; description: string; group: Group; level: Level;
  fields: Field[]; inputs: Port[]; outputs: Port[]; menuType: string; modes?: Choice[];
};
export type Block = {
  id: string; type: string; title: string; x: number; y: number;
  config: Record<string, any>; graph?: Graph;
};
export type Edge = {id: string; from: string; to: string; kind: EdgeKind; out: string; input: string; label?: string};
export type Graph = {nodes: Block[]; edges: Edge[]};
export type Issue = {message: string; nodeId?: string; edgeId?: string; path?: string[]; routeId?: string; fieldKey?: string};
export type Lesson = {
  id: string; title: string; level: Level; description: string; task: string; question: string;
  graph: Graph; goal: string; steps: string[]; checks: string[]; example: string; examples: string[];
  sampleCase?: {title: string; expected: string};
  optionalPractice?: string;
  optionalSteps?: string[];
};
