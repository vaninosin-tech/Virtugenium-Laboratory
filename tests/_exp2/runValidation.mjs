// Windows: recordings of Experiment 2 (2.5 mL AgNO3 0.1 M + 1 mL NaCl 0.1 M) for the four physical configurations, with identical conditions:
//   A  accepted baseline            (aggregation off, no density coupling)
//   B  net density only             (window.__silverDensity = { model: "net" }, aggregation off)
//   C  aggregation only             (window.__silverAgg = 1)
//   D  net density + aggregation    (+ window.__silverDeposit for the consolidating bed)
// Start the dev server first (port 5201, folder D:\Claude\vl-claude on the branch claude/epic-brown-yxujey), then:
//   node tests/_exp2/runValidation.mjs                      all four, OUT=docs/night/exp2/validation
//   ONLY=A,D DURATION_MS=60000 SLOW=0.5 node tests/_exp2/runValidation.mjs
// The recorder is tests/_wave15/baselineRecord.mjs (its own "wide" and "close" cameras: check them against the accepted side camera before
// judging). SLOW is the simulation clock scale of the recorder (0.15 = slow motion; the 180 s run at 0.15 takes about 20 minutes).
// Nothing here changes the game defaults; the flags live in the page only.
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(process.env.OUT ?? "docs/night/exp2/validation");
const url = process.env.URL ?? "http://127.0.0.1:5201/";
const duration = process.env.DURATION_MS ?? "60000", slow = process.env.SLOW ?? "0.5";
const configs = {
  A: { name: "A_baseline", init: "" },
  B: { name: "B_net_density", init: "window.__silverDensity={model:'net'};" },
  C: { name: "C_aggregation", init: "window.__silverAgg=1;" },
  D: { name: "D_net_density_aggregation_bed", init: "window.__silverDensity={model:'net'};window.__silverAgg=1;window.__silverDeposit=true;" },
};
const only = (process.env.ONLY ?? "A,B,C,D").split(",").map(s => s.trim().toUpperCase()).filter(k => configs[k]);
try { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); }
catch (e) { console.error(`The dev server does not answer at ${url}: ${e.message}. Start it first.`); process.exit(2); }
const log = [];
for (const key of only) {
  const config = configs[key], out = join(root, config.name);
  await mkdir(out, { recursive: true });
  console.log(`\n=== ${config.name} (INIT: ${config.init || "none"}) ===`);
  const started = Date.now();
  const result = spawnSync(process.execPath, ["tests/_wave15/baselineRecord.mjs"], { stdio: "inherit",
    env: { ...process.env, OUT: join(out, "record"), BOTH: process.env.BOTH ?? "1", INIT: config.init, URL: url, DURATION_MS: duration, SLOW: slow } });
  log.push({ config: config.name, init: config.init, status: result.status, seconds: Math.round((Date.now() - started) / 1000), out });
}
await writeFile(join(root, "validation_run.json"), JSON.stringify({ when: new Date().toISOString(), url, duration, slow, log }, null, 1));
for (const l of log) console.log(`  ${l.config.padEnd(32)} exit ${l.status}  ${l.seconds}s  ${l.out}`);
console.log("\nCompare the stages in this order: white AgCl forming; dense irregular regions; milkiness; stretching; narrowing or separation; collective downward motion; bottom deposit; compaction. Do not compare playback times.");
