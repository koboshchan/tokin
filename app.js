import { BrowserProvider, Contract, ContractFactory, formatEther, formatUnits, getAddress, isAddress, parseUnits, ZeroAddress } from "ethers";
import optionsArtifact from "./artifact-options.json";

import { CHAINS, chainByKey, DEFAULT_CHAIN, addParams } from "./chains.js";
import * as solAdapter from "./sol-adapter.js";
import { customRpc, setCustomRpc } from "./solana-rpc.js";
const MAX_UINT = (1n << 256n) - 1n;
const MAX_URI_BYTES = 8192;
const $ = (id) => document.getElementById(id);
const el = {
  form: $("form"), name: $("name"), symbol: $("symbol"), supply: $("supply"), image: $("image"),
  preview: $("preview"), clear: $("clear-img"), err: $("form-error"), status: $("wallet-status"),
  picker: $("picker"), connect: $("connect"), est: $("estimate"), primary: $("primary"),
  confirm: $("confirm"), result: $("result"), mintable: $("mintable"), burnable: $("burnable"), pausable: $("pausable"), capped: $("capped"), capField: $("cap-field"), cap: $("cap"), coins: $("coins"), coinList: $("coin-list"), coinNote: $("coin-note"), chains: $("chains"), uri: $("uri"), uriField: $("uri-field"), imageField: $("image-field"), sub: $("sub"), foot: $("foot"), pausableLabel: $("pausable-label"), pausableHint: $("pausable-hint"), burnableBox: $("burnable-box"), solNote: $("sol-note"),
};

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
const state = { chain: chainByKey(safeGet("tokin:chain")) || chainByKey(DEFAULT_CHAIN), solAccount: null, providers: new Map(), selected: null, account: null, chainId: null, logo: "", imageFile: null, estimate: null, busy: false, revision: 0 };

function add(parent, tag, text, attrs = {}) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent.appendChild(n);
  return n;
}
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const setError = (m) => { el.err.textContent = m || ""; };
const errMsg = (e) => (e?.info?.error?.message || e?.shortMessage || e?.message || "something went wrong") + (e?.uri ? " your metadata is already uploaded and will be reused: " + e.uri : "");

/* wallets */
function register(key, provider, info) {
  if (!provider || state.providers.has(key)) return;
  state.providers.set(key, { provider, info });
  renderPicker();
}
window.addEventListener("eip6963:announceProvider", (e) => {
  const { info, provider } = e.detail || {};
  if (info?.uuid) register(info.uuid, provider, info);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
setTimeout(() => {
  if (state.providers.size) return;
  const list = [];
  if (window.phantom?.ethereum) list.push(["phantom", window.phantom.ethereum, "phantom"]);
  if (Array.isArray(window.ethereum?.providers)) window.ethereum.providers.forEach((p, i) => list.push(["inj" + i, p, "wallet " + (i + 1)]));
  else if (window.ethereum) list.push(["ethereum", window.ethereum, "browser wallet"]);
  list.forEach(([k, p, n]) => register(k, p, { name: n }));
}, 400);

function renderPicker() {
  el.picker.replaceChildren();
  const multi = !isSol() && state.providers.size > 1 && !state.selected;
  el.picker.hidden = !multi;
  el.connect.hidden = multi || !!acct();
  if (!multi) return;
  for (const [key, { info }] of state.providers) {
    const b = add(el.picker, "button", info.name || "wallet", { type: "button" });
    if (typeof info.icon === "string" && /^data:image\/(png|webp|jpeg|gif|svg\+xml);/.test(info.icon)) {
      const i = document.createElement("img"); i.alt = ""; i.src = info.icon; b.prepend(i);
    }
    b.addEventListener("click", () => connect(key));
  }
}

function renderStatus() {
  const a = acct();
  if (!a) { el.status.textContent = "no wallet connected"; return; }
  const net = isSol() ? "solana" : state.chainId === state.chain.id ? state.chain.name.toLowerCase() : "wrong network";
  el.status.textContent = short(a) + " · " + net;
}

const isSol = () => state.chain.kind === "sol";
const acct = () => (isSol() ? state.solAccount : state.account);
function invalidate() {
  state.revision++;
  state.estimate = null;
  el.est.hidden = true; el.est.replaceChildren();
  el.confirm.hidden = true;
  el.primary.hidden = false;
}

function bind(provider) {
  if (provider.__tokin) return;
  provider.__tokin = true;
  provider.on?.("accountsChanged", (a) => { if (provider !== state.selected) return; state.account = a?.[0] || null; if (!state.account) state.selected = null; invalidate(); renderStatus(); renderPicker(); loadCoins(); });
  provider.on?.("chainChanged", (c) => { if (provider !== state.selected) return; state.chainId = Number(c); invalidate(); renderStatus(); loadCoins(); });
}

async function connect(key) {
  setError("");
  try {
    if (!key) {
      if (state.providers.size === 0) throw new Error("no wallet found. install one and reload.");
      if (state.providers.size > 1) { renderPicker(); return; }
      key = [...state.providers.keys()][0];
    }
    const { provider } = state.providers.get(key);
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    state.selected = provider; state.account = accounts[0];
    state.chainId = Number(await provider.request({ method: "eth_chainId" }));
    bind(provider);
    invalidate(); renderStatus(); renderPicker(); loadCoins();
  } catch (e) { setError(errMsg(e)); }
}
async function connectSol() {
  setError("");
  try { const r = await solAdapter.connect(); state.solAccount = r.address; invalidate(); renderStatus(); renderPicker(); loadCoins(); }
  catch (e) { setError(errMsg(e)); }
}
solAdapter.onChange?.((addr) => { state.solAccount = addr || null; invalidate(); renderStatus(); renderPicker(); loadCoins(); });
el.connect.addEventListener("click", () => (isSol() ? connectSol() : connect()));

async function ensureChain(chain = state.chain) {
  const p = state.selected;
  const read = async () => Number(await p.request({ method: "eth_chainId" }));
  if ((await read()) === chain.id) { state.chainId = chain.id; return; }
  try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.hex }] }); }
  catch (e) {
    if (e?.code === 4902 || e?.data?.originalError?.code === 4902 || /unrecognized|add/i.test(e?.message || "")) {
      await p.request({ method: "wallet_addEthereumChain", params: [addParams(chain)] });
      // adding does not always switch, so switch explicitly
      if ((await read()) !== chain.id) await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.hex }] });
    } else throw e;
  }
  state.chainId = await read();
  if (state.chainId !== chain.id) throw new Error("please switch your wallet to " + chain.name.toLowerCase());
  renderStatus();
}

