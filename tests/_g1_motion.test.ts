import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { mkdirSync, writeFileSync } from "node:fs";
import { TubeBariumField } from "../src/scenes/laboratory/lib/tubeBariumField";
import { TubeMotion } from "../src/scenes/laboratory/lib/tubeMotion";

describe("G1 scripted tube motion", () => {
  it("raises flow energy and moves dye under 2-3 Hz shaking and a jerk", () => {
    const run = (name: string, amplitude: number, frequency: number, jerk = false) => {
      const field = new TubeBariumField("LOW", 0.007, 0, 0.113, 0, true);
      const tube = new THREE.Object3D(), motion = new TubeMotion();
      const up = new THREE.Vector3(0, 1, 0), h = 0.07718921053897544;
      const inlet = new THREE.Vector3(0, h - 0.0007, 0);
      const samples: { t: number; energy: number; displacement: number; centroidShift: number; intensity: number }[] = [];
      let referenceX = 0;
      let transportedDistance = 0;
      for (let n = 0; n <= 120; n++) {
        const t = n * 0.05;
        const moving = t >= 2 && t < 3.2;
        tube.position.x = moving
          ? jerk ? (t < 2.05 ? amplitude * (t - 2) / 0.05 : amplitude) :
            amplitude * Math.sin(2 * Math.PI * frequency * (t - 2))
          : 0;
        const intensity = motion.sample(tube, 0.05);
        field.velocity.contributions.acceleration.copy(motion.impulse);
        field.advance(0.05, up, h, inlet, Math.min(1, t / 0.5), intensity);
        const energy = field.solver.diagnostics().energy;
        let weightedX = 0;
        for (let a = 0; a < field.mask.activeCount; a++) {
          const i = field.mask.active[a];
          weightedX += field.tracer[i] * field.mask.point(i % field.mask.nx,
            Math.floor(i / field.mask.nx) % field.mask.ny,
            Math.floor(i / (field.mask.nx * field.mask.ny))).x;
        }
        const centroid = weightedX / Math.max(1e-30, field.solver.scalarDiagnostics(field.tracer).mass);
        if (n === 39) referenceX = centroid;
        if (t >= 2 && t < 3.3) {
          let speed = 0;
          for (let a = 0; a < field.mask.activeCount; a++) {
            const i = field.mask.active[a];
            speed += field.tracer[i] * Math.hypot(field.flow[i * 3],
              field.flow[i * 3 + 1], field.flow[i * 3 + 2]);
          }
          transportedDistance += speed * 0.05 /
            Math.max(1e-30, field.solver.scalarDiagnostics(field.tracer).mass);
        }
        samples.push({ t, energy, displacement: transportedDistance,
          centroidShift: Math.abs(centroid - referenceX), intensity });
      }
      const baseline = samples[39].energy;
      const peak = Math.max(...samples.filter(s => s.t >= 2 && s.t < 3.3).map(s => s.energy));
      const displacement = transportedDistance;
      const tail = samples.at(-1)!.energy;
      const mass = field.solver.scalarDiagnostics(field.tracer).mass;
      field.dispose();
      return { name, baseline, peak, displacement, tail, mass, samples };
    };
    const weak = run("2 cm, 2 Hz", 0.02, 2);
    const strong = run("4 cm, 3 Hz", 0.04, 3);
    const jerk = run("4 cm jerk", 0.04, 0, true);
    mkdirSync("tmp/g1-tracer", { recursive: true });
    writeFileSync("tmp/g1-tracer/energy-series.json", JSON.stringify([weak, strong, jerk], null, 2));
    expect(weak.peak).toBeGreaterThan(weak.baseline * 1.2);
    expect(strong.peak).toBeGreaterThan(weak.peak * 1.2);
    expect(jerk.peak).toBeGreaterThan(jerk.baseline * 1.2);
    expect(strong.displacement).toBeGreaterThan(weak.displacement);
    expect(strong.tail).toBeLessThan(strong.peak);
    for (const result of [weak, strong, jerk]) expect(result.mass).toBeCloseTo(1, 9);
  }, 30000);
});
