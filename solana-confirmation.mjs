// Pure, injectable Solana confirmation recovery. Never sends or resends anything; reads only.
export const solscan = sig => 'https://solscan.io/tx/' + sig;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OK = new Set(['confirmed', 'finalized']);
const bounded = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('read timeout')), ms); })]).finally(() => clearTimeout(t)); };
export class TxOutcomeError extends Error {
  constructor(kind, signature, message, err) {
    super(message + ' Signature ' + signature + ' ' + solscan(signature) + '. Do not retry; check Solscan first.');
    this.name = 'TxOutcomeError'; this.kind = kind; this.signature = signature; this.link = solscan(signature); if (err !== undefined) this.chainErr = err;
  }
}
// One pass over every reader. Returns {state:'success'|'failed'|'unknown'} using only status + tx meta, never balances.
export async function lookupSignature(signature, readers, { readTimeoutMs = 8000 } = {}) {
  const getTx = r => bounded(r.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }), readTimeoutMs);
  for (const r of readers) {
    try {
      const st = (await bounded(r.getSignatureStatuses([signature], { searchTransactionHistory: true }), readTimeoutMs)).value?.[0];
      if (st && st.err !== null && st.err !== undefined) return { state: 'failed', err: st.err };
      if (st && st.err === null && OK.has(st.confirmationStatus)) {
        // Status err===null at confirmed/finalized is the documented success; meta.err wins if it disagrees.
        try { const tx = await getTx(r); if (tx?.meta && tx.meta.err !== null && tx.meta.err !== undefined) return { state: 'failed', err: tx.meta.err }; } catch { /* status proof stands */ }
        return { state: 'success' };
      }
      const tx = await getTx(r);
      if (tx?.meta && tx.meta.err === null) return { state: 'success' };
      if (tx?.meta && tx.meta.err !== undefined) return { state: 'failed', err: tx.meta.err };
    } catch { /* try next reader */ }
  }
  return { state: 'unknown' };
}
// Bounded polling for index lag.
export async function resolveSignature(signature, readers, { attempts = 6, delayMs = 2000, readTimeoutMs = 8000, wait = sleep } = {}) {
  let res = { state: 'unknown' };
  for (let i = 0; i < attempts; i++) {
    res = await lookupSignature(signature, readers, { readTimeoutMs });
    if (res.state !== 'unknown') return res;
    if (i < attempts - 1) await wait(delayMs);
  }
  return res;
}
function finish(signature, res) {
  if (res.state === 'success') return signature;
  if (res.state === 'failed') throw new TxOutcomeError('failed', signature, 'Transaction failed on chain: ' + JSON.stringify(res.err) + '.', res.err);
  throw new TxOutcomeError('unknown', signature, 'Could not confirm whether the transaction landed (it may still be pending or may have expired).');
}
// signature MUST be captured and persisted (onPending) before confirmation.
export async function confirmWithRecovery({ signature, latest, confirm, readers, onPending, onSettled, confirmTimeoutMs = 25000, ...opts }) {
  if (!signature) throw new Error('Wallet returned no signature.');
  await onPending?.(signature);
  let res;
  try {
    const r = await bounded(confirm({ ...latest, signature }, 'confirmed'), confirmTimeoutMs);
    if (r?.value?.err === null) { await onSettled?.(signature, { state: 'success' }); return signature; }
    res = r?.value && r.value.err !== undefined ? { state: 'failed', err: r.value.err } : null; // malformed response: verify by reads
  } catch { res = null; } // expiry/timeout/RPC error: fall back to exact-signature reads
  res = res || await resolveSignature(signature, readers, opts);
  if (res.state === 'failed' || res.state === 'success') await onSettled?.(signature, res);
  return finish(signature, res.state === 'failed' && !res.err ? { state: 'unknown' } : res);
}
// Resume a persisted pending signature without any new action.
export async function resumePending(signature, readers, opts) {
  const res = await resolveSignature(signature, readers, opts);
  return finish(signature, res);
}

// ---- deploy journal (one pending record per owner). storage: {get,set,remove} sync, may throw.
const jkey = o => 'tokin.solana.pending.' + o;
export function makeJournal(storage) {
  return {
    assertWritable() {
      try { const k = 'tokin.solana.probe'; storage.set(k, '1'); if (storage.get(k) !== '1') throw 0; storage.remove(k); }
      catch { throw new Error('Browser storage is unavailable, so a safe pending-deploy record cannot be kept. Enable storage and retry.'); }
    },
    get(owner) { let v; try { v = storage.get(jkey(owner)); } catch { throw new Error('Cannot read the pending deploy record. Not deploying.'); } if (!v) return null; try { const r = JSON.parse(v); if (!r?.signature) throw 0; return r; } catch { throw new Error('Pending deploy record is corrupt. Check Solscan before deploying again.'); } },
    set(owner, rec) { storage.set(jkey(owner), JSON.stringify(rec)); if (storage.get(jkey(owner)) !== JSON.stringify(rec)) throw new Error('Could not persist pending deploy.'); },
    clear(owner) { try { storage.remove(jkey(owner)); } catch { /* ignore */ } },
  };
}
export const pendingParams = p => ({ name: p.name, symbol: p.symbol, supply: String(p.supply), mintable: !!p.mintable, freezable: !!p.freezable });
// resume(sig) must throw TxOutcomeError unless proven. create(uri, onSignature) must call onSignature(sig, mint) before confirming.
export async function deployWithJournal({ owner, params, journal, resume, upload, create }) {
  journal.assertWritable();
  const rec = journal.get(owner);
  if (rec) {
    try { await resume(rec.signature); }
    catch (e) {
      if (e.kind === 'failed') journal.clear(owner);
      else if (e.kind === 'unknown') e.mint = rec.mint;
      e.uri = rec.uri; e.pending = rec; throw e;
    }
    return { confirmed: true, mint: rec.mint, signature: rec.signature, uri: rec.uri, recovered: true, recoveredParams: rec.params };
  }
  const uri = params.uri || await upload();
  const p = pendingParams(params);
  try {
    const out = await create(uri, (signature, mint) => journal.set(owner, { signature, mint, uri, params: p }));
    return { ...out, uri, confirmed: true };
  } catch (e) {
    if (e.kind === 'failed') journal.clear(owner);
    else if (e.kind === 'unknown' && !e.mint) { try { const r = journal.get(owner); if (r) { e.mint = r.mint; e.pending = r; } } catch { /* keep original error */ } }
    e.uri = uri; throw e;
  }
}

// Acknowledge only after the coin record has been durably saved by the app.
export function acknowledgeDeploy(journal, owner, signature) {
  const rec = journal.get(owner);
  if (rec?.signature === signature) journal.clear(owner);
}
