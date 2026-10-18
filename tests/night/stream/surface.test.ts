import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// Priority 3: free-surface consistency of the stream. (Driver copied from coupling.test.ts.)
// Priority 2 context: is the position of the newly formed AgCl an artefact of the order "transport (many sub-steps), then react once"?
// Same scenario for every run (verified in the game: 1 mL AgNO3, then the 1 mL NaCl portion on the game pour curve), same
// delivered mass, same kinetics, same grid. The passive-scalar feedback on the flow is off (__silverBuoy = 0) so the faces
// are identical in every run; only the interval at which transport and reaction alternate changes.
const INITIAL_ML = Number(process.env.INITIAL_ML ?? 1);
const SNAPS = [1000, 1350, 2500, 4000];

interface Surf { sourcePos: number; sinkNeg: number; lateralRatio: number; sourceNet: number; meanAbsDiv: number; topRowDiv: number; belowDiv: number; qOverV: number; inward: number; riseMm: number; maxSpeed: number }
interface Result { n: number; label: string; extent: Map<number, number>; formedByY: Float64Array; level: number; dy: number;
  conserved: number; minSpecies: number; advanceMs: number[]; substeps: number; courant: number }

async function run(coupling: number | undefined, stream: unknown = true): Promise<Result & { surf: Map<number, Surf>; volumeErr: number; tracerErr: number }> {
  vi.stubGlobal('window', { location: { search: '' } });
  const g = globalThis as Record<string, unknown>;
  g.__silverStream = stream; g.__silverBuoy = 0;
  if (coupling !== undefined) g.__silverStreamCoupling = coupling;
  const { TubeSilverField } = await import('../../../src/scenes/laboratory/lib/tubeSilverField');
  const { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } = await import('../../../src/scenes/laboratory/lib/tubeSilverGeometry');
  const { tubeLiquidHeight } = await import('../../../src/scenes/laboratory/lib/tubeLiquidLevel');
  const { pouredMl } = await import('../../../src/scenes/laboratory/lib/tubePourImpact');
  const { streamStateFromEvent } = await import('../../../src/scenes/laboratory/lib/tubeStreamModel');
  const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const priv = f as unknown as { productSource: Float64Array; solver: { substeps: number; lastMaxCourant: number } };
  const m = f.mask, dy = m.height / m.ny, up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0.0065, 0, 0);
  const formedByY = new Float64Array(m.ny), extent = new Map<number, number>(), advanceMs: number[] = [], surf = new Map<number, Surf>();
  let previousMl = 0, delivered = 0, mlTotal = INITIAL_ML, started = false, conserved = 0, minSpecies = 0, level = 0, substeps = 0, courant = 0, volumeErr = 0, tracerErr = 0;
  for (let atMs = 0; atMs <= 4000; atMs += 50) {
    const total = pouredMl(Math.min(1, atMs / 1700)), ml = total - previousMl;
    let rate = 0;
    if (ml > 1e-12) { previousMl = total; delivered += ml; mlTotal += ml; rate = ml * 20; started = true; }
    if (!started) continue;
    level = tubeLiquidHeight(mlTotal, silverEffectiveRadius);
    m.update(up, level);
    let top = -Infinity;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny)), p = m.point(x, y, z);
      if (Math.hypot(p.x - inlet.x, p.z - inlet.z) <= 0.003 && p.y > top) top = p.y;
    }
    inlet.y = top;
    if (ml > 1e-12) f.streamState = streamStateFromEvent({ tubeId: 't', reagentId: 'nacl', serial: 1, step: atMs, ml, requestedMl: ml,
      point: { x: 0.0065, y: level, z: 0 }, surfaceY: level, atMs, valid: true, reason: 'ok', sourceMouth: { x: 0, y: 0.15, z: 0 } }, 50);
    const t0 = performance.now();
    f.advance(0.05, up, level, inlet, Math.min(1, delivered), 0, rate, undefined);
    if (ml > 1e-12) { advanceMs.push(performance.now() - t0); substeps = Math.max(substeps, priv.solver.substeps); courant = Math.max(courant, priv.solver.lastMaxCourant); }
    f.streamState = undefined;
    f.assertMassInvariant();
    conserved = Math.max(conserved, Math.abs(f.species['Ag+'].total + f.extent - f.silverAmount), Math.abs(f.species['Cl-'].total + f.extent - f.delivered));
    minSpecies = Math.min(minSpecies, ...f.species['Ag+'].values, ...f.species['Cl-'].values, ...f.suspension[0]);
    for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; formedByY[Math.floor(i / m.nx) % m.ny] += priv.productSource[i]; }
    if (SNAPS.includes(atMs)) extent.set(atMs, f.extent);
    // Volume and reagent bookkeeping at every step.
    {
      let wet = 0; for (let a = 0; a < m.activeCount; a++) wet += m.cellVolumeMl[m.active[a]];
      volumeErr = Math.max(volumeErr, Math.abs(wet - mlTotal));
      let tr = 0; for (let a = 0; a < m.activeCount; a++) tr += f.tracer[m.active[a]];
      tracerErr = Math.max(tracerErr, Math.abs(tr - f.delivered));
    }
    if (ml > 1e-12 && atMs <= 1700 && f.streamModel?.active) {
      // Residual divergence of the final faces (the prescribed surface sources are part of the target), per row group.
      const faces = (f as unknown as { solver: { faces: Float32Array[]; flow: Float32Array } }).solver;
      const extra = f.streamModel.surfaceRise ? f.streamModel.extraDivergence : null;
      const dxs = [2 * m.radius / m.nx, dy, 2 * m.radius / m.nz], strides = [1, m.nx, m.nx * m.ny];
      let all = 0, topSum = 0, belowSum = 0, topCells = 0, cellsAll = 0, inward = 0, inwardCells = 0, rise = 0, maxSpeed = 0;
      const cellV = dxs[0] * dxs[1] * dxs[2];
      let topRow = -1; for (let a = 0; a < m.activeCount; a++) topRow = Math.max(topRow, Math.floor(m.active[a] / m.nx) % m.ny);
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny)), co = [x, y, z], lim = [m.nx, m.ny, m.nz];
        let div = 0;
        for (let ax = 0; ax < 3; ax++) {
          const plus = co[ax] + 1 < lim[ax] && m.data[i + strides[ax]], minus = co[ax] > 0 && m.data[i - strides[ax]];
          div += ((plus ? faces.faces[ax][i] : 0) - (minus ? faces.faces[ax][i - strides[ax]] : 0)) / dxs[ax];
        }
        div -= extra ? extra[i] : 0;
        all += Math.abs(div); cellsAll++;
        if (y >= topRow - 1) { topSum += Math.abs(div); topCells++;
          const p = m.point(x, y, z), rx = p.x - 0.0065, rz = p.z, r = Math.hypot(rx, rz);
          if (r > 1e-6 && r < 0.004) { inward += -(faces.flow[3 * i] * rx + faces.flow[3 * i + 2] * rz) / r; inwardCells++; }
          rise += faces.flow[3 * i + 1];
        } else belowSum += Math.abs(div);
        maxSpeed = Math.max(maxSpeed, Math.hypot(faces.flow[3 * i], faces.flow[3 * i + 1], faces.flow[3 * i + 2]));
      }
      // Double-counting audit: the net lateral volume flux that the final faces carry into each jet footprint layer, against the
      // entrainment the integral model prescribed for that layer (the sum over layers of the imposed inflow).
      let planned = 0, realised = 0;
      const model = f.streamModel, areaXZ = dxs[0] * dxs[2];
      const rowsFixed = new Map<number, number[]>();
      for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; if (model.fixed[3 * i + 1]) { const y = Math.floor(i / m.nx) % m.ny; (rowsFixed.get(y) ?? rowsFixed.set(y, []).get(y)!).push(i); } }
      const flux = new Map<number, number>();
      for (const [y, cells] of rowsFixed) { let q = 0; for (const i of cells) q += -model.value[3 * i + 1] * areaXZ; flux.set(y, q); }
      for (const [y, cells] of rowsFixed) {
        const upper = flux.get(y + 1) ?? model.state!.q;       // flux entering this layer from above (stream volume at the first layer)
        planned += Math.max(0, flux.get(y)! - upper);
        const set = new Set(cells.map(i => i + m.nx));         // the cells above the faces: the layer's cells
        let inflow = 0;
        for (const i of set) for (const [ax, stride, lim, c, area] of [[0, 1, m.nx, i % m.nx, dxs[1] * dxs[2]], [2, m.nx * m.ny, m.nz, Math.floor(i / (m.nx * m.ny)), dxs[0] * dxs[1]]] as const)
          for (const side of [-1, 1]) {
            if (c + side < 0 || c + side >= lim) continue;
            const k = i + side * stride; if (!m.data[k] || set.has(k)) continue;
            const v = side > 0 ? -faces.faces[ax][i] : faces.faces[ax][k];   // positive = into the layer
            inflow += v * area;
          }
        realised += inflow;
      }
      let sourceNet = 0, sourcePos = 0, sinkNeg = 0; if (extra) for (let a = 0; a < m.activeCount; a++) { const e = extra[m.active[a]] * cellV; sourceNet += e; if (e > 0) sourcePos += e; else sinkNeg += e; }
      const q = f.streamModel.state?.q ?? 0;
      surf.set(atMs, { sourcePos, sinkNeg, lateralRatio: planned > 0 ? realised / planned : NaN, sourceNet,  meanAbsDiv: all / cellsAll, topRowDiv: topSum / Math.max(1, topCells), belowDiv: belowSum / Math.max(1, cellsAll - topCells),
        qOverV: q / cellV, inward: inward / Math.max(1, inwardCells), riseMm: 1000 * rise / Math.max(1, topCells), maxSpeed });
    }
  }
  f.dispose(); vi.unstubAllGlobals();
  for (const k of ['__silverStream', '__silverBuoy', '__silverStreamCoupling']) delete g[k];
  return { surf, volumeErr, tracerErr, n: coupling ?? 0, label: coupling === undefined ? 'split (accepted)' : `coupled n=${coupling}`, extent, formedByY, level, dy, conserved, minSpecies,
    advanceMs, substeps, courant };
}


