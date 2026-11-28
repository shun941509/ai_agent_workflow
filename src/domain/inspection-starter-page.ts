export const inspectionStarterFile = 'equipment-inspection-starters.html';

const sections = new Map([
  ['equipment-return-inventory', 'list'],
  ['equipment-inspection-first', 'notify'],
  ['equipment-inspection-compare', 'check'],
]);

export function inspectionStarterPage(lessonId?:string) {
  const section = sections.get(lessonId ?? '');
  return section ? inspectionStarterFile + '#' + section : undefined;
}
