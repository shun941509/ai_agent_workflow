export const dynamicLessonLimits = { total: 4, simultaneous: 2 };

export type DynamicLessonPolicy = {
  maxCreatedAgents: number;
  maxInFlightAgents: number;
  failurePolicy: 'collect' | 'stop';
};

export const dynamicLessonExample = '예를 들어 총 2명·동시 1명으로 결과를 수집해 보세요. 네 지점 중 중앙도서관과 강변도서관을 고르면 기본 자료로 중앙은 확인, 강변은 근거 부족, 호수와 숲은 선택 제외가 됩니다.';

export function dynamicLessonRangeNote(total: number, concurrent: number): string | undefined {
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(concurrent) || concurrent < 1) return;
  const lessonTotal = Math.min(total, dynamicLessonLimits.total);
  const lessonConcurrent = Math.min(lessonTotal, concurrent, dynamicLessonLimits.simultaneous);
  if (total <= lessonTotal && concurrent <= lessonConcurrent) return;
  return `자유 실험 · 현재 전체 ${total}명, 동시 ${concurrent}명입니다. 네 지점 기본 실습으로 돌아가려면 ‘지점별 조사 담당 생성 → 고급 설정’에서 ‘전체 생성 상한’을 ${lessonTotal}명, ‘동시 실행 상한’을 ${lessonConcurrent}명으로 맞추세요.`;
}

/** Completion criteria for the template's four-branch question. */
export function dynamicLessonChecks({maxCreatedAgents: total, maxInFlightAgents: concurrent, failurePolicy}: DynamicLessonPolicy): string[] {
  const rangeNote = dynamicLessonRangeNote(total, concurrent);
  if (rangeNote) return [rangeNote];
  const selection = total >= 4
    ? '네 지점 모두 조사 대상입니다. 생성 한도에 따른 선택 제외는 0곳입니다.'
    : `네 지점 중 ${total}곳을 고릅니다. 선택에서 제외한 ${4-total}곳과 조사 대상으로 고른 지점을 구분하세요.`;
  const evidence = total === 1
    ? '기본 자료에서 강변만 고르면 확인된 지점이 0곳이어도 됩니다. 강변의 미완료 사유가 근거 부족인지 확인하세요.'
    : '담당자가 찾은 원문과 지점을 대조하세요. 기본 자료로 강변을 조사하면 근거 부족이 기록됩니다.';
  const handling = failurePolicy === 'collect'
    ? '미완료 지점이 있어도 ‘지점별 결과 정리’까지 진행하고, 완료한 지점의 근거와 미완료 사유를 함께 볼 수 있습니다.'
    : '미완료 지점이 나오면 실행 기록에서 중단을 일으킨 지점과 사유를 확인하세요. 선택 후 미시작인 지점과 선택에서 제외한 지점을 구분하세요. 이때 ‘지점별 결과 정리’는 실행되지 않습니다.';
  return [selection, `실행 기록에서 각 생성 차수의 담당자가 ${concurrent}명 이하인지 확인하세요.`, evidence, handling];
}

export function isDynamicLessonPolicy(value: unknown): value is DynamicLessonPolicy {
  if (!value || typeof value !== 'object') return false;
  const { maxCreatedAgents: total, maxInFlightAgents: simultaneous, failurePolicy } =
    value as Partial<DynamicLessonPolicy>;
  return typeof total === 'number' && Number.isInteger(total) &&
    total >= 1 && total <= dynamicLessonLimits.total &&
    typeof simultaneous === 'number' && Number.isInteger(simultaneous) &&
    simultaneous >= 1 && simultaneous <= Math.min(total, dynamicLessonLimits.simultaneous) &&
    (failurePolicy === 'collect' || failurePolicy === 'stop');
}
