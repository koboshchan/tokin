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

const mintInput=JSON.parse(JSON.stringify(input));
mintInput.sources['contracts/TokinMintable.sol']={content:fs.readFileSync('contracts/TokinMintable.sol','utf8')};
const mintOutput=JSON.parse(solc.compile(JSON.stringify(mintInput),{import:p=>{try{return{contents:fs.readFileSync('node_modules/'+p,'utf8')}}catch{return{error:'Missing import'}}}}));
for(const e of mintOutput.errors||[]) {if(e.severity==='error'){console.error(e.formattedMessage);process.exit(1)}}
const m=mintOutput.contracts['contracts/TokinMintable.sol'].TokinMintable;
fs.writeFileSync('artifact-mintable.json',JSON.stringify({abi:m.abi,bytecode:'0x'+m.evm.bytecode.object,compiler:solc.version(),evmVersion:'shanghai'},null,2));
for(const p of Object.keys(mintOutput.sources)){if(!mintInput.sources[p]) mintInput.sources[p]={content:fs.readFileSync('node_modules/'+p,'utf8')}}
fs.writeFileSync('public/standard-input-mintable.json',JSON.stringify(mintInput,null,2));fs.copyFileSync('contracts/TokinMintable.sol','public/TokinMintable.sol');
console.log('Compiled mintable deployment bytes',m.evm.bytecode.object.length/2);
const optionInput=JSON.parse(JSON.stringify(input));
optionInput.sources['contracts/TokinOptions.sol']={content:fs.readFileSync('contracts/TokinOptions.sol','utf8')};
const optionOutput=JSON.parse(solc.compile(JSON.stringify(optionInput),{import:p=>{try{return{contents:fs.readFileSync('node_modules/'+p,'utf8')}}catch{return{error:'Missing import'}}}}));
for(const e of optionOutput.errors||[])if(e.severity==='error'){console.error(e.formattedMessage);process.exit(1)}
const o=optionOutput.contracts['contracts/TokinOptions.sol'].TokinOptions;
fs.writeFileSync('artifact-options.json',JSON.stringify({abi:o.abi,bytecode:'0x'+o.evm.bytecode.object,compiler:solc.version(),evmVersion:'shanghai'},null,2));
for(const p of Object.keys(optionOutput.sources))if(!optionInput.sources[p])optionInput.sources[p]={content:fs.readFileSync('node_modules/'+p,'utf8')};
fs.writeFileSync('public/standard-input-options.json',JSON.stringify(optionInput,null,2));fs.copyFileSync('contracts/TokinOptions.sol','public/TokinOptions.sol');
console.log('Compiled options deployment bytes',o.evm.bytecode.object.length/2);
