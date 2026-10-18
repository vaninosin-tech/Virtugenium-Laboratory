import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { tubeVessel } from "../../../src/scenes/laboratory/lib/vesselGeometry";
import { LiquidMask, TubeVolumeField } from "../../../src/scenes/laboratory/lib/tubeVolumeField";
import { TubeBariumField } from "../../../src/scenes/laboratory/lib/tubeBariumField";
import { BariumSedimentField, BariumSedimentGeometry } from "../../../src/scenes/laboratory/lib/tubeBariumSediment";
import { TubePermanganateField } from "../../../src/scenes/laboratory/lib/tubePermanganateField";
import { TubeNOBubbles } from "../../../src/scenes/laboratory/lib/tubeNOBubbles";
import { createTubeCopperGranules, stepCopperGranuleDrop } from "../../../src/scenes/laboratory/lib/testTubeContents";

const radius = tubeVessel.innerRadius;
const bottom = 0.0005;
const fieldHeight = tubeVessel.heightFromVolume(tubeVessel.capacityMl);
const up = new THREE.Vector3(0, 1, 0);
const level = (ml: number) => bottom + tubeVessel.heightFromVolume(ml);
const total = (values: ArrayLike<number>) => Array.from(values).reduce((sum, value) => sum + value, 0);
function dryMass(mask: LiquidMask, values: ArrayLike<number>) {
  let mass = 0;
  for (let i = 0; i < mask.data.length; i++) if (!mask.data[i]) mass += Math.abs(values[i]);
  return mass;
}
function volumeCheck(mask: LiquidMask, ml: number) {
  // Active voxel volumes are normalized to the analytic bowl integral.
  expect(Math.abs(total(mask.cellVolumeMl) - ml)).toBeLessThan(1e-9);
  expect(Math.abs(mask.wetVolumeMl - ml)).toBeLessThan(1e-9);
}

