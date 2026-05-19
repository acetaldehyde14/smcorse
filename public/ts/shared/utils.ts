export function fmtTime(s: number | null | undefined): string {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(3).padStart(6, '0')}`;
}
