// Persistent headed browser for step-by-step play; scripts attach over CDP (port 9333).
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: false, channel: "chrome",
  args: ["--remote-debugging-port=9333", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1600,900"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console.error", m.text().slice(0, 300)); });
await page.goto("http://127.0.0.1:5173");
console.log("ready");
await new Promise(() => {});
