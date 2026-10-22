import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { createGhostMaterial, extractGhostShape, type GhostShape } from "../lib/handGhost";
import { getPreviewItem, type PreviewItemObject } from "../lib/itemPreview/itemObjects";
import { ITEM_PREVIEW_DATA } from "../lib/itemPreview/itemPreviewData";
import { itemFromHeld, itemFromHint } from "../lib/itemPreview/itemFromHint";
import { lookupPreviewData, planPreviews, type TargetCandidate } from "../lib/itemPreview/plan";
import { POSE_CLIPS, applyPoseOffset } from "../lib/itemPreview/poseClips";
import { allTargets, createAnchor, getTarget } from "../lib/itemPreview/targets";
import type { PlannedPreview, PreviewItem, PreviewWhen, TargetAnchor, UsagePreview } from "../lib/itemPreview/types";
import { PREVIEW_VALIDATORS } from "../lib/itemPreview/validators";
import type { PouringItem } from "../lib/pourPose";
import { useHeatingStore } from "../lib/useHeatingStore";
import { useHandStore } from "../lib/useHandStore";
import { standBusy } from "../lib/useStandMotionStore";
import { useStandHintStore } from "../lib/useStandHintStore";

/** Ghosts that can be on screen at once, per kind — enough for «all or the most relevant places», never a swarm. */
const PLACEMENT_SLOTS = 3;
const USAGE_SLOTS = 2;
/** How often the plan (which targets are valid) is re-checked while hovering — never every frame. */
const REPLAN_SECONDS = 0.25;
/** Fade rates (1/s): quick in, quicker out, so a preview never lingers after the cursor has left. */
const FADE_IN_RATE = 14;
const FADE_OUT_RATE = 22;
/** The soft light on a usage target. */
const RING_OPACITY = 0.5;
const RING_GEOMETRY = new THREE.TorusGeometry(0.018, 0.0016, 8, 48);

interface Slot {
  readonly tone: "placement" | "usage";
  readonly group: THREE.Group;
  readonly material: THREE.ShaderMaterial;
  readonly baseOpacity: number;
  /** Reused meshes: only the shape's geometries change, never the objects. */
  readonly meshes: THREE.Mesh[];
  /** The soft light on the target — usage only. */
  readonly ring: THREE.Mesh | null;
  readonly anchor: TargetAnchor;
  plan: PlannedPreview | null;
  fade: number;
}

interface Measured {
  readonly shape: GhostShape;
  readonly item: PouringItem;
}

const measuredCache = new WeakMap<THREE.Object3D, Measured>();
const box = new THREE.Box3();
const size = new THREE.Vector3();
const centre = new THREE.Vector3();
const rootAt = new THREE.Vector3();

/** The item's outline and where its mouth is, measured at rest and kept; null while it has no glass to outline yet. */
function measure({ object, mouthHeight }: PreviewItemObject, atRest: boolean): Measured | null {
  const cached = measuredCache.get(object);
  if (cached) return cached;
  const shape = extractGhostShape(object);
  if (!shape) return null;
  box.setFromObject(object).getSize(size);
  const radius = Math.max(size.x, size.z) / 2;
  let cap: THREE.Object3D | null = null;
  // Taken without being hovered first: its cap is already put aside on the table, so it says nothing of the mouth.
  if (atRest) object.traverse((child) => {
    if (!cap && child.name.startsWith("Cap")) cap = child;
  });
  const mouthOffset = new THREE.Vector3(0, mouthHeight, 0);
  let neckRadius = radius;
  if (cap) {
    // The mouth: under the middle of the cap, at its rim — as `PourMotion` measures it.
    box.setFromObject(cap);
    box.getCenter(centre).setY(box.min.y);
    object.getWorldPosition(rootAt);
    mouthOffset.copy(centre).sub(rootAt);
    neckRadius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  }
  const measured = { shape, item: { mouthOffset, radius, neckRadius } };
  if (atRest) measuredCache.set(object, measured);
  return measured;
}

