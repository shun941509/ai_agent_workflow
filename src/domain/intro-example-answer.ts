import { membershipRule, templates } from './templates';
import type { Graph } from './types';

const original = templates.find(lesson => lesson.id === 'intro')!.graph;
const instruction = original.nodes.find(node => node.id === 'agent')!.config.instruction;

/** Evaluate the saved conversation design, even when the editor now shows a later draft. */
export function isIntroExampleAnswer(graph: Graph, output: string): boolean {
  const agent = graph.nodes.find(node => node.id === 'agent' && node.type === 'ai.single_task');
  if (typeof agent?.config.instruction !== 'string' || agent.config.instruction.trim() !== instruction) return false;
  const source = graph.nodes.find(node => node.id === 'rules' && node.type === 'resource.context');
  if (typeof source?.config.content !== 'string' || !source.config.content.includes(membershipRule)) return false;
  const hasExamplePath = original.edges.every(link => graph.edges.some(edge => edge.from === link.from &&
    edge.to === link.to && edge.kind === link.kind && edge.out === link.out && edge.input === link.input));
  if (!hasExamplePath) return false;

  const statements = output.match(/[^.!?。！？\n]+[?？]?/g) ?? [];
  let recommendsId = false;
  for (const statement of statements) {
    const mention = statement.indexOf('신분증');
    if (mention < 0 || /[?？]/.test(statement)) continue;
    const advice = statement.slice(mention).replace(/[\s*_]/g, '');
    const substitute = /^신분증[은이을]?(?:대신|말고|이?아니라|제외)/.test(advice);
    const denied = /불필요|필요[가는]?없|지않|지마(?:세|십)|안가져|없어도|없이|필요한지|확인[이할]?필요/.test(advice);
    const requirement = advice.replace(/^신분증[을은이만의]?(?:(?:지참|준비|소지|제시)(?:여부|하는것)?)?[은는이가]?/, '');
    const optional = /^(?:선택|옵션|있으면좋|필수(?:사항)?[가이는은]?아[니닌닙])/.test(requirement)
      && !/^선택(?:사항)?[이은]?아[니닌닙]/.test(requirement);
    if (substitute || denied || optional) return false;
    const sufficient = /^신분증(?:한장|하나)?(?:만)?(?:있으면|이?면)(?:충분|됩|돼|되)/.test(advice);
    if (sufficient || /지참|가져|가지고|챙|준비|필요|필수|소지|제시/.test(advice)
      || /^신분증(?:한장|하나)?(?:만)?(?:입니다|이에요|이요|이다)?$/.test(advice)) recommendsId = true;
  }
  return recommendsId;
}
