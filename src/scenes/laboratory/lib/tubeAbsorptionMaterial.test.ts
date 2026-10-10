import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { cameraInTubeSpace, copperFieldGLSL, copperTextureUVW } from "./tubeAbsorptionMaterial";
import { LiquidMask } from "./tubeVolumeField";

describe("copper volume coordinates", () => {
  it("maps the tube centre to the texture centre and tube height to texture V", () => {
    const radius = 0.007, bottom = 0.0005, height = 0.055;
    const mask = new LiquidMask(5, 9, 5, radius, bottom, height);
    expect(copperTextureUVW(mask.point(2, 4, 2), radius, bottom, height).toArray())
      .toEqual([0.5, 0.5, 0.5]);
    const higher = copperTextureUVW(mask.point(2, 6, 2), radius, bottom, height);
    expect(higher.x).toBe(0.5);
    expect(higher.y).toBeGreaterThan(0.5);
    expect(higher.z).toBe(0.5);
    expect(copperFieldGLSL).toContain("(p - uCuBoundsMin) / uCuBoundsSize");
  });

  it("updates the local ray origin for each rendered camera", () => {
    const tube = new THREE.Group();
    tube.position.set(2, 3, 4);
    tube.rotation.y = 0.4;
    tube.updateWorldMatrix(true, false);
    const camera = new THREE.PerspectiveCamera();
    const inverse = new THREE.Matrix4(), world = new THREE.Vector3(), local = new THREE.Vector3();
    camera.position.copy(tube.localToWorld(new THREE.Vector3(0, 0, 0.3)));
    camera.updateWorldMatrix(true, false);
    cameraInTubeSpace(camera, tube, inverse, world, local);
    expect(local.x).toBeCloseTo(0, 6);
    expect(local.z).toBeCloseTo(0.3, 6);
    camera.position.copy(tube.localToWorld(new THREE.Vector3(0.3, 0, 0)));
    camera.updateWorldMatrix(true, false);
    cameraInTubeSpace(camera, tube, inverse, world, local);
    expect(local.x).toBeCloseTo(0.3, 6);
    expect(local.z).toBeCloseTo(0, 6);
  });
});
