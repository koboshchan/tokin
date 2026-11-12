import { confirmWithRecovery, resumePending, lookupSignature, makeJournal, deployWithJournal, acknowledgeDeploy, TxOutcomeError } from '../solana-confirmation.mjs';
const ok=(c,m)=>{if(!c){console.error('FAIL '+m);process.exit(1);}console.log('PASS '+m);};
const S='SIG1', latest={blockhash:'b',lastValidBlockHeight:1}, wait=async()=>{};
const reader=(o={})=>{const calls={st:0,tx:0,send:0};return{calls,sendTransaction(){calls.send++;},
 async getSignatureStatuses(){calls.st++;if(o.throw)throw new Error('x');const v=o.seq?o.seq.shift():o.status;return{value:[v??null]};},
 async getTransaction(){calls.tx++;return o.tx??null;}};};
const expire=async()=>{throw new Error('block height exceeded');};
let r=reader({status:{confirmationStatus:'finalized',err:null},tx:{meta:{err:null}}}),pend=[];
ok(await confirmWithRecovery({signature:S,latest,confirm:expire,readers:[r],onPending:s=>pend.push(s),wait})===S&&pend[0]===S,'finalized fallback succeeds despite expiry; pending captured first');
r=reader({status:{confirmationStatus:'confirmed',err:null}});
ok(await confirmWithRecovery({signature:S,latest,confirm:expire,readers:[r],wait})===S,'confirmed fallback succeeds');
r=reader({status:{confirmationStatus:'finalized',err:null},tx:{meta:{err:{InstructionError:[0,'x']}}}});
try{await confirmWithRecovery({signature:S,latest,confirm:expire,readers:[r],wait});ok(false,'x');}catch(e){ok(e.kind==='failed','meta err fails even if status ok');}
r=reader({status:{confirmationStatus:'confirmed',err:{X:1}}});
try{await confirmWithRecovery({signature:S,latest,confirm:expire,readers:[r],wait});ok(false,'x');}catch(e){ok(e.kind==='failed','status err fails');}
r=reader({});
try{await confirmWithRecovery({signature:S,latest,confirm:expire,readers:[r],attempts:3,wait});ok(false,'x');}catch(e){ok(e.kind==='unknown'&&e.message.includes(S)&&e.message.includes('solscan.io/tx/'+S)&&r.calls.st===3,'null/expired gives safe error with sig+link, bounded');}
r=reader({seq:[null,null,{confirmationStatus:'confirmed',err:null}]});
ok(await confirmWithRecovery({signature:S,latest,confirm:expire,readers:[r],wait})===S,'index lag then success');
const bad=reader({throw:1}),good=reader({status:{confirmationStatus:'finalized',err:null}});
ok((await lookupSignature(S,[bad,good])).state==='success','falls across RPCs');
ok(await resumePending(S,[good],{wait})===S,'resume exact signature');
ok(r.calls.send===0&&good.calls.send===0,'no resend methods called');
ok(await confirmWithRecovery({signature:S,latest,confirm:async()=>({value:{err:null}}),readers:[],wait})===S,'normal path');
r=reader({status:{confirmationStatus:'finalized',err:null}});
ok(await confirmWithRecovery({signature:S,latest,confirm:async()=>({}),readers:[r],wait})===S&&r.calls.st===1,'missing response falls back to reads');
r=reader({status:{confirmationStatus:'finalized'}});
ok((await lookupSignature(S,[r])).state==='unknown','status.err undefined not proof');
r=reader({status:{confirmationStatus:'finalized'},tx:{meta:{}}});
ok((await lookupSignature(S,[r])).state==='unknown','meta.err undefined not proof');
r=reader({tx:{meta:{err:null}}});
ok((await lookupSignature(S,[r])).state==='success','meta.err null proves');
const t0=Date.now();
await confirmWithRecovery({signature:S,latest,confirm:()=>new Promise(()=>{}),readers:[good],confirmTimeoutMs:30,wait});
ok(Date.now()-t0<2000,'confirm timeout falls back');
// journal / deploy
const mem=()=>{const d={};return{d,get:k=>d[k]??null,set:(k,v)=>{d[k]=v;},remove:k=>{delete d[k];}};};
const mk=()=>{const st=mem();const j=makeJournal(st);const n={sign:0,upload:0};return{st,j,n};};
const params={name:'T',symbol:'T',supply:'1000',mintable:true,freezable:false};
const unk=()=>{throw new TxOutcomeError('unknown',S,'x');};
let {st,j,n}=mk();
const mkCreate=(n,fail)=>async(uri,onSig)=>{n.sign++;await onSig(S,'MINT1');throw fail;};
const dep=(j,n,over={})=>deployWithJournal({owner:'O',params,journal:j,upload:async()=>{n.upload++;return 'https://u';},resume:async()=>{throw new Error('should not resume');},create:mkCreate(n,new TxOutcomeError('unknown',S,'x')),...over});
try{await dep(j,n);ok(false,'x');}catch(e){ok(e.kind==='unknown'&&e.mint==='MINT1'&&e.pending.signature===S,'first unknown carries mint from journal');}
try{await dep(j,n,{resume:async()=>{throw new TxOutcomeError('unknown',S,'x');}});ok(false,'x');}catch(e){ok(e.kind==='unknown'&&e.mint==='MINT1'&&n.sign===1&&n.upload===1,'retry twice: unknown blocked, sign count 1, no re-upload');}
const j2=makeJournal(st);
const rr=await dep(j2,n,{resume:async()=>S});
ok(rr.confirmed===true&&rr.mint==='MINT1'&&rr.uri==='https://u'&&rr.recoveredParams.supply==='1000'&&rr.recoveredParams.name==='T'&&n.sign===1&&!!st.d['tokin.solana.pending.O'],'reload recovery returns supply/metadata, no new send, journal retained until save');
({st,j,n}=mk());
try{await dep(j,n);}catch{}
try{await dep(j,n,{resume:async()=>{throw new TxOutcomeError('failed',S,'x',{E:1});}});ok(false,'x');}catch(e){ok(e.kind==='failed'&&n.sign===1&&!st.d['tokin.solana.pending.O'],'chain failed clears, throws, no extra send');}
const bad2={get(){return null;},set(){throw new Error('q');},remove(){}};
let n2={sign:0,upload:0};
try{await dep(makeJournal(bad2),n2);ok(false,'x');}catch(e){ok(n2.sign===0&&n2.upload===0&&/storage/i.test(e.message),'unwritable storage fails closed before upload/send');}
({st,j,n}=mk());
const fin=await dep(j,n,{create:async(u,onSig)=>{n.sign++;await onSig(S,'M2');return{mint:'M2',signature:S};}});
ok(fin.confirmed===true&&fin.mint==='M2'&&n.sign===1&&!!st.d['tokin.solana.pending.O'],'normal deploy retains journal until app save');

acknowledgeDeploy(j,'O','different');
ok(!!st.d['tokin.solana.pending.O'],'wrong-signature acknowledgement preserves journal');
acknowledgeDeploy(j,'O',S);
ok(!st.d['tokin.solana.pending.O'],'matching acknowledgement clears after save');
