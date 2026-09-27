import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Run only against a stable dev build: node tests/visual/reactions.mjs
// Kinetics use real wall time, never clock fast-forward or chemistry writes.
const url = process.env.VISUAL_URL ?? "http://localhost:5173";
const out = resolve(process.env.VISUAL_OUT ?? "tmp/visual");
const viewport = { width: 1600, height: 900 };
// Existing close-ups place the tube at x=800, y=100..650. Include its whole
// +/-20 degree swing and the plume; the previous 200px crop cut off tilts.
const crop = { x: 480, y: 0, width: 640, height: 850 };
const tubeCrop = { x: 725, y: 110, width: 150, height: 700 };
const times = [0, 1, 3, 6, 12, 30];
const cases = {
  "copper-nitric": ["cu", "hno3"],
  "silver-chloride": ["agno3", "nacl"],
  "barium-sulfate": ["bacl2", "k2so4"],
  "permanganate-redox": ["kmno4", "h2so4", "na2so3"],
};
// Iteration: VISUAL_CASE=copper-nitric VISUAL_QUALITY=HIGH VISUAL_QUICK=1
// QUICK captures only the first 6s of live kinetics (cold + heat for Cu).
const selectedCases = process.env.VISUAL_CASE ? process.env.VISUAL_CASE.split(",") : Object.keys(cases);
const qualities = process.env.VISUAL_QUALITY ? process.env.VISUAL_QUALITY.split(",") : ["HIGH", "LOW"];
const quick = process.env.VISUAL_QUICK === "1";
for (const kind of selectedCases) if (!(kind in cases)) throw new Error(`Unknown VISUAL_CASE: ${kind}`);
for (const quality of qualities) if (!["HIGH", "LOW"].includes(quality)) throw new Error(`Unknown VISUAL_QUALITY: ${quality}`);
const angle = process.env.VISUAL_ANGLE ?? (process.platform === "win32" ? "d3d11" : "swiftshader");
const frames = [], errors = [], traces = [], events = [], performanceSamples = [];
let server, browser, page, captureSession, failure;
const reachable = async () => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; }
  catch { return false; }
};

async function settle(ms = 500) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function shot(name, group, timing = {}) {
  // No hidden settling: it would erase early kinetics and transient slosh.
  const before = await page.evaluate(() => window.__reactionCapture.read());
  const { data } = await captureSession.send("Page.captureScreenshot", {
    format: "png", fromSurface: true, optimizeForSpeed: true, captureBeyondViewport: false,
  });
  const after = await page.evaluate(() => window.__reactionCapture.read());
  // Timestamp acquisition before disk I/O. Decode only the PNG transport;
  // preserve the full captured pixels without cropping or image processing.
  await writeFile(resolve(out, `${name}.png`), Buffer.from(data, "base64"));
  // Native Chromium clipping keeps the fine detail in the tube without
  // enlarging a downsampled contact sheet.
  if (name.includes("-HIGH-") && (name.endsWith("-3s") || name.endsWith("-6s")
    || name.endsWith("-12s") || name.endsWith("-0") || name.endsWith("-before") || name.endsWith("-peak"))) {
    const close = await captureSession.send("Page.captureScreenshot", {
      format: "png", fromSurface: true, captureBeyondViewport: false,
      clip: { ...tubeCrop, scale: 1 },
    });
    await writeFile(resolve(out, `${name}-tube.png`), Buffer.from(close.data, "base64"));
  }
  frames.push({ name, group, ...timing, before, after,
    elapsedSeconds: timing.originMs == null ? null : (before.nowMs - timing.originMs) / 1000,
    completionAgeSeconds: before.completedAtMs == null ? null : (before.nowMs - before.completedAtMs) / 1000,
    latenessMs: timing.originMs == null ? null : before.nowMs - timing.originMs - timing.targetSeconds * 1000,
    screenshotDurationMs: after.nowMs - before.nowMs });
  console.log(`${name}: p=${before.chemistry.progress.toFixed(4)} rate=${before.chemistry.rate.toFixed(4)} temp=${before.chemistry.temperature.toFixed(4)}`);
  if (errors.length) throw new Error(`Browser errors after ${name}: ${errors.join("\n")}`);
}

