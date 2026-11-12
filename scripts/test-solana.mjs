import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getAccount, getMint, TOKEN_PROGRAM_ID, ACCOUNT_SIZE } from '@solana/spl-token';
import { deserializeMetadata } from '@metaplex-foundation/mpl-token-metadata';
const RPC = 'http://127.0.0.1:18937';
const c = new Connection(RPC, 'confirmed');
const owner = Keypair.generate();
const p = {
  isPhantom: true, isConnected: true, publicKey: owner.publicKey,
  on() {}, async connect() {return {publicKey:this.publicKey};}, async disconnect() {this.isConnected=false;},
  async signAndSendTransaction(tx) {tx.partialSign(owner); return {signature:await c.sendRawTransaction(tx.serialize())};},
};
globalThis.window = { phantom: {solana:p} };
const source = (await readFile(new URL('../solana.js', import.meta.url),'utf8')).replace("import { rpcUrl, rpcFetch } from './solana-rpc.js';","const rpcUrl = () => '"+RPC+"', rpcFetch = undefined;").replace("'./solana-uploader.js'", "'../solana-uploader.js'");
const runtime = new URL('./test-solana-runtime.mjs',import.meta.url);
await writeFile(runtime,source);
try {
  const api = await import(runtime.href+'?'+Date.now());
  const cases = [];
  function pass(name) {cases.push(name); console.log('PASS',name);}
  assert.equal(api.parseSupply('18446744073.709551615'), api.MAX_U64);
  for(const invalid of ['18446744073.709551616','1.0000000001','-1','1e9','0','01','NaN']) assert.throws(()=>api.parseSupply(invalid));
  pass('u64 decimal parsing boundaries');
  for(const invalid of ['data:application/json,{}','javascript:alert(1)','http://example.com','https://u:p@example.com']) assert.throws(()=>api.validateUri(invalid));
  pass('metadata URI rejects unsafe schemes/credentials');
  const air = await c.requestAirdrop(owner.publicKey, 2_000_000_000);
  const latest=await c.getLatestBlockhash(); await c.confirmTransaction({...latest,signature:air});
  const params={name:'Tokin local test',symbol:'TTEST',supply:'1000.000000001',mintable:true,freezable:true,uri:'https://example.com/metadata.json'};
  const result=await api.deploy(params);
  const mintKey=new PublicKey(result.mint), ata=getAssociatedTokenAddressSync(mintKey,owner.publicKey);
  assert.ok(result.signature); let state=await api.getCoin(result.mint,owner.publicKey.toBase58());
  assert.equal(state.supply,1000000000001n);assert.equal(state.balance,state.supply);assert.equal(state.decimals,9);
  assert.equal(state.mintAuthority,owner.publicKey.toBase58());assert.equal(state.freezeAuthority,owner.publicKey.toBase58());
  pass('atomic mint + ATA + initial supply + authorities');
  const mp=new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
  const [metaKey]=PublicKey.findProgramAddressSync([Buffer.from('metadata'),mp.toBuffer(),mintKey.toBuffer()],mp);
  const info=await c.getAccountInfo(metaKey);
  const metadata=deserializeMetadata({publicKey:metaKey.toBase58(),...info,data:new Uint8Array(info.data),header:{executable:info.executable,owner:info.owner.toBase58(),lamports:{basisPoints:BigInt(info.lamports),identifier:'SOL',decimals:9}}});
  assert.equal(metadata.name.replaceAll('\0',''),params.name);assert.equal(metadata.symbol.replaceAll('\0',''),params.symbol);assert.equal(metadata.uri.replaceAll('\0',''),params.uri);assert.equal(metadata.isMutable,false);
  pass('real Metaplex metadata program writes immutable name/symbol/URI');
  await api.mint(result.mint,owner.publicKey.toBase58(),9n);await api.burn(result.mint,3n);
  assert.equal((await api.getCoin(result.mint,owner.publicKey.toBase58())).supply,1000000000007n);pass('mint and holder burn');
  await api.freeze(result.mint,ata.toBase58()); assert.equal((await getAccount(c,ata)).isFrozen,true);
  await assert.rejects(api.burn(result.mint,1n),/frozen/);
  await assert.rejects(api.revokeFreeze(result.mint),/Thaw every/);
  pass('frozen account blocks burn and irreversible freeze revocation');
  await api.thaw(result.mint,ata.toBase58());assert.equal((await getAccount(c,ata)).isFrozen,false);
  await api.revokeFreeze(result.mint);await api.revokeMint(result.mint);
  state=await api.getCoin(result.mint,owner.publicKey.toBase58());assert.equal(state.mintAuthority,null);assert.equal(state.freezeAuthority,null);
  await assert.rejects(api.mint(result.mint,owner.publicKey.toBase58(),1n),/does not hold/);
  await api.burn(result.mint,1n);pass('thaw + revoke both authorities; holder can still burn');
  const fixed=await api.deploy({...params,name:'Fixed test',symbol:'FIXED',mintable:false,freezable:false,supply:'5'});
  const fs=await getMint(c,new PublicKey(fixed.mint));assert.equal(fs.mintAuthority,null);assert.equal(fs.freezeAuthority,null);assert.equal(fs.supply,5000000000n);pass('fixed-supply atomic create revokes mint auth and has no freeze auth');
  for (const [mintable,freezable] of [[true,false],[false,true]]) {
    const combo=await api.deploy({...params,name:'Option test',symbol:'OPT',mintable,freezable,supply:'1'});
    const cs=await getMint(c,new PublicKey(combo.mint));
    assert.equal(cs.mintAuthority?.toBase58()??null,mintable?owner.publicKey.toBase58():null);
    assert.equal(cs.freezeAuthority?.toBase58()??null,freezable?owner.publicKey.toBase58():null);
  }
  pass('all four mintable/freezable combinations execute');
  const max=await api.deploy({...params,name:'u64 maximum',symbol:'MAX',supply:'18446744073.709551615'});
  assert.equal((await getMint(c,new PublicKey(max.mint))).supply,api.MAX_U64);
  await assert.rejects(api.mint(max.mint,owner.publicKey.toBase58(),1n),/exceed/);
  pass('live max-u64 mint and overflow refusal');
  const originalSend=p.signAndSendTransaction;let calls=0;
  p.signAndSendTransaction=async tx=>{calls++;return originalSend.call(p,tx);};
  const first=api.burn(result.mint,1n);await assert.rejects(api.burn(result.mint,1n),/Wait for/);await first;assert.equal(calls,1);pass('concurrent mutation mutex');
  p.signAndSendTransaction=async()=>{const error=new Error('User rejected');error.code=4001;throw error;};
  const before=(await api.getCoin(result.mint,owner.publicKey.toBase58())).supply;
  await assert.rejects(api.burn(result.mint,1n),/User rejected/);
  assert.equal((await api.getCoin(result.mint,owner.publicKey.toBase58())).supply,before);
  const rejected=await api.deploy({...params,name:'Declined',symbol:'NOPE'}).catch(e=>e);
  assert.equal(rejected.uri,params.uri);assert.equal(rejected.message,'User rejected');
  pass('wallet rejection never reports success; metadata URI reusable');
  p.signAndSendTransaction=originalSend;
  const getAccountInfo=Connection.prototype.getAccountInfo;
  Connection.prototype.getAccountInfo=async function(...args){const value=await getAccountInfo.apply(this,args);p.publicKey=Keypair.generate().publicKey;return value;};
  await assert.rejects(api.burn(result.mint,1n),/Wallet changed/);
  Connection.prototype.getAccountInfo=getAccountInfo;p.publicKey=owner.publicKey;
  pass('account change during RPC prevents signing');
  console.log(JSON.stringify({status:'PASS',network:'LOCAL ONLY',metadataProgram:mp.toBase58(),throwawayOwner:owner.publicKey.toBase58(),mints:[result.mint,fixed.mint],cases},null,2));
} finally {await unlink(runtime);}
