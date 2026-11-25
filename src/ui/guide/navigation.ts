import { guideHelp, guideSteps, type GuideHelpId } from './content';

export const guideSections = {
  start: '처음 시작하기', goals: '목적별로 만들기', terms: '기능·용어', help: '문제 해결',
  blocks: '블록·자료 찾아보기', menus: '메뉴별 사용법',
} as const;
export type GuideSection = keyof typeof guideSections;
export type GuideHelpOrigin = 'practice' | 'guide';
export type GuidePosition = { section: GuideSection; step: number; issue?: GuideHelpId; helpOrigin?: GuideHelpOrigin };

export function guideLocation(params: URLSearchParams, hash = ''): GuidePosition {
  const value = params.get('section') ?? '';
  const section = Object.hasOwn(guideSections, value) ? value as GuideSection : 'start';
  const number = Number(params.get('step'));
  const step = Number.isInteger(number) && number >= 1 && number <= guideSteps.length ? number : 1;
  if (section !== 'help') return {section, step};
  const linkedIssue = guideHelp.find(item => item.id === params.get('issue'))?.id;
  // Older in-page links put the selected problem in the fragment and left the original problem in the query.
  const issue = guideHelp.find(item => hash === '#guide-help-' + item.id)?.id ?? linkedIssue;
  if (!issue) return {section, step};
  const source = params.get('from');
  const fromPractice = source === 'practice' || (source === null && linkedIssue === guideSteps[step - 1].helpId);
  return {section, step, issue, helpOrigin: fromPractice ? 'practice' : 'guide'};
}

export function guideAddress(section: GuideSection, step: number, issue?: GuideHelpId, helpOrigin?: GuideHelpOrigin) {
  const params = new URLSearchParams({view: 'guide', section, step: String(step)});
  if (section === 'help' && issue) {
    params.set('issue', issue);
    if (helpOrigin) params.set('from', helpOrigin);
  }
  return '/?' + params.toString();
}
