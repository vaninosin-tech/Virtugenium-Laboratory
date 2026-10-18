import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { LiquidMask } from '../../../src/scenes/laboratory/lib/tubeVolumeField';
import { TubeFlowSolver } from '../../../src/scenes/laboratory/lib/tubeFlowSolver';
import { DEFAULT_STREAM_ALPHA, TubeStreamModel, streamStateFromEvent } from '../../../src/scenes/laboratory/lib/tubeStreamModel';
import { tubeVessel } from '../../../src/scenes/laboratory/lib/vesselGeometry';
import type { DeliveryEvent } from '../../../src/scenes/laboratory/lib/tubeDelivery';

// Physical stream model: contract, integral jet consistency, face flux balance, fixed-face projection.
const event = (over: Partial<DeliveryEvent> = {}): DeliveryEvent => ({ tubeId: 't', reagentId: 'nacl', serial: 1, step: 700, ml: 0.07,
  requestedMl: 0.07, point: { x: 0.0065, y: 0.0186, z: 0 }, surfaceY: 0.0186, atMs: 1000, valid: true, reason: 'ok',
  sourceMouth: { x: 0, y: 0.15, z: 0 }, ...over });
const mask = (nx = 12, ny = 24, level = tubeVessel.heightFromVolume(2.5)) => {
  const m = new LiquidMask(nx, ny, nx, .007, 0, tubeVessel.heightFromVolume(tubeVessel.capacityMl));
  m.update(new THREE.Vector3(0, 1, 0), level); return m;
};

describe('stream state from the delivery event', () => {
  it('keeps Q = A U and the momentum flux rho Q U, for a measured and for a reconstructed lip', () => {
    for (const e of [event(), event({ sourceMouth: undefined, sourceOutlet: { x: 0.0065, y: 0.16, z: 0 }, sourceOutletVelocity: { x: 0.05, y: -0.02, z: 0 } })]) {
      const s = streamStateFromEvent(e, 50)!;
      expect(s).toBeDefined();
      expect(Math.abs(s.impactArea * s.impactSpeed / s.q - 1)).toBeLessThan(1e-12);
      expect(Math.abs(s.momentumFlux / (1000 * s.q * s.impactSpeed) - 1)).toBeLessThan(1e-12);
      expect(Math.abs(Math.PI * s.impactRadius ** 2 / s.impactArea - 1)).toBeLessThan(1e-12);
      expect(s.q).toBeCloseTo(0.07e-6 / 0.05, 15);
      expect(s.direction.length()).toBeCloseTo(1, 12);
      expect(s.direction.y).toBeLessThan(-0.99);
    }
    expect(streamStateFromEvent(event(), 50)!.source).toBe('reconstructed');
    expect(streamStateFromEvent(event({ sourceOutlet: { x: 0.0065, y: 0.16, z: 0 } }), 50)!.source).toBe('measured');
  });
  it('impact speed follows free fall: sqrt(U_lip^2 + 2 g h), and is undefined without lip or mouth, or for an invalid event', () => {
    const s = streamStateFromEvent(event(), 50)!;
    expect(s.impactSpeed).toBeGreaterThan(Math.sqrt(2 * 9.81 * s.fall) - 1e-9);
    expect(s.fall).toBeCloseTo(0.15 - 0.0186, 9);
    expect(streamStateFromEvent(event({ sourceMouth: undefined }), 50)).toBeUndefined();
    expect(streamStateFromEvent(event({ valid: false }), 50)).toBeUndefined();
    expect(streamStateFromEvent(event({ ml: 0 }), 50)).toBeUndefined();
  });
});

