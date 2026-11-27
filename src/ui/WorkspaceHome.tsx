import { ArrowRight, ArrowUpRight, BookOpen, Clock3, FolderOpen, Plus } from 'lucide-react';
import type { Graph, Lesson } from '../domain/types';
import type { Selection } from './editor/graph';
import { ResumeHeading } from './home/HomeLayout';
import { librarySteps } from './home/LibrarySteps';
import SavedCanvas from './home/SavedCanvas';
import { readLoanRule } from './home/loan-limit';
import styles from './home/WorkspaceDesk.module.css';

type HomeProps = {
  project: { title: string; graph: Graph } | null;
  lesson?: Omit<Lesson, 'graph'>;
  selection?: Selection;
  onOpen: () => void;
  onNew: () => void;
  onTemplates: () => void;
  busy?: boolean;
};

export default function WorkspaceHome({ project, lesson, selection = null, onOpen, onNew, onTemplates, busy }: HomeProps) {
  const beginner = lesson?.id === 'beginner';
  const fileLesson = beginner && project?.graph.nodes.some(node => node.type === 'file.create');
  const rules = beginner && project?.graph.nodes.find(node => node.id === 'rules' && node.type === 'resource.context');
  const source = rules && !rules.config.assetId && rules.config.content;
  const limit = typeof source === 'string' ? readLoanRule(source).limit : null;
  return <div className={styles.home}>
    <h1>내 작업실</h1>
    {project ? <section className={styles.resume} aria-label="마지막 작업">
      <div className={styles.resumeCopy}>
        <p className={styles.context}><Clock3 size={16} aria-hidden="true"/>마지막으로 편집한 Agent</p>
        <ResumeHeading key={project.title} as="h2" title={project.title}/>
        {lesson && <p className={styles.summary}>{lesson.description}</p>}
        <p className={styles.facts}>{lesson?.level && <span>{lesson.level} 실습</span>}
          <span>{typeof source === 'string' ? (limit === null ? '대출 한도 확인 필요' : `현재 대출 한도 ${limit}권`) : `블록 ${project.graph.nodes.length}개`}</span>
        </p>
        <button type="button" className="btn primary" onClick={onOpen} disabled={busy}>편집기 다시 열기<ArrowUpRight size={16} aria-hidden="true"/></button>
      </div>
      <SavedCanvas graph={project.graph} selection={selection}/>
    </section> : <section className={styles.start} aria-label="작업 시작 방법">
      <article><FolderOpen size={27} aria-hidden="true"/><h2>내 업무로 시작</h2>
        <p>맡길 일을 설명하거나 빈 캔버스에서 직접 설계하세요.</p>
        <button type="button" className="btn primary" onClick={onNew} disabled={busy}><Plus size={16} aria-hidden="true"/>새 Agent 만들기</button>
      </article>
      <article><BookOpen size={27} aria-hidden="true"/><h2>예제로 시작</h2>
        <p>실습 사본에서 블록과 자료를 바꾸고 답변을 비교하세요.</p>
        <button type="button" className="btn" onClick={onTemplates}>예제로 배우기<ArrowRight size={16} aria-hidden="true"/></button>
      </article>
    </section>}
    {project && lesson && lesson.steps.length > 0 && <details className={styles.practice}><summary>실습 순서</summary>
      <p>{lesson.goal}</p><ol>{lesson.steps.map((detail, index) => <li key={detail}>
        {fileLesson && librarySteps[index] && <strong>{librarySteps[index].title}</strong>}{detail}
      </li>)}</ol>
    </details>}
  </div>;
}
