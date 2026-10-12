import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const out = "tmp/50e/perf";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1200,900"] });
const results = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  page.setDefaultTimeout(120000);
  page.on("pageerror", error => console.log("pageerror", error.stack));
  page.on("console", message => { if (message.text().includes("Reaction shader warmup failed")) console.log("console", message.text()); });
  await page.addInitScript(() => localStorage.setItem("virtugenium.runtime-quality.v1", "LOW"));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
  await page.locator(".lab-boot-screen").waitFor({ state: "hidden", timeout: 120000 });
  await page.evaluate(async () => { const { useRuntimeQualityStore } = await import("/src/scenes/laboratory/lib/useRuntimeQualityStore.ts"); useRuntimeQualityStore.getState().setMode("LOW"); });
  for (const [exp, reagent] of [[1, "hno3"], [2, "nacl"], [3, "k2so4"], [4, "kmno4"]].filter(([exp]) => (!process.env.EXP || Number(process.env.EXP) === exp) && (!process.env.EXPS || process.env.EXPS.split(",").map(Number).includes(exp)))) {
    await page.evaluate(id => {
      window.__fpsTimes = [];
      window.__fpsPourAt = 0;
      window.__fpsUnsub?.();
      window.__fpsUnsub = window.__testTubeStorageStore.subscribe(state => {
        if (!window.__fpsPourAt && (state.fumeHoodTestTubes[0]?.contents ?? []).includes(id)) window.__fpsPourAt = performance.now();
      });
      if (window.__fpsLoop) cancelAnimationFrame(window.__fpsLoop);
      const tick = t => { window.__fpsTimes.push(t); window.__fpsLoop = requestAnimationFrame(tick); };
      window.__fpsLoop = requestAnimationFrame(tick);
    }, reagent);
    const cdp = process.env.PROFILE ? await page.context().newCDPSession(page) : null;
    if (cdp) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
    await page.getByRole("button", { name: `Опыт ${exp}`, exact: true }).click();
    await page.waitForFunction(() => window.__fpsPourAt > 0, null, { timeout: 120000, polling: 10 });
    await page.waitForTimeout(5000);
    if (cdp) { const profile = await cdp.send("Profiler.stop"); await writeFile(`${out}/exp${exp}-profile.json`, JSON.stringify(profile)); await cdp.detach(); }
    const result = await page.evaluate(() => {
      const start = window.__fpsPourAt;
      const stamps = window.__fpsTimes.filter(t => t >= start && t < start + 4000);
      const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
      const tube = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0];
      return { fps: stamps.length / 4, frames: stamps.length,
        maxGapMs: Math.max(0, ...gaps), medianGapMs: gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)],
        progress: window.__tubeReactionStore.getState().chemistryById[tube.instanceId]?.progress,
        prewarm: window.__prewarmInfo && { kind: window.__prewarmInfo.kind, before: window.__prewarmInfo.before, after: window.__prewarmInfo.after, visible: window.__prewarmInfo.visible, matching: window.__prewarmInfo.keys.filter(k => k.includes("tube-liquid-water") || k.includes("test-tube-coloured") || k.includes("tube-immersion")).map(k => k) },
        programsBefore: window.__warmProgramsBeforePour?.length,
        programsAfter: window.__three?.gl.info.programs?.length,
        newPrograms: window.__three?.gl.info.programs?.filter(p => !window.__warmProgramsBeforePour?.includes(p.cacheKey)).map(p => p.cacheKey) };
    });
    results.push({ exp, ...result });
    console.log(JSON.stringify({ exp: results.at(-1).exp, fps: results.at(-1).fps, maxGapMs: results.at(-1).maxGapMs, prewarm: [results.at(-1).prewarm?.before, results.at(-1).prewarm?.after], programs: [results.at(-1).programsBefore, results.at(-1).programsAfter] }));
  }
  await writeFile(`${out}/manifest.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
