import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const quality = process.env.VISUAL_QUALITY ?? "HIGH";
const out = process.env.VISUAL_OUT ?? `tmp/visual/36/${quality}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome",
  args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1600,900"] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /shader|webgl|program/i.test(message.text())) errors.push(message.text());
  });
  await page.addInitScript(mode => localStorage.setItem("virtugenium.runtime-quality.v1", mode), quality);
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  try {
    await page.waitForFunction(() => ["inspecting", "focusing"].includes(
      window.__sceneStore?.getState().cabinetPhase), null, { timeout: 45000 });
  } catch (error) {
    await page.screenshot({ path: `${out}/boot-timeout.png` });
    console.log("boot state", await page.evaluate(() => ({
      phase: window.__sceneStore?.getState().cabinetPhase,
      title: document.title,
      body: document.body.innerText.slice(0, 500),
    })), errors);
    throw error;
  }
  await page.waitForFunction(async () => {
    const { useLabBootStore } = await import("/src/features/lab-boot/lib/useLabBootStore.ts");
    return useLabBootStore.getState().phase === "done";
  }, null, { timeout: 90000 });
  await page.waitForTimeout(10000);
  await page.getByText("Лаборатория готова").waitFor({ state: "hidden", timeout: 90000 });
  await page.evaluate(async mode => {
    const { useRuntimeQualityStore } = await import("/src/scenes/laboratory/lib/useRuntimeQualityStore.ts");
    useRuntimeQualityStore.getState().setMode(mode);
  }, quality);

  async function fresh(id, ingredients) {
    await page.evaluate(async ({ id, ingredients }) => {
      const { standLocation } = await import("/src/scenes/laboratory/lib/standStationActions.ts");
      const location = standLocation();
      if (!location) throw new Error("Stand is not at a station");
      const key = location === "workbench" ? "workbenchTestTubes" : "fumeHoodTestTubes";
      window.__testTubeStorageStore.setState({ [key]: [{ instanceId: id, contents: [] }] });
      for (const ingredient of ingredients)
        window.__testTubeStorageStore.getState().addTubeContents(location, 0, ingredient);
      window.__tubeVisualTuningStore.setState({ enabled: false });
    }, { id, ingredients });
    await page.waitForTimeout(1800);
  }
  async function add(reagent) {
    await page.evaluate(async value => {
      const { standLocation } = await import("/src/scenes/laboratory/lib/standStationActions.ts");
      window.__testTubeStorageStore.getState().addTubeContents(standLocation(), 0, value);
    }, reagent);
  }
  async function shot(name) {
    await page.screenshot({ path: `${out}/${name}.png` });
    if (errors.length) throw new Error(errors.join(" | "));
  }
  async function sequence(prefix, times) {
    const start = Date.now();
    for (const seconds of times) {
      await page.waitForTimeout(Math.max(0, start + seconds * 1000 - Date.now()));
      await shot(`${prefix}-${seconds}s`);
    }
  }

  if (process.env.VISUAL_ONLY !== "agcl") {
    await fresh("absorption-copper", ["cu", "hno3"]);
    for (const progress of [0.3, 0.6, 1]) {
      await page.evaluate(value => window.__tubeVisualTuningStore.setState({ enabled: true,
        progress: value, rate: 0.1, temperature: 0 }), progress);
      await page.waitForTimeout(8500);
      await shot(`copper-p${String(progress).replace(".", "p")}`);
    }
  }
  await fresh("absorption-agcl", ["agno3"]);
  await add("nacl");
  await sequence("nacl-agno3", [1, 3, 12]);
  if (process.env.VISUAL_ONLY !== "agcl") {
    await fresh("absorption-baso4", ["bacl2"]);
    await add("k2so4");
    await sequence("baso4", [2, 8]);
    await fresh("absorption-redox", ["na2so3", "h2so4"]);
    await add("kmno4");
    await sequence("kmno4-redox", [2, 5, 8, 12]);
  }
  if (quality === "LOW") {
    const fps = await page.evaluate(() => new Promise(resolve => {
      const start = performance.now(); let frames = 0;
      function tick(now) { frames++; if (now - start < 5000) requestAnimationFrame(tick);
        else resolve(Math.round(frames * 1000 / (now - start))); }
      requestAnimationFrame(tick);
    }));
    console.log(`LOW FPS: ${fps}`);
  }
  console.log(`Captured ${quality} in ${out}`);
} finally {
  await browser.close();
}
