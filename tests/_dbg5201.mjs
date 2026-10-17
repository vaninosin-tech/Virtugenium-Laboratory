import { chromium } from "playwright";
const browser = await chromium.launch({ headless: false, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on("pageerror", e => console.log("pageerror", e.message.slice(0, 500)));
page.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.log(m.type(), m.text().slice(0, 400)); });
await page.addInitScript("window.__silverStage=3;"); await page.goto("http://127.0.0.1:5201");
await page.getByText("Играть", { exact: true }).click();
await page.getByText("Песочница (временно)").click();
await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
await page.locator(".lab-boot-screen").waitFor({ state: "hidden", timeout: 120000 });
await page.waitForTimeout(2000);
console.log("ready");
const t0 = Date.now();
page.getByRole("button", { name: "Опыт 2", exact: true }).click({ timeout: 170000 }).then(() => console.log("clicked", Date.now() - t0)).catch(e => console.log("click failed", e.message.slice(0, 120)));
for (let i = 0; i < 40; i++) { await page.waitForTimeout(4000); const r = await Promise.race([page.evaluate(() => performance.now()).then(v => "alive " + Math.round(v)), new Promise(r => setTimeout(() => r("BLOCKED"), 2500))]); console.log(r); }
await browser.close();
