import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MesoCloud, type MesoMixing } from '../../../src/scenes/laboratory/lib/night/meso/mesoCloud';
import { analyseCloud, diffTopology, type TopologyEvent, type ThresholdReport } from '../../../src/scenes/laboratory/lib/night/meso/cloudTopology';

// Shadow run of the mesoscopic cloud on the REAL solver faces of the stage-3 field: the field is not changed, the MesoCloud only
// receives the AgCl formed per step (productSource) and is advected by the same faces on a 3x finer grid. Prints structure metrics
// of the coarse fine-suspension field against the refined one and writes mid-plane slices when SHADOW_OUT is set.
// Env: CONFIG=A|B (B = net density on), END seconds, SHADOW_OUT directory, REFINE (2 or 3), MIX=none|eddy (default eddy), ETA multiplier of the
// default (1/refine)^(4/3) eddy scaling, KAPPA molecular-scale diffusivity (m2/s), TOPO=1 for connectivity tracking, MARKS.
const CONFIG = process.env.CONFIG ?? 'A', END = Number(process.env.END ?? 10), KAPPA = Number(process.env.KAPPA ?? 1e-9);
const REFINE = Number(process.env.REFINE ?? 2), MIX = process.env.MIX ?? 'eddy', ETA = Number(process.env.ETA ?? 1), TOPO = !!process.env.TOPO;
const MARKS = (process.env.MARKS ?? '5,10').split(',').map(Number);

function crc32(buf: Buffer) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function png(width: number, height: number, rgb: Uint8Array) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1); }
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type), len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

