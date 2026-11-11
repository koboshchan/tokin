const { chromium } = require("@playwright/test");
const ganache = require("ganache");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const CHAINS = [["base", 8453, "eth"], ["ethereum", 1, "eth"], ["polygon", 137, "pol"], ["bnb", 56, "bnb"]];
(async () => {
  const port = 4800 + Math.floor(Math.random() * 400);
  const srv = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
  const nodes = {};
  for (const [, id] of CHAINS) nodes[id] = ganache.provider({ logging: { quiet: true }, chain: { chainId: id, hardfork: "shanghai" }, wallet: { deterministic: true } });
  const accounts = await nodes[8453].request({ method: "eth_accounts", params: [] });
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    let cur = 8453; const known = new Set([8453]); const calls = [];
    await page.exposeFunction("rpc", async (req) => {
      calls.push(req.method);
      if (req.method === "eth_requestAccounts") return accounts;
      if (req.method === "wallet_watchAsset") return true;
      if (req.method === "eth_chainId") return "0x" + cur.toString(16);
      if (req.method === "wallet_switchEthereumChain") { const id = parseInt(req.params[0].chainId, 16); if (!known.has(id)) { const e = new Error("unrecognized chain"); e.code = 4902; throw e; } cur = id; return null; }
      if (req.method === "wallet_addEthereumChain") { known.add(parseInt(req.params[0].chainId, 16)); return null; }
      return nodes[cur].request(req);
    });
    await page.addInitScript(() => { window.ethereum = { request: (r) => window.rpc(r), on: () => {} }; });
    await page.goto("http://localhost:" + port);
    await page.waitForTimeout(600);
    await page.locator("#connect").click();
    for (const [key, id, sym] of CHAINS) {
      await page.locator(".chains button", { hasText: new RegExp("^" + (key === "bnb" ? "bnb chain" : key) + "$") }).click();
      await page.locator("#name").fill("Coin " + key); await page.locator("#symbol").fill("C" + id); await page.locator("#supply").fill("1000");
      for (const x of ["mintable", "burnable", "pausable"]) await page.locator("#" + x).check();
      await page.locator("#primary").click();
      await page.locator("#confirm").waitFor({ state: "visible", timeout: 20000 });
      assert.equal(cur, id, key + ": wallet on right chain");
      assert.match(await page.locator("#estimate").textContent(), new RegExp(sym), key + " fee label");
      await page.locator("#confirm").click();
      await page.locator("#result h2").waitFor({ timeout: 30000 });
      assert.match(await page.locator("#result h2").textContent(), new RegExp(key === "bnb" ? "bnb chain" : key));
      const href = await page.locator("#result a").first().getAttribute("href");
      assert.match(href, /^https:\/\/(basescan|etherscan|polygonscan|bscscan)\.(org|io|com)\/token\/0x/, key + " explorer " + href);
      await page.locator(".coin .sub-form").first().waitFor({ timeout: 30000 });
      const mint = page.locator(".coin .sub-form").first();
      await mint.locator('input[aria-label="amount to mint"]').fill("10"); await mint.locator("button").click();
      await page.waitForFunction(() => document.querySelector(".coin-stats dd")?.textContent === "1,010", null, { timeout: 30000 });
      const stored = await page.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith("tokin:v1:" + k + ":")).length, id);
      assert.equal(stored, 1, key + " stored under own chain key");
      console.log("PASS", key, id, "deploy+mint, explorer", href.slice(0, 30));
    }
    assert.ok(known.has(1) && known.has(137) && known.has(56), "add-chain used for unknown chains");
    // coins list is per chain: base list must not show other chains' coins
    await page.locator(".chains button", { hasText: /^base$/ }).click();
    await page.locator("#coin-note button").click();
    await page.locator(".coin").first().waitFor({ timeout: 20000 });
    assert.equal(await page.locator(".coin").count(), 1);
    assert.match(await page.locator(".coin strong").first().textContent(), /C8453/);
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log("PASS all four EVM chains, per-chain lists. No real funds.");
  } finally { await browser.close(); srv.kill(); for (const n of Object.values(nodes)) await n.disconnect(); }
})().catch((e) => { console.error(e); process.exit(1); });
