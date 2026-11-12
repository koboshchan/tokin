const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const web3 = require("@solana/web3.js");
const nacl = require("tweetnacl");
const RPC = process.env.SOL_RPC || "http://127.0.0.1:8899";
const WSURL = process.env.SOL_WS || RPC.replace(/^http/, "ws").replace(/:(\d+)$/, (_, p) => ":" + (Number(p) + 1));
(async () => {
  const conn = new web3.Connection(RPC, "confirmed");
  try { await conn.getVersion(); } catch { console.error("SKIP no validator at " + RPC); process.exit(2); }
  const kp = web3.Keypair.generate(), bundler = web3.Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(bundler.publicKey, web3.LAMPORTS_PER_SOL), "confirmed");
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 20 * web3.LAMPORTS_PER_SOL), "confirmed");
  const S = { bodies: [], price: 1000, balance: 0n, calls: [], uploads: [], funds: [], failNext: 0, signed: 0 };
  const port = 5300 + Math.floor(Math.random() * 400);
  const srv = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1300 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://solana-rpc.publicnode.com/**", async (route) => {
      const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: route.request().postData() });
      await route.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
    });
    await page.addInitScript((target) => { const NW = window.WebSocket; window.WebSocket = function (u, p) { return new NW(String(u).includes("solana-rpc.publicnode.com") ? target : u, p); }; window.WebSocket.prototype = NW.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); }, WSURL);
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    await page.route("https://uploader.irys.xyz/**", async (route) => {
      const req = route.request(), u = new URL(req.url()), path = u.pathname;
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      S.calls.push(req.method() + " " + path + u.search);
      const j = (o, status = 200) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(o) });
      if (path === "/info") return j({ version: "1.0.0", addresses: { solana: bundler.publicKey.toBase58() }, gateway: "https://gateway.irys.xyz", protocol: "irys" });
      if (req.method() === "GET" && path.startsWith("/price/")) return route.fulfill({ status: 200, headers: cors, contentType: "text/plain", body: String(S.price) });
      if (req.method() === "GET" && path.startsWith("/account/balance")) return j({ balance: S.balance.toString() });
      if (req.method() === "POST" && path.startsWith("/account/balance")) { S.funds.push(JSON.parse(req.postData() || "{}")); { const txid = S.funds[S.funds.length - 1].tx_id; await conn.confirmTransaction(txid, "confirmed"); const pt = await conn.getParsedTransaction(txid, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }); const ix = pt.transaction.message.instructions.find((i) => i.parsed && i.parsed.type === "transfer"); assert.equal(ix.parsed.info.destination, bundler.publicKey.toBase58()); S.balance += BigInt(ix.parsed.info.lamports); } return j({ confirmed: true }); }
      if (req.method() === "POST" && path.startsWith("/tx/")) {
        S.postCount = (S.postCount || 0) + 1;
        if (S.failAt && S.postCount === S.failAt) { S.failAt = 0; return route.fulfill({ status: 500, headers: cors, body: "boom" }); }
        const body = req.postDataBuffer(); S.bodies.push(body); const id = ("U" + S.uploads.length + "x".repeat(43)).slice(0, 43);
        S.uploads.push({ id, size: body.length, ct: req.headers()["content-type"] });
        return j({ id, timestamp: Date.now(), version: "1.0.0", public: kp.publicKey.toBase58(), signature: "x", deadlineHeight: 0, block: 0, validatorSignatures: [] });
      }
      console.error("UNMOCKED", req.method(), req.url());
      return j({}, 404);
    });
    await page.exposeFunction("nodeSignTx", async (bytes, versioned) => { S.signed++; if (versioned) { const vt = web3.VersionedTransaction.deserialize(Uint8Array.from(bytes)); vt.sign([kp]); return Array.from(vt.serialize()); } const tx = web3.Transaction.from(Buffer.from(bytes)); tx.partialSign(kp); return Array.from(tx.serialize()); });
    await page.exposeFunction("nodeSignSend", async (bytes) => { const tx = web3.Transaction.from(Buffer.from(bytes)); tx.partialSign(kp); const sig = await conn.sendRawTransaction(tx.serialize()); await conn.confirmTransaction(sig, "confirmed"); S.funds.push({ localTx: sig }); S.balance += 100000000n; return sig; });
    await page.exposeFunction("nodeSignMsg", async (bytes) => { S.signed++; return Array.from(nacl.sign.detached(Uint8Array.from(bytes), kp.secretKey)); });
    await page.addInitScript({ content: require("fs").readFileSync(require.resolve("@solana/web3.js/lib/index.iife.min.js"), "utf8") + ";window.solanaWeb3=solanaWeb3;" });
    await page.addInitScript((pub) => {
      const h = {}, key = (b) => new window.solanaWeb3.PublicKey(b);
      window.phantom = { solana: { isPhantom: true, isConnected: false, publicKey: null,
        async connect() { this.isConnected = true; this.publicKey = key(pub); return { publicKey: this.publicKey }; },
        async disconnect() { this.isConnected = false; this.publicKey = null; },
        on(e, cb) { (h[e] ||= []).push(cb); },
        async signMessage(m) { const sig = await window.nodeSignMsg(Array.from(m)); return { signature: Uint8Array.from(sig) }; },
        async signTransaction(tx) { if (tx.message) { const raw = await window.nodeSignTx(Array.from(tx.serialize()), true); return window.solanaWeb3.VersionedTransaction.deserialize(Uint8Array.from(raw)); } const raw = await window.nodeSignTx(Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })), false); return window.solanaWeb3.Transaction.from(Uint8Array.from(raw)); },
        async signAndSendTransaction(tx) { const s = await window.nodeSignSend(Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }))); return { signature: s }; },
      } };
      window.__fire = (e, v) => (h[e] || []).forEach((cb) => cb(v));
    }, kp.publicKey.toBase58());
    const dialogs = []; page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const bundlerBal = () => conn.getBalance(bundler.publicKey, "confirmed");
    async function start(name) {
      await page.goto("http://localhost:" + port); await page.waitForTimeout(500);
      await page.locator(".chains button", { hasText: /^solana$/ }).click();
      await page.locator("#name").fill(name); await page.locator("#symbol").fill("IMG"); await page.locator("#supply").fill("100");
      await page.locator("#image").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: png });
      await page.locator("#connect").click();
      await page.waitForFunction(() => !/no wallet/.test(document.querySelector("#wallet-status").textContent), null, { timeout: 15000 });
      S.bodies.length = 0; S.calls.length = 0; S.uploads.length = 0; S.funds.length = 0; dialogs.length = 0; S.signed = 0;
      await page.locator("#primary").click();
      await page.locator("#confirm").waitFor({ state: "visible", timeout: 30000 });
    }
    const errText = () => page.textContent("#form-error");
    const posts = () => S.calls.filter((c) => c.startsWith("POST /tx/")).length;

    // 1 happy path: image + JSON signed uploads, exact funding
    await start("Img One");
    const est = await page.locator("#estimate").innerText();
    assert.match(est, /Irys L1 permanent storage quote 2000 lamports/);
    assert.match(est, /new storage funding 2200 lamports plus up to 5000/);
    const before = await bundlerBal();
    await page.locator("#confirm").click();
    await page.locator("#result h2").waitFor({ timeout: 60000 });
    assert.equal(await bundlerBal() - before, 2200, "exact funding transferred to bundler");
    assert.equal(dialogs.length, 1); assert.match(dialogs[0], /up to 2200 lamports/);
    assert.equal(S.uploads.length, 2, "image + metadata uploaded"); assert.equal(S.signed >= 2, true, "both data items signed with wallet signMessage");
    assert.equal(S.funds.filter((f) => f.tx_id).length, 1, "one fund claim");
    const mBody = S.bodies[1].toString("latin1"), iBody = S.bodies[0].toString("latin1");
    assert.ok(mBody.includes('"image":"https://gateway.irys.xyz/' + S.uploads[0].id + '"'), "metadata references uploaded image URI");
    assert.ok(mBody.includes('"name":"Img One"') && mBody.includes("application/json"), "metadata JSON + content type");
    assert.ok(iBody.includes("image/png"), "image content type tag");
    console.log("PASS 1 happy path funding exact 2200, 2 signed uploads, image URI linked");

    // 2 price increase after estimate: refuse, nothing uploaded or funded
    S.balance = 0n; S.price = 1000;
    await start("Img Two");
    S.price = 5000;
    const b2 = await bundlerBal();
    await page.locator("#confirm").click();
    await page.waitForFunction(() => /price or balance changed/i.test(document.querySelector("#form-error").textContent), null, { timeout: 30000 });
    assert.equal(posts(), 0, "no upload"); assert.equal(dialogs.length, 0, "no funding prompt"); assert.equal(await bundlerBal(), b2, "no funds moved");
    console.log("PASS 2 price increase refused, no upload, no funding");
    S.price = 1000;

    // 3 account change after estimate: refuse
    S.balance = 0n;
    await start("Img Three");
    await page.evaluate((b) => window.__fire("accountChanged", window.solanaWeb3 && new window.solanaWeb3.PublicKey(b)), web3.Keypair.generate().publicKey.toBase58());
    await page.waitForTimeout(800);
    if (await page.locator("#confirm").isVisible()) { await page.locator("#confirm").click(); await page.waitForTimeout(1500); }
    assert.equal(posts(), 0, "no upload after account change"); assert.equal(dialogs.length, 0);
    assert.equal(await page.locator("#result h2").isVisible(), false);
    console.log("PASS 3 account change: estimate cleared or confirm refused, no upload/funding");

    // 4 retry after metadata upload failure: image not re-uploaded, funded once
    S.balance = 0n;
    await start("Img Four");
    S.failNext = 0;
    S.failAt = 2; S.postCount = 0;
    await page.locator("#confirm").click();
    await page.waitForFunction(() => document.querySelector("#form-error").textContent.length > 0, null, { timeout: 60000 });
    const firstErr = await errText();
    assert.equal(S.uploads.length, 1, "only image stored before failure");
    if (!(await page.locator("#confirm").isVisible())) { await page.locator("#primary").click(); await page.locator("#confirm").waitFor({ state: "visible", timeout: 30000 }); }
    await page.locator("#confirm").click();
    await page.locator("#result h2").waitFor({ timeout: 60000 });
    assert.equal(S.uploads.length, 2, "metadata stored exactly once after retry");
    assert.equal(S.funds.filter((f) => f.tx_id).length, 1, "funded once across retry");
    const imgs = S.bodies.filter((b) => b.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).length;
    assert.equal(imgs, 1, "image posted exactly once");
    console.log("PASS 4 retry after failure: image once, metadata once, funded once; first error:", firstErr);
    assert.equal(errors.length, 0, errors.join("\n"));
  } finally { await browser.close(); srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
