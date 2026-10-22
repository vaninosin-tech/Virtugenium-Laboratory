import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { getCabinetParallelTrayYaw, isTrayHeldEligible, type HotspotTargetId, type Position3 } from "../lib/layout";
import { getEffectiveInspectionTarget } from "../lib/useCameraCalibrationStore";
import { useNavButtonCalibrationStore } from "../lib/useNavButtonCalibrationStore";
import { useReagentPickablesStore } from "../lib/useReagentPickablesStore";
import { nextFreeTraySlot, useReagentStorageStore } from "../lib/useReagentStorageStore";
import { useReagentInspectionStore } from "../lib/useReagentInspectionStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { computeTubeSlotPosition, TRAY_RACK_ANCHOR, useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";
import { computeTrayReagentPosition, useTrayReagentAreaStore } from "../lib/useTrayReagentAreaStore";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useBurnerStore } from "../lib/useBurnerStore";
import { REAGENTS, type ReagentId } from "../../../entities/laboratory/reagents";
import { BunsenStandTrayDisplay } from "./BunsenStandTrayDisplay";
import { SpiritLampTrayDisplay } from "./SpiritLampItem";
import { LabTestTubeInstance } from "./LabTestTubeInstance";
import { ReagentStaticDisplay } from "./ReagentStaticDisplay";
import { TrayReturnZone } from "./TrayReturnZone";
import { prepareTrayMaterials } from "../lib/trayMaterials";
import { useHandStore } from "../lib/useHandStore";
import { TAKE_FROM_TRAY, takeFromTray } from "../lib/trayUnloadPlace";
import { GlassRim, PourMotion } from "./StandMotion";
import { trayUnloadPlace } from "../lib/trayUnloadPlace";
import { CABINET_RETURN, HELD_TRAY, TABLE_TRAY } from "../lib/tableTray";
import { pressToTake } from "../lib/pressToTake";
import { registerWorktopZone, useBoxObstacle } from "../lib/worktopBounds";

/** The rack built into the tray (`TRAY_RACK_ANCHOR`, turned a quarter): 18.7 × 37 cm, in the tray's own space. */
const TRAY_RACK_FOOTPRINT = {
  minX: TRAY_RACK_ANCHOR.x - 0.0935,
  maxX: TRAY_RACK_ANCHOR.x + 0.0935,
  minZ: TRAY_RACK_ANCHOR.z - 0.185,
  maxZ: TRAY_RACK_ANCHOR.z + 0.185,
} as const;
import { hoodTrayWorldPose } from "../lib/hoodLayout";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";

/**
 * Whether the tray goes along to this zone: to every cabinet (held up), and
 * to the fume hood (set down on its worktop, `hoodTrayWorldPose`) loaded or
 * not (VL-017) — but not in the sandbox, whose hood is laid out without it.
 */
const trayHeldAt = (id: HotspotTargetId | null): boolean =>
  isTrayHeldEligible(id) && !(id === "fume-hood" && useLaboratoryStore.getState().mode === "sandbox");
import { useStandHintStore } from "../lib/useStandHintStore";

const MODEL_PATH = "/assets/models/LabTray_Metal.glb";
/**
 * Constant travel speed for the tray's table<->hand tween, replacing two
 * fixed durations (was 0.42s appear / 0.36s return) that made the animation
 * look completely different depending on which cabinet the player was at —
 * a fixed time budget covering the short table-to-simple-cabinet hop
 * (~1.5m) and the long table-to-oxides hop (~3.3m) has to move over 2x
 * faster for the far one. Deriving the duration from the ACTUAL start/end
 * distance (`trayTransitionDuration`) keeps the apparent speed the same
 * regardless of which side of the room the cabinet is on, and using the
 * same speed for both the pickup appearance and the return makes the two
 * directions symmetric instead of arbitrarily different constants.
 *
 * Slowed down twice since (5.5 -> 3.2 -> 2.4 m/s, floor 0.24 -> 0.32 -> 0.35s)
 * after each prior tuning still read as too fast.
 */
const TRAY_TRANSITION_SPEED_M_S = 2.4;
/** Floor so a very close cabinet's tween doesn't read as an instant snap. */
const TRAY_TRANSITION_MIN_DURATION_S = 0.35;
/**
 * Ceiling for the PICKUP APPEARANCE only. Unlike the return (below), nothing
 * external constrains how long this can take — the appearance only starts
 * once the camera has (or is about to have, see `NEAR_ARRIVAL_DISTANCE_SQ`)
 * already arrived, so it isn't racing another tween — so this can be looser
 * than the return's ceiling.
 */
