export const runInputLimit = 40_000;

export type Attachment = {fileName:string;content:string};
export type FileExample = Attachment & {blockTitle:string};

// Preserve the existing serialized attachment format used by saved cases and retries.
// Escape only typed questions that could otherwise be mistaken for a protocol object.
export function literalRunQuestion(value:string):string | undefined {
  if(!value.trimStart().startsWith('{'))return;
  try{
    const data=JSON.parse(value);
    if(data?.$studioInput==='question' && typeof data.question==='string')return data.question;
  }catch{}
}

export function encodeRunQuestion(text:string):string {
  return attachmentFrom(text)||literalRunQuestion(text)!==undefined
    ? JSON.stringify({$studioInput:'question',question:text}) : text;
}

export function fileExtensions(accept:unknown):string[] {
  const entries = Array.isArray(accept) ? accept : typeof accept === 'string' ? accept.split(/[,\n]/) : [];
  return [...new Set(entries.filter((item):item is string=>typeof item === 'string')
    .map(item=>item.trim().toLowerCase()).filter(Boolean).map(item=>item.startsWith('.')?item:'.'+item))];
}

export function attachmentError(file:Attachment | undefined,accept:readonly string[]):string {
  if (!file?.fileName.trim()) return '처리할 파일을 첨부하세요.';
  if (accept.length && !accept.some(ext=>file.fileName.toLowerCase().endsWith(ext))) {
    return '허용된 파일 형식을 선택하세요. ('+accept.join(', ')+')';
  }
  return '';
}

export function attachmentFrom(value:unknown):Attachment | undefined {
  if(typeof value === 'string') {
    if(!value.trimStart().startsWith('{'))return;
    try{value=JSON.parse(value);}catch{return;}
  }
  if(value && typeof value==='object' && 'fileName' in value && typeof value.fileName==='string' &&
      'content' in value && typeof value.content==='string')return {fileName:value.fileName,content:value.content};
}
