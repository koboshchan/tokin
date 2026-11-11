import { BrowserProvider, Contract, ContractFactory, formatEther, formatUnits, getAddress, isAddress, parseUnits, ZeroAddress } from "ethers";
import artifact from "./artifact.json";
import mintableArtifact from "./artifact-mintable.json";

const BASE = { id: 8453, hex: "0x2105" };
const BASE_PARAMS = {
  chainId: BASE.hex, chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"],
};
const MAX_UINT = (1n << 256n) - 1n;
const MAX_URI_BYTES = 8192;
const $ = (id) => document.getElementById(id);
const el = {
  form: $("form"), name: $("name"), symbol: $("symbol"), supply: $("supply"), image: $("image"),
  preview: $("preview"), clear: $("clear-img"), err: $("form-error"), status: $("wallet-status"),
  picker: $("picker"), connect: $("connect"), est: $("estimate"), primary: $("primary"),
  confirm: $("confirm"), result: $("result"), mintable: $("mintable"), coins: $("coins"), coinList: $("coin-list"), coinNote: $("coin-note"),
};

const state = { providers: new Map(), selected: null, account: null, chainId: null, logo: "", estimate: null, busy: false, revision: 0 };

function add(parent, tag, text, attrs = {}) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent.appendChild(n);
  return n;
}
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const setError = (m) => { el.err.textContent = m || ""; };
const errMsg = (e) => e?.info?.error?.message || e?.shortMessage || e?.message || "something went wrong";

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
  const multi = state.providers.size > 1 && !state.selected;
  el.picker.hidden = !multi;
  el.connect.hidden = multi || !!state.account;
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
  if (!state.account) { el.status.textContent = "no wallet connected"; return; }
  const net = state.chainId === BASE.id ? "base" : "wrong network";
  el.status.textContent = short(state.account) + " · " + net;
}

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
el.connect.addEventListener("click", () => connect());

async function ensureBase() {
  const p = state.selected;
  if (state.chainId === BASE.id) return;
  try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE.hex }] }); }
  catch (e) {
    if (e?.code === 4902 || e?.data?.originalError?.code === 4902 || /unrecognized|add/i.test(e?.message || "")) {
      await p.request({ method: "wallet_addEthereumChain", params: [BASE_PARAMS] });
    } else throw e;
  }
  state.chainId = Number(await p.request({ method: "eth_chainId" }));
  if (state.chainId !== BASE.id) throw new Error("please switch your wallet to base");
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
function setLogo(uri) {
  state.logo = uri; invalidate();
  el.preview.style.backgroundImage = uri ? 'url("' + uri + '")' : "";
  el.clear.hidden = !uri;
}
$("choose-img").addEventListener("click", () => el.image.click());
el.image.addEventListener("change", async () => {
  setError("");
  const f = el.image.files[0]; el.image.value = "";
  if (!f) return;
  try { setLogo(await toLogo(f)); } catch (e) { setLogo(""); setError(e.message || "couldn't read that image"); }
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
  const supply = parseUnits(raw, 18);
  if (supply > MAX_UINT) throw new Error("supply is too large");
  return { name, symbol, supply, logo: state.logo, mintable: el.mintable.checked };
}
for (const i of [el.name, el.symbol, el.supply]) i.addEventListener("input", () => { setError(""); invalidate(); });

el.mintable.addEventListener("change", () => { setError(""); invalidate(); });

function setBusy(b, label) {
  state.busy = b; el.primary.disabled = b; el.confirm.disabled = b;
  if (label) (el.confirm.hidden ? el.primary : el.confirm).textContent = label;
}

function factoryFor(signer, v) {
  return { factory: new ContractFactory((v.mintable ? mintableArtifact : artifact).abi, (v.mintable ? mintableArtifact : artifact).bytecode, signer), args: [v.name, v.symbol, v.supply, v.logo] };
}

el.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy) return;
  setError("");
  try {
    const v = read();
    if (!state.selected) { await connect(); if (!state.selected) return; }
    setBusy(true, "estimating…");
    await ensureBase();
    const revision = state.revision;
    const signer = await new BrowserProvider(state.selected).getSigner();
    const { factory, args } = factoryFor(signer, v);
    const tx = await factory.getDeployTransaction(...args);
    const [gas, fee] = await Promise.all([signer.estimateGas(tx), signer.provider.getFeeData()]);
    const price = fee.maxFeePerGas ?? fee.gasPrice;
    if (!price) throw new Error("couldn't read network fees");
    if (revision !== state.revision) throw new Error("details changed. estimate again.");
    const cost = gas * price;
    state.estimate = { v, gas, cost, account: state.account };
    showEstimate(gas, price, cost);
    el.primary.hidden = true; el.confirm.hidden = false;
  } catch (err) { setError(errMsg(err)); }
  finally { setBusy(false); el.primary.textContent = "estimate cost"; el.confirm.textContent = "confirm and deploy"; }
});

