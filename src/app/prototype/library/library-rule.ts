// The inline resource from the beginner lesson, including its hours and help text.
export const defaultRule = [
  '한 사람의 대출 한도는 3권입니다.',
  '평일에는 오전 9시부터 오후 6시까지, 토요일에는 오전 10시부터 오후 4시까지 엽니다. 일요일은 휴관합니다.',
  '자료에서 확인할 수 없는 사항은 1층 안내데스크에 문의해 주세요.',
].join('\n');

export { readLoanRule } from '../../../ui/home/loan-limit';
