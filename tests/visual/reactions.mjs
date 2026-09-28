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
const precipitates = process.env.VISUAL_PRECIP === "1";
const bubblesGas = process.env.VISUAL_BUBBLES_GAS === "1";
const gasResidue = process.env.VISUAL_GAS_RESIDUE === "1";
const reference = process.env.VISUAL_REFERENCE === "1";
const permanganateColor = process.env.VISUAL_PERMANGANATE_COLOR === "1";
const iteration12 = process.env.VISUAL_ITERATION_12 === "1";
const iteration12GasOnly = process.env.VISUAL_ITERATION_12_GAS_ONLY === "1";
const iteration13 = process.env.VISUAL_ITERATION_13 === "1";
const iteration14 = process.env.VISUAL_ITERATION_14 === "1";
const iteration15 = process.env.VISUAL_ITERATION_15 === "1";
const iteration16 = process.env.VISUAL_ITERATION_16 === "1";
const iteration17 = process.env.VISUAL_ITERATION_17 === "1";
const iteration18 = process.env.VISUAL_ITERATION_18 === "1";
const iteration19 = process.env.VISUAL_ITERATION_19 === "1";
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
  if (timing.fastSequence) {
    const { data } = await captureSession.send("Page.captureScreenshot", {
      format: "png", fromSurface: true, captureBeyondViewport: false,
      clip: { x: 725, y: 0, width: 150, height: 810, scale: 1 },
    });
    const after = await page.evaluate(() => window.__reactionCapture.read());
    await writeFile(resolve(out, `${name}-tube.png`), Buffer.from(data, "base64"));
    frames.push({ name, group, ...timing, before, after,
      screenshotDurationMs: after.nowMs - before.nowMs });
    console.log(`${name}: p=${before.chemistry.progress.toFixed(4)} rate=${before.chemistry.rate.toFixed(4)} temp=${before.chemistry.temperature.toFixed(4)}`);
    if (errors.length) throw new Error(`Browser errors after ${name}: ${errors.join("\n")}`);
    return;
  }
  const { data } = await captureSession.send("Page.captureScreenshot", {
    format: "png", fromSurface: true, optimizeForSpeed: true, captureBeyondViewport: false,
  });
  const after = await page.evaluate(() => window.__reactionCapture.read());
  // Timestamp acquisition before disk I/O. Decode only the PNG transport;
  // preserve the full captured pixels without cropping or image processing.
  await writeFile(resolve(out, `${name}.png`), Buffer.from(data, "base64"));
  // Native Chromium clipping keeps the fine detail in the tube without
  // enlarging a downsampled contact sheet.
  if (iteration19 || iteration18 || iteration17 || iteration16 || iteration15 || iteration14 || iteration13 || iteration12 || iteration12GasOnly || precipitates || gasResidue || reference || permanganateColor || (name.includes("-HIGH-") || name.includes("-LOW-")) && (name.endsWith("-3s") || name.endsWith("-6s")
    || name.endsWith("-12s") || name.endsWith("-20s") || name.endsWith("-0")
    || name.endsWith("-before") || name.endsWith("-peak"))) {
    const close = await captureSession.send("Page.captureScreenshot", {
      format: "png", fromSurface: true, captureBeyondViewport: false,
      clip: { ...tubeCrop, scale: 1 },
    });
    await writeFile(resolve(out, `${name}-tube.png`), Buffer.from(close.data, "base64"));
    if (iteration18 || iteration19) {
      const liquidShot = await captureSession.send("Page.captureScreenshot", {
        format: "png", fromSurface: true, captureBeyondViewport: false,
        clip: { x: 725, y: 500, width: 150, height: 310, scale: 1 },
      });
      await writeFile(resolve(out, `${name}-${iteration19 ? "lower" : "liquid"}.png`), Buffer.from(liquidShot.data, "base64"));
      if (name.startsWith("barium-sulfate") && name.endsWith("45s")) {
        const bottom = await captureSession.send("Page.captureScreenshot", {
          format: "png", fromSurface: true, captureBeyondViewport: false,
          clip: { x: 730, y: 650, width: 140, height: 160, scale: 1 },
        });
        await writeFile(resolve(out, `${name}-bottom.png`), Buffer.from(bottom.data, "base64"));
      }
    }
    if (iteration17) {
      const mouth = await captureSession.send("Page.captureScreenshot", {
        format: "png", fromSurface: true, captureBeyondViewport: false,
        clip: { x: 700, y: 0, width: 200, height: 330, scale: 1 },
      });
      await writeFile(resolve(out, `${name}-mouth.png`), Buffer.from(mouth.data, "base64"));
    }
    if (iteration15) {
      const detail = name.includes("-cling-") ? { x: 730, y: 620, width: 140, height: 190 }
        : name.includes("-plume-") ? { x: 730, y: 0, width: 140, height: 260 }
          : name.includes("-gas-") ? { x: 730, y: 490, width: 140, height: 125 } : null;
      if (detail) {
        const detailShot = await captureSession.send("Page.captureScreenshot", {
          format: "png", fromSurface: true, captureBeyondViewport: false,
          clip: { ...detail, scale: 1 },
        });
        await writeFile(resolve(out, `${name}-detail.png`), Buffer.from(detailShot.data, "base64"));
      }
      if (name.includes("-plume-")) {
        const clingShot = await captureSession.send("Page.captureScreenshot", {
          format: "png", fromSurface: true, captureBeyondViewport: false,
          clip: { x: 730, y: 620, width: 140, height: 190, scale: 1 },
        });
        await writeFile(resolve(out, `${name}-cling.png`), Buffer.from(clingShot.data, "base64"));
      }
    }
    if (iteration14 && (name.endsWith("-before") || name.endsWith("-2s"))) {
      const bottom = await captureSession.send("Page.captureScreenshot", {
        format: "png", fromSurface: true, captureBeyondViewport: false,
        clip: { x: 730, y: 620, width: 140, height: 190, scale: 1 },
      });
      await writeFile(resolve(out, `${name}-bottom.png`), Buffer.from(bottom.data, "base64"));
    }
    if (iteration12 && name.startsWith("barium-sulfate")) {
      const bottom = await captureSession.send("Page.captureScreenshot", {
        format: "png", fromSurface: true, captureBeyondViewport: false,
        clip: { x: 730, y: 620, width: 140, height: 190, scale: 1 },
      });
      await writeFile(resolve(out, `${name}-bottom.png`), Buffer.from(bottom.data, "base64"));
    }
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

async function mouthVideoSeries(quality, stage, originMs, targets) {
  const captured = await page.evaluate(async ({ originMs, targets }) => {
    const waitUntil = deadline => new Promise(resolve => {
      const tick = now => now >= deadline ? resolve() : requestAnimationFrame(tick);
      requestAnimationFrame(tick);
    });
    await waitUntil(originMs + targets[0] * 1000 - 350);
    const source = [...document.querySelectorAll("canvas")].find(canvas => canvas.getBoundingClientRect().width > 1000);
    if (!source) throw new Error("Scene canvas not found");
    const rect = source.getBoundingClientRect();
    const sceneStream = source.captureStream(20);
    const live = document.createElement("video");
    live.srcObject = sceneStream;
    live.muted = true;
    await live.play();
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = 200; cropCanvas.height = 330;
    const cropContext = cropCanvas.getContext("2d");
    if (!cropContext) throw new Error("2D capture context unavailable");
    let drawing = true;
    const draw = () => {
      if (!drawing) return;
      cropContext.drawImage(live, (700 - rect.left) * live.videoWidth / rect.width,
        (0 - rect.top) * live.videoHeight / rect.height, 200 * live.videoWidth / rect.width,
        330 * live.videoHeight / rect.height, 0, 0, 200, 330);
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    const stream = cropCanvas.captureStream(20);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 2_000_000 });
    const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const started = new Promise(resolve => { recorder.onstart = resolve; });
    recorder.start();
    await started;
    const recordStartMs = performance.now();
    await waitUntil(originMs + targets.at(-1) * 1000 + 250);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.stop();
    await stopped;
    drawing = false;
    stream.getTracks().forEach(track => track.stop());
    sceneStream.getTracks().forEach(track => track.stop());
    live.srcObject = null;
    const blob = new Blob(chunks, { type: "video/webm" });
    const videoUrl = URL.createObjectURL(blob);
    try {
      const video = document.createElement("video");
      video.src = videoUrl;
      await new Promise(resolve => { video.onloadedmetadata = resolve; });
      const output = document.createElement("canvas"); output.width = 200; output.height = 330;
      const context = output.getContext("2d");
      if (!context) throw new Error("2D capture context unavailable");
      const images = [];
      for (const targetSeconds of targets) {
        video.currentTime = (originMs + targetSeconds * 1000 - recordStartMs) / 1000;
        await new Promise(resolve => { video.onseeked = resolve; });
        context.drawImage(video, 0, 0);
        images.push(output.toDataURL("image/png").split(",")[1]);
      }
      return { images, recordStartMs, bytes: blob.size };
    } finally { URL.revokeObjectURL(videoUrl); }
  }, { originMs, targets });
  for (let index = 0; index < targets.length; index++) {
    const name = `copper-nitric-${quality}-${stage}-${index}`;
    await writeFile(resolve(out, `${name}-mouth.png`), Buffer.from(captured.images[index], "base64"));
    frames.push({ name, group: `copper-nitric-${quality}-${stage}`, videoFrame: true,
      targetSeconds: targets[index], elapsedSeconds: targets[index],
      recordStartMs: captured.recordStartMs, videoBytes: captured.bytes });
    console.log(`${name}: video frame at ${targets[index].toFixed(2)}s`);
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
    for (const [kind, reagents] of Object.entries(cases).filter(([kind]) => !(iteration15 || iteration16 || iteration17) || kind === "copper-nitric")) {
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
    for (const group of new Set(frames.filter(f => !f.fastSequence).map(f => f.group))) {
      const groupFrames = frames.filter(f => f.group === group && !f.fastSequence);
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
    if (iteration19) {
      await prepare("permanganate-redox", quality);
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({
        enabled: true, progress: 0, rate: 0, temperature: 0, tiltDegrees: 0,
      }));
      await settle(350);
      await shot(`permanganate-redox-${quality}-p0`, `permanganate-redox-${quality}`);
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false }));
      const startedAt = await prepare("barium-sulfate", quality);
      await series(`barium-sulfate-${quality}`, startedAt, [2, 15, 30, 45, 90, 120]);
      continue;
    }
    if (iteration18) {
      await page.getByRole("button", { name: "Новая пробирка", exact: true }).click();
      await page.evaluate(quality => {
        const h = window.__reactionCapture;
        h.quality.getState().setMode(quality);
        h.closeUp.getState().setViewing(true);
        window.__tubeVisualTuningStore.setState({ enabled: false, tiltDegrees: 0 });
        window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, "hno3");
      }, quality);
      await settle(1000);
      await shot(`water-${quality}`, `water-${quality}`);
      await prepare("permanganate-redox", quality);
      for (const progress of [0, 0.3, 0.6]) {
        await page.evaluate(progress => window.__tubeVisualTuningStore.setState({
          enabled: true, progress, rate: 0, temperature: 0, tiltDegrees: 0,
        }), progress);
        await settle(350);
        await shot(`permanganate-redox-${quality}-p${String(progress).replace(".", "p")}`,
          `permanganate-redox-${quality}`);
      }
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false }));
      await prepare("copper-nitric", quality);
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({
        enabled: true, progress: 1, rate: 0, temperature: 0, tiltDegrees: 0,
      }));
      await settle(2200);
      await shot(`copper-nitric-${quality}-blue`, `copper-nitric-${quality}`);
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false }));
      const startedAt = await prepare("barium-sulfate", quality);
      await series(`barium-sulfate-${quality}`, startedAt, [5, 15, 25, 35, 45]);
      continue;
    }
    if (iteration17) {
      await prepare("copper-nitric", quality);
      const startedAt = await page.evaluate(() => {
        window.__tubeVisualTuningStore.setState({
          enabled: true, progress: 0.5, rate: 1, temperature: 1, tiltDegrees: 0,
        });
        return performance.now();
      });
      await mouthVideoSeries(quality, "onset", startedAt,
        Array.from({ length: 8 }, (_, index) => 2.65 + index * 0.25));
      await page.evaluate(startedAt => new Promise(resolve => {
        const tick = now => now >= startedAt + 7200 ? resolve() : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
      }), startedAt);
      await shot(`copper-nitric-${quality}-peak-full`, `copper-nitric-${quality}-peak`);
      const peakAt = await page.evaluate(() => performance.now());
      await mouthVideoSeries(quality, "peak", peakAt, [0.45, 0.75, 1.05]);
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false }));
      continue;
    }
    if (iteration16) {
      await prepare("copper-nitric", quality);
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({
        enabled: true, progress: 0.85, rate: 1, temperature: 1, tiltDegrees: 0,
      }));
      await settle(5000);
      const endedAt = await page.evaluate(() => {
        window.__tubeVisualTuningStore.setState({ progress: 1, rate: 0, temperature: 0 });
        return window.__reactionCapture.event("fixture: reaction ended");
      });
      for (const targetSeconds of [0, 1, 3, 10, 60, 120, 180, 300, 360]) {
        await page.evaluate(({ endedAt, targetSeconds }) => new Promise(resolve => {
          const tick = now => now >= endedAt + targetSeconds * 1000 ? resolve() : requestAnimationFrame(tick);
          requestAnimationFrame(tick);
        }), { endedAt, targetSeconds });
        await shot(`copper-nitric-${quality}-after-${targetSeconds}s`, `copper-nitric-${quality}-after`,
          { originMs: endedAt, targetSeconds });
      }
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false }));
      continue;
    }
    if (iteration15) {
      await prepare("copper-nitric", quality, "copper-slow");
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({
        enabled: true, progress: 0.12, rate: 0.25, temperature: 0, tiltDegrees: 0,
      }));
      await settle(1000);
      const slowAt = await page.evaluate(() => performance.now());
      for (const index of [0, 1, 2]) {
        await page.evaluate(({ slowAt, index }) => new Promise(resolve => {
          const tick = now => now >= slowAt + index * 300 ? resolve() : requestAnimationFrame(tick);
          requestAnimationFrame(tick);
        }), { slowAt, index });
        await shot(`copper-nitric-${quality}-cling-r0p25-${index}`, `copper-nitric-${quality}-slow`, { fastSequence: true });
      }
      await prepare("copper-nitric", quality, "copper-fast");
      const startedAt = await page.evaluate(() => {
        window.__tubeVisualTuningStore.setState({
          enabled: true, progress: 0.12, rate: 1, temperature: 0, tiltDegrees: 0,
        });
        return performance.now();
      });
      for (const targetSeconds of [0, 1, 2, 4]) {
        await page.evaluate(({ startedAt, targetSeconds }) => new Promise(resolve => {
          const tick = now => now >= startedAt + targetSeconds * 1000 ? resolve() : requestAnimationFrame(tick);
          requestAnimationFrame(tick);
        }), { startedAt, targetSeconds });
        await shot(`copper-nitric-${quality}-gas-${targetSeconds}s`, `copper-nitric-${quality}-gas`,
          { originMs: startedAt, targetSeconds });
      }
      const plumeAt = await page.evaluate(() => performance.now());
      for (const index of [0, 1, 2]) {
        await page.evaluate(({ plumeAt, index }) => new Promise(resolve => {
          const tick = now => now >= plumeAt + index * 300 ? resolve() : requestAnimationFrame(tick);
          requestAnimationFrame(tick);
        }), { plumeAt, index });
        await shot(`copper-nitric-${quality}-plume-${index}`, `copper-nitric-${quality}-plume`, { fastSequence: true });
      }
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false }));
      continue;
    }
    if (iteration14) {
      await prepare("copper-nitric", quality);
      const startedAt = await page.evaluate(() => {
        window.__tubeVisualTuningStore.setState({
          enabled: true, progress: 0.1, rate: 1, temperature: 0, tiltDegrees: 0,
        });
        return performance.now();
      });
      for (const targetSeconds of [0, 2, 5, 10, 20]) {
        await page.evaluate(({ startedAt, targetSeconds }) => new Promise(resolve => {
          const tick = now => now >= startedAt + targetSeconds * 1000 ? resolve() : requestAnimationFrame(tick);
          requestAnimationFrame(tick);
        }), { startedAt, targetSeconds });
        await shot(`copper-nitric-${quality}-${targetSeconds}s`, `copper-nitric-${quality}-onset`,
          { originMs: startedAt, targetSeconds });
      }
      await shot(`copper-nitric-${quality}-peak`, `copper-nitric-${quality}-onset`);
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false }));
      continue;
    }
    if (iteration13) {
      await prepare("copper-nitric", quality);
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({
        enabled: true, progress: 0.85, rate: 1, temperature: 1, tiltDegrees: 0,
      }));
      await settle(5000);
      const peakAt = await page.evaluate(() => performance.now());
      for (const targetSeconds of [0, 0.5, 1]) {
        await page.evaluate(({ peakAt, targetSeconds }) => new Promise(resolve => {
          const tick = now => now >= peakAt + targetSeconds * 1000 ? resolve() : requestAnimationFrame(tick);
          requestAnimationFrame(tick);
        }), { peakAt, targetSeconds });
        await shot(`copper-nitric-${quality}-peak-${String(targetSeconds).replace(".", "p")}`,
          `copper-nitric-${quality}-motion`, { originMs: peakAt, targetSeconds });
      }
      const endedAt = await page.evaluate(() => {
        window.__tubeVisualTuningStore.setState({ progress: 1, rate: 0, temperature: 0 });
        return window.__reactionCapture.event("fixture: reaction ended");
      });
      await settle(100);
      await shot(`copper-nitric-${quality}-end`, `copper-nitric-${quality}-residue`);
      for (const targetSeconds of [60, 180, 300]) {
        await page.evaluate(({ endedAt, targetSeconds }) => new Promise(resolve => {
          const tick = now => now >= endedAt + targetSeconds * 1000 ? resolve() : requestAnimationFrame(tick);
          requestAnimationFrame(tick);
        }), { endedAt, targetSeconds });
        await shot(`copper-nitric-${quality}-after-${targetSeconds}s`, `copper-nitric-${quality}-residue`,
          { originMs: endedAt, targetSeconds });
      }
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false }));
      continue;
    }
    if (iteration12 || iteration12GasOnly) {
      if (!iteration12GasOnly) {
      await page.getByRole("button", { name: "Новая пробирка", exact: true }).click();
      await page.evaluate(quality => {
        const h = window.__reactionCapture;
        h.quality.getState().setMode(quality);
        h.closeUp.getState().setViewing(true);
        h.run = `glass-${quality}`;
        h.reactionStartedAtMs = null;
        window.__tubeVisualTuningStore.setState({ enabled: false, tiltDegrees: 0 });
      }, quality);
      await settle(1200);
      await shot(`glass-${quality}-empty`, `glass-${quality}`);
      await page.evaluate(() => window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, "nacl"));
      await settle(1200);
      await shot(`glass-${quality}-clear-solution`, `glass-${quality}`);
      }
      await prepare("copper-nitric", quality);
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({
        enabled: true, progress: 0.85, rate: 1, temperature: 1, tiltDegrees: 0,
      }));
      await settle(5000);
      await shot(`copper-nitric-${quality}-peak`, `copper-nitric-${quality}`);
      const endedAt = await page.evaluate(() => {
        window.__tubeVisualTuningStore.setState({ progress: 1, rate: 0, temperature: 0 });
        return window.__reactionCapture.event("fixture: reaction ended");
      });
      await settle(100);
      await shot(`copper-nitric-${quality}-end`, `copper-nitric-${quality}`);
      for (const targetSeconds of [60, 180]) {
        await page.evaluate(({ endedAt, targetSeconds }) => new Promise(resolve => {
          const tick = now => now >= endedAt + targetSeconds * 1000 ? resolve() : requestAnimationFrame(tick);
          requestAnimationFrame(tick);
        }), { endedAt, targetSeconds });
        await shot(`copper-nitric-${quality}-after-${targetSeconds}s`, `copper-nitric-${quality}`,
          { originMs: endedAt, targetSeconds });
      }
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false }));
      if (!iteration12GasOnly) {
      const startedAt = await prepare("barium-sulfate", quality);
      for (const targetSeconds of [1, 20, 45]) {
        await page.evaluate(({ startedAt, targetSeconds }) => new Promise(resolve => {
          const tick = now => now >= startedAt + targetSeconds * 1000 ? resolve() : requestAnimationFrame(tick);
          requestAnimationFrame(tick);
        }), { startedAt, targetSeconds });
        await shot(`barium-sulfate-${quality}-${targetSeconds}s`, `barium-sulfate-${quality}`,
          { originMs: startedAt, targetSeconds });
      }
      }
      continue;
    }
    if (permanganateColor) {
      const prefix = `permanganate-redox-${quality}`;
      await prepare("permanganate-redox", quality);
      await shot(`${prefix}-hold-live`, `${prefix}-hold`);
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({
        enabled: true, progress: 0, rate: 0, temperature: 0, tiltDegrees: 0,
      }));
      // Show the stock bottle as well as the tube in the same lit hood.
      await page.setViewportSize({ width: 1900, height: 900 });
      await settle(500);
      await page.screenshot({ path: resolve(out, `${prefix}-shelf.png`) });
      await page.setViewportSize(viewport);
      await settle(500);
      for (const progress of [0, 0.15, 0.35, 0.6, 1]) {
        await page.evaluate(progress => window.__tubeVisualTuningStore.setState({ progress }), progress);
        await settle(300);
        await shot(`${prefix}-p${String(progress).replace(".", "p")}`, `${prefix}-color`);
      }
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false }));
      continue;
    }
    if (reference) {
      for (const kind of selectedCases) {
        const targets = kind === "silver-chloride" ? [0.1, 1, 5, 12]
          : kind === "barium-sulfate" ? [0.2, 10, 25, 45] : [0.5, 1.5, 3];
        const startedAt = await prepare(kind, quality);
        for (const targetSeconds of targets) {
          // A live rAF wait keeps the chemistry and shaders advancing during
          // BaSO4's long settling interval in headless Chromium.
          await page.evaluate(({ startedAt, targetSeconds }) => new Promise(resolve => {
            const tick = now => now >= startedAt + targetSeconds * 1000 ? resolve() : requestAnimationFrame(tick);
            requestAnimationFrame(tick);
          }), { startedAt, targetSeconds });
          await shot(`${kind}-${quality}-${String(targetSeconds).replace(".", "p")}s`, `${kind}-${quality}-reference`,
            { originMs: startedAt, targetSeconds });
        }
      }
      continue;
    }
    if (gasResidue) {
      await prepare("copper-nitric", quality);
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({
        enabled: true, progress: 0.85, rate: 1, temperature: 1, tiltDegrees: 0,
      }));
      await settle(5000);
      await shot(`copper-nitric-${quality}-peak`, `copper-nitric-${quality}-gas-residue`);
      const endedAt = await page.evaluate(() => {
        window.__tubeVisualTuningStore.setState({ progress: 1, rate: 0, temperature: 0 });
        return window.__reactionCapture.event("fixture: reaction ended");
      });
      await settle(100);
      await shot(`copper-nitric-${quality}-end`, `copper-nitric-${quality}-gas-residue`);
      for (const targetSeconds of [30, 60]) {
        // Keep the scene rendering while waiting; headless tabs can suspend
        // their animation loop during a long automation-only timeout.
        await page.evaluate(({ endedAt, targetSeconds }) => new Promise(resolve => {
          const tick = now => now >= endedAt + targetSeconds * 1000 ? resolve() : requestAnimationFrame(tick);
          requestAnimationFrame(tick);
        }), { endedAt, targetSeconds });
        await shot(`copper-nitric-${quality}-after-${targetSeconds}s`, `copper-nitric-${quality}-gas-residue`,
          { originMs: endedAt, targetSeconds });
      }
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false }));
      continue;
    }
    if (bubblesGas) {
      await prepare("copper-nitric", quality);
      for (const rate of [0.25, 1]) {
        await page.evaluate(rate => window.__tubeVisualTuningStore.setState({
          enabled: true, progress: 0.45, rate, temperature: 0, tiltDegrees: 0,
        }), rate);
        await settle(rate === 1 ? 5000 : 1500);
        await shot(`copper-nitric-${quality}-r${String(rate).replace(".", "p")}-peak`, `copper-nitric-${quality}-bubbles-gas`);
      }
      await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false }));
      continue;
    }
    for (const kind of selectedCases) {
      const prefix = `${kind}-${quality}`;
      if (precipitates) {
        if (kind !== "silver-chloride" && kind !== "barium-sulfate") continue;
        await prepare(kind, quality);
        for (const progress of [0.05, 0.3, 0.6, 1]) {
          await page.evaluate(progress => window.__tubeVisualTuningStore.setState({
            enabled: true, progress, rate: 0, temperature: 0, tiltDegrees: 0,
          }), progress);
          await settle(500);
          await shot(`${prefix}-p${String(progress).replace(".", "p")}`, `${prefix}-precipitate`);
        }
        await page.evaluate(() => window.__tubeVisualTuningStore.setState({ enabled: false }));
        continue;
      }
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
        const coolingAt = await page.evaluate(() => {
          window.__tubeVisualTuningStore.setState({ rate: 0, temperature: 0 });
          return window.__reactionCapture.event("fixture: gas cooling at fixed progress");
        });
        await series(`${prefix}-cooling`, coolingAt, [0, 10, 20]);
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

    if (precipitates) continue;
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
  try { if (!iteration16 && !iteration17 && !iteration18 && !iteration19) await contactSheets(); }
  catch (error) { errors.push(`Contact sheets: ${error.message}`); process.exitCode = 1; }
  try {
    await writeFile(resolve(out, iteration16 || iteration17 || iteration18 || iteration19 ? `capture-${qualities.join("-")}.json` : "capture.json"), JSON.stringify({
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