function showEstimate(gas, price, cost) {
  el.est.replaceChildren();
  const dl = add(el.est, "dl");
  const row = (k, v) => { add(dl, "dt", k); add(dl, "dd", v); };
  row("gas", gas.toLocaleString());
  row("gas price", Number(formatUnits(price, "gwei")).toFixed(4) + " gwei");
  row("estimate", "~" + Number(formatEther(cost)).toFixed(6) + " eth");
  add(el.est, "p", "base l2 estimate only. base also charges an l1 data fee that isn't included here, so your wallet's final number will be higher.");
  el.est.hidden = false;
}

el.confirm.addEventListener("click", async () => {
  if (state.busy || !state.estimate) return;
  setError("");
  const { v, account } = state.estimate;
  try {
    if (account !== state.account || state.chainId !== BASE.id) throw new Error("wallet changed. estimate again.");
    setBusy(true, "confirm in your wallet…");
    const activeChain = Number(await state.selected.request({ method: "eth_chainId" }));
    const activeAccounts = await state.selected.request({ method: "eth_accounts" });
    if (activeChain !== BASE.id || activeAccounts[0]?.toLowerCase() !== account.toLowerCase()) { invalidate(); throw new Error("wallet changed. estimate again."); }
    const signer = await new BrowserProvider(state.selected).getSigner();
    const { factory, args } = factoryFor(signer, v);
    const contract = await factory.deploy(...args);
    el.confirm.textContent = "deploying…";
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    saveCoin(account, { address, name: v.name, symbol: v.symbol, supply: v.supply.toString(), mintable: v.mintable, logo: v.logo, ts: Date.now() });
    showResult(address, v);
    if (account === state.account) loadCoins();
  } catch (err) { setError(errMsg(err)); }
  finally { setBusy(false); el.confirm.textContent = "confirm and deploy"; }
});

function showResult(address, v) {
  invalidate();
  el.result.replaceChildren();
  add(el.result, "h2", v.symbol + " is live");
  if (v.mintable) add(el.result, "p", "mintable. you can mint more or renounce ownership below.");
  add(el.result, "code", address);
  const p = add(el.result, "p");
  add(p, "a", "view on basescan", { href: "https://basescan.org/token/" + address, target: "_blank", rel: "noopener noreferrer" });
  const w = add(el.result, "p");
  const btn = add(w, "button", "add to wallet", { type: "button", class: "secondary" });
  btn.addEventListener("click", async () => {
    try {
      const options = { address, symbol: v.symbol, decimals: 18 };
      if (v.logo) options.image = v.logo;
      await ensureBase();
      await state.selected.request({ method: "wallet_watchAsset", params: { type: "ERC20", options } });
    } catch (e) { setError(errMsg(e)); }
  });
  const n = add(el.result, "p", "basescan's public logo and listing is separate and off-chain. submit it at ");
  add(n, "a", "basescan.org/tokenupdate", { href: "https://basescan.org/tokenupdate", target: "_blank", rel: "noopener noreferrer" });
  n.append(".");
  el.result.hidden = false;
  el.result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

renderStatus();

/* your coins */
const TOKEN_ABI = [
  "function name() view returns (string)", "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)",
  "function owner() view returns (address)", "function mint(address to, uint256 amount)",
  "function renounceOwnership()",
];
const storeKey = (acct) => "tokin:v1:" + BASE.id + ":" + acct.toLowerCase();
function validRecord(r) {
  return r && typeof r === "object" && typeof r.address === "string" && isAddress(r.address)
    && typeof r.name === "string" && r.name.length <= 128 && typeof r.symbol === "string" && r.symbol.length <= 16
    && typeof r.supply === "string" && /^\d{1,78}$/.test(r.supply) && typeof r.mintable === "boolean";
}
function loadRecords(acct) {
  try {
    const arr = JSON.parse(localStorage.getItem(storeKey(acct)) || "[]");
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    return arr.filter(validRecord).map((r) => ({ ...r, address: getAddress(r.address) }))
      .filter((r) => !seen.has(r.address) && seen.add(r.address));
  } catch { return []; }
}
function saveCoin(acct, rec) {
  try {
    const list = loadRecords(acct).filter((r) => r.address !== getAddress(rec.address));
    list.unshift({ ...rec, address: getAddress(rec.address) });
    localStorage.setItem(storeKey(acct), JSON.stringify(list.slice(0, 100)));
  } catch { /* storage unavailable */ }
}
const fmt = (n) => { const s = formatUnits(n, 18); const [i, f = ""] = s.split("."); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f !== "0" && f ? "." + f.slice(0, 4) : ""); };

let coinGen = 0;
async function activeCtx(account) {
  // confirm the wallet still matches the context this view was built for
  const p = state.selected;
  if (!p || !account || account !== state.account) throw new Error("wallet changed. reload your coins.");
  const chain = Number(await p.request({ method: "eth_chainId" }));
  const accts = await p.request({ method: "eth_accounts" });
  if (chain !== BASE.id || accts[0]?.toLowerCase() !== account.toLowerCase()) throw new Error("wallet changed or not on base.");
  return await new BrowserProvider(p).getSigner();
}

