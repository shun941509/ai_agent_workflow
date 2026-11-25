import { BookOpen, Layers3, SignalLow } from 'lucide-react';
import type { Graph, Lesson } from '../domain/types';
import type { Selection } from './editor/graph';
import HomeLayout, { libraryDescription, libraryPracticeNote, libraryTitle } from './home/HomeLayout';
import LibraryArtwork from './home/LibraryArtwork';
import { librarySteps } from './home/LibrarySteps';
import SavedCanvas from './home/SavedCanvas';
import { readLoanRule } from './home/loan-limit';

type HomeProps = {
  project: { title: string; graph: Graph } | null;
  lesson?: Omit<Lesson, 'graph'>;
  selection?: Selection;
  onOpen: () => void;
  onIntro: () => void;
  busy?: boolean;
};

export default function WorkspaceHome({ project, lesson, selection = null, onOpen, onIntro, busy }: HomeProps) {
  const beginner = !project || lesson?.id === 'beginner';
  const fileLesson = !project || (beginner && project.graph.nodes.some(node => node.type === 'file.create'));
  const title = project?.title ?? libraryTitle;
  const steps = fileLesson ? librarySteps.map((step, i) => ({ ...step, detail: lesson?.steps[i] || step.detail })) :
    lesson?.steps.map(title => ({ title }));
  const rules = beginner && project?.graph.nodes.find(node => node.id === 'rules' && node.type === 'resource.context');
  const source = rules && !rules.config.assetId && rules.config.content;
  const limit = typeof source === 'string' ? readLoanRule(source).limit : null;
  const level = lesson?.level ?? (!project ? '초급' : undefined);

  return <HomeLayout resume={Boolean(project)} onOpen={onOpen} onIntro={onIntro} busy={busy} title={title}
    description={fileLesson ? libraryDescription : lesson?.description || '마지막으로 편집한 블록 배치에서 작업을 이어가세요.'}
    facts={<>
      {level && <span><SignalLow aria-hidden="true" size={18}/>{level}</span>}
      {!project ? <span><BookOpen aria-hidden="true" size={15}/>도서관 안내</span> :
        typeof source === 'string' ? <span><BookOpen aria-hidden="true" size={15}/>{limit === null ? '대출 한도 확인 필요' : `현재 대출 한도 ${limit}권`}</span> :
          <span><Layers3 aria-hidden="true" size={15}/>블록 {project.graph.nodes.length}개</span>}
    </>}
    artwork={project ? <SavedCanvas graph={project.graph} selection={selection}/> : <LibraryArtwork/>}
    steps={steps} practiceNote={fileLesson ? libraryPracticeNote : lesson?.goal}
  />;
}
