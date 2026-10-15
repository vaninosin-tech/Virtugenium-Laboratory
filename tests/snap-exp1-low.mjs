import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { freezeTubeFrame, renderTubeFrame, tubeTopView, thawTubeFrame } from "./frozenTubeFrame.mjs";

const out = process.env.VISUAL_OUT ?? "tmp/visual/32/LOW";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome",
  args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1600,900"] });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("virtugenium.runtime-quality.v1", "LOW"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /shader|webgl|program/i.test(message.text())) errors.push(message.text());
  });
  await page.goto(process.env.VISUAL_URL ?? "http://127.0.0.1:5173");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
  await page.waitForFunction(async () => {
    const { useLabBootStore } = await import("/src/features/lab-boot/lib/useLabBootStore.ts");
    return useLabBootStore.getState().phase === "done";
  }, null, { timeout: 90000 });
  await page.waitForFunction(async () => {
    const { standLocation } = await import("/src/scenes/laboratory/lib/standStationActions.ts");
    return !!standLocation();
  }, null, { timeout: 90000 });
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
    const stem = `${out}/copper-p${String(progress).replace(".", "p")}`;
    await freezeTubeFrame(page);
    await renderTubeFrame(page, `${stem}.png`);
    if (progress === 0.6 && process.env.VISUAL_DIAG === "1") {
      await page.evaluate(() => {
        const materials = new Set();
        window.__three.scene.traverse(o => {
          if (o.name === "TubeRefractedBackdrop") materials.add(o.material);
        });
        window.__rawBackgroundRestore = [];
        for (const m of materials) {
          const compile = m.onBeforeCompile, key = m.customProgramCacheKey;
          m.onBeforeCompile = (shader, renderer) => {
            compile.call(m, shader, renderer);
            shader.fragmentShader = shader.fragmentShader.replace("backdrop = transmitThroughTube(backdrop);", "");
          };
          m.customProgramCacheKey = () => key.call(m) + "-raw-diagnostic";
          m.needsUpdate = true;
          window.__rawBackgroundRestore.push(() => {
            m.onBeforeCompile = compile; m.customProgramCacheKey = key; m.needsUpdate = true;
          });
        }
      });
      await renderTubeFrame(page, `${stem}-raw-background.png`);
      for (const [label, names] of [
        ["cap", ["TubeLiquidSurface"]], ["backdrop", ["TubeRefractedBackdrop", "TubeRefractedSurface"]],
        ["gas", ["TubeNO2Headspace", "TubeNO2"]], ["foam", ["TubeSurfaceFoam"]],
        ["condensate", ["TubeCondensate"]], ["glass", ["Tube_Glass"]],
        ["glass-backdrop", ["TubeGlassRefractedBackdrop"]], ["caustics", ["TubeBottomCaustic", "TubeStandCaustic"]],
      ]) {
        await page.evaluate(names => {
          window.__hiddenTubeLayers = [];
          window.__three.scene.traverse(o => {
            if (names.includes(o.name)) { window.__hiddenTubeLayers.push([o, o.visible]); o.visible = false; }
          });
        }, names);
        await renderTubeFrame(page, `${stem}-raw-no-${label}.png`);
        await page.evaluate(() => window.__hiddenTubeLayers.forEach(([o, visible]) => { o.visible = visible; }));
      }
      await page.evaluate(() => window.__rawBackgroundRestore.forEach(restore => restore()));
      await renderTubeFrame(page, `${stem}-solution-background.png`);
    }
    if (progress > 0) {
      await tubeTopView(page);
      await renderTubeFrame(page, `${stem}-top.png`);
    }
    await thawTubeFrame(page);
  }
  const fps = await page.evaluate(() => new Promise(resolve => {
    let frames = 0;
    let first;
    const tick = now => {
      if (first === undefined) first = now;
      frames++;
      if (now - first < 5000) requestAnimationFrame(tick);
      else resolve(Math.round((frames - 1) * 1000 / (now - first)));
    };
    requestAnimationFrame(tick);
  }));
  console.log(`exp1 LOW FPS (5 s without screenshots): ${fps}`);
} finally {
  await browser.close();
}
