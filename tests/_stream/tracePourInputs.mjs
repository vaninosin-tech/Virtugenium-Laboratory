// Windows: records the actual pouring inputs of experiment 2 throughout the NaCl pour (read-only; the simulation is not touched).
// Usage (from the repository root, dev server on 5201):
//   node tests/_stream/tracePourInputs.mjs
//   OUT=docs/night/stream/captures NAME=baseline node tests/_stream/tracePourInputs.mjs
//   INIT="window.__silverStream=true" NAME=stream node tests/_stream/tracePourInputs.mjs
// Output: <OUT>/<NAME>_pour_trace.json and .csv, and a summary on the console.
import { mkdir, writeFile } from "node:fs/promises";
import { openSilverPage, pour } from "../_wave11/browserCommon.mjs";

const name = process.env.NAME ?? "trace", out = process.env.OUT ?? "docs/night/stream/captures";
await mkdir(out, { recursive: true });
const { browser, page } = await openSilverPage();
try {
  const first = await pour(page, "agno3");
  if (!first.accepted) throw new Error("AgNO3 stand action refused");
  await page.waitForFunction(() => window.__testTubeStorageStore?.getState().fumeHoodTestTubes[0]?.contents.includes("agno3"));
  await page.waitForTimeout(2500);
  // Scenario check from the authoritative runtime state (before the NaCl pour).
  const scenario = await page.evaluate(async () => {
    const amounts = await import("/src/scenes/laboratory/lib/tubeAmounts.ts");
    const tube = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0];
    return { tubeId: tube.instanceId, contents: tube.contents, agnoMl: amounts.tubeAmount(tube.instanceId).volumeMl,
      standardPourMl: amounts.STANDARD_POUR_ML, capacityMl: amounts.TUBE_CAPACITY_ML,
      flags: { stage: window.__silverStage, stream: !!window.__silverStream, jet: !!window.__silverJetModel, agg: window.__silverAgg, agnoMl: window.__silverAgnoMl } };
  });
  console.log("scenario before the NaCl pour:", JSON.stringify(scenario));
  // Read-only recorder: polls the delivery ledger and the stream state; it never calls a mutating function.
  await page.evaluate(async tubeId => {
    const delivery = await import("/src/scenes/laboratory/lib/tubeDelivery.ts");
    const streamModule = await import("/src/scenes/laboratory/lib/tubeStreamModel.ts");
    const amounts = await import("/src/scenes/laboratory/lib/tubeAmounts.ts");
    const seen = new Set(), rows = [];
    window.__pourTrace = { rows, done: false };
    const timer = setInterval(() => {
      for (const e of delivery.deliveryEvents(tubeId)) {
        const key = `${e.serial}|${e.step}`;
        if (seen.has(key)) continue; seen.add(key);
        const measured = streamModule.streamStateFromEvent(e, 50);
        const reconstructed = e.sourceMouth ? streamModule.streamStateFromEvent({ ...e, sourceOutlet: undefined, sourceOutletVelocity: undefined }, 50) : undefined;
        const field = window.__silverRuntime?.field(tubeId);
        const v = e.sourceOutletVelocity;
        rows.push({ simMs: window.__diag.frozen().simMs, atMs: e.atMs, valid: e.valid, reason: e.reason, ml: e.ml, requestedMl: e.requestedMl ?? null,
          qMlPerS: measured ? measured.q * 1e6 : null, source: measured ? measured.source : "none",
          outlet: e.sourceOutlet ?? null, outletSpeed: v ? Math.hypot(v.x, v.y, v.z) : null, outletVelocity: v ?? null,
          mouth: e.sourceMouth ?? null, impact: e.point, surfaceY: e.surfaceY,
          fallUsed: measured ? measured.fall : null, fallMeasured: e.sourceOutlet ? e.sourceOutlet.y - e.point.y : null,
          fallReconstructed: reconstructed ? reconstructed.fall : null,
          impactSpeed: measured ? measured.impactSpeed : null, impactSpeedReconstructed: reconstructed ? reconstructed.impactSpeed : null,
          impactAreaMm2: measured ? measured.impactArea * 1e6 : null, impactRadiusMm: measured ? measured.impactRadius * 1e3 : null,
          momentumFluxMN: measured ? measured.momentumFlux * 1e3 : null,
          direction: measured ? [measured.direction.x, measured.direction.y, measured.direction.z] : null,
          receivingMl: amounts.tubeAmount(tubeId).volumeMl, solverStepMs: field?.solver?.lastStepMs ?? null,
          streamPrepareMs: field?.streamModel?.lastPrepareMs ?? null });
      }
    }, 10);
    window.__pourTrace.stop = () => { clearInterval(timer); window.__pourTrace.done = true; };
  }, scenario.tubeId);
  const accepted = await pour(page, "nacl");
  if (!accepted.accepted) throw new Error("NaCl stand action refused");
  await page.waitForTimeout(Number(process.env.SECONDS ?? 6) * 1000);
  const rows = await page.evaluate(() => { window.__pourTrace.stop(); return window.__pourTrace.rows; });
  const valid = rows.filter(r => r.valid);
  const summary = { scenario, events: rows.length, validEvents: valid.length, measuredShare: valid.length ? valid.filter(r => r.source === "measured").length / valid.length : 0,
    deliveredMl: valid.reduce((s, r) => s + r.ml, 0), pourDurationMs: valid.length ? valid[valid.length - 1].atMs - valid[0].atMs : 0,
    peakQmlPerS: Math.max(0, ...valid.map(r => r.qMlPerS ?? 0)), maxImpactSpeed: Math.max(0, ...valid.map(r => r.impactSpeed ?? 0)),
    fallUsedRange: [Math.min(...valid.map(r => r.fallUsed ?? Infinity)), Math.max(...valid.map(r => r.fallUsed ?? -Infinity))],
    reconstructedMinusMeasuredFall: valid.filter(r => r.fallMeasured !== null && r.fallReconstructed !== null).map(r => r.fallReconstructed - r.fallMeasured) };
  await writeFile(`${out}/${name}_pour_trace.json`, JSON.stringify({ summary, rows }, null, 1));
  const columns = ["simMs", "atMs", "valid", "reason", "ml", "qMlPerS", "source", "fallUsed", "fallMeasured", "fallReconstructed", "outletSpeed", "impactSpeed",
    "impactSpeedReconstructed", "impactAreaMm2", "momentumFluxMN", "receivingMl", "solverStepMs", "streamPrepareMs"];
  await writeFile(`${out}/${name}_pour_trace.csv`, [columns.join(","), ...rows.map(r => columns.map(c => r[c] ?? "").join(","))].join("\n"));
  console.log("summary:", JSON.stringify(summary, null, 1));
  if (summary.measuredShare < 1) console.log("WARNING: some valid events had no measured outlet (reconstructed fallback used). Do not treat those rows as measured data.");
} finally { await browser.close(); }
