import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
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
import { REAGENTS, type ReagentId } from "../../../entities/laboratory/reagents";
import { BunsenStandTrayDisplay } from "./BunsenStandTrayDisplay";
import { LabTestTubeInstance } from "./LabTestTubeInstance";
import { ReagentStaticDisplay } from "./ReagentStaticDisplay";
import { TrayReturnZone } from "./TrayReturnZone";
import { prepareTrayMaterials } from "../lib/trayMaterials";

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
 * own doc). `isHeldTrayReturning` (`cabinetPhase === "returning"`) is what
 * keeps reagents/test-tubes riding the tray visible through the WHOLE
 * fly-back (see that flag's doc below); if the tray's own return tween ran
 * longer than CameraRig's camera tween, `cabinetPhase` would flip back to
 * "room" while the tray was still physically flying, and the jars/tubes
 * would vanish mid-flight instead of riding it home. Matches
 * `TRAY_APPEAR_MAX_DURATION_S` now, per a request for the same slowness both
 * ways — previously kept lower (0.65) purely because `RETURN_DURATION_MS`
 * hadn't been raised enough yet to safely fit the appear ceiling too.
 */
const TRAY_RETURN_MAX_DURATION_S = 0.85;
/** See the return branch's own comment — fraction of the return (in `fadeT` terms, 0..1) over which the tray shrinks to nothing at the tail end, instead of popping from full scale straight to invisible. */
const TRAY_RETURN_VANISH_FRACTION = 0.15;

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
  const liveTrayReagentItems = useReagentStorageStore((state) => state.trayItems);
  const inspectedId = useReagentInspectionStore((state) => state.inspectedId);
  const liveTrayTestTubeItems = useTestTubeStorageStore((state) => state.trayTestTubes);
  // `CameraRig.startReturning()` moves everything from `trayItems`/
  // `trayTestTubes` into the workbench store SYNCHRONOUSLY on the return
  // flight's first frame (see its doc — a deliberate no-mount-hitch choice),
  // which emptied these live lists instantly. The held tray's own shrink/fly
  // animation below (`trayTransitionDuration`) keeps running for a bit
  // longer, so it was rendering an already-empty tray for the rest of that
  // flight — the jars visibly vanished before the tray finished leaving,
  // instead of shrinking away together. Keep the last non-empty snapshot
  // around and fall back to it while `mode === "held"` is still animating
  // its own return, so the (now-duplicated, briefly-in-two-places) jars ride
  // the tray out instead of popping out of existence.
  // Adjusted during render (not an effect, and not a plain ref read during
  // render — both disallowed here) so the snapshot is never one frame stale.
  const [trayReagentSnapshot, setTrayReagentSnapshot] = useState(liveTrayReagentItems);
  if (liveTrayReagentItems.length > 0 && liveTrayReagentItems !== trayReagentSnapshot) {
    setTrayReagentSnapshot(liveTrayReagentItems);
  }
  const [trayTestTubeSnapshot, setTrayTestTubeSnapshot] = useState(liveTrayTestTubeItems);
  if (liveTrayTestTubeItems.length > 0 && liveTrayTestTubeItems !== trayTestTubeSnapshot) {
    setTrayTestTubeSnapshot(liveTrayTestTubeItems);
  }
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
  // Covers the held tray's own shrink/fly-back window (`trayTransitionDuration`,
  // capped at `TRAY_RETURN_MAX_DURATION_S`) — `cabinetPhase` stays
  // "returning" for `CameraRig`'s own (longer, 1s) camera tween, so this
  // reliably spans it.
  const isHeldTrayReturning = mode === "held" && cabinetPhase === "returning";
  // "focusing" is included alongside "inspecting" so a chain-arrow switch's
  // camera-flight window doesn't blank out reagents/tubes already riding the
  // tray — a genuine first approach to a cabinet has nothing taken yet
  // regardless (trayItems/trayTestTubeItems are empty), so this never shows
  // contents prematurely, only keeps already-taken ones visible through a
  // switch (see the module doc's "chain-arrow switch" paragraph).
  const showHeldContents =
    ((cabinetPhase === "inspecting" || cabinetPhase === "focusing") &&
      !returnRequested &&
      isTrayHeldEligible(focusedCabinetId)) ||
    isHeldTrayReturning;
  // The workbench tray is a separate, untouched scene object.  Its contents
  // stay mounted there while the held copy is animated independently.
  const showContents = mode === "table" || showHeldContents;
  const trayReagentItems =
    isHeldTrayReturning && liveTrayReagentItems.length === 0
      ? trayReagentSnapshot
      : liveTrayReagentItems;
  const trayTestTubeItems =
    isHeldTrayReturning && liveTrayTestTubeItems.length === 0
      ? trayTestTubeSnapshot
      : liveTrayTestTubeItems;
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

  const step = (delta = 1 / 60) => {
    const group = groupRef.current;
    if (!group) return;

    const {
      focusedCabinetId: activeCabinetId,
      cabinetPhase: activeCabinetPhase,
      returnRequested: activeReturnRequested,
      trayReturnReady: activeTrayReturnReady,
    } = useSceneInteractionStore.getState();
    const eligible = isTrayHeldEligible(activeCabinetId);
    // The table tray is permanently fixed and is never touched by held-tray
    // calibration or fade state.
    if (mode === "table") {
      // Hide the stowed copy for the whole cabinet interaction. The separate
      // held copy is the one that physically flies out from this exact pose;
      // keeping both visible made the pickup/return read as a duplicate tray.
      group.visible = !(eligible && (activeCabinetPhase !== "room" || activeReturnRequested));
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
      heldRef.current = true;
      heldTransferElapsedRef.current = 0;
      heldTransferStartScaleRef.current = heldTransferEndScaleRef.current;
      heldTransferStartPositionRef.current.copy(heldTransferEndPositionRef.current);
      heldTransferStartQuaternionRef.current.copy(heldTransferEndQuaternionRef.current);
      heldTransferDurationRef.current = trayTransitionDuration(
        heldTransferStartPositionRef.current.distanceTo(targetPositionRef.current),
        TRAY_APPEAR_MAX_DURATION_S,
      );
      group.visible = true;
      group.position.copy(heldTransferStartPositionRef.current);
      group.quaternion.copy(heldTransferStartQuaternionRef.current);
      group.scale.setScalar(heldTransferStartScaleRef.current);
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
        group.scale.setScalar(THREE.MathUtils.lerp(heldTransferStartScaleRef.current, heldTray.scale, fadeT));
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
        group.scale.setScalar(heldTray.scale);
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
      // Shrink to nothing over the LAST `TRAY_RETURN_VANISH_FRACTION` of the
      // return (fadeT is 1 at the start of the return, 0 at the natural
      // end/table-arrival) — on top of the normal grow-back-to-rest-scale
      // lerp above. Without this, a return that reaches its own natural end
      // while still inside the camera's frame (more likely now that the
      // return got slower) popped from full rest scale straight to nothing;
      // this makes that read as a quick shrink instead of a hard cut, while
      // changing nothing for the common case where `outsideCameraFrame`
      // below hides it first, off-screen, well before fadeT gets this low.
      const vanishFactor = THREE.MathUtils.smoothstep(fadeT, 0, TRAY_RETURN_VANISH_FRACTION);
      group.scale.setScalar(
        THREE.MathUtils.lerp(heldTransferEndScaleRef.current, heldTransferStartScaleRef.current, fadeT) * vanishFactor,
      );
      // The instant the tray leaves the camera's actual frame (or its own
      // timer/shrink above finishes), hide it and unblock the camera return.
      group.updateMatrixWorld(true);
      const projected = heldReturnProjectionRef.current
        .copy(group.getWorldPosition(heldReturnProjectionRef.current))
        .project(camera);
      const outsideCameraFrame =
        projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
      if (heldTransferElapsedRef.current === 0 || outsideCameraFrame) {
        group.visible = false;
        heldTransferElapsedRef.current = 0;
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
  useFrame((_, delta) => step(delta), -1);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __trayStep?: (delta?: number) => void }).__trayStep = step;
  });

  return (
    <group ref={groupRef} name={`lab-tray-${mode}`} position={position} rotation={[0, rotationY, 0]}>
      {/* The test tube rack is now glued directly into `LabTray_Metal.glb` itself (see the Blender source) at this same `stopperHolderConfig` transform, instead of being rendered here as a separate `LabTestTubeRackInstance` — no more runtime drift between the two. `stopperHolderConfig` is still read below, purely as the geometric anchor `computeTubeSlotPosition` needs to place tubes into the (now-baked-in) rack's holes. */}
      <primitive object={instance} />
      {/* Taken reagents currently riding the tray — same "local to the tray group" trick as the stopper holder, fixed physical slots computed live from the dev-tunable tray reagent area (see `computeTrayReagentPosition`'s doc for the geometry). Each item's `slotIndex` (assigned once at take-time, see its doc in `useReagentStorageStore`) — NOT its position in this array — picks the slot, so returning one jar never reshuffles or jumps the others still on the tray (a dynamically re-centering layout was tried and reverted — it made a jar's row/column jump unpredictably whenever an unrelated jar elsewhere in the list was returned). `worldScale` (not a plain `scale`) holds every tray reagent at the SAME dev-tunable "Reagent Scale" (`heldTray.reagentScale`, now 1 — true size, was 0.4) regardless of the tray's own live scale (1 at rest, `heldTray.scale` while held) — dropping this compensation made the jar visibly shrink/grow every time the tray itself got picked up or set down, since it would otherwise multiply by the tray's own changing scale. */}
      {showContents && reagentDisplays.map((item) => {
        const position = computeTrayReagentPosition(trayReagentAreaConfig, item.slotIndex);
        return (
          <ReagentStaticDisplay
            key={item.id}
            reagent={item.reagent}
            position={position}
            worldScale={item.prewarm ? 0.0001 : trayReagentScale}
            instanceId={item.prewarm ? undefined : item.id}
          />
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
        <LabTestTubeInstance
          key={item.instanceId}
          position={computeTubeSlotPosition(TRAY_RACK_ANCHOR, index)}
        />
      ))}
      {/* The Bunsen stand — only one exists, so this is a plain boolean flag
          (`useBunsenStandStorageStore`), not a per-instance list like the
          reagent/test-tube stores above. Same `showContents` gate (hidden
          off-screen/mid-transition the same way those are). */}
      {showContents && bunsenStandOnTray && <BunsenStandTrayDisplay />}
      {mode === "table" && <TrayReturnZone />}
    </group>
  );
}

useGLTF.preload(MODEL_PATH);