/* image */
const enc = new TextEncoder();
async function toLogo(file) {
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) throw new Error("choose a PNG, JPEG, WebP or GIF image");
  if (file.size > 10 * 1024 * 1024) throw new Error("choose an image under 10 MB");
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - side) / 2, sy = (bmp.height - side) / 2;
  for (const size of [128, 96, 64, 48, 32]) {
    const c = document.createElement("canvas"); c.width = c.height = size;
    c.getContext("2d").drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
    for (const [type, q] of [["image/webp", 0.8], ["image/webp", 0.5], ["image/png"]]) {
      const uri = c.toDataURL(type, q);
      if (!uri.startsWith("data:" + type)) continue;
      if (enc.encode(uri).length <= MAX_URI_BYTES) { bmp.close(); return uri; }
    }
  }
  bmp.close();
  throw new Error("image is too detailed to store on-chain. try a simpler one.");
}
function setLogo(uri, file = null) {
  state.logo = uri; state.imageFile = file; invalidate();
  el.preview.style.backgroundImage = uri ? 'url("' + uri + '")' : "";
  el.clear.hidden = !uri;
}
$("choose-img").addEventListener("click", () => el.image.click());
el.image.addEventListener("change", async () => {
  setError("");
  const f = el.image.files[0]; el.image.value = "";
  if (!f) return;
  try {
    if (isSol()) {
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(f.type)) throw new Error("choose a PNG, JPEG, WebP or GIF image");
      if (f.size > 5 * 1024 * 1024) throw new Error("choose an image under 5 MB");
      setLogo(URL.createObjectURL(f), f);
    } else setLogo(await toLogo(f));
  } catch (e) { setLogo(""); setError(e.message || "couldn't read that image"); }
});
el.clear.addEventListener("click", () => setLogo(""));

/* form */
function read() {
  const name = el.name.value.trim(), symbol = el.symbol.value.trim(), raw = el.supply.value.trim().replace(/,/g, "");
  if (!name) throw new Error("add a name");
  if (!symbol) throw new Error("add a ticker");
  if (enc.encode(name).length > 128) throw new Error("name must fit in 128 UTF-8 bytes");
  if (enc.encode(symbol).length > 16) throw new Error("ticker must fit in 16 UTF-8 bytes");
  if (!/^\d+$/.test(raw) || BigInt(raw) === 0n) throw new Error("supply must be a whole number above zero");
  const sol = isSol();
  const supply = parseUnits(raw, sol ? 9 : 18);
  if (supply > (sol ? (1n << 64n) - 1n : MAX_UINT)) throw new Error("supply is too large");
  if (sol) {
    if (enc.encode(name).length > 32) throw new Error("name must fit in 32 bytes on solana");
    if (enc.encode(symbol).length > 10) throw new Error("ticker must fit in 10 bytes on solana");
    const uri = el.uri.value.trim();
    if (uri && (!/^(https:\/\/|ipfs:\/\/)\S+$/.test(uri) || uri.length > 200)) throw new Error("metadata link must be https or ipfs (max 200 characters)");
    return { name, symbol, supply, supplyRaw: raw, uri, image: uri ? null : state.imageFile, mintable: el.mintable.checked, burnable: true, pausable: el.pausable.checked, cap: 0n, logo: "" };
  }
  const mintable = el.mintable.checked, burnable = el.burnable.checked, pausable = el.pausable.checked;
  let cap = 0n;
  if (mintable && el.capped.checked) {
    const c = el.cap.value.trim().replace(/,/g, "");
    if (!/^\d+$/.test(c) || BigInt(c) === 0n) throw new Error("cap must be a whole number above zero");
    cap = parseUnits(c, 18);
    if (cap > MAX_UINT) throw new Error("cap is too large");
    if (cap < supply) throw new Error("cap must be at least the initial supply");
  }
  return { name, symbol, supply, logo: state.logo, mintable, burnable, pausable, cap };
}
const rpcInput = $("rpc"); rpcInput.value = customRpc();
rpcInput.addEventListener("change", () => { try { setCustomRpc(rpcInput.value); rpcInput.value = customRpc(); setError(""); invalidate(); } catch (e) { rpcInput.value = customRpc(); setError(e.message); } });
for (const i of [el.name, el.symbol, el.supply, el.uri]) i.addEventListener("input", () => { setError(""); invalidate(); });

