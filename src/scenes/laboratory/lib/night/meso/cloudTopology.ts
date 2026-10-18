/**
 * Connectivity of a MesoCloud at physical concentration thresholds (diagnostics only, nothing here changes mass).
 *
 * Cloud connectivity is a property of the transported suspended-material concentration: a region is a 6-connected set of wet cells
 * whose density is above a threshold; it is not an object and owns no mass. For every region the analysis reports mass, volume, the
 * thinnest neck between its two heaviest lobes, and across snapshots it tracks splits and merges by cell overlap. A split counts as a
 * separation only when it persists (the children are still apart in the next snapshot) and the report says whether the neck was wider
 * than the diffusion length before it went (transport removed it) or not (mixing could have).
 */
import type { MesoCloud } from "./mesoCloud";

export interface RegionInfo {
  id: number; cells: number; mass: number; volume: number;
  /** Centroid in fine cell coordinates. */
  centroid: [number, number, number];
  /** Heavy lobes: sub-regions above twice the threshold holding at least `lobeMassShare` of the region mass. */
  lobes: number;
  /** Width (m) of the thinnest bottleneck between the two heaviest lobes, 2 x the largest inscribed radius along the best path; null with fewer than two lobes. */
  neckWidth: number | null;
}
export interface ThresholdReport { threshold: number; count: number; regions: RegionInfo[]; label: Int32Array }
export interface TopologyOptions {
  /** Density of a cell = value * densityScale (mean-cell units for the shadow runs). */
  densityScale: number;
  /** Fine cell edge (m) and volume (m3). */
  cellSize: number; cellVolume: number;
  lobeMassShare?: number;
}

function label(cloud: MesoCloud, threshold: number, scale: number) {
  const n = cloud.values.length, lab = new Int32Array(n).fill(-1), sizes: number[] = [], stack: number[] = [];
  const nx = cloud.nx, ny = cloud.ny, nz = cloud.nz, plane = nx * ny;
  for (let s = 0; s < n; s++) {
    if (lab[s] >= 0 || !cloud.wet[s] || !(cloud.values[s] * scale > threshold)) continue;
    let count = 0; lab[s] = sizes.length; stack.push(s);
    while (stack.length) {
      const i = stack.pop()!; count++;
      const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / plane);
      const nb = [x > 0 ? i - 1 : -1, x + 1 < nx ? i + 1 : -1, y > 0 ? i - nx : -1, y + 1 < ny ? i + nx : -1, z > 0 ? i - plane : -1, z + 1 < nz ? i + plane : -1];
      for (const j of nb) if (j >= 0 && lab[j] < 0 && cloud.wet[j] && cloud.values[j] * scale > threshold) { lab[j] = sizes.length; stack.push(j); }
    }
    sizes.push(count);
  }
  return { lab, count: sizes.length };
}

/** Squared Euclidean distance (cells) of every foreground cell to the nearest background cell; dry cells are mirrors (never background). */
function distanceSquared(cloud: MesoCloud, inside: Uint8Array) {
  const nx = cloud.nx, ny = cloud.ny, nz = cloud.nz, INF = 1e12, d = new Float64Array(inside.length);
  for (let i = 0; i < d.length; i++) d[i] = !cloud.wet[i] ? INF : inside[i] ? INF : 0;
  const line = (get: (k: number) => number, set: (k: number, v: number) => void, length: number) => {
    const v = new Int32Array(length), z = new Float64Array(length + 1); let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    const f = new Float64Array(length); for (let q = 0; q < length; q++) f[q] = get(q);
    for (let q = 1; q < length; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < length; q++) { while (z[k + 1] < q) k++; set(q, (q - v[k]) ** 2 + f[v[k]]); }
  };
  for (let zz = 0; zz < nz; zz++) for (let y = 0; y < ny; y++) line(q => d[(zz * ny + y) * nx + q], (q, val) => { d[(zz * ny + y) * nx + q] = val; }, nx);
  for (let zz = 0; zz < nz; zz++) for (let x = 0; x < nx; x++) line(q => d[(zz * ny + q) * nx + x], (q, val) => { d[(zz * ny + q) * nx + x] = val; }, ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) line(q => d[(q * ny + y) * nx + x], (q, val) => { d[(q * ny + y) * nx + x] = val; }, nz);
  return d;
}

