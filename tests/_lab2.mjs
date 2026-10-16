import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const out = process.env.OUT ?? "D:/Claude/virtugenium-night/frames/exp";
const times = (process.env.TIMES ?? "1,2,3,4,5,6,8,10,14").split(",").map(Number);
const pour = process.env.POUR ?? "slow";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on("pageerror", e => console.log("pageerror", e.message.slice(0, 400)));
  page.on("console", m => { if (m.type() === "error") console.log("console", m.text().slice(0, 500)); });
  await page.goto(`http://127.0.0.1:5201/experiment-lab.html?t=0&view=${process.env.VIEW ?? "material"}&pour=${pour}&voff=${process.env.VOFF ?? 0}`, { waitUntil: "commit", timeout: 60000 });
  await page.waitForFunction(() => document.title === "ready", null, { timeout: 120000 });
  for (const t of times) {
    await page.evaluate(x => window.__labSeek(x), t);
    await page.screenshot({ path: `${out}/t${String(t).replace(".", "_")}.png` });
    console.log("shot", t, JSON.stringify(await page.evaluate(() => window.__labState())));
  }
  if (process.env.KEEPOPEN) await page.waitForTimeout(Number(process.env.KEEPOPEN));
} finally { await browser.close(); }
