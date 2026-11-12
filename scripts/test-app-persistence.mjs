import fs from "node:fs"; import vm from "node:vm"; import assert from "node:assert";
import { parseUnits } from "ethers";
const src=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const a=src.indexOf('el.confirm.addEventListener("click", ');
const b=src.indexOf("function showResult");
const body=src.slice(a,b).replace('el.confirm.addEventListener("click", ','__handler = ').replace(/\);\s*$/,";");
const B58=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIG="5".repeat(87), MINT="2V67dBRbWqmCidog9bFQBPwDWF5AMw8Ni9gePTSyrKnd";
async function run(deployImpl, storageOK=true){
  const saved=[],shown=[],acked=[];
  const mkEl=()=>({children:[],textContent:"",append(t){this.textContent+=t},setAttribute(k,v){(this.attrs??={})[k]=v},appendChild(c){this.children.push(c)}});
  const err=mkEl(), confirm=mkEl();
  const chain={kind:"sol",name:"Solana"};
  const state={busy:false,chain,solAccount:"OWNER",estimate:{v:{name:"NEW",symbol:"NEW",supply:5n*10n**9n,supplyRaw:"5",uri:"",mintable:false,pausable:false,burnable:true},account:"OWNER",chain,quote:{}}};
  const ctx={__handler:null,el:{confirm,err},state,B58,parseUnits,
    setError:m=>{err.textContent=m||"";err.children=[]},setBusy(){},isSol:()=>true,acct:()=>"OWNER",invalidate(){},
    add:(p,tag,text,attrs={})=>{const n=mkEl();n.tag=tag;n.textContent=text??"";Object.assign(n,{attrs});p.appendChild(n);return n},
    errMsg:e=>e.message,solAdapter:{deploy:deployImpl,ackDeploy:async sig=>{acked.push(sig)}},saveCoin:(c,a,r)=>{saved.push(r);return storageOK},showResult:(c,m,v)=>shown.push({m,v}),loadCoins(){}};
  vm.createContext(ctx); vm.runInContext(body,ctx);
  await ctx.__handler();
  return {saved,shown,err,acked};
}
// 1 recovered success: expired blockhash, old params differ from form
let r=await run(async()=>({mint:MINT,signature:SIG,uri:"https://irys/x",confirmed:true,recoveredParams:{name:"TKNT",symbol:"TKNT",supply:"1000",mintable:true,freezable:false}}));
assert.equal(r.saved.length,1); const s=r.saved[0];
assert.equal(s.address,MINT); assert.equal(s.name,"TKNT"); assert.equal(s.supply,parseUnits("1000",9).toString());
assert.equal(s.uri,"https://irys/x"); assert.equal(s.signature,SIG); assert.equal(s.mintable,true); assert.equal(s.burnable,true);
assert.equal(r.shown[0].v.symbol,"TKNT");
// 2 normal success
r=await run(async()=>({mint:MINT,signature:SIG,uri:"u",confirmed:true}));
assert.equal(r.saved[0].name,"NEW"); assert.equal(r.saved[0].supply,(5n*10n**9n).toString());
// 3 unconfirmed / pending: no save, link
for(const res of [{mint:MINT,signature:SIG,confirmed:false},{mint:MINT,signature:SIG}]){
  r=await run(async()=>res); assert.equal(r.saved.length,0); assert.equal(r.shown.length,0);
  const link=r.err.children[0]; assert.equal(link.attrs.href,"https://solscan.io/tx/"+SIG); assert.match(r.err.textContent,/do not deploy again/);
}
// 4 thrown unknown error with signature
r=await run(async()=>{throw Object.assign(new Error("unknown"),{signature:SIG,mint:MINT})});
assert.equal(r.saved.length,0); assert.equal(r.err.children[0].attrs.href,"https://solscan.io/tx/"+SIG); assert.match(r.err.textContent,new RegExp(MINT));
// 5 malicious signature not linked
r=await run(async()=>{throw Object.assign(new Error("x"),{signature:'"><img>'})}); assert.equal(r.err.children.length,0);
// 6 bad recovered params
r=await run(async()=>({mint:MINT,signature:SIG,confirmed:true,recoveredParams:{name:"a",symbol:"b",supply:"-1"}})); assert.equal(r.saved.length,0);
console.log("test-app-persistence: all pass");

// Fractional supplies remain valid after journal recovery.
r=await run(async()=>({mint:MINT,signature:SIG,confirmed:true,recoveredParams:{name:"fraction",symbol:"F",supply:"1.5"}})); assert.equal(r.saved[0].supply,"1500000000");

r=await run(async()=>({mint:MINT,signature:SIG,confirmed:true}),false);
assert.equal(r.acked.length,0); assert.equal(r.shown.length,0); assert.match(r.err.textContent,/storage/);
r=await run(async()=>({mint:MINT,signature:SIG,confirmed:true}));
assert.deepEqual(r.acked,[SIG]);
console.log('app durable-save acknowledgement tests pass');
