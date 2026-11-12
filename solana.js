import { Buffer } from 'buffer';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, MINT_SIZE, ACCOUNT_SIZE, AccountLayout, AuthorityType, getMint, getAccount, getAssociatedTokenAddressSync, createInitializeMint2Instruction, createAssociatedTokenAccountIdempotentInstruction, createMintToCheckedInstruction, createBurnCheckedInstruction, createSetAuthorityInstruction, createFreezeAccountInstruction, createThawAccountInstruction } from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey, createNoopSigner, signerIdentity } from '@metaplex-foundation/umi';
import { createMetadataAccountV3 } from '@metaplex-foundation/mpl-token-metadata';
import { toWeb3JsInstruction, toWeb3JsTransaction, fromWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters';

// Buffer must be set before Irys's lazily imported browser SDK runs.
globalThis.Buffer ??= Buffer;
const RPC = 'https://api.mainnet-beta.solana.com';
export const DECIMALS = 9;
export const MAX_U64 = (1n << 64n) - 1n;
const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const connection = new Connection(RPC, 'confirmed');
const listeners = new Set();
let hookedProvider;
let actionOwner = null;
function locked(action) { return async (...args) => {
  if (actionOwner) throw new Error('Wait for the current Solana action to finish.');
  actionOwner = wallet().publicKey.toBase58();
  try { return await action(...args); } finally { actionOwner = null; }
}; }
function provider() {
  const p = globalThis.window?.phantom?.solana;
  if (!p?.isPhantom) throw new Error('Open Phantom for Solana to continue.');
  if (p !== hookedProvider) {
    hookedProvider = p;
    p.on('accountChanged', key => listeners.forEach(cb => cb(key ? key.toBase58() : null)));
    p.on('disconnect', () => listeners.forEach(cb => cb(null)));
  }
  return p;
}
function wallet() {
  const p = provider();
  if (!p.isConnected || !p.publicKey) throw new Error('Connect your Solana wallet first.');
  if (actionOwner && p.publicKey.toBase58() !== actionOwner) throw new Error('Wallet changed during this action. Reconnect the original wallet.');
  return p;
}
export async function connect() { const r = await provider().connect(); return { address: r.publicKey.toBase58() }; }
export async function disconnect() { await provider().disconnect(); }
export function onChange(cb) { listeners.add(cb); provider(); return () => listeners.delete(cb); }
export function parseSupply(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(value)) throw new Error('Use a positive amount with at most 9 decimals.');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
  checkAmount(amount); return amount;
}
function checkAmount(amount) { if (typeof amount !== 'bigint' || amount <= 0n || amount > MAX_U64) throw new Error('Amount must fit a positive SPL u64.'); }
export function validateUri(uri) {
  if (typeof uri !== 'string' || !uri || new TextEncoder().encode(uri).length > 200) throw new Error('Metadata URL must be 1–200 bytes.');
  let url; try { url = new URL(uri); } catch { throw new Error('Use an HTTPS or ipfs metadata JSON URL.'); }
  if (!['https:', 'ipfs:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Use an HTTPS or ipfs metadata JSON URL.');
  return uri;
}
function validate(p) {
  for (const [key, max] of [['name', 32], ['symbol', 10]]) {
    if (typeof p[key] !== 'string' || !p[key].trim() || /[\x00-\x1f]/.test(p[key]) || new TextEncoder().encode(p[key]).length > max) throw new Error(`${key} must be 1–${max} UTF-8 bytes, without control characters.`);
  }
  parseSupply(p.supply);
  if (p.uri) validateUri(p.uri);
  if (p.capped || p.pausable) throw new Error('Classic SPL tokens do not support a cap or global pause.');
}
function metadataInstruction(owner, mintAddress, p, uri) {
  const umi = createUmi(RPC);
  const signer = createNoopSigner(publicKey(owner.toBase58()));
  const [metadata] = PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mintAddress.toBuffer()], METADATA_PROGRAM);
  return toWeb3JsInstruction(createMetadataAccountV3(umi, {
    metadata: publicKey(metadata.toBase58()), mint: publicKey(mintAddress.toBase58()),
    mintAuthority: signer, payer: signer, updateAuthority: signer,
    data: { name: p.name, symbol: p.symbol, uri, sellerFeeBasisPoints: 0, creators: null, collection: null, uses: null },
    isMutable: false, collectionDetails: null,
  }).getInstructions()[0]);
}
export function buildCreateInstructions(owner, mintAddress, p, uri, mintRent) {
  validate(p); validateUri(uri);
  const ata = getAssociatedTokenAddressSync(mintAddress, owner);
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
    SystemProgram.createAccount({ fromPubkey: owner, newAccountPubkey: mintAddress, lamports: mintRent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mintAddress, DECIMALS, owner, p.freezable ? owner : null),
    createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, mintAddress),
    // Metadata needs the original mint authority, so revoke only after metadata.
    metadataInstruction(owner, mintAddress, p, uri),
    createMintToCheckedInstruction(mintAddress, ata, owner, parseSupply(p.supply), DECIMALS),
  ];
  if (!p.mintable) ixs.push(createSetAuthorityInstruction(mintAddress, owner, AuthorityType.MintTokens, null));
  return ixs;
}
async function sendInstructions(ixs, signers = []) {
  const p = wallet(), owner = p.publicKey;
  const latest = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ ...latest, feePayer: owner }).add(...ixs);
  if (signers.length) tx.partialSign(...signers);
  if (!p.isConnected || !p.publicKey.equals(owner)) throw new Error('Wallet changed before signing.');
  wallet();
  const { signature } = await p.signAndSendTransaction(tx);
  // Do not retry automatically if confirmation times out: the tx may have landed.
  try {
    const result = await connection.confirmTransaction({ ...latest, signature }, 'confirmed');
    if (result.value.err) throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
  } catch (error) { error.signature = signature; throw error; }
  return signature;
}
export function storageSigner() {
  const p = wallet(), expected = p.publicKey.toBase58();
  const assertOwner = () => { if (!p.isConnected || p.publicKey?.toBase58() !== expected) throw new Error('Wallet changed before storage approval.'); wallet(); };
  return {
    publicKey: publicKey(p.publicKey.toBase58()),
    signMessage: async bytes => { assertOwner(); const r = await p.signMessage(bytes); return r.signature ?? r; },
    signTransaction: async tx => { assertOwner(); return fromWeb3JsTransaction(await p.signTransaction(toWeb3JsTransaction(tx))); },
    signAllTransactions: async txs => Promise.all(txs.map(async tx => { assertOwner(); return fromWeb3JsTransaction(await p.signTransaction(toWeb3JsTransaction(tx))); })),
  };
}
export async function estimate(params) {
  validate(params); const owner = wallet().publicKey;
  const storage = params.uri ? { lamports: 0n, fundingLamports: 0n, note: '' } : await (await import('./solana-uploader.js')).quoteStorage(params, storageSigner());
  const [mintRent, accountRent, metadataRent, latest] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(MINT_SIZE), connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE),
    connection.getMinimumBalanceForRentExemption(679), connection.getLatestBlockhash('confirmed'),
  ]);
  const tx = new Transaction({ ...latest, feePayer: owner }).add(...buildCreateInstructions(owner, Keypair.generate().publicKey, params, params.uri || 'https://gateway.irys.xyz/' + 'x'.repeat(43), mintRent));
  const fee = (await connection.getFeeForMessage(tx.compileMessage(), 'confirmed')).value;
  if (fee === null) throw new Error('RPC could not estimate the Solana network fee.');
  // Includes conservative protocol-fee reserve. Actual protocol charge may be lower.
  const protocolReserve = 10000000n;
  return { lamports: BigInt(mintRent + accountRent + metadataRent + fee) + protocolReserve + storage.fundingLamports,
    storageLamports: storage.fundingLamports, note: `Includes account rent and a conservative 0.01 SOL Metaplex fee reserve. ${storage.note || ''}`.trim() };
}
async function deployAction(params) {
  validate(params); const owner = wallet().publicKey.toBase58();
  let uri = params.uri;
  if (!uri) {
    const { uploadMetadata } = await import('./solana-uploader.js');
    uri = await uploadMetadata(params, storageSigner());
  }
  try {
    if (wallet().publicKey.toBase58() !== owner) throw new Error('Wallet changed during upload. Reconnect the original wallet.');
    params.onStep?.('Approve token creation in Phantom');
    const mintKey = Keypair.generate();
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const signature = await sendInstructions(buildCreateInstructions(new PublicKey(owner), mintKey.publicKey, params, uri, rent), [mintKey]);
    return { mint: mintKey.publicKey.toBase58(), signature, uri };
  } catch (error) { error.uri = uri; throw error; }
}
export async function getCoin(mintAddress, ownerAddress) {
  const mintKey = new PublicKey(mintAddress), owner = new PublicKey(ownerAddress);
  const state = await getMint(connection, mintKey);
  if (state.decimals !== DECIMALS) throw new Error('Only 9-decimal classic SPL tokens are supported.');
  const ata = getAssociatedTokenAddressSync(mintKey, owner);
  // getTokenAccountBalance cannot distinguish nonexistent ATA from RPC failure.
  const info = await connection.getAccountInfo(ata);
  const account = info ? await getAccount(connection, ata) : null;
  return { supply: state.supply, decimals: DECIMALS, balance: account?.amount ?? 0n, mintAuthority: state.mintAuthority?.toBase58() ?? null, freezeAuthority: state.freezeAuthority?.toBase58() ?? null };
}
async function requireAuthority(mintAddress, kind) {
  const state = await getMint(connection, new PublicKey(mintAddress));
  if (state.decimals !== DECIMALS) throw new Error('Only 9-decimal classic SPL tokens are supported.');
  if (!state[kind]?.equals(wallet().publicKey)) throw new Error(`This wallet does not hold ${kind}.`);
  return state;
}
async function mintAction(mintAddress, to, amount) {
  checkAmount(amount); const state = await requireAuthority(mintAddress, 'mintAuthority');
  if (state.supply + amount > MAX_U64) throw new Error('Mint would exceed the SPL u64 supply limit.');
  const mintKey = new PublicKey(mintAddress), owner = wallet().publicKey, recipient = new PublicKey(to);
  const ata = getAssociatedTokenAddressSync(mintKey, recipient);
  return sendInstructions([createAssociatedTokenAccountIdempotentInstruction(owner, ata, recipient, mintKey), createMintToCheckedInstruction(mintKey, ata, owner, amount, DECIMALS)]);
}
async function burnAction(mintAddress, amount) {
  checkAmount(amount); const mintKey = new PublicKey(mintAddress), owner = wallet().publicKey;
  const ata = getAssociatedTokenAddressSync(mintKey, owner);
  const [state, account] = await Promise.all([getMint(connection, mintKey), getAccount(connection, ata)]);
  if (state.decimals !== DECIMALS || account.isFrozen || account.amount < amount) throw new Error('Balance is insufficient or the account is frozen.');
  return sendInstructions([createBurnCheckedInstruction(ata, mintKey, owner, amount, DECIMALS)]);
}
async function revokeMintAction(mintAddress) {
  await requireAuthority(mintAddress, 'mintAuthority');
  return sendInstructions([createSetAuthorityInstruction(new PublicKey(mintAddress), wallet().publicKey, AuthorityType.MintTokens, null)]);
}
export function assertNoFrozenAccounts(accounts) {
  if (accounts.some(({ account }) => AccountLayout.decode(account.data).state === 2)) throw new Error('Thaw every frozen token account before permanently revoking freeze authority.');
}
async function revokeFreezeAction(mintAddress) {
  await requireAuthority(mintAddress, 'freezeAuthority');
  // Fail closed: a provider that blocks this scan cannot safely renounce.
  const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, { commitment: 'confirmed', minContextSlot: await connection.getSlot('confirmed'), filters: [{ dataSize: ACCOUNT_SIZE }, { memcmp: { offset: 0, bytes: new PublicKey(mintAddress).toBase58() } }] });
  assertNoFrozenAccounts(accounts);
  return sendInstructions([createSetAuthorityInstruction(new PublicKey(mintAddress), wallet().publicKey, AuthorityType.FreezeAccount, null)]);
}
async function setFrozen(mintAddress, accountAddress, frozen) {
  await requireAuthority(mintAddress, 'freezeAuthority');
  const mintKey = new PublicKey(mintAddress), key = new PublicKey(accountAddress);
  const account = await getAccount(connection, key);
  if (!account.mint.equals(mintKey)) throw new Error('Token account belongs to a different mint.');
  if (account.isFrozen === frozen) throw new Error(frozen ? 'Account is already frozen.' : 'Account is already thawed.');
  return sendInstructions([(frozen ? createFreezeAccountInstruction : createThawAccountInstruction)(key, mintKey, wallet().publicKey)]);
}
export const freeze = locked((mintAddress, accountAddress) => setFrozen(mintAddress, accountAddress, true));
export const thaw = locked((mintAddress, accountAddress) => setFrozen(mintAddress, accountAddress, false));

export const deploy = locked(deployAction);

export const mint = locked(mintAction);

export const burn = locked(burnAction);

export const revokeMint = locked(revokeMintAction);

export const revokeFreeze = locked(revokeFreezeAction);
