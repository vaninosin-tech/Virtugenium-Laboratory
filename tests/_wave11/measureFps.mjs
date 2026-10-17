import { writeFile } from "node:fs/promises";
import { openSilverPage, prepareSilver, waitSimulationElapsed, outputDir } from "./browserCommon.mjs";

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * fraction, lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}
function summarize(times) {
  return { frames: times.length, medianFrameMs: percentile(times, 0.5), medianFps: 1000 / percentile(times, 0.5),
    p90FrameMs: percentile(times, 0.9), p10Fps: 1000 / percentile(times, 0.9) };
}
let browser;
const report = { timing: "CPU-side requestAnimationFrame intervals", cases: [], gpuTimer: "unavailable" };
try {
  const opened = await openSilverPage(); browser = opened.browser;
  const { page } = opened;
  const clickSim = await prepareSilver(page);
  await waitSimulationElapsed(page, clickSim, 3000);
  await page.evaluate(() => window.__diag.pauseSimulation());
  for (const test of [{ name: "cloud-off", cloud: false, mode: 0 }, ...[0, 1, 2, 3].map(mode => ({ name: `mode-${mode}`, cloud: true, mode }))]) {
    const sample = await page.evaluate(async ({ cloud, mode }) => {
      window.__silverCloud = cloud; window.__diag.setOpticsMode(mode);
      const renderer = window.__three.gl, gl = renderer.getContext();
      const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      let mesh; window.__three.scene.traverse(object => { if (object.name === "TubeSilverDenseField") mesh = object; });
      if (!mesh?.visible) throw new Error("Silver cloud mesh not visible");
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const times = [];
      let last = performance.now();
      for (let i = 0; i < 600; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const now = performance.now(); times.push(now - last); last = now;
      }
      const gpuMs = [];
      if (ext) for (let i = 0; i < 30; i++) {
        const query = gl.createQuery();
        await new Promise(resolve => requestAnimationFrame(resolve));
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
        await new Promise(resolve => requestAnimationFrame(resolve));
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        for (let poll = 0; poll < 120 && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE); poll++)
          await new Promise(resolve => requestAnimationFrame(resolve));
        if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT))
          gpuMs.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(query);
      }
      return { times, gpuMs, gpuTimerAvailable: !!ext, cloudOn: mesh.material.uniforms.uCloudOn.value,
        opticsMode: mesh.material.uniforms.uOpticsMode.value };
    }, test);
    if (sample.cloudOn !== Number(test.cloud) || sample.opticsMode !== test.mode) throw new Error(`Uniform mismatch in ${test.name}`);
    report.cases.push({ name: test.name, cloud: test.cloud, mode: test.mode, ...summarize(sample.times),
      gpuFrameMs: sample.gpuMs.length ? percentile(sample.gpuMs, 0.5) : null, gpuSamples: sample.gpuMs.length });
    if (sample.gpuTimerAvailable) report.gpuTimer = sample.gpuMs.length ? "EXT_disjoint_timer_query_webgl2" : "extension exposed but all queries disjoint or unavailable";
  }
  const baseline = report.cases[0].medianFrameMs;
  for (const entry of report.cases) entry.addedRenderCostMs = entry.medianFrameMs - baseline;
  const gpuBaseline = report.cases[0].gpuFrameMs;
  if (gpuBaseline !== null) for (const entry of report.cases)
    entry.addedGpuMs = entry.gpuFrameMs === null ? null : entry.gpuFrameMs - gpuBaseline;
  const out = await outputDir();
  await writeFile(`${out}/measureFps.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { if (browser) await browser.close(); }
