import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

import type { Position3 } from "../lib/layout";
import { HAND, useHandStore } from "../lib/useHandStore";
import { constrainOnWorktop, registerWorktopObstacle, shownInWorld } from "../lib/worktopBounds";
import { HAND_GHOST, publishGhostShape } from "../lib/handGhost";
import { pourPose } from "../lib/pourPose";
import { registerPourSource } from "../lib/pourSources";
import type { TubeLocation } from "../lib/useTestTubeStorageStore";
import { ReagentHoverRim } from "./ReagentHoverRim";
import { PourStream } from "./PourStream";
import {
  CLAMP_TUBE_MOUTH,
  POUR_MS,
  TUBE_FLIGHT_MS,
  simNowMs,
  useStandMotionStore,
  type TubeArrival,
} from "../lib/useStandMotionStore";

/** How high a flying tube arcs over whatever stands between rack and clamp. */
const ARC_LIFT = 0.07;
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Quaternion();

const partBox = new THREE.Box3();
/**
 * The box of what is drawn of `root` — its visible meshes only. Not
 * `Box3.setFromObject`, which counts hidden helpers too: the pour stream's
 * drops wait hidden at full size under the bottle (`PourStream`) and made a
 * bottle a metre wide — its pour stood off, its obstacle filled the table.
 * Nor instanced pools: a reacting tube's bubbles made the clamp two metres wide.
 */
function drawnBox(root: THREE.Object3D, box: THREE.Box3): THREE.Box3 {
  box.makeEmpty();
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    // Instanced pools (a tube's reaction bubbles): their geometry's box is one unit particle, not where they are.
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    for (let at: THREE.Object3D | null = object; at && at !== root.parent; at = at.parent) if (!at.visible) return;
    const material = object.material as THREE.Material | THREE.Material[];
    if (!Array.isArray(material) && !material.visible) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    box.union(partBox.copy(object.geometry.boundingBox!).applyMatrix4(object.matrixWorld));
  });
  return box;
}
/** How late a `fromFirstFrame` flight may still begin after it was asked for. */
const LATE_MOUNT_MS = 1000;

const smooth = (t: number) => THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(t, 0, 1), 0, 1);

/**
 * Plays a tube's flight into the place it was just put — the clamp, or its
 * rack slot — from where it was (`arrival.world`), along an arc. Wrap the
 * tube in it at its RESTING place: this group's own origin is where it lands.
 * Runs off the clock, so it plays correctly even if it mounts a frame late.
 *
 * @param fromFirstFrame start the flight's clock when it is first drawn, not
 *   when it was asked for — for what mounts only once it has arrived (the
 *   stand, the lamp set down off the tray): a slow mount must not eat the
 *   start of the flight. A flight asked for over a second ago is not played.
 */
