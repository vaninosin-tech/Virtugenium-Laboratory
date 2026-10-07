import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

import type { Position3 } from "../lib/layout";
import { HAND, useHandStore } from "../lib/useHandStore";
import { constrainOnWorktop, registerWorktopObstacle, shownInWorld } from "../lib/worktopBounds";
import { publishGhostShape } from "../lib/handGhost";
import { ReagentHoverRim } from "./ReagentHoverRim";
import { PourStream } from "./PourStream";
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
/**
 * The gap between the tipped bottle's lip — its lowest edge, a neck's radius
 * below the middle of its mouth (`BottleRest.neckRadius`) — and the tube's
 * rim while pouring (VL-018): the neck stays over the tube, never in it.
 */
const POUR_LIP_GAP = 0.008;
/** …and higher while it comes over and goes back, clear of the clamp. */
const APPROACH_ABOVE_MOUTH = 0.05;
/** How high a bottle arcs on its way over from its place: above the tube's mouth and the clamp. */
const TRAVEL_LIFT = 0.12;
/** Phases of a pour, as fractions of `POUR_MS`. */
const COME = 0.3;
const TIP = 0.44;
const HOLD = 0.74;
const UNTIP = 0.84;
/** Where the cap is put down: this far to the side of the bottle's place, as the player sees it. */
const CAP_ASIDE = 0.085;
/** How closely a carried item follows the hand (1/s, exponential) — smooths the mouse's jerks. */
const CARRY_FOLLOW_RATE = 20;
/** Seconds for a taken item to fly from its place to the hand; after that it follows the mouse 1:1. */
const FLY_IN_SECONDS = 0.22;
/** How fast an item snaps to its target near the stand, and off again (1/s, exponential). */
const SNAP_RATE = 16;
/** A tube brought to the empty clamp hovers this far above its clamped place, ready to drop in. */
const CLAMP_HOVER = 0.04;
/** Gap between a bottle snapped beside the clamped tube and the tube. */
const READY_GAP = 0.02;
/** The tube in the clamp's half-width: a bottle beside it stands this much further off. */
const CLAMPED_TUBE_RADIUS = 0.011;
/** Seconds for the cap to come off or go back on. */
const CAP_SECONDS = 0.35;

interface BottleRest {
  readonly cap: THREE.Object3D | null;
  readonly capPosition: THREE.Vector3;
  readonly capQuaternion: THREE.Quaternion;
  /** The cap standing on the table beside the bottle's place. */
  readonly capAside: THREE.Vector3;
  readonly capWorldQuat: THREE.Quaternion;
  /**
   * The bottle's mouth relative to this group's origin, in the world, at
   * rest. Measured off the model rather than assumed at the origin: the
   * display draws the container offset from its own origin, and tipping
   * the bottle would swing that offset upwards.
   */
  readonly mouthOffset: THREE.Vector3;
  /** Half its width — how far beside the tube a snapped bottle must stand. */
  readonly radius: number;
  /** Half its mouth's width — how far its lip reaches below the middle of its mouth when it lies tipped. */
  readonly neckRadius: number;
}

/**
 * A bottle that can be taken into the hand (VL-015) and seen pouring into
 * the clamped tube (VL-014). Wrap it at its resting place — base centre at
 * this group's origin.
 *
 * - Taken: its cap comes off and stays on the table at its place, the bottle
 *   flies to the hand and follows it (`HAND.point`).
 * - Pouring: from wherever it is, it comes beside the tube's mouth from the
 *   side the stand's rod is NOT on, as the player sees it, tips until its
 *   mouth is over the tube's, holds while the reagent goes in
 *   (`POUR_COMMIT_MS`), straightens and goes home.
 * - Let go or put back: it goes home and gets its cap back.
 *
 * Tubes taken from the hood's rack use it too: no cap, their mouth is their top.
 *
 * @param pourPointHeight the bottle's `PourPoint` above its base, at the scale it is drawn —
 *   used only for a container without a cap; with one, the cap's rim is the mouth
 */
