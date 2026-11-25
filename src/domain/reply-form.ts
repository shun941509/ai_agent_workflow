export type ReplyField = {name:string; required:boolean};

export function replyFields(config:unknown):ReplyField[] {
  if (!Array.isArray(config)) return [];
  const fields = new Map<string,ReplyField>();
  for (const entry of config) {
    const name = typeof entry === 'string' ? entry : entry?.name ?? entry?.key;
    if (typeof name !== 'string' || !name.trim()) continue;
    const required = entry?.required !== false || fields.get(name)?.required === true;
    fields.set(name,{name,required});
  }
  return [...fields.values()];
}

export function replyFieldError(fields:ReplyField[],values:Record<string,unknown>):string {
  const missing = fields.filter(({name,required}) =>
    required && (!Object.hasOwn(values,name) || values[name] == null ||
      (typeof values[name] === 'string' && !values[name].trim())));
  return missing.length ? '양식의 필수 항목이 비었습니다: '+missing.map(field=>field.name).join(', ') : '';
}
