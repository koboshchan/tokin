const ganache=require('ganache');const {BrowserProvider,ContractFactory,parseUnits}=require('ethers');const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
let fork=false;try{const r=await fetch('https://mainnet.base.org',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]}),signal:AbortSignal.timeout(15000)});const j=await r.json();fork=!!j.result;}catch{}
const g=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai',chainId:8453},wallet:{totalAccounts:2},...(fork?{fork:{url:'https://mainnet.base.org'}}:{})});
try{const provider=new BrowserProvider(g);const signer=await provider.getSigner();const other=await provider.getSigner(1);const a=require('../artifact.json');const factory=new ContractFactory(a.abi,a.bytecode,signer);const logo='data:image/webp;base64,'+'A'.repeat(8100);const supply=parseUnits('1000000',18);
const c=await factory.deploy('Test Token','TEST',supply,logo);await c.waitForDeployment();assert.equal(await c.name(),'Test Token');assert.equal(await c.symbol(),'TEST');assert.equal(await c.decimals(),18n);assert.equal(await c.totalSupply(),supply);assert.equal(await c.balanceOf(await signer.getAddress()),supply);assert.equal(await c.logoURI(),logo);
await(await c.transfer(await other.getAddress(),1n)).wait();assert.equal(await c.balanceOf(await other.getAddress()),1n);
for(const args of [['','T',1n,''],['T','',1n,''],['T','T',0n,''],['T','T',1n,'x'.repeat(8193)]]){await assert.rejects(factory.getDeployTransaction(...args).then(t=>signer.estimateGas(t)));}
assert.ok(!a.abi.some(x=>x.name==='mint'||x.name==='owner'||x.name==='setLogoURI'));
const receipt=await c.deploymentTransaction().wait();const result={mode:fork?'local Base mainnet fork':'local EVM (Base RPC unavailable)',chainId:8453,realFundsSpent:0,address:await c.getAddress(),deploymentGas:receipt.gasUsed.toString(),logoBytes:Buffer.byteLength(logo),assertions:'name, symbol, 18 decimals, supply, deployer balance, logo, transfer, invalid name/ticker/zero/oversize rejected, no mint/owner/setLogo',pass:true};fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/contract-test.json',JSON.stringify(result,null,2));console.log(result);
}finally{await g.disconnect()}
})().catch(e=>{console.error(e);process.exit(1)});