describe('integral jet and imposed faces', () => {
  const level = tubeVessel.heightFromVolume(2.5);
  const prepare = (m: LiquidMask, e = event(), alpha = DEFAULT_STREAM_ALPHA, lvl = level) => {
    const model = new TubeStreamModel(m, { alpha });
    model.prepare({ x: 0.0065, z: 0 }, lvl, streamStateFromEvent(e, 50));
    return model;
  };
  it('conserves momentum flux, keeps b = sqrt(Q/(pi U)), grows Q monotonically and reaches the bowl without a preset depth', () => {
    const model = prepare(mask());
    expect(model.active).toBe(true);
    const M = model.inputMomentum;
    for (const st of model.stations) {
      expect(Math.abs(1000 * st.q * st.u / M - 1)).toBeLessThan(1e-9);
      expect(Math.abs(st.b - Math.sqrt(st.q / (Math.PI * st.u))) / st.b).toBeLessThan(1e-9);
    }
    for (let k = 1; k < model.stations.length; k++) expect(model.stations[k].q).toBeGreaterThanOrEqual(model.stations[k - 1].q);
    expect(model.floorReached).toBe(true);
    expect(model.endFlow).toBeGreaterThan(model.state!.q);
    expect(model.endSpeed).toBeLessThan(model.state!.impactSpeed);
    // The depth is a result: shallower liquid gives a shallower jet.
    const shallow = prepare(mask(12, 24, tubeVessel.heightFromVolume(1)), event(), DEFAULT_STREAM_ALPHA, tubeVessel.heightFromVolume(1));
    expect(shallow.penetration).toBeLessThan(model.penetration);
  });
  it('entrains less against the glass (open share below one) than a free jet would', () => {
    const wall = prepare(mask()), center = new TubeStreamModel(mask());
    center.prepare({ x: 0, z: 0 }, level, streamStateFromEvent(event({ point: { x: 0, y: 0.0186, z: 0 } }), 50));
    expect(Math.min(...wall.stations.map(st => st.open))).toBeLessThan(0.8);
    expect(center.stations[0].open).toBeGreaterThan(0.99);
    expect(wall.entrainedFlow / wall.penetration).toBeLessThan(center.entrainedFlow / center.penetration);
  });
  it('imposes only faces between wet cells and balances the flux of every layer', () => {
    const m = mask(), model = prepare(m);
    const nx = m.nx, ny = m.ny, stride = [1, nx, nx * ny];
    let verticalFaces = 0;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      for (let axis = 0; axis < 3; axis++) if (model.fixed[3 * i + axis]) {
        expect(m.data[i + stride[axis]]).toBe(1);        // both sides wet: never a face into air or glass
        if (axis === 1) verticalFaces++;
      }
    }
    for (let i = 0; i < m.data.length; i++) if (!m.data[i]) for (let axis = 0; axis < 3; axis++) expect(model.fixed[3 * i + axis]).toBe(0);
    expect(verticalFaces).toBeGreaterThan(5);
    // Total vertical flux through each imposed face height equals Q(s) of the integral model.
    const dx = 2 * m.radius / nx, dz = 2 * m.radius / m.nz, flux = new Map<number, number>();
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], y = Math.floor(i / nx) % ny;
      if (model.fixed[3 * i + 1]) flux.set(y, (flux.get(y) ?? 0) - model.value[3 * i + 1] * dx * dz);
    }
    const rows = [...flux.keys()].sort((p, q) => q - p);          // from the surface down
    let previous = 0;
    for (const y of rows) { expect(flux.get(y)!).toBeGreaterThan(0); expect(flux.get(y)!).toBeGreaterThanOrEqual(previous - 1e-15); previous = flux.get(y)!; }
    const shallowest = flux.get(rows[0])!, deepest = flux.get(rows[rows.length - 1])!;
    expect(shallowest).toBeGreaterThan(model.state!.q * 0.99);
    expect(deepest).toBeLessThanOrEqual(model.endFlow * 1.0000001);
    expect(model.maxSpeed).toBeLessThan(5);               // explained below: top-hat jet in one 1.2 mm cell column
  });
  it('the projection keeps the imposed faces, gives a divergence-free return flow and zero velocity outside the liquid', () => {
    const m = mask(), model = prepare(m), solver = new TubeFlowSolver(m);
    solver.step(0.05, new THREE.Vector3(0.0065, 0.0186, 0), new THREE.Vector3(0, -1, 0), 0, 0, undefined, 0, undefined, undefined, model, 0.1);
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      for (let axis = 0; axis < 3; axis++) if (model.fixed[3 * i + axis])
        expect(Math.abs((solver as unknown as { faces: Float32Array[] }).faces[axis][i] - model.value[3 * i + axis])).toBeLessThan(1e-6);
    }
    const flow = solver.flow;
    for (let i = 0; i < m.data.length; i++) if (!m.data[i]) expect(Math.hypot(flow[3 * i], flow[3 * i + 1], flow[3 * i + 2])).toBe(0);
    const d = solver.diagnostics();
    expect(d.meanAbsDivergence).toBeLessThan(2);          // 1/s; the fixed faces include the surface suction of the incoming volume
    let down = 0, up = 0;
    for (let a = 0; a < m.activeCount; a++) { const w = flow[3 * m.active[a] + 1]; if (w < 0) down += -w; else up += w; }
    expect(up).toBeGreaterThan(0);                        // a recirculation exists
    expect(solver.substeps).toBeGreaterThan(1);
    expect(solver.lastMaxCourant).toBeGreaterThan(1);
  });
  it('without a stream state nothing is imposed and the solver behaves as before', () => {
    const m = mask(), model = new TubeStreamModel(m);
    model.prepare({ x: 0.0065, z: 0 }, level, undefined);
    expect(model.active).toBe(false);
    expect(model.fixed.every(v => v === 0)).toBe(true);
  });
});
