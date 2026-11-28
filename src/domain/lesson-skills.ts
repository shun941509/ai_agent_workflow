import type {Graph, Lesson, LessonSkill} from './types';
import type {Drawing} from './template-drawing';

export function attachLessonSkill(
  drawing: Drawing, key: string, skill: {title:string; example:string; content?:string},
  column: number, row: number, ...agentIds: string[]
) {
  // A fresh lesson copy resolves the bundled package to the owner's immutable resource edition.
  const source = skill.content === undefined ? {assetId:key, bundledSkill:key} : {content:skill.content};
  const id = drawing.node('skill-' + key, 'instruction.skill', skill.title, column, row, {version:'1', ...source, skillExample:skill.example});
  for (const agentId of agentIds) drawing.edge(id, agentId, 'reference', 'ref', 'skill', skill.title);
}

function connectedSkills(graph: Graph): LessonSkill[] {
  return graph.nodes.filter(node => node.type === 'instruction.skill').flatMap(skill => {
    // Installation replaces the package name in assetId with the owner's ID and pins its first edition.
    const bundled = Boolean(skill.config.assetId && skill.config.bundledSkill &&
      skill.id === 'skill-' + skill.config.bundledSkill && Number(skill.config.version) === 1);
    if (skill.config.assetId && !bundled) return [];
    const example = skill.config.skillExample;
    if (typeof example !== 'string' || !example.trim()) return [];
    const targets = graph.edges.filter(edge => edge.from === skill.id && edge.kind === 'reference' && edge.input === 'skill')
      .flatMap(edge => {
        const node = graph.nodes.find(node => node.id === edge.to);
        return node ? [{id: node.id, title: node.title}] : [];
      });
    return targets.length ? [{id: skill.id, title: skill.title, example, targets, ...(bundled && {bundled: true as const})}] : [];
  });
}

export function lessonWithSkills(lesson: Lesson): Lesson {
  const skills = connectedSkills(lesson.graph);
  const steps = [...lesson.steps.slice(0, -1), ...(lesson.skillSteps ?? []), ...lesson.steps.slice(-1)];
  return {...lesson, skills, steps};
}

/** A saved copy may predate these Skills, or its owner may have rewired or replaced them. */
export function savedSkillLesson(lesson: Omit<Lesson, 'graph'>, graph: Graph): Omit<Lesson, 'graph'> {
  const skills = connectedSkills(graph);
  // Mixed web design lessons ask learners to edit the inline instructions, which older copies also have.
  const expectedSkills = lesson.skills ?? [];
  const inline = expectedSkills.filter(skill => !skill.bundled);
  const required = inline.length ? inline : expectedSkills;
  const matches = required.every(expected => skills.some(skill =>
    skill.id === expected.id && skill.title === expected.title && skill.bundled === expected.bundled &&
    expected.targets.every(target => skill.targets.some(actual => actual.id === target.id && actual.title === target.title))));
  return {...lesson, skills: undefined, steps: matches ? lesson.steps : lesson.steps.filter(step => !lesson.skillSteps?.includes(step))};
}