function syncCap() {
  const on = el.mintable.checked;
  el.capped.disabled = !on;
  if (!on) el.capped.checked = false;
  el.capField.hidden = !(on && el.capped.checked);
}
for (const t of [el.mintable, el.burnable, el.pausable, el.capped]) t.addEventListener("change", () => { syncCap(); setError(""); invalidate(); });
el.cap.addEventListener("input", () => { setError(""); invalidate(); });
syncCap();

function setBusy(b, label) {
  state.busy = b; el.primary.disabled = b; el.confirm.disabled = b;
  if (label) (el.confirm.hidden ? el.primary : el.confirm).textContent = label;
}

function factoryFor(signer, v) {
  return { factory: new ContractFactory(optionsArtifact.abi, optionsArtifact.bytecode, signer), args: [v.name, v.symbol, v.supply, v.logo, v.mintable, v.burnable, v.pausable, v.cap] };
}

const trimNum = (n, d) => { const s = Number(n).toFixed(d); return s.replace(/\.?0+$/, "") || "0"; };

el.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy) return;
  setError("");
  const chain = state.chain; // captured so a mid-flight chain change can't mix results
  try {
    const v = read();
    if (!acct()) { await (isSol() ? connectSol() : connect()); if (!acct()) return; }
    if (chain !== state.chain) return;
    setBusy(true, "estimating…");
    if (chain.kind === "sol") {
      const revision = state.revision;
      const est = await solAdapter.estimate({ name: v.name, symbol: v.symbol, supply: v.supplyRaw, uri: v.uri || undefined, image: v.image || undefined, mintable: v.mintable, freezable: v.pausable, onStep: (t) => { if (el.confirm.disabled) el.confirm.textContent = t; } });
      if (revision !== state.revision || chain !== state.chain) throw new Error("details changed. estimate again.");
      state.estimate = { v, chain, account: state.solAccount, lamports: est.lamports, quote: est.quote };
      showEstimateSol(est);
    } else {
      const before = JSON.stringify([el.name.value, el.symbol.value, el.supply.value, el.mintable.checked, el.capped.checked, el.cap.value, el.burnable.checked, el.pausable.checked, state.logo]);
      const acctBefore = state.account, selBefore = state.selected;
      await ensureChain(chain);
      // switching fires chainChanged which invalidates; capture the revision only after the switch settles
      const revision = state.revision;
      const after = JSON.stringify([el.name.value, el.symbol.value, el.supply.value, el.mintable.checked, el.capped.checked, el.cap.value, el.burnable.checked, el.pausable.checked, state.logo]);
      if (chain !== state.chain || before !== after || acctBefore !== state.account || selBefore !== state.selected || state.chainId !== chain.id) throw new Error("details changed while switching network. estimate again.");
      const signer = await new BrowserProvider(state.selected).getSigner();
      const { factory, args } = factoryFor(signer, v);
      const tx = await factory.getDeployTransaction(...args);
      const [gas, fee] = await Promise.all([signer.estimateGas(tx), signer.provider.getFeeData()]);
      const price = fee.maxFeePerGas ?? fee.gasPrice;
      if (!price) throw new Error("couldn't read network fees");
      if (revision !== state.revision || chain !== state.chain) throw new Error("details changed. estimate again.");
      const cost = gas * price;
      state.estimate = { v, chain, gas, cost, account: state.account };
      showEstimate(chain, gas, price, cost);
    }
    el.primary.hidden = true; el.confirm.hidden = false;
  } catch (err) { setError(errMsg(err)); }
  finally { setBusy(false); el.primary.textContent = "estimate cost"; el.confirm.textContent = "confirm and deploy"; }
});

function showEstimate(chain, gas, price, cost) {
  el.est.replaceChildren();
  const dl = add(el.est, "dl");
  const row = (k, v) => { add(dl, "dt", k); add(dl, "dd", v); };
  row("gas", gas.toLocaleString());
  row("gas price", trimNum(formatUnits(price, "gwei"), 4) + " gwei");
  row("estimate", "~" + Number(formatEther(cost)).toFixed(6) + " " + chain.symbol.toLowerCase());
  if (chain.l1Note) add(el.est, "p", chain.l1Note);
  el.est.hidden = false;
}
function showEstimateSol(est) {
  el.est.replaceChildren();
  const dl = add(el.est, "dl");
  add(dl, "dt", "estimate"); add(dl, "dd", "~" + (Number(est.lamports) / 1e9).toFixed(6) + " sol");
  if (est.storageLamports) { add(dl, "dt", "image storage"); add(dl, "dd", "~" + (Number(est.storageLamports) / 1e9).toFixed(6) + " sol"); }
  if (!state.estimate?.v?.uri) add(el.est, "p", "your image and details are uploaded to irys storage, paid from your wallet in sol. this happens before the token is created, so if you decline the final step the storage fee is not refunded.");
  if (est.note) add(el.est, "p", est.note);
  el.est.hidden = false;
}

