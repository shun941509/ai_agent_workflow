export const releaseDecisionLabels = {
  hold: '게시 보류',
  publish: '게시',
  keep: '현재 게시판 유지',
  rollback: '이전 판으로 복구',
} as const;

export type ReleaseAction = keyof typeof releaseDecisionLabels;
export type ReleaseDecision = {
  number: number;
  action: ReleaseAction;
  version: number;
  previousVersion: number | null;
  resultVersion: number | null;
  reason: string;
  created: string;
};
