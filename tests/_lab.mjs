import { chromium } from "playwright";
const [out = "D:/Claude/virtugenium-night/frames/lab.png", query = ""] = process.argv.slice(2);
const browser = await chromium.launch({ headless: false, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
  page.on("console", m => { if (m.type() === "error") console.log("console", m.text().slice(0, 800)); });
  await page.goto(`http://127.0.0.1:5201/cotton-lab.html?${query}`, { waitUntil: "commit", timeout: 60000 });
  await page.waitForFunction(() => document.title === "done" || document.title === "ERR", null, { timeout: 120000 });
  console.log("title", await page.title());
  await page.screenshot({ path: out });
} finally { await browser.close(); }
