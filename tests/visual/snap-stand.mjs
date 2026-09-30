// Снимки нового штатива и спиртовки в вытяжке: общий вид и крупный план.
// node tests/visual/snap-stand.mjs  → tmp/visual/stand/
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const url = process.env.VISUAL_URL ?? "http://127.0.0.1:5173";
const out = process.env.VISUAL_OUT ?? "tmp/visual/stand";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome",
  args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1600,900"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
const wait = (s) => page.waitForTimeout(s * 1000);
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const burner = (lit) => page.evaluate(async (lit) => {
  const m = await import("/src/scenes/laboratory/lib/useBurnerStore.ts");
  if (lit === "open") m.useBurnerStore.setState({ phase: "open", lit: false });
  else m.useBurnerStore.getState().setLit(lit);
}, lit);

await page.goto(url);
await page.getByText("Играть", { exact: true }).click();
await page.getByText("Песочница (временно)").click();
await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
await page.evaluate(() => {
  window.__testTubeStorageStore.setState({ fumeHoodTestTubes: [{ instanceId: "snap-cu", contents: [] }] });
  window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, "cu");
  window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, "hno3");
});
await burner(false); await wait(3); await shot("01-hood-capped");
await burner("open"); await wait(2); await shot("02-hood-open");
await burner(true); await wait(2); await shot("03-hood-lit");
await page.evaluate(async () => {
  const closeUp = await import("/src/scenes/laboratory/lib/useTubeCloseUpStore.ts");
  closeUp.useTubeCloseUpStore.getState().setViewing(true);
});
await wait(3); await shot("04-closeup-lit");
await page.evaluate(() => {
  const hs = window.__heatingStore; hs.getState().reset(); hs.getState().enter(); hs.getState().grab();
  hs.getState().setSweep(1);
});
await wait(2); await shot("05-heating-tilted");
await burner(false); await wait(2); await shot("06-capped-again");
await browser.close();
