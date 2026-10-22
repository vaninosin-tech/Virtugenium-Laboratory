import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  InspectionSlosh,
  inspectionTilt,
  SHAKE_CONTROL_LOCK_DURATION,
  SLOSH_DURATION,
  TILT_DURATION,
} from "../src/scenes/laboratory/lib/inspectionSlosh";
import { installReagentMaterials } from "../src/scenes/laboratory/lib/reagentMaterials";
import { REAGENTS } from "../src/entities/laboratory/reagents";

describe("inspection tilt", () => {
  it("follows the gentle key poses and returns exactly to zero", () => {
    expect([0, 0.4, 0.8, 1.2, 1.6].map((t) => Math.round(inspectionTilt(t) * 180 / Math.PI)))
      .toEqual([0, 6, -6, 3, 0]);
    for (let t = 0; t < TILT_DURATION; t += 0.001) {
      expect(Math.abs(inspectionTilt(t))).toBeLessThanOrEqual(Math.PI / 30 + 1e-9);
    }
    expect(inspectionTilt(10)).toBe(0);
  });

  it("lags bottle motion, continues after the bottle stops, then settles", () => {
    const motion = new InspectionSlosh();
    motion.advance(0.2);
    expect(motion.angle).toBeLessThan(0);
    expect(Math.abs(motion.angle)).toBeLessThan(Math.abs(motion.tilt));
    motion.advance(TILT_DURATION - 0.2);
    expect(motion.tilt).toBe(0);
    expect(Math.abs(motion.angle) + motion.strength).toBeGreaterThan(0.001);
    motion.advance(SLOSH_DURATION - TILT_DURATION);
    expect(motion.done).toBe(true);
    expect(Math.abs(motion.angle * motion.settle)).toBe(0);
    expect(motion.strength * motion.settle).toBe(0);
  });

  it("unlocks controls before the subtle liquid tail finishes", () => {
    const motion = new InspectionSlosh();
    motion.advance(SHAKE_CONTROL_LOCK_DURATION - 0.01);
    expect(motion.controlsUnlocked).toBe(false);
    motion.advance(0.02);
    expect(motion.controlsUnlocked).toBe(true);
    expect(motion.done).toBe(false);
  });

  it("stays stable at 30/60/120fps and after a suspended tab", () => {
    const results = [30, 60, 120].map((fps) => {
      const motion = new InspectionSlosh();
      for (let frame = 0; frame < fps; frame++) motion.advance(1 / fps);
      return motion.angle;
    });
    expect(Math.max(...results) - Math.min(...results)).toBeLessThan(0.002);
    const motion = new InspectionSlosh();
    motion.advance(100);
    expect(motion.done).toBe(true);
    expect(motion.settle).toBe(0);
  });

  it("fades throughout the three-second tail with no abrupt end", () => {
    const motion = new InspectionSlosh();
    motion.advance(TILT_DURATION);
    expect(motion.settle).toBeCloseTo(1);
    let previous = motion.settle;
    for (let i = 0; i < 179; i++) {
      motion.advance(1 / 60);
      expect(motion.settle).toBeLessThanOrEqual(previous);
      expect(previous - motion.settle).toBeLessThan(0.011);
      previous = motion.settle;
    }
    expect(motion.settle).toBeLessThan(0.00001);
    motion.advance(1 / 60 + 1e-8);
    expect(motion.settle).toBe(0);
  });
});

