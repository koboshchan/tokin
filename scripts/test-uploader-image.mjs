import assert from 'node:assert/strict';
const st = new Map();
globalThis.localStorage = { getItem: k => st.get(k) ?? null, setItem: (k, v) => st.set(k, v), removeItem: k => st.delete(k) };
import { createServer } from 'vite';
const vite = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
const { resolveImageUri, price } = await vite.ssrLoadModule('/solana-uploader.js');
const id = 'FBEQhZaWRWQ4cz5b6MsbdLsvrBpyVmY9QXitdktcWAoJ', uri = 'https://gateway.irys.xyz/' + id;
const img = new Uint8Array([1, 2, 3, 4]), other = new Uint8Array([9, 9]);
const fetchOf = bytes => async u => { assert.equal(u, uri); return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer }; };
const search = '?recoverImage=' + id;
let n = 0;
const t = async (name, fn) => { await fn(); console.log('PASS', name); };
await t('recoverImage with matching SHA resolves and caches', async () => {
  assert.equal(await resolveImageUri('k1', img, { fetchFn: fetchOf(img), search }), uri);
  assert.equal(await resolveImageUri('k1', img, { fetchFn: () => { throw new Error('refetch'); }, search: '' }), uri);
});
await t('mismatching bytes are not trusted', async () => assert.equal(await resolveImageUri('k2', img, { fetchFn: fetchOf(other), search }), null));
await t('fetch failure / bad id / no image', async () => {
  assert.equal(await resolveImageUri('k3', img, { fetchFn: async () => { throw new Error('x'); }, search }), null);
  assert.equal(await resolveImageUri('k4', img, { fetchFn: fetchOf(img), search: '?recoverImage=short' }), null);
  assert.equal(await resolveImageUri('k5', null, { fetchFn: fetchOf(img), search }), null);
});
await t('untrusted cached URL rejected', async () => {
  st.set('tokin.solana.image.k6', 'https://evil.example/x');
  assert.equal(await resolveImageUri('k6', img, { fetchFn: fetchOf(other), search: '' }), null);
});
const mk = () => { const sizes = []; return { sizes, irys: { tokenConfig: { opts: {} }, createTransaction: (buf) => ({ getRaw: () => { sizes.push(buf.length); return new Uint8Array(buf.length + 100); } }), getPrice: async s => ({ integerValue: () => ({ toFixed: () => String(s) }) }) } }; };
const run = async imageUri => {
  const m = mk(); const meta = new Uint8Array(50), image = new Uint8Array(500);
  const q = await price({ uploader: { irys: async () => m.irys, getBalance: async () => ({ basisPoints: 0n }) }, image, imageUri, imageType: 'image/png', metadata: meta });
  return { q, sizes: m.sizes };
};
await t('resolved image excluded from price raw+maximum', async () => {
  const a = await run(uri), b = await run(null);
  assert.deepEqual(a.sizes, [50]); assert.deepEqual(b.sizes, [50, 500]);
  assert.equal(a.q.raw, 150n); assert.equal(b.q.raw, 150n + 600n);
  assert.equal(a.q.maximum, (150n * 110n + 99n) / 100n);
});
await t('non-200 / not ok response never trusted even if bytes match', async () => {
  const bad = async () => ({ ok: false, status: 404, arrayBuffer: async () => img.buffer });
  assert.equal(await resolveImageUri('k7', img, { fetchFn: bad, search }), null);
  const nonOk200 = async () => ({ ok: false, status: 200, arrayBuffer: async () => img.buffer });
  assert.equal(await resolveImageUri('k8', img, { fetchFn: nonOk200, search }), null);
});
await t('credit 6114: combined needs 9 lamports, resolved image metadata-only needs 0', async () => {
  const go = async imageUri => { const m = mk(); return price({ uploader: { irys: async () => m.irys, getBalance: async () => ({ basisPoints: 6114n }) }, image: new Uint8Array(4366), imageUri, imageType: 'image/png', metadata: new Uint8Array(1000) }); };
  const c = await go(null), r = await go(uri);
  assert.equal(c.raw, 5566n); assert.equal(c.maximum, 6123n); assert.equal(c.funding, 9n);
  assert.equal(r.raw, 1100n); assert.equal(r.funding, 0n);
});
await vite.close();
