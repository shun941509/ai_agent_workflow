import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Graph} from '../domain/types';
import {writeAsset, type BundleFile} from './assets';
import type {User} from './auth';
import {one} from './db';

// Git for Windows can check these upstream LF scripts out with CRLF.
function shellScript(bytes:Buffer) {
  return Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n')).toString('base64');
}

// Literal reads keep Next.js file tracing and the learner's package limited to these files.
function originalFiles(name: unknown): BundleFile[] | undefined {
  if (name === 'test-driven-development') return [
    {path:'SKILL.md', data:readFileSync(join(process.cwd(), '.agents/skills/test-driven-development/SKILL.md'), 'base64')},
    {path:'writing-good-tests.md', data:readFileSync(join(process.cwd(), '.agents/skills/test-driven-development/writing-good-tests.md'), 'base64')},
    {path:'LICENSE', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/licenses/superpowers-LICENSE'), 'base64')},
  ];
  if (name === 'find-docs') return [
    {path:'SKILL.md', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/find-docs/SKILL.md'), 'base64')},
    {path:'LICENSE', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/find-docs/LICENSE'), 'base64')},
  ];
  if (name === 'web-artifacts-builder') return [
    {path:'SKILL.md', data:readFileSync(join(process.cwd(), '.agents/skills/web-artifacts-builder/SKILL.md'), 'base64')},
    {path:'LICENSE.txt', data:readFileSync(join(process.cwd(), '.agents/skills/web-artifacts-builder/LICENSE.txt'), 'base64')},
    {path:'scripts/init-artifact.sh', data:shellScript(readFileSync(join(process.cwd(), '.agents/skills/web-artifacts-builder/scripts/init-artifact.sh')))},
    {path:'scripts/bundle-artifact.sh', data:shellScript(readFileSync(join(process.cwd(), '.agents/skills/web-artifacts-builder/scripts/bundle-artifact.sh')))},
    {path:'scripts/shadcn-components.tar.gz', data:readFileSync(join(process.cwd(), '.agents/skills/web-artifacts-builder/scripts/shadcn-components.tar.gz'), 'base64')},
  ];
  if (name === 'webhook-handler-patterns') return [
    {path:'SKILL.md', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/webhook-handler-patterns/SKILL.md'), 'base64')},
    {path:'LICENSE', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/webhook-handler-patterns/LICENSE'), 'base64')},
    {path:'references/handler-sequence.md', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/webhook-handler-patterns/references/handler-sequence.md'), 'base64')},
    {path:'references/idempotency.md', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/webhook-handler-patterns/references/idempotency.md'), 'base64')},
    {path:'references/error-handling.md', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/webhook-handler-patterns/references/error-handling.md'), 'base64')},
    {path:'references/ordering.md', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/webhook-handler-patterns/references/ordering.md'), 'base64')},
    {path:'references/retry-logic.md', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/webhook-handler-patterns/references/retry-logic.md'), 'base64')},
    {path:'references/frameworks/express.md', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/webhook-handler-patterns/references/frameworks/express.md'), 'base64')},
    {path:'references/frameworks/fastapi.md', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/webhook-handler-patterns/references/frameworks/fastapi.md'), 'base64')},
    {path:'references/frameworks/nextjs.md', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/webhook-handler-patterns/references/frameworks/nextjs.md'), 'base64')},
  ];
  if (name === 'skill-creator') return [
    {path:'SKILL.md', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/skill-creator/SKILL.md'), 'base64')},
    {path:'license.txt', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/skill-creator/license.txt'), 'base64')},
    {path:'agents/openai.yaml', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/skill-creator/agents/openai.yaml'), 'base64')},
    {path:'assets/skill-creator-small.svg', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/skill-creator/assets/skill-creator-small.svg'), 'base64')},
    {path:'assets/skill-creator.png', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/skill-creator/assets/skill-creator.png'), 'base64')},
    {path:'references/openai_yaml.md', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/skill-creator/references/openai_yaml.md'), 'base64')},
    {path:'scripts/init_skill.py', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/skill-creator/scripts/init_skill.py'), 'base64')},
    {path:'scripts/generate_openai_yaml.py', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/skill-creator/scripts/generate_openai_yaml.py'), 'base64')},
    {path:'scripts/quick_validate.py', data:readFileSync(join(process.cwd(), 'vendor/lesson-skills/skill-creator/scripts/quick_validate.py'), 'base64')},
  ];
  if (name === 'frontend-design') return [
    {path:'SKILL.md', data:readFileSync(join(process.cwd(), '.agents/skills/frontend-design/SKILL.md'), 'base64')},
    {path:'LICENSE.txt', data:readFileSync(join(process.cwd(), '.agents/skills/frontend-design/LICENSE.txt'), 'base64')},
  ];
  if (name === 'frontend-ui-engineering') return [
    {path:'SKILL.md', data:readFileSync(join(process.cwd(), '.agents/skills/frontend-ui-engineering/SKILL.md'), 'base64')},
    {path:'references/shared/accessibility-checklist.md', data:readFileSync(join(process.cwd(), '.agents/skills/frontend-ui-engineering/references/shared/accessibility-checklist.md'), 'base64')},
  ];
  if (name === 'grilling') return [
    {path:'SKILL.md', data:readFileSync(join(process.cwd(), '.agents/skills/grilling/SKILL.md'), 'base64')},
    {path:'agents/openai.yaml', data:readFileSync(join(process.cwd(), '.agents/skills/grilling/agents/openai.yaml'), 'base64')},
  ];
  if (name === 'to-questionnaire') return [
    {path:'SKILL.md', data:readFileSync(join(process.cwd(), '.agents/skills/to-questionnaire/SKILL.md'), 'base64')},
    {path:'agents/openai.yaml', data:readFileSync(join(process.cwd(), '.agents/skills/to-questionnaire/agents/openai.yaml'), 'base64')},
  ];
  if (name === 'domain-modeling') return [
    {path:'SKILL.md', data:readFileSync(join(process.cwd(), '.agents/skills/domain-modeling/SKILL.md'), 'base64')},
    {path:'ADR-FORMAT.md', data:readFileSync(join(process.cwd(), '.agents/skills/domain-modeling/ADR-FORMAT.md'), 'base64')},
    {path:'GLOSSARY-FORMAT.md', data:readFileSync(join(process.cwd(), '.agents/skills/domain-modeling/GLOSSARY-FORMAT.md'), 'base64')},
    {path:'agents/openai.yaml', data:readFileSync(join(process.cwd(), '.agents/skills/domain-modeling/agents/openai.yaml'), 'base64')},
  ];
  if (name === 'tdd') return [
    {path:'SKILL.md', data:readFileSync(join(process.cwd(), '.agents/skills/tdd/SKILL.md'), 'base64')},
    {path:'tests.md', data:readFileSync(join(process.cwd(), '.agents/skills/tdd/tests.md'), 'base64')},
    {path:'mocking.md', data:readFileSync(join(process.cwd(), '.agents/skills/tdd/mocking.md'), 'base64')},
    {path:'agents/openai.yaml', data:readFileSync(join(process.cwd(), '.agents/skills/tdd/agents/openai.yaml'), 'base64')},
  ];
  if (name === 'code-review') return [
    {path:'SKILL.md', data:readFileSync(join(process.cwd(), '.agents/skills/code-review/SKILL.md'), 'base64')},
    {path:'agents/openai.yaml', data:readFileSync(join(process.cwd(), '.agents/skills/code-review/agents/openai.yaml'), 'base64')},
  ];
}

/** Called only for a new template copy, within the project creation transaction. */
export function installLessonOriginalSkills(user: User, graph: Graph) {
  for (const node of graph.nodes) {
    const name = node.config.bundledSkill;
    if (node.type !== 'instruction.skill') continue;
    const files = originalFiles(name);
    if (!files) continue;
    // The first edition remains immutable even if its owner later renames or revises the Skill.
    const existing = one<{id:string}>(`
      SELECT a.id FROM active_assets a
      JOIN asset_edition_names n ON n.asset=a.id AND n.version=1
      JOIN asset_versions v ON v.asset=a.id AND v.number=1
      WHERE a.owner=? AND a.kind='skill' AND n.name=?
        AND json_extract(v.payload,'$.files')=? AND coalesce(json_extract(v.payload,'$.requiresScripts'),0)=0
      LIMIT 1`, user.id, name, JSON.stringify(files));
    node.config.assetId = existing?.id ?? writeAsset(user, {name, kind:'skill', payload:{files}}).id;
    node.config.version = 1;
  }
}