const TRAY_APPEAR_MAX_DURATION_S = 0.85;
/**
 * Ceiling for the RETURN — must stay safely under `CameraRig`'s own
 * RETURN_DURATION_MS (raised to 1000ms alongside this, see that constant's
 * own doc). Matches `TRAY_APPEAR_MAX_DURATION_S`, per a request for the same
 * slowness both ways. The held copy flies all the way back to the table pose
 * and the table copy takes over from exactly there (`HELD_TRAY`), so the
 * tray is never missing and never pops.
 */
const TRAY_RETURN_MAX_DURATION_S = 0.85;

/** See `TRAY_TRANSITION_SPEED_M_S`'s doc — shared speed/floor for both directions, but each has its own ceiling (`maxDurationS`) since only the return is externally constrained. */
function trayTransitionDuration(distanceMeters: number, maxDurationS: number): number {
  return THREE.MathUtils.clamp(
    distanceMeters / TRAY_TRANSITION_SPEED_M_S,
    TRAY_TRANSITION_MIN_DURATION_S,
    maxDurationS,
  );
}

/**
 * How close (meters) the camera must get to a FRESH approach's own inspection
 * target before the tray is allowed to start its pickup tween early, rather
 * than waiting for `cabinetPhase` to flip all the way to "inspecting" (the
 * camera tween's own t=1). Waiting for the full flight to finish first, THEN
 * starting the tray's own tween on top of that, read as a dead beat between
 * the camera visibly settling and the tray finally reacting — especially
 * once the camera flight itself was slowed back down (`CameraRig`'s
 * `FOCUS_DURATION_MS`). Letting the tray start a little before the camera's
 * own last few percent of travel overlaps the two instead of chaining them.
 * Squared to compare directly against a squared distance, no sqrt needed.
 */
const NEAR_ARRIVAL_DISTANCE_SQ = 0.35 * 0.35;

/**
 * Exponential-decay rate for the held tray's ORIENTATION once it's past the
 * initial pickup tween — the dedicated
 * cabinet-to-cabinet transition animation: a chain-arrow switch (see
 * `CameraRig.startSwitchingCabinet`) reuses the SAME "focusing" phase a
 * fresh room→cabinet approach does, and `focusedCabinetId` (hence the
 * cabinet-parallel yaw target below) jumps to the new cabinet from the very
 * first frame, well before the camera itself arrives — snapping the
 * quaternion straight to that target the instant it changes read as the
 * tray twisting in the player's hand before the camera had even started
 * turning. Damping it here instead makes the tray visibly catch up to the
 * camera's own turn over the transition, reaching the new orientation at
 * roughly the same time the camera settles (`CameraRig`'s own tween is
 * ~0.52s; this reaches ~95% of the way there in about the same window).
 * Position is NOT damped the same way — it's already recomputed fresh from
 * the live camera pose every frame, so it already tracks the camera
 * exactly during the flight; only the extra cabinet-yaw rotation on top of
 * that needed smoothing.
 */
const SWITCH_FOLLOW_DAMPING = 6;

/**
 * One tray visual. `mode="table"` and `mode="held"` are mounted as two
 * separate instances by `Laboratory`; each has its own transform and only
 * the relevant instance is visible in the corresponding state.
 *
 * Eligibility (`isTrayHeldEligible`) is read directly off
 * `useSceneInteractionStore.focusedCabinetId` every frame — a generic
 * "cabinet-*" prefix check, not a per-cabinet flag — so switching between
 * two eligible cabinets never dips back to the workbench target in between,
 * and entering PPE/fume-hood/table/overview always resolves to workbench.
 *
 * A fresh cabinet approach starts the short appearance immediately (from the
 * table, over a distance-scaled duration — see `trayTransitionDuration`). A chain-arrow switch to a neighbor
 * cabinet reuses the same "focusing" `cabinetPhase` a fresh approach does,
 * but — since the tray was already held going into it (see `heldRef`) — is
 * treated as still held throughout that phase too, instead of dipping back
 * to the table and reappearing: position keeps tracking the live camera
 * pose every frame as always, and orientation smoothly catches up to the
 * new cabinet's yaw via `SWITCH_FOLLOW_DAMPING` instead of snapping. It
 * snaps home as soon as an actual return begins; item hand-off happens in
 * `CameraRig` at the same boundary.
 *
 * `heldRef` edge-detects only the first eligible focus (a genuine pickup)
 * so cabinet-to-cabinet navigation never dips down or restarts the
 * from-table appearance.
 */
