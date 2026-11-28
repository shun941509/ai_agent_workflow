export type ReplyField = {name:string; required:boolean; multiline?:boolean; format?:'edition'};

export function questionMarkdownName(value:unknown): string | undefined {
  if (typeof value !== 'string') return;
  const name = value.split(/[\\/]/).pop()?.trim();
  if (!name) return;
  return name.toLowerCase().endsWith('.md') ? name : name + '.md';
}

/** Published collection editions may be named, while asset editions are numbered. */
export function editionIdentifier(value:unknown):string | undefined {
  if(typeof value==='number' && Number.isSafeInteger(value))return String(value);
  return typeof value==='string' && value.trim() && !/[\r\n]/.test(value) ? value : undefined;
}

export function replyFields(config:unknown):ReplyField[] {
  if (!Array.isArray(config)) return [];
  const fields = new Map<string,ReplyField>();
  for (const entry of config) {
    const name = typeof entry === 'string' ? entry : entry?.name ?? entry?.key;
    if (typeof name !== 'string' || !name.trim()) continue;
    const required = entry?.required !== false || fields.get(name)?.required === true;
    const multiline = entry?.multiline === true || fields.get(name)?.multiline === true;
    fields.set(name,{name,required,...(multiline && {multiline:true})});
  }
  return [...fields.values()];
}

export function replyFieldError(fields:ReplyField[],values:Record<string,unknown>):string {
  const missing = fields.filter(({name,required}) =>
    required && (!Object.hasOwn(values,name) || values[name] == null ||
      (typeof values[name] === 'string' && !values[name].trim())));
  if(missing.length)return '양식의 필수 항목이 비었습니다: '+missing.map(field=>field.name).join(', ');
  return fields.some(field=>field.format==='edition' && !editionIdentifier(values[field.name]))
    ? '원문에 표시된 판 번호 또는 판 이름을 입력하세요.' : '';
}
