export function acceptedId(result) {
  const d = result?.data;
  const id = d?.id ?? d?.data?.id ?? result?.id;
  if (!(result?.status >= 200 && result?.status < 300) || !/^[A-Za-z0-9_-]{43}$/.test(id ?? '')) throw new Error('Irys upload not accepted (HTTP ' + result?.status + '): ' + String(typeof d === 'string' ? d : JSON.stringify(d ?? null)).slice(0, 300));
  return id;
}
