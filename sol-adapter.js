// thin adapter over solana.js (written by the solana worker). loaded lazily so EVM users never pay for it.
// window.__tokinSol lets browser tests inject a mock implementation.
const mods = import.meta.glob("./solana.js");
async function api() {
  if (typeof window !== "undefined" && window.__tokinSol) return window.__tokinSol;
  const load = mods["./solana.js"];
  if (!load) throw new Error("solana support isn't available in this build");
  return load();
}
const call = (name) => async (...args) => (await api())[name](...args);
export const connect = call("connect");
export const disconnect = call("disconnect");
export const estimate = call("estimate");
export const deploy = call("deploy");
export const getCoin = call("getCoin");
export const mint = call("mint");
export const burn = call("burn");
export const freeze = call("freeze");
export const thaw = call("thaw");
export const revokeMint = call("revokeMint");
export const revokeFreeze = call("revokeFreeze");
let listener = null;
window.__tokinSolEmit = (a) => listener?.(a);
export function onChange(cb) { listener = cb; api().then((m) => m.onChange?.(cb)).catch(() => {}); }