el.confirm.addEventListener("click", async () => {
  if (state.busy || !state.estimate) return;
  setError("");
  const { v, account, chain } = state.estimate;
  try {
    if (chain !== state.chain || account !== acct()) { invalidate(); throw new Error("wallet or network changed. estimate again."); }
    setBusy(true, "confirm in your wallet…");
    if (chain.kind === "sol") {
      const r = await solAdapter.deploy({ quote: state.estimate.quote, name: v.name, symbol: v.symbol, supply: v.supplyRaw, uri: v.uri || undefined, image: v.image || undefined, mintable: v.mintable, freezable: v.pausable, onStep: (t) => { if (el.confirm.disabled) el.confirm.textContent = t; } });
      if (!r?.mint || !r.signature || r.confirmed === false || r.pending) { const e = new Error("the network hasn't confirmed this token yet. check the transaction before trying again."); e.signature = r?.signature; throw e; }
      saveCoin(chain, account, { address: r.mint, name: v.name, symbol: v.symbol, supply: v.supply.toString(), mintable: v.mintable, burnable: true, pausable: v.pausable, cap: "0", logo: "", uri: r.uri || v.uri || "", signature: r.signature, ts: Date.now() });
      showResult(chain, r.mint, v);
      if (chain === state.chain && account === acct()) loadCoins();
      return;
    }
    const activeChain = Number(await state.selected.request({ method: "eth_chainId" }));
    const activeAccounts = await state.selected.request({ method: "eth_accounts" });
    if (activeChain !== chain.id || activeAccounts[0]?.toLowerCase() !== account.toLowerCase()) { invalidate(); throw new Error("wallet changed. estimate again."); }
    const signer = await new BrowserProvider(state.selected).getSigner();
    const { factory, args } = factoryFor(signer, v);
    const contract = await factory.deploy(...args);
    el.confirm.textContent = "deploying…";
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    saveCoin(chain, account, { address, name: v.name, symbol: v.symbol, supply: v.supply.toString(), mintable: v.mintable, burnable: v.burnable, pausable: v.pausable, cap: v.cap.toString(), logo: v.logo, ts: Date.now() });
    showResult(chain, address, v);
    if (chain === state.chain && account === state.account) loadCoins();
  } catch (err) {
    setError(errMsg(err));
    if (chain.kind === "sol" && typeof err?.signature === "string" && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(err.signature)) {
      el.err.append(" transaction: ");
      add(el.err, "a", err.signature.slice(0, 8) + "…", { href: "https://solscan.io/tx/" + err.signature, target: "_blank", rel: "noopener noreferrer" });
      if (typeof err.mint === "string" && B58.test(err.mint)) el.err.append(" · mint " + err.mint);
      el.err.append(". do not deploy again until you've checked it.");
    }
  }
  finally { setBusy(false); el.confirm.textContent = "confirm and deploy"; }
});

