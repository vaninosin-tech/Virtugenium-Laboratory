// Снимки игрового вида (песочница, крупный план) — как видит игрок.
// node tests/visual/snap-live.mjs  → tmp/visual/live/
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const url = process.env.VISUAL_URL ?? "http://127.0.0.1:5173";
const out = process.env.VISUAL_OUT ?? "tmp/visual/live";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome",
  args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1600,900"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const wait = (s) => page.waitForTimeout(s * 1000);
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

await page.goto(url);
await page.getByText("Играть", { exact: true }).click();
await page.getByText("Песочница (временно)").click();
await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
await wait(2);
await page.evaluate(async () => {
  const closeUp = await import("/src/scenes/laboratory/lib/useTubeCloseUpStore.ts");
  closeUp.useTubeCloseUpStore.getState().setViewing(true);
  window.__testTubeStorageStore.setState({ fumeHoodTestTubes: [{ instanceId: "snap-water", contents: [] }] });
  window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, "hno3");
});
await wait(4); await shot("01-acid-only");
await page.evaluate(() => {
  window.__testTubeStorageStore.setState({ fumeHoodTestTubes: [{ instanceId: "snap-cu", contents: [] }] });
  window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, "cu");
  window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, "hno3");
  const hs = window.__heatingStore; hs.getState().reset(); hs.getState().enter(); hs.getState().grab();
  window.__f = setInterval(() => { const s = hs.getState(); s.setSweep(s.target); if (s.phase === "done") clearInterval(window.__f); }, 30);
});
for (const t of [8, 16, 24, 32]) { await wait(8); await shot(`02-copper-${t}s`); }
await browser.close();
