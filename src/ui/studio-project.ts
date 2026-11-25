import type { Graph } from '../domain';
import type { EditorFocus } from '../domain/editor-focus';
import type { ReleaseDecision } from '../domain/release-decision';

export type Project = {
  id: string;
  title: string;
  mine: boolean;
  revision: number;
  publicVersion: number | null;
  releaseExercise?: { decisions: ReleaseDecision[] };
  visibility: 'private' | 'public' | 'link';
  token?: string;
  shareGeneration?: string;
  lesson?: string;
  updated: string;
  graph?: Graph;
};

export type FullProject = Project & { graph: Graph; editorFocus?: EditorFocus; hasExampleAnswer?: boolean };

export const visibilityNames = {
  private: '나만 사용',
  link: '비밀 링크',
  public: '모두에게 공개',
};

export function dateLabel(value: string) {
  return new Date(value).toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
  });
}
