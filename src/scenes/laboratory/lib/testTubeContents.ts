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
  metalness: 0.92,
  roughness: 0.32,
});

/**
 * How far above its final resting spot a granule starts, in the tube
 * cavity's own local units. Was 0.05 — a THIRD of this tube's whole 0.15
 * cavity height, so a granule's lifted start sat at roughly the tube's own
 * midpoint. Anyone glancing at the tube before a granule's own staggered
 * delay elapsed (the last piece doesn't even start falling until
 * `3 * GRANULE_DROP_STAGGER_MS` in) saw copper sitting in the MIDDLE of the
 * tube, not "about to drop the last few centimeters" — read as "the copper
 * is in the center, not at the bottom" even though the settled position was
 * always correct. Now sized relative to one granule's own radius instead of
 * the tube: a small hop into place, never further up the tube than "just
 * above where it lands."
 */
const GRANULE_DROP_HEIGHT = 0.012;
/** Stagger between one granule starting its fall and the next, ms — lets the stack read as pieces landing one after another (biggest/bottom first, same order they're built in) rather than the whole pile dropping as one rigid block. */
const GRANULE_DROP_STAGGER_MS = 70;
/** How long a single granule's own fall takes once it starts, ms — shorter than before now that it's a much smaller hop, not a long fall. */
const GRANULE_DROP_DURATION_MS = 170;

/** Eased "falling and settling" curve — fast at first, easing hard into the landing instead of a linear drop. */
function easeOutCubic(t: number): number {
  const inverse = 1 - t;
  return 1 - inverse * inverse * inverse;
}

/**
 * A small stack of copper granules inside a test tube's cavity, LARGEST at
 * the bottom, decreasing going up — the player's own explicit call for how
 * Cu should look in a tube. Deliberately NOT `createCopperPile` (the jar's
 * 56-fragment, raycast-settled heap): that algorithm is tuned for a wide,
 * squat jar cavity, and a tube only ever needs a believable handful of
 * pieces in a narrow column, not a physically-settled pile. Geometry is a
 * jittered icosahedron per granule — cheap, and irregular enough not to
 * read as a perfect sphere.
 */
export function createTubeCopperGranules(cavityGeometry: THREE.BufferGeometry): THREE.Group {
  cavityGeometry.computeBoundingBox();
  const bounds = cavityGeometry.boundingBox!;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.min(size.x, size.z) / 2;

  const group = new THREE.Group();
  group.name = "TubeCopperGranules";

  // Largest first — each one sits on top of the last, so the biggest ends
  // up at the bottom of the stack. Also the order they DROP in (see
  // `stepCopperGranuleDrop`) — the bottom piece lands first, each next one
  // staggered slightly after, same as a handful actually settling in.
  const relativeSizes = [0.85, 0.65, 0.5, 0.38];
  let seed = 24601;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let y = bounds.min.y;

  let dropIndex = 0;
  for (const relativeSize of relativeSizes) {
    const unit = radius * 1.15 * relativeSize;
    const geometry = new THREE.IcosahedronGeometry(unit, 0);
    const position = geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const jitter = 1 + (random() - 0.5) * 0.18;
      position.setXYZ(i, position.getX(i) * jitter, position.getY(i) * jitter, position.getZ(i) * jitter);
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, COPPER_GRANULE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const offsetX = (random() - 0.5) * radius * 0.3;
    const offsetZ = (random() - 0.5) * radius * 0.3;
    const targetY = y + unit * 0.75;
    // Starts lifted above its resting spot — `stepCopperGranuleDrop` drops it
    // back down to `targetY` once the fill animation actually begins.
    mesh.position.set(center.x + offsetX, targetY + GRANULE_DROP_HEIGHT, center.z + offsetZ);
    mesh.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    mesh.userData.dropTargetY = targetY;
    mesh.userData.dropDelayMs = dropIndex * GRANULE_DROP_STAGGER_MS;
    group.add(mesh);
    y += unit * 1.15;
    dropIndex += 1;
  }

  return group;
}

/**
 * Advances the falling-in animation for a copper granule stack built by
 * `createTubeCopperGranules` — call every frame with the total elapsed time
 * since the fill started. Each granule waits out its own `dropDelayMs`
 * (staggered so pieces read as landing one after another, biggest/bottom
 * first), then eases down from its lifted start to `dropTargetY` over
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
  /** The copper granule stack just created, if this fill was solid Cu — `null` for every other reagent/contents kind. Callers that want the drop-in animation (`stepCopperGranuleDrop`) drive it themselves per frame using this reference. */
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
          // Copper's material is shared; only per-fill geometry is owned.
        }));
      });
    },
  };
}
