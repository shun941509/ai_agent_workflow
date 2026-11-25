import type { Lesson } from '../../domain/types';

export function OptionalPractice({ lesson }: { lesson: Pick<Lesson, 'optionalPractice' | 'optionalSteps'> }) {
  return <>
    <p>{lesson.optionalPractice}</p>
    {lesson.optionalSteps && <ol className="lesson-steps">
      {lesson.optionalSteps.map(step => <li key={step}>{step}</li>)}
    </ol>}
  </>;
}
