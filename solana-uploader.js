import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { signerIdentity, lamports } from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { Buffer } from 'buffer';
import { Connection } from '@solana/web3.js';
import { rpcUrl, rpcFetch } from './solana-rpc.js';
const GATEWAY = 'https://gateway.irys.xyz/';
const quotes = new Map();
const completed = new Map();
const imageUploads = new Map();
function json(p, image) {
  return JSON.stringify({ name: p.name, symbol: p.symbol, description: '', ...(image ? { image, properties: { files: [{ uri: image, type: p.image.type }] } } : {}) });
}
async function prepare(p, signer) {
  if (p.image && (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(p.image.type) || p.image.size > 5 * 1024 * 1024 || p.image.size === 0)) throw new Error('Image must be a PNG, JPEG, WebP or GIF, up to 5 MB.');
  const image = p.image ? new Uint8Array(await p.image.arrayBuffer()) : null;
  const fingerprint = new Uint8Array(await crypto.subtle.digest('SHA-256', image ?? new Uint8Array()));
  const key = JSON.stringify([signer.publicKey, p.name, p.symbol, p.supply, !!p.mintable, !!p.freezable, p.image?.type, Array.from(fingerprint, x => x.toString(16).padStart(2, '0')).join('')]);
  const umi = createUmi(rpcUrl()).use(signerIdentity(signer)).use(irysUploader({ address: 'https://uploader.irys.xyz', priceMultiplier: 1 }));
  return { key, image, imageType: p.image?.type, uploader: umi.uploader, metadata: new TextEncoder().encode(json(p, image ? GATEWAY + 'x'.repeat(43) : null)) };
}
function cachedUri(key) {
  let value = completed.get(key);
  try { value ||= localStorage.getItem('tokin.solana.upload.' + key); } catch { /* private mode */ }
  return typeof value === 'string' && /^https:\/\/gateway\.irys\.xyz\/[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
async function price(prepared) {
  const { uploader, image, metadata, imageType } = prepared;
  // Price each data item, not the SDK's aggregated 80KB minimum approximation.
  const irys = await uploader.irys();
  // Irys builds its own web3 Connection from the URL; replace it so reads use the same fallback fetch.
  irys.tokenConfig.providerInstance = new Connection(rpcUrl(), { commitment: 'confirmed', fetch: rpcFetch });
  // Quote serialized signed-item size, including tags and signature header.
  const size = (bytes, type) => irys.createTransaction(Buffer.from(bytes), { tags: [{ name: 'Content-Type', value: type }] }).getRaw().length;
  const values = await Promise.all([irys.getPrice(size(metadata, 'application/json')), ...(image ? [irys.getPrice(size(image, imageType))] : [])]);
  // Keep storage funding's network fee to its single ordinary signature.
  irys.tokenConfig.opts = { ...irys.tokenConfig.opts, disablePriorityFees: true };
  const raw = values.reduce((a, n) => a + BigInt(n.integerValue(0).toFixed(0)), 0n);
  const maximum = (raw * 110n + 99n) / 100n;
  const balance = (await uploader.getBalance()).basisPoints;
  const funding = maximum > balance ? maximum - balance : 0n;
  return { irys, raw, maximum, funding };
}
export async function quoteStorage(p, signer) {
  const prepared = await prepare(p, signer);
  if (cachedUri(prepared.key)) { quotes.set(prepared.key, { maximum: 0n, funding: 0n, until: Date.now() + 300000 }); return { lamports: 0n, fundingLamports: 0n, note: 'Reuses previously uploaded metadata; no new storage payment.' }; }
  const quote = await price(prepared);
  quotes.set(prepared.key, { maximum: quote.maximum, funding: quote.funding, until: Date.now() + 300000 });
  return { lamports: quote.maximum, fundingLamports: quote.funding + (quote.funding > 0n ? 5000n : 0n),
    note: `Irys L1 permanent storage quote ${quote.raw} lamports, with a 10% ceiling; new storage funding ${quote.funding} lamports plus up to 5000 lamports network fee. Storage charges are nonrefundable if token creation is cancelled.` };
}
export async function uploadMetadata(p, signer) {
  const prepared = await prepare(p, signer), existing = cachedUri(prepared.key);
  if (existing) { p.onStep?.('Reusing your uploaded metadata'); return existing; }
  const prior = quotes.get(prepared.key);
  if (!prior || Date.now() > prior.until) throw new Error('Estimate again before uploading. Storage quotes expire after 5 minutes.');
  const current = await price(prepared);
  if (current.maximum > prior.maximum || current.funding > prior.funding) throw new Error('Storage price or balance changed. Estimate again before approving storage.');
  if (current.funding > 0n) {
    const text = `Fund permanent Irys L1 storage with up to ${current.funding} lamports (${Number(current.funding) / 1e9} SOL), plus Solana network fees? This is separate from token creation and cannot be refunded if you cancel the mint.`;
    if (!globalThis.window?.confirm(text)) throw new Error('Storage funding cancelled.');
    p.onStep?.('Approve separate Irys storage funding in Phantom');
    await prepared.uploader.fund(lamports(current.funding), true);
  }
  { // wait for deposit credit before uploading (never fund twice)
    const need = current.maximum; let ok = false;
    for (let i = 0; i < 30 && !ok; i++) { ok = (await prepared.uploader.getBalance()).basisPoints >= need || current.funding === 0n; if (!ok) { p.onStep?.('Waiting for Irys to credit your deposit'); await new Promise(r => setTimeout(r, 4000)); } }
    if (!ok) throw new Error('Deposit not credited by Irys yet. Wait a minute and try again; you will not be charged twice.');
  }
  // No SDK upload()/uploadJson(): those helpers auto-fund. Raw signed uploads
  // only spend the explicit deposit already approved above.
  const upload = async (bytes, type) => {
    const tx = current.irys.createTransaction(Buffer.from(bytes), { tags: [{ name: 'Content-Type', value: type }] });
    await tx.sign();
    let result;
    try { result = await current.irys.uploader.uploadTransaction(tx); }
    catch (e) { throw new Error('Irys upload failed: ' + String(e?.message || e).slice(0, 300)); }
    const d = result?.data;
    const id = d?.id ?? d?.data?.id ?? result?.id ?? tx.id;
    const body = typeof d === 'string' ? d : JSON.stringify(d ?? null);
    if (result?.status >= 300 || !/^[A-Za-z0-9_-]{43}$/.test(id ?? '')) throw new Error('Irys upload not accepted (HTTP ' + result?.status + '): ' + String(body).slice(0, 300));
    return GATEWAY + id;
  };
  let imageUri = imageUploads.get(prepared.key);
  try { imageUri ||= localStorage.getItem('tokin.solana.image.' + prepared.key); } catch {}
  if (imageUri && !/^https:\/\/gateway\.irys\.xyz\/[A-Za-z0-9_-]{43}$/.test(imageUri)) imageUri = null;
  if (prepared.image && !imageUri) {
    p.onStep?.('Sign and upload your image to Irys L1'); imageUri = await upload(prepared.image, p.image.type);
    imageUploads.set(prepared.key, imageUri);
    try { localStorage.setItem('tokin.solana.image.' + prepared.key, imageUri); } catch {}
  }
  p.onStep?.('Sign and upload token metadata to Irys L1');
  const uri = await upload(new TextEncoder().encode(json(p, imageUri)), 'application/json');
  completed.set(prepared.key, uri);
  try { localStorage.setItem('tokin.solana.upload.' + prepared.key, uri); } catch { /* memory cache still works */ }
  return uri;
}
