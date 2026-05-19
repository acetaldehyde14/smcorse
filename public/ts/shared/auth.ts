export function getHeaders(): Record<string, string> {
  const tok = localStorage.getItem('jwtToken');
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  return h;
}

export async function apiFetch<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { headers: getHeaders(), credentials: 'include' });
  if (res.status === 401) { window.location.href = '/'; throw new Error('auth'); }
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}
