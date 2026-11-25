const toolLabels = new Map([
  ['reservations.list', '내 예약 조회'],
  ['reservations.create', '도서관 예약 생성'],
  ['reservations.cancel', '예약 취소'],
  ['knowledge.publish', '자료판 발행'],
  ['knowledge.withdraw', '자료판 철회'],
]);

export function toolName(tool: string): string {
  return toolLabels.get(tool) ?? tool;
}
