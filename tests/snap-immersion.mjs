import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const out = process.env.VISUAL_OUT ?? "tmp/visual/30d/immersion";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome",
  args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1600,900"] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /shader|webgl|program/i.test(message.text())) errors.push(message.text());
  });
  await page.goto(process.env.VISUAL_URL ?? "http://127.0.0.1:5173");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
  await page.evaluate(async () => {
    const { standLocation } = await import("/src/scenes/laboratory/lib/standStationActions.ts");
    const location = standLocation();
    if (!location) throw new Error("Stand is not at a station");
    const key = location === "workbench" ? "workbenchTestTubes" : "fumeHoodTestTubes";
    window.__testTubeStorageStore.setState({ [key]: [{ instanceId: "immersion-copper", contents: [] }] });
    window.__testTubeStorageStore.getState().addTubeContents(location, 0, "cu");
    window.__testTubeStorageStore.getState().addTubeContents(location, 0, "hno3");
    const { useTubeCloseUpStore } = await import("/src/scenes/laboratory/lib/useTubeCloseUpStore.ts");
    useTubeCloseUpStore.getState().setViewing(true);
    window.__tubeVisualTuningStore.setState({ enabled: true, progress: 0, rate: 0.1, temperature: 0 });
  });
  for (const progress of [0, 0.3, 0.6, 1]) {
    await page.evaluate(value => window.__tubeVisualTuningStore.setState({ progress: value }), progress);
    await page.waitForTimeout(2400);
    if (errors.length) throw new Error(errors.join(" | "));
    await page.screenshot({ path: `${out}/copper-p${String(progress).replace(".", "p")}.png` });
  }
} finally {
  await browser.close();
}