async function series(group, originMs, targets = times) {
  for (const targetSeconds of targets) {
    // Absolute deadlines prevent cumulative screenshot/IPC drift. Slow GPUs
    // may miss a deadline; record actual timing rather than mislabeling it.
    const remaining = await page.evaluate(({ originMs, targetSeconds }) =>
      originMs + targetSeconds * 1000 - performance.now(), { originMs, targetSeconds });
    if (remaining > 0) await page.waitForTimeout(remaining);
    await shot(`${group}-${String(targetSeconds).replace(".", "p")}s`, group, { originMs, targetSeconds });
  }
}

async function warmupShaders(quality) {
  console.log(`Warming all four reaction materials at ${quality}`);
  await page.evaluate(quality => {
    const h = window.__reactionCapture;
    // Warmup fixtures are not kinetic samples or completion events.
    h.run = null;
    h.reactionStartedAtMs = null;
    h.completedAtMs = null;
    h.quality.getState().setMode(quality);
    h.closeUp.getState().setViewing(true);
  }, quality);
  try {
    for (const [kind, reagents] of Object.entries(cases)) {
      await page.getByRole("button", { name: "Новая пробирка", exact: true }).click();
      await page.evaluate(reagents => {
        window.__tubeVisualTuningStore.setState({ enabled: true,
          progress: 0.5, rate: 0.8, temperature: 0.9, tiltDegrees: 0 });
        for (const id of reagents) {
          window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, id);
        }
      }, reagents);
      // Compile both lighting variants before any timed flame-off event.
      // Let React mount/render, then allow another second for compilation
      // and residual gas to become visible at each burner state.
      for (const lit of [true, false]) {
        await page.evaluate(lit => window.__reactionCapture.burner.getState().setLit(lit), lit);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await settle(1000);
        if (errors.length) throw new Error(`Shader warmup ${kind}/${quality}, burner=${lit}: ${errors.join("\n")}`);
      }
      await page.evaluate(() => window.__reactionCapture.burner.getState().setLit(true));
    }
  } finally {
    await page.evaluate(() => {
      window.__reactionCapture.burner.getState().setLit(true);
      window.__tubeVisualTuningStore.setState({
        enabled: false, progress: 0, rate: 0, temperature: 0, tiltDegrees: null,
      });
    });
  }
  // prepare() uses the normal New Tube action next, discarding the fixture.
  // No direct writes to the chemistry store are needed for shader warmup.
}

async function prepare(kind, quality, label = kind) {
  await page.getByRole("button", { name: "Новая пробирка", exact: true }).click();
  await page.evaluate(({ kind, quality, label, reagents }) => {
    const h = window.__reactionCapture;
    h.quality.getState().setMode(quality);
    h.burner.getState().setLit(true);
    window.__tubeVisualTuningStore.setState({ enabled: false, progress: 0, rate: 0, temperature: 0, tiltDegrees: null });
    h.closeUp.getState().setViewing(true);
    h.run = `${label}-${quality}`;
    h.completedAtMs = null;
    h.reactionStartedAtMs = null;
    for (const id of reagents.slice(0, -1)) window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, id);
    h.kind = kind;
  }, { kind, quality, label, reagents: cases[kind] });
  await settle(2500); // Camera/material warm-up BEFORE the final reagent.
  await shot(`${label}-${quality}-before`, `${label}-${quality}-kinetics`);
  return page.evaluate(id => {
    const h = window.__reactionCapture;
    h.reactionStartedAtMs = performance.now();
    window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, id);
    h.event("mix");
    return h.reactionStartedAtMs;
  }, cases[kind].at(-1));
}

async function startHeat() {
  return page.evaluate(() => {
    const h = window.__reactionCapture;
    // Isolate chemistry from the glass-preheat mini-game. Inactive controls
    // prevent stationary preheat cracking after ~1.5s. TubeReactionRuntime
    // heats via started + sweep + lit independently of active. No chemistry
    // values are injected, and the normal scene frame loop advances them.
    window.__heatingStore.getState().exit();
    window.__heatingStore.getState().grab();
    window.__heatingStore.getState().setSweep(0);
    h.burner.getState().setLit(true);
    return h.event("heat: grab + setSweep(0), mini-game inactive");
  });
}