export function PourMotion({
  instanceId,
  pourPointHeight,
  position,
  keepCap = false,
  children,
}: {
  readonly instanceId: string;
  readonly pourPointHeight: number;
  /** Carried capped — taken off the tray only to be set down, not to pour (VL-017). */
  readonly keepCap?: boolean;
  readonly position?: Position3;
  readonly children: ReactNode;
}) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const pour = useStandMotionStore((state) => (state.pour?.instanceId === instanceId ? state.pour : null));
  const held = useHandStore((state) => state.held?.instanceId === instanceId);
  const restRef = useRef<BottleRest | null>(null);
  const motion = useRef({
    away: false,
    cur: new THREE.Vector3(),
    curQuat: new THREE.Quaternion(),
    capOff: 0,
    wasHeld: false,
    wasPouring: false,
    /** Going home: where from, how far along (0..1; −1 — not going home), in how long. */
    homeFrom: new THREE.Vector3(),
    homeFromQuat: new THREE.Quaternion(),
    homeT: -1,
    homeSeconds: 0.4,
    homeArc: 0.05,
    flyIn: 1,
    flyStart: new THREE.Vector3(),
    snap: 0,
    snapGoal: new THREE.Vector3(),
    pourAt: 0,
    pourFrom: new THREE.Vector3(),
    pourFromPlace: true,
  });
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
      from: new THREE.Vector3(),
      parentQuat: new THREE.Quaternion(),
      onBottle: new THREE.Vector3(),
      capWorld: new THREE.Vector3(),
      tmpQuat: new THREE.Quaternion(),
    }),
    [],
  );

  // Standing on the worktop, it is in the way of whatever else is carried
  // there (VL-018): a circle round it, measured once at rest.
  useEffect(() => {
    const footprint = { measured: false, dx: 0, dz: 0, r: 0 };
    const at = new THREE.Vector3();
    const box = new THREE.Box3();
    return registerWorktopObstacle(instanceId, {
      get: () => {
        const group = groupRef.current;
        if (!group || !shownInWorld(group)) return [];
        group.getWorldPosition(at);
        if (!footprint.measured) {
          if (motion.current.away) return [];
          box.setFromObject(group);
          if (box.isEmpty()) return [];
          const centre = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          Object.assign(footprint, { measured: true, dx: centre.x - at.x, dz: centre.z - at.z, r: Math.max(size.x, size.z) / 2 });
        }
        return [{ kind: "circle", x: at.x + footprint.dx, z: at.z + footprint.dz, r: footprint.r }];
      },
    });
  }, [instanceId]);

  /** Measures the bottle at rest — its mouth, where its cap goes — before it first leaves its place. */
  const measure = (group: THREE.Group) => {
    let found: THREE.Object3D | null = null;
    group.traverse((object) => {
      if (!found && object.name.startsWith("Cap")) found = object;
    });
    const cap = found as THREE.Object3D | null;
    s.right.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) / 2;
    if (!cap) {
      restRef.current = {
        cap: null,
        capPosition: new THREE.Vector3(),
        capQuaternion: new THREE.Quaternion(),
        capAside: new THREE.Vector3(),
        capWorldQuat: new THREE.Quaternion(),
        mouthOffset: new THREE.Vector3(0, pourPointHeight, 0),
        radius,
        neckRadius: radius,
      };
      return;
    }
    const capWorld = cap.getWorldPosition(new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(cap);
    // The mouth: under the middle of the cap, at its rim.
    const mouth = box.getCenter(new THREE.Vector3()).setY(box.min.y);
    // Stood on the table beside the bottle's place, rim down as it was on the bottle.
    const capAside = capWorld.clone().addScaledVector(s.right, CAP_ASIDE);
    capAside.y = s.rest.y + (capWorld.y - box.min.y) + 0.001;
    restRef.current = {
      cap,
      capPosition: cap.position.clone(),
      capQuaternion: cap.quaternion.clone(),
      capAside,
      capWorldQuat: cap.getWorldQuaternion(new THREE.Quaternion()),
      mouthOffset: mouth.sub(s.rest),
      radius,
      neckRadius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
    };
  };

  /** The side of the tube, as the player sees it, that the stand's rod is not on — into `s.side`, `s.axis`. */
  const sideAwayFromRod = (mouth: THREE.Vector3) => {
    s.right.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
    const rodSide = Math.sign(s.side.subVectors(CLAMP_TUBE_MOUTH.rod, mouth).dot(s.right)) || -1;
    s.side.copy(s.right).multiplyScalar(-rodSide);
    s.axis.crossVectors(UP, s.side).normalize();
  };

  useFrame((_, rawDelta) => {
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;
    const delta = Math.min(rawDelta, 0.1);
    const m = motion.current;

    // Where the bottle rests, in the world.
    group.position.set(...(position ?? [0, 0, 0]));
    group.quaternion.identity();
    const rest = restRef.current;
    if (rest?.cap) {
      rest.cap.position.copy(rest.capPosition);
      rest.cap.quaternion.copy(rest.capQuaternion);
    }
    group.updateWorldMatrix(true, true);
    group.getWorldPosition(s.rest);
    group.getWorldQuaternion(s.restQuat);

    const elapsed = pour ? Date.now() - pour.at : Infinity;
    const pouring = !!pour && elapsed < POUR_MS && CLAMP_TUBE_MOUTH.valid;
    if (!m.away && !held && !pouring) {
      // At its place and staying there.
      m.cur.copy(s.rest);
      m.curQuat.copy(s.restQuat);
      return;
    }
    if (!m.away) {
      // Leaving its place: measure it first, while it still stands there.
      measure(group);
      m.away = true;
      m.cur.copy(s.rest);
      m.curQuat.copy(s.restQuat);
    }
    const r = restRef.current!;
    if (held) {
      HAND.home.copy(s.rest);
      HAND.homeValid = true;
      HAND.radius = r.radius;
    }

    if (pouring) {
      const k = elapsed / POUR_MS;
      const mouth = CLAMP_TUBE_MOUTH.point;
      sideAwayFromRod(mouth);
      if (m.pourAt !== pour.at) {
        // The pour starts from wherever the item is: its place, or snapped beside the tube.
        m.pourAt = pour.at;
        m.pourFrom.copy(m.cur);
        m.pourFromPlace = m.cur.distanceTo(s.rest) < 0.001;
      }

      const tip = k < COME ? 0 : k < TIP ? smooth((k - COME) / (TIP - COME)) : k < HOLD ? 1 : k < UNTIP ? 1 - smooth((k - HOLD) / (UNTIP - HOLD)) : 0;
      // Tipped, its lip hangs a neck's radius below the middle of its mouth.
      const pourAbove = r.neckRadius * Math.sin(Math.min(POUR_TILT, Math.PI / 2) * tip) + POUR_LIP_GAP;
      const above = THREE.MathUtils.lerp(Math.max(APPROACH_ABOVE_MOUTH, pourAbove + 0.02), pourAbove, tip);
      // Tipping towards the tube turns the bottle's up about `axis` by −angle.
      s.tilt.setFromAxisAngle(s.axis, -POUR_TILT * tip);
      // The bottle sits so that its (tipped) mouth is just over the tube's, on the bottle's side.
      s.point.copy(r.mouthOffset).applyQuaternion(s.tilt);
      s.target.copy(mouth).addScaledVector(UP, above).addScaledVector(s.side, 0.004).sub(s.point);
      // Upright, its mouth over the tube's would put its body round the tube
      // (VL-018): until it is tipped it stands beside the tube instead, and
      // swings over only as it tips.
      s.target.addScaledVector(s.side, (r.radius + READY_GAP + CLAMPED_TUBE_RADIUS) * (1 - tip));

      if (k < UNTIP) {
        // Over to the tube from where it was — its place (arcing over), or right beside it.
        s.from.copy(m.pourFrom);
        const travel = k < COME ? smooth(k / COME) : 1;
        const lift = (m.pourFromPlace ? TRAVEL_LIFT : 0.01) * Math.sin(Math.PI * travel);
        m.cur.copy(s.from).lerp(s.target, travel).addScaledVector(UP, lift);
      } else {
        m.cur.copy(s.target);
      }
      m.curQuat.copy(s.tilt).multiply(s.restQuat);
    } else if (held) {
      if (!m.wasHeld) {
        // Where it stood, for its outline there while it is carried (VL-018).
        publishGhostShape(group);
        // Just taken: a short flight to the hand, then it IS the hand.
        m.flyIn = 0;
        m.flyStart.copy(m.cur);
        m.snap = 0;
        m.homeT = -1;
      }
      m.flyIn = Math.min(1, m.flyIn + delta / FLY_IN_SECONDS);
      const free = HAND.valid ? HAND.point : s.rest;
      // Near the stand it snaps into a ready pose (VL-015): a tube over the
      // empty clamp, a bottle (or a tube to pour) upright beside the clamped
      // tube, mouth level with its mouth — no aiming at a 2 cm opening.
      const aim = useHandStore.getState().aim;
      if (aim && CLAMP_TUBE_MOUTH.valid) {
        const mouth = CLAMP_TUBE_MOUTH.point;
        if (aim.part === "clamp") {
          m.snapGoal.copy(mouth).sub(r.mouthOffset).addScaledVector(UP, CLAMP_HOVER);
        } else {
          sideAwayFromRod(mouth);
          m.snapGoal
            .copy(mouth)
            .addScaledVector(s.side, r.radius + READY_GAP)
            .sub(r.mouthOffset)
            .addScaledVector(UP, READY_GAP);
        }
      }
      m.snap = THREE.MathUtils.lerp(m.snap, aim ? 1 : 0, 1 - Math.exp(-SNAP_RATE * delta));
      s.target.copy(free).lerp(m.snapGoal, smooth(m.snap));
      if (m.flyIn < 1) m.cur.copy(m.flyStart).lerp(s.target, smooth(m.flyIn));
      // Then after the hand, a touch behind it: a jerk of the mouse is not a jerk of the bottle (VL-018).
      else m.cur.lerp(s.target, 1 - Math.exp(-CARRY_FOLLOW_RATE * delta));
      m.curQuat.copy(s.restQuat);
      HAND.itemPos.copy(m.cur);
      HAND.itemPosValid = true;
    } else {
      // On its way home (VL-018): up in a low arc, across, and set down
      // softly — it lands with no speed left, not with a thud.
      if (m.wasHeld || m.wasPouring || (m.homeT < 0 && !m.cur.equals(s.rest))) {
        m.homeFrom.copy(m.cur);
        m.homeFromQuat.copy(m.curQuat);
        m.homeT = 0;
        const across = Math.hypot(m.cur.x - s.rest.x, m.cur.z - s.rest.z);
        m.homeSeconds = THREE.MathUtils.clamp(0.28 + across * 0.55, 0.3, 0.7);
        m.homeArc = THREE.MathUtils.clamp(0.025 + across * 0.07, 0.025, 0.08);
      }
      m.homeT = Math.min(1, m.homeT + delta / m.homeSeconds);
      const k = smooth(m.homeT);
      m.cur.lerpVectors(m.homeFrom, s.rest, k);
      // sin² — no speed up or down at either end.
      m.cur.y += m.homeArc * Math.sin(Math.PI * m.homeT) ** 2;
      // Round whatever stands in the way — the tube it poured into, the
      // stand, the lamp — not through it; straight in at the end.
      if (m.homeT < 0.85) constrainOnWorktop(m.cur, r.radius, s.rest, new Set([instanceId]));
      m.curQuat.slerpQuaternions(m.homeFromQuat, s.restQuat, k);
      if (m.homeT >= 1) {
        m.cur.copy(s.rest);
        m.curQuat.copy(s.restQuat);
      }
    }
    m.wasHeld = held;
    m.wasPouring = pouring;

    group.position.copy(parent.worldToLocal(s.target.copy(m.cur)));
    // World = parent · local, so local = parent⁻¹ · world.
    parent.getWorldQuaternion(s.parentQuat);
    group.quaternion.copy(s.parentQuat.invert().multiply(m.curQuat));

    // The cap: off while the bottle is away from its place, back on once it is home.
    const home = !held && !pouring && m.cur.equals(s.rest);
    m.capOff = THREE.MathUtils.clamp(m.capOff + (home || keepCap ? -1 : 1) * (delta / CAP_SECONDS), 0, 1);
    if (r.cap?.parent) {
      group.updateWorldMatrix(false, true);
      r.cap.getWorldPosition(s.onBottle);
      const off = smooth(m.capOff);
      s.capWorld.copy(s.onBottle).lerp(r.capAside, off).addScaledVector(UP, 0.03 * Math.sin(Math.PI * off));
      const capParent = r.cap.parent;
      r.cap.position.copy(capParent.worldToLocal(s.capWorld));
      capParent.getWorldQuaternion(s.tmpQuat).invert();
      const onBottleQuat = r.cap.getWorldQuaternion(new THREE.Quaternion());
      r.cap.quaternion.copy(s.tmpQuat.multiply(onBottleQuat.slerp(r.capWorldQuat, off)));
    }
    if (home && m.capOff === 0) {
      // Home, capped: back to standing still.
      m.away = false;
      if (r.cap) {
        r.cap.position.copy(r.capPosition);
        r.cap.quaternion.copy(r.capQuaternion);
      }
      group.position.set(...(position ?? [0, 0, 0]));
      group.quaternion.identity();
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {children}
      <PourStream instanceId={instanceId} bottleRef={groupRef} mouth={restRef} />
    </group>
  );
}

/** A 2 cm tube's edge glow at the default strength (2.2) is lost at the hood's viewing distance. */
const GLASS_RIM_OPACITY = 6;

/**
 * Outlines the glass of the tube inside it — only the glass, not its
 * contents and reaction effects — while `active`. The outline is drawn
 * beside the glass, in the glass's own parent.
 */
export function GlassRim({
  active,
  tone = "normal",
  children,
}: {
  readonly active: boolean;
  readonly tone?: "normal" | "refused";
  readonly children: ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [glass, setGlass] = useState<THREE.Mesh | null>(null);
  useEffect(() => {
    if (!active) return;
    let found: THREE.Mesh | null = null;
    groupRef.current?.traverse((object) => {
      if (!found && object instanceof THREE.Mesh && object.name === "Tube_Glass") found = object;
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- looked up once lit, in the loaded scene graph
    setGlass(found);
  }, [active]);
  return (
    <group ref={groupRef}>
      {children}
      {glass?.parent
        ? createPortal(<ReagentHoverRim object={glass} active={active} tone={tone} opacity={GLASS_RIM_OPACITY} />, glass.parent)
        : null}
    </group>
  );
}