export function ArrivalFlight({
  arrival,
  fromFirstFrame = false,
  children,
}: {
  readonly arrival: TubeArrival | null;
  readonly fromFirstFrame?: boolean;
  readonly children: ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const from = useRef<{ at: number; local: THREE.Vector3; up: THREE.Vector3; turn: THREE.Quaternion | null } | null>(null);
  const started = useRef<{ at: number; when: number } | null>(null);

  useFrame(() => {
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;
    if (fromFirstFrame && arrival && started.current?.at !== arrival.at) {
      started.current = { at: arrival.at, when: Date.now() - arrival.at < TUBE_FLIGHT_MS + LATE_MOUNT_MS ? Date.now() : -Infinity };
    }
    const startedAt = fromFirstFrame && arrival ? started.current!.when : arrival?.at ?? 0;
    const elapsed = arrival ? Date.now() - startedAt : Infinity;
    if (!arrival || elapsed >= TUBE_FLIGHT_MS) {
      if (from.current) {
        group.position.set(0, 0, 0);
        group.quaternion.identity();
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
      // How it was turned there, in the parent's frame — it turns into place as it flies.
      const turn = arrival.quaternion
        ? parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion(...arrival.quaternion))
        : null;
      from.current = { at: arrival.at, local, up, turn };
    }
    const t = smooth(elapsed / TUBE_FLIGHT_MS);
    group.position.copy(from.current.local).multiplyScalar(1 - t);
    group.position.addScaledVector(from.current.up, ARC_LIFT * Math.sin(Math.PI * t));
    if (from.current.turn) group.quaternion.slerpQuaternions(from.current.turn, IDENTITY, t);
  });

  return <group ref={groupRef}>{children}</group>;
}

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
  inert = false,
  obstacle = true,
  pourSource,
  ghostWhole = false,
  children,
}: {
  readonly instanceId: string;
  readonly pourPointHeight: number;
  /** Carried capped — taken off the tray only to be set down, not to pour (VL-017). */
  readonly keepCap?: boolean;
  /**
   * A stand-in copy that is not the real thing yet (a tray bottle prewarmed on
   * the bench, `WorkbenchReagentDisplayArea`): never carried, never pours —
   * only the copy the player took moves with the hand and speaks for it (`HAND`).
   */
  readonly inert?: boolean;
  /** In the way of what else is carried (a circle round it, VL-018) — off for what has its own (the stand, the lamp). */
  readonly obstacle?: boolean;
  /** Its outline is all it is made of, even holding a tube (the clamp) — not just a container's glass. */
  readonly ghostWhole?: boolean;
  /** A bottle standing at a place: a tube held up to it is poured into (`pourSources`). */
  readonly pourSource?: { readonly reagentId: string; readonly location: TubeLocation };
  readonly position?: Position3;
  readonly children: ReactNode;
}) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const pour = useStandMotionStore((state) => (!inert && state.pour?.instanceId === instanceId ? state.pour : null));
  const held = useHandStore((state) => !inert && state.held?.instanceId === instanceId);
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
      pourQuat: new THREE.Quaternion(),
      worldQuat: new THREE.Quaternion(),
      target: new THREE.Vector3(),
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
    if (!obstacle) return;
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
          drawnBox(group, box);
          if (box.isEmpty()) return [];
          const centre = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          Object.assign(footprint, { measured: true, dx: centre.x - at.x, dz: centre.z - at.z, r: Math.max(size.x, size.z) / 2 });
        }
        return [{ kind: "circle", x: at.x + footprint.dx, z: at.z + footprint.dz, r: footprint.r }];
      },
    });
  }, [instanceId, obstacle]);

  /** Measures the bottle at rest — its mouth, where its cap goes — before it first leaves its place. */
  const measure = (group: THREE.Group) => {
    let found: THREE.Object3D | null = null;
    group.traverse((object) => {
      if (!found && object.name.startsWith("Cap")) found = object;
    });
    const cap = found as THREE.Object3D | null;
    s.right.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
    const size = drawnBox(group, new THREE.Box3()).getSize(new THREE.Vector3());
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

  // A tube held up to it is poured into: it says where it is and how it pours (`pourSources`).
  const sourceReagent = pourSource?.reagentId;
  const sourceLocation = pourSource?.location;
  useEffect(() => {
    if (inert || !sourceReagent || !sourceLocation) return;
    const group = groupRef.current;
    if (!group) return;
    return registerPourSource({
      instanceId,
      reagentId: sourceReagent,
      location: sourceLocation,
      root: group,
      geometry: () => {
        if (motion.current.away || !shownInWorld(group)) return null;
        if (!restRef.current) measure(group);
        return restRef.current;
      },
    });
    // `measure` reads only refs and the camera: stable for this bottle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, inert, sourceReagent, sourceLocation]);

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

    const elapsed = pour ? simNowMs() - pour.at : Infinity;
    // Into the tube in the clamp — or into the tube in the hand, held up to it.
    const intoHand = pour?.into === "hand";
    const pouring = !!pour && elapsed < POUR_MS && (intoHand ? HAND.mouthValid : CLAMP_TUBE_MOUTH.valid);
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
      const mouth = intoHand ? HAND.mouth : CLAMP_TUBE_MOUTH.point;
      if (intoHand) {
        // It comes to the tube from its own side.
        s.side.subVectors(s.rest, mouth).setY(0);
        if (s.side.lengthSq() < 1e-8) s.side.set(1, 0, 0);
        s.side.normalize();
      } else sideAwayFromRod(mouth);
      if (m.pourAt !== pour.at) {
        // The pour starts from wherever the item is: its place, or snapped beside the tube.
        m.pourAt = pour.at;
        m.pourFrom.copy(m.cur);
        m.pourFromPlace = m.cur.distanceTo(s.rest) < 0.001;
      }

      const tip = k < COME ? 0 : k < TIP ? smooth((k - COME) / (TIP - COME)) : k < HOLD ? 1 : k < UNTIP ? 1 - smooth((k - HOLD) / (UNTIP - HOLD)) : 0;
      // Beside the tube upright, then tipped over its mouth (`pourPose` — the outline before it shows the same).
      pourPose(r, s.restQuat, mouth, s.side, tip, s.target, s.pourQuat);

      if (k < UNTIP) {
        // Over to the tube from where it was — its place (arcing over), or right beside it.
        s.from.copy(m.pourFrom);
        const travel = k < COME ? smooth(k / COME) : 1;
        const lift = (m.pourFromPlace ? TRAVEL_LIFT : 0.01) * Math.sin(Math.PI * travel);
        m.cur.copy(s.from).lerp(s.target, travel).addScaledVector(UP, lift);
      } else {
        m.cur.copy(s.target);
      }
      m.curQuat.copy(s.pourQuat);
    } else if (held) {
      if (!m.wasHeld) {
        // Where it stood, for its outline there while it is carried (VL-018).
        publishGhostShape(group, { whole: ghostWhole });
        // Just taken: a short flight to the hand, then it IS the hand — from
        // where it really was when taken from elsewhere (out of the clamp).
        m.flyIn = 0;
        m.flyStart.copy(HAND.takenFromValid ? HAND.takenFrom : m.cur);
        HAND.takenFromValid = false;
        m.homeT = -1;
      }
      m.flyIn = Math.min(1, m.flyIn + delta / FLY_IN_SECONDS);
      // It goes where the hand takes it, freely — what it would do near the
      // stand shows as its outline there (`placementGhosts`), never by pulling it.
      const free = HAND.valid ? HAND.point : s.rest;
      if (CLAMP_TUBE_MOUTH.valid) {
        // Where it would be pouring into the clamped tube, tipped over its mouth —
        // for its outline there while it is carried (`placementGhosts`).
        sideAwayFromRod(CLAMP_TUBE_MOUTH.point);
        pourPose(r, s.restQuat, CLAMP_TUBE_MOUTH.point, s.side, 1, HAND_GHOST.pourPosition, HAND_GHOST.pourQuaternion);
        HAND_GHOST.posesValid = true;
      }
      s.target.copy(free);
      if (m.flyIn < 1) m.cur.copy(m.flyStart).lerp(s.target, smooth(m.flyIn));
      // Then after the hand, a touch behind it: a jerk of the mouse is not a jerk of the bottle (VL-018).
      else m.cur.lerp(s.target, 1 - Math.exp(-CARRY_FOLLOW_RATE * delta));
      m.curQuat.copy(s.restQuat);
      HAND.itemPos.copy(m.cur);
      HAND.itemQuat.copy(m.curQuat);
      // Its mouth, upright as it is carried — what a bottle pours into, if it is a tube.
      HAND.mouth.copy(m.cur).add(r.mouthOffset);
      HAND.mouthValid = true;
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
