// Display an explicit loan limit only when a single unambiguous rule names it.
const borrower = /^(?:(?:도서관\s*)?회원(?:은|당|\s*한\s*명당)?|한\s*사람(?:의|당|은)|1\s*인(?:당|의)|개인(?:별|당|의)?|이용자(?:는|당))\s*/;
const limitStatement = /^(?:도서\s*)?대출\s*(?:한도|가능\s*권수|권수)(?:는|은|가|[:：])?\s*(?:최대\s*)?(\d+)\s*권(?:까지)?(?:입니다|이다|이에요)?$/;
const borrowingStatement = /^(?:(?:책|도서|자료)(?:을|를)?\s*)?(?:한\s*번에\s*)?(?:최대\s*)?(\d+)\s*권(?:까지)?\s*(?:빌릴\s*수\s*(?:있습니다|있어요|있다)|대출(?:할\s*수\s*(?:있습니다|있어요|있다)|이?\s*가능(?:합니다|해요|하다)))$/;

export function readLoanRule(source: string): { limit: number | null; quote: string } {
  const sentences = source.match(/[^.!?。！？\r\n]+[.!?。！？]*/gu) ?? [];
  const relevant = sentences.filter((text) =>
    /대출(?!\s*기간)|빌릴|빌리|빌려|\d\s*권|예외|제외|다만|^\s*단[,，]/.test(text));
  if (relevant.length !== 1) return { limit: null, quote: source };

  const quote = relevant[0];
  const statement = quote.trim().replace(/[.。]$/, '').trim().replace(borrower, '');
  for (const form of [limitStatement, borrowingStatement]) {
    const match = form.exec(statement);
    if (match && Number.isSafeInteger(Number(match[1]))) return { limit: Number(match[1]), quote };
  }
  return { limit: null, quote: source };
}
