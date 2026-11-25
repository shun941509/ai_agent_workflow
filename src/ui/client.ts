import { loginAddress } from '../app/account-navigation';

export class StudioApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function studioResponse(action:string,data:unknown={},signal?:AbortSignal):Promise<Response>{
  const res=await fetch('/api/studio',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({action,data}),cache:'no-store',signal});
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.replace(loginAddress(window.location.pathname + window.location.search + window.location.hash));
    }
    const payload=await res.json().catch(() => null);
    throw new StudioApiError(res.status,payload?.error||'요청을 처리하지 못했습니다.');
  }
  return res;
}

export async function api<T=any>(action:string,data:any={},signal?:AbortSignal):Promise<T>{
  const res=await studioResponse(action,data,signal);
  const payload=await res.json();
  return payload.data;
}
export const message=(err:unknown)=>err instanceof Error?err.message:'잠시 후 다시 시도하세요.';

export async function intentHash(data:unknown) {
  const hash=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
  return Array.from(new Uint8Array(hash), byte=>byte.toString(16).padStart(2,'0')).join('');
}

const pendingWrites = new Map<string, string>();

// Keep the same mutation key after a lost response, including across a reload in this tab.
export function pendingWriteKey(slot: string) {
  let key = pendingWrites.get(slot);
  if (!key) {
    try { key = sessionStorage.getItem(slot) || undefined; } catch { /* Storage may be disabled. */ }
    key ??= crypto.randomUUID();
    pendingWrites.set(slot, key);
    try { sessionStorage.setItem(slot, key); } catch { /* Same-view retries still work. */ }
  }
  return key;
}

export function finishWrite(slot: string, key: string) {
  if (pendingWrites.get(slot) === key) pendingWrites.delete(slot);
  try { if (sessionStorage.getItem(slot) === key) sessionStorage.removeItem(slot); } catch { /* Optional tab storage. */ }
}

