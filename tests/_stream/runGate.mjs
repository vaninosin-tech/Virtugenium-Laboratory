// Windows: runs the final stream validation gate with identical delivery and camera conditions for
//   A  accepted baseline (aggregation off)
//   B  corrected experimental stream (surfaceRise + coupling 8)
//   C  legacy jet model (diagnostics only)
// For each configuration it records (1) the pouring-input trace, (2) the pouring FPS / worst-frame / solver cost, (3) a continuous recording
// with in-page time records, using the existing scripts. Start the dev server first (port 5201). Nothing here changes the game defaults.
//   node tests/_stream/runGate.mjs                  all three, OUT=docs/night/stream/gate
//   ONLY=A,B node tests/_stream/runGate.mjs         a subset
//   STEPS=trace,fps node tests/_stream/runGate.mjs  a subset of the steps (trace, fps, record)
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.env.OUT ?? "docs/night/stream/gate";
const url = process.env.URL ?? "http://127.0.0.1:5201/";
const configs = {
  A: { name: "A_baseline", init: "" },
  B: { name: "B_corrected_stream", init: "window.__silverStream={surfaceRise:true};window.__silverStreamCoupling=8;" },
  C: { name: "C_legacy_jet", init: "window.__silverJetModel=1;" },
};
const only = (process.env.ONLY ?? "A,B,C").split(",").map(s => s.trim().toUpperCase()).filter(k => configs[k]);
const steps = (process.env.STEPS ?? "trace,fps,record").split(",").map(s => s.trim());
try { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); }
catch (e) { console.error(`The dev server does not answer at ${url}: ${e.message}. Start it from the branch copy first.`); process.exit(2); }

const commands = {
  trace: (c, out) => ["tests/_stream/tracePourInputs.mjs", { NAME: c.name, OUT: join(out, "trace") }],
  fps: (c, out) => ["tests/_wave13/measureFpsPour.mjs", { NAME: c.name, OUT: join(out, "fps"), RUNS: process.env.RUNS ?? "3" }],
  record: (c, out) => ["tests/_wave15/baselineRecord.mjs", { OUT: join(out, "record"), BOTH: process.env.BOTH ?? "1" }],
};
const log = [];
for (const key of only) {
  const config = configs[key], out = join(root, config.name);
  await mkdir(out, { recursive: true });
  for (const step of steps) {
    if (!commands[step]) { console.warn(`unknown step ${step}`); continue; }
    const [script, env] = commands[step](config, out);
    console.log(`\n=== ${config.name}: ${step} (${script}) ===`);
    const started = Date.now();
    const result = spawnSync(process.execPath, [script], { stdio: "inherit", env: { ...process.env, ...env, INIT: config.init, URL: url } });
    log.push({ config: config.name, step, script, status: result.status, seconds: Math.round((Date.now() - started) / 1000), out });
    if (result.status !== 0) console.warn(`!! ${config.name} ${step} exited with ${result.status}; continuing`);
  }
}
await writeFile(join(root, "gate_run.json"), JSON.stringify({ when: new Date().toISOString(), url, only, steps, log }, null, 1));
console.log("\nSummary:"); for (const l of log) console.log(`  ${l.config.padEnd(22)} ${l.step.padEnd(7)} exit ${l.status}  ${l.seconds}s  ${l.out}`);
console.log(`\nResults are under ${root}. Compare stages (impact, first AgCl, near-surface cloud, dense regions, gaps, milkiness, motion after the pour), not playback times.`);
