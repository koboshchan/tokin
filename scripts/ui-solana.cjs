// Browser lifecycle for the real solana.js. Needs a local validator: SOL_RPC (default http://127.0.0.1:8899, ws on +1).
// Mock Phantom signs in node with a throwaway keypair; mainnet RPC calls are routed to the local validator. No real funds.
const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const WS = require("ws");
const RPC = process.env.SOL_RPC || "http://127.0.0.1:8899";
const WSURL = process.env.SOL_WS || RPC.replace(/^http/, "ws").replace(/:(\d+)$/, (_, p) => ":" + (Number(p) + 1));
(async () => {
  const conn = new web3.Connection(RPC, "confirmed");
  try { await conn.getVersion(); } catch { console.error("SKIP no validator at " + RPC); process.exit(2); }
  const kp = web3.Keypair.generate(), other = web3.Keypair.generate();
  for (const k of [kp, other]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 20 * web3.LAMPORTS_PER_SOL), "confirmed");
  const port = 5300 + Math.floor(Math.random() * 400);
  const srv = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1300 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    let delayMs = 0;
    await page.route("https://api.mainnet-beta.solana.com/**", async (route) => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: route.request().postData() });
      await route.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
    });
    await page.routeWebSocket(/api\.mainnet-beta\.solana\.com/, (ws) => {
      const up = new WS(WSURL); const q = [];
      up.on("open", () => q.splice(0).forEach((m) => up.send(m)));
      up.on("message", (m) => ws.send(m.toString()));
      ws.onMessage((m) => (up.readyState === 1 ? up.send(m) : q.push(m)));
      ws.onClose(() => up.close());
    });
    await page.exposeFunction("nodeSignSend", async (bytes) => {
      const tx = web3.Transaction.from(Buffer.from(bytes)); tx.partialSign(kp);
      return await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    });
    await page.addInitScript((pub) => {
      const key = (b) => ({ toBase58: () => b, equals: (o) => o.toBase58() === b, toBytes: () => new Uint8Array(32), toString: () => b });
      const h = {};
      window.phantom = { solana: { isPhantom: true, isConnected: false, publicKey: null,
        async connect() { this.isConnected = true; this.publicKey = window.__realKey(pub); return { publicKey: this.publicKey }; },
        async disconnect() { this.isConnected = false; this.publicKey = null; },
        on(e, cb) { (h[e] ||= []).push(cb); },
        async signAndSendTransaction(tx) { const s = await window.nodeSignSend(Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }))); return { signature: s }; },
      } };
      window.__realKey = (b) => key(b);
      window.__fire = (e, v) => (h[e] || []).forEach((cb) => cb(v));
    }, kp.publicKey.toBase58());
    page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:" + port);
    await page.waitForTimeout(500);
    await page.locator(".chains button", { hasText: /^solana$/ }).click();
    await page.locator("#name").fill("Sol Test"); await page.locator("#symbol").fill("SOLT"); await page.locator("#supply").fill("1000");
    await page.locator("#uri-field summary").click(); await page.locator("#uri").fill("https://example.com/m.json");
    await page.locator("#mintable").check(); await page.locator("#pausable").check();
    await page.locator("#connect").click();
    await page.waitForFunction(() => document.querySelector("#wallet-status").textContent.includes("solana"));
    // chain switch while estimate pending
    delayMs = 1500;
    await page.locator("#primary").click();
    await page.locator(".chains button", { hasText: /^base$/ }).click();
    await page.waitForTimeout(3500);
    assert.equal(await page.locator("#estimate").isHidden() && await page.locator("#confirm").isHidden(), true, "pending estimate discarded after chain switch");
    delayMs = 0;
    await page.locator(".chains button", { hasText: /^solana$/ }).click();
    await page.locator("#primary").click();
    await page.locator("#confirm").waitFor({ state: "visible", timeout: 30000 });
    assert.match(await page.locator("#estimate").textContent(), /sol/);
    await page.locator("#confirm").click();
    await page.locator("#result h2").waitFor({ timeout: 60000 });
    const mintAddr = (await page.locator("#result code").textContent()).trim();
    const mintKey = new web3.PublicKey(mintAddr);
    let info = await spl.getMint(conn, mintKey);
    assert.equal(info.decimals, 9); assert.equal(info.supply, 1000n * 10n ** 9n);
    assert.ok(info.mintAuthority && info.freezeAuthority, "authorities present");
    await page.locator(".coin .sub-form").first().waitFor({ timeout: 30000 });
    // mint
    const mf = page.locator(".coin .sub-form").first();
    await mf.locator('input[aria-label="amount to mint"]').fill("5"); await mf.locator("button").click();
    await page.waitForFunction(() => document.querySelector(".coin-stats dd")?.textContent === "1,005", null, { timeout: 40000 });
    // freeze / thaw own account
    const ata = spl.getAssociatedTokenAddressSync(mintKey, kp.publicKey).toBase58();
    await page.locator('input[aria-label="token account"]').fill(ata);
    await page.getByRole("button", { name: "freeze", exact: true }).click();
    await page.waitForFunction(async (a) => true, ata); await page.waitForTimeout(2500);
    assert.equal((await spl.getAccount(conn, new web3.PublicKey(ata))).isFrozen, true, "frozen");
    await page.locator('input[aria-label="token account"]').fill(ata);
    await page.getByRole("button", { name: "thaw", exact: true }).click(); await page.waitForTimeout(2500);
    assert.equal((await spl.getAccount(conn, new web3.PublicKey(ata))).isFrozen, false, "thawed");
    // account change clears view
    await page.evaluate((b) => window.__fire("accountChanged", window.__realKey(b)), other.publicKey.toBase58());
    await page.waitForTimeout(800);
    assert.match(await page.textContent("#wallet-status"), new RegExp(other.publicKey.toBase58().slice(0, 6)));
    assert.equal(await page.locator("#confirm").isHidden(), true);
    await page.evaluate((b) => window.__fire("accountChanged", window.__realKey(b)), kp.publicKey.toBase58());
    await page.locator(".coin .mint-row").waitFor({ timeout: 30000 });
    // revoke
    await page.getByRole("button", { name: "revoke freeze" }).click(); await page.waitForTimeout(3000);
    await page.getByRole("button", { name: "revoke mint" }).click(); await page.waitForTimeout(3000);
    info = await spl.getMint(conn, mintKey);
    assert.equal(info.freezeAuthority, null, "freeze revoked"); assert.equal(info.mintAuthority, null, "mint revoked");
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log("PASS actual solana.js lifecycle on local validator: pending-estimate chain switch, deploy (json-only), mint, freeze/thaw, account change, revoke freeze+mint.");
  } finally { await browser.close(); srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