async function stopHeat() {
  await page.evaluate(() => {
    const h = window.__reactionCapture;
    // exit() alone does NOT stop heating. Extinguish the flame to compare
    // cooling in the same pose/camera without overriding chemistry.
    h.burner.getState().setLit(false);
    window.__heatingStore.getState().exit();
    return h.event("cool: burner extinguished");
  });
  // Lighting changes can stall rendering/IPC during shader compilation.
  // Preserve the physical toggle event above, but start capture deadlines
  // only after the flame-off pose has rendered and that wait has returned.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => window.__reactionCapture.event("cool: rendered flame-off pose"));
}

async function measureFps() {
  // One browser-side sample, no screenshots or cross-process polling during
  // the interval. rAF cadence describes this host/browser, not an i3 benchmark.
  const sample = await page.evaluate(() => new Promise(resolve => {
    const frameDtMs = [];
    const before = window.__reactionCapture.read();
    let first, previous;
    function tick(now) {
      if (first == null) { first = now; previous = now; }
      else { frameDtMs.push(now - previous); previous = now; }
      if (now - first < 5000) { requestAnimationFrame(tick); return; }
      const sorted = [...frameDtMs].sort((a, b) => a - b);
      resolve({ before, after: window.__reactionCapture.read(), durationMs: now - first,
        frameCount: frameDtMs.length, averageFps: frameDtMs.length * 1000 / (now - first),
        p99FrameDtMs: sorted[Math.ceil(sorted.length * 0.99) - 1], frameDtMs,
        note: "Host/browser rAF cadence without screenshot IPC; not GPU render time or validation of the i3 target." });
    }
    requestAnimationFrame(tick);
  }));
  performanceSamples.push(sample);
  console.log(`${sample.before.quality}: ${sample.averageFps.toFixed(1)} FPS, p99 ${sample.p99FrameDtMs.toFixed(1)}ms (host rAF)`);
}

async function contactSheets() {
  if (!browser || !frames.length) return;
  const sheet = await browser.newPage();
  const tileWidth = 400, imageHeight = Math.round(crop.height * tileWidth / crop.width);
  const headerHeight = 86, columns = 3, perSheet = 6;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  try {
    for (const group of new Set(frames.map(f => f.group))) {
      const groupFrames = frames.filter(f => f.group === group);
      for (let offset = 0; offset < groupFrames.length; offset += perSheet) {
        const batch = groupFrames.slice(offset, offset + perSheet);
        const cols = Math.min(columns, batch.length);
        await sheet.setViewportSize({ width: cols * tileWidth, height: Math.ceil(batch.length / cols) * (imageHeight + headerHeight) });
        let html = `<body style="margin:0;display:grid;grid-template-columns:repeat(${cols},${tileWidth}px);background:#17212b;color:white;font:12px monospace">`;
        for (const frame of batch) {
          const png = (await readFile(resolve(out, `${frame.name}.png`))).toString("base64");
          const state = frame.before, actual = state.chemistry, visual = state.visualChemistry;
          const label = `${frame.name}\nactual p=${actual.progress.toFixed(3)} r=${actual.rate.toFixed(3)} T=${actual.temperature.toFixed(3)}\n${state.tuning.enabled ? `OVERRIDE p=${visual.progress.toFixed(2)} r=${visual.rate.toFixed(2)} T=${visual.temperature.toFixed(2)}` : "LIVE kinetics"}\n${frame.elapsedSeconds == null ? "" : `target ${frame.targetSeconds}s / actual ${frame.elapsedSeconds.toFixed(3)}s`} tilt=${state.tuning.tiltDegrees ?? "native"}`;
          const scale = tileWidth / crop.width;
          html += `<section><div style="box-sizing:border-box;height:${headerHeight}px;padding:6px;white-space:pre-wrap;overflow-wrap:anywhere">${escape(label)}</div><div style="width:${tileWidth}px;height:${imageHeight}px;overflow:hidden;position:relative"><img style="position:absolute;left:${-crop.x * scale}px;top:${-crop.y * scale}px;width:${viewport.width * scale}px;max-width:none" src="data:image/png;base64,${png}"></div></section>`;
        }
        await sheet.setContent(`${html}</body>`);
        await sheet.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
        await sheet.screenshot({ path: resolve(out, `${group}-contact-${1 + offset / perSheet}.png`) });
      }
    }
  } finally { await sheet.close(); }
}

