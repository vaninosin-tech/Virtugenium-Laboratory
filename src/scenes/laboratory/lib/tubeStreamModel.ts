import * as THREE from "three";
import type { LiquidMask } from "./tubeVolumeField";
import type { DeliveryEvent } from "./tubeDelivery";
import { pourJetState } from "./tubePourImpact";

/**
 * Physical stream penetration (experimental, window.__silverStream; the accepted baseline and the legacy jet model are
 * untouched).
 *
 * The incoming stream is described by the authoritative delivery event: ledger flow Q, the lip pose (measured, or
 * reconstructed at the tube mouth plane), the free fall to the surface, and so the impact speed U and area A = Q/U
 * (momentum flux rho Q U). Below the surface it is a round submerged turbulent jet in the integral (top-hat) form:
 *
 *   rho Q U = M = const                      (momentum flux; pressure and weight neglected)
 *   b = sqrt(Q / (pi U))                     (so Q = A U at every depth)
 *   dQ/ds = 2 pi alpha b U f_open            (entrainment hypothesis; f_open = share of the jet's perimeter that
 *                                             borders liquid rather than the glass)
 *
 * Nothing prescribes the penetration depth: the jet continues until the vessel (bowl) stops it, or until its Reynolds
 * number U b / nu drops to the laminar limit. The jet is imposed on the staggered grid as known face velocities:
 * vertical flux Q(s) in the footprint of the disc of radius b and the matching lateral entrainment inflow, built so that
 * every horizontal layer balances. The pressure projection treats these faces as fixed and solves everything else, so
 * the return flow, the recirculation and the stagnation at the bowl follow from the incompressible solve. Scalars are
 * moved only by the resulting face velocities.
 */
export interface StreamState {
  /** Ledger volume flow of this step (m3/s). */
  q: number;
  impactSpeed: number;
  impactArea: number;
  impactRadius: number;
  /** rho Q U (N). */
  momentumFlux: number;
  /** Unit vector of the impact velocity, tube-local axes (y up). */
  direction: THREE.Vector3;
  fall: number;
  source: "measured" | "reconstructed";
}

const RHO = 1000, NU = 1.0e-6;

/** Stream state of one ledger interval. Undefined when the event has neither a measured lip nor a mouth position. */
export function streamStateFromEvent(event: DeliveryEvent, intervalMs: number): StreamState | undefined {
  if (!event.valid || !(event.ml > 0) || !(intervalMs > 0)) return undefined;
  const hit = new THREE.Vector3(event.point.x, event.point.y, event.point.z);
  let lip: THREE.Vector3, source: StreamState["source"];
  if (event.sourceOutlet) {
    lip = new THREE.Vector3(event.sourceOutlet.x, event.sourceOutlet.y, event.sourceOutlet.z); source = "measured";
  } else if (event.sourceMouth) {
    // Reconstruction: the bottle lip hangs over the rim, at the mouth plane, straight above the impact point.
    lip = new THREE.Vector3(event.point.x, Math.max(event.sourceMouth.y, event.point.y), event.point.z); source = "reconstructed";
  } else return undefined;
  const v = event.sourceOutletVelocity;
  const q = event.ml * 1e-6 / (intervalMs / 1000);
  const jet = pourJetState(event.atMs, lip, hit, v ? new THREE.Vector3(v.x, v.y, v.z) : undefined, q);
  const direction = jet.impactVelocity.clone().normalize();
  return { q, impactSpeed: jet.impactSpeed, impactArea: jet.impactArea, impactRadius: jet.impactRadius,
    momentumFlux: RHO * q * jet.impactSpeed, direction, fall: Math.max(0, lip.y - hit.y), source };
}

export interface StreamOptions {
  /** Entrainment coefficient of the round jet. Literature value for the top-hat jet is about 0.05 to 0.06. */
  alpha?: number;
  /** Extra turbulent decay of the resolved flow: rate = dissipation * |u| / R (0 keeps the baseline damping only). */
  dissipation?: number;
}
export const DEFAULT_STREAM_ALPHA = 0.057;
export const DEFAULT_STREAM_DISSIPATION = 0.1;

export interface StreamStation { y: number; s: number; q: number; u: number; b: number; open: number }

