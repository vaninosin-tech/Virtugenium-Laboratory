import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// Long CPU run of the accepted baseline (no stream, no buoyancy flags): checkpoints with a mass ledger per material state,
// vertical distribution, cloud motion split into carried-by-fluid and gravitational slip, and deposit flux.
// Env: AGG=0|1 (default 0, the accepted baseline), START=mL of AgNO3 before the pour (1 reference, 2.5 visual), END=seconds,
// BUOY=1 for the experimental composition buoyancy.
const POUR_MS = 1700, BANDS = 6;
const CHECK = (process.env.CHECK ?? '10,30,60,120,180').split(',').map(Number);
const END = Number(process.env.END ?? Math.max(...CHECK));
type Mass = { formed: number; fine: number; sections: number; flocs: number; deposited: number; error: number };

async function run() {
  const agg = process.env.AGG === '1' ? 1 : 0, start = Number(process.env.START ?? 1);
  vi.stubGlobal('window', { location: { search: '' }, __silverAgg: agg });
  (globalThis as Record<string, unknown>).__silverBuoyancy = process.env.BUOY ? { mode: 'composition' } : undefined;
  (globalThis as Record<string, unknown>).__silverDeposit = process.env.DEPOSIT ? true : undefined;
  (globalThis as Record<string, unknown>).__silverViscosity = process.env.NU ? Number(process.env.NU) : undefined;
  (globalThis as Record<string, unknown>).__silverDensity = process.env.DENS ? { model: process.env.DENS } : undefined;
  (globalThis as Record<string, unknown>).__silverFineWeight = process.env.FINE ? { mode: process.env.FINE === 'net' ? 'net' : 'solid' } : undefined;
  const { TubeSilverField } = await import('../../../src/scenes/laboratory/lib/tubeSilverField');
  const { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } = await import('../../../src/scenes/laboratory/lib/tubeSilverGeometry');
  const { tubeLiquidHeight } = await import('../../../src/scenes/laboratory/lib/tubeLiquidLevel');
  const { pouredMl } = await import('../../../src/scenes/laboratory/lib/tubePourImpact');
  const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight, start);   // start mL of 0.1 mol/L AgNO3 = start units of 0.1 mmol Ag+
  const p = f as unknown as { flow: Float32Array; sections?: { masses: Float64Array[]; slip: number[] | Float64Array; radii: number[] | Float64Array; totalMass: number };
    flocSystem?: { nodes: { y: number; mass: number; vy: number; uy: number }[]; totalMass: number } };
  const m = f.mask, dy = m.height / m.ny, up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0.0065, 0, 0);
  let previousMl = 0, delivered = 0, mlTotal = start, level = tubeLiquidHeight(mlTotal, silverEffectiveRadius), prevDeposited = 0, lastT = 0;
  const log: string[] = [`config: agg=${agg} AgNO3 ${start} mL 0.1 M (${(start * 0.1).toFixed(2)} mmol Ag+) + NaCl 1 mL 0.1 M (0.10 mmol) | composition buoyancy=${process.env.BUOY ? 'on' : 'off'} fine weight=${process.env.FINE ?? 'off'} density model=${process.env.DENS ?? 'off (tuned baseline loads)'} stream=off`];
  const stepMs: number[] = [];
  let maxErr = 0;
  const steps = Math.round(END / 0.05);
  for (let n = 0; n <= steps; n++) {
    const atMs = n * 50, t = n * 0.05;
    const total = pouredMl(Math.min(1, atMs / POUR_MS)), ml = total - previousMl;
    let rate = 0;
    if (ml > 1e-12) { previousMl = total; delivered += ml; mlTotal += ml; rate = ml * 20; }
    level = tubeLiquidHeight(mlTotal, silverEffectiveRadius);
    if (delivered <= 0) continue;
    m.update(up, level);
    let top = -Infinity;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
      const q = m.point(x, y, z);
      if (Math.hypot(q.x - inlet.x, q.z - inlet.z) <= 0.003 && q.y > top) top = q.y;
    }
    inlet.y = top;
    const t0 = performance.now();
    f.advance(0.05, up, level, inlet, Math.min(1, delivered), 0, rate, undefined);
    stepMs.push(performance.now() - t0);
    if (process.env.NOCOLLIDE) (p.sections as unknown as { collide: () => void }).collide = () => undefined;   // diagnostic only: sections receive mass and move, never collide
    if (process.env.KSEC) {   // diagnostic only: conservative explicit diffusion of the section masses (subgrid mixing like the fine suspension has)
      const kappa = Number(process.env.KSEC), h = [2 * m.radius / m.nx, m.height / m.ny, 2 * m.radius / m.nz], strides = [1, m.nx, m.nx * m.ny], sub = Math.max(1, Math.ceil(kappa * 0.05 / (Math.min(...h) ** 2) * 8));
      for (const bin of p.sections!.masses) for (let q = 0; q < sub; q++) {
        const next = bin.slice();
        for (let a = 0; a < m.activeCount; a++) { const i = m.active[a], c = [i % m.nx, Math.floor(i / m.nx) % m.ny, Math.floor(i / (m.nx * m.ny))];
          for (let ax = 0; ax < 3; ax++) { const lim = [m.nx, m.ny, m.nz][ax]; if (c[ax] + 1 >= lim) continue; const j = i + strides[ax]; if (!m.data[j]) continue;
            const flow = kappa * (0.05 / sub) / (h[ax] * h[ax]) * (bin[i] - bin[j]); next[i] -= flow; next[j] += flow; } }
        bin.set(next);
      }
    }
    if (process.env.NOSHEAR) (p.sections as unknown as { shear: Float64Array }).shear.fill(0);   // diagnostic only: Brownian aggregation, no shear kernel
    maxErr = Math.max(maxErr, Math.abs(f.massBalanceError));
    if (!CHECK.some(c => Math.abs(c - t) < 1e-9)) continue;
    // Ledger.
    const mass: Mass = { formed: f.extent, fine: f.suspensionMass, sections: p.sections?.totalMass ?? 0, flocs: p.flocSystem?.totalMass ?? 0,
      deposited: f.sedimentMass, error: f.massBalanceError };
    // Per-band suspended mass (fine + sections + flocs), mass-weighted vertical velocities.
    const band = (y: number) => Math.min(BANDS - 1, Math.max(0, Math.floor(y / (level / BANDS))));
    const suspended = new Float64Array(BANDS), fineBand = new Float64Array(BANDS), densityBand = new Float64Array(BANDS), cells = new Float64Array(BANDS);
    let cw = 0, ww = 0, wFluid = 0, wSlip = 0, maxW = 0, sumAbsW = 0;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], y = (Math.floor(i / m.nx) % m.ny + 0.5) * dy;
      let s = f.suspension[0][i] + f.suspension[1][i] + f.suspension[2][i];
      const fineHere = s; let slipHere = 0;
      if (p.sections) for (let b = 0; b < p.sections.masses.length; b++) { const q = p.sections.masses[b][i]; s += q; slipHere += q * (p.sections.slip[b] as number); }
      const w = p.flow[3 * i + 1];
      suspended[band(y)] += s; fineBand[band(y)] += fineHere; cells[band(y)]++; densityBand[band(y)] += f.compositionDensity(i).total;
      cw += s * y; ww += s; wFluid += s * w; wSlip += slipHere; maxW = Math.max(maxW, Math.abs(w)); sumAbsW += Math.abs(w);
    }
    if (p.flocSystem) for (const nd of p.flocSystem.nodes) {
      suspended[band(nd.y)] += nd.mass; cw += nd.mass * nd.y; ww += nd.mass; wFluid += nd.mass * nd.uy; wSlip += nd.mass * (nd.vy - nd.uy);
    }
    const binMass = p.sections ? p.sections.masses.map(b => { let q = 0; for (let a = 0; a < m.activeCount; a++) q += b[m.active[a]]; return q; }) : [];
    const sed = (f as unknown as { sedimentField: { equivalentFillHeight: number; porosity: number; compaction: number } }).sedimentField;
    const priv2 = f as unknown as { flocMass: Float32Array; tracer: Float64Array; species: Record<string, { values: Float64Array }>; loadStrength: number; liquidVolumeM3: number };
    const accBand = [0, 0, 0].map(() => new Float64Array(BANDS)), accCells = new Float64Array(BANDS);
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], b = band((Math.floor(i / m.nx) % m.ny + 0.5) * dy);
      const fineC = (f.suspension[0][i] + f.suspension[1][i] + f.suspension[2][i]) * m.activeCount * 1e-4 / priv2.liquidVolumeM3;
      const nano = (priv2.tracer[i] - priv2.species['Cl-'].values[i]) * m.activeCount * 1e-4 / priv2.liquidVolumeM3;
      accBand[0][b] += priv2.loadStrength * (priv2.flocMass.length ? priv2.flocMass[i] : 0);          // aggregate load
      accBand[1][b] += -0.1 * priv2.loadStrength * priv2.tracer[i] * m.activeCount;                   // incoming-solution buoyancy
      accBand[2][b] += 9.81 * (fineC * 0.1173 - (process.env.FINE === 'net' ? nano * 0.1267 : 0)) / 1008;  // fine weight if it were applied
      accCells[b]++;
    }
    log.push(`   body acceleration by band, top->bottom, mm/s2 (aggregate load | tracer buoyancy | fine weight ${process.env.FINE ? 'APPLIED' : 'not applied, shown for scale'}): `
      + [0, 1, 2].map(k => Array.from(accBand[k]).reverse().map((v, j) => (v / Math.max(1, Array.from(accCells).reverse()[j]) * 1000).toFixed(2)).join(' ')).join(' | '));
    if (process.env.DEPOSIT) {
      const bedField = (f as unknown as { sedimentField: { bedAttached: boolean; thicknessM(c: number): number; values: Float64Array; porosity: number; bedCreptKg: number } }).sedimentField;
      const th: number[] = []; for (let c = 0; c < bedField.values.length; c++) if (bedField.values[c] > 0) th.push(bedField.thicknessM(c));
      const mean = th.reduce((a, b) => a + b, 0) / Math.max(1, th.length), sd = Math.sqrt(th.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, th.length));
      log.push(`   bed: columns with mass ${th.length}, thickness mean ${(mean * 1000).toFixed(3)} mm max ${(Math.max(0, ...th) * 1000).toFixed(3)} mm, relative spread ${(sd / Math.max(1e-12, mean)).toFixed(2)}, mean porosity ${bedField.porosity.toFixed(3)}, crept ${(bedField.bedCreptKg * 1e6).toFixed(3)} mg`);
      if (t === CHECK.at(-1)) {
        const rows: string[] = [];
        for (let z = 0; z < m.nz; z++) { let r = ''; for (let x = 0; x < m.nx; x++) { const v = bedField.thicknessM(z * m.nx + x) * 1000; r += v <= 0 ? '  .  ' : v.toFixed(2).padStart(5); } rows.push(r); }
        log.push('   bed thickness map (mm, looking down, x right, z down):\n' + rows.map(r => '     ' + r).join('\n'));
      }
    }
    if (process.env.NDT) {   // explicit-coupling stability: N dt with N^2 = (g / rho0) (drho/dz) over vertical neighbour pairs, capped densities as in the load
      let worst = 0, at = '', mean = 0, cnt = 0;
      for (let a = 0; a < m.activeCount; a++) { const i = m.active[a], j = i + m.nx; if (Math.floor(i / m.nx) % m.ny + 1 >= m.ny || !m.data[j]) continue;
        const grad = (f.compositionDensity(i, 1e-4, 100).total - f.compositionDensity(j, 1e-4, 100).total) / (m.height / m.ny);   // heavier below: positive = stable
        if (grad > 0) { const nDt = Math.sqrt(9.81 / 1010 * grad) * 0.05; mean += nDt; cnt++; if (nDt > worst) { worst = nDt; at = `(${i % m.nx},${Math.floor(i / m.nx) % m.ny},${Math.floor(i / (m.nx * m.ny))})`; } } }
      log.push(`   NDT t=${t}s worst N*dt ${worst.toFixed(2)} at ${at}, mean over stable pairs ${(mean / Math.max(1, cnt)).toFixed(2)} (explicit coupling needs N dt well below 2) | max|w| ${(maxW * 1000).toFixed(1)} mm/s`);
    }
    if (process.env.GROWTH) {
      const rowRough = (get: (i: number) => number) => { const out: number[] = [];
        for (let y = 2; y <= 14; y++) { const vals = new Map<number, number>(); for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; if (Math.floor(i / m.nx) % m.ny === y) vals.set(i, get(i)); }
          const arr = [...vals.values()], mean = arr.reduce((x, z) => x + z, 0) / Math.max(1, arr.length), sd = Math.sqrt(arr.reduce((x, z) => x + (z - mean) ** 2, 0) / Math.max(1, arr.length));
          if (sd < 1e-12 * Math.max(1, Math.abs(mean))) continue; let dev = 0, n = 0;
          for (const [i, v] of vals) { const nb = [i - 1, i + 1, i - m.nx * m.ny, i + m.nx * m.ny].map(j => vals.get(j)).filter((q): q is number => q !== undefined); if (nb.length === 4) { dev += Math.abs(v - nb.reduce((x, z) => x + z, 0) / 4); n++; } }
          if (n) out.push(dev / n / sd); }
        return out.length ? (out.reduce((x, z) => x + z, 0) / out.length).toFixed(2) : 'n/a'; };
      const sec = p.sections!;
      log.push(`   GROWTH t=${t}s roughness fine ${rowRough(i => f.suspension[0][i])} sections ${rowRough(i => sec.masses.reduce((x, b) => x + b[i], 0))} density ${rowRough(i => f.compositionDensity(i).total)} max|w| ${(maxW * 1000).toFixed(1)} mm/s`);
    }
    if (process.env.PROBE) {
      let mi = -1, mw = 0; for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; if (Math.abs(p.flow[3 * i + 1]) > mw) { mw = Math.abs(p.flow[3 * i + 1]); mi = i; } }
      const mx = mi % m.nx, my = Math.floor(mi / m.nx) % m.ny, mz = Math.floor(mi / (m.nx * m.ny));
      const rowStats = (y: number) => { const v: number[] = []; for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; if (Math.floor(i / m.nx) % m.ny === y) v.push(f.compositionDensity(i).total); }
        const mean = v.reduce((x, z) => x + z, 0) / Math.max(1, v.length); return `${mean.toFixed(1)}+-${Math.sqrt(v.reduce((x, z) => x + (z - mean) ** 2, 0) / Math.max(1, v.length)).toFixed(1)}(${v.length})`; };
      const near = (y: number) => rowStats(Math.max(0, Math.min(m.ny - 1, y)));
      log.push(`   PROBE max|w| ${(mw * 1000).toFixed(1)} mm/s at cell (${mx},${my},${mz}) of (${m.nx},${m.ny},${m.nz}); density rows y-1..y+1 (mean+-sd kg/m3 (cells)): ${near(my - 1)} ${near(my)} ${near(my + 1)}; flocMass at cell ${(f as unknown as { flocMass: Float32Array }).flocMass[mi].toFixed(2)}, fine ${(f.suspension[0][mi] * m.activeCount).toFixed(2)}`);
      { // grid-scale content of the density in the row of the fastest cell: deviation from the mean of the 4 horizontal neighbours over the row's sd
        const rowVals = new Map<number, number>(); for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; if (Math.floor(i / m.nx) % m.ny === my) rowVals.set(i, f.compositionDensity(i).total); }
        const vals = [...rowVals.values()], mean = vals.reduce((x, z) => x + z, 0) / vals.length, sd = Math.sqrt(vals.reduce((x, z) => x + (z - mean) ** 2, 0) / vals.length);
        let dev = 0, n = 0; for (const [i, v] of rowVals) { const nb = [i - 1, i + 1, i - m.nx * m.ny, i + m.nx * m.ny].map(j => rowVals.get(j)).filter((q): q is number => q !== undefined);
          if (nb.length === 4) { dev += Math.abs(v - nb.reduce((x, z) => x + z, 0) / 4); n++; } }
        log.push(`   PROBE roughness (mean |rho - mean of 4 neighbours| / sd, ~0.1 smooth, ~0.8 checkerboard): ${(dev / Math.max(1, n) / Math.max(1e-9, sd)).toFixed(2)} over ${n} cells, sd ${sd.toFixed(2)} kg/m3`);
      }
      { // roughness of the aggregate (floc) mass field itself, rows at and around the fastest cell
        const fm = (f as unknown as { flocMass: Float32Array }).flocMass, rows = [my - 1, my, my + 1].filter(y => y >= 0 && y < m.ny);
        const rough = rows.map(y => { const vals = new Map<number, number>(); for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; if (Math.floor(i / m.nx) % m.ny === y) vals.set(i, fm[i]); }
          const arr = [...vals.values()], mean = arr.reduce((x, z) => x + z, 0) / arr.length, sd = Math.sqrt(arr.reduce((x, z) => x + (z - mean) ** 2, 0) / arr.length); let dev = 0, n = 0;
          for (const [i, v] of vals) { const nb = [i - 1, i + 1, i - m.nx * m.ny, i + m.nx * m.ny].map(j => vals.get(j)).filter((q): q is number => q !== undefined); if (nb.length === 4) { dev += Math.abs(v - nb.reduce((x, z) => x + z, 0) / 4); n++; } }
          return `${(dev / Math.max(1, n) / Math.max(1e-9, sd)).toFixed(2)}(mean ${mean.toFixed(2)} sd ${sd.toFixed(2)})`; });
        log.push(`   PROBE floc mass roughness rows y-1,y,y+1: ${rough.join(' ')}`);
      }
      const w2: string[] = []; for (let y = 0; y < m.ny; y += 3) { let s2 = 0, c = 0; for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; if (Math.floor(i / m.nx) % m.ny === y) { s2 += p.flow[3 * i + 1]; c++; } } w2.push((s2 / Math.max(1, c) * 1000).toFixed(2)); }
      log.push(`   row-mean w by height (mm/s, rows 0,3,6..): ${w2.join(' ')}`);
    }
    const dep = (mass.deposited - prevDeposited) / Math.max(1e-9, t - lastT); prevDeposited = mass.deposited; lastT = t;
    const fmt = (v: number, d = 3) => v.toFixed(d);
    log.push(`t=${t}s level=${fmt(level * 1000, 1)}mm | formed ${fmt(mass.formed)} fine ${fmt(mass.fine)} sections ${fmt(mass.sections, 4)} flocs ${fmt(mass.flocs, 4)} deposited ${fmt(mass.deposited, 5)} | ledger error ${mass.error.toExponential(1)}`);
    log.push(`   section mass by radius bin (0.32um..1.76mm): ${binMass.map(v => v.toFixed(3)).join(' ')}`);
    log.push(`   sediment: equivalent bowl fill ${(sed.equivalentFillHeight * 1000).toFixed(3)} mm, porosity ${sed.porosity.toFixed(3)}, compaction ${sed.compaction.toFixed(3)}`);
    log.push(`   suspended by band (top->bottom, share of suspended): ${Array.from(suspended).reverse().map(v => fmt(ww > 0 ? v / ww : 0, 2)).join(' ')}`);
    log.push(`   fine-only share: ${Array.from(fineBand).reverse().map(v => fmt(mass.fine > 0 ? v / mass.fine : 0, 2)).join(' ')} | density excess mean kg/m3: ${Array.from(densityBand).reverse().map((v, k) => fmt(v / Math.max(1, Array.from(cells).reverse()[k]), 1)).join(' ')}`);
    log.push(`   centroid ${fmt(ww > 0 ? cw / ww * 1000 : 0, 2)}mm of ${fmt(level * 1000, 1)}mm | mass-weighted vertical velocity: fluid ${fmt(ww > 0 ? wFluid / ww * 1000 : 0, 4)} mm/s, gravitational slip ${fmt(ww > 0 ? wSlip / ww * 1000 : 0, 5)} mm/s | max|w| ${fmt(maxW * 1000, 3)} mm/s mean|w| ${fmt(sumAbsW / m.activeCount * 1000, 4)} mm/s | deposit flux ${dep.toExponential(2)} units/s`);
  }
  { const sorted = [...stepMs].sort((a, b) => a - b); log.push(`CPU (node, one core): mean ${(stepMs.reduce((a, b) => a + b, 0) / stepMs.length).toFixed(2)} ms/step, p99 ${sorted[Math.floor(sorted.length * 0.99)].toFixed(2)} ms, max ${sorted.at(-1)!.toFixed(2)} ms over ${stepMs.length} steps`); }
  if (p.sections) log.push(`sections: radii(um) ${Array.from(p.sections.radii).map(r => (r * 1e6).toFixed(2)).join(' ')} | slip(um/s) ${Array.from(p.sections.slip).map(s => (s * 1e6).toExponential(1)).join(' ')}`);
  else log.push('sections: not created');
  expect(maxErr).toBeLessThan(1e-12);
  console.log(log.join('\n'));
  delete (globalThis as Record<string, unknown>).__silverBuoyancy;
}
describe('long run checkpoints', () => { it('runs', async () => { await run(); }, 3600000); });
