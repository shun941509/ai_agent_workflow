export class StudioError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function requireThat(condition: unknown,status:number,message:string): asserts condition {
  if (!condition) throw new StudioError(status,message);
}
export function stringArg(value: unknown, name:string, max=8000): string {
  requireThat(typeof value==='string' && value.trim().length>0 && value.length<=max,400,name+'을(를) 확인하세요.');
  return value.trim();
}