function showResult(chain, address, v) {
  invalidate();
  el.result.replaceChildren();
  add(el.result, "h2", v.symbol + " is live on " + chain.name.toLowerCase());
  if (v.mintable || v.pausable || v.burnable) add(el.result, "p", "controls for this coin are in your coins below.");
  add(el.result, "code", address);
  const p = add(el.result, "p");
  add(p, "a", "view on " + chain.explorerName, { href: tokenUrl(chain, address), target: "_blank", rel: "noopener noreferrer" });
  if (chain.kind === "evm") {
    const w = add(el.result, "p");
    const btn = add(w, "button", "add to wallet", { type: "button", class: "secondary" });
    btn.addEventListener("click", async () => {
      try {
        const options = { address, symbol: v.symbol, decimals: 18 };
        if (v.logo) options.image = v.logo;
        await ensureChain(chain);
        await state.selected.request({ method: "wallet_watchAsset", params: { type: "ERC20", options } });
      } catch (e) { setError(errMsg(e)); }
    });
    if (chain.listingUrl) {
      const n = add(el.result, "p", chain.explorerName + "'s public logo and listing is separate and off-chain. submit it at ");
      add(n, "a", chain.listingUrl.replace("https://", ""), { href: chain.listingUrl, target: "_blank", rel: "noopener noreferrer" });
      n.append(".");
    }
  } else add(el.result, "p", "your wallet shows the name and image from the metadata link once it loads.");
  el.result.hidden = false;
  el.result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
const tokenUrl = (chain, address) => chain.explorer + (chain.kind === "sol" ? "/token/" : "/token/") + address + chain.explorerSuffix;


/* your coins */
const TOKEN_ABI = [
  "function name() view returns (string)", "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)",
  "function owner() view returns (address)", "function mint(address to, uint256 amount)",
  "function renounceOwnership()", "function burn(uint256 amount)", "function pause()", "function unpause()", "function paused() view returns (bool)",
  "function mintable() view returns (bool)", "function burnable() view returns (bool)", "function pausable() view returns (bool)", "function supplyCap() view returns (uint256)",
];
const storeKey = (chain, acct) => "tokin:v1:" + chain.id + ":" + (chain.kind === "sol" ? acct : acct.toLowerCase());
function validRecord(r) {
  return r && typeof r === "object" && typeof r.address === "string" && isAddress(r.address)
    && typeof r.name === "string" && r.name.length <= 128 && typeof r.symbol === "string" && r.symbol.length <= 16
    && typeof r.supply === "string" && /^\d{1,78}$/.test(r.supply) && typeof r.mintable === "boolean"
    && (r.burnable === undefined || typeof r.burnable === "boolean") && (r.pausable === undefined || typeof r.pausable === "boolean")
    && (r.cap === undefined || (typeof r.cap === "string" && /^\d{1,78}$/.test(r.cap)));
}
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const normAddr = (chain, x) => (chain.kind === "sol" ? x : getAddress(x));
function validSolRecord(r) {
  return r && typeof r === "object" && typeof r.address === "string" && B58.test(r.address)
    && typeof r.name === "string" && r.name.length <= 64 && typeof r.symbol === "string" && r.symbol.length <= 16
    && typeof r.supply === "string" && /^\d{1,40}$/.test(r.supply) && typeof r.mintable === "boolean";
}
function loadRecords(chain, acct) {
  try {
    const arr = JSON.parse(safeGet(storeKey(chain, acct)) || "[]");
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    return arr.filter(chain.kind === "sol" ? validSolRecord : validRecord).map((r) => ({ ...r, address: normAddr(chain, r.address) }))
      .filter((r) => !seen.has(r.address) && seen.add(r.address));
  } catch { return []; }
}
function saveCoin(chain, acct, rec) {
  try {
    const list = loadRecords(chain, acct).filter((r) => r.address !== normAddr(chain, rec.address));
    list.unshift({ ...rec, address: normAddr(chain, rec.address) });
    localStorage.setItem(storeKey(chain, acct), JSON.stringify(list.slice(0, 100)));
  } catch { /* storage unavailable */ }
}
const fmt = (n) => { const s = formatUnits(n, 18); const [i, f = ""] = s.split("."); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f !== "0" && f ? "." + f.slice(0, 4) : ""); };

let coinGen = 0;
async function activeCtx(account, chainObj) {
  // confirm the wallet still matches the context this view was built for
  const p = state.selected;
  if (chainObj !== state.chain) throw new Error("network changed. reload your coins.");
  if (!p || !account || account !== state.account) throw new Error("wallet changed. reload your coins.");
  const chain = Number(await p.request({ method: "eth_chainId" }));
  const accts = await p.request({ method: "eth_accounts" });
  if (chain !== chainObj.id || accts[0]?.toLowerCase() !== account.toLowerCase()) throw new Error("wallet changed or not on " + chainObj.name.toLowerCase() + ".");
  return await new BrowserProvider(p).getSigner();
}

async function loadCoins() {
  const gen = ++coinGen;
  el.coinList.replaceChildren();
  const chain = state.chain;
  const account = acct();
  if (!account) { el.coins.hidden = true; return; }
  const recs = loadRecords(chain, account);
  el.coins.hidden = false;
  el.coinNote.replaceChildren();
  if (!recs.length) { el.coinNote.textContent = "nothing yet. coins you deploy from this wallet on " + chain.name.toLowerCase() + " appear here."; return; }
  if (chain.kind === "evm" && state.chainId !== chain.id) {
    el.coinNote.append("switch to " + chain.name.toLowerCase() + " to see your coins. ");
    const b = add(el.coinNote, "button", "switch", { type: "button", class: "link" });
    b.addEventListener("click", async () => { try { await ensureChain(chain); loadCoins(); } catch (e) { setError(errMsg(e)); } });
    return;
  }
  const provider = chain.kind === "evm" ? new BrowserProvider(state.selected) : null;
  for (const rec of recs) {
    const card = add(el.coinList, "article", null, { class: "coin" });
    (chain.kind === "sol" ? renderSolCoin : renderCoin)(card, rec, account, provider, gen, chain);
  }
}

const tryCall = async (fn) => { try { return await fn(); } catch { return null; } };

