import type { OutlineEffect } from "postprocessing";
import * as THREE from "three";

/**
 * Lets the hover outline be seen through glass. `OutlineEffect` decides
 * what hides a selected object from the depth of every visible mesh, drawn
 * with one opaque material — so a see-through pane (the fume hood's sash, a
 * cabinet door, another bottle) counted as a wall and hid every outline
 * behind it, with `xRay={false}`. A mesh that does not write depth in the
 * normal render (transparent glass, rims, overlays) is not what the eye stops
 * at either: it is left out while the effect builds its mask.
 *
 * Wraps the effect's public `update` (the outline's own passes, after the
 * scene itself has already been drawn), hiding those meshes for just that
 * call. They are looked up when the selection changes — a hover starts or
 * ends — not every frame.
 *
 * @returns undoes the wrap
 */
export function letOutlineSeeThrough(effect: OutlineEffect, scene: THREE.Scene): () => void {
  const update = effect.update;
  let signature = "";
  let seeThrough: THREE.Object3D[] = [];

  effect.update = function (renderer, inputBuffer, deltaTime) {
    const selection = effect.selection;
    if (selection.size === 0) return update.call(this, renderer, inputBuffer, deltaTime);
    let next = "";
    for (const object of selection) next += `${object.id},`;
    if (next !== signature) {
      signature = next;
      seeThrough = [];
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
        const material = object.material as THREE.Material;
        if (material.transparent && !material.depthWrite) seeThrough.push(object);
      });
    }
    const hidden = seeThrough.filter((object) => object.visible && !selection.has(object));
    for (const object of hidden) object.visible = false;
    try {
      update.call(this, renderer, inputBuffer, deltaTime);
    } finally {
      for (const object of hidden) object.visible = true;
    }
  };
  return () => {
    effect.update = update;
  };
}
