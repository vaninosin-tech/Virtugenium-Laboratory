import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { clearDeliveries, deliveredMl, deliveryEvents, recordDelivery } from "../../../src/scenes/laboratory/lib/tubeDelivery";
import { eventJetState, pourFlowBins, pourFlowMlPerSecond, pourJetState, pourOutletRadius, pouredMl, samplePourOutlet, stepTubePour, clearTubePourImpact } from "../../../src/scenes/laboratory/lib/tubePourImpact";
import { POUR_MS, useStandMotionStore } from "../../../src/scenes/laboratory/lib/useStandMotionStore";
import { resetTubeAmounts, seedTubeAmounts } from "../../../src/scenes/laboratory/lib/tubeAmounts";
import { tubeVessel } from "../../../src/scenes/laboratory/lib/vesselGeometry";
import { TubeJetModel } from "../../../src/scenes/laboratory/lib/tubeJetModel";
import { LiquidMask } from "../../../src/scenes/laboratory/lib/tubeVolumeField";

describe("wave 14 pouring physics", () => {
  it("conserves the exact delivered integral across 30 and 50 ms bins", () => {
    for (const bin of [30, 50]) {
      const series = pourFlowBins(bin);
      expect(series.reduce((sum, row) => sum + row.ml, 0)).toBeCloseTo(1, 12);
      expect(series.reduce((sum, row) => sum + row.q * bin / 1000, 0)).toBeCloseTo(1e-6, 15);
      expect(series.every(row => row.q >= 0)).toBe(true);
    }
    expect(pouredMl(1)).toBe(1);
  });

  it("relates Q, areas, speeds, force and gravitational energy in SI units", () => {
    const lip = new THREE.Vector3(0, 0.16, 0);
    const hit = new THREE.Vector3(0.0065, 0.08, 0);
    const motion = new THREE.Vector3(0.02, 0, -0.01);
    for (let atMs = 600; atMs <= 1300; atMs += 10) {
      const state = pourJetState(atMs, lip, hit, motion);
      expect(state.q).toBeCloseTo(state.lipArea * state.lipSpeed, 15);
      expect(state.q).toBeCloseTo(state.impactArea * state.impactSpeed, 15);
      expect(state.force).toBeCloseTo(1000 * state.q * state.impactSpeed, 15);
      expect(state.impactSpeed ** 2 - state.lipSpeed ** 2).toBeCloseTo(2 * 9.81 * .08, 12);
      expect(state.impactVelocity.x).toBe(motion.x);
      expect(state.impactVelocity.z).toBe(motion.z);
      expect(state.lipArea).toBeCloseTo(Math.PI * pourOutletRadius(atMs / POUR_MS) ** 2, 15);
    }
  });

  it("keeps unique ordered events and a detached diagnostic snapshot", () => {
    clearDeliveries();
    const context = { axis: { x: 0, y: 0, z: 0 }, radius: .007,
      surfaceY: 0, hasLiquid: true };
    const base = { tubeId: "g2", sourceId: "bottle", reagentId: "nacl", serial: 5,
      ml: .25, atMs: 30, point: { x: 0, y: 0, z: 0 }, surfaceY: 0,
      sourceOutlet: { x: 0, y: .08, z: 0 },
      sourceOutletVelocity: { x: .01, y: 0, z: 0 } };
    const first = recordDelivery({ ...base, step: 30 }, context);
    expect(first.valid).toBe(true);
    const jet = eventJetState(first, 30)!;
    expect(jet.q * .03).toBeCloseTo(first.ml * 1e-6, 15);
    expect(jet.impactVelocity.x).toBe(.01);
    expect(recordDelivery({ ...base, step: 30 }, context).reason).toBe("duplicate");
    const miss = recordDelivery({ ...base, step: 60, atMs: 60,
      point: { x: .01, y: 0, z: 0 } }, context);
    expect(miss.valid).toBe(false);
    expect(miss.requestedMl).toBe(.25);
    expect(miss.ml).toBe(0);
    expect(eventJetState(miss, 30)).toBeUndefined();
    expect(deliveredMl("g2")).toBe(.25);
    const snapshot = deliveryEvents("g2");
    expect(snapshot.map(e => e.step)).toEqual([30, 60]);
    snapshot[0].point.x = 99;
    snapshot[0].sourceOutlet!.y = 99;
    expect(deliveryEvents("g2")[0].point.x).toBe(0);
    expect(deliveryEvents("g2")[0].sourceOutlet!.y).toBe(.08);
    clearDeliveries();
  });

  it("logs a sampled lip and its finite difference on the stand clock", () => {
    clearDeliveries(); resetTubeAmounts(); clearTubePourImpact("sampled");
    seedTubeAmounts("sampled", ["agno3"]);
    useStandMotionStore.setState({ pour: { instanceId: "sample-bottle", at: 1000 } });
    samplePourOutlet("sample-bottle", 1000, 1870, new THREE.Vector3(.001, .16, 0));
    samplePourOutlet("sample-bottle", 1000, 1900, new THREE.Vector3(.0016, .157, 0));
    const e = stepTubePour({ tubeId: "sampled", reagentId: "agno3", serial: 1000, now: 1900,
      mouth: new THREE.Vector3(0, .15, 0), root: new THREE.Matrix4(),
      side: new THREE.Vector3(1, 0, 0), mouthValid: true });
    expect(e?.sourceOutlet).toMatchObject({ x: .0016, y: .157, z: 0 });
    expect(e?.sourceOutletVelocity?.x).toBeCloseTo(.02, 12);
    expect(e?.sourceOutletVelocity?.y).toBeCloseTo(-.1, 12);
    expect(e?.serial! + e?.atMs!).toBe(1900);
    useStandMotionStore.setState({ pour: null });
    clearDeliveries(); resetTubeAmounts(); clearTubePourImpact("sampled");
  });

  it("takes an extended event into the optional wet-cell jet hook", () => {
    const event = { tubeId: "g2", sourceId: "bottle", reagentId: "nacl",
      serial: 5, step: 900, atMs: 900, ml: .05, point: { x: .0065, y: .035, z: 0 },
      surfaceY: .035, sourceOutlet: { x: .004, y: .158, z: 0 },
      sourceOutletVelocity: { x: .01, y: 0, z: 0 },
      valid: true as const, reason: "ok" as const };
    const mask = new LiquidMask(12, 24, 12, tubeVessel.innerRadius, 0, tubeVessel.cavityHeight);
    mask.update(new THREE.Vector3(0, 1, 0), .035);
    const inlet = new THREE.Vector3(.0065, .034, 0);
    const jet = new TubeJetModel(mask);
    jet.prepare(.05, inlet, new THREE.Vector3(0, -1, 0),
      { x: inlet.x, z: 0, level: .035, flow: 0, alpha: .2,
        delta: .0015, r0: .001, relaxation: 12 }, { event, intervalMs: 50 });
    const expected = eventJetState(event, 50)!;
    expect(jet.flow).toBeCloseTo(expected.q, 15);
    expect(jet.speed).toBeCloseTo(expected.impactSpeed, 12);
    expect(jet.area).toBeCloseTo(expected.impactArea, 12);
    expect(jet.appliedMomentum[1] + jet.blockedMomentum[1]).toBeCloseTo(jet.momentum[1], 8);
    for (let i = 0; i < mask.data.length; i++) if (!mask.data[i])
      expect(jet.source[3 * i + 1]).toBe(0);
  });

  it("exports a reproducible unbinned and event-bin series", () => {
    // 0.158 m is an explicit illustrative outlet height, not a measured browser trace.
    const lines = ["at_ms,surface_m,assumed_outlet_y_m,instant_q_m3_s,u_lip_m_s,u_impact_m_s,a_impact_m2,force_n,q_30ms_m3_s,q_50ms_m3_s,event_50ms_q_m3_s"];
    const b30 = pourFlowBins(30), b50 = pourFlowBins(50);
    const event50 = new Float64Array(Math.ceil(POUR_MS / 50) + 1);
    let prior = 0;
    for (let eventMs = 30; eventMs <= POUR_MS + 30; eventMs += 30) {
      const cumulative = pouredMl(Math.min(eventMs, POUR_MS) / POUR_MS);
      event50[Math.floor(eventMs / 50)] += cumulative - prior;
      prior = cumulative;
    }
    const lip = new THREE.Vector3(0, .158, 0), hit = new THREE.Vector3(.0065, 0, 0);
    for (let atMs = 0; atMs <= POUR_MS; atMs += 10) {
      hit.y = tubeVessel.heightFromVolume(2.5 + pouredMl(atMs / POUR_MS));
      const s = pourJetState(atMs, lip, hit);
      const q30 = b30[Math.min(b30.length - 1, Math.floor(atMs / 30))].q;
      const q50 = b50[Math.min(b50.length - 1, Math.floor(atMs / 50))].q;
      lines.push([atMs, hit.y, lip.y, s.q, s.lipSpeed, s.impactSpeed, s.impactArea,
        s.force, q30, q50, event50[Math.floor(atMs / 50)] * 1e-6 / .05].join(","));
      expect(s.q).toBeCloseTo(pourFlowMlPerSecond(atMs / POUR_MS) * 1e-6, 15);
    }
    mkdirSync("docs/night/wave14g2", { recursive: true });
    writeFileSync("docs/night/wave14g2/pour-series.csv", lines.join("\n") + "\n");
  });
});