async function renderCoin(card, rec, account, provider, gen, chain) {
  const stale = () => gen !== coinGen || chain !== state.chain || account !== state.account || state.chainId !== chain.id;
  const head = add(card, "div", null, { class: "coin-head" });
  if (typeof rec.logo === "string" && /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(rec.logo) && rec.logo.length <= 12000) {
    const i = add(head, "img", null, { alt: "", class: "coin-logo" }); i.src = rec.logo;
  }
  add(head, "strong", rec.symbol);
  add(head, "span", rec.name, { class: "muted" });
  add(card, "a", short(rec.address), { href: tokenUrl(chain, rec.address), target: "_blank", rel: "noopener noreferrer", class: "coin-addr" });
  const badges = add(card, "div", null, { class: "badges" });
  const dl = add(card, "dl", null, { class: "coin-stats" });
  const row = (k, v) => { add(dl, "dt", k); return add(dl, "dd", v); };
  const sup = row("supply", "…"), bal = row("your balance", "…");
  const c = new Contract(rec.address, TOKEN_ABI, provider);
  let balance = 0n;
  try {
    const code = await provider.getCode(rec.address);
    if (stale()) return;
    if (code === "0x") { sup.textContent = bal.textContent = "—"; add(card, "p", "no contract found at this address on " + chain.name.toLowerCase() + ".", { class: "muted small" }); return; }
    const [ts, b] = await Promise.all([c.totalSupply(), c.balanceOf(account)]);
    if (stale()) return;
    balance = b; sup.textContent = fmt(ts); bal.textContent = fmt(b);
  } catch { if (!stale()) { sup.textContent = bal.textContent = "—"; } }
  // detect real features on chain; fall back to the saved record for older deployments
  const [gm, gb, gp, gc] = await Promise.all([tryCall(() => c.mintable()), tryCall(() => c.burnable()), tryCall(() => c.pausable()), tryCall(() => c.supplyCap())]);
  if (stale()) return;
  const detected = gm !== null || gb !== null || gp !== null;
  const f = detected
    ? { mintable: gm === true, burnable: gb === true, pausable: gp === true, cap: typeof gc === "bigint" ? gc : 0n }
    : { mintable: !!rec.mintable, burnable: false, pausable: false, cap: 0n };
  const owner = await tryCall(() => c.owner());
  const paused = f.pausable ? await tryCall(() => c.paused()) : null;
  if (stale()) return;
  const badge = (t, cls) => add(badges, "span", t, { class: "badge" + (cls ? " " + cls : "") });
  if (!f.mintable && !f.burnable && !f.pausable) badge("fixed supply");
  if (f.mintable) badge("mintable");
  if (f.cap > 0n) badge("cap " + fmt(f.cap));
  if (f.burnable) badge("burnable");
  if (f.pausable) badge(paused ? "paused" : "pausable", paused ? "warn" : "");
  const isOwner = owner && owner !== ZeroAddress && owner.toLowerCase() === account.toLowerCase();
  if ((f.mintable || f.pausable) && owner === ZeroAddress) add(card, "p", "ownership renounced. mint and pause are permanently locked.", { class: "muted small" });
  else if ((f.mintable || f.pausable) && owner && !isOwner) add(card, "p", "owned by " + short(owner), { class: "muted small" });
  const refresh = () => { card.replaceChildren(); return renderCoin(card, rec, account, provider, gen, chain); };
  if (isOwner || (f.burnable && balance > 0n)) controls(card, rec, account, gen, refresh, { f, isOwner, paused, balance }, chain);
}

function controls(card, rec, account, gen, refresh, { f, isOwner, paused, balance }, chain) {
  const wrap = add(card, "div", null, { class: "mint" });
  const msg = add(wrap, "p", null, { class: "error", role: "alert" });
  const btns = [];
  const run = async (fn, recheck) => {
    msg.textContent = ""; btns.forEach((b) => (b.disabled = true));
    try {
      if (gen !== coinGen || chain !== state.chain) throw new Error("wallet or network changed. reload your coins.");
      const signer = await activeCtx(account, chain);
      const tc = new Contract(rec.address, TOKEN_ABI, signer);
      if (recheck) {
        if ((await tc.owner()).toLowerCase() !== account.toLowerCase()) throw new Error("you are not the owner anymore.");
        if (recheck === "unpaused" && (await tc.paused())) throw new Error("coin is paused. unpause before renouncing.");
      }
      const tx = await fn(tc);
      msg.textContent = "waiting for confirmation…";
      await tx.wait();
      if (gen === coinGen && chain === state.chain && account === state.account) await refresh();
    } catch (e) { msg.textContent = errMsg(e); btns.forEach((b) => (b.disabled = false)); }
  };
  const amountField = (form, label) => {
    const i = add(form, "input", null, { type: "text", inputmode: "decimal", placeholder: "amount", "aria-label": label });
    return () => {
      const raw = i.value.trim().replace(/,/g, "");
      if (!/^\d+(\.\d{1,18})?$/.test(raw)) throw new Error("enter a positive amount");
      const v = parseUnits(raw, 18);
      if (v <= 0n || v > MAX_UINT) throw new Error("amount is out of range");
      return v;
    };
  };
  if (isOwner && f.mintable) {
    const form = add(wrap, "form", null, { novalidate: "", class: "sub-form" });
    add(form, "span", "mint", { class: "muted small" });
    const to = add(form, "input", null, { type: "text", placeholder: "recipient", value: account, "aria-label": "recipient", spellcheck: "false" });
    const getAmt = amountField(form, "amount to mint");
    const go = add(form, "button", "mint", { type: "submit", class: "primary small-btn" }); btns.push(go);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      let r, v;
      try {
        r = to.value.trim() || account;
        if (!isAddress(r)) throw new Error("enter a valid recipient address");
        r = getAddress(r); v = getAmt();
        if (f.cap > 0n) {
          // best effort; the contract enforces the cap
        }
      } catch (err) { msg.textContent = err.message; return; }
      run(async (tc) => {
        const currentSupply = await tc.totalSupply();
        if (f.cap > 0n && currentSupply + v > f.cap) throw new Error("mint would exceed the supply cap");
        return tc.mint(r, v);
      }, true);
    });
  }
  if (f.burnable && balance > 0n) {
    const form = add(wrap, "form", null, { novalidate: "", class: "sub-form" });
    add(form, "span", "burn from your balance", { class: "muted small" });
    const getAmt = amountField(form, "amount to burn");
    const go = add(form, "button", "burn", { type: "submit", class: "primary small-btn" }); btns.push(go);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      let v;
      try { v = getAmt(); if (v > balance) throw new Error("that's more than your balance"); } catch (err) { msg.textContent = err.message; return; }
      if (!window.confirm("burn " + fmt(v) + " " + rec.symbol + "? this permanently destroys them.")) return;
      run((tc) => tc.burn(v), false);
    });
  }
  if (isOwner) {
    const row = add(wrap, "div", null, { class: "mint-row" });
    if (f.pausable) {
      const pb = add(row, "button", paused ? "unpause" : "pause", { type: "button", class: "secondary" }); btns.push(pb);
      pb.addEventListener("click", () => {
        if (!paused && !window.confirm("pause " + rec.symbol + "? all transfers, mints and burns stop until you unpause.")) return;
        run((tc) => (paused ? tc.unpause() : tc.pause()), true);
      });
    }
    const ren = add(row, "button", "renounce ownership", { type: "button", class: "secondary danger" }); btns.push(ren);
    if (f.pausable && paused) {
      ren.disabled = true; ren.title = "unpause first";
      btns.splice(btns.indexOf(ren), 1);
      add(wrap, "p", "unpause before renouncing. renouncing while paused would freeze transfers forever.", { class: "muted small" });
    }
    ren.addEventListener("click", () => {
      const lost = [f.mintable && "mint more", f.pausable && "pause or unpause"].filter(Boolean).join(" or ");
      if (!window.confirm("renounce ownership of " + rec.symbol + "?\n\nthis is irreversible. nobody will ever be able to " + lost + ".")) return;
      run((tc) => tc.renounceOwnership(), f.pausable ? "unpaused" : true);
    });
  }
}


