import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { configureSilverStream, isStageOneSilverPour, shouldDrawStream, silverStreamEnd, streamGeometry, streamMaterial } from "../../../src/scenes/laboratory/ui/PourStream";

describe("stage-one silver stream", () => {
  it("reaches through the liquid surface instead of stopping 26 mm below the mouth", () => {
    const root = new THREE.Matrix4().makeTranslation(0, 0.2, 0);
    const mouth = new THREE.Vector3(0, 0.35, 0);
    const end = silverStreamEnd(mouth, root, 2.5);
    expect(end.y).toBeCloseTo(0.251, 3);
    expect(end.y).toBeLessThan(mouth.y - 0.026);
    expect(shouldDrawStream(1, 0.12, true)).toBe(true);
    expect(shouldDrawStream(1, 0.12, false)).toBe(false);
  });

  it("draws the silver stream after the dense field, liquid and glass without depth occlusion", () => {
    const geometry = streamGeometry();
    const material = streamMaterial(false);
    const mesh = new THREE.Mesh(geometry, material);
    configureSilverStream(mesh, material, true);
    expect(mesh.visible).toBe(true);
    expect(mesh.renderOrder).toBeGreaterThan(-0.25);
    expect(mesh.renderOrder).toBeGreaterThan(0);
    expect(material.transparent).toBe(true);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(material.uniforms.uSilver.value).toBe(1);
    geometry.dispose(); material.dispose();
  });

  it("retains the original draw state for all other experiments", () => {
    expect(isStageOneSilverPour(1, "nacl", ["agno3"])).toBe(true);
    expect(isStageOneSilverPour(1, "agno3", ["nacl"])).toBe(true);
    expect(isStageOneSilverPour(2, "nacl", ["agno3"])).toBe(false);
    for (const [reagent, contents] of [["hno3", ["cu"]], ["k2so4", ["bacl2"]],
      ["h2so4", ["na2so3"]], ["kmno4", ["h2so4"]]] as const) {
      expect(isStageOneSilverPour(1, reagent, contents)).toBe(false);
    }
    for (const dyed of [false, true]) {
      const geometry = streamGeometry();
      const material = streamMaterial(dyed);
      const mesh = new THREE.Mesh(geometry, material);
      configureSilverStream(mesh, material, false);
      expect(mesh.renderOrder).toBe(0);
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.uniforms.uSilver.value).toBe(0);
      expect(material.uniforms.uColor.value.getHexString()).toBe(dyed ? "bb347f" : "6d9eaa");
      geometry.dispose(); material.dispose();
    }
  });
});