const total = (v: Float64Array) => v.reduce((a, b) => a + b, 0);
const centroidMm = (r: Result) => 1000 * r.formedByY.reduce((s, v, y) => s + v * (y + 0.5) * r.dy, 0) / total(r.formedByY);
const nearSurface = (r: Result, mm = 3) => r.formedByY.reduce((s, v, y) => s + ((y + 0.5) * r.dy > r.level - mm / 1000 ? v : 0), 0) / total(r.formedByY);
const l1 = (a: Result, b: Result) => { const na = total(a.formedByY), nb = total(b.formedByY); let d = 0;
  for (let y = 0; y < a.formedByY.length; y++) d += Math.abs(a.formedByY[y] / na - b.formedByY[y] / nb); return d / 2; };

describe('Priority 3: free-surface consistency of the stream (coupled n = 8, identical flow, 1 mL + 1 mL)', () => {
  it('quantifies the surface-cell inconsistency and the effect of the isolated surface-rise correction', async () => {
    const plain = await run(8, true), rise = await run(8, { surfaceRise: true });
    const lines = ['FREE-SURFACE STUDY (stream, coupled n=8). Residual divergence in 1/s; Q/V = stream volume flux over one cell volume'];
    for (const [label, r] of [['as built (no correction)', plain], ['surface-rise correction', rise]] as const) {
      lines.push(`${label}:`);
      for (const t of [850, 1000, 1150]) { const s = r.surf.get(t)!;
        lines.push(`  t=${t} ms: mean|div| all ${s.meanAbsDiv.toFixed(2)}  top two rows ${s.topRowDiv.toFixed(2)}  below ${s.belowDiv.toFixed(2)}  (Q/V ${s.qOverV.toFixed(0)})  lateral inflow realised/planned ${s.lateralRatio.toFixed(2)}  net surface source ${s.sourceNet.toExponential(1)} m3/s  inward surface speed near the stream ${(1000 * s.inward).toFixed(2)} mm/s  mean vertical speed of the top two rows ${s.riseMm.toFixed(2)} mm/s  max |u| ${s.maxSpeed.toFixed(3)} m/s`); }
      lines.push(`  extent @1.0/1.35/2.5/4.0 s: ${SNAPS.map(t => r.extent.get(t)!.toFixed(4)).join(' / ')}  centroid ${centroidMm(r).toFixed(2)} mm  near-surface(3 mm) ${(100 * nearSurface(r)).toFixed(1)}%  conservation ${r.conserved.toExponential(1)}  min ${r.minSpecies.toExponential(1)}`);
    }
    for (const [label, r] of [['as built (no correction)', plain], ['surface-rise correction', rise]] as const) {
      const all = [...r.surf.values()], ratios = all.map(v => v.lateralRatio).filter(Number.isFinite);
      lines.push(`ALL POURING STEPS (${all.length}) ${label}: realised/planned lateral entrainment min ${Math.min(...ratios).toFixed(2)} mean ${(ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(2)} max ${Math.max(...ratios).toFixed(2)};`
        + ` inward surface speed near the stream max ${(1000 * Math.max(...all.map(v => v.inward))).toFixed(1)} mm/s; top-two-row mean |div| max ${Math.max(...all.map(v => v.topRowDiv)).toFixed(1)} 1/s;`
        + ` surface source sum / sink sum relative to Q: ${all.length && all[0].qOverV ? '' : ''}${Math.max(...all.map(v => Math.abs(v.sourcePos + v.sinkNeg))).toExponential(1)} m3/s net;`
        + ` liquid volume vs ledger max error ${r.volumeErr.toExponential(1)} mL; tracer vs delivered max error ${r.tracerErr.toExponential(1)}; Ag+/Cl- ledger error ${r.conserved.toExponential(1)}`);
    }
    const d = (t: number) => (100 * (rise.extent.get(t)! - plain.extent.get(t)!) / plain.extent.get(t)!).toFixed(2);
    lines.push(`Effect of the correction: extent @1.35 ${d(1350)}%, @2.5 ${d(2500)}%; centroid ${(centroidMm(rise) - centroidMm(plain)).toFixed(2)} mm (cell ${(plain.dy * 1000).toFixed(2)}); near-surface ${(100 * (nearSurface(rise) - nearSurface(plain))).toFixed(1)} pp; L1 of the formation profile ${l1(rise, plain).toFixed(3)}`);
    console.log(lines.join('\n'));
    for (const t of [850, 1000, 1150]) expect(Math.abs(rise.surf.get(t)!.sourceNet)).toBeLessThan(1e-6 * (rise.surf.get(t)!.qOverV * 0 + 1.5e-6));   // no liquid is created by the correction (float32 roundoff)
    for (const r of [plain, rise]) { expect(r.volumeErr).toBeLessThan(1e-9); expect(r.tracerErr).toBeLessThan(1e-9); }
    const riseRatios = [...rise.surf.values()].map(v => v.lateralRatio).filter(Number.isFinite);
    // No duplicate entrainment: the grid never carries more lateral inflow into the jet layers than the integral model prescribes.
    // (It can carry less where the glass leaves no free neighbour cell; the minimum is reported above.)
    for (const q of riseRatios) expect(q).toBeLessThan(1.1);
    for (const r of [plain, rise]) { expect(r.conserved).toBeLessThan(1e-9); expect(r.minSpecies).toBeGreaterThanOrEqual(-1e-12); }
  }, 900000);
});
