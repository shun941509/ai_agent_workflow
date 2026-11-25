import TrashList, { type TrashEntry } from './TrashList';

export type TrashedProject = TrashEntry & { title: string };

export default function ProjectTrash({ onRestore }: {
  onRestore: (item: TrashedProject) => Promise<void>;
}) {
  return <TrashList scope="project" titleOf={item => item.title} onRestore={onRestore} />;
}
