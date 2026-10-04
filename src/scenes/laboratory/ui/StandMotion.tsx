import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";

import type { Position3 } from "../lib/layout";
import {
  CLAMP_TUBE_MOUTH,
  POUR_MS,
  TUBE_FLIGHT_MS,
  useStandMotionStore,
  type TubeArrival,
} from "../lib/useStandMotionStore";

/** How high a flying tube arcs over whatever stands between rack and clamp. */
const ARC_LIFT = 0.07;
const UP = new THREE.Vector3(0, 1, 0);

const smooth = (t: number) => THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(t, 0, 1), 0, 1);

/**
 * Plays a tube's flight into the place it was just put — the clamp, or its
 * rack slot — from where it was (`arrival.world`), along an arc. Wrap the
 * tube in it at its RESTING place: this group's own origin is where it lands.
 * Runs off the clock, so it plays correctly even if it mounts a frame late.
 */
export function ArrivalFlight({ arrival, children }: { readonly arrival: TubeArrival | null; readonly children: ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  const from = useRef<{ at: number; local: THREE.Vector3; up: THREE.Vector3 } | null>(null);

  useFrame(() => {
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;
    const elapsed = arrival ? Date.now() - arrival.at : Infinity;
    if (!arrival || elapsed >= TUBE_FLIGHT_MS) {
      if (from.current) {
        group.position.set(0, 0, 0);
        from.current = null;
      }
      return;
    }
    if (from.current?.at !== arrival.at) {
      parent.updateWorldMatrix(true, false);
      const local = parent.worldToLocal(new THREE.Vector3(...arrival.world));
      // World up, in the parent's frame (it may be turned or scaled).
      const origin = parent.worldToLocal(new THREE.Vector3());
      const up = parent.worldToLocal(UP.clone()).sub(origin);
      from.current = { at: arrival.at, local, up };
    }
    const t = smooth(elapsed / TUBE_FLIGHT_MS);
    group.position.copy(from.current.local).multiplyScalar(1 - t);
    group.position.addScaledVector(from.current.up, ARC_LIFT * Math.sin(Math.PI * t));
  });

  return <group ref={groupRef}>{children}</group>;
}

/** Tip of a pouring bottle (radians): its neck well down over the tube's mouth. */
const POUR_TILT = 1.6;
/** The bottle's pour point, above the tube's mouth while pouring… */
const POUR_ABOVE_MOUTH = 0.012;
/** …and higher while it comes over and goes back, clear of the clamp. */
const APPROACH_ABOVE_MOUTH = 0.05;
/** How high the bottle arcs on its way over: above the tube's mouth and the clamp. */
const TRAVEL_LIFT = 0.12;
/** Phases of a pour, as fractions of `POUR_MS`. */
const CAP_OFF = 0.12;
const COME = 0.36;
const TIP = 0.48;
const HOLD = 0.74;
const UNTIP = 0.82;
const HOME = 0.94;
/** Where the cap is put down: this far beside the bottle's place, across its way to the tube. */
const CAP_ASIDE = 0.085;

interface CapRest {
  readonly cap: THREE.Object3D | null;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** The cap standing on the table beside the bottle's place. */
  readonly asideWorld: THREE.Vector3;
  readonly worldQuat: THREE.Quaternion;
  /**
   * The bottle's mouth relative to this group's origin, in the world, at
   * rest. Measured off the model rather than assumed at the origin: the
   * display draws the container offset from its own origin, and tipping
   * the bottle would swing that offset upwards.
   */
  readonly mouthOffset: THREE.Vector3;
}

/**
 * A bottle that can be seen pouring into the clamped tube. Its cap comes off
 * and is put down beside it; the bottle arcs over to the tube from the side
 * the stand's rod is NOT on, as the player sees it (so it neither hides the
 * tube nor passes through the stand), tips until its pour point is over the
 * mouth, holds while the reagent goes in (`POUR_COMMIT_MS`), straightens,
 * goes home, and gets its cap back. Wrap the bottle at its resting place —
 * base centre at this group's origin.
 *
 * @param pourPointHeight the bottle's `PourPoint` above its base, at the scale it is drawn —
 *   used only for a container without a cap; with one, the cap's rim is the mouth
 */
export function PourMotion({
  instanceId,
  pourPointHeight,
  position,
  children,
}: {
  readonly instanceId: string;
  readonly pourPointHeight: number;
  readonly position?: Position3;
  readonly children: ReactNode;
}) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const pour = useStandMotionStore((state) => (state.pour?.instanceId === instanceId ? state.pour : null));
  const capRef = useRef<CapRest | null>(null);
  const runningAt = useRef<number | null>(null);
  const s = useMemo(
    () => ({
      rest: new THREE.Vector3(),
      restQuat: new THREE.Quaternion(),
      right: new THREE.Vector3(),
      side: new THREE.Vector3(),
      axis: new THREE.Vector3(),
      tilt: new THREE.Quaternion(),
      worldQuat: new THREE.Quaternion(),
      target: new THREE.Vector3(),
      point: new THREE.Vector3(),
      parentQuat: new THREE.Quaternion(),
      onBottle: new THREE.Vector3(),
      capWorld: new THREE.Vector3(),
    }),
    [],
  );

  const restoreCap = () => {
    const rest = capRef.current;
    if (rest?.cap) {
      rest.cap.position.copy(rest.position);
      rest.cap.quaternion.copy(rest.quaternion);
    }
    capRef.current = null;
  };

  useFrame(() => {
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;
    group.position.set(...(position ?? [0, 0, 0]));
    group.quaternion.identity();
    const elapsed = pour ? Date.now() - pour.at : Infinity;
    if (!pour || elapsed >= POUR_MS || !CLAMP_TUBE_MOUTH.valid) {
      if (runningAt.current !== null) {
        restoreCap();
        runningAt.current = null;
      }
      return;
    }
    const k = elapsed / POUR_MS;
    const mouth = CLAMP_TUBE_MOUTH.point;

    // Where the bottle rests, in the world.
    group.updateWorldMatrix(true, true);
    group.getWorldPosition(s.rest);
    group.getWorldQuaternion(s.restQuat);

    // The side of the tube, as the player sees it, that the rod is not on.
    s.right.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
    const rodSide = Math.sign(s.side.subVectors(CLAMP_TUBE_MOUTH.rod, mouth).dot(s.right)) || -1;
    s.side.copy(s.right).multiplyScalar(-rodSide);
    s.axis.crossVectors(UP, s.side).normalize();

    if (runningAt.current !== pour.at) {
      restoreCap();
      runningAt.current = pour.at;
      let found: THREE.Object3D | null = null;
      group.traverse((object) => {
        if (!found && object.name.startsWith("Cap")) found = object;
      });
      const cap = found as THREE.Object3D | null;
      if (cap) {
        const worldQuat = cap.getWorldQuaternion(new THREE.Quaternion());
        const capWorld = cap.getWorldPosition(new THREE.Vector3());
        const box = new THREE.Box3().setFromObject(cap);
        // The mouth: under the middle of the cap, at its rim.
        const mouthWorld = box.getCenter(new THREE.Vector3()).setY(box.min.y);
        // Stood on the table beside the bottle's place, rim down as it was on the bottle.
        const asideWorld = capWorld.clone().addScaledVector(s.axis, CAP_ASIDE);
        asideWorld.y = s.rest.y + (capWorld.y - box.min.y) + 0.001;
        capRef.current = {
          cap,
          position: cap.position.clone(),
          quaternion: cap.quaternion.clone(),
          asideWorld,
          worldQuat,
          mouthOffset: mouthWorld.sub(s.rest),
        };
      } else {
        capRef.current = {
          cap: null,
          position: new THREE.Vector3(),
          quaternion: new THREE.Quaternion(),
          asideWorld: new THREE.Vector3(),
          worldQuat: new THREE.Quaternion(),
          mouthOffset: new THREE.Vector3(0, pourPointHeight, 0),
        };
      }
    }

    const tip = k < COME ? 0 : k < TIP ? smooth((k - COME) / (TIP - COME)) : k < HOLD ? 1 : k < UNTIP ? 1 - smooth((k - HOLD) / (UNTIP - HOLD)) : 0;
    const above = THREE.MathUtils.lerp(APPROACH_ABOVE_MOUTH, POUR_ABOVE_MOUTH, tip);
    // Tipping towards the tube turns the bottle's up about `axis` by −angle.
    s.tilt.setFromAxisAngle(s.axis, -POUR_TILT * tip);
    s.worldQuat.copy(s.tilt).multiply(s.restQuat);
    // The bottle sits so that its (tipped) mouth is just over the tube's, on the bottle's side.
    s.point.copy(capRef.current?.mouthOffset ?? s.point.set(0, pourPointHeight, 0)).applyQuaternion(s.tilt);
    s.target.copy(mouth).addScaledVector(UP, above).addScaledVector(s.side, 0.004).sub(s.point);

    // Over to the tube and back home, arcing up between.
    const travel =
      k < CAP_OFF ? 0 : k < COME ? smooth((k - CAP_OFF) / (COME - CAP_OFF)) : k < UNTIP ? 1 : k < HOME ? 1 - smooth((k - UNTIP) / (HOME - UNTIP)) : 0;
    const worldPos = s.rest.clone().lerp(s.target, travel).addScaledVector(UP, TRAVEL_LIFT * Math.sin(Math.PI * travel));

    group.position.copy(parent.worldToLocal(worldPos));
    // World = parent · local, so local = parent⁻¹ · world.
    parent.getWorldQuaternion(s.parentQuat);
    group.quaternion.copy(s.parentQuat.invert().multiply(s.worldQuat));

    // The cap: off and down beside the bottle's place, back on once it is home.
    const rest = capRef.current;
    if (rest?.cap?.parent) {
      rest.cap.position.copy(rest.position);
      rest.cap.quaternion.copy(rest.quaternion);
      group.updateWorldMatrix(false, true);
      rest.cap.getWorldPosition(s.onBottle);
      const off = k < CAP_OFF ? smooth(k / CAP_OFF) : k < HOME ? 1 : 1 - smooth((k - HOME) / (1 - HOME));
      s.capWorld.copy(s.onBottle).lerp(rest.asideWorld, off).addScaledVector(UP, 0.03 * Math.sin(Math.PI * off));
      const capParent = rest.cap.parent;
      rest.cap.position.copy(capParent.worldToLocal(s.capWorld));
      const capParentQuat = capParent.getWorldQuaternion(new THREE.Quaternion()).invert();
      const onBottleQuat = rest.cap.getWorldQuaternion(new THREE.Quaternion());
      rest.cap.quaternion.copy(capParentQuat.multiply(onBottleQuat.slerp(rest.worldQuat, off)));
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {children}
    </group>
  );
}
