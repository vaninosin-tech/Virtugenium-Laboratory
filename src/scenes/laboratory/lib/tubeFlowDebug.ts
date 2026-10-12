import { TubeFlowSolver } from "./tubeFlowSolver";

type DebugWindow = Window & { __tubeDebugEnabled?: boolean; __tubeDebug?: unknown;
  __tubeDebugFlags?: Record<string, boolean> };
let canvas: HTMLCanvasElement | null = null;
let lastDraw = 0;

/** Temporary orthogonal slices, enabled explicitly in the developer console. */
export function updateTubeFlowDebug(kind: string, solver: TubeFlowSolver, tracer: Float64Array,
  reagent: Float64Array, turbidity?: Float32Array, sedimentMass = 0,
  extra?: () => Record<string, number>, extraFields?: Record<string, ArrayLike<number>>) {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  const debugWindow = window as DebugWindow;
  if (!debugWindow.__tubeDebugEnabled) {
    canvas?.remove(); canvas = null; debugWindow.__tubeDebug = undefined;
    return;
  }
  const now = performance.now();
  if (now - lastDraw < 150) return;
  lastDraw = now;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "tube-flow-debug";
    canvas.width = 840; canvas.height = 560;
    canvas.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:99999;background:#08131be8;";
    canvas.style.cssText += "border:1px solid #668;pointer-events:none;max-width:calc(100vw - 16px)";
    document.body.append(canvas);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const m = solver.mask, flow = solver.flow;
  const velocity = solver.diagnostics(), trace = solver.scalarDiagnostics(tracer);
  const reagentStats = solver.scalarDiagnostics(reagent);
  debugWindow.__tubeDebug = { kind, velocity, tracer: trace, reagent: reagentStats,
    sedimentMass, ...extra?.(), mask: m, flow, tracerField: tracer, reagentField: reagent,
    turbidity, fields: extraFields };
  ctx.fillStyle = "#08131b"; ctx.fillRect(0, 0, 840, 560);
  ctx.font = "12px monospace"; ctx.fillStyle = "#dce7ed";
  ctx.fillText(`${kind}  tracer ${trace.mass.toFixed(4)}  variance ${trace.variance.toFixed(1)}  occupied ${(trace.occupiedFraction * 100).toFixed(0)}%`, 10, 18);
  ctx.fillText(`energy ${velocity.energy.toExponential(2)}  moving ${(velocity.movingFraction * 100).toFixed(0)}%  |div| ${velocity.meanAbsDivergence.toFixed(3)}  step ${velocity.medianStepMs.toFixed(2)}ms  sediment ${sedimentMass.toFixed(4)}`, 10, 36);
  const fields: [string, ArrayLike<number>, string][] = [
    ["inert tracer", tracer, "0,220,240"], ["reagent", reagent, "190,80,240"],
    ["turbidity", turbidity ?? new Float32Array(0), "245,245,245"],
    ...Object.entries(extraFields ?? {}).map(([name, values]): [string, ArrayLike<number>, string] =>
      [name, values, "245,180,90"]),
  ];
  const enabled = fields.filter(([label]) => debugWindow.__tubeDebugFlags?.[label] !== false);
  for (let panel = 0; panel < Math.min(7, enabled.length); panel++) {
    const [label, values, rgb] = enabled[panel];
    const left = 12 + panel % 4 * 208, top = 72 + Math.floor(panel / 4) * 245;
    const cell = Math.min(188 / m.nx, 205 / m.ny);
    let max = 0;
    for (let a = 0; a < m.activeCount; a++) max = Math.max(max, values[m.active[a]] ?? 0);
    ctx.fillStyle = "#dce7ed"; ctx.fillText(label, left, top - 12);
    for (let y = 0; y < m.ny; y++) for (let x = 0; x < m.nx; x++) {
      let value = 0;
      for (let z = 0; z < m.nz; z++) value = Math.max(value, values[m.index(x, y, z)] ?? 0);
      const alpha = Math.min(1, value / Math.max(1e-30, max));
      ctx.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
      ctx.fillRect(left + x * cell, top + (m.ny - y - 1) * cell, cell + 0.4, cell + 0.4);
    }
  }
  if (debugWindow.__tubeDebugFlags?.velocity === false) return;
  const slot = Math.min(7, enabled.length);
  const left = 12 + slot % 4 * 208, top = 72 + Math.floor(slot / 4) * 245;
  const scale = Math.min(188 / m.nx, 90 / m.ny);
  ctx.fillStyle = "#dce7ed"; ctx.fillText("velocity XY / XZ", left, top - 12);
  ctx.strokeStyle = "#42d8a4"; ctx.lineWidth = 1;
  const zMid = Math.floor(m.nz / 2), yMid = Math.floor(m.ny * 0.5);
  for (let y = 1; y < m.ny; y += 2) for (let x = 1; x < m.nx; x += 2) {
    const i = m.index(x, y, zMid);
    if (!m.data[i]) continue;
    const vx = flow[i * 3], vy = flow[i * 3 + 1];
    const px = left + x * scale, py = top + (m.ny - y) * scale;
    ctx.beginPath(); ctx.moveTo(px, py);
    ctx.lineTo(px + Math.max(-7, Math.min(7, vx * 300)), py - Math.max(-7, Math.min(7, vy * 300)));
    ctx.stroke();
  }
  for (let z = 1; z < m.nz; z += 2) for (let x = 1; x < m.nx; x += 2) {
    const i = m.index(x, yMid, z);
    if (!m.data[i]) continue;
    const px = left + x * scale, py = top + 115 + (m.nz - z) * scale;
    ctx.beginPath(); ctx.moveTo(px, py);
    ctx.lineTo(px + Math.max(-7, Math.min(7, flow[i * 3] * 300)),
      py - Math.max(-7, Math.min(7, flow[i * 3 + 2] * 300)));
    ctx.stroke();
  }
}
