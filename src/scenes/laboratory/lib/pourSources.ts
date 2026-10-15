import * as THREE from "three";

import type { PourGeometry } from "./pourPose";
import type { TubeLocation } from "./useTestTubeStorageStore";

/**
 * The bottles a tube held in the hand can be brought to, to be poured into
 * where it is held (the reverse of carrying the bottle to the clamped tube).
 * Each bottle standing on the bench or in the hood registers itself
 * (`PourMotion` with `pourSource`); `HandController` picks the one the held
 * tube is at, every frame (`JAR_AIM`).
 */
export interface PourSource {
  readonly instanceId: string;
  readonly reagentId: string;
  readonly location: TubeLocation;
  /** The bottle's own origin — its outline's shape is taken from it (`HandGhosts`). */
  readonly root: THREE.Object3D;
  /** Its pour measurements, taken at rest; null while it is away from its place. */
  readonly geometry: () => PourGeometry | null;
}

const SOURCES = new Map<string, PourSource>();

export function registerPourSource(source: PourSource): () => void {
  SOURCES.set(source.instanceId, source);
  return () => {
    if (SOURCES.get(source.instanceId) === source) SOURCES.delete(source.instanceId);
  };
}

/** How near (m, horizontally, beyond the bottle's own half-width) a held tube's mouth must come to a bottle. */
export const JAR_REACH = 0.06;

/** The bottle the held tube is at now — set by `HandController` every frame; null — none. */
export const JAR_AIM = { source: null as PourSource | null };

const at = new THREE.Vector3();

/** The nearest bottle at `location` whose side the held tube's `mouth` is at, or null. */
export function jarAt(location: TubeLocation, mouth: THREE.Vector3): PourSource | null {
  let best: PourSource | null = null;
  let bestDistance = Infinity;
  for (const source of SOURCES.values()) {
    if (source.location !== location) continue;
    const geometry = source.geometry();
    if (!geometry) continue;
    source.root.getWorldPosition(at);
    const distance = Math.hypot(mouth.x - at.x, mouth.z - at.z);
    if (distance > geometry.radius + JAR_REACH || distance >= bestDistance) continue;
    best = source;
    bestDistance = distance;
  }
  return best;
}
