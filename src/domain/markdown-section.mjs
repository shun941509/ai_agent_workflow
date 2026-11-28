/** Replace the managed section without rewriting any Markdown outside its boundaries. */
export function updateMarkdownSection(original, section, heading, marker) {
  if (typeof original !== 'string' || !original.trim() || typeof section !== 'string' ||
      typeof heading !== 'string' || !/^#{1,6} [^\r\n]+$/.test(heading) ||
      typeof marker !== 'string' || !/^[\w-]+$/.test(marker)) {
    throw new Error('원본 Markdown, 갱신할 절 제목과 마커 이름을 확인하세요.');
  }
  const start = '<!-- '+marker+':begin -->';
  const end = '<!-- '+marker+':end -->';
  const lines = section.trim().split(/\r?\n/);
  if (lines[0] !== start || lines[1] !== heading || lines.at(-1) !== end ||
      !lines.slice(2,-1).some(line=>line.trim()) || lines.slice(1,-1).some(line=>line===start || line===end)) {
    throw new Error('새 Markdown 절의 시작 마커, 제목, 본문과 끝 마커를 확인하세요.');
  }

  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const replacement = lines.join(eol);
  const depth = heading.indexOf(' ');
  const headings = [];
  const markers = [];
  let fence = '';
  for (const match of original.matchAll(/^[^\r\n]+/gm)) {
    const line = match[0].trimEnd();
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (delimiter && delimiter[1][0]===fence[0] && delimiter[1].length>=fence.length && !delimiter[2].trim()) fence='';
      continue;
    }
    if (delimiter) { fence=delimiter[1]; continue; }
    if (line===start || line===end) markers.push({line,at:match.index,end:match.index+match[0].length});
    const level = /^(#{1,6})[ \t]+/.exec(line)?.[1].length;
    if (level && level<=depth) headings.push({line,at:match.index});
  }
  if (markers.length) {
    if (markers.length!==2 || markers[0].line!==start || markers[1].line!==end) {
      throw new Error('기존 Markdown에 갱신 구간의 마커가 중복되거나 짝이 맞지 않습니다.');
    }
    return original.slice(0,markers[0].at)+replacement+original.slice(markers[1].end);
  }
  const index = headings.findIndex(item=>item.line===heading);
  if (index<0) return original+(original.endsWith(eol) ? eol : eol+eol)+replacement+eol;
  const next = headings[index+1];
  const suffix = next ? eol+eol+original.slice(next.at) : eol;
  return original.slice(0,headings[index].at)+replacement+suffix;
}
