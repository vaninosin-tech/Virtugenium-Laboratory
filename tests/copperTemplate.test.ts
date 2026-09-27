import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createCopperPile } from "../src/scenes/laboratory/lib/createCopperPile";

describe("reusing copper deposition between reagent copies", () => {
  it("avoids repeated deposition and keeps shaking/disposal independent", () => {
    const cavity = new THREE.CylinderGeometry(0.025, 0.025, 0.08, 16);
    const start = performance.now();
    const shelf = createCopperPile(cavity);
    const coldMs = performance.now() - start;
    const raycast = vi.spyOn(THREE.Raycaster.prototype, "intersectObjects");
    const warmStart = performance.now();
    const tray = createCopperPile(cavity);
    const warmMs = performance.now() - warmStart;
    expect(raycast).not.toHaveBeenCalled();
    raycast.mockRestore();
    console.info(`Copper deposition: ${coldMs.toFixed(1)} ms; reused copy: ${warmMs.toFixed(1)} ms`);

    const shelfBatches = shelf.pile.children as THREE.InstancedMesh[];
    const trayBatches = tray.pile.children as THREE.InstancedMesh[];
    expect(shelfBatches.some(batch => batch.count > 0)).toBe(true);
    const original = shelfBatches.map(batch => batch.instanceMatrix.array.slice());
    shelfBatches.forEach((batch, index) => {
      expect(trayBatches[index].geometry).toBe(batch.geometry);
      expect(trayBatches[index].instanceMatrix.array).not.toBe(batch.instanceMatrix.array);
      expect(trayBatches[index].instanceMatrix.array).toEqual(batch.instanceMatrix.array);
    });
    tray.shake(0.2, 1, 0.4);
    expect(trayBatches.some((batch, index) =>
      batch.instanceMatrix.array.some((value, i) => value !== original[index][i]),
    )).toBe(true);
    shelfBatches.forEach((batch, index) => expect(batch.instanceMatrix.array).toEqual(original[index]));
    tray.shake(0, 0, 0);
    trayBatches.forEach((batch, index) => {
      batch.instanceMatrix.array.forEach((value, i) => expect(value).toBeCloseTo(original[index][i], 6));
    });

    const dispose = vi.fn();
    shelfBatches[0].geometry.addEventListener("dispose", dispose);
    shelf.dispose();
    shelf.dispose();
    expect(dispose).not.toHaveBeenCalled();
    // A copy created after another jar shakes still starts in its rest pose.
    tray.shake(0.2, 1, 0.5);
    const workbench = createCopperPile(cavity);
    (workbench.pile.children as THREE.InstancedMesh[]).forEach((batch, index) => {
      expect(batch.instanceMatrix.array).toEqual(original[index]);
    });
    tray.dispose();
    expect(dispose).not.toHaveBeenCalled();
    workbench.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    cavity.dispose();
  }, 30_000);
});
