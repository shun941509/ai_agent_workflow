import type {EngineEvent} from '../engine/types';
import {editionIdentifier} from '../domain/reply-form';

/** Older runs predate verification levels. Their saved status alone cannot establish an original comparison. */
export function evidenceResultLabel(event: EngineEvent): string | undefined {
  if (event.kind !== 'result' || event.blockType !== 'quality.evidence') return;
  const data = event.data;
  if (!data || typeof data !== 'object' || !('value' in data)) return;
  const result = data.value;
  if (!result || typeof result !== 'object' || !('status' in result)) return;
  const scope = 'verification' in result ? result.verification : undefined;
  const outcome = result.status === 'insufficient' ? '근거 부족' : result.status === 'conflicting' ? '근거 상충' : undefined;
  if (scope === 'original' && (result.status === 'verified' || outcome)) {
    const citations = 'passages' in result && Array.isArray(result.passages) ? result.passages : [];
    if (!citations.length || citations.some(item=>!editionIdentifier(item?.version))) return (outcome ?? '근거 있음') + ' (판 번호 미기록)';
  }
  const source = 'originalSource' in result ? result.originalSource : undefined;
  const original = source === 'supplied' ? '첨부 원문 대조' : source === 'mixed' ? '연결·첨부 원문 대조' : '원문 대조';
  if (result.status === 'verified') return scope === 'original' ? original+' 완료' : '근거 있음 (대조 범위 미기록)';
  if (result.status === 'candidate_match') return '후보 문구와 일치';
  if (outcome && scope === 'original') return outcome + ' (' + original + ')';
  if (outcome && scope === 'candidate') return outcome + ' (후보 문구 대조)';
  return outcome;
}
