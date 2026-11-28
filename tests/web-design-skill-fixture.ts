import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {EngineServices} from '../src/engine';

const originalText = (name: string) => readFileSync(new URL('../.agents/skills/' + name + '/SKILL.md', import.meta.url), 'utf8');

export const designSource = originalText('frontend-design');
export const engineeringSource = originalText('frontend-ui-engineering');
export const grillingSource = originalText('grilling');
export const questionnaireSource = originalText('to-questionnaire');
export const domainModelingSource = originalText('domain-modeling');
export const tddSource = originalText('tdd');
export const codeReviewSource = originalText('code-review');
const sources = new Map([
  ['frontend-design', designSource],
  ['frontend-ui-engineering', engineeringSource],
  ['grilling', grillingSource],
  ['to-questionnaire', questionnaireSource],
  ['domain-modeling', domainModelingSource],
  ['tdd', tddSource],
  ['code-review', codeReviewSource],
]);

// The catalog uses these names until the server pins the user's actual resource editions.
export const originalSkill: NonNullable<EngineServices['asset']> = async (id, version) => {
  const content = sources.get(id);
  assert.ok(content, id);
  assert.equal(version, '1');
  return {id, title: id, version, content};
};
