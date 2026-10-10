import { chromium } from "playwright";

const browser = await chromium.launch({ headless: false, channel: "chrome", args: [
  "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1200,900",
] });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("virtugenium.runtime-quality.v1", "LOW"));
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  const fps = () => page.evaluate(async () => {
    let frames = 0;
    const start = performance.now();
    await new Promise(resolve => {
      const frame = () => { frames++; performance.now() - start < 3000 ? requestAnimationFrame(frame) : resolve(); };
      requestAnimationFrame(frame);
    });
    return (frames / 3).toFixed(1);
  });
  console.log("quality", await page.evaluate(() => localStorage.getItem("virtugenium.runtime-quality.v1")));
  console.log("idle", await fps());
  for (const experiment of [3, 1]) {
    await page.getByRole("button", { name: `Опыт ${experiment}` }).click();
    await page.waitForTimeout(5000);
    console.log("experiment", experiment, await fps());
  }
} finally {
  await browser.close();
}