/** Known face velocities for the projection plus the integral-jet diagnostics. */
export class TubeStreamModel {
  /** Fixed flag and value per face (face stored at the + side of its cell, index 3*cell + axis). */
  readonly fixed: Uint8Array;
  readonly value: Float32Array;
  readonly stations: StreamStation[] = [];
  active = false;
  state?: StreamState;
  /** Integrated quantities of the last prepare(). */
  penetration = 0;
  entrainedFlow = 0;
  endFlow = 0;
  endSpeed = 0;
  floorReached = false;
  inputMomentum = 0;
  /** Sum over fixed vertical faces of -v A at the first and the deepest imposed face (m3/s). */
  firstFaceFlow = 0;
  lastFaceFlow = 0;
  fixedFaces = 0;
  lateralFaces = 0;
  maxSpeed = 0;
  lastPrepareMs = 0;
  private readonly spacing: number[];
  private readonly alpha: number;
  constructor(readonly mask: LiquidMask, options: StreamOptions = {}) {
    const n = mask.data.length;
    this.fixed = new Uint8Array(3 * n);
    this.value = new Float32Array(3 * n);
    this.spacing = [2 * mask.radius / mask.nx, mask.height / mask.ny, 2 * mask.radius / mask.nz];
    this.alpha = options.alpha ?? DEFAULT_STREAM_ALPHA;
  }
  private inside(x: number, z: number, y: number) {
    const m = this.mask, radial = Math.hypot(x, z), h = y - m.bottom;
    if (h < 0) return false;
    return h < m.radius ? radial * radial + (h - m.radius) ** 2 < m.radius ** 2 : radial < m.radius;
  }
  /** Share of the jet's perimeter (radius b around the axis) that borders liquid. */
  private openShare(cx: number, cz: number, b: number, y: number) {
    let open = 0; const samples = 24;
    for (let k = 0; k < samples; k++) {
      const a = 2 * Math.PI * (k + 0.5) / samples;
      if (this.inside(cx + 1.0 * b * Math.cos(a), cz + 1.0 * b * Math.sin(a), y)) open++;
    }
    return open / samples;
  }
  /** Columns (cell x,z) overlapped by the disc, weighted by the overlap with their wet cells at row j and j+1 (face between). */
  private footprint(cx: number, cz: number, b: number, rowLow: number, rowHigh: number | null) {
    const m = this.mask, dx = this.spacing[0], dz = this.spacing[2], radius = m.radius;
    const x0 = Math.max(0, Math.floor((cx - b + radius) / dx)), x1 = Math.min(m.nx - 1, Math.floor((cx + b + radius) / dx));
    const z0 = Math.max(0, Math.floor((cz - b + radius) / dz)), z1 = Math.min(m.nz - 1, Math.floor((cz + b + radius) / dz));
    const cells: { x: number; z: number; w: number }[] = [];
    let sum = 0; const sub = 4;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const low = m.index(x, rowLow, z);
      if (!m.data[low]) continue;
      if (rowHigh !== null && !m.data[m.index(x, rowHigh, z)]) continue;
      let inside = 0;
      for (let sz = 0; sz < sub; sz++) for (let sx = 0; sx < sub; sx++) {
        const px = -radius + (x + (sx + 0.5) / sub) * dx, pz = -radius + (z + (sz + 0.5) / sub) * dz;
        if ((px - cx) ** 2 + (pz - cz) ** 2 <= b * b) inside++;
      }
      const w = inside / (sub * sub);
      if (w > 0) { cells.push({ x, z, w }); sum += w; }
    }
    if (sum === 0) {
      // Sub-cell disc: put the whole flux in the wet column containing (or nearest to) the axis.
      let best: { x: number; z: number } | undefined, bestD = Infinity;
      for (let z = z0 - 1; z <= z1 + 1; z++) for (let x = x0 - 1; x <= x1 + 1; x++) {
        if (x < 0 || z < 0 || x >= m.nx || z >= m.nz) continue;
        if (!m.data[m.index(x, rowLow, z)] || (rowHigh !== null && !m.data[m.index(x, rowHigh, z)])) continue;
        const p = m.point(x, rowLow, z), d = (p.x - cx) ** 2 + (p.z - cz) ** 2;
        if (d < bestD) { bestD = d; best = { x, z }; }
      }
      if (!best) return [];
      return [{ ...best, w: 1 }];
    }
    return cells.map(c => ({ ...c, w: c.w / sum }));
  }
  clear() {
    this.fixed.fill(0); this.value.fill(0); this.stations.length = 0;
    this.active = false; this.penetration = this.entrainedFlow = this.endFlow = this.endSpeed = 0;
    this.floorReached = false; this.inputMomentum = 0; this.firstFaceFlow = this.lastFaceFlow = 0;
    this.fixedFaces = this.lateralFaces = 0; this.maxSpeed = 0;
  }
  /** Integrates the jet from the free surface and fills fixed/value. `axis` is the stream axis start (x,z) at the surface. */
  prepare(axis: { x: number; z: number }, level: number, state: StreamState | undefined) {
    const started = typeof performance !== "undefined" ? performance.now() : 0;
    this.prepareInner(axis, level, state);
    this.lastPrepareMs = started ? performance.now() - started : 0;
  }
  private prepareInner(axis: { x: number; z: number }, level: number, state: StreamState | undefined) {
    this.clear();
    const m = this.mask, dy = this.spacing[1];
    if (!state || !(state.q > 0) || state.direction.y > -0.1) return;
    this.state = state;
    const d = state.direction, slope = [d.x / -d.y, d.z / -d.y];
    const mFlux = state.momentumFlux / RHO;       // Q*U, m4/s2
    this.inputMomentum = state.momentumFlux;
    // March from the surface down in sub-cell steps (path length ds along the axis).
    let q = state.q, depth = 0, s = 0;
    const dyFine = dy / 8, ds = dyFine / -d.y;
    const track: StreamStation[] = [];
    let y = level;
    for (let guard = 0; guard < 4000; guard++) {
      const u = mFlux / q, b = Math.sqrt(q / (Math.PI * u));
      const cx = axis.x + slope[0] * depth, cz = axis.z + slope[1] * depth;
      if (!this.inside(cx, cz, y)) { this.floorReached = true; break; }
      const open = this.openShare(cx, cz, b, y);
      track.push({ y, s, q, u, b, open });
      if (u * b / NU < 30) break;                  // laminar limit: the jet no longer entrains
      const dq = 2 * Math.PI * this.alpha * b * u * open * ds;
      q += dq; s += ds; depth += dyFine; y -= dyFine;
      if (y < m.bottom) { this.floorReached = true; break; }
    }
    if (track.length < 2) return;
    this.stations.push(...track);
    const last = track[track.length - 1];
    this.penetration = last.s; this.endFlow = last.q; this.endSpeed = last.u;
    this.entrainedFlow = last.q - state.q;
    this.active = true;
    const stationAt = (yy: number) => {
      // Linear interpolation on the fine track (track.y is descending).
      const idx = Math.min(track.length - 2, Math.max(0, Math.floor((level - yy) / dyFine)));
      const a = track[idx], c = track[idx + 1], t = (a.y - yy) / Math.max(1e-12, a.y - c.y);
      return { q: a.q + (c.q - a.q) * t, b: a.b + (c.b - a.b) * t, s: a.s + (c.s - a.s) * t, depth: level - yy };
    };
    // Rows from the highest wet row under the axis downward: face between row j and j+1 at height bottom + (j+1) dy.
    const deepest = track[track.length - 1].y;
    const areaXZ = this.spacing[0] * this.spacing[2];
    let previousFlow = state.q;
    const lateralPlans: { row: number; inflow: number; cells: { x: number; z: number; w: number }[] }[] = [];
    let started = false;
    for (let j = m.ny - 2; j >= 0; j--) {
      const yf = m.bottom + (j + 1) * dy;
      if (yf > level) continue;
      if (yf < deepest) break;
      const st = stationAt(yf), cx = axis.x + slope[0] * st.depth, cz = axis.z + slope[1] * st.depth;
      const cells = this.footprint(cx, cz, Math.max(st.b, 1e-6), j, j + 1);
      if (!cells.length) { if (started) break; continue; }
      started = true;
      for (const c of cells) {
        const i = m.index(c.x, j, c.z);
        const v = -st.q * c.w / areaXZ;
        this.fixed[3 * i + 1] = 1; this.value[3 * i + 1] = v; this.fixedFaces++;
        this.maxSpeed = Math.max(this.maxSpeed, Math.abs(v));
      }
      if (this.firstFaceFlow === 0) this.firstFaceFlow = st.q;
      this.lastFaceFlow = st.q;
      lateralPlans.push({ row: j, inflow: Math.max(0, st.q - previousFlow), cells });
      previousFlow = st.q;
    }
    // Lateral entrainment inflow of each layer through the wet faces on the footprint boundary.
    const inFoot = new Set<number>();
    for (const plan of lateralPlans) {
      inFoot.clear();
      for (const c of plan.cells) inFoot.add(m.index(c.x, plan.row, c.z));
      const faces: { cell: number; axis: number; sign: number; area: number }[] = [];
      for (const c of plan.cells) {
        const i = m.index(c.x, plan.row, c.z);
        for (const [axis, stride, limit, coordinate, area] of [[0, 1, m.nx, c.x, this.spacing[1] * this.spacing[2]],
          [2, m.nx * m.ny, m.nz, c.z, this.spacing[0] * this.spacing[1]]] as const) {
          for (const side of [-1, 1]) {
            if (coordinate + side < 0 || coordinate + side >= limit) continue;
            const k = i + side * stride;
            if (!m.data[k] || inFoot.has(k)) continue;
            // Face stored at the lower-index cell; inflow into i from k.
            faces.push({ cell: side > 0 ? i : k, axis, sign: side > 0 ? -1 : 1, area });
          }
        }
      }
      if (!faces.length || plan.inflow <= 0) continue;
      const share = plan.inflow / faces.length;
      for (const f of faces) {
        if (this.fixed[3 * f.cell + f.axis]) continue;
        const v = f.sign * share / f.area;
        this.fixed[3 * f.cell + f.axis] = 1; this.value[3 * f.cell + f.axis] = v; this.lateralFaces++;
        this.maxSpeed = Math.max(this.maxSpeed, Math.abs(v));
      }
    }
  }
}
