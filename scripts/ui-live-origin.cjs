// Estimate from the real launch.kjt.lol origin (dist served via route) against REAL mainnet read RPC + Irys price. No signing, no funds.
const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const web3 = require("@solana/web3.js");
(async () => {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const reqs = [], fails = [];
    page.on("request", (r) => reqs.push(r.method() + " " + r.url()));
    page.on("response", (r) => { if (/solana|irys/.test(r.url()) && r.status() >= 400) fails.push(r.status() + " " + r.url()); });
    if (process.env.BLOCK_PRIMARY) await page.route("https://solana-rpc.publicnode.com/**", (r) => r.fulfill({ status: 403, contentType: "application/json", body: "{}" }));
    const fs = require("fs"), path = require("path"), dist = path.resolve(__dirname, "../dist");
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
    await page.route("https://launch.kjt.lol/**", async (route) => {
      let p = decodeURIComponent(new URL(route.request().url()).pathname); if (p.endsWith("/")) p += "index.html";
      const f = path.join(dist, p); if (!f.startsWith(dist) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: "nf" });
      await route.fulfill({ status: 200, contentType: types[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
    });
    page.on("pageerror", (e) => console.error("pageerror", e.message)); page.on("console", (m) => m.type() === "error" && console.error("console", m.text()));
    const pub = web3.Keypair.generate().publicKey.toBase58();
    await page.addInitScript({ content: require("fs").readFileSync(require.resolve("@solana/web3.js/lib/index.iife.min.js"), "utf8") + ";window.solanaWeb3=solanaWeb3;" });
    await page.addInitScript((pub) => { window.phantom = { solana: { isPhantom: true, isConnected: false, publicKey: null,
      async connect() { this.isConnected = true; this.publicKey = new window.solanaWeb3.PublicKey(pub); return { publicKey: this.publicKey }; },
      async disconnect() {}, on() {}, async signMessage() { throw new Error("no signing in test"); }, async signTransaction() { throw new Error("no signing"); }, async signAndSendTransaction() { throw new Error("no send"); } } }; }, pub);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    for (const mode of ["image", "uri"]) {
      reqs.length = 0; fails.length = 0;
      await page.goto("https://launch.kjt.lol/"); await page.waitForTimeout(500);
      await page.locator(".chains button", { hasText: /^solana$/ }).click();
      await page.locator("#name").fill("Live " + mode); await page.locator("#symbol").fill("LV"); await page.locator("#supply").fill("100");
      if (mode === "image") await page.locator("#image").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: png });
      else await page.locator("#uri").evaluate((e, v) => { e.parentElement.parentElement.open = true; e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }, "https://example.com/m.json");
      await page.locator("#connect").click();
      await page.waitForFunction(() => !/no wallet/.test(document.querySelector("#wallet-status").textContent), null, { timeout: 15000 });
      await page.locator("#primary").click();
      await page.locator("#confirm").waitFor({ state: "visible", timeout: 45000 }).catch(async (e) => { console.error("TIMEOUT formerror=", await page.textContent("#form-error"), "\nreqs:", reqs.slice(-15).join("\n")); throw e; });
      const est = await page.locator("#estimate").innerText();
      const sol = reqs.filter((r) => /solana|irys|publicnode|vibestation/.test(r));
      assert.ok(!sol.some((r) => r.includes("mainnet-beta")), "blocked endpoint requested");
      assert.ok(sol.some((r) => r.includes("solana-rpc.publicnode.com")), "default rpc used");
      if (mode === "image") assert.ok(sol.some((r) => r.includes("uploader.irys.xyz/price")), "irys price requested");
      console.log("PASS " + mode + " estimate ok; failures:", JSON.stringify(fails), "\n" + est.slice(0, 300) + "\n" + [...new Set(sol.map((r) => r.slice(0, 90)))].join("\n"));
    }
    // custom rpc validation
    await page.locator("#rpc").evaluate((e) => { e.parentElement.parentElement.open = true; });
    await page.locator("#rpc").fill("http://evil.example"); await page.locator("#rpc").blur();
    assert.match(await page.textContent("#form-error"), /https/);
    await page.locator("#rpc").fill("https://api.mainnet-beta.solana.com"); await page.locator("#rpc").blur();
    assert.match(await page.textContent("#form-error"), /blocks browser/);
    console.log("PASS custom rpc validation");
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