describe('mesoscopic cloud shadow run', () => {
  it('follows the real flow, conserves the AgCl it receives and reports structure metrics', async () => {
    vi.stubGlobal('window', { location: { search: '' }, __silverAgg: 0 });
    (globalThis as Record<string, unknown>).__silverDensity = CONFIG === 'B' ? { model: 'net' } : undefined;
    const { TubeSilverField } = await import('../../../src/scenes/laboratory/lib/tubeSilverField');
    const { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } = await import('../../../src/scenes/laboratory/lib/tubeSilverGeometry');
    const { tubeLiquidHeight } = await import('../../../src/scenes/laboratory/lib/tubeLiquidLevel');
    const { pouredMl } = await import('../../../src/scenes/laboratory/lib/tubePourImpact');
    const f = new TubeSilverField((process.env.QUALITY ?? 'LOW') as 'LOW' | 'HIGH', SILVER_TUBE_RADIUS, 0, silverFieldHeight, 2.5);
    const m = f.mask, up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0.0065, 0, 0), r = REFINE;
    const spacing: [number, number, number] = [2 * m.radius / m.nx, m.height / m.ny, 2 * m.radius / m.nz];
    const meso = new MesoCloud(m, r), coarseView = new MesoCloud(m, 1);
    const priv = f as unknown as { productSource: Float64Array; solver: { faces: Float32Array[]; eddyDiffusivities: Float32Array; lastStrain: Float32Array }; flow: Float32Array };
    const out = process.env.SHADOW_OUT; if (out) mkdirSync(out, { recursive: true });
    let previous = 0, delivered = 0, ml = 2.5, formed = 0, msTotal = 0, msMax = 0, steps = 0;
    const lines: string[] = [`config ${CONFIG}: net density ${CONFIG === 'B' ? 'on' : 'off'}, aggregation off, MesoCloud refine ${r} (${meso.cellCount} cells vs ${m.data.length}), mixing ${MIX} (base ${KAPPA} m2/s, eta x${ETA}), active region on`];
    const fieldMs: number[] = [], mesoMs: number[] = [], parts = { interp: 0, advect: 0, diffuse: 0 }; let activeSum = 0, transportSum = 0, mixingSum = 0;
    const threshold = [0.5, 1, 2, 4], opts = { densityScale: r ** 3 * m.activeCount, cellSize: spacing[0] / r, cellVolume: (spacing[0] / r) * (spacing[1] / r) * (spacing[2] / r) };
    let strainBudget = 0, strainMean = 0, strainMax = 0; let prevTopo: ThresholdReport[] | null = null; const events: TopologyEvent[] = []; let lastTopoT = -1;
    for (let n = 0; n <= END * 20; n++) {
      const t = n * 0.05, total = pouredMl(Math.min(1, n * 50 / 1700)), d = total - previous; let rate = 0;
      if (d > 1e-12) { previous = total; delivered += d; ml += d; rate = d * 20; }
      const level = tubeLiquidHeight(ml, silverEffectiveRadius);
      if (delivered <= 0) continue;
      m.update(up, level);
      let top = -Infinity;
      for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; const p = m.point(i % m.nx, Math.floor(i / m.nx) % m.ny, Math.floor(i / (m.nx * m.ny)));
        if (Math.hypot(p.x - inlet.x, p.z - inlet.z) <= 0.003 && p.y > top) top = p.y; }
      inlet.y = top;
      const tf = performance.now();
      f.advance(0.05, up, level, inlet, Math.min(1, delivered), 0, rate, undefined);
      fieldMs.push(performance.now() - tf);
      const t0 = performance.now();
      meso.syncMask(); meso.addFromCoarse(priv.productSource); formed += priv.productSource.reduce((a, b) => a + b, 0);
      const mixing: number | MesoMixing = MIX === 'none' ? 0 : { base: KAPPA, coarseEddy: priv.solver.eddyDiffusivities, eddyScale: 0.02, eta: ETA * Math.pow(1 / r, 4 / 3) };
      const st = meso.advect(priv.solver.faces, 0.05, spacing, mixing);
      const ms = performance.now() - t0; msTotal += ms; msMax = Math.max(msMax, ms); steps++; mesoMs.push(ms);
      { // mass-weighted resolved strain rate of the flow acting on the cloud and its time integral (the stretching available to thin a neck)
        let w = 0, sw = 0, mx = 0; const dxs = [spacing[0], spacing[1], spacing[2]], strides = [1, m.nx, m.nx * m.ny], g9 = new Float64Array(9);
        for (let a = 0; a < m.activeCount; a++) {
          const i = m.active[a], mass = f.suspension[0][i], coords = [i % m.nx, Math.floor(i / m.nx) % m.ny, Math.floor(i / (m.nx * m.ny))], lim = [m.nx, m.ny, m.nz];
          g9.fill(0);
          for (let axis = 0; axis < 3; axis++) {
            const l = coords[axis] > 0 && m.data[i - strides[axis]] ? i - strides[axis] : -1, rr = coords[axis] + 1 < lim[axis] && m.data[i + strides[axis]] ? i + strides[axis] : -1;
            if (l < 0 && rr < 0) continue; const hh = dxs[axis] * (l >= 0 && rr >= 0 ? 2 : 1);
            for (let c = 0; c < 3; c++) g9[c * 3 + axis] = (priv.flow[3 * (rr >= 0 ? rr : i) + c] - priv.flow[3 * (l >= 0 ? l : i) + c]) / hh;
          }
          let s2 = 0; for (let p1 = 0; p1 < 3; p1++) for (let q1 = 0; q1 < 3; q1++) { const sij = 0.5 * (g9[p1 * 3 + q1] + g9[q1 * 3 + p1]); s2 += sij * sij; }
          const g = Math.sqrt(2 * s2); w += mass; sw += mass * g; mx = Math.max(mx, g);
        }
        strainMean = w > 0 ? sw / w : 0; strainMax = mx; strainBudget += strainMean * 0.05; }
      parts.interp += st.interpolateMs; parts.advect += st.advectMs; parts.diffuse += st.diffuseMs; activeSum += st.activeBlocks; transportSum += st.transportChange; mixingSum += st.mixingChange;
      if (TOPO && (lastTopoT < 0 ? t >= 1 : t - lastTopoT >= 0.5 - 1e-9)) {
        const cur = analyseCloud(meso, threshold, opts), L = Math.sqrt(2 * (KAPPA + 3e-5 * 0.02 * Math.pow(1 / r, 4 / 3) * 0.5) * (lastTopoT < 0 ? 0.5 : t - lastTopoT));
        if (prevTopo) for (let q = 0; q < threshold.length; q++) events.push(...diffTopology(t, threshold[q], prevTopo[q], cur[q], L, 0.1, 0.02 * meso.mass));
        lines.push(`t=${t}s regions with >= 2% of the mass @${threshold.join('/')}: ${cur.map(c => c.regions.filter(x => x.mass >= 0.02 * meso.mass).length).join('/')} (all ${cur.map(c => c.count).join('/')}) | mass of the largest ${cur.map(c => c.regions.length ? Math.max(...c.regions.map(x => x.mass)).toFixed(3) : '0').join('/')} | necks (mm) ${cur.map(c => { const n = c.regions.map(x => x.neckWidth).filter((v): v is number => v !== null); return n.length ? (Math.min(...n) * 1000).toFixed(2) : '-'; }).join('/')} | transport ${transportSum.toExponential(2)} mixing ${mixingSum.toExponential(2)} (cumulative L1)`);
        prevTopo = cur; lastTopoT = t;
      }
      if (!MARKS.includes(t)) continue;
      // Coarse view of the field's own fine suspension for the same metrics.
      coarseView.syncMask(); coarseView.values.fill(0);
      for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; coarseView.values[i] = f.suspension[0][i] + f.suspension[1][i] + f.suspension[2][i]; }
      const restricted = meso.restrictTo(new Float64Array(m.data.length));
      let coarseMass = 0, restrictedMass = 0, l1 = 0;
      for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; coarseMass += coarseView.values[i]; restrictedMass += restricted[i]; l1 += Math.abs(coarseView.values[i] - restricted[i]); }
      const stats = (cloud: MesoCloud, scale: number) => {
        let peak = 0, mean = 0, wet = 0; for (let i = 0; i < cloud.cellCount; i++) if (cloud.wet[i]) { wet++; mean += cloud.values[i]; peak = Math.max(peak, cloud.values[i]); }
        mean /= Math.max(1, wet); let gap = 0; for (let i = 0; i < cloud.cellCount; i++) if (cloud.wet[i] && cloud.values[i] < 0.05 * mean) gap++;
        const counts = [0.1, 0.25, 0.5].map(q => cloud.components(q).count);
        // Structure variance (sum of squares per mass) and grid-scale content: mean deviation from the 6-neighbour mean over cells above the wet mean.
        let sq = 0, tot = 0, dev = 0, nd = 0; const nxx = cloud.nx, nyy = cloud.ny, pl = nxx * nyy;
        for (let i = 0; i < cloud.cellCount; i++) { if (!cloud.wet[i]) continue; sq += cloud.values[i] ** 2; tot += cloud.values[i];
          if (cloud.values[i] > mean) { const x = i % nxx, y = Math.floor(i / nxx) % nyy, z = Math.floor(i / pl); const nb = [x > 0 ? i - 1 : -1, x + 1 < nxx ? i + 1 : -1, y > 0 ? i - nxx : -1, y + 1 < nyy ? i + nxx : -1, z > 0 ? i - pl : -1, z + 1 < cloud.nz ? i + pl : -1].filter(j => j >= 0 && cloud.wet[j]);
            if (nb.length === 6) { dev += Math.abs(cloud.values[i] - nb.reduce((a, j) => a + cloud.values[j], 0) / 6) / cloud.values[i]; nd++; } } }
        return { peak: peak * scale, mean: mean * scale, gap: gap / Math.max(1, wet), counts, structure: sq / Math.max(1e-30, tot) / Math.max(1e-30, mean), rough: dev / Math.max(1, nd) };
      };
      const sc = stats(coarseView, m.activeCount), sm = stats(meso, r ** 3 * m.activeCount);   // densities in mean-cell units (1 = the mean of a full conversion)
      lines.push(`t=${t}s mass: formed ${formed.toFixed(4)} meso ${meso.mass.toFixed(4)} field ${coarseMass.toFixed(4)} | restricted-vs-field L1 ${(l1 / Math.max(1e-12, coarseMass)).toFixed(3)}`
        + ` | peak density coarse ${sc.peak.toFixed(2)} meso ${sm.peak.toFixed(2)} | gap fraction coarse ${sc.gap.toFixed(3)} meso ${sm.gap.toFixed(3)} | components @10/25/50% of peak: coarse ${sc.counts.join('/')} meso ${sm.counts.join('/')} | structure (sum v2 / mass / mean) meso ${sm.structure.toFixed(2)} | grid-scale roughness meso ${sm.rough.toFixed(3)} coarse ${sc.rough.toFixed(3)} | resolved strain rate mass-weighted ${strainMean.toFixed(3)} 1/s (max ${strainMax.toFixed(2)}), integral so far ${strainBudget.toFixed(2)} (separating a neck needs the integral well above ln(L/delta), about 3 to 5)`);
      if (out) {
        // Mid-plane slices (z = centre), same colour scale, coarse upscaled to the refined size.
        const W = m.nx * r, H = m.ny * r, scale = 6, zc = Math.floor(m.nz / 2), zf = Math.floor(meso.nz / 2);
        const maxv = Math.max(sc.peak, sm.peak, 1e-9), img = new Uint8Array(2 * W * scale * H * scale * 3 + 0);
        const pw = 2 * W * scale + 6, ph = H * scale; const buf = new Uint8Array(pw * ph * 3).fill(24);
        const put = (ox: number, x: number, y: number, v: number, wet: boolean) => {
          const g = wet ? Math.round(255 * Math.pow(Math.min(1, v / maxv), 0.6)) : 0;
          for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
            const px = ox + x * scale + dx, py = (H - 1 - y) * scale + dy, o = (py * pw + px) * 3;
            buf[o] = wet ? g : 10; buf[o + 1] = wet ? g : 10; buf[o + 2] = wet ? Math.min(255, g + 20) : 30;
          }
        };
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const ci = (zc * m.ny + Math.floor(y / r)) * m.nx + Math.floor(x / r), fi = (zf * meso.ny + y) * meso.nx + x;
          put(0, x, y, coarseView.values[ci] * m.activeCount, !!m.data[ci]); put(W * scale + 6, x, y, meso.values[fi] * r ** 3 * m.activeCount, !!meso.wet[fi]);
        }
        void img; writeFileSync(`${out}/config${CONFIG}_x${r}_t${String(t).padStart(3, '0')}.png`, png(pw, ph, buf));
      }
    }
    const pct = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * q)] ?? 0;
    lines.push(`MesoCloud x${r} cost (node, one core): mean ${(msTotal / steps).toFixed(2)} ms/step, p99 ${pct(mesoMs, 0.99).toFixed(1)}, max ${msMax.toFixed(1)} ms over ${steps} steps | parts mean: interpolate ${(parts.interp / steps).toFixed(2)}, advect ${(parts.advect / steps).toFixed(2)}, mixing ${(parts.diffuse / steps).toFixed(2)} ms | active blocks mean ${(activeSum / steps).toFixed(0)} of ${m.data.length} | field step (flow, density, reaction${CONFIG === 'B' ? ', net density' : ''}) mean ${(fieldMs.reduce((a, b) => a + b, 0) / fieldMs.length).toFixed(2)} p99 ${pct(fieldMs, 0.99).toFixed(1)} max ${Math.max(...fieldMs).toFixed(1)} ms`);
    const confirmed = events.filter(e => e.type === 'split' || e.type === 'merge');
    if (TOPO) lines.push(`topology events (split/merge/birth/death) by threshold: ${threshold.map(q => ['split', 'merge', 'birth', 'death'].map(ty => events.filter(e => e.threshold === q && e.type === ty).length).join('/')).join(' | ')}`
      + (confirmed.length ? ' | first splits: ' + events.filter(e => e.type === 'split').slice(0, 4).map(e => `t=${e.t}s thr ${e.threshold} parent ${e.parentMass.toFixed(3)} -> ${e.childMass.map(x => x.toFixed(3)).join('+')} neck before ${e.neckBefore === null ? 'n/a' : (e.neckBefore * 1000).toFixed(2) + ' mm'} (diffusion length ${(e.diffusionLength * 1000).toFixed(2)} mm)`).join('; ') : ''));
    console.log(lines.join('\n'));
    // The refined cloud holds exactly the AgCl it was given, and it equals the field's own mass up to the field's fine-suspension sinks/sources.
    expect(Math.abs(meso.mass - formed)).toBeLessThan(1e-9 * Math.max(1, formed));
    delete (globalThis as Record<string, unknown>).__silverDensity; vi.unstubAllGlobals();
  }, 1800000);
});
