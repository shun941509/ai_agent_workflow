export type PageQuery = Record<string, string | string[] | undefined>;

export function workspaceAddress(path: string, query: PageQuery) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === 'string') params.append(name, value);
    else value?.forEach(item => params.append(name, item));
  }
  return params.size ? path + '?' + params : path;
}

export function loginAddress(destination: string) {
  return destination === '/' ? '/login' : '/login?' + new URLSearchParams({returnTo: destination});
}

export function workspaceReturnTo(value: PageQuery[string]) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return '/';
  const path = value.split(/[?#]/, 1)[0];
  return path === '/' || path === '/prototype/library' ? value : '/';
}
