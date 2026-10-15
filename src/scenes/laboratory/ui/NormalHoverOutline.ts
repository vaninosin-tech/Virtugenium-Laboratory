import { selectionContext } from "@react-three/postprocessing";
import { useContext, useEffect } from "react";
import * as THREE from "three";

/**
 * The ordinary hover cue: a blue outline round the object's visible
 * silhouette, drawn by the one `Outline` pass `Laboratory.tsx` runs for the
 * furniture too (`<Select>` round the workbench, the cabinets, the hood).
 * It is fed through that pass's public selection (`selectionContext`), the
 * same one `<Select>` uses.
 *
 * How that pass builds its mask (postprocessing `OutlineEffect`): the depth
 * of everything NOT selected is drawn first — every visible mesh, whatever
 * its material's opacity — and a selected pixel behind it counts as hidden;
 * with `xRay={false}` no outline is drawn along a hidden part. So:
 * - an object's own parts must all be selected, or the unselected ones hide
 *   the rest (glass behind a label, a body behind its cap);
 * - nothing invisible may stay in the scene as a drawn mesh: an invisible
 *   hitbox is `material.visible = false` (never drawn — still raycast), not
 *   a transparent zero-opacity mesh, which writes depth and hides whatever
 *   it surrounds.
 *
 * Only knows WHETHER the object is hovered — how it was found (R3F pointer
 * events at the table, the crosshair raycast in the overview) is the
 * caller's business, and so is a drag highlight (`dragHighlightStyle`),
 * which wins: the caller passes `active` false while one is lit.
 *
 * The outline is drawn from the object's outline source: its visual model
 * by default, or a dedicated proxy (`source`) where the model gives a wrong
 * mask. A proxy is a plain mesh off every camera layer (`layers.disableAll()`),
 * so it is never drawn, never casts a shadow and is never raycast; the pass
 * puts it on its own layer only while it is selected. The source's meshes are
 * gathered when the hover starts (a wrapper's contents may have changed since
 * mount); nothing here runs per frame.
 */

/** Marks a visual-only helper mesh (a rim) that must never be part of an outline. */
export const NO_OUTLINE = "noOutline";

const CONTAINER_GLASS = /^(Bottle_Glass|Jar_Glass)\d*$/;
const CONTAINER_CAP = /^Cap\d*$/;

/** Where each bottle's cap sits on it — taken on mount, while the cap surely is on it. */
const CAP_SEATS = new WeakMap<THREE.Object3D, THREE.Vector3>();

function rememberCapSeats(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && CONTAINER_CAP.test(object.name) && !CAP_SEATS.has(object)) {
      CAP_SEATS.set(object, object.position.clone());
    }
  });
}

/** The meshes that make `source`'s outline right now (a bottle's cap only while on it). */
export function outlineMeshesOf(
  source: THREE.Object3D,
  { container = false, parts }: { readonly container?: boolean; readonly parts?: RegExp } = {},
): THREE.Object3D[] {
  if (container) rememberCapSeats(source);
  const meshes: THREE.Object3D[] = [];
  source.traverse((object) => {
    // Per-instance granules (`InstancedMesh`) lie inside the glass anyway.
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object.userData[NO_OUTLINE]) return;
    if (!container) {
      if (!parts || parts.test(object.name)) meshes.push(object);
      return;
    }
    // A bottle's outside: its glass body and neck (the label lies within it), and its
    // cap while it is on the bottle — not the liquid or contents inside.
    if (CONTAINER_GLASS.test(object.name)) meshes.push(object);
    else if (CONTAINER_CAP.test(object.name) && object.position.distanceToSquared(CAP_SEATS.get(object)!) < 1e-8) meshes.push(object);
  });
  return meshes;
}

export interface NormalHoverOutlineOptions {
  /** Hovered, and no drag highlight lit on it. */
  readonly active: boolean;
  /** The object's visual model. */
  readonly root: THREE.Object3D | null;
  /** What the outline is drawn from instead of `root` — a dedicated proxy (see the module doc). */
  readonly source?: THREE.Object3D | null;
  /** A reagent bottle or jar: its glass, and its cap while the cap is on it. */
  readonly container?: boolean;
  /** Only the meshes so named — the outside of the object, not what it holds or gives off. */
  readonly parts?: RegExp;
}

/** Outlines the object while `active`. */
export function useNormalHoverOutline({ active, root, source, container = false, parts }: NormalHoverOutlineOptions): void {
  const select = useContext(selectionContext)?.select;
  const from = source ?? root;
  useEffect(() => {
    if (from && container) rememberCapSeats(from);
  }, [from, container]);
  useEffect(() => {
    if (!select || !from || !active) return;
    const claimed = outlineMeshesOf(from, { container, parts });
    if (claimed.length === 0) return;
    select((prev) => {
      const present = new Set(prev);
      const added = claimed.filter((object) => !present.has(object));
      return added.length ? [...prev, ...added] : prev;
    });
    // Unhovered, unmounted, or a new source: exactly what was added goes.
    return () => {
      const mine = new Set(claimed);
      select((prev) => {
        const next = prev.filter((object) => !mine.has(object));
        return next.length === prev.length ? prev : next;
      });
    };
  }, [select, from, active, container, parts]);
}

/** A test tube's outside: its glass — the liquid, foam and gas in or over it lie within it or are not the tube. */
export const TUBE_OUTLINE_PARTS = /^Tube_Glass\d*$/;
