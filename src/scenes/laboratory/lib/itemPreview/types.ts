import type * as THREE from "three";

/**
 * Hover previews (VL-021): hovering a thing on the table shows, in the world
 * itself, WHERE it can be put (placement ghosts) and WHERE it can be used
 * (the item frozen in the pose of its use-animation). Everything an item
 * needs is DATA — an `ItemPreviewData` in `itemPreviewData.ts`; targets are
 * `InteractionTarget`s that know their own tags. No item is named in code.
 */

type Vec3 = readonly [number, number, number];

/** How the preview deviates from the pose the target / clip gives it. */
export interface PoseOffset {
  /** World metres, added to the item's origin. */
  readonly position?: Vec3;
  /** Euler XYZ in degrees, applied in the item's own frame after the clip's pose. */
  readonly rotationDeg?: Vec3;
  readonly scale?: number;
}

/** When a preview shows: while the item is hovered, or while it is held in the hand. */
export type PreviewWhen = "hover" | "held";

interface RuleBase {
  readonly enabled: boolean;
  /**
   * Placement defaults to `hover` («where can it go?» — asked by looking at
   * it), usage to `held` («where do I use it?» — asked once it is taken).
   */
  readonly when?: PreviewWhen;
  /** A target is valid when it has ANY of these tags (`InteractionTarget.tags`). */
  readonly targetTags: readonly string[];
  /** Only targets standing where the item stands (workbench / fume hood). */
  readonly sameLocation?: boolean;
  /** Name of a `PreviewValidator` that must also agree (e.g. «the click would not be refused»). */
  readonly validator?: string;
  readonly offset?: PoseOffset;
}

/** «Put it here»: the item's outline at rest at the target. */
export interface PlacementPreview extends RuleBase {
  /** At most this many ghosts from this rule (the most relevant first). Default 1. */
  readonly maxGhosts?: number;
}

/** «Use it here»: the item frozen at `normalizedTime` of the pose clip `clip`. */
export interface UsagePreview extends RuleBase {
  /** Name of a pose clip (`poseClips.ts`) — procedural: the project's animations are code, not GLTF clips. */
  readonly clip: string;
  /** Which instant of the animation to show, 0..1. Never plays. */
  readonly normalizedTime: number;
  /** Lights the target softly. Default true. */
  readonly highlightTarget?: boolean;
}

export interface ItemPreviewData {
  /** Several rules — several kinds of target, each with its own frame (the hammer: nail 0.65, board 0.70). */
  readonly placement: readonly PlacementPreview[];
  readonly usage: readonly UsagePreview[];
}

export type PreviewLocation = "workbench" | "fumeHood";

/** What is under the cursor, as far as previews care. */
export interface PreviewItem {
  /** Instance id — the key of its object in `itemObjects`. */
  readonly id: string;
  /** Data key: `bottle`, `tube`… */
  readonly key: string;
  /** `key:variant` is tried before `key`, so one reagent can have its own frame. */
  readonly variant?: string;
  readonly location: PreviewLocation | null;
  /** What a click on it does at the stand, for validators. */
  readonly standTarget?: unknown;
}

export type TargetKind = "placement" | "usage" | "both";

/** A target resolved in the world right now. All vectors are owned by the caller and rewritten per resolve. */
export interface TargetAnchor {
  /**
   * Placement: where the item's ORIGIN (its base) goes. Usage: the target
   * point the item works on (a tube's mouth).
   */
  readonly point: THREE.Vector3;
  /** Horizontal unit vector: the side an item approaches from. */
  readonly side: THREE.Vector3;
  /** Horizontal unit vector, `up × side` — the axis an item tips about. */
  readonly axis: THREE.Vector3;
  location: PreviewLocation | null;
}

export interface ResolveContext {
  readonly camera: THREE.Camera;
}

/** Something an item can be put on or used on. Registered once; asks the live scene when resolved. */
export interface InteractionTarget {
  readonly id: string;
  readonly kind: TargetKind;
  readonly tags: readonly string[];
  /** Fills `out` and returns true, or returns false while the target does not exist / is occupied / is hidden. */
  readonly resolve: (context: ResolveContext, out: TargetAnchor) => boolean;
}

/** One preview to show: a rule matched to a target. */
export interface PlannedPreview {
  readonly tone: "placement" | "usage";
  readonly targetId: string;
  readonly rule: PlacementPreview | UsagePreview;
}

export type PreviewValidator = (item: PreviewItem, anchor: TargetAnchor) => boolean;
