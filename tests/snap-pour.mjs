// Game-view pour sequence. Run HIGH and LOW separately to keep one browser open.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const url = process.env.VISUAL_URL ?? "http://127.0.0.1:5173";
const quality = process.env.VISUAL_QUALITY ?? "HIGH";
const out = process.env.VISUAL_OUT ?? `tmp/visual/30b/${quality}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome",
  args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1600,900"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
page.on("console", message => {
  if (message.type() === "error" && /shader|webgl|program|THREE\.WebGL/i.test(message.text()))
    pageErrors.push(message.text());
});
await page.addInitScript(mode => localStorage.setItem("virtugenium.runtime-quality.v1", mode), quality);
await page.goto(url);
await page.getByText("Играть", { exact: true }).click();
await page.getByText("Песочница (временно)").click();
await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });

const pause = ms => page.waitForTimeout(ms);
async function fresh(id, ingredients, tilt = null) {
  await page.evaluate(async ({ id, ingredients, tilt }) => {
    const { useBurnerStore } = await import("/src/scenes/laboratory/lib/useBurnerStore.ts");
    useBurnerStore.getState().setLit(false);
    window.__heatingStore.getState().reset();
    const { standLocation } = await import("/src/scenes/laboratory/lib/standStationActions.ts");
    const location = standLocation();
    if (!location) throw new Error("Stand is not at a station");
    const key = location === "workbench" ? "workbenchTestTubes" : "fumeHoodTestTubes";
    window.__testTubeStorageStore.setState({ [key]: [{ instanceId: id, contents: [] }] });
    for (const ingredient of ingredients)
      window.__testTubeStorageStore.getState().addTubeContents(location, 0, ingredient);
    const { useTubeCloseUpStore } = await import("/src/scenes/laboratory/lib/useTubeCloseUpStore.ts");
    useTubeCloseUpStore.getState().setViewing(true);
    const { useTubeVisualTuningStore } = await import("/src/scenes/laboratory/lib/useTubeVisualTuningStore.ts");
    useTubeVisualTuningStore.setState({ tiltDegrees: tilt });
  }, { id, ingredients, tilt });
  await pause(1800);
  await assertIntact(id);
}
async function assertIntact(id) {
  const issue = await page.evaluate(async () => {
    const { standLocation } = await import("/src/scenes/laboratory/lib/standStationActions.ts");
    const location = standLocation();
    const tubes = location === "workbench" ? window.__testTubeStorageStore.getState().workbenchTestTubes : window.__testTubeStorageStore.getState().fumeHoodTestTubes;
    const notice = (await import("/src/scenes/laboratory/lib/useLabNoticeStore.ts")).useLabNoticeStore.getState().notice;
    return { tube: tubes?.[0], error: notice?.tone === "error" ? notice.text : null };
  });
  if (issue.error || issue.tube?.instanceId !== id || pageErrors.length)
    throw new Error(`Invalid setup for ${id}: ${JSON.stringify(issue)}; browser: ${pageErrors.join(" | ")}`);
}
async function capture(name, reagent) {
  const crops = [];
  const clip = name.endsWith("neg20") ? { x: 750, y: 80, width: 280, height: 600 }
    : name.endsWith("pos20") ? { x: 510, y: 270, width: 350, height: 440 }
      : { x: 700, y: 140, width: 230, height: 550 };
  await page.evaluate(() => {
    window.__pourFrameTimes = [];
    const begun = performance.now();
    const tick = now => {
      if (now - begun > 8000) return;
      window.__pourFrameTimes.push(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.evaluate(async value => {
    const { standLocation } = await import("/src/scenes/laboratory/lib/standStationActions.ts");
    window.__testTubeStorageStore.getState().addTubeContents(standLocation(), 0, value);
  }, reagent);
  if (process.env.VISUAL_BENCH === "1") {
    await pause(8000);
    const timings = await page.evaluate(() => window.__pourFrameTimes);
    const intervals = timings.slice(1).map((t, i) => t - timings[i]).sort((a, b) => a - b);
    const duration = timings.at(-1) - timings[0];
    console.log(`${name} ${quality} FPS (8 s, no screenshots): ${Math.round((timings.length - 1) * 1000 / duration)}; `
      + `median ${Math.round(1000 / intervals[Math.floor(intervals.length / 2)])}; frames ${timings.length}`);
    return;
  }
  const start = Date.now();
  const times = process.env.VISUAL_COPPER_TIMES === "1" && name === "hno3-copper"
    ? [2, 5, 10, 20]
    : [...Array.from({ length: 13 }, (_, i) => i * 0.25), 5, 8, 12];
  for (const t of times) {
    await pause(Math.max(0, start + t * 1000 - Date.now()));
    const frame = `${name}-${String(t).replace(".", "p")}s`;
    const png = await page.screenshot({ path: `${out}/${frame}.png` });
    crops.push({ frame, png });
  }
  if (quality === "LOW") {
    const fps = await page.evaluate(() => {
      const frames = window.__pourFrameTimes;
      return Math.round((frames.length - 1) * 1000 / (frames.at(-1) - frames[0]));
    });
    console.log(`${name} LOW FPS (0-8 s): ${fps}`);
  }
  // Crop from each saved frame after the timed sequence. A second live
  // screenshot would stall the animation between 0.25 s samples.
  for (const { frame, png } of crops) {
    const data = await page.evaluate(async ({ base64, clip }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = clip.width; canvas.height = clip.height;
      canvas.getContext("2d").drawImage(image, clip.x, clip.y, clip.width, clip.height,
        0, 0, clip.width, clip.height);
      return canvas.toDataURL("image/png").split(",")[1];
    }, { base64: png.toString("base64"), clip });
    await writeFile(`${out}/${frame}-tube.png`, Buffer.from(data, "base64"));
  }
}
const cases = [
  ["hno3-empty", "pour-empty", [], "hno3"],
  ["hno3-copper", "pour-copper", ["cu"], "hno3"],
  ["nacl-agno3", "pour-agcl", ["agno3"], "nacl"],
  ["kmno4-redox", "pour-redox", ["na2so3", "h2so4"], "kmno4"],
  ["hno3-empty-neg20", "pour-empty-neg20", [], "hno3", -20],
  ["hno3-empty-pos20", "pour-empty-pos20", [], "hno3", 20],
];
for (const [name, id, ingredients, reagent, tilt] of cases) {
  if (process.env.VISUAL_ONLY && process.env.VISUAL_ONLY !== name) continue;
  await fresh(id, ingredients, tilt);
  await page.screenshot({ path: `${out}/${name}-before.png` });
  await capture(name, reagent);
}
await browser.close();