/* solana coins */
const fmt9 = (n) => { const s = formatUnits(n, 9); const [i, f = ""] = s.split("."); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f !== "0" && f ? "." + f.slice(0, 4) : ""); };
async function renderSolCoin(card, rec, account, _p, gen, chain) {
  const stale = () => gen !== coinGen || chain !== state.chain || account !== state.solAccount;
  const head = add(card, "div", null, { class: "coin-head" });
  add(head, "strong", rec.symbol);
  add(head, "span", rec.name, { class: "muted" });
  add(card, "a", short(rec.address), { href: tokenUrl(chain, rec.address), target: "_blank", rel: "noopener noreferrer", class: "coin-addr" });
  const badges = add(card, "div", null, { class: "badges" });
  const dl = add(card, "dl", null, { class: "coin-stats" });
  const row = (k, v) => { add(dl, "dt", k); return add(dl, "dd", v); };
  const sup = row("supply", "…"), bal = row("your balance", "…");
  let info;
  try { info = await solAdapter.getCoin(rec.address, account); } catch { if (!stale()) sup.textContent = bal.textContent = "—"; return; }
  if (stale()) return;
  sup.textContent = fmt9(info.supply); bal.textContent = fmt9(info.balance);
  const badge = (t, cls) => add(badges, "span", t, { class: "badge" + (cls ? " " + cls : "") });
  badge(info.mintAuthority ? "mintable" : "fixed supply"); badge("burnable");
  if (info.freezeAuthority) badge("freezable");
  const isMint = info.mintAuthority === account, isFreeze = info.freezeAuthority === account;
  if (info.mintAuthority && !isMint) add(card, "p", "mint authority " + short(info.mintAuthority), { class: "muted small" });
  const refresh = () => { card.replaceChildren(); return renderSolCoin(card, rec, account, null, gen, chain); };
  const wrap = add(card, "div", null, { class: "mint" });
  const msg = add(wrap, "p", null, { class: "error", role: "alert" });
  const btns = [];
  const run = async (fn) => {
    msg.textContent = ""; btns.forEach((b) => (b.disabled = true));
    try {
      if (stale()) throw new Error("wallet or network changed. reload your coins.");
      await fn();
      if (!stale()) await refresh();
    } catch (e) { msg.textContent = errMsg(e); btns.forEach((b) => (b.disabled = false)); }
  };
  const amt = (i) => { const raw = i.value.trim().replace(/,/g, ""); if (!/^\d+(\.\d{1,9})?$/.test(raw)) throw new Error("enter a positive amount"); const v = parseUnits(raw, 9); if (v <= 0n) throw new Error("enter a positive amount"); return v; };
  if (isMint) {
    const form = add(wrap, "form", null, { novalidate: "", class: "sub-form" });
    add(form, "span", "mint", { class: "muted small" });
    const to = add(form, "input", null, { type: "text", placeholder: "recipient", value: account, "aria-label": "recipient", spellcheck: "false" });
    const i = add(form, "input", null, { type: "text", inputmode: "decimal", placeholder: "amount", "aria-label": "amount to mint" });
    const go = add(form, "button", "mint", { type: "submit", class: "primary small-btn" }); btns.push(go);
    form.addEventListener("submit", (e) => { e.preventDefault(); let v, r; try { r = to.value.trim() || account; if (!B58.test(r)) throw new Error("enter a valid recipient address"); v = amt(i); } catch (x) { msg.textContent = x.message; return; } run(() => solAdapter.mint(rec.address, r, v)); });
  }
  if (info.balance > 0n) {
    const form = add(wrap, "form", null, { novalidate: "", class: "sub-form" });
    add(form, "span", "burn from your balance", { class: "muted small" });
    const i = add(form, "input", null, { type: "text", inputmode: "decimal", placeholder: "amount", "aria-label": "amount to burn" });
    const go = add(form, "button", "burn", { type: "submit", class: "primary small-btn" }); btns.push(go);
    form.addEventListener("submit", (e) => { e.preventDefault(); let v; try { v = amt(i); if (v > info.balance) throw new Error("that's more than your balance"); } catch (x) { msg.textContent = x.message; return; } if (!window.confirm("burn " + fmt9(v) + " " + rec.symbol + "? this permanently destroys them.")) return; run(() => solAdapter.burn(rec.address, v)); });
  }
  if (isFreeze) {
    const form = add(wrap, "form", null, { novalidate: "", class: "sub-form" });
    add(form, "span", "freeze or thaw one token account. this only affects that account, not everyone.", { class: "muted small" });
    const ta = add(form, "input", null, { type: "text", placeholder: "token account address", "aria-label": "token account", spellcheck: "false" });
    const get = () => { const t = ta.value.trim(); if (!B58.test(t)) throw new Error("enter a valid token account address"); return t; };
    const fb = add(form, "button", "freeze", { type: "button", class: "secondary" }); btns.push(fb);
    const tb = add(form, "button", "thaw", { type: "button", class: "secondary" }); btns.push(tb);
    fb.addEventListener("click", () => { let t; try { t = get(); } catch (x) { msg.textContent = x.message; return; } if (!window.confirm("freeze this token account? its owner can't move or receive " + rec.symbol + " until you thaw it.")) return; run(() => solAdapter.freeze(rec.address, t)); });
    tb.addEventListener("click", () => { let t; try { t = get(); } catch (x) { msg.textContent = x.message; return; } run(() => solAdapter.thaw(rec.address, t)); });
    form.addEventListener("submit", (e) => e.preventDefault());
  }
  if (isMint || isFreeze) {
    const r = add(wrap, "div", null, { class: "mint-row" });
    if (isMint) { const b = add(r, "button", "revoke mint", { type: "button", class: "secondary danger" }); btns.push(b);
      b.addEventListener("click", () => { if (!window.confirm("revoke mint authority of " + rec.symbol + "?\n\nirreversible. nobody can ever mint more.")) return; run(() => solAdapter.revokeMint(rec.address)); }); }
    if (isFreeze) { const b = add(r, "button", "revoke freeze", { type: "button", class: "secondary danger" }); btns.push(b);
      b.addEventListener("click", () => { if (!window.confirm("revoke freeze authority of " + rec.symbol + "?\n\nirreversible. nobody can ever freeze or thaw accounts. refused if any account is still frozen.")) return; run(() => solAdapter.revokeFreeze(rec.address)); }); }
  }
}

