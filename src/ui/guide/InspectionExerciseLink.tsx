import { ExternalLink } from 'lucide-react';
import { inspectionStarterPage } from '../../domain/inspection-starter-page';

export function InspectionExerciseLink({lessonId}: {lessonId:string}) {
  let page = inspectionStarterPage(lessonId);
  let label = '장비 반납 기초 실습 열기';
  if (lessonId === 'equipment-inspection-web') {
    page = 'equipment-inspection.html';
    label = '검수 알림 실습 열기';
  } else if (lessonId === 'equipment-inspection-recovery') {
    page = 'equipment-inspection-recovery.html';
    label = '검수 알림 복구 실습 열기';
  }
  if (!page) return null;
  return <p><a className="btn" href={'/examples/' + page} target="_blank" rel="noopener">
    <ExternalLink size={16} aria-hidden="true" />{label} (새 창)
  </a></p>;
}
