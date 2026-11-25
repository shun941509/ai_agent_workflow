import { Drawing } from './template-drawing';
import type { Graph } from './types';

export type WorkDocumentId = 'meeting-report' | 'manufacturing-report';
export type WorkPurpose = 'sw-requirements' | WorkDocumentId;
export type WorkDocument = {
  id: WorkDocumentId;
  title: string;
  inputLabel: string;
  sample: string;
  prompt: string;
  output: {columns: string[]; rows: string[][]; summary: string};
  material: { kind: 'skill' | 'document'; name: string; content: string };
};

export const workDocuments: WorkDocument[] = [
  {
    id: 'meeting-report',
    title: '회의록·업무 보고',
    inputLabel: '회의 메모',
    sample: [
      '시범 운영용 안내문 12부를 인쇄하기로 했다. 민지가 맡는다.',
      '신규 참석자에게 안내 메일을 보내기로 했다. 담당자와 발송일은 아직 미정이다.',
      '안내문을 20부 더 인쇄하자는 의견이 있었다. 다음 회의에서 결정한다.',
    ].join('\n'),
    prompt: '회의 메모에서 확정한 업무를 업무·담당·기한 표로 정리해 주세요. 회의록 작성 Skill에 따라 미결 제안을 따로 적고, 이번 결정과 다음 회의 안건을 두 문장으로 요약해 주세요.',
    output: {
      columns: ['확정 업무', '담당', '기한'],
      rows: [['안내문 12부 인쇄', '민지', '미정'], ['신규 참석자 안내 메일 발송', '미정', '미정']],
      summary: '안내문 12부 인쇄와 안내 메일 발송을 결정했습니다. 안내문 20부 추가 인쇄는 다음 회의에서 결정합니다.',
    },
    material: {
      kind: 'skill', name: '회의록 작성 Skill',
      content: '# 회의록 작성\n확정된 업무마다 업무, 담당, 기한을 표에 적는다. 원문에 없는 담당자나 기한은 ‘미정’으로 표시한다. 제안은 표 아래 다음 회의 안건에 적는다. 결정 사항과 다음 안건을 두 문장으로 요약한다.',
    },
  },
  {
    id: 'manufacturing-report',
    title: '반도체·제조 보고',
    inputLabel: '웨이퍼 정렬 오차 CSV',
    sample: 'lot,wafer,offset_nm\nL7,W01,-4\nL7,W02,5\nL7,W03,-7\nL8,W01,6\nL9,W01,-2\nL9,W02,1',
    prompt: '웨이퍼 정렬 오차 CSV에 연결된 기준표의 허용 범위를 적용해 주세요. 적용한 범위와 단위, 전체 측정 건수, 초과 건수와 중복을 뺀 해당 LOT 수를 적고, LOT·웨이퍼·부호가 있는 측정값을 표로 보여 주세요.',
    output: {
      columns: ['LOT', '웨이퍼', '정렬 오차'],
      rows: [['L7', 'W02', '+5 nm'], ['L7', 'W03', '−7 nm'], ['L8', 'W01', '+6 nm']],
      summary: '6건 중 3건이 ±4 nm 범위를 벗어났습니다. 해당 LOT는 2개입니다.',
    },
    material: {
      kind: 'document', name: '웨이퍼 정렬 오차 기준표',
      content: '측정 열은 offset_nm이며 단위는 nm이다. 허용 범위는 −4 nm 이상 +4 nm 이하이다. 측정값의 절댓값이 4 nm보다 큰 행만 초과 건수에 포함한다. 해당 LOT 수는 lot 열의 중복을 제거해 집계한다.',
    },
  },
];

export function workDocumentGraph(doc: WorkDocument, instruction = doc.prompt): Graph {
  const drawing = new Drawing(doc.prompt);
  drawing.node('input', 'input.user_request', doc.inputLabel, 0, 0, {question:doc.sample});
  drawing.node('report', 'ai.single_task', doc.title + ' 작성', 1, 0, {
    goal: doc.title + ' 문서를 작성합니다.', instruction,
  });
  drawing.node('output', 'output.answer', '문서 전달', 2, 0);
  const {name, content, kind} = doc.material;
  if (kind === 'skill') {
    drawing.node('rules', 'instruction.skill', name, 1, 1, {content, version:'1'});
    drawing.edge('rules', 'report', 'reference', 'ref', 'skill', name);
  } else {
    drawing.doc('rules', name, content, 1, 1, 'report');
  }
  drawing.step('input', 'report');
  drawing.step('report', 'output');
  return drawing.graph;
}

// The guide supplies the user's input and pins this reference when the draft is created.
export function workDocumentBindings(graph: Graph, doc: WorkDocument) {
  const isSkill = doc.material.kind === 'skill';
  const input = graph.nodes.find(node => node.type === 'input.user_request');
  const sourceType = isSkill ? 'instruction.skill' : 'resource.context';
  const source = graph.nodes.find(node => node.type === sourceType && (node.id === 'rules' || node.title === doc.material.name));
  if (!input || !source) return;
  const agents = new Set(graph.nodes.filter(node => node.type === 'ai.single_task' || node.type === 'agent.task').map(node => node.id));
  const connected = graph.edges.some(edge => edge.from === source.id && agents.has(edge.to) &&
    edge.kind === 'reference' && edge.out === 'ref' && edge.input === (isSkill ? 'skill' : 'context'));
  if (connected) return {input, rules:source};
}
