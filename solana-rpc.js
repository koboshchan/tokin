// Solana RPC selection + safe read fallback. The public api.mainnet-beta.solana.com
// returns 403 to browser origins, so it is never used.
export const DEFAULT_RPCS = ['https://solana-rpc.publicnode.com', 'https://public.rpc.solanavibestation.com'];
const KEY = 'tokin.solana.rpc';
export function validateRpc(u) {
  let url; try { url = new URL(u); } catch { throw new Error('RPC URL is not valid.'); }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('RPC URL must use https.');
  if (url.username || url.password) throw new Error('RPC URL must not contain a password.');
  if (url.hostname === 'api.mainnet-beta.solana.com') throw new Error('That endpoint blocks browser requests. Use another RPC.');
  return url.toString().replace(/\/$/, '');
}
export function customRpc() { try { const v = localStorage.getItem(KEY); return v ? validateRpc(v) : ''; } catch { return ''; } }
export function setCustomRpc(v) { v = (v || '').trim(); try { v ? localStorage.setItem(KEY, validateRpc(v)) : localStorage.removeItem(KEY); } catch (e) { if (v) throw e; } }
export const rpcUrl = () => customRpc() || DEFAULT_RPCS[0];
// Only idempotent reads may be retried on another endpoint; sends never are.
const READ = new Set(['getLatestBlockhash', 'getMinimumBalanceForRentExemption', 'getFeeForMessage', 'getBalance', 'getAccountInfo', 'getMultipleAccounts', 'getSignatureStatuses', 'getBlockHeight', 'getSlot', 'getProgramAccounts', 'getTokenAccountBalance', 'getVersion', 'getRecentPrioritizationFees', 'getTransaction', 'isBlockhashValid', 'getEpochInfo', 'getGenesisHash']);
const bad = async r => { if ([401, 403, 408, 429].includes(r.status) || r.status >= 500) return true; try { const j = await r.clone().json(); const e = (Array.isArray(j) ? j[0] : j)?.error; return !!e && [401, 403, 408, 429, -32005, -32029, -32052].includes(e.code); } catch { return false; } };
const TIMEOUT_MS = 8000;
function attempt(url, init) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  if (init?.signal) init.signal.addEventListener('abort', () => ctl.abort(), { once: true });
  return globalThis.fetch(url, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
}
// Per-Connection fetch (no global override). Reads try the primary, then fallbacks, with a timeout each.
// Anything that is not a pure read (sendTransaction etc.) is sent once to the selected endpoint, never retried.
export async function rpcFetch(input, init) {
  const url = typeof input === 'string' ? input : input?.url;
  let methods = null; try { const b = JSON.parse(init.body); methods = (Array.isArray(b) ? b : [b]).map(x => x.method); } catch { /* not json */ }
  if (!methods || !methods.every(m => READ.has(m))) return globalThis.fetch(input, init);
  const urls = customRpc() ? [url] : [url, ...DEFAULT_RPCS.filter(u => u !== url)];
  let last;
  for (const u of urls) {
    try { const x = await attempt(u, init); if (!(await bad(x))) return x; last = x; } catch (e) { last = e; }
  }
  if (last instanceof Error) throw last;
  return last;
}
export const makeConnection = (Connection, url = rpcUrl()) => new Connection(url, { commitment: 'confirmed', fetch: rpcFetch });
