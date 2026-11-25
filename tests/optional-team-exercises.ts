import assert from 'node:assert/strict';
import { templates, type Graph } from '../src/domain';
import type { EngineEvent, Passage } from '../src/engine/types';
import { attachAssetEdition, type SharedAssetPin } from '../src/ui/editor/asset-attachment';

type Run = {state:string; input:string; output:string; conversation:string; events:EngineEvent[]};
type Exercise = {
  graph: Graph;
  material: SharedAssetPin;
  ask(input: string): Promise<Run>;
  save(graph: Graph): Promise<void>;
};

export function eventData(run: Pick<Run,'events'>, nodeId: string, kind: EngineEvent['kind'] = 'result') {
  const events = run.events.filter(event => event.nodeId === nodeId && event.kind === kind);
  assert.equal(events.length, 1, nodeId+'의 '+kind+' 기록 수');
  const data = events[0].data;
  assert.ok(data && typeof data === 'object' && !Array.isArray(data));
  return data as Record<string, unknown>;
}

const sixOClock = /오후\s*(?:6\s*(?:시|:00)|여섯\s*시)|18\s*(?:시|:00)/;
const fourOClock = /오후\s*4\s*시|16\s*시|16:00|오후\s*4:00/;

function checkReviews(run: Run, input: string, selected: boolean) {
  assert.equal(run.state, 'completed');
  assert.equal(run.input, input);
  const notice = String(eventData(run, 'revise').value);
  assert.match(notice, /토요일/);
  assert.match(notice, fourOClock);
  assert.match(notice, /신분증/);
  assert.doesNotMatch(notice, /교정\s*사유/);
  let expected = notice;
  for (const [reviewer, draft, heading] of [
    ['review-facts', 'clarity', '사실 검토 담당 → 안내문 편집 담당 초안'],
    ['review-clarity', 'facts', '안내문 편집 담당 → 사실 검토 담당 초안'],
  ]) {
    const start = eventData(run, reviewer, 'start');
    const original = String(eventData(run, draft).value);
    assert.deepEqual(start.input, original);
    assert.equal(start.question, input);
    assert.match(original, sixOClock);
    assert.doesNotMatch(original, /교정\s*사유/);
    const feedback = String(eventData(run, reviewer).value);
    assert.match(feedback.replaceAll('평일에는 오전 9시부터 오후 6시까지', ''), sixOClock);
    assert.match(feedback, fourOClock);
    assert.match(feedback, /도서관 원문/);
    assert.match(feedback, /오전 10시부터 오후 4시까지|오후 4시까지 엽니다/);
    const reasons = feedback.split(/\r?\n/).filter(line => /교정\s*사유/.test(line));
    assert.equal(reasons.length, selected && reviewer === 'review-facts' ? 1 : 0, feedback);
    if (reasons.length) assert.match(reasons[0].replace(/[*_]/g,''), /교정\s*사유\s*[:：]\s*\S/);
    expected += '\n\n'+heading+'\n'+feedback;
  }
  assert.equal(run.output, expected);
}

export async function checkOptionalReview(exercise: Exercise) {
  const input = templates.find(lesson => lesson.id === 'peer-review')!.question;
  const before = await exercise.ask(input);
  checkReviews(before, input, false);
  const {graph, source} = attachAssetEdition(structuredClone(exercise.graph), 'team', exercise.material);
  const members = graph.nodes.find(node => node.id === 'team')!.graph!;
  const reviewer = members.nodes.find(node => node.id === 'review-facts')!;
  reviewer.config.inheritedSkillIds = ['block:'+source.id];
  await exercise.save(graph);
  const after = await exercise.ask(input);
  assert.notEqual(after.conversation, before.conversation);
  checkReviews(after, input, true);
  return {before, after};
}

const centralQuote = '중앙도서관은 평일 오전 9시에 엽니다.';
const riverQuote = '강변도서관은 평일 오전 11시에 엽니다.';

type BranchResult = {target:string; status:string; error?:string; result:{passages:Passage[]}};
function branchResults(run: Run) {
  assert.equal(run.state, 'completed');
  const spawn = eventData(run, 'spawn').value as {results:BranchResult[]; excluded:string[]};
  assert.deepEqual(spawn.excluded, []);
  assert.deepEqual(spawn.results.map(row => row.target), ['중앙도서관','강변도서관']);
  return spawn.results;
}

export async function checkOptionalRiver(exercise: Exercise) {
  const input = '중앙도서관, 강변도서관';
  const before = await exercise.ask(input);
  assert.equal(before.input, input);
  const [central, river] = branchResults(before);
  assert.equal(central.status, 'verified');
  assert.ok(central.result.passages.some(p => p.title === '지점별 안내' && centralQuote.includes(p.quote) && p.quote.includes('9시')));
  assert.equal(river.status, 'insufficient');
  assert.equal(river.error, '근거 부족');
  assert.deepEqual(river.result.passages, []);
  const {graph} = attachAssetEdition(exercise.graph, 'spawn', exercise.material);
  await exercise.save(graph);
  const after = await exercise.ask(input);
  assert.equal(after.input, before.input);
  assert.notEqual(after.conversation, before.conversation);
  const [centralAfter, riverAfter] = branchResults(after);
  assert.equal(centralAfter.status, 'verified');
  // The model can select a shorter excerpt on a second run. The source and fact must stay the same.
  assert.ok(centralAfter.result.passages.some(p => central.result.passages.some(first =>
    first.id === p.id && first.location === p.location && first.version === p.version) &&
    centralQuote.includes(p.quote) && p.quote.includes('9시')));
  assert.equal(riverAfter.status, 'verified');
  assert.ok(riverAfter.result.passages.some(p => p.assetId === exercise.material.id &&
    p.title === exercise.material.name && p.version === String(exercise.material.version) &&
    p.location === '1행' && riverQuote.includes(p.quote) && p.quote.includes('11시')));
  return {before, after};
}