try {
  await mkdir(out, { recursive: true });
  if (!await reachable()) {
    if (process.env.VISUAL_URL) throw new Error(`VISUAL_URL is unreachable: ${url}`);
    server = spawn(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32"
      ? ["/c", "npm.cmd run dev -- --port 5173 --strictPort"] : ["run", "dev", "--", "--port", "5173", "--strictPort"],
    { stdio: "ignore", windowsHide: true });
    server.on("error", error => errors.push(`Vite: ${error.message}`));
    for (let i = 0; i < 60 && !await reachable(); i++) await new Promise(r => setTimeout(r, 500));
    if (!await reachable()) throw new Error("Vite did not start on port 5173");
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE,
    channel: !process.env.CHROMIUM_EXECUTABLE && !existsSync(chromium.executablePath()) ? "chrome" : undefined,
    headless: true, args: [`--use-angle=${angle}`, "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"] });
  page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  captureSession = await page.context().newCDPSession(page);
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    // Headless captures have no audio output; leave the sound engine dormant.
    Object.defineProperty(window, "AudioContext", { value: undefined });
  });
  page.setDefaultTimeout(120_000);
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(`${m.text()} ${m.location().url}`); });
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204, body: "" }));
  console.log(`Browser launched; opening ${url}`);
  await page.goto(url);
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)", { exact: true }).click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting");
  await page.waitForFunction(() => !!window.__tubeVisualTuningStore && !!window.__heatingStore && !!window.__testTubeStorageStore);
  await page.evaluate(async () => {
    const tuning = window.__tubeVisualTuningStore.getState();
    for (const field of ["enabled", "progress", "rate", "temperature", "tiltDegrees"]) {
      if (!(field in tuning)) throw new Error(`Missing visual tuning field: ${field}. Wait for the reaction-realism implementation.`);
    }
    // Vite may load stores with ?t=... after edits. Importing the bare path
    // creates a SECOND Zustand singleton (and can overwrite debug globals).
    // Reuse the exact URLs already loaded by the app, including HMR queries.
    const loaded = performance.getEntriesByType("resource").map(entry => entry.name);
    const moduleUrl = file => {
      const match = loaded.findLast(name => new URL(name).pathname === `/src/scenes/laboratory/lib/${file}.ts`);
      if (!match) throw new Error(`Live module URL not found: ${file}`);
      return match;
    };
    const { useTubeReactionStore, ROOM_TEMPERATURE_CHEMISTRY } = await import(moduleUrl("tubeReactions"));
    const { useRuntimeQualityStore } = await import(moduleUrl("useRuntimeQualityStore"));
    const { useTubeCloseUpStore } = await import(moduleUrl("useTubeCloseUpStore"));
    const { useBurnerStore } = await import(moduleUrl("useBurnerStore"));
    const { useBunsenStandStorageStore } = await import(moduleUrl("useBunsenStandStorageStore"));
    const { crackSpotForZone, HEAT_ZONE_COUNT, FLAME_HALF_WIDTH } = await import(moduleUrl("useHeatingStore"));
    const h = window.__reactionCapture = {
      quality: useRuntimeQualityStore, closeUp: useTubeCloseUpStore, burner: useBurnerStore,
      run: null, kind: null, reactionStartedAtMs: null, completedAtMs: null,
      trace: [], events: [], lastTraceMs: -Infinity, zoneCount: HEAT_ZONE_COUNT,
      read() {
        const nowMs = performance.now();
        const index = useBunsenStandStorageStore.getState().attachedTubeSlotIndex;
        const tube = window.__testTubeStorageStore.getState().fumeHoodTestTubes[index];
        if (!tube) throw new Error("Expected a tube clamped in the fume hood");
        const chemistry = useTubeReactionStore.getState().chemistryById[tube.instanceId] ?? ROOM_TEMPERATURE_CHEMISTRY;
        const { enabled, progress, rate, temperature, tiltDegrees } = window.__tubeVisualTuningStore.getState();
        const { active, started, sweep, phase, crackZone } = window.__heatingStore.getState();
        const lit = useBurnerStore.getState().lit;
        return { nowMs, wallTime: new Date().toISOString(), run: h.run, tubeId: tube.instanceId,
          contents: [...tube.contents], chemistry: { ...chemistry },
          visualChemistry: enabled ? { progress, rate, temperature } : { ...chemistry },
          tuning: { enabled, progress, rate, temperature, tiltDegrees },
          quality: useRuntimeQualityStore.getState().quality,
          heating: { active, started, sweep, phase, crackZone, lit,
            inFlame: lit && started && phase !== "cracked" && Math.abs(sweep) < FLAME_HALF_WIDTH,
            crackSpot: crackZone == null ? null : crackSpotForZone(crackZone) },
          reactionElapsedSeconds: h.reactionStartedAtMs == null ? null : (nowMs - h.reactionStartedAtMs) / 1000,
          completedAtMs: h.completedAtMs };
      },
      event(action) {
        const state = h.read();
        h.events.push({ action, ...state });
        return state.nowMs;
      },
    };
    h.unsubscribe = useTubeReactionStore.subscribe(() => {
      if (!h.run || h.reactionStartedAtMs == null) return;
      const state = h.read();
      if (!state.tuning.enabled && state.chemistry.progress >= 1 && h.completedAtMs == null) {
        h.completedAtMs = state.nowMs;
        h.event("reaction complete");
      }
      if (state.nowMs - h.lastTraceMs >= 100) {
        h.trace.push(state);
        h.lastTraceMs = state.nowMs;
      }
    });
  });
  console.log(`Sandbox ready; capturing ${selectedCases.join(", ")} at ${qualities.join(", ")}${quick ? " (quick)" : ""}`);

  for (const quality of qualities) {
    await warmupShaders(quality);
    for (const kind of selectedCases) {
      const prefix = `${kind}-${quality}`;
      const mixedAt = await prepare(kind, quality);
      if (kind !== "copper-nitric") {
        await series(`${prefix}-kinetics`, mixedAt, quick ? [0, 1, 3, 6] : times);
        continue;
      }
      await series(`${prefix}-cold`, mixedAt, [0, 1, 3, 6]);
      if (await page.evaluate(() => window.__reactionCapture.read().chemistry.progress <= 0)) {
        throw new Error("Live copper chemistry did not advance; check store module identity / scene runtime");
      }
      await series(`${prefix}-heat`, await startHeat(), quick ? [0, 1, 3, 6] : times);
      if (await page.evaluate(() => window.__reactionCapture.read().chemistry.temperature <= 0)) {
        throw new Error("Copper did not heat; check live burner/heating store identity");
      }
      if (quick) {
        await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: true,
          progress: 0.45, rate: 0.9, temperature: 1, tiltDegrees: 0 }));
        await settle(5000);
        await shot(`${prefix}-peak`, `${prefix}-fixture`);
        await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false,
          progress: 0, rate: 0, temperature: 0, tiltDegrees: null }));
        continue;
      }
      // Real runtime caps delta at 0.1s: t=30 need not mean completion on a
      // slow GPU. Observe the store instead of pretending it has finished.
      await page.waitForFunction(() => window.__reactionCapture.completedAtMs != null, null, { timeout: 180_000 });
      // Completion may precede the last heat screenshot by many seconds.
      // Anchor decay comparisons to flame-off so no residual deadlines are
      // already in the past; shot() records completion age independently.
      const flameOffAt = await stopHeat();
      await series(`${prefix}-gas-residual`, flameOffAt, [0, 1, 3, 6, 12, 20]);
      await page.waitForFunction(() => window.__reactionCapture.read().chemistry.temperature <= 0.001, null, { timeout: 120_000 });
      await shot(`${prefix}-fully-cooled`, `${prefix}-gas-residual`);

      // Early interruption leaves substantial copper: rate and temperature
      // must taper while cooling, rather than stopping with the flame.
      await prepare(kind, quality, "copper-early-cooling");
      await series(`copper-early-cooling-${quality}-heat`, await startHeat(), [0, 1, 3, 6]);
      await series(`copper-early-cooling-${quality}-cool`, await stopHeat(), [0, 1, 3, 6, 12, 30, 40]);
    }

    if (process.env.VISUAL_FPS === "1") await measureFps();
    if (quick) continue;
    // Controlled fixtures are explicitly labeled separately from LIVE runs.
    for (const kind of selectedCases) {
      await prepare(kind, quality, `${kind}-geometry`);
      await page.evaluate(kind => {
        window.__tubeVisualTuningStore.setState({ enabled: true,
          progress: kind === "permanganate-redox" ? 1 : 0.5,
          rate: kind === "copper-nitric" ? 0.8 : 0,
          temperature: kind === "copper-nitric" ? 0.85 : 0, tiltDegrees: 0 });
      }, kind);
      const group = `${kind}-${quality}-tilts`;
      for (const tiltDegrees of [-20, 0, 20]) {
        await page.evaluate(tiltDegrees => window.__tubeVisualTuningStore.setState({ tiltDegrees }), tiltDegrees);
        await settle(3000);
        await shot(`${group}-${tiltDegrees}`, group);
      }
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({ tiltDegrees: -20 }));
      await settle(3000);
      await shot(`${kind}-${quality}-slosh-before`, `${kind}-${quality}-slosh`);
      const changedAt = await page.evaluate(() => {
        window.__tubeVisualTuningStore.setState({ tiltDegrees: 20 });
        return window.__reactionCapture.event("slosh: -20 to +20 degrees");
      });
      await series(`${kind}-${quality}-slosh`, changedAt, [0, 0.1, 0.3, 0.6, 1.2, 3]);
    }

    // Real completed redox leaves clear water. Verify tilt also works when
    // enabled=false, independently of the chemistry override switch.
    await prepare("permanganate-redox", quality, "water-live");
    await page.waitForFunction(() => window.__reactionCapture.completedAtMs != null, null, { timeout: 120_000 });
    for (const tiltDegrees of [-20, 0, 20]) {
      await page.evaluate(tiltDegrees => window.__tubeVisualTuningStore.setState({ enabled: false, tiltDegrees }), tiltDegrees);
      await settle(3000);
      await shot(`water-live-${quality}-tilt-${tiltDegrees}`, `water-live-${quality}-tilts`);
    }
    await page.evaluate(() => window.__tubeVisualTuningStore.setState({ tiltDegrees: 0 }));
    await settle(3000);
    await shot(`damage-${quality}-intact`, `damage-${quality}`);
    for (const side of ["left", "right"]) {
      await page.evaluate(side => {
        // Actual API: FumeHoodWorkArea derives crackSpot from crackZone.
        // Opposite end zones map to opposite local-Z flanks at equal height.
        const crackZone = side === "left" ? 0 : window.__reactionCapture.zoneCount - 1;
        window.__heatingStore.setState({ active: false, phase: "cracked", crackZone });
        window.__reactionCapture.event(`crack: ${side}`);
      }, side);
      await settle();
      await shot(`damage-${quality}-${side}`, `damage-${quality}`);
    }
    await page.evaluate(() => {
      window.__heatingStore.getState().restartPreheat(() => 0);
      window.__heatingStore.getState().exit();
      window.__heatingStore.getState().setSweep(0);
    });
    await settle();
    await shot(`damage-${quality}-replaced`, `damage-${quality}`);
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join("\n")}`);
} catch (error) {
  failure = error;
  console.error(error);
  process.exitCode = 1;
} finally {
  // Preserve partial evidence and diagnostics even on shader/assertion failure.
  if (page && !page.isClosed()) {
    try {
      const data = await page.evaluate(() => {
        const h = window.__reactionCapture;
        if (!h) return { trace: [], events: [] };
        h.unsubscribe();
        return { trace: h.trace, events: h.events };
      });
      traces.push(...data.trace);
      events.push(...data.events);
    } catch (error) { errors.push(`Collect trace: ${error.message}`); process.exitCode = 1; }
  }
  try { await contactSheets(); }
  catch (error) { errors.push(`Contact sheets: ${error.message}`); process.exitCode = 1; }
  try {
    await writeFile(resolve(out, "capture.json"), JSON.stringify({
      status: failure || errors.length ? "failed" : "complete", failure: failure ? String(failure.stack ?? failure) : null,
      frames, traces, events, errors, performanceSamples, browser: browser?.version(), angle, viewport, crop,
      selection: { cases: selectedCases, qualities, quick },
      timing: "Browser performance.now() milliseconds; snapshots bracket screenshot acquisition. Targets are wall time, not simulated chemistry time.",
      heatingFixture: "grab()/setSweep(0) with mini-game inactive; burner extinguished for cooling. Chemistry store is never overwritten.",
    }, null, 2));
  } finally {
    try { await browser?.close(); }
    finally {
      if (server?.pid) {
        if (process.platform === "win32") {
          await new Promise(resolve => {
            const kill = spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
            kill.once("error", resolve);
            kill.once("exit", resolve);
          });
        } else server.kill();
      }
    }
  }
}