/* chain picker */
function renderChains() {
  el.chains.replaceChildren();
  for (const c of CHAINS) {
    const b = add(el.chains, "button", c.name.toLowerCase(), { type: "button", role: "radio", "aria-checked": String(c === state.chain), tabindex: c === state.chain ? "0" : "-1" });
    b.addEventListener("click", () => setChain(c));
    b.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      setChain(CHAINS[(CHAINS.indexOf(c) + d + CHAINS.length) % CHAINS.length]);
      el.chains.querySelector('[aria-checked="true"]')?.focus();
    });
  }
}
function applyChain() {
  const sol = isSol();
  el.sub.textContent = "make a token on " + state.chain.name.toLowerCase() + ".";
  el.uriField.hidden = !sol; if (state.logo.startsWith("blob:") !== sol) setLogo("", null); el.solNote.hidden = !sol;
  el.pausableLabel.textContent = sol ? "freezable" : "pausable";
  el.pausableHint.textContent = sol ? "freeze single accounts, not a global pause" : "owner can freeze transfers";
  el.burnableBox.hidden = sol;
  if (sol) { el.capped.checked = false; }
  el.capped.closest("label").hidden = sol;
  syncCap();
  if (sol) el.capField.hidden = true;
  el.foot.textContent = sol ? "9 decimals. the whole supply goes to your wallet. burning is always on. image storage costs a little sol." : (state.chain.decimalsNote || "18 decimals. the whole supply goes to your wallet.");
  renderChains(); renderStatus(); renderPicker();
}
function setChain(c) {
  if (c === state.chain) return;
  state.chain = c;
  try { localStorage.setItem("tokin:chain", c.key); } catch {}
  setError(""); el.result.hidden = true; coinGen++;
  invalidate(); applyChain(); loadCoins();
}
applyChain();
