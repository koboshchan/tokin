// Split funding using the installed Irys SDK's Fund.fund/createTx/sendTx API.
// Unlike Fund.fund(), a confirmation timeout MUST NOT fall through to registration.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map();
const KEY = 'tokin.solana.pending-fund.';
const text = e => String(e?.message || e).slice(0, 300);
const fail = (message, signature) => Object.assign(new Error(message + (signature ? ' Funding signature: ' + signature + '. No SOL transaction was resent.' : '')), { signature });
function load(owner) {
  let record = pending.get(owner);
  try { record ||= JSON.parse(globalThis.localStorage?.getItem(KEY + owner) || 'null'); } catch {}
  return record;
}
function save(owner, record) {
  pending.set(owner, record);
  try { globalThis.localStorage?.setItem(KEY + owner, JSON.stringify(record)); } catch {}
}
function clear(owner) {
  pending.delete(owner);
  try { globalThis.localStorage?.removeItem(KEY + owner); } catch {}
}
export function hasPendingFunding(owner) { return !!load(owner); }

// These are READ calls only. Each Connection uses the app's timeout/fallback RPC fetch.
// Query alternate read endpoints on null, not just HTTP errors, to handle indexing lag.
export async function visibleFunding(connections, signature, finality) {
  const results = await Promise.all(connections.map(async connection => {
    const [status, tx] = await Promise.allSettled([
      connection.getSignatureStatuses([signature], { searchTransactionHistory: true }),
      connection.getTransaction(signature, { commitment: finality, maxSupportedTransactionVersion: 0 }),
    ]);
    const s = status.status === 'fulfilled' ? status.value?.value?.[0] : null;
    const t = tx.status === 'fulfilled' ? tx.value : null;
    if (s?.err || t?.meta?.err) return { error: JSON.stringify(s?.err || t.meta.err) };
    const level = s?.confirmationStatus;
    const confirmed = finality === 'finalized' ? level === 'finalized' : ['confirmed', 'finalized'].includes(level);
    return { visible: confirmed && !!t?.meta };
  }));
  const failed = results.find(r => r.error);
  if (failed) throw Object.assign(new Error('Solana funding transaction failed: ' + failed.error), { chainError: true });
  return results.some(r => r.visible);
}

export async function fundOnce({ irys, amount, owner, assertOwner, connections, onStep,
  sleep = pause, chainAttempts = 24, registerAttempts = 8, creditAttempts = 24,
  maximum, getBalance }) {
  let record = load(owner);
  assertOwner();
  if (!record) {
    if (amount <= 0n) return;
    const c = irys.tokenConfig;
    const target = await irys.utils.getBundlerAddress(irys.token);
    // No priority-fee estimate/instruction. Single ordinary funding signature only.
    c.opts = { ...c.opts, disablePriorityFees: true };
    c.config.opts = { ...c.config.opts, disablePriorityFees: true };
    const tx = await c.createTx(amount.toString(), target);
    assertOwner();
    // Persist a broadcast guard BEFORE invoking the wallet. An ambiguous send error
    // must not permit a second payment when the form is retried or the page reloads.
    record = { state: 'sending', amount: amount.toString(), target, signature: null };
    save(owner, record);
    try {
      const signature = await c.sendTx(tx.tx); // exactly one broadcast, never inside retry
      if (typeof signature !== 'string' || !signature) throw new Error('Wallet returned no funding signature.');
      record.signature = signature;
      record.state = 'pending';
      save(owner, record); // capture immediately, before any confirmation await
    } catch (e) {
      // A rejected signature cannot have broadcast; transport errors remain guarded.
      if (e?.code === 4001 || e?.code === 'ACTION_REJECTED') clear(owner);
      throw fail('Funding submission was not completed: ' + text(e) + '. Check your wallet activity before any new payment.', record.signature);
    }
  }
  const signature = record.signature;
  if (!signature) throw fail('A previous funding submission has an unknown outcome. Check your wallet activity; automatic new funding is blocked.');
  try {
    let visible = false;
    const finality = irys.tokenConfig.finality || 'finalized';
    for (let i = 0; i < chainAttempts; i++) {
      assertOwner();
      onStep?.('Waiting for Solana storage funding ' + finality + ' confirmation');
      if (await visibleFunding(connections, signature, finality)) { visible = true; break; }
      if (i + 1 < chainAttempts) await sleep(Math.min(1000 * 2 ** i, 5000));
    }
    if (!visible) throw fail('Storage funding is not yet visible at the required Solana finality. Retry to check this same transaction, not send another payment.', signature);
    let registered = false, last;
    for (let i = 0; i < registerAttempts; i++) {
      assertOwner();
      onStep?.('Registering confirmed storage funding with Irys');
      // Same request as Fund.submitFundTransaction(), but bounded single attempts:
      // its built-in retries are too short for a different RPC's finality/index lag.
      let response;
      try { response = await irys.api.post('/account/balance/' + irys.token, { tx_id: signature }, { timeout: 8000 }); }
      catch (e) { last = e; }
      if (response?.status === 202) { registered = true; break; }
      if (response) {
        const detail = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        last = new Error('Irys HTTP ' + response.status + ': ' + detail.slice(0, 300));
        if (!/not found|not yet|pending|confirm/i.test(detail) && ![408, 425, 429].includes(response.status) && response.status < 500) throw last;
      }
      if (i + 1 < registerAttempts) await sleep(Math.min(1000 * 2 ** i, 8000));
    }
    if (!registered) throw fail('Confirmed deposit is not registered by Irys yet: ' + text(last) + '. Retry to register this same signature.', signature);
    // Retain the guard through credit lag. Never let a second click top up again.
    for (let i = 0; i < creditAttempts; i++) {
      assertOwner();
      onStep?.('Waiting for Irys to credit your deposit');
      try {
        if (await getBalance() >= maximum) { clear(owner); return signature; }
      } catch { /* transient credit read, retry only reads */ }
      if (i + 1 < creditAttempts) await sleep(Math.min(1000 * 2 ** i, 5000));
    }
    throw fail('Deposit registered but Irys balance is not credited yet. Retry to check the same deposit.', signature);
  } catch (e) {
    // Even a chain error is retained for inspection, never automatically rebroadcast.
    if (!e.signature) { e.signature = signature; e.message += ' Funding signature: ' + signature + '. No SOL transaction was resent.'; }
    throw e;
  }
}
