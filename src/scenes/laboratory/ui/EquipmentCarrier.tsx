import { useFrame } from "@react-three/fiber";
import { useRef, type ReactNode } from "react";
import * as THREE from "three";

import { EQUIPMENT_PLACED } from "../lib/equipmentPlacement";
import { HAND, useHandStore } from "../lib/useHandStore";
import type { TubeLocation } from "../lib/useTestTubeStorageStore";

/** How high the carried stand or lamp is lifted over the worktop — clear of it, its shadow right under it. */
const CARRY_LIFT = 0.03;
/** How closely it follows the hand (1/s, exponential) — smooths the mouse's jerks. */
const FOLLOW_RATE = 20;
/** How fast it glides back to where it was lifted from, when put back (1/s). */
const HOME_RATE = 12;
/** Seconds after being set down in a new place in which it simply stays there (its place has already moved). */
const PLACED_WINDOW_MS = 300;

const tmp = { target: new THREE.Vector3(), local: new THREE.Vector3(), world: new THREE.Vector3() };

/**
 * Lets the stand or the lamp be carried (VL-018): wrap it at its place — this
 * group's origin is where it stands. While `what` at `location` is the item in
 * the hand it follows the hand over the worktop, a little lifted; put back,
 * it glides home; set down somewhere new, its place has moved already
 * (`useEquipmentPlacementStore`) and it just stays.
 *
 * @param radius half its width — how far it is kept off other things on the worktop
 */
export function EquipmentCarrier({
  what,
  location,
  radius,
  children,
}: {
  readonly what: "stand" | "lamp";
  readonly location: TubeLocation;
  readonly radius: number;
  readonly children: ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const motion = useRef({ wasHeld: false, cur: new THREE.Vector3() });
  const held = useHandStore((state) => state.held?.kind === "equipment" && state.held.what === what && state.held.location === location);

  useFrame((_, rawDelta) => {
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;
    const delta = Math.min(rawDelta, 0.1);
    const m = motion.current;
    parent.updateWorldMatrix(true, false);
    // Where it stands: the origin of the group it is wrapped in.
    const home = parent.getWorldPosition(tmp.world);

    if (held) {
      HAND.home.copy(home);
      HAND.homeValid = true;
      HAND.radius = radius;
      if (!m.wasHeld) m.cur.copy(home);
      m.wasHeld = true;
      tmp.target.copy(HAND.valid ? HAND.point : home);
      tmp.target.y = home.y + CARRY_LIFT;
      m.cur.lerp(tmp.target, 1 - Math.exp(-FOLLOW_RATE * delta));
      HAND.itemPos.copy(m.cur);
      HAND.itemPosValid = true;
      group.position.copy(parent.worldToLocal(tmp.local.copy(m.cur)));
      return;
    }
    if (!m.wasHeld && group.position.lengthSq() === 0) return;
    if (m.wasHeld) {
      m.wasHeld = false;
      // Set down in a new place: it is standing there already.
      if (Date.now() - EQUIPMENT_PLACED.at < PLACED_WINDOW_MS) {
        group.position.set(0, 0, 0);
        return;
      }
    }
    // Put back: glide to where it stood.
    group.position.multiplyScalar(Math.exp(-HOME_RATE * delta));
    if (group.position.lengthSq() < 1e-8) group.position.set(0, 0, 0);
  });

  return <group ref={groupRef}>{children}</group>;
}