describe("wave 15 R1 corrected shared geometry", () => {
  it.each([1, 2.5, 3.5, 4.5, 5])("represents %s mL in a 7 mm bowl", ml => {
    const mask = new LiquidMask(12, 24, 12, radius, bottom, fieldHeight);
    mask.update(up, level(ml));
    volumeCheck(mask, ml);
    // The historic 2.5 mL/55 mm calibration occupied 8.107 mL physically.
    if (ml === 2.5) expect(tubeVessel.volumeFromHeight(0.055) / ml).toBeCloseTo(3.243, 2);
  });

  it("keeps the settled Cu mesh immersed at 2.5 mL", () => {
    const cavity = new THREE.CylinderGeometry(radius, radius, tubeVessel.cavityHeight);
    cavity.translate(0, bottom + tubeVessel.cavityHeight / 2, 0);
    const groups = [createTubeCopperGranules(cavity)];
    for (const group of groups) {
      stepCopperGranuleDrop(group, 1000);
      const mesh = group.children[0] as THREE.Mesh;
      mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox!;
      const top = mesh.position.y + bounds.max.y;
      // 0.5 mm accommodates the irregular sphere and authored bowl clearance.
      expect(top).toBeLessThan(level(2.5) + 0.0005);
      expect(mesh.position.y + bounds.min.y).toBeGreaterThan(bottom - 0.001);
      (mesh.material as THREE.Material).dispose();
      mesh.geometry.dispose();
    }
    cavity.dispose();
  });

  it("keeps Cu(II) and acid in wet cells with conserved reaction amounts", () => {
    const sources = Array.from({ length: 24 }, (_, i) => new THREE.Vector3(
      0.002 * Math.cos(i * Math.PI / 12), bottom + 0.007 + 0.001 * Math.sin(i * Math.PI / 12),
      0.002 * Math.sin(i * Math.PI / 12)));
    const field = new TubeVolumeField("LOW", radius, bottom, fieldHeight, sources);
    field.setSources(sources);
    for (let i = 0; i < 30; i++) field.advance(0.05, 0.3, up, level(2.5));
    volumeCheck(field.mask, 2.5);
    expect(dryMass(field.mask, field.species["Cu2+"].values)).toBeLessThan(1e-10);
    expect(dryMass(field.mask, field.species.HNO3.values)).toBeLessThan(1e-10);
    expect(Math.abs(field.copperII - 1.65 * field.reaction.extent)).toBeLessThan(1e-6);
    expect(Math.abs(field.species.HNO3.total + 4.4 * field.reaction.extent - 4.4)).toBeLessThan(1e-5);
    field.dispose();
  }, 15000);

  it("spawns NO bubbles below the 2.5 mL plane and pops them at it", () => {
    const bubbles = new TubeNOBubbles();
    const sites = [new THREE.Vector3(0, bottom + 0.007, 0)];
    for (let i = 0; i < 80; i++) bubbles.advance(0.05, i === 0 ? 2 : 0, 1, sites,
      up, level(2.5), new THREE.Vector3(), radius);
    expect(bubbles.born).toBeGreaterThan(0);
    expect(bubbles.popped).toBeGreaterThan(0);
    for (let i = 0; i < bubbles.capacity; i++) if (bubbles.state[i]) {
      expect(bubbles.y[i]).toBeLessThan(level(2.5));
      expect(Math.hypot(bubbles.x[i], bubbles.z[i]) + bubbles.size[i]).toBeLessThan(radius);
    }
  });

  it("forms and settles BaSO4 inside the 2.5 to 3.5 mL domain", () => {
    const field = new TubeBariumField("LOW", radius, bottom, fieldHeight);
    const surface = level(3.5), inlet = new THREE.Vector3(radius * 0.7, surface - 0.0007, 0);
    field.advance(0.05, up, surface, inlet, 1 / 26);
    const sourceCells = Array.from(field.productSource).flatMap((amount, i) => amount > 0 ? [i] : []);
    expect(sourceCells.length).toBeGreaterThan(0);
    const nearestSource = Math.min(...sourceCells.map(i => {
      const point = field.mask.point(i % field.mask.nx,
        Math.floor(i / field.mask.nx) % field.mask.ny,
        Math.floor(i / (field.mask.nx * field.mask.ny)));
      return point.distanceTo(inlet);
    }));
    // Initial precipitation must begin within two tube radii of the wet inlet.
    expect(nearestSource).toBeLessThan(2 * radius);
    for (let i = 1; i < 80; i++) field.advance(0.05, up, surface, inlet, Math.min(1, (i + 1) / 26));
    volumeCheck(field.mask, 3.5);
    expect(field.delivered).toBeCloseTo(1, 9);
    expect(field.extent).toBeGreaterThan(0);
    expect(Math.abs(field.species["Ba2+"].total + field.extent - 1.1)).toBeLessThan(1e-5);
    expect(Math.abs(field.species["SO4(2-)"].total + field.extent - field.delivered)).toBeLessThan(1e-5);
    expect(Math.abs(field.totalSolidMass - field.extent)).toBeLessThan(1e-5);
    for (const values of [...Object.values(field.species).map(s => s.values), ...field.suspension,
      field.coarse, field.tracer, field.productSource])
      expect(dryMass(field.mask, values)).toBeLessThan(1e-9);
    expect(field.coarseMass).toBeLessThan(field.totalSolidMass * 0.15);
    field.dispose();
  }, 30000);

  it("maps BaSO4 sediment onto the same hemispherical floor", () => {
    const sediment = new BariumSedimentField(12, 12);
    sediment.deposit(6 * 12 + 6, 0.5);
    const geometry = new BariumSedimentGeometry(radius, bottom);
    geometry.update(sediment);
    const position = geometry.getAttribute("position");
    const half = position.count / 2;
    for (let i = 0; i < half; i++) {
      const r = Math.hypot(position.getX(i), position.getZ(i));
      const floor = bottom + radius - Math.sqrt(radius * radius - r * r);
      // Top stays in the bowl plus the specified 0.12*r film cap; underside is 30 um below it.
      expect(position.getY(i)).toBeGreaterThanOrEqual(floor - 1e-8);
      expect(position.getY(i)).toBeLessThanOrEqual(floor + radius * 0.12 + 1e-8);
      expect(Math.abs(position.getY(half + i) - (floor - 0.00003))).toBeLessThan(1e-7);
    }
    geometry.dispose();
  });

  it("tracks the 2.5, 3.5 and 4.5 mL permanganate stages without dry species", () => {
    const field = new TubePermanganateField("LOW", radius, bottom, tubeVessel.cavityHeight);
    for (const [ml, delivered] of [[2.5, 0], [3.5, 0], [4.5, 2]]) {
      const surface = level(ml), inlet = new THREE.Vector3(radius * 0.7, surface - 0.0007, 0);
      for (let i = 0; i < 20; i++) field.advance(0.05, up, surface, inlet, delivered);
      volumeCheck(field.mask, ml);
      if (delivered === 0) expect(field.extent).toBe(0);
      for (const species of Object.values(field.species))
        expect(dryMass(field.mask, species.values)).toBeLessThan(1e-8);
      expect(dryMass(field.mask, field.tracer)).toBeLessThan(1e-8);
    }
    expect(Math.abs(field.species["MnO4-"].total + 2 * field.extent - 2)).toBeLessThan(1e-5);
    expect(Math.abs(field.species["SO3(2-)"].total + 5 * field.extent - 6)).toBeLessThan(1e-5);
    expect(Math.abs(field.species["H+"].total + 6 * field.extent - 7.2)).toBeLessThan(1e-5);
    expect(Math.abs(field.species["SO4(2-)"].total - 5 * field.extent)).toBeLessThan(1e-5);
    expect(Math.abs(field.species["Mn2+"].total - 2 * field.extent)).toBeLessThan(1e-5);
    field.dispose();
  }, 30000);
});
