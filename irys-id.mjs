export function parseBody(d) {
  if (typeof d !== 'string') return d;
  try { return JSON.parse(d); } catch { return d; }
}
export function acceptedId(result) {
  const d = parseBody(result?.data);
  const id = d?.id ?? parseBody(d?.data)?.id ?? result?.id;
  if (!(result?.status >= 200 && result?.status < 300) || typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error('Irys upload not accepted (HTTP ' + result?.status + '): ' + String(typeof d === 'string' ? d : JSON.stringify(d ?? null)).slice(0, 300));
  return id;
}
