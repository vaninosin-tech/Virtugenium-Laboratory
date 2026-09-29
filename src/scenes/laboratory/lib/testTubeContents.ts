import * as THREE from "three";
import { TubeLiquidMaterial } from "./tubeLiquidMaterial";
import { deferDispose } from "./deferredDispose";

import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";

/** Turns a tube's stored reagent ids into their configs, dropping anything unknown, order preserved. */
export function resolveTubeContents(
  contents: readonly string[] | undefined,
): ReagentContainerConfig[] {
  if (!contents) return [];
  const byId = REAGENTS as Record<string, ReagentContainerConfig | undefined>;
  return contents.map((id) => byId[id]).filter((config): config is ReagentContainerConfig => Boolean(config));
}

const COPPER_GRANULE_MATERIAL = new THREE.MeshStandardMaterial({
  name: "TubeCopperGranule",
  color: "#d58b68",
  metalness: 0.62,
  roughness: 0.32,
  transparent: true,
  depthWrite: true,
});

/**
 * How far above its final resting spot a granule starts, in the tube
 * cavity's own local units. Was 0.05 — a THIRD of this tube's whole 0.15
 * cavity height, so a granule's lifted start sat at roughly the tube's own
 * midpoint. Anyone glancing at the tube before its drop began saw copper sitting in the MIDDLE of the
 * tube, not "about to drop the last few centimeters" — read as "the copper
 * is in the center, not at the bottom" even though the settled position was
 * always correct. Now sized relative to one granule's own radius instead of
 * the tube: a small hop into place, never further up the tube than "just
 * above where it lands."
 */
const GRANULE_DROP_HEIGHT = 0.012;
/** How long a single granule's own fall takes once it starts, ms — shorter than before now that it's a much smaller hop, not a long fall. */
const GRANULE_DROP_DURATION_MS = 170;

/** Eased "falling and settling" curve — fast at first, easing hard into the landing instead of a linear drop. */
function easeOutCubic(t: number): number {
  const inverse = 1 - t;
  return 1 - inverse * inverse * inverse;
}

/**
 * One rounded, irregular copper granule inside the tube cavity. Its small
 * drop animation and metallic response remain visible at close range.
 */
export function createTubeCopperGranules(cavityGeometry: THREE.BufferGeometry): THREE.Group {
  cavityGeometry.computeBoundingBox();
  const bounds = cavityGeometry.boundingBox!;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.min(size.x, size.z) / 2;

  const group = new THREE.Group();
  group.name = "TubeCopperGranules";

  const unit = radius * 0.78;
  const geometry = new THREE.SphereGeometry(unit, 20, 14);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), yPos = position.getY(i), z = position.getZ(i);
    const jitter = 1 + 0.10 * Math.sin(x / unit * 5 + z / unit * 3)
      * Math.cos(yPos / unit * 4 - x / unit * 2);
    position.setXYZ(i, x * jitter, yPos * jitter * 0.78, z * jitter);
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, COPPER_GRANULE_MATERIAL.clone());
  // Draw submerged solids after the refractive transmission passes. Those
  // passes sample the opaque scene and otherwise paint dark background bands
  // over both copper and white precipitate.
  mesh.renderOrder = 1;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const targetY = bounds.min.y + unit * 1.1;
  // Starts lifted above its resting spot — `stepCopperGranuleDrop` drops it
  // back down to `targetY` once the fill animation actually begins.
  mesh.position.set(center.x, targetY + GRANULE_DROP_HEIGHT, center.z);
  mesh.rotation.set(0.4, 1.1, 0.25);
  mesh.userData.dropTargetY = targetY;
  mesh.userData.dropDelayMs = 0;
  group.add(mesh);

  return group;
}

/**
 * Advances the falling-in animation for the copper granule built by
 * `createTubeCopperGranules` — call every frame with the total elapsed time
 * since the fill started. It eases down from its lifted start to `dropTargetY` over
 * `GRANULE_DROP_DURATION_MS`. Returns `true` while any granule is still
 * mid-drop (keep calling), `false` once every granule has settled (safe to
 * stop).
 */
