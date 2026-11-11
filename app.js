import { BrowserProvider, ContractFactory, formatEther, formatUnits, parseUnits } from "ethers";
import artifact from "./artifact.json";

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
  confirm: $("confirm"), result: $("result"),
};

const state = { providers: new Map(), selected: null, account: null, chainId: null, logo: "", estimate: null, busy: false };

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
  state.estimate = null;
  el.est.hidden = true; el.est.replaceChildren();
  el.confirm.hidden = true;
  el.primary.hidden = false;
}

function bind(provider) {
  if (provider.__tokin) return;
  provider.__tokin = true;
  provider.on?.("accountsChanged", (a) => { state.account = a?.[0] || null; if (!state.account) state.selected = null; invalidate(); renderStatus(); renderPicker(); });
  provider.on?.("chainChanged", (c) => { state.chainId = Number(c); invalidate(); renderStatus(); });
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
    invalidate(); renderStatus(); renderPicker();
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
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - side) / 2, sy = (bmp.height - side) / 2;
  for (const size of [128, 96, 64, 48, 32]) {
    const c = document.createElement("canvas"); c.width = c.height = size;
    c.getContext("2d").drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
    for (const [type, q] of [["image/webp", 0.8], ["image/webp", 0.5], ["image/png"]]) {
      const uri = c.toDataURL(type, q);
      if (!uri.startsWith("data:" + type)) continue;
      if (enc.encode(uri).length <= MAX_URI_BYTES) return uri;
    }
  }
  throw new Error("image is too detailed to store on-chain. try a simpler one.");
}
function setLogo(uri) {
  state.logo = uri; invalidate();
  el.preview.style.backgroundImage = uri ? 'url("' + uri + '")' : "";
  el.clear.hidden = !uri;
}
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
  if (!/^\d+$/.test(raw) || BigInt(raw) === 0n) throw new Error("supply must be a whole number above zero");
  const supply = parseUnits(raw, 18);
  if (supply > MAX_UINT) throw new Error("supply is too large");
  return { name, symbol, supply, logo: state.logo };
}
for (const i of [el.name, el.symbol, el.supply]) i.addEventListener("input", () => { setError(""); invalidate(); });

function setBusy(b, label) {
  state.busy = b; el.primary.disabled = b; el.confirm.disabled = b;
  if (label) (el.confirm.hidden ? el.primary : el.confirm).textContent = label;
}

function factoryFor(signer, v) {
  return { factory: new ContractFactory(artifact.abi, artifact.bytecode, signer), args: [v.name, v.symbol, v.supply, v.logo] };
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
    const signer = await new BrowserProvider(state.selected).getSigner();
    const { factory, args } = factoryFor(signer, v);
    const tx = await factory.getDeployTransaction(...args);
    const [gas, fee] = await Promise.all([signer.estimateGas(tx), signer.provider.getFeeData()]);
    const price = fee.maxFeePerGas ?? fee.gasPrice;
    if (!price) throw new Error("couldn't read network fees");
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
    const signer = await new BrowserProvider(state.selected).getSigner();
    const { factory, args } = factoryFor(signer, v);
    const contract = await factory.deploy(...args);
    el.confirm.textContent = "deploying…";
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    showResult(address, v);
  } catch (err) { setError(errMsg(err)); }
  finally { setBusy(false); el.confirm.textContent = "confirm and deploy"; }
});

function showResult(address, v) {
  invalidate();
  el.result.replaceChildren();
  add(el.result, "h2", v.symbol + " is live");
  add(el.result, "code", address);
  const p = add(el.result, "p");
  add(p, "a", "view on basescan", { href: "https://basescan.org/token/" + address, target: "_blank", rel: "noopener noreferrer" });
  const w = add(el.result, "p");
  const btn = add(w, "button", "add to wallet", { type: "button", class: "secondary" });
  btn.addEventListener("click", async () => {
    try {
      const options = { address, symbol: v.symbol.slice(0, 11), decimals: 18 };
      if (v.logo) options.image = v.logo;
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
