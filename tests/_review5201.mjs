import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const out = process.env.OUT; const exp = Number(process.env.EXP); const times = process.env.TIMES.split(",").map(Number);
const variants = (process.env.VARIANTS ?? "").split(",").filter(Boolean).map(item => item.split(":"));
const selectedAngles = (process.env.ANGLES ?? "front,side,top,45").split(",");
const records = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1200,900"] });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  if (process.env.QUALITY) await context.addInitScript(quality =>
    localStorage.setItem("virtugenium.runtime-quality.v1", quality), process.env.QUALITY);
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.on("pageerror", e => console.log("pageerror", e.message));
  page.on("console", message => { if (message.text().includes("Reaction shader warmup failed"))
    console.log("browser", message.type(), message.text()); });
  await page.goto("http://127.0.0.1:5201");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
  await page.locator(".lab-boot-screen").waitFor({ state: "hidden", timeout: 120000 });
  await page.waitForTimeout(2000);
  if (process.env.QUALITY) await page.evaluate(async quality => {
    const { useRuntimeQualityStore } = await import("/src/scenes/laboratory/lib/useRuntimeQualityStore.ts");
    useRuntimeQualityStore.getState().setMode(quality);
  }, process.env.QUALITY);
  if (process.env.IMPACT || variants.length) await page.locator("select").nth(0).selectOption(process.env.IMPACT ?? variants[0][0]);
  if (process.env.SPEED || variants.length) await page.locator("select").nth(1).selectOption(process.env.SPEED ?? variants[0][1]);
  if (process.env.DEBUG) await page.evaluate(() => {
    window.__tubeDebugEnabled = true;
    window.__exp1DiagnosticsEnabled = true;
  });
  // Warm up the module import and a render first: the first shot is otherwise tens of seconds late.
  await page.evaluate(async () => { await import("/node_modules/three/build/three.module.js"); });
  const lastReagent = { 1: "hno3", 2: "nacl", 3: "k2so4", 4: "kmno4" }[exp];
  if (process.env.VIDEO) await page.evaluate(() => {
    window.__reviewVideo = new Promise(resolve => {
      window.__startReviewVideo = () => {
        const stream = window.__three.gl.domElement.captureStream(20);
        const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
          ? "video/webm;codecs=vp8" : "video/webm";
        const recorder = new MediaRecorder(stream, { mimeType: mime });
        const parts = [];
        recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
        recorder.onstop = () => {
          stream.getTracks().forEach(track => track.stop());
          resolve(new Blob(parts, { type: mime }));
        };
        recorder.start();
        setTimeout(() => recorder.stop(), 4500);
        window.__startReviewVideo = null;
      };
    });
  });
  await page.evaluate(id => {
    window.__reviewPourAt = 0;
    window.__reviewFrames = [];
    window.__reviewPrograms = [];
    window.__reviewProgramChanges = [];
    if (window.__reviewFrameLoop) cancelAnimationFrame(window.__reviewFrameLoop);
    const tick = () => {
      window.__reviewFrames.push(Date.now());
      window.__reviewPrograms.push(window.__three?.gl.info.programs?.length ?? 0);
      if (window.__reviewPrograms.length > 1 && window.__reviewPrograms.at(-1) !== window.__reviewPrograms.at(-2))
        window.__reviewProgramChanges.push({ at: Date.now() - window.__reviewPourAt,
          programs: window.__three?.gl.info.programs?.slice(window.__reviewPrograms.at(-2))
            .map(p => ({ name: p.name, key: p.cacheKey })) });
      window.__reviewFrameLoop = requestAnimationFrame(tick);
    };
    window.__reviewFrameLoop = requestAnimationFrame(tick);
    window.__reviewUnsubscribe?.();
    window.__reviewUnsubscribe = window.__testTubeStorageStore.subscribe(state => {
      if (!window.__reviewPourAt && (state.fumeHoodTestTubes[0]?.contents ?? []).includes(id)) {
        window.__reviewPourAt = Date.now();
        window.__startReviewVideo?.();
      }
    });
  }, lastReagent);
  await page.getByRole("button", { name: process.env.HEATED && exp === 1 ? "Опыт 1, с нагревом" : `Опыт ${exp}`, exact: true }).click();
  // Time is counted from the moment the last reagent is really in the tube.
  await page.waitForFunction(id => (window.__testTubeStorageStore.getState().fumeHoodTestTubes[0]?.contents ?? []).includes(id),
    lastReagent, { timeout: 120000, polling: 10 });
  let t0 = await page.evaluate(() => window.__reviewPourAt);
  for (const [index, t] of times.entries()) {
    if ((process.env.RESET_EACH || process.env.RESET_EARLY && t <= 3) && index > 0) {
      if (variants[index]) {
        await page.locator("select").nth(0).selectOption(variants[index][0]);
        await page.locator("select").nth(1).selectOption(variants[index][1]);
      }
      await page.evaluate(() => { window.__reviewPourAt = 0; });
      await page.getByRole("button", { name: process.env.HEATED && exp === 1 ? "Опыт 1, с нагревом" : `Опыт ${exp}`, exact: true }).click();
      await page.waitForFunction(() => window.__reviewPourAt > 0, null,
        { timeout: 120000, polling: 10 });
      t0 = await page.evaluate(() => window.__reviewPourAt);
    }
    await page.waitForTimeout(Math.max(0, t0 + t * 1000 - Date.now()));
    const actual = (Date.now() - t0) / 1000;
    const progressAtCapture = await page.evaluate(() => {
      const tube = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0];
      return tube ? window.__tubeReactionStore.getState().chemistryById[tube.instanceId]?.progress : undefined;
    });
    const label = variants[index] ? `-${variants[index].join("-")}` : "";
    const diagnostic = process.env.DEBUG ? await page.evaluate(exp => {
      const state = exp === 1 ? window.__exp1Diagnostics : window.__tubeDebug;
      if (exp === 1) return state;
      return state && { kind: state.kind, velocity: state.velocity,
        tracer: state.tracer, reagent: state.reagent, sedimentMass: state.sedimentMass,
        suspensionMass: state.suspensionMass, formed: state.formed };
    }, exp) : null;
    if (process.env.DEBUG) console.log("diagnostics", t, label, diagnostic);
    records.push({ target: t, actual, progress: progressAtCapture, variant: label, diagnostic });
    if (exp === 1 && process.env.SLICES) {
      const slices = await page.evaluate(() => {
        const field = window.__exp1Field;
        if (!field) return null;
        const m = field.mask, v = field.species["Cu2+"].values;
        const mean = field.sources.reduce((sum, p) => (sum.x += p.x, sum.y += p.y, sum.z += p.z, sum), { x: 0, y: 0, z: 0 });
        const count = Math.max(1, field.sources.length);
        mean.x /= count; mean.y /= count; mean.z /= count;
        const iy = Math.max(0, Math.min(m.ny - 1, Math.floor((mean.y - m.bottom) / m.height * m.ny)));
        const iz = Math.max(0, Math.min(m.nz - 1, Math.floor((mean.z / m.radius + 1) * m.nz / 2)));
        const horizontal = Array.from({ length: m.nz }, (_, z) => Array.from({ length: m.nx }, (_, x) => m.data[m.index(x, iy, z)] ? v[m.index(x, iy, z)] : null));
        const vertical = Array.from({ length: m.ny }, (_, y) => Array.from({ length: m.nx }, (_, x) => m.data[m.index(x, y, iz)] ? v[m.index(x, y, iz)] : null));
        const vals = vertical.flat().filter(x => x !== null);
        const max = Math.max(0, ...vals), min = Math.min(...vals);
        const tongues = vertical.slice(iy + 2).map(row => {
          const wet = row.filter(value => value !== null);
          const lo = Math.min(...wet), hi = Math.max(...wet);
          const cutoff = lo + (hi - lo) * 0.55;
          let n = 0, active = false;
          for (const value of row) { const on = value !== null && hi > lo * 1.4 && value > cutoff;
            if (on && !active) n++; active = on; }
          return n;
        });
        const draw = rows => {
          const cell = 24, canvas = document.createElement("canvas");
          canvas.width = rows[0].length * cell; canvas.height = rows.length * cell;
          const ctx = canvas.getContext("2d");
          const sorted = rows.flat().filter(value => value !== null).sort((a, b) => a - b);
          const upper = sorted[Math.floor(sorted.length * 0.95)] || max;
          for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
            const value = rows[y][x], c = value === null ? 0 : Math.min(1, value / Math.max(1e-12, upper));
            ctx.fillStyle = value === null ? "#333" : `rgb(${Math.round(245 * (1-c))},${Math.round(250 * (1-c*.55))},${Math.round(255 - c * 35)})`;
            ctx.fillRect(x * cell, (rows.length - 1 - y) * cell, cell, cell);
          }
          return canvas.toDataURL("image/png");
        };
        return { nx: m.nx, ny: m.ny, nz: m.nz, iy, iz, min, max, tongues, horizontal, vertical,
          sourceCellCount: field.sourceCells.length, flow: field.flowSolver.diagnostics(),
          bottom: m.bottom, height: m.height, volume: Array.from(v), mask: Array.from(m.data),
          images: { horizontal: draw(horizontal), vertical: draw(vertical) } };
      });
      if (slices) {
        for (const [axis, dataUrl] of Object.entries(slices.images))
          await writeFile(`${out}/e1-${t}s-${axis}.png`, Buffer.from(dataUrl.split(",")[1], "base64"));
        delete slices.images;
        await writeFile(`${out}/e1-${t}s-slices.json`, JSON.stringify(slices));
        console.log("slices", t, { min: slices.min, max: slices.max, tongues: slices.tongues });
      }
    }
    if (process.env.SCREEN) {
      // The game's own close-up camera: no extra shader compilation, so the time is right.
      if (process.env.DEBUG) {
        await page.screenshot({ path: `${out}/e${exp}-${t}s${label}-debug.png` });
        await page.evaluate(() => { const canvas = document.getElementById("tube-flow-debug"); if (canvas) canvas.style.visibility = "hidden"; });
      }
      await page.screenshot({ path: `${out}/e${exp}-${t}s${label}-screen.png` });
      if (process.env.DEBUG) await page.evaluate(() => { const canvas = document.getElementById("tube-flow-debug"); if (canvas) canvas.style.visibility = "visible"; });
      console.log("screen", t, "actual", actual.toFixed(2), "end", ((Date.now() - t0) / 1000).toFixed(2), "progress", progressAtCapture?.toFixed(2));
    }
    const shots = await page.evaluate(async ({ selectedAngles, closeup }) => {
      const THREE = await import("/node_modules/three/build/three.module.js");
      const { gl, scene, camera: game } = window.__three;
      await new Promise(r => requestAnimationFrame(() => r()));
      let group = null;
      scene.traverse(o => { if (group || o.name !== "TubeReactionVisuals") return; for (let x = o; x; x = x.parent) if (!x.visible) return; group = o; });
      if (!group) return null;
      const target = group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, closeup ? 0.012 : 0.03, 0));
      const dir = game.position.clone().sub(target).setY(0).normalize();
      const res = [];
      for (const [label, rot, horizontal, elevation] of [
        ["front", 0, closeup ? 0.09 : 0.3, closeup ? 0.012 : 0.05], ["side", closeup ? -Math.PI / 2 : Math.PI / 2, closeup ? 0.09 : 0.3, closeup ? 0.012 : 0.05],
        ["top", 0, 0.055, 0.3], ["45", -Math.PI / 4, 0.28, 0.15],
      ]) {
        if (!selectedAngles.includes(label)) continue;
        const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        const cam = new THREE.PerspectiveCamera(24, gl.domElement.width / gl.domElement.height, 0.01, 20);
        cam.position.copy(target).addScaledVector(d, horizontal).add(new THREE.Vector3(0, elevation, 0));
        cam.lookAt(target); cam.updateMatrixWorld();
        gl.render(scene, cam);
        const blob = await new Promise(resolve => gl.domElement.toBlob(resolve, "image/png"));
        const url = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
        res.push([label, url]);
      }
      return res;
    }, { selectedAngles, closeup: !!process.env.CLOSEUP });
    if (!shots) { console.log("no tube", t); continue; }
    for (const [angle, url] of shots) await writeFile(`${out}/e${exp}-${t}s${label}-${angle}.png`, Buffer.from(url.split(",")[1], "base64"));
    console.log("shot", t, "actual", actual.toFixed(2), "end", ((Date.now() - t0) / 1000).toFixed(2), "progress", progressAtCapture?.toFixed(2));
  }
  if (process.env.SHAKE && exp === 3) {
    const measure = () => page.evaluate(() => {
      const d = window.__tubeDebug;
      return d && { sediment: d.sedimentMass, suspension: d.suspensionMass,
        formed: d.formed, energy: d.velocity?.energy };
    });
    const move = (amplitude, hz) => page.evaluate(({ amplitude, hz }) => {
      if (!window.__shakeRoot) {
        let candidate = null;
        window.__three.scene.traverse(object => {
          if (object.name === "TubeReactionVisuals" && object.parent?.visible) candidate = object.parent;
        });
        window.__shakeRoot = candidate;
        window.__shakeOrigin = candidate?.position.clone();
      }
      if (!window.__shakeRoot) throw new Error("No tube root for shake");
      clearInterval(window.__shakeTimer);
      const start = performance.now();
      window.__shakeTimer = setInterval(() => {
        window.__shakeRoot.position.x = window.__shakeOrigin.x
          + amplitude * Math.sin((performance.now() - start) * hz * Math.PI * 2 / 1000);
      }, 16);
    }, { amplitude, hz });
    const stop = () => page.evaluate(() => {
      clearInterval(window.__shakeTimer);
      window.__shakeRoot.position.copy(window.__shakeOrigin);
    });
    const shakeRecords = [];
    shakeRecords.push({ phase: "before", ...(await measure()) });
    await page.screenshot({ path: `${out}/shake-before.png` });
    await move(0.0001, 1); await page.waitForTimeout(1200); await stop();
    await page.waitForTimeout(250);
    shakeRecords.push({ phase: "weak", ...(await measure()) });
    await page.screenshot({ path: `${out}/shake-weak.png` });
    await move(0.004, 4); await page.waitForTimeout(700);
    shakeRecords.push({ phase: "strong", ...(await measure()) });
    await page.screenshot({ path: `${out}/shake-strong.png` });
    await page.waitForTimeout(700); await stop();
    await page.waitForTimeout(10000);
    shakeRecords.push({ phase: "resettled", ...(await measure()) });
    await page.screenshot({ path: `${out}/shake-resettled.png` });
    await writeFile(`${out}/shake.json`, JSON.stringify(shakeRecords, null, 2));
    console.log("shake", shakeRecords);
  }
  if (process.env.VIDEO) {
    const data = await page.evaluate(async () => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      window.__reviewVideo.then(blob => reader.readAsDataURL(blob));
    }));
    await writeFile(`${out}/e${exp}-onset.webm`, Buffer.from(data.split(",")[1], "base64"));
  }
  let timing = null;
  if (process.env.FPS) {
    timing = await page.evaluate(() => {
      const start = window.__reviewPourAt;
      const indices = window.__reviewFrames.map((t, i) => ({ t, i }))
        .filter(item => item.t >= start && item.t <= start + 4000);
      const stamps = indices.map(item => item.t);
      const gaps = stamps.slice(1).map((t, i) => ({ ms: t - stamps[i], at: (t - start) / 1000,
        programsBefore: window.__reviewPrograms[indices[i].i],
        programsAfter: window.__reviewPrograms[indices[i + 1].i] }))
        .sort((a, b) => a.ms - b.ms);
      const programCounts = indices.map(item => window.__reviewPrograms[item.i]);
      return { frames: stamps.length, fps: stamps.length / 4,
        programs: [programCounts[0], programCounts.at(-1)],
        medianGap: gaps[Math.floor(gaps.length / 2)]?.ms, maxGap: gaps.at(-1),
        maxFirstSecond: gaps.filter(gap => gap.at <= 1).at(-1) };
    });
    console.log("fps", timing);
    console.log("warmup", await page.evaluate(() => window.__reactionWarmup));
    const changes = await page.evaluate(() => window.__reviewProgramChanges);
    await writeFile(`${out}/program-changes.json`, JSON.stringify(changes));
    console.log("program changes", changes.map(change => ({ at: change.at,
      names: change.programs.map(program => program.name) })));
  }
  await writeFile(`${out}/manifest.json`, JSON.stringify({ exp, quality: process.env.QUALITY ?? "AUTO", records, fps: timing }, null, 2));
} finally { await browser.close(); }
