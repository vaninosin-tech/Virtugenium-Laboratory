import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const out = process.env.OUT ?? "D:/Claude/virtugenium-night/frames/real";
const seconds = Number(process.env.SECONDS ?? 26);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--window-size=1400,950", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(900000);
  page.on("pageerror", e => console.log("pageerror", e.message.slice(0, 300)));
  await page.addInitScript(`window.__silverStage=${process.env.STAGE ?? 3}; window.__silverDiag=${JSON.stringify(process.env.DIAG ?? "")};`);
  await page.goto("http://127.0.0.1:5201/");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 300000 });
  await page.locator(".lab-boot-screen").waitFor({ state: "hidden", timeout: 300000 });
  await page.waitForTimeout(2500);
  // The same call the 3D click on a bottle makes (standActionFor -> startPour): the real pour, not the sandbox timer.
  const real = (reagent) => page.evaluate(async (id) => {
    const { runStandAction } = await import("/src/scenes/laboratory/lib/standTableActions.ts");
    const { useStandMotionStore } = await import("/src/scenes/laboratory/lib/useStandMotionStore.ts");
    const ok = runStandAction({ kind: "bottle", location: "fumeHood", reagentId: id, instanceId: `sandbox-jar-${id}` });
    return { ok, pour: !!useStandMotionStore.getState().pour };
  }, reagent);
  if (process.env.CLOSE === "1") { await page.keyboard.press("q"); await page.waitForTimeout(3000); }
  console.log("agno3", JSON.stringify(await real("agno3")));
  await page.waitForTimeout(6000);
  const shots = []; const t0 = Date.now();
  const probe = () => page.evaluate(async () => {
    const imp = await import("/src/scenes/laboratory/lib/tubePourImpact.ts");
    const am = await import("/src/scenes/laboratory/lib/tubeAmounts.ts");
    const sm = await import("/src/scenes/laboratory/lib/useStandMotionStore.ts");
    const tube = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0];
    const id = tube?.instanceId; const i = id ? imp.tubePourImpact(id) : undefined; const f = window.__silverFieldLive;
    let tr = 0, depth = 0, lat = 0, src = 0, extent = 0, cl = 0, top = -1e9;
    if (f) { const m = f.mask; for (let a = 0; a < m.activeCount; a++) { const c = m.active[a]; const y = Math.floor(c / m.nx) % m.ny; top = Math.max(top, m.bottom + (y + 0.5) / m.ny * m.height); }
      for (let a = 0; a < m.activeCount; a++) { const c = m.active[a]; const y = Math.floor(c / m.nx) % m.ny; const py = m.bottom + (y + 0.5) / m.ny * m.height; tr += f.tracer[c]; depth += f.tracer[c] * (top - py); src += f.productSource[c]; }
      extent = f.extent; cl = f.species["Cl-"].total; }
    const p = sm.useStandMotionStore.getState().pour;
    return { pour: p ? (Date.now() - p.at) / sm.POUR_MS : null, volume: id ? am.tubeAmount(id).volumeMl : null, impact: i ? { x: i.point.x, y: i.point.y, z: i.point.z, ml: i.deliveredMl, flow: i.flowMlPerSecond, reagent: i.reagentId } : null,
      tracer: tr, tracerDepthMm: tr > 1e-9 ? depth / tr * 1000 : null, cl, extent, source: src, delivered: f ? f.delivered : null };
  });
  const events = [];
  const grab = async () => { try { const q = await Promise.race([probe(), new Promise(r => setTimeout(() => r(null), 3000))]); if (q) events.push({ t: (Date.now() - t0) / 1000, ...q }); } catch { } const n = `${out}/f${String(shots.length).padStart(4, "0")}.png`; await page.screenshot({ path: n, clip: process.env.CLIP ? JSON.parse(process.env.CLIP) : undefined }); shots.push({ n: n.split("/").pop(), dt: (Date.now() - t0) / 1000 }); };
  await grab();
  const naclClickAt = (Date.now() - t0) / 1000; console.log("nacl", JSON.stringify(await real("nacl")), "clicked at", naclClickAt.toFixed(2));
  await writeFile(`${out}/click.json`, JSON.stringify({ naclClickAt }));
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) { try { await Promise.race([grab(), new Promise((_, r) => setTimeout(() => r(new Error("stall")), 20000))]); } catch { } }
  await writeFile(`${out}/stamps.json`, JSON.stringify(shots, null, 1));
  await writeFile(`${out}/events.json`, JSON.stringify(events, null, 1));
  const state = await page.evaluate(() => { const t = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0]; return { contents: t?.contents, level: window.__tubeDebug }; });
  console.log("state", JSON.stringify(state).slice(0, 300));
} finally { await browser.close(); }
