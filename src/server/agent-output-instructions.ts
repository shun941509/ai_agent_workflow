import type {Block} from '../domain/types';

const extensions = new Map([['json', 'json'], ['csv', 'csv'], ['markdown', 'md']]);

function portablePart(part: string) {
  return Boolean(part) && !/[<>:"|?*\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(part) &&
    !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part) &&
    Buffer.byteLength(part) <= 255;
}

// Keep usable project-relative subfolders. For an external path only the leaf may be reused.
function outputPath(fileName: string, format: string) {
  const path = fileName.replaceAll('\\', '/');
  const parts = path.replace(/^[a-z]:/i, '').split('/').filter((part, index, all) => part !== '.' || index === all.length - 1);
  if (!/^(?:\/|[a-z]:)/i.test(path) && parts.length && parts.every(portablePart)) {
    if (parts.length > 1 && parts[0].toLowerCase() === 'outputs') parts.shift();
    const candidate = 'outputs/' + parts.join('/');
    if (Buffer.byteLength(candidate) < 4096) return candidate;
  }
  const leaf = parts.at(-1) ?? '';
  const extension = extensions.get(format) ?? 'txt';
  return 'outputs/' + (portablePart(leaf) ? leaf : '결과.' + extension);
}

export function outputInstructions(config: Block['config']) {
  const fileName = typeof config.fileName === 'string' && config.fileName.trim() ? config.fileName : undefined;
  const format = String(config.format || 'text');
  return [
    '입력값을 지정한 형식으로 변환해 메모리에 파일 객체를 만드세요. 이 단계에서는 디스크나 임시 파일에 쓰지 마세요. 아래는 최종 전달 시 사용할 경로 후보입니다.',
    ...(fileName ? ['', '    ' + outputPath(fileName, format)] : [
      '', '이 단계에서 사용자에게 파일 이름을 확인하세요.',
    ]), '',
    '다음 단계에 `{fileName, format, content}`를 전달하세요. fileName은 설계에서 지정하거나 이 단계에서 확인한 이름, format은 아래 설계값, content는 생성한 본문 문자열입니다. 파일마다 생성한 호출을 기록하세요. 하위 Workflow와 문서 읽기에서도 이 객체의 본문을 사용하세요.',
    ...(format === 'csv' ? [
      'CSV는 입력 목록의 행 순서와 배열 행의 셀 순서를 유지하세요. 객체 행에 나온 키를 처음 등장한 순서대로 모아 첫 행에 쓰고, 이후 객체 행은 이 열 순서에 맞추세요. 빠진 키와 null은 빈 셀입니다. 각 셀을 큰따옴표로 감싸고 내부 큰따옴표는 두 번 쓰세요. 셀 안의 쉼표·개행과 마지막 빈 셀도 보존하세요. 열은 쉼표, 행은 CRLF로 구분하고 끝에 줄바꿈을 덧붙이지 마세요.',
    ] : []),
    ...(format === 'json' ? ['JSON은 입력 자료형을 유지해 두 칸 들여쓰기로 직렬화하고 끝에 줄바꿈을 덧붙이지 마세요.'] : []),
    '',
    '최상위 실행이 성공하고 최종 답변에 해당 파일이 포함될 때만 대표가 저장합니다. 가림 처리된 이름과 본문을 사용하고 차단된 파일은 제외하세요. 심볼릭 링크를 포함한 실제 경로를 확인해 프로젝트 루트 안의 outputs/에 저장하세요. 경로가 너무 길면 확장자와 번호를 보존하며 outputs/ 바로 아래에 이름을 줄여 저장하세요.',
    '기존 파일을 보존하도록 새 파일 생성 방식으로 저장하세요. 같은 이름이 있으면 확장자 앞(확장자가 없으면 이름 끝)에 (2), (3) 순으로 번호를 붙이세요. 예를 들어 보고서.md의 다음 이름은 보고서 (2).md입니다. 같은 생성 호출을 다시 전달할 때는 기록한 실제 경로를 확인해 한 번만 저장하세요.',
    '', '    ' + JSON.stringify({fileName, format}),
  ];
}