function createSlot(tone: "placement" | "usage"): Slot {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.visible = false;
  group.renderOrder = 11;
  const material = createGhostMaterial(tone === "usage" ? "use" : "place");
  const baseOpacity = material.uniforms.opacity.value as number;
  let ring: THREE.Mesh | null = null;
  if (tone === "usage") {
    ring = new THREE.Mesh(
      RING_GEOMETRY,
      new THREE.MeshBasicMaterial({
        color: "#34d399",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    ring.renderOrder = 11;
    ring.raycast = () => {};
  }
  return { tone, group, material, baseOpacity, meshes: [], ring, anchor: createAnchor(), plan: null, fade: 0 };
}

/** Puts `shape` into the slot's reusable meshes. */
function applyShape(slot: Slot, shape: GhostShape | null): void {
  const parts = shape ?? [];
  parts.forEach((part, i) => {
    let mesh = slot.meshes[i];
    if (!mesh) {
      mesh = new THREE.Mesh(part.geometry, slot.material);
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 11;
      mesh.raycast = () => {};
      slot.meshes[i] = mesh;
      slot.group.add(mesh);
    }
    mesh.geometry = part.geometry;
    mesh.matrix.copy(part.matrix);
    mesh.visible = true;
  });
  for (let i = parts.length; i < slot.meshes.length; i += 1) slot.meshes[i].visible = false;
}

/**
 * Hover previews (VL-021). Hover a bottle or a tube on the table and, in the
 * scene itself: its outline stands at every place it can be put (blue —
 * placement), and over a tube it can be used on it is shown frozen in the
 * pose of its use-animation (green, the target softly lit — usage). Moving
 * off, hovering another item, taking it into the hand (then `HandGhosts` takes
 * over) or a stand motion all clear it at once.
 *
 * Everything item-specific is data (`ITEM_PREVIEW_DATA`) and everything a
 * target is is registered (`targets.ts`); this component only runs the
 * state machine: no hover → hovered → plan (valid targets) → fade in, and
 * back. Ghosts are a fixed pool of reusable meshes, re-planned a few times a
 * second, never per frame; the one per-frame job is following a target that
 * moves (the clamp).
 */
export function ItemPreviewLayer() {
  const camera = useThree((state) => state.camera);
  const owner = useStandHintStore((state) => state.owner);
  const target = useStandHintStore((state) => state.target);
  const held = useHandStore((state) => state.held);
  // Taken into the hand: usage is shown (where to use it). Hovered: placement (where it can go).
  const item = useMemo<PreviewItem | null>(() => (held ? itemFromHeld(held) : itemFromHint(owner, target)), [held, owner, target]);
  const mode = held ? "held" : "hover";

  const slots = useMemo(
    () => [
      ...Array.from({ length: PLACEMENT_SLOTS }, () => createSlot("placement")),
      ...Array.from({ length: USAGE_SLOTS }, () => createSlot("usage")),
    ],
    [],
  );
  useEffect(
    () => () => {
      for (const slot of slots) {
        slot.material.dispose();
        (slot.ring?.material as THREE.Material | undefined)?.dispose();
      }
    },
    [slots],
  );

  const state = useRef({ mode: "hover" as PreviewWhen, itemId: null as string | null, shapeOf: null as THREE.Object3D | null, replanIn: 0, measured: null as Measured | null });
  const scratch = useMemo(
    () => ({
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      candidates: [] as TargetCandidate[],
    }),
    [],
  );

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const s = state.current;
    // A stand motion or the heating owns the table: no previews over it.
    const live = item !== null && !standBusy() && !useHeatingStore.getState().active;
    const entry = live ? getPreviewItem(item.id) : undefined;

    if (s.mode !== mode) {
      // Taken (or put down): what was shown for the other mode goes, the right one is planned at once.
      s.mode = mode;
      s.replanIn = 0;
      for (const slot of slots) slot.plan = null;
    }
    const id = item?.id ?? null;
    if (id !== s.itemId) {
      // Another item (or none): nothing of the old one may linger.
      for (const slot of slots) {
        slot.plan = null;
        slot.fade = 0;
      }
      s.itemId = id;
      s.shapeOf = null;
      s.measured = null;
      s.replanIn = 0;
    }

    if (live && entry) {
      if (s.shapeOf !== entry.object) {
        s.measured = measure(entry, !held);
        if (s.measured) {
          s.shapeOf = entry.object;
          for (const slot of slots) applyShape(slot, s.measured.shape);
        }
      }
      s.replanIn -= delta;
      if (s.measured && s.replanIn <= 0) {
        s.replanIn = REPLAN_SECONDS;
        replan(item, mode, slots, scratch.candidates, { camera });
      }
    } else {
      for (const slot of slots) slot.plan = null;
      s.replanIn = 0;
    }

    for (const slot of slots) {
      const plan = slot.plan;
      const wanted = plan !== null && live && !!s.measured;
      slot.fade = THREE.MathUtils.clamp(slot.fade + (wanted ? FADE_IN_RATE : -FADE_OUT_RATE) * delta, 0, 1);
      const visible = slot.fade > 0.01;
      slot.group.visible = visible;
      if (slot.ring) slot.ring.visible = visible;
      if (!visible) continue;
      if (!plan || !s.measured) continue;
      const placed = pose(slot, plan, s.measured.item, camera, scratch);
      if (!placed) {
        slot.fade = 0;
        slot.group.visible = false;
        if (slot.ring) slot.ring.visible = false;
        continue;
      }
      slot.material.uniforms.opacity.value = slot.baseOpacity * slot.fade;
      if (slot.ring) {
        (slot.ring.material as THREE.MeshBasicMaterial).opacity = RING_OPACITY * slot.fade;
        slot.ring.visible = (plan.rule as UsagePreview).highlightTarget !== false;
      }
    }
  });

  return (
    <>
      {slots.map((slot) => (
        <group key={slot.group.uuid}>
          <primitive object={slot.group} />
          {slot.ring ? <primitive object={slot.ring} /> : null}
        </group>
      ))}
    </>
  );
}

/** Asks every target for itself, lets the data decide which ones this item wants, hands the plan to the slots. */
function replan(
  item: PreviewItem,
  mode: PreviewWhen,
  slots: readonly Slot[],
  candidates: TargetCandidate[],
  context: { readonly camera: THREE.Camera },
): void {
  const data = lookupPreviewData(ITEM_PREVIEW_DATA, item);
  const planned: PlannedPreview[] = [];
  if (data) {
    candidates.length = 0;
    for (const target of allTargets()) {
      const anchor = createAnchor();
      if (target.resolve(context, anchor)) candidates.push({ target, anchor });
    }
    planned.push(...planPreviews(data, item, candidates, PREVIEW_VALIDATORS, mode));
  }
  for (const tone of ["placement", "usage"] as const) {
    const wanted = planned.filter((plan) => plan.tone === tone);
    const pool = slots.filter((slot) => slot.tone === tone);
    // A ghost already on a target keeps its slot, so a re-plan never makes it jump.
    for (const slot of pool) if (slot.plan && !wanted.some((plan) => same(plan, slot.plan!))) slot.plan = null;
    const free = pool.filter((slot) => !slot.plan);
    for (const plan of wanted) {
      if (pool.some((slot) => slot.plan && same(slot.plan, plan))) continue;
      const slot = free.shift();
      if (slot) slot.plan = plan;
    }
  }
}

const same = (a: PlannedPreview, b: PlannedPreview): boolean => a.targetId === b.targetId && a.rule === b.rule;

/** Puts the slot's ghost where its plan says, from the live target. False — the target is gone. */
function pose(
  slot: Slot,
  plan: PlannedPreview,
  measured: PouringItem,
  camera: THREE.Camera,
  s: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 },
): boolean {
  const target = getTarget(plan.targetId);
  if (!target || !target.resolve({ camera }, slot.anchor)) return false;
  s.quaternion.identity();
  if (plan.tone === "usage") {
    const rule = plan.rule as UsagePreview;
    const clip = POSE_CLIPS[rule.clip];
    // An unknown clip is a typo in data: show nothing rather than a wrong pose.
    if (!clip) return false;
    clip(THREE.MathUtils.clamp(rule.normalizedTime, 0, 1), measured, slot.anchor, s.position, s.quaternion);
    if (slot.ring) slot.ring.position.copy(slot.anchor.point);
  } else {
    s.position.copy(slot.anchor.point);
  }
  const scale = applyPoseOffset(plan.rule.offset, s.position, s.quaternion);
  s.scale.setScalar(scale);
  slot.group.matrix.compose(s.position, s.quaternion, s.scale);
  slot.group.matrixWorldNeedsUpdate = true;
  return true;
}