describe("real reagent contents", () => {
  it("uses outward-facing caps so the far liquid surface can be culled", async () => {
    const buffer = readFileSync(new URL("../public/assets/models/ReagentContainers.glb", import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "");
    let checkedCaps = 0;
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.name.startsWith("ContentsVolume")) return;
      const geometry = object.geometry;
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!;
      const positions = geometry.getAttribute("position");
      const index = geometry.index;
      for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
        const vertices = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(
          positions, index ? index.getX(i + offset) : i + offset,
        ));
        const bottom = vertices.every(v => Math.abs(v.y - bounds.min.y) < 1e-6);
        const top = vertices.every(v => Math.abs(v.y - bounds.max.y) < 1e-6);
        if (!bottom && !top) continue;
        const normal = new THREE.Triangle(...vertices as [THREE.Vector3, THREE.Vector3, THREE.Vector3]).getNormal(new THREE.Vector3());
        expect(normal.y * (bottom ? -1 : 1)).toBeGreaterThan(0.99);
        checkedCaps++;
      }
    });
    expect(checkedCaps).toBeGreaterThan(200);
    const root = gltf.scene.getObjectByName("ReagentBottle_Clear_250ml")!.clone(true);
    const binding = installReagentMaterials(root, REAGENTS.nacl);
    expect(binding.liquid!.side).toBe(THREE.FrontSide);
    binding.dispose();
  });
  it("keeps NaCl/HNO3/KMnO4 deformation inside the original cylinder, including full fill", async () => {
    const buffer = readFileSync(new URL("../public/assets/models/ReagentContainers.glb", import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "");
    for (const reagent of [REAGENTS.nacl, REAGENTS.hno3, REAGENTS.kmno4]) {
      const root = gltf.scene.getObjectByName(reagent.containerType === "clear250" ? "ReagentBottle_Clear_250ml" : "ReagentBottle_Amber_250ml")!.clone(true);
      const binding = installReagentMaterials(root, reagent);
      const u = binding.liquid!.uniforms;
      expect(u.uBaseColor.value.getHexString()).toBe(new THREE.Color(reagent.contentsColor).getHexString());
      const size = u.uBoundsSize.value;
      // The shader leaves X/Z fixed. Verify all vertex heights against the
      // full cylindrical cavity for every sample of the actual motion.
      for (const fill of [reagent.fillLevel, 0.05, 0.95, 1]) {
        binding.setFillLevel(fill);
        const motion = new InspectionSlosh();
        for (let i = 0; i < Math.ceil(SLOSH_DURATION * 60); i++) {
          motion.advance(1 / 60);
          for (const yaw of [0, Math.PI / 4, Math.PI / 2]) {
            const sx = THREE.MathUtils.clamp(motion.angle * Math.cos(yaw) * motion.settle / Math.max(fill, 0.05), -0.25, 0.25);
            const sz = THREE.MathUtils.clamp(motion.angle * Math.sin(yaw) * motion.settle / Math.max(fill, 0.05), -0.25, 0.25);
            const amplitude = Math.min(size.x, size.z) * 0.012 * motion.strength * motion.settle;
            const limit = Math.min(size.y * 0.3, Math.abs(sx) * size.x / 2 + Math.abs(sz) * size.z / 2 + amplitude);
            const headroom = size.y * (1 / fill - 1);
            const lower = Math.max(0, limit - headroom);
            expect((size.y + limit - lower) * fill).toBeLessThanOrEqual(size.y + 1e-9);
            expect((size.y - limit - lower) * fill).toBeGreaterThan(0);
          }
        }
      }
      binding.dispose();
    }
    const copper = installReagentMaterials(gltf.scene.getObjectByName("ReagentJar_WideMouth_120ml")!.clone(true), REAGENTS.cu);
    expect(copper.liquid).toBeNull();
    copper.dispose();
  }, 30_000); // parses a real .glb and simulates seconds of sloshing

  it("blocks stacking, take/close during motion, and solids without eligibility", async () => {
    vi.stubGlobal("window", {});
    const { useReagentInspectionStore: store } = await import("../src/scenes/laboratory/lib/useReagentInspectionStore");
    const s = store.getState();
    s.open("cu", [0, 0, 0], [0, 0, 0, 1], 1);
    s.requestShake();
    expect(store.getState().isShaking).toBe(false);
    s.open("nacl", [0, 0, 0], [0, 0, 0, 1], 1);
    s.setCanShake("cu", true);
    expect(store.getState().canShake).toBe(false);
    s.setCanShake("nacl", true);
    s.requestShake();
    const started = store.getState();
    s.requestShake();
    expect(store.getState()).toBe(started);
    s.requestTake(); s.requestClose();
    expect(store.getState().isTaking || store.getState().isClosing).toBe(false);
    s.releaseShakeLock();
    s.requestTake();
    expect(store.getState().isTaking).toBe(true);
    s.finishTake();
    expect(store.getState().canShake).toBe(false);

    // Once the short control lock expires, a new shake may start even while
    // the previous liquid-settling tail is still in progress.
    s.open("nacl", [0, 0, 0], [0, 0, 0, 1], 1);
    s.setCanShake("nacl", true);
    s.requestShake();
    const firstRequestId = store.getState().shakeRequestId;
    s.releaseShakeLock();
    s.requestShake();
    expect(store.getState().shakeRequestId).toBe(firstRequestId + 1);
    expect(store.getState().isShaking).toBe(true);
    vi.unstubAllGlobals();
  });
});
