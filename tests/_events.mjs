import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const out = process.env.OUT ?? "D:/Claude/virtugenium-night/frames/events";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--window-size=1400,950", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(900000);
  await page.addInitScript(`window.__silverStage=3; window.__silverDiag=${JSON.stringify(process.env.DIAG ?? "tracer")};`);
  await page.goto("http://127.0.0.1:5201/");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 300000 });
  await page.locator(".lab-boot-screen").waitFor({ state: "hidden", timeout: 300000 });
  await page.waitForTimeout(2500);
  // In-page logger: samples every 40 ms with the page's own clock, independent of screenshots.
  await page.evaluate(async () => {
    const imp = await import("/src/scenes/laboratory/lib/tubePourImpact.ts");
    const am = await import("/src/scenes/laboratory/lib/tubeAmounts.ts");
    const sm = await import("/src/scenes/laboratory/lib/useStandMotionStore.ts");
    window.__ev = []; window.__t0 = performance.now();
    window.__logStop = false;
    const sample = () => {
      const tube = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0];
      const id = tube?.instanceId, i = id ? imp.tubePourImpact(id) : undefined, f = window.__silverFieldLive;
      let tr = 0, depth = 0, top = -1e9, minD = 1e9, lat = 0;
      if (f) { const m = f.mask;
        for (let a = 0; a < m.activeCount; a++) { const c = m.active[a]; const y = Math.floor(c / m.nx) % m.ny; top = Math.max(top, m.bottom + (y + 0.5) / m.ny * m.height); }
        for (let a = 0; a < m.activeCount; a++) { const c = m.active[a]; const y = Math.floor(c / m.nx) % m.ny; const py = m.bottom + (y + 0.5) / m.ny * m.height; tr += f.tracer[c]; depth += f.tracer[c] * (top - py); if (f.tracer[c] > 1e-9) minD = Math.min(minD, top - py); } }
      const p = sm.useStandMotionStore.getState().pour;
      window.__ev.push({ t: (performance.now() - window.__t0) / 1000, pourK: p ? (Date.now() - p.at) / sm.POUR_MS : null, pourId: p ? p.instanceId : null,
        volume: id ? am.tubeAmount(id).volumeMl : null, contents: tube ? tube.contents.join("+") : null,
        impact: i ? { y: +(i.point.y * 1000).toFixed(2), x: +(i.point.x * 1000).toFixed(2), z: +(i.point.z * 1000).toFixed(2), ml: +i.deliveredMl.toFixed(3), flow: +i.flowMlPerSecond.toFixed(3) } : null,
        fieldDelivered: f ? +f.delivered.toFixed(4) : null, tracer: +tr.toFixed(5), tracerDepthMm: tr > 1e-9 ? +(depth / tr * 1000).toFixed(2) : null, tracerTopMm: tr > 1e-9 ? +(minD * 1000).toFixed(2) : null, extent: f ? +f.extent.toFixed(5) : null, surfaceMm: +((top) * 1000).toFixed(2) });
      if (!window.__logStop) setTimeout(sample, 40);
    };
    sample();
  });
  const real = (reagent) => page.evaluate(async (id) => {
    const { runStandAction } = await import("/src/scenes/laboratory/lib/standTableActions.ts");
    window.__marks = window.__marks ?? []; window.__marks.push({ what: "click " + id, t: (performance.now() - window.__t0) / 1000 });
    return runStandAction({ kind: "bottle", location: "fumeHood", reagentId: id, instanceId: `sandbox-jar-${id}` });
  }, reagent);
  // Native-rate screen recording through the DevTools screencast: it does not block the page like screenshots do.
  const cdp = await page.context().newCDPSession(page);
  const frames = []; let recording = false;
  cdp.on("Page.screencastFrame", async (f) => { if (recording) frames.push({ t: f.metadata.timestamp, data: f.data }); try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {} });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
  await real("agno3");
  await page.waitForTimeout(7000);
  if (process.env.PREWARM === "1") { await page.evaluate(async () => { const v = await import("/src/scenes/laboratory/lib/tubeReactionVisuals.ts"); const t = window.__three; await v.prewarmBariumLiquidShader(t.gl, t.scene, t.camera, "silver-chloride"); }); await page.waitForTimeout(2000); }
  recording = true; const recT0 = Date.now() / 1000;
  await real("nacl");
  await page.waitForTimeout(Number(process.env.SECONDS ?? 14) * 1000);
  recording = false;
  await mkdir(`${out}/frames`, { recursive: true });
  const idx = [];
  for (let k = 0; k < frames.length; k++) { const fn = `${out}/frames/s${String(k).padStart(5, "0")}.jpg`; await writeFile(fn, Buffer.from(frames[k].data, "base64")); idx.push({ fn: fn.split("/").pop(), t: frames[k].t - (frames[0] ? frames[0].t : 0) }); }
  await writeFile(`${out}/frames/index.json`, JSON.stringify({ recT0, firstT: frames[0]?.t, idx }));
  const ledger = await page.evaluate(async () => { const d = await import("/src/scenes/laboratory/lib/tubeDelivery.ts"); const id = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0].instanceId; return d.deliveryEvents(id).map(e => ({ serial: e.serial, step: e.step, ml: +e.ml.toFixed(4), req: e.requestedMl && +e.requestedMl.toFixed(4), atMs: Math.round(e.atMs), valid: e.valid, reason: e.reason, y: +(e.point.y*1000).toFixed(2), surf: +(e.surfaceY*1000).toFixed(2) })); });
  await writeFile(`${out}/ledger.json`, JSON.stringify(ledger));
  const data = await page.evaluate(() => { window.__logStop = true; return { events: window.__ev, marks: window.__marks }; });
  await writeFile(`${out}/events.json`, JSON.stringify(data));
  console.log("events", data.events.length, "marks", JSON.stringify(data.marks));
} finally { await browser.close(); }
