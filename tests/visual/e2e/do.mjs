// node tmp/visual/e2e/do.mjs <shotName> '<js body using page, wait, shot>'
import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const page = browser.contexts()[0].pages()[0];
const wait = (s) => page.waitForTimeout(s * 1000);
const shot = (n) => page.screenshot({ path: `tmp/visual/e2e/${n}.png` });
const buttons = async () => console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("button")].filter(b => b.offsetParent).map(b => b.innerText.trim().replace(/\s+/g, " ")).filter(Boolean))));
await import("./kb.js");
const body = process.argv[3] ?? "";
await (new Function("page", "wait", "shot", "buttons", `return (async () => { ${body} })();`))(page, wait, shot, buttons);
if (process.argv[2]) await shot(process.argv[2]);
await buttons();
process.exit(0);
