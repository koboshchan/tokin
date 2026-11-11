const fs=require('node:fs'); const solc=require('solc');
const input={language:'Solidity',sources:{'contracts/Tokin.sol':{content:fs.readFileSync('contracts/Tokin.sol','utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>{try{return{contents:fs.readFileSync('node_modules/'+p,'utf8')}}catch{return{error:'Missing import'}}}}));
for(const e of output.errors||[]) {console.log(e.formattedMessage);if(e.severity==='error')process.exit(1)}
const c=output.contracts['contracts/Tokin.sol'].Tokin;
fs.writeFileSync('artifact.json',JSON.stringify({abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,compiler:solc.version(),evmVersion:'shanghai'},null,2));
// Include all dependencies for reproducible verification.
for(const p of Object.keys(output.sources)){if(!input.sources[p]) input.sources[p]={content:fs.readFileSync('node_modules/'+p,'utf8')}}
fs.mkdirSync('public',{recursive:true});fs.writeFileSync('public/standard-input.json',JSON.stringify(input,null,2));fs.copyFileSync('contracts/Tokin.sol','public/Tokin.sol');
console.log('Compiled',solc.version(),'deployment bytes',c.evm.bytecode.object.length/2);
