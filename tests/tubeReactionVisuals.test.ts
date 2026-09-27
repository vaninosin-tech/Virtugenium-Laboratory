import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createTubeReactionVisuals } from "../src/scenes/laboratory/lib/tubeReactionVisuals";
import { LiquidMaterial } from "../src/scenes/laboratory/lib/reagentMaterials";
import type { ReactionKind } from "../src/scenes/laboratory/lib/tubeReactions";

function fixture(kind: ReactionKind | null) {
  const root = new THREE.Group();
  const geometry = new THREE.CylinderGeometry(0.007, 0.007, 0.055, 16);
  geometry.translate(0, 0.028, 0);
  const baseline = new THREE.MeshPhysicalMaterial({ color: "#ffffff", opacity: 0.3 });
  const volume = new THREE.Mesh(geometry, baseline);
  volume.name = "ContentsVolume";
  const shellGeometry = new THREE.CylinderGeometry(0.0098, 0.0098, 0.15, 16);
  shellGeometry.translate(0, 0.075, 0);
  const shell = new THREE.Mesh(shellGeometry, new THREE.MeshBasicMaterial());
  shell.name = "Tube_Glass";
  root.add(volume, shell);
  const visuals = createTubeReactionVisuals(root, kind)!;
  const get = (name: string) => root.getObjectByName(name) as THREE.Mesh;
  const cleanup = () => {
    visuals.dispose(); geometry.dispose(); shellGeometry.dispose(); baseline.dispose(); shell.material.dispose();
  };
  return { root, volume, baseline, visuals, get, cleanup };
}

describe("tube reaction rendering contract", () => {
  it.each<ReactionKind>(["copper-nitric", "silver-chloride", "barium-sulfate", "permanganate-redox"])(
    "%s supports instant completion and reverse seeking without allocating new resources", (kind) => {
      const f = fixture(kind);
      f.visuals.update(0, 0, "HIGH", Infinity);
      expect(f.volume.material).toBe(f.baseline);
      const pools = f.root.getObjectByName("TubeReactionVisuals")!.children.map((o) => (o as THREE.Mesh).geometry);
      f.visuals.update(1, 0, "LOW", Infinity);
      const liquid = f.volume.material as LiquidMaterial;
      expect(liquid).toBeInstanceOf(LiquidMaterial);
      f.visuals.update(0.5, 1, "ULTRA", Infinity);
      expect(f.volume.material).toBe(liquid);
      expect(f.root.getObjectByName("TubeReactionVisuals")!.children.map((o) => (o as THREE.Mesh).geometry)).toEqual(pools);
      f.visuals.update(0, 2, "HIGH", Infinity);
      expect(f.volume.material).toBe(f.baseline);
      for (const object of f.root.getObjectByName("TubeReactionVisuals")!.children) expect(object.visible).toBe(false);
      f.cleanup();
    },
  );

  it("keeps brown gas outside the mouth, including LOW", () => {
    const f = fixture("copper-nitric");
    f.visuals.update(0.5, 1, "LOW", Infinity);
    const gas = f.get("TubeNO2") as THREE.InstancedMesh;
    expect(gas.visible).toBe(true);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < gas.count; i++) {
      gas.getMatrixAt(i, matrix);
      expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeGreaterThan(0.15);
    }
    expect(f.get("TubeNOBubbles").visible).toBe(true);
    expect(f.get("TubeSediment").visible).toBe(false);
    f.cleanup();
  });

  it("retains distinct sediment layers at LOW and never adds gas to ionic reactions", () => {
    const silver = fixture("silver-chloride");
    const barium = fixture("barium-sulfate");
    for (const f of [silver, barium]) {
      f.visuals.update(1, 0, "LOW", Infinity);
      expect(f.get("TubeSediment").visible).toBe(true);
      expect(f.get("TubePrecipitate").visible).toBe(true);
      expect(f.get("TubeNO2").visible).toBe(false);
      expect(f.get("TubeNOBubbles").visible).toBe(false);
    }
    const height = (f: ReturnType<typeof fixture>) => {
      const pool = f.get("TubePrecipitate") as THREE.InstancedMesh;
      pool.geometry.computeBoundingBox();
      const box = new THREE.Box3();
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < pool.count; i++) {
        pool.getMatrixAt(i, matrix);
        box.union(pool.geometry.boundingBox!.clone().applyMatrix4(matrix));
      }
      return box.max.y;
    };
    expect(height(silver)).toBeGreaterThan(0.055 * 0.2);
    expect(height(silver)).toBeLessThan(0.055 * 0.28);
    expect(height(silver)).toBeGreaterThan(height(barium) * 3);
    expect((silver.get("TubePrecipitate").material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(1);
    expect((silver.get("TubePrecipitate").material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0);
    silver.cleanup(); barium.cleanup();
  });

  it("decolorizes permanganate without gas or sediment", () => {
    const f = fixture("permanganate-redox");
    f.visuals.update(1, 0, "HIGH", Infinity);
    const liquid = f.volume.material as LiquidMaterial;
    expect(liquid.uniforms.uReactionColor.value.getHexString()).toBe("ffffff");
    expect(liquid.uniforms.uOpacity.value).toBeCloseTo(0.14);
    for (const o of f.root.getObjectByName("TubeReactionVisuals")!.children) expect(o.visible).toBe(false);
    f.cleanup();
  });

  it("preserves the physical response at the start of permanganate reduction", () => {
    const f = fixture("permanganate-redox");
    f.visuals.update(0.0001, 0, "HIGH", Infinity);
    const liquid = f.volume.material as LiquidMaterial;
    expect(liquid.side).toBe(f.baseline.side);
    expect(liquid.depthWrite).toBe(f.baseline.depthWrite);
    expect(liquid.roughness).toBe(f.baseline.roughness);
    expect(liquid.ior).toBe(f.baseline.ior);
    expect(liquid.uniforms.uOpacity.value).toBeCloseTo(f.baseline.opacity, 3);
    f.cleanup();
  });

  it("leaves unrecognized contents unchanged; splash expires after one second", () => {
    const f = fixture(null);
    f.visuals.update(1, 0, "HIGH", 0.5);
    expect(f.volume.material).toBe(f.baseline);
    expect(f.get("TubeSplash").visible).toBe(true);
    f.visuals.update(1, 0, "HIGH", 1);
    expect(f.get("TubeSplash").visible).toBe(false);
    const dispose = vi.spyOn(f.volume.geometry, "dispose");
    f.visuals.dispose();
    expect(dispose).not.toHaveBeenCalled();
    expect(f.root.getObjectByName("TubeReactionVisuals")).toBeUndefined();
    dispose.mockRestore();
    f.cleanup();
  });
});