async function loadCoins() {
  const gen = ++coinGen;
  el.coinList.replaceChildren();
  const account = state.account;
  if (!account) { el.coins.hidden = true; return; }
  const recs = loadRecords(account);
  el.coins.hidden = false;
  if (!recs.length) { el.coinNote.textContent = "nothing yet. coins you deploy from this wallet appear here."; return; }
  if (state.chainId !== BASE.id) { el.coinNote.textContent = "switch to base to see your coins."; return; }
  el.coinNote.textContent = "";
  const provider = new BrowserProvider(state.selected);
  for (const rec of recs) {
    const card = add(el.coinList, "article", null, { class: "coin" });
    renderCoin(card, rec, account, provider, gen);
  }
}

async function renderCoin(card, rec, account, provider, gen) {
  const stale = () => gen !== coinGen || account !== state.account || state.chainId !== BASE.id;
  const head = add(card, "div", null, { class: "coin-head" });
  if (typeof rec.logo === "string" && /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(rec.logo) && rec.logo.length <= 12000) {
    const i = add(head, "img", null, { alt: "", class: "coin-logo" }); i.src = rec.logo;
  }
  add(head, "strong", rec.symbol);
  add(head, "span", rec.name, { class: "muted" });
  const link = add(card, "a", short(rec.address), { href: "https://basescan.org/token/" + rec.address, target: "_blank", rel: "noopener noreferrer", class: "coin-addr" });
  const dl = add(card, "dl", null, { class: "coin-stats" });
  const row = (k, v) => { add(dl, "dt", k); return add(dl, "dd", v); };
  const sup = row("supply", "…"), bal = row("your balance", "…");
  const c = new Contract(rec.address, TOKEN_ABI, provider);
  try {
    const code = await provider.getCode(rec.address);
    if (stale()) return;
    if (code === "0x") { sup.textContent = bal.textContent = "—"; add(card, "p", "no contract found at this address on base.", { class: "muted small" }); return; }
    const [ts, b] = await Promise.all([c.totalSupply(), c.balanceOf(account)]);
    if (stale()) return;
    sup.textContent = fmt(ts); bal.textContent = fmt(b);
  } catch { if (!stale()) { sup.textContent = bal.textContent = "—"; } }
  if (!rec.mintable) { add(card, "p", "fixed supply", { class: "muted small" }); return; }
  let owner;
  try { owner = await c.owner(); } catch { owner = null; }
  if (stale()) return;
  if (owner == null) { add(card, "p", "fixed supply", { class: "muted small" }); return; }
  if (owner === ZeroAddress) { add(card, "p", "ownership renounced. supply is now fixed.", { class: "muted small" }); return; }
  if (owner.toLowerCase() !== account.toLowerCase()) { add(card, "p", "owned by " + short(owner), { class: "muted small" }); return; }
  mintControls(card, rec, account, gen, () => { card.replaceChildren(); return renderCoin(card, rec, account, provider, gen); });
}

function mintControls(card, rec, account, gen, refresh) {
  const f = add(card, "form", null, { class: "mint", novalidate: "" });
  add(f, "span", "you own this coin", { class: "muted small" });
  const to = add(f, "input", null, { type: "text", placeholder: "recipient", value: account, "aria-label": "recipient", spellcheck: "false" });
  const amt = add(f, "input", null, { type: "text", inputmode: "decimal", placeholder: "amount", "aria-label": "amount to mint" });
  const row = add(f, "div", null, { class: "mint-row" });
  const go = add(row, "button", "mint", { type: "submit", class: "primary small-btn" });
  const ren = add(row, "button", "renounce ownership", { type: "button", class: "secondary danger" });
  const msg = add(f, "p", null, { class: "error", role: "alert" });
  const run = async (label, fn) => {
    msg.textContent = ""; go.disabled = ren.disabled = true;
    try {
      if (gen !== coinGen) throw new Error("wallet changed. reload your coins.");
      const signer = await activeCtx(account);
      const tc = new Contract(rec.address, TOKEN_ABI, signer);
      if ((await tc.owner()).toLowerCase() !== account.toLowerCase()) throw new Error("you are not the owner anymore.");
      const tx = await fn(tc);
      msg.textContent = "waiting for confirmation…";
      await tx.wait();
      if (gen === coinGen && account === state.account) await refresh();
    } catch (e) { msg.textContent = errMsg(e); go.disabled = ren.disabled = false; }
  };
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    let recipient, value;
    try {
      recipient = to.value.trim() || account;
      if (!isAddress(recipient)) throw new Error("enter a valid recipient address");
      recipient = getAddress(recipient);
      const raw = amt.value.trim().replace(/,/g, "");
      if (!/^\d+(\.\d{1,18})?$/.test(raw)) throw new Error("enter a positive amount");
      value = parseUnits(raw, 18);
      if (value <= 0n || value > MAX_UINT) throw new Error("amount is out of range");
    } catch (err) { msg.textContent = err.message; return; }
    run("mint", (tc) => tc.mint(recipient, value));
  });
  ren.addEventListener("click", () => {
    if (!window.confirm("renounce ownership of " + rec.symbol + "?\n\nthis is irreversible. nobody will ever be able to mint more " + rec.symbol + ".")) return;
    run("renounce", (tc) => tc.renounceOwnership());
  });
}