export function LabTrayInstance({
  position,
  rotationY = 0,
  mode,
}: {
  readonly position: Position3;
  readonly rotationY?: number;
  readonly mode: "table" | "held";
}) {
  const { scene } = useGLTF(MODEL_PATH);
  const { camera, gl, scene: rootScene, invalidate } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  // The rack built into the tray is in the way of what is carried past it (VL-018).
  useBoxObstacle(`tray-rack-${mode}`, groupRef, TRAY_RACK_FOOTPRINT, "tray-rack");
  // What is carried at the table or the hood may go over the tray there too (F8 → «Границы», VL-019).
  useEffect(() => {
    const object = groupRef.current;
    if (!object) return;
    if (mode === "table") return registerWorktopZone("table-tray", object);
    return registerWorktopZone("hood-tray", object, () => useSceneInteractionStore.getState().focusedCabinetId === "fume-hood");
  }, [mode]);
  // The tray on the workbench is where things are put on it (VL-017, `overTableTray`).
  useEffect(() => {
    if (mode !== "table") return;
    TABLE_TRAY.object = groupRef.current;
    return () => {
      TABLE_TRAY.object = null;
    };
  }, [mode]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const devWindow = window as unknown as {
      __trayRender?: () => void;
      __trayCamera?: THREE.Camera;
      __labScene?: THREE.Scene;
    };
    devWindow.__trayRender = () => {
      gl.render(rootScene, camera);
      invalidate();
    };
    devWindow.__trayCamera = camera;
    devWindow.__labScene = rootScene;
  }, [camera, gl, invalidate, rootScene]);
  const heldRef = useRef(false);
  /** Riding home with the camera (a cabinet's return): follows the live hand pose, easing to the table by the camera's own progress. */
  const rideRef = useRef(false);
  const rideQuaternionRef = useRef(new THREE.Quaternion());
  const heldTransferElapsedRef = useRef(0);
  const heldTransferStartScaleRef = useRef(1);
  const heldTransferStartPositionRef = useRef(new THREE.Vector3());
  const heldTransferStartQuaternionRef = useRef(new THREE.Quaternion());
  const heldTransferEndScaleRef = useRef(1);
  const heldTransferEndPositionRef = useRef(new THREE.Vector3());
  const heldTransferEndQuaternionRef = useRef(new THREE.Quaternion());
  const heldTransferPositionRef = useRef(new THREE.Vector3());
  const heldTransferQuaternionRef = useRef(new THREE.Quaternion());
  const heldReturnProjectionRef = useRef(new THREE.Vector3());
  /** This transition's own duration, set once when it starts (pickup or return) from the real start/end distance — see `trayTransitionDuration`. */
  const heldTransferDurationRef = useRef(TRAY_TRANSITION_MIN_DURATION_S);

  useEffect(() => {
    if (mode !== "held") return;
    const instance = groupRef.current;
    if (!instance) return;
    useReagentPickablesStore.getState().register("held-tray", instance);
    return () => useReagentPickablesStore.getState().unregister("held-tray");
  }, [mode]);

  const bunsenStandOnTray = useBunsenStandStorageStore((state) => state.onTray);
  const lampOnTray = useBurnerStore((state) => state.place === "tray");
  const liveTrayReagentItems = useReagentStorageStore((state) => state.trayItems);
  const inspectedId = useReagentInspectionStore((state) => state.inspectedId);
  const liveTrayTestTubeItems = useTestTubeStorageStore((state) => state.trayTestTubes);
  // The contents are one shared list that a return no longer unloads
  // (VL-017), so there is no snapshot to keep: a copy outliving the last item
  // taken off would fly home as a ghost of it.
  // Reactive (not `.getState()`) so a dev-panel change to "Reagent Scale"
  // (F8 → "Поднос в руках") re-renders this immediately, applying to
  // reagents already sitting on the tray, not just future ones. Needed as a
  // WORLD-scale compensation (not plain `scale`) because the tray group's
  // own scale actually changes (1 at rest, `heldTray.scale` while held) —
  // without compensating for that, a jar sitting on the tray would visibly
  // shrink/grow every time the tray itself gets picked up or set down,
  // which is exactly the pop a plain `scale` produced when tried.
  // Subscribe to the complete held transform, not just `reagentScale`.
  // The scene uses demand rendering, so reading the transform only through
  // `getState()` left position/scale/rotation slider changes invisible until
  // some unrelated frame happened. Replacing `heldTray` in the store now
  // re-renders this component and invalidates the canvas immediately.
  const heldTrayConfig = useNavButtonCalibrationStore((state) => state.heldTray);
  const trayReagentScale = heldTrayConfig.reagentScale;
  useEffect(() => invalidate(), [heldTrayConfig, invalidate]);
  // Reactive so a dev-panel change to the tray reagent area (F8 → "Реагенты
  // на подносе") re-centers every item already on the tray immediately.
  const trayReagentAreaConfig = useTrayReagentAreaStore((state) => state.config);
  const cabinetPhase = useSceneInteractionStore((state) => state.cabinetPhase);
  const focusedCabinetId = useSceneInteractionStore((state) => state.focusedCabinetId);
  const returnRequested = useSceneInteractionStore((state) => state.returnRequested);
  // The held copy shows its contents for as long as it is on screen itself —
  // appearing, held or flying home (`heldShown`, set by `step`) — so they ride
  // it the whole way. The phase test only prewarms them just before it appears
  // (no mount hitch); "focusing" also keeps them through a chain-arrow switch.
  const [heldShown, setHeldShown] = useState(false);
  const showHeldContents =
    heldShown ||
    ((cabinetPhase === "inspecting" || cabinetPhase === "focusing") && !returnRequested && trayHeldAt(focusedCabinetId));
  // The workbench tray is a separate, untouched scene object.  Its contents
  // stay mounted there while the held copy is animated independently.
  const showContents = mode === "table" || showHeldContents;
  const trayReagentItems = liveTrayReagentItems;
  const trayTestTubeItems = liveTrayTestTubeItems;
  const heldId = useHandStore((state) => state.held?.instanceId ?? null);
  // On the tray set down in the hood (turned to face into it), the things on
  // it are turned back round to face the player (VL-017).
  const itemYaw = mode === "held" && focusedCabinetId === "fume-hood" ? Math.PI : 0;
  const inspectedReagentPrewarm = useMemo(() => {
    if (!inspectedId || trayReagentItems.some((item) => item.instanceId === inspectedId)) return null;
    const entry = Object.entries(REAGENTS).find(([reagentId]) => inspectedId.endsWith(`-${reagentId}`));
    if (!entry) return null;
    const slotIndex = nextFreeTraySlot(trayReagentItems);
    if (slotIndex < 0) return null;
    return { instanceId: inspectedId, reagent: entry[1], slotIndex };
  }, [inspectedId, trayReagentItems]);
  // One reconciliation scope: the prewarmed copy becomes the real tray
  // item by updating props, instead of rebuilding it at the end of flight.
  const reagentDisplays = trayReagentItems.map((item, index) => ({
    id: item.instanceId,
    reagent: REAGENTS[item.reagentId as ReagentId],
    slotIndex: Number.isFinite(item.slotIndex) ? item.slotIndex : index,
    prewarm: false,
  }));
  if (inspectedReagentPrewarm) reagentDisplays.push({
    id: inspectedReagentPrewarm.instanceId,
    reagent: inspectedReagentPrewarm.reagent,
    slotIndex: inspectedReagentPrewarm.slotIndex,
    prewarm: true,
  });

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);

  useEffect(() => prepareTrayMaterials(instance), [instance]);

  // The table transform is a fixed world-space anchor. It is deliberately
  // separate from the camera-relative held-tray offsets below.
  const tablePosition = useMemo(() => new THREE.Vector3(...position), [position]);
  const tableQuaternion = useMemo(
    () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY),
    [rotationY],
  );
  const trayYawAxisRef = useRef(new THREE.Vector3(0, 1, 0));
  const trayRotationOffsetRef = useRef(new THREE.Quaternion());
  const trayRotationEulerRef = useRef(new THREE.Euler());
  const targetPositionRef = useRef(new THREE.Vector3());
  const heldTargetQuaternionRef = useRef(new THREE.Quaternion());
  const cameraRightRef = useRef(new THREE.Vector3());
  const cameraUpRef = useRef(new THREE.Vector3());
  const cameraForwardRef = useRef(new THREE.Vector3());

  const stepTray = (delta: number) => {
    const group = groupRef.current;
    if (!group) return;

    const {
      focusedCabinetId: activeCabinetId,
      cabinetPhase: activeCabinetPhase,
      returnRequested: activeReturnRequested,
      trayReturnReady: activeTrayReturnReady,
    } = useSceneInteractionStore.getState();
    const eligible = trayHeldAt(activeCabinetId);
    // The table tray is permanently fixed and is never touched by held-tray
    // calibration or fade state.
    if (mode === "table") {
      // Hide the stowed copy only while the separate held copy is out (it
      // flies from this exact pose and lands back on it): both visible read
      // as a duplicate tray, neither as a vanished one. The held copy steps
      // first (priority below), so this is never a frame behind it.
      group.visible = !HELD_TRAY.shown;
      group.position.copy(tablePosition);
      group.quaternion.copy(tableQuaternion);
      group.scale.setScalar(1);
      return;
    }

    // A fresh approach's own tray can start a little before the camera
    // tween actually finishes — see `NEAR_ARRIVAL_DISTANCE_SQ`'s doc — once
    // the live camera position is close enough to where it's flying to.
    let nearingArrival = false;
    if (!activeReturnRequested && eligible && activeCabinetPhase === "focusing" && !heldRef.current && activeCabinetId) {
      const target = getEffectiveInspectionTarget(activeCabinetId as Exclude<HotspotTargetId, "table">);
      const [tx, ty, tz] = target.position;
      const dx = camera.position.x - tx;
      const dy = camera.position.y - ty;
      const dz = camera.position.z - tz;
      nearingArrival = dx * dx + dy * dy + dz * dz < NEAR_ARRIVAL_DISTANCE_SQ;
    }
    // A chain-arrow switch re-enters "focusing" (see `CameraRig.startSwitchingCabinet`)
    // while the tray was already held — `heldRef.current` (this frame's
    // PREVIOUS value, not yet updated below) distinguishes that from a
    // genuine fresh approach to a cabinet from the room, which must still
    // wait for "inspecting" (or `nearingArrival`) before the tray appears at all.
    const held =
      !activeReturnRequested &&
      eligible &&
      (activeCabinetPhase === "inspecting" || (activeCabinetPhase === "focusing" && (heldRef.current || nearingArrival)));
    const heldTray = heldTrayConfig;

    // Compute the calibrated hand pose from the current camera before edge
    // detection.  The camera is already settled when `held` becomes true;
    // during return it is still settled until this tray has left the frame.
    const rotationOffset = trayRotationOffsetRef.current.setFromEuler(
      trayRotationEulerRef.current.set(heldTray.rotX, heldTray.rotY, heldTray.rotZ, "YXZ"),
    );
    const cameraRight = cameraRightRef.current.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const cameraUp = cameraUpRef.current.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const cameraForward = cameraForwardRef.current.set(0, 0, -1).applyQuaternion(camera.quaternion);
    targetPositionRef.current
      .copy(camera.position)
      .addScaledVector(cameraRight, heldTray.x)
      .addScaledVector(cameraUp, heldTray.y)
      .addScaledVector(cameraForward, heldTray.z);
    const cabinetYaw = getCabinetParallelTrayYaw(activeCabinetId, rotationY);
    heldTargetQuaternionRef.current
      .setFromAxisAngle(trayYawAxisRef.current, cabinetYaw)
      .multiply(rotationOffset);
    // At the fume hood it is not held up to the camera: it is set down on the
    // left of the worktop, its long side running into the hood (`hoodLayout`).
    if (activeCabinetId === "fume-hood") hoodTrayWorldPose(targetPositionRef.current, heldTargetQuaternionRef.current);
    const heldScale = heldTray.scale;
    // Stowed = sitting at rest on the table, not "behind the camera" — the
    // held tray should read as coming from/going back to the table itself,
    // not materializing out of the player's body. Both `mode` instances
    // share the same `position`/`rotationY` props (see `Laboratory.tsx`), so
    // `tablePosition`/`tableQuaternion` is this same tray's real table pose.
    heldTransferEndPositionRef.current.copy(tablePosition);
    heldTransferEndQuaternionRef.current.copy(tableQuaternion);
    heldTransferEndScaleRef.current = 1;

    if (activeReturnRequested && !activeTrayReturnReady && !heldRef.current && heldTransferElapsedRef.current === 0) {
      useSceneInteractionStore.getState().markTrayReturnReady();
    }

    if (held && !heldRef.current) {
      // Taken again while still flying home: carry on from where it is now,
      // not from the table — that would be a jump.
      const resuming = group.visible && (heldTransferElapsedRef.current > 0 || rideRef.current);
      rideRef.current = false;
      heldRef.current = true;
      heldTransferElapsedRef.current = 0;
      if (resuming) {
        heldTransferStartScaleRef.current = group.scale.x;
        heldTransferStartPositionRef.current.copy(group.position);
        heldTransferStartQuaternionRef.current.copy(group.quaternion);
      } else {
        heldTransferStartScaleRef.current = heldTransferEndScaleRef.current;
        heldTransferStartPositionRef.current.copy(heldTransferEndPositionRef.current);
        heldTransferStartQuaternionRef.current.copy(heldTransferEndQuaternionRef.current);
      }
      heldTransferDurationRef.current = trayTransitionDuration(
        heldTransferStartPositionRef.current.distanceTo(targetPositionRef.current),
        TRAY_APPEAR_MAX_DURATION_S,
      );
      group.visible = true;
      group.position.copy(heldTransferStartPositionRef.current);
      group.quaternion.copy(heldTransferStartQuaternionRef.current);
      group.scale.setScalar(heldTransferStartScaleRef.current);
    } else if (!held && heldRef.current && activeReturnRequested && activeCabinetId !== "fume-hood") {
      // Leaving a cabinet: the tray stays in the hand and goes home WITH the
      // camera (`CABINET_RETURN`), landing on the table as it comes into view.
      // The camera may start at once. (Flying home alone, in a fixed time,
      // took the tray and what is on it out of frame while the camera still
      // looked at the cabinet — it read as everything vanishing.)
      heldRef.current = false;
      rideRef.current = true;
      rideQuaternionRef.current.copy(group.quaternion);
      CABINET_RETURN.progress = 0;
      heldTransferElapsedRef.current = 0;
      useSceneInteractionStore.getState().markTrayReturnReady();
    } else if (!held && heldRef.current) {
      // Return begins after the state changes away from `inspecting`: move
      // this separate hand tray back down to the table before CameraRig
      // moves. The workbench tray is never involved in this transfer.
      heldRef.current = false;
      heldTransferStartScaleRef.current = group.scale.x;
      heldTransferStartPositionRef.current.copy(group.position);
      heldTransferStartQuaternionRef.current.copy(group.quaternion);
      heldTransferEndScaleRef.current = 1;
      heldTransferEndPositionRef.current.copy(tablePosition);
      heldTransferEndQuaternionRef.current.copy(tableQuaternion);
      heldTransferDurationRef.current = trayTransitionDuration(
        heldTransferStartPositionRef.current.distanceTo(heldTransferEndPositionRef.current),
        TRAY_RETURN_MAX_DURATION_S,
      );
      heldTransferElapsedRef.current = heldTransferDurationRef.current;
    }

    if (rideRef.current) {
      group.visible = true;
      const progress = activeCabinetPhase === "returning" ? CABINET_RETURN.progress : 0;
      if (progress >= 1 || activeCabinetPhase === "room") {
        rideRef.current = false;
        group.visible = false;
        group.scale.setScalar(0);
        return;
      }
      group.position.lerpVectors(targetPositionRef.current, tablePosition, progress);
      group.quaternion.slerpQuaternions(rideQuaternionRef.current, tableQuaternion, progress);
      group.scale.setScalar(THREE.MathUtils.lerp(heldScale, 1, progress));
      return;
    }

    if (held) {
      heldTransferElapsedRef.current = Math.min(heldTransferDurationRef.current, heldTransferElapsedRef.current + delta);
      const fadeT = THREE.MathUtils.smoothstep(
        heldTransferElapsedRef.current / heldTransferDurationRef.current,
        0,
        1,
      );
      group.visible = true;
      if (fadeT < 1) {
        // Fresh pickup: the dedicated from-table appearance tween, unchanged.
        heldTransferPositionRef.current.lerpVectors(
          heldTransferStartPositionRef.current,
          targetPositionRef.current,
          fadeT,
        );
        heldTransferQuaternionRef.current.slerpQuaternions(
          heldTransferStartQuaternionRef.current,
          heldTargetQuaternionRef.current,
          fadeT,
        );
        group.position.copy(heldTransferPositionRef.current);
        group.quaternion.copy(heldTransferQuaternionRef.current);
        group.scale.setScalar(THREE.MathUtils.lerp(heldTransferStartScaleRef.current, heldScale, fadeT));
      } else {
        // Steady hold / cabinet-to-cabinet transition: position tracks the
        // live camera pose exactly every frame (already "follows the
        // camera"), but orientation damps toward the new cabinet-parallel
        // yaw instead of snapping — see `SWITCH_FOLLOW_DAMPING`'s doc. For
        // ordinary steady holding (no cabinet change) the target doesn't
        // move frame to frame, so this converges to and stays at the exact
        // same pose the old instant snap did — no visible difference there.
        group.position.copy(targetPositionRef.current);
        group.quaternion.slerp(heldTargetQuaternionRef.current, 1 - Math.exp(-SWITCH_FOLLOW_DAMPING * delta));
        group.scale.setScalar(heldScale);
      }
      return;
    }

    if (heldTransferElapsedRef.current > 0) {
      heldTransferElapsedRef.current = Math.max(0, heldTransferElapsedRef.current - delta);
      const fadeT = THREE.MathUtils.smoothstep(
        heldTransferElapsedRef.current / heldTransferDurationRef.current,
        0,
        1,
      );
      group.visible = true;
      heldTransferPositionRef.current.lerpVectors(
        heldTransferEndPositionRef.current,
        heldTransferStartPositionRef.current,
        fadeT,
      );
      heldTransferQuaternionRef.current.slerpQuaternions(
        heldTransferEndQuaternionRef.current,
        heldTransferStartQuaternionRef.current,
        fadeT,
      );
      group.position.copy(heldTransferPositionRef.current);
      group.quaternion.copy(heldTransferQuaternionRef.current);
      group.scale.setScalar(
        THREE.MathUtils.lerp(heldTransferEndScaleRef.current, heldTransferStartScaleRef.current, fadeT),
      );
      // Out of the camera's frame (or home) the camera may start back: the
      // tray keeps flying to the table pose either way, and only there is it
      // handed to the table copy, so it never pops out or in.
      group.updateMatrixWorld(true);
      const projected = heldReturnProjectionRef.current
        .copy(group.getWorldPosition(heldReturnProjectionRef.current))
        .project(camera);
      const outsideCameraFrame =
        projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
      if (heldTransferElapsedRef.current === 0) group.visible = false;
      if (heldTransferElapsedRef.current === 0 || outsideCameraFrame) {
        useSceneInteractionStore.getState().markTrayReturnReady();
      }
      return;
    }

    group.visible = false;
    group.scale.setScalar(0);
  };

  // Priority -1 (not the default 0 every child `ReagentStaticDisplay` uses)
  // guarantees this runs BEFORE them each frame — R3F sorts subscribers by
  // priority ascending, and a negative priority still gets that ordering
  // without tripping the `priority > 0` "you own manual rendering now"
  // behavior. Needed so a reagent's own scale-compensation `useFrame` (see
  // its doc) can read this group's `.scale` directly, already up to date
  // for the CURRENT frame, instead of the one-frame-stale value
  // `getWorldScale()`/`matrixWorld` would give before this renders.
  const step = (delta = 1 / 60) => {
    stepTray(delta);
    if (mode !== "held") return;
    const shown = groupRef.current?.visible ?? false;
    if (shown === HELD_TRAY.shown) return;
    HELD_TRAY.shown = shown;
    setHeldShown(shown);
  };
  // The held copy steps before the table copy, which reads `HELD_TRAY` it sets.
  useFrame((_, delta) => step(delta), mode === "held" ? -2 : -1);
  useEffect(() => {
    if (mode !== "held") return;
    return () => {
      HELD_TRAY.shown = false;
    };
  }, [mode]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const hooks = window as unknown as Record<string, ((delta?: number) => void) | undefined>;
    hooks.__trayStep = step;
    hooks[mode === "held" ? "__trayStepHeld" : "__trayStepTable"] = step;
  });

  return (
    <group ref={groupRef} name={`lab-tray-${mode}`} position={position} rotation={[0, rotationY, 0]}>
      {/* The test tube rack is now glued directly into `LabTray_Metal.glb` itself (see the Blender source) at this same `stopperHolderConfig` transform, instead of being rendered here as a separate `LabTestTubeRackInstance` — no more runtime drift between the two. `stopperHolderConfig` is still read below, purely as the geometric anchor `computeTubeSlotPosition` needs to place tubes into the (now-baked-in) rack's holes. */}
      <primitive object={instance} />
      {/* Taken reagents currently riding the tray — same "local to the tray group" trick as the stopper holder, fixed physical slots computed live from the dev-tunable tray reagent area (see `computeTrayReagentPosition`'s doc for the geometry). Each item's `slotIndex` (assigned once at take-time, see its doc in `useReagentStorageStore`) — NOT its position in this array — picks the slot, so returning one jar never reshuffles or jumps the others still on the tray (a dynamically re-centering layout was tried and reverted — it made a jar's row/column jump unpredictably whenever an unrelated jar elsewhere in the list was returned). `worldScale` (not a plain `scale`) holds every tray reagent at the SAME dev-tunable "Reagent Scale" (`heldTray.reagentScale`, now 1 — true size, was 0.4) regardless of the tray's own live scale (1 at rest, `heldTray.scale` while held) — dropping this compensation made the jar visibly shrink/grow every time the tray itself got picked up or set down, since it would otherwise multiply by the tray's own changing scale. */}
      {showContents && reagentDisplays.map((item) => {
        const position = computeTrayReagentPosition(trayReagentAreaConfig, item.slotIndex);
        return (
          // At the table or the hood a press takes it into the hand, to be set
          // down in its place there (VL-017/018); in a cabinet a click sends it back to its shelf.
          <PourMotion key={item.id} instanceId={item.id} pourPointHeight={0} position={position} keepCap onTray>
            <ReagentStaticDisplay
              reagent={item.reagent}
              rotationY={itemYaw}
              worldScale={item.prewarm ? 0.0001 : trayReagentScale}
              instanceId={item.prewarm ? undefined : item.id}
              highlighted={heldId === item.id}
              onPointerDown={(event) => {
                if (!trayUnloadPlace()) return;
                event.stopPropagation();
                pressToTake(event.nativeEvent, () => takeFromTray("bottle", item.id));
              }}
              // Taken on the press already; the click that ends it is not a «back to the shelf».
              onActivate={() => trayUnloadPlace() !== null}
              onHoverChange={(hovered) => {
                if (hovered && trayUnloadPlace()) useStandHintStore.getState().showLabel(item.id, TAKE_FROM_TRAY, { kind: "bottle", reagentId: item.reagent.id, place: "tray" });
                else useStandHintStore.getState().hide(item.id);
              }}
            />
          </PourMotion>
        );
      })}
      {/* Taken test tubes — no separate container: they stand in the SAME
          modeled rack above, in its 16 insert collars, see
          `computeTubeSlotPosition`'s doc. Deliberately plain `scale` (NOT
          `worldScale`/`trayReagentScale`) — unlike a reagent, which can sit
          anywhere on the tray and so gets held at a constant, calibrated
          viewing size regardless of the tray's own live scale, a tube must
          physically fit through the rack's fixed holes. The rack is glued
          into this same tray group at its own true (unscaled) size, so the
          tube needs to scale together WITH the tray (1 at rest, `heldTray.scale`
          while held) to keep matching those holes — `worldScale` held it at
          a constant ~40% (`heldTray.reagentScale`, a bottle-calibrated
          value) regardless, which is exactly why it looked too small. */}
      {showContents && trayTestTubeItems.map((item, index) => (
        <group
          key={item.instanceId}
          // At the table or the hood a press takes it into the hand (VL-017/018).
          onPointerDown={(event: ThreeEvent<PointerEvent>) => {
            if (!trayUnloadPlace() || useReagentInspectionStore.getState().inspectedId) return;
            event.stopPropagation();
            document.body.style.cursor = "auto";
            pressToTake(event.nativeEvent, () => takeFromTray("tube", item.instanceId));
          }}
          onClick={(event: ThreeEvent<MouseEvent>) => {
            if (trayUnloadPlace()) event.stopPropagation();
          }}
          onPointerOver={(event: ThreeEvent<PointerEvent>) => {
            if (!trayUnloadPlace()) return;
            event.stopPropagation();
            document.body.style.cursor = "pointer";
            useStandHintStore.getState().showLabel(item.instanceId, TAKE_FROM_TRAY, { kind: "tube", place: "tray", instanceId: item.instanceId });
          }}
          onPointerOut={() => {
            useStandHintStore.getState().hide(item.instanceId);
            document.body.style.cursor = "auto";
          }}
        >
          <PourMotion instanceId={item.instanceId} pourPointHeight={0} position={computeTubeSlotPosition(TRAY_RACK_ANCHOR, index)} onTray>
            <GlassRim active={heldId === item.instanceId}>
              <LabTestTubeInstance contents={item.contents} />
            </GlassRim>
          </PourMotion>
        </group>
      ))}
      {/* The Bunsen stand — only one exists, so this is a plain boolean flag
          (`useBunsenStandStorageStore`), not a per-instance list like the
          reagent/test-tube stores above. Same `showContents` gate (hidden
          off-screen/mid-transition the same way those are). */}
      {showContents && bunsenStandOnTray && <BunsenStandTrayDisplay rotationY={itemYaw} />}
      {showContents && lampOnTray && <SpiritLampTrayDisplay rotationY={itemYaw} />}
      {mode === "table" && <TrayReturnZone />}
    </group>
  );
}

useGLTF.preload(MODEL_PATH);
