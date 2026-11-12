import assert from 'node:assert/strict';
import { fundOnce, visibleFunding, hasPendingFunding } from '../irys-funding.mjs';
let n = 0;
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
const visible = (level = 'finalized', err = null) => ({
  async getSignatureStatuses() { return { value: [{ confirmationStatus: level, err }] }; },
  async getTransaction(_, opts) { assert.equal(opts.commitment, 'finalized'); return { meta: { err } }; },
});
const invisible = { async getSignatureStatuses() { return { value: [null] }; }, async getTransaction() { return null; } };
function fixture() {
  const f = { sends: 0, creates: 0, registers: 0, reads: 0, checks: 0, steps: [], waits: [], owner: 'wallet-' + ++n };
  f.irys = {
    token: 'solana',
    tokenConfig: {
      finality: 'finalized', opts: {}, config: { opts: {} },
      async createTx(amount, to, fee) { f.creates++; assert.equal(amount, '2780'); assert.equal(to, 'bundler'); assert.equal(fee, undefined); return { tx: 'unsigned' }; },
      async sendTx(tx) { f.sends++; assert.equal(tx, 'unsigned'); return 'signature-' + f.owner; },
    },
    utils: { async getBundlerAddress(token) { assert.equal(token, 'solana'); return 'bundler'; } },
    api: { async post(path, body, opts) { f.registers++; assert.equal(path, '/account/balance/solana'); assert.equal(body.tx_id, 'signature-' + f.owner); assert.equal(opts.timeout, 8000); return { status: 202 }; } },
  };
  f.options = {
    irys: f.irys, amount: 2780n, maximum: 2780n, owner: f.owner,
    assertOwner: () => { f.checks++; }, connections: [visible()],
    getBalance: async () => 2780n, onStep: s => f.steps.push(s),
    sleep: async ms => f.waits.push(ms), chainAttempts: 3, registerAttempts: 3, creditAttempts: 3,
  };
  return f;
}
async function test(name, fn) { await fn(); console.log('PASS', name); }
await test('one broadcast captured before reads; finality/credit before release; fees disabled', async () => {
  const f = fixture();
  f.options.connections = [{ async getSignatureStatuses() { assert.ok(hasPendingFunding(f.owner)); assert.equal(f.sends, 1); assert.equal(f.registers, 0); return { value: [{ confirmationStatus: 'finalized', err: null }] }; }, getTransaction: visible().getTransaction }];
  assert.equal(await fundOnce(f.options), 'signature-' + f.owner);
  assert.equal(f.sends, 1); assert.equal(f.registers, 1); assert.equal(hasPendingFunding(f.owner), false);
  assert.equal(f.irys.tokenConfig.config.opts.disablePriorityFees, true);
});
await test('delayed RPC and finality do not register early', async () => {
  const f = fixture(); let i = 0;
  f.options.connections = [{ async getSignatureStatuses() { i++; assert.equal(f.registers, 0); return { value: [i === 1 ? null : { confirmationStatus: i === 2 ? 'confirmed' : 'finalized' }] }; }, async getTransaction() { return i >= 3 ? { meta: { err: null } } : null; } }];
  await fundOnce(f.options); assert.equal(i, 3); assert.equal(f.sends, 1); assert.deepEqual(f.waits, [1000, 2000]);
});
await test('null primary / read-error fallback uses visible alternate', async () => {
  assert.equal(await visibleFunding([invisible, { async getSignatureStatuses() { throw new Error('403'); }, async getTransaction() { throw new Error('403'); } }, visible()], 'sig', 'finalized'), true);
});
await test('confirmed status without finalized getTransaction is insufficient', async () => {
  assert.equal(await visibleFunding([visible('confirmed')], 'sig', 'finalized'), false);
  assert.equal(await visibleFunding([{ ...visible(), getTransaction: async () => null }], 'sig', 'finalized'), false);
});
await test('register not-found then HTTP503 then accepted, identical signature, no resend', async () => {
  const f = fixture(), api = f.irys.api.post; let calls = 0;
  f.irys.api.post = async (...args) => { await api(...args); return ++calls === 1 ? { status: 400, data: 'Confirmed tx not found' } : calls === 2 ? { status: 503, data: 'busy' } : { status: 202 }; };
  await fundOnce(f.options); assert.equal(f.sends, 1); assert.equal(f.registers, 3);
});
await test('transient registration network error retries only registration', async () => {
  const f = fixture(), api = f.irys.api.post;
  f.irys.api.post = async (...args) => { const response = await api(...args); if (f.registers === 1) throw new Error('Network timeout'); return response; };
  await fundOnce(f.options); assert.equal(f.registers, 2); assert.equal(f.sends, 1);
});
await test('chain timeout retains signature; retry resumes reads without create/send', async () => {
  const f = fixture(); f.options.connections = [invisible];
  await assert.rejects(fundOnce(f.options), e => !!e.signature && /not yet visible/.test(e.message));
  assert.equal(f.registers, 0); assert.ok(hasPendingFunding(f.owner));
  f.options.connections = [visible()]; await fundOnce(f.options);
  assert.equal(f.sends, 1); assert.equal(f.creates, 1);
});
await test('registration timeout retains signature across retry', async () => {
  const f = fixture(), api = f.irys.api.post;
  f.irys.api.post = async (...args) => { await api(...args); return { status: 400, data: 'Confirmed tx not found' }; };
  await assert.rejects(fundOnce(f.options), /same signature/); assert.equal(f.sends, 1);
  f.irys.api.post = api; await fundOnce(f.options); assert.equal(f.sends, 1);
});
await test('chain error stops registration and cannot trigger another payment', async () => {
  const f = fixture(); f.options.connections = [visible('finalized', { InstructionError: [0, 'InsufficientFunds'] })];
  await assert.rejects(fundOnce(f.options), /Solana funding transaction failed/);
  await assert.rejects(fundOnce(f.options), /Solana funding transaction failed/);
  assert.equal(f.registers, 0); assert.equal(f.sends, 1);
});
await test('account swap before broadcast sends nothing', async () => {
  const f = fixture(); f.options.assertOwner = () => { if (++f.checks === 2) throw new Error('Wallet changed'); };
  await assert.rejects(fundOnce(f.options), /Wallet changed/); assert.equal(f.sends, 0);
});
await test('account swap after broadcast aborts with saved signature, no register', async () => {
  const f = fixture(); f.options.assertOwner = () => { if (++f.checks === 3) throw new Error('Wallet changed'); };
  await assert.rejects(fundOnce(f.options), e => !!e.signature && /Wallet changed/.test(e.message));
  assert.equal(f.sends, 1); assert.equal(f.registers, 0); assert.ok(hasPendingFunding(f.owner));
});
await test('unknown broadcast error blocks retries instead of double paying', async () => {
  const f = fixture(); f.irys.tokenConfig.sendTx = async () => { f.sends++; throw new Error('connection reset'); };
  await assert.rejects(fundOnce(f.options), /connection reset/);
  await assert.rejects(fundOnce(f.options), /unknown outcome/);
  assert.equal(f.sends, 1); assert.equal(f.registers, 0);
});
await test('wallet explicit rejection clears unsent guard', async () => {
  const f = fixture(); f.irys.tokenConfig.sendTx = async () => { throw Object.assign(new Error('Rejected'), { code: 4001 }); };
  await assert.rejects(fundOnce(f.options), /Rejected/); assert.equal(hasPendingFunding(f.owner), false);
});
await test('Irys credit lag waits read-only and timeout retry does not fund twice', async () => {
  const f = fixture(); f.options.getBalance = async () => 0n;
  await assert.rejects(fundOnce(f.options), /not credited yet/); assert.equal(f.sends, 1);
  f.options.getBalance = async () => 2780n; await fundOnce(f.options); assert.equal(f.sends, 1);
});
await test('fatal registration response is not retried', async () => {
  const f = fixture(); f.irys.api.post = async () => { f.registers++; return { status: 400, data: 'invalid recipient' }; };
  await assert.rejects(fundOnce(f.options), /invalid recipient/); assert.equal(f.registers, 1); assert.equal(f.sends, 1);
});
await test('persisted signature from earlier page is reused, not re-sent', async () => {
  const f = fixture(); storage.set('tokin.solana.pending-fund.' + f.owner, JSON.stringify({ signature: 'signature-' + f.owner, state: 'pending' }));
  await fundOnce(f.options); assert.equal(f.creates, 0); assert.equal(f.sends, 0); assert.equal(f.registers, 1);
});
await test('no funding amount and no pending deposit sends nothing', async () => {
  const f = fixture(); f.options.amount = 0n; await fundOnce(f.options); assert.equal(f.sends, 0);
});
console.log('17 funding test groups passed; all mocked, no network or wallet spend.');
