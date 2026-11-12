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
      if (process.env.RPCLOG) console.error("rpc", (route.request().postData() || "").slice(0, 140));
      const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: route.request().postData() });
      await route.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
    });
    await page.addInitScript((target) => { const NW = window.WebSocket; window.WebSocket = function (u, p) { return new NW(String(u).includes("api.mainnet-beta.solana.com") ? target : u, p); }; window.WebSocket.prototype = NW.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); }, WSURL);
    await page.exposeFunction("nodeSignSend", async (bytes) => {
      const tx = web3.Transaction.from(Buffer.from(bytes)); tx.partialSign(kp);
      try { const sg = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false }); return sg; } catch (e) { console.error("node send error:", e.message, (e.logs || []).slice(-4)); throw e; }
    });
    await page.addInitScript({ content: require("fs").readFileSync(require.resolve("@solana/web3.js/lib/index.iife.min.js"), "utf8") + ";window.solanaWeb3=solanaWeb3;" });
    await page.addInitScript((pub) => {
      const key = (b) => new window.solanaWeb3.PublicKey(b);
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
    await page.waitForFunction(() => /connected|[1-9A-HJ-NP-Za-km-z]{6}/.test(document.querySelector("#wallet-status").textContent) && !/no wallet/.test(document.querySelector("#wallet-status").textContent), null, { timeout: 15000 }).catch(async (e) => { console.error("status:", await page.textContent("#wallet-status"), "form-error:", await page.textContent("#form-error"), errors); throw e; });
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
    for (let i = 0; i < 40 && (await spl.getMint(conn, mintKey)).supply !== 1005n * 10n ** 9n; i++) await page.waitForTimeout(1000);
    assert.equal((await spl.getMint(conn, mintKey)).supply, 1005n * 10n ** 9n, "minted on chain");
    await page.waitForFunction(() => document.querySelector(".coin-stats dd")?.textContent === "1,005", null, { timeout: 20000 }).catch(async () => { console.error("UI stale after mint:", (await page.locator(".coin").first().innerText()).replace(/\n+/g, " | ")); });
    // freeze / thaw own account
    const ata = spl.getAssociatedTokenAddressSync(mintKey, kp.publicKey).toBase58();
    await page.locator('input[aria-label="token account"]').fill(ata);
    const idle = () => page.waitForFunction(() => ![...document.querySelectorAll(".coin button")].some((b) => b.disabled), null, { timeout: 20000 }).catch(async (e) => { console.error("stuck:", await page.evaluate(() => [...document.querySelectorAll(".coin button")].map((b) => b.textContent + (b.disabled ? "[off]" : "")).join(","), ), await page.locator(".coin").first().innerText()); throw e; });
    await idle();
    await page.getByRole("button", { name: "freeze", exact: true }).click();
    for (let i = 0; i < 40 && !(await spl.getAccount(conn, new web3.PublicKey(ata))).isFrozen; i++) await page.waitForTimeout(1000);
    assert.equal((await spl.getAccount(conn, new web3.PublicKey(ata))).isFrozen, true, "frozen");
    await idle();
    assert.equal((await spl.getAccount(conn, new web3.PublicKey(ata))).isFrozen, true, "frozen");
    await page.locator('input[aria-label="token account"]').fill(ata);
    await page.getByRole("button", { name: "thaw", exact: true }).click();
    for (let i = 0; i < 40 && (await spl.getAccount(conn, new web3.PublicKey(ata))).isFrozen; i++) await page.waitForTimeout(1000);
    assert.equal((await spl.getAccount(conn, new web3.PublicKey(ata))).isFrozen, false, "thawed");
    // account change clears view
    await page.evaluate((b) => window.__fire("accountChanged", window.__realKey(b)), other.publicKey.toBase58());
    await page.waitForTimeout(800);
    assert.match(await page.textContent("#wallet-status"), new RegExp(other.publicKey.toBase58().slice(0, 6)));
    assert.equal(await page.locator("#confirm").isHidden(), true);
    await page.evaluate((b) => window.__fire("accountChanged", window.__realKey(b)), kp.publicKey.toBase58());
    await page.locator(".coin .mint-row").waitFor({ timeout: 30000 });
    // revoke
    await idle();
    await page.getByRole("button", { name: "revoke freeze" }).click();
    for (let i = 0; i < 30 && (await spl.getMint(conn, mintKey)).freezeAuthority; i++) await page.waitForTimeout(1000);
    console.log("coin text:", (await page.locator(".coin").first().innerText()).replace(/\n+/g, " | "), errors);
    await idle();
    await page.getByRole("button", { name: "revoke mint" }).click();
    for (let i = 0; i < 30 && (await spl.getMint(conn, mintKey)).mintAuthority; i++) await page.waitForTimeout(1000);
    info = await spl.getMint(conn, mintKey);
    assert.equal(info.freezeAuthority, null, "freeze revoked"); assert.equal(info.mintAuthority, null, "mint revoked");
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log("PASS actual solana.js lifecycle on local validator: pending-estimate chain switch, deploy (json-only), mint, freeze/thaw, account change, revoke freeze+mint.");
  } finally { await browser.close(); srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
