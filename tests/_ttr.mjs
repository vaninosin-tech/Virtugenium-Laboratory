import { chromium } from "playwright";
const browser = await chromium.launch({ headless: false, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const t0 = Date.now();
await page.goto("http://127.0.0.1:5201/experiment-lab.html?t=0", { waitUntil: "commit" });
await page.waitForFunction(() => document.title === "ready", null, { timeout: 200000 });
console.log("stand ready after", ((Date.now() - t0) / 1000).toFixed(1), "s");
await browser.close();
