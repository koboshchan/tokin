const { chromium } = require("@playwright/test");
const { spawn } = require("child_process");
(async () => {
  const port = 4300 + Math.floor(Math.random() * 500);
  const srv = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(() => {
    const known = new Set(["0x2105"]); let cur = "0x2105"; window.__log = [];
    const eth = { on() {}, async request({ method, params }) {
      window.__log.push(method + (params?.[0]?.chainId ? ":" + params[0].chainId : ""));
      switch (method) {
        case "eth_requestAccounts": case "eth_accounts": return ["0x1111111111111111111111111111111111111111"];
        case "eth_chainId": return cur;
        case "wallet_switchEthereumChain": if (!known.has(params[0].chainId)) { const e = new Error("unrecognized"); e.code = 4902; throw e; } cur = params[0].chainId; return null;
        case "wallet_addEthereumChain": known.add(params[0].chainId); return null; // does not switch
        case "eth_getBlockByNumber": return { number: "0x1", baseFeePerGas: "0x3b9aca00", timestamp: "0x1", hash: "0x" + "0".repeat(64), parentHash: "0x" + "0".repeat(64), gasLimit: "0x1c9c380", gasUsed: "0x0", miner: "0x" + "0".repeat(40), transactions: [], difficulty: "0x0", nonce: "0x0000000000000000", extraData: "0x" };
        case "eth_gasPrice": return "0x3b9aca00";
        case "eth_maxPriorityFeePerGas": return "0x1";
        case "eth_estimateGas": return "0x7a120";
        case "eth_getTransactionCount": return "0x0";
        case "net_version": return String(parseInt(cur, 16));
        default: return null;
      }
    } };
    window.ethereum = eth;
  });
  const ok = (c, m) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else console.log("ok", m); };
  await page.goto("http://localhost:" + port);
  await page.waitForTimeout(600);
  ok((await page.locator(".chains button").count()) === 5, "five chains");
  await page.fill("#name", "T"); await page.fill("#symbol", "TT"); await page.fill("#supply", "1000");
  await page.click("#connect"); await page.waitForTimeout(300);
  ok((await page.textContent("#wallet-status")).includes("base"), "connected on base");
  // seed per-chain storage
  await page.evaluate(() => { const a = "0x1111111111111111111111111111111111111111"; localStorage.setItem("tokin:v1:137:" + a, JSON.stringify([{ address: "0x2222222222222222222222222222222222222222", name: "Poly", symbol: "PLY", supply: "1", mintable: false }])); });
  await page.click("text=polygon"); await page.waitForTimeout(300);
  ok((await page.textContent("#coin-note")).includes("switch to polygon"), "coins prompt switch");
  await page.click("#primary"); await page.waitForTimeout(1500);
  const log = await page.evaluate(() => window.__log.join(","));
  ok(/wallet_addEthereumChain:0x89/.test(log) && /wallet_switchEthereumChain:0x89.*wallet_addEthereumChain:0x89.*wallet_switchEthereumChain:0x89/.test(log), "add then explicit switch: " + log);
  const est = await page.textContent("#estimate").catch(() => "");
  ok(/pol/.test(est) && !/l1 data/.test(est), "pol fee label, no l1 note: " + est.slice(0, 80));
  await page.click("text=ethereum");
  ok(await page.locator("#estimate").isHidden(), "estimate cleared on chain change");
  await page.click("text=solana"); await page.waitForTimeout(200);
  ok(await page.locator("#cap-field").isHidden() && await page.locator("#burnable-box").isHidden(), "cap + burn toggle hidden on solana");
  ok((await page.textContent("#pausable-label")) === "freezable", "freezable label");
  ok(await page.locator("#sol-note").isVisible(), "freeze note");
  await page.click("#primary"); await page.waitForTimeout(300);
  ok((await page.textContent("#form-error")).length > 0, "solana requires image/uri: " + (await page.textContent("#form-error")));
  await page.click("text=base");
  ok((await page.textContent("#sub")).includes("base"), "back to base");
  ok(errs.length === 0, "no page errors " + errs.join("|"));
  await browser.close(); srv.kill();
})();
