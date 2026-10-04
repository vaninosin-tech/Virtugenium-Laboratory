// Снимки образования AgCl крупным планом (игровой вид).
// node tests/visual/snap-stand.mjs  → tmp/visual/agcl/
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const url = process.env.VISUAL_URL ?? "http://127.0.0.1:5173";
const out = process.env.VISUAL_OUT ?? "tmp/visual/agcl";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome",
  args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1600,900"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
await page.addInitScript(() => localStorage.setItem("virtugenium.runtime-quality.v1", "LOW"));
page.on("pageerror", (e) => console.log("pageerror", e.message));
const wait = (s) => page.waitForTimeout(s * 1000);
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for toggling the burner by hand
const burner = (lit) => page.evaluate(async (lit) => {
  const m = await import("/src/scenes/laboratory/lib/useBurnerStore.ts");
  if (lit === "open") m.useBurnerStore.setState({ phase: "open", lit: false });
  else m.useBurnerStore.getState().setLit(lit);
}, lit);

await page.goto(url);
await page.getByText("Играть", { exact: true }).click();
await page.getByText("Песочница (временно)").click();
await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
await page.evaluate(async () => {
  const closeUp = await import("/src/scenes/laboratory/lib/useTubeCloseUpStore.ts");
  closeUp.useTubeCloseUpStore.getState().setViewing(true);
  window.__testTubeStorageStore.setState({ fumeHoodTestTubes: [{ instanceId: "snap-agcl", contents: [] }] });
  window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, "agno3");
});
await wait(3);
await page.evaluate(() => window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, "nacl"));
for (const t of [0.5, 1.5, 3, 5, 8, 12, 20, 40]) {
  await wait(t - (globalThis.__last ?? 0)); globalThis.__last = t;
  await shot(`agcl-${String(t).padStart(4, "0")}s`);
}
await browser.close();
