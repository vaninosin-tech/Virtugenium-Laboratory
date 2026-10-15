import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { NO_OUTLINE, outlineMeshesOf } from "./NormalHoverOutline";

const mesh = (name: string) => Object.assign(new THREE.Mesh(new THREE.BoxGeometry()), { name });

/** BottleRoot ├ Bottle_Glass ├ Liquid ├ Label ├ Cap (with a rim riding on it) — and copper granules. */
function bottle() {
  const root = new THREE.Group();
  const glass = mesh("Bottle_Glass");
  const cap = mesh("Cap");
  const rim = mesh("Cap");
  rim.userData[NO_OUTLINE] = true;
  cap.add(rim);
  const granules = new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 4);
  root.add(glass, mesh("Liquid"), mesh("LabelSurface"), cap, granules);
  return { root, glass, cap };
}

describe("normal hover outline sources", () => {
  it("a bottle is outlined by its glass and its seated cap only — one silhouette, no liquid, label or rim", () => {
    const { root, glass, cap } = bottle();
    expect(outlineMeshesOf(root, { container: true })).toEqual([glass, cap]);
  });

  it("a cap taken off the bottle is not outlined with it; put back, it is again", () => {
    const { root, glass, cap } = bottle();
    outlineMeshesOf(root, { container: true });
    cap.position.set(0.05, -0.02, 0);
    expect(outlineMeshesOf(root, { container: true })).toEqual([glass]);
    cap.position.set(0, 0, 0);
    expect(outlineMeshesOf(root, { container: true })).toEqual([glass, cap]);
  });

  it("any other model: every mesh of it, but never a rim or instanced granules", () => {
    const root = new THREE.Group();
    const body = mesh("Rack_Body");
    const rail = mesh("Rack_Rail");
    const rim = mesh("Rack_Body");
    rim.userData[NO_OUTLINE] = true;
    root.add(body, rail, rim, new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 2));
    expect(outlineMeshesOf(root)).toEqual([body, rail]);
  });
});
