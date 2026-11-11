const { chromium } = require("@playwright/test");
const { spawn } = require("child_process");
(async () => {
  const port = 5800 + Math.floor(Math.random() * 300);
  const srv = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  for (const [w, h, tag] of [[390, 900, "m"], [1280, 900, "d"]]) for (const dark of [false]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: dark ? "dark" : "light" });
    await page.goto("http://localhost:" + port); await page.waitForTimeout(500);
    for (const c of ["base", "ethereum", "polygon", "bnb chain", "solana"]) {
      await page.locator(".chains button", { hasText: new RegExp("^" + c + "$", "i") }).click();
      await page.locator("#name").fill("My Coin"); await page.locator("#symbol").fill("MYC"); await page.locator("#supply").fill("1000000");
      if (c === "solana") { await page.locator("#pausable").check(); await page.locator("#mintable").check(); await page.locator("#uri-field summary").click(); }
      await page.screenshot({ path: "/tmp/shot-" + tag + "-" + c.replace(" ", "") + ".png", fullPage: true });
    }
    await page.close();
  }
  await browser.close(); srv.kill();
})();
