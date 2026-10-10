import { chromium } from "playwright";
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1200,900"] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  const fps = () => page.evaluate(async () => { let n = 0; const t0 = performance.now(); await new Promise(r => { const f = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }); return (n / 3).toFixed(1); });
  console.log("idle", await fps());
  for (const e of [3, 1]) {
    await page.getByRole("button", { name: `Опыт ${e}` }).click();
    await page.waitForTimeout(5000);
    console.log("exp", e, await fps());
  }
  console.log("quality", await page.evaluate(() => localStorage.getItem("quality") ?? document.documentElement.dataset.quality ?? "?"));
} finally { await browser.close(); }