/** Regions at each threshold with mass, volume, lobes and neck width. */
export function analyseCloud(cloud: MesoCloud, thresholds: number[], options: TopologyOptions): ThresholdReport[] {
  const share = options.lobeMassShare ?? 0.05, nx = cloud.nx, ny = cloud.ny, plane = nx * ny;
  return thresholds.map(threshold => {
    const { lab, count } = label(cloud, threshold, options.densityScale);
    const regions: RegionInfo[] = Array.from({ length: count }, (_, id) => ({ id, cells: 0, mass: 0, volume: 0, centroid: [0, 0, 0] as [number, number, number], lobes: 0, neckWidth: null }));
    for (let i = 0; i < lab.length; i++) if (lab[i] >= 0) {
      const r = regions[lab[i]]; r.cells++; r.mass += cloud.values[i];
      r.centroid[0] += i % nx; r.centroid[1] += Math.floor(i / nx) % ny; r.centroid[2] += Math.floor(i / plane);
    }
    for (const r of regions) { r.volume = r.cells * options.cellVolume; for (let a = 0; a < 3; a++) r.centroid[a] /= Math.max(1, r.cells); }
    // Lobes and necks need a second labelling at twice the threshold inside the same region.
    const hi = label(cloud, threshold * 2, options.densityScale);
    const lobeMass = new Map<number, number>(), lobeRegion = new Map<number, number>();
    for (let i = 0; i < hi.lab.length; i++) if (hi.lab[i] >= 0) { lobeMass.set(hi.lab[i], (lobeMass.get(hi.lab[i]) ?? 0) + cloud.values[i]); lobeRegion.set(hi.lab[i], lab[i]); }
    const lobesOf = new Map<number, number[]>();
    for (const [l, mass] of lobeMass) { const region = lobeRegion.get(l)!; if (region >= 0 && mass >= share * regions[region].mass) lobesOf.set(region, [...(lobesOf.get(region) ?? []), l]); }
    let dist: Float64Array | null = null;
    for (const r of regions) {
      const lobes = (lobesOf.get(r.id) ?? []).sort((a, b) => lobeMass.get(b)! - lobeMass.get(a)!);
      r.lobes = lobes.length;
      if (lobes.length < 2) continue;
      dist ??= distanceSquared(cloud, Uint8Array.from(lab, v => (v >= 0 ? 1 : 0)));
      // Widest path between the two heaviest lobes: maximise the smallest inscribed radius along the path (Dijkstra with a max-heap).
      const best = new Float64Array(lab.length).fill(-1), heap: number[] = [];
      const push = (i: number) => { heap.push(i); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (best[heap[p]] >= best[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
      const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, rr = l + 1; let m = c; if (l < heap.length && best[heap[l]] > best[heap[m]]) m = l; if (rr < heap.length && best[heap[rr]] > best[heap[m]]) m = rr; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
      for (let i = 0; i < lab.length; i++) if (hi.lab[i] === lobes[0]) { best[i] = Math.sqrt(dist[i]); push(i); }
      let radius = 0;
      while (heap.length) {
        const i = pop();
        if (hi.lab[i] === lobes[1]) { radius = best[i]; break; }
        const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / plane);
        const nb = [x > 0 ? i - 1 : -1, x + 1 < nx ? i + 1 : -1, y > 0 ? i - nx : -1, y + 1 < ny ? i + nx : -1, z > 0 ? i - plane : -1, z + 1 < cloud.nz ? i + plane : -1];
        for (const j of nb) if (j >= 0 && lab[j] === r.id) { const w = Math.min(best[i], Math.sqrt(dist[j])); if (w > best[j]) { best[j] = w; push(j); } }
      }
      r.neckWidth = 2 * radius * options.cellSize;
    }
    return { threshold, count, regions, label: lab };
  });
}

export interface TopologyEvent {
  t: number; threshold: number; type: "split" | "merge" | "birth" | "death";
  parents: number[]; children: number[]; parentMass: number; childMass: number[];
  /** Neck width (m) of the parent in the previous snapshot (splits), and the diffusion length (m) over the snapshot interval. */
  neckBefore: number | null; diffusionLength: number;
  /** Split still present in the following snapshot. */
  persistent?: boolean;
}

/** Compares two snapshots at one threshold by cell overlap. `minOverlap` is the share of the smaller region that must be shared. */
/** Regions lighter than `minMass` are dust and take no part in events (a satellite of a few cells is not a separation). */
export function diffTopology(t: number, threshold: number, prev: ThresholdReport, cur: ThresholdReport, diffusionLength: number, minOverlap = 0.1, minMass = 0): TopologyEvent[] {
  const overlap = new Map<string, number>();
  for (let i = 0; i < prev.label.length; i++) if (prev.label[i] >= 0 && cur.label[i] >= 0) { const k = `${prev.label[i]}:${cur.label[i]}`; overlap.set(k, (overlap.get(k) ?? 0) + 1); }
  const childrenOf = new Map<number, number[]>(), parentsOf = new Map<number, number[]>();
  for (const [k, cells] of overlap) {
    const [p, c] = k.split(":").map(Number);
    if (prev.regions[p].mass < minMass || cur.regions[c].mass < minMass) continue;
    if (cells >= minOverlap * Math.min(prev.regions[p].cells, cur.regions[c].cells)) { childrenOf.set(p, [...(childrenOf.get(p) ?? []), c]); parentsOf.set(c, [...(parentsOf.get(c) ?? []), p]); }
  }
  const events: TopologyEvent[] = [];
  for (const p of prev.regions) {
    if (p.mass < minMass) continue;
    const ch = childrenOf.get(p.id) ?? [];
    if (ch.length >= 2) events.push({ t, threshold, type: "split", parents: [p.id], children: ch, parentMass: p.mass, childMass: ch.map(c => cur.regions[c].mass), neckBefore: p.neckWidth, diffusionLength });
    if (ch.length === 0) events.push({ t, threshold, type: "death", parents: [p.id], children: [], parentMass: p.mass, childMass: [], neckBefore: p.neckWidth, diffusionLength });
  }
  for (const c of cur.regions) {
    if (c.mass < minMass) continue;
    const pa = parentsOf.get(c.id) ?? [];
    if (pa.length >= 2) events.push({ t, threshold, type: "merge", parents: pa, children: [c.id], parentMass: pa.reduce((s, p) => s + prev.regions[p].mass, 0), childMass: [c.mass], neckBefore: null, diffusionLength });
    if (pa.length === 0) events.push({ t, threshold, type: "birth", parents: [], children: [c.id], parentMass: 0, childMass: [c.mass], neckBefore: null, diffusionLength });
  }
  return events;
}
