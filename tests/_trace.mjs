// Four-stage trace of the first validated NaCl delivery: ledger (A), CPU field (B), GPU upload (C), displayed pixels (D, screencast frames stamped by an in-page overlay).
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const out = process.env.OUT ?? "D:/Claude/virtugenium-night/frames/trace";
await mkdir(`${out}/frames`, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--window-size=1400,950", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-features=CalculateNativeWinOcclusion"] });
try {
  const page = await browser.newPage({ viewport: { width: Number(process.env.VW ?? 1280), height: Number(process.env.VH ?? 800) } });
  page.setDefaultTimeout(900000);
  if (process.env.SLOW) await page.addInitScript(`(() => { const k = ${Number(process.env.SLOW)}, d0 = Date.now(), real = Date.now.bind(Date); Date.now = () => d0 + (real() - d0) * k; })();`);
  await page.addInitScript(`window.__silverStage=3; window.__silverDiag=${JSON.stringify(process.env.DIAG ?? "tracer")};`);
  await page.goto(process.env.URL ?? "http://127.0.0.1:5201/");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 300000 });
  await page.locator(".lab-boot-screen").waitFor({ state: "hidden", timeout: 300000 });
  await page.waitForTimeout(2500);
  if (process.env.HIDEUI) await page.evaluate(() => { window.__hideUi = true; });
  await page.evaluate(async () => {
    const sm = await import("/src/scenes/laboratory/lib/useStandMotionStore.ts");
        window.__tr = []; window.__trStop = false;
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:6px;bottom:60px;z-index:99999;font:700 22px monospace;color:#ff0;background:#000a;padding:4px 8px;white-space:pre";
    document.body.appendChild(box);
    if (window.__hideUi) { let el = document.querySelector('canvas'); while (el && el !== document.body) { for (const sib of el.parentElement.children) if (sib !== el && sib !== box) sib.style.display = 'none'; el = el.parentElement; } }
    const stats = () => {
      const id = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0]?.instanceId;
      const f = id ? window.__silverRuntime?.field(id) : null;
      const rec = { sim: sm.simNowMs(), perf: performance.now(), wall: (performance.timeOrigin + performance.now()) / 1000, rend: window.__three.gl.info.render.frame };
      const dg = f ? window.__silverRuntime.diagnostics(id) : null;
      rec.A = { events: dg ? dg.eventIds.length : 0, valid: dg ? dg.eventIds.length : 0, delivered: dg ? dg.deliveredMl : 0, firstValid: dg ? { atMs: dg.firstValidImpactMs, y: dg.firstImpactPoint.y, surfaceY: dg.surfaceY } : null };
      if (f) {
        const m = f.mask; let sum = 0, max = 0, n = 0, arg = -1;
        for (let a = 0; a < m.activeCount; a++) { const c = m.active[a]; const v = f.tracer[c]; sum += v; if (v > 1e-9) n++; if (v > max) { max = v; arg = c; } }
        let ylo = 1e9, yhi = -1e9;
        for (let a = 0; a < m.activeCount; a++) { const c = m.active[a]; if (f.tracer[c] > 1e-9) { const y = Math.floor(c / m.nx) % m.ny; ylo = Math.min(ylo, y); yhi = Math.max(yhi, y); } }
        const gy = arg >= 0 ? Math.floor(arg / m.nx) % m.ny : -1;
        rec.B = { tracerSum: sum, tracerMax: max, cells: n, rowLo: n ? ylo : null, rowHi: n ? yhi : null, ny: m.ny, nx: m.nx, nz: m.nz,
          argCell: arg >= 0 ? [arg % m.nx, gy, Math.floor(arg / (m.nx * m.ny))] : null,
          argLocalY_mm: arg >= 0 ? +((m.bottom + (gy + 0.5) / m.ny * m.height) * 1000).toFixed(2) : null,
          wetTopRow: (() => { let t = -1; for (let a = 0; a < m.activeCount; a++) { const y = Math.floor(m.active[a] / m.nx) % m.ny; if (y > t) t = y; } return t; })(), age: f.ageSeconds };
        let omax = 0, onz = 0; for (let i = 0; i < f.overlapPixels.length; i++) { if (f.overlapPixels[i] > omax) omax = f.overlapPixels[i]; if (f.overlapPixels[i] > 1e-9) onz++; }
        const tex = f.overlapTexture, gl = window.__three.gl;
        let mesh = null; window.__three.scene.traverse(o => { if (o.name === "TubeSilverDenseField") mesh = o; });
        rec.C = { overlapMax: omax, overlapNonzero: onz, texVersion: tex.version, uploadedVersion: gl.properties.get(tex).__version ?? null,
          meshVisible: mesh ? mesh.visible : null, bound: mesh ? mesh.material.uniforms.uOverlap.value === tex : null, uDiag: mesh ? mesh.material.uniforms.uDiag.value : null };
      }
      return rec;
    };
    const vo = Number(window.__viewShift ?? 0);
    const frame = () => { if (window.__zoom) { const c = window.__three.camera; if (c.zoom !== window.__zoom) { c.zoom = window.__zoom; c.updateProjectionMatrix(); } } if (window.__viewShift) { const c = window.__three.camera; c.setViewOffset(innerWidth, innerHeight, 0, -window.__viewShift, innerWidth, innerHeight); } const r = stats(); r.kind = "raf"; window.__tr.push(r);
      box.textContent = `sim ${r.sim.toFixed(0)} ms  frame ${r.rend}\nA valid ${r.A.valid} dl ${r.A.delivered.toFixed(3)}  B cells ${r.B ? r.B.cells : "-"} sum ${r.B ? r.B.tracerSum.toFixed(4) : "-"}\nC ovl>0 ${r.C ? r.C.overlapNonzero : "-"} up ${r.C ? r.C.uploadedVersion + "/" + r.C.texVersion : "-"}`;
      if (!window.__trStop) requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    sm.onSimulationTick(() => { const r = stats(); r.kind = "tick"; window.__tr.push(r); });
  });
  if (process.env.SHIFT) await page.evaluate(v => { window.__viewShift = v; }, Number(process.env.SHIFT));
  if (process.env.ZOOM) await page.evaluate(v => { window.__zoom = v; }, Number(process.env.ZOOM));
  if (process.env.DIAGCAM) await page.evaluate(v => { window.__diagCamera = v; }, JSON.parse(process.env.DIAGCAM));
  const real = (id) => page.evaluate(async (id) => {
    const { runStandAction } = await import("/src/scenes/laboratory/lib/standTableActions.ts");
    window.__clickSim = (await import("/src/scenes/laboratory/lib/useStandMotionStore.ts")).simNowMs();
    return runStandAction({ kind: "bottle", location: "fumeHood", reagentId: id, instanceId: `sandbox-jar-${id}` });
  }, id);
  const cdp = await page.context().newCDPSession(page);
  const frames = []; let recording = false;
  cdp.on("Page.screencastFrame", async (f) => { if (recording) frames.push({ t: f.metadata.timestamp, data: f.data }); try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {} });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: Number(process.env.VW ?? 1280), maxHeight: Number(process.env.VH ?? 800), everyNthFrame: 1 });
  await real("agno3");
  if (process.env.CLOSE !== "0") { await page.evaluate(async () => { const m = await import("/src/scenes/laboratory/lib/useTubeCloseUpStore.ts"); m.useTubeCloseUpStore.getState().setViewing(true); }); await page.waitForTimeout(Number(process.env.CLOSEWAIT ?? 3000)); }
  await page.waitForTimeout(Number(process.env.SETTLE ?? 7000));
  recording = true;
  await real("nacl");
  await page.waitForTimeout(Number(process.env.SECONDS ?? 14) * 1000);
  recording = false;
  const idx = [];
  for (let k = 0; k < frames.length; k++) { const fn = `s${String(k).padStart(5, "0")}.jpg`; await writeFile(`${out}/frames/${fn}`, Buffer.from(frames[k].data, "base64")); idx.push({ fn, t: frames[k].t - frames[0].t, abs: frames[k].t }); }
  await writeFile(`${out}/frames/index.json`, JSON.stringify({ idx }));
  const data = await page.evaluate(() => { window.__trStop = true; const id = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0].instanceId; return { clickSim: window.__clickSim, trace: window.__tr, diag: window.__silverRuntime.diagnostics(id) }; });
  await writeFile(`${out}/trace.json`, JSON.stringify(data));
  console.log("trace", data.trace.length, "frames", frames.length, "clickSim", data.clickSim);
} finally { await browser.close(); }