export function stepCopperGranuleDrop(granules: THREE.Group, elapsedMs: number): boolean {
  let stillAnimating = false;
  for (const child of granules.children) {
    const targetY = child.userData.dropTargetY;
    if (typeof targetY !== "number") continue;
    const delayMs: number = typeof child.userData.dropDelayMs === "number" ? child.userData.dropDelayMs : 0;
    const localElapsed = elapsedMs - delayMs;
    if (localElapsed <= 0) {
      stillAnimating = true;
      continue;
    }
    const t = THREE.MathUtils.clamp(localElapsed / GRANULE_DROP_DURATION_MS, 0, 1);
    child.position.y = THREE.MathUtils.lerp(targetY + GRANULE_DROP_HEIGHT, targetY, easeOutCubic(t));
    if (t < 1) stillAnimating = true;
  }
  return stillAnimating;
}

const hsl = { h: 0, s: 0, l: 0 };
/** How much a liquid tints the tube: saturation weighted by opacity. */
function colourStrength(config: ReagentContainerConfig): number {
  new THREE.Color(config.contentsColor).getHSL(hsl);
  return hsl.s * (config.contentsOpacity ?? 1);
}

export interface TestTubeContentsBinding {
  dispose: () => void;
  /** The copper granule just created, if this fill was solid Cu — `null` for every other reagent/contents kind. Callers that want the drop-in animation (`stepCopperGranuleDrop`) drive it themselves per frame using this reference. */
  readonly granules: THREE.Group | null;
}

/**
 * Fills a test tube's `ContentsVolume` mesh from everything currently in the
 * tube, reusing each reagent's own `ReagentContainerConfig` (the SAME config
 * a jar on the shelf uses) — a much smaller version of
 * `installReagentMaterials` (jars): no slosh/fill-level shader uniforms, no
 * glass-material handling (the tube's own `Tube_Glass` material from
 * `prepareTestTube` is untouched here, matched by name, not by this
 * function).
 *
 * Callers rebuild the binding whenever the contents change — pouring acid
 * onto copper has to redraw the tube, so this is no longer a fill-once
 * operation.
 */
export function fillTestTubeContents(
  root: THREE.Object3D,
  configs: readonly ReagentContainerConfig[],
): TestTubeContentsBinding {
  const ownedMaterials: THREE.Material[] = [];
  const addedObjects: THREE.Object3D[] = [];
  let copperGranules: THREE.Group | null = null;

  // A tube can hold a solid AND a liquid at once (copper with acid poured
  // onto it), so these are two independent decisions rather than one
  // either/or on a single reagent: the granules are added, and the shared
  // `ContentsVolume` mesh shows whichever liquid went in last.
  const copper = configs.find((config) => config.id === "cu" && config.contentsKind === "solid");
  const otherSolid = configs.find(
    (config) => config.contentsKind === "solid" && config.id !== "cu",
  );
  // One volume mesh, one colour: show the most strongly coloured liquid, not
  // the last one poured. Colourless acid added to permanganate must leave the
  // tube violet — "last wins" turned it clear. Ties (all colourless) still
  // fall to the last poured.
  const liquids = configs.filter((config) => config.contentsKind !== "solid");
  const liquid = liquids.reduce<ReagentContainerConfig | undefined>(
    (best, candidate) => (!best || colourStrength(candidate) >= colourStrength(best) ? candidate : best),
    undefined,
  );

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.name.startsWith("ContentsVolume")) return;

    if (copper) {
      const granules = createTubeCopperGranules(object.geometry);
      granules.position.copy(object.position);
      granules.quaternion.copy(object.quaternion);
      granules.scale.copy(object.scale);
      object.parent?.add(granules);
      addedObjects.push(granules);
      copperGranules = granules;
    }

    if (liquid) {
      const material = new TubeLiquidMaterial(object.geometry, {
        color: liquid.contentsColor,
        opacity: liquid.contentsOpacity,
      });
      object.material = material;
      object.visible = true;
      ownedMaterials.push(material);
      return;
    }

    if (otherSolid) {
      const material = new THREE.MeshStandardMaterial({
        name: "TubeSolidContents",
        color: otherSolid.contentsColor,
        roughness: 0.5,
        metalness: 0.4,
      });
      object.material = material;
      object.visible = true;
      ownedMaterials.push(material);
      return;
    }

    // Copper alone, or an empty tube: the shared volume mesh would read as a
    // solid plug of colour, so it stays hidden and the granules speak for it.
    object.visible = false;
  });

  let disposed = false;
  return {
    granules: copperGranules,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      ownedMaterials.forEach((material) => deferDispose(material, () => material.dispose()));
      addedObjects.forEach((object) => {
        object.parent?.remove(object);
        deferDispose(object, () => object.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          child.geometry.dispose();
          child.material.dispose();
        }));
      });
    },
  };
}
