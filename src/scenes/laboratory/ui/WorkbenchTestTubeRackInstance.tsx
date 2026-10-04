import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";
import { useReagentInspectionStore } from "../lib/useReagentInspectionStore";
import { useReagentPickablesStore } from "../lib/useReagentPickablesStore";
import { useStopperHolderStore } from "../lib/useStopperHolderStore";
import { sharedMouseNdc, useTestTubeDragStore } from "../lib/useTestTubeDragStore";
import {
  computeTubeSlotLocalOffset,
  TEST_TUBE_TRAY_CAPACITY,
  useTestTubeStorageStore,
} from "../lib/useTestTubeStorageStore";
import { InspectableTestTubeSlot } from "./InspectableTestTubeSlot";
import { LabTestTubeRackInstance } from "./LabTestTubeRackInstance";

const INSTANCE_ID = "workbench-test-tube-rack";

/** Same damping rate `ReagentContainerInstance` uses for its own shelf<->stage moves — reaches ~95% of the way to a target in about 0.5s. */
const MOVE_DAMPING = 6;
/** Small vertical clearance the rack lifts off the workbench before heading to the inspection stage, same role as `ReagentContainerInstance`'s own `PICKUP_LIFT`. */
const PICKUP_LIFT = 0.02;
/** "Close enough to home" threshold for handing a phase off to the next one / reporting the return as finished. */
const RETURN_POSITION_EPSILON = 0.01;

const WORKBENCH_TUBE_SLOT_INDICES = Array.from({ length: TEST_TUBE_TRAY_CAPACITY }, (_, index) => index);
/** Computed once, module scope — a stable array reference so passing these as each slot's `position` prop never fights the slot's own imperative hover-raise (see `InspectableTestTubeSlot`'s doc). */
const TUBE_SLOT_LOCAL_OFFSETS = WORKBENCH_TUBE_SLOT_INDICES.map((index) => computeTubeSlotLocalOffset(index));

type Phase = "atRest" | "pickupLift" | "inspecting" | "returnMove" | "returnLower";

/**
 * Makes the workbench test tube rack (`LabTestTubeRackInstance` at its
 * `useStopperHolderStore` placement) clickable using the SAME hover +
 * click-to-inspect MECHANISM `ReagentContainerInstance` uses for reagent
 * jars: hover shows a Fresnel rim, a click lifts it off the bench and moves
 * it to a camera-relative stage, then ОСТАВИТЬ (or ESC) flies it back to its
 * exact bench transform. Fixed-angle only — unlike a reagent bottle, there's
 * no drag-to-rotate while inspecting (removed per the player's call), so
 * `useStopperHolderStore`'s `inspectionStage.tiltX` has to already frame the
 * whole 8×2 hole grid on its own.
 *
 * Each tube standing in the rack (`InspectableTestTubeSlot`, rendered as a
 * child below) becomes individually hoverable — raises slightly, lights up,
 * and reports its contents via `useTestTubeHoverStore` for
 * `ReagentInspectionOverlay`'s tooltip — ONLY while the rack itself is being
 * inspected.
 *
 * Unlike a round bottle — which can just keep its shelf orientation once
 * lifted, since that already faces the camera by construction — the rack
 * rests flat with its 16 holes facing straight up, so it needs its OWN
 * dev-tunable stage transform (`useStopperHolderStore`'s `inspectionStage`,
 * F8 → "Держатели пробок" → "ОСМОТР: КУДА ЛЕТИТ ДЕРЖАТЕЛЬ") instead of the
 * shared `inspectionBottle` stage: a separate camera-relative offset (pushed
 * further back/higher, since the rack is much wider than a bottle) plus a
 * `tiltX` applied about the camera's own right axis on top of "face the
 * camera", tipping the hole grid toward the player instead of leaving it
 * edge-on — see `handleClick`.
 *
 * Opened with `kind: "holder"` — unlike a reagent or a test tube, there is
 * nothing to take from a fixed piece of furniture, so
 * `ReagentInspectionOverlay` hides the ВЗЯТЬ button for this `kind` and this
 * component only ever needs to handle the close/return half of the flow.
 */
export function WorkbenchTestTubeRackInstance() {
  const config = useStopperHolderStore((state) => state.holders.workbench);
  const tablePosition = useFurniturePositionStore((state) => state.getOverride("table").position);
  const { camera, gl } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const inspectedId = useReagentInspectionStore((state) => state.inspectedId);
  const isClosing = useReagentInspectionStore((state) => state.isClosing);
  const isInspected = inspectedId === INSTANCE_ID;
  const anyInspected = inspectedId !== null;

  useEffect(() => {
    const instance = groupRef.current;
    if (!instance) return;
    useReagentPickablesStore.getState().register("workbench-stopper-holder", instance);
    return () => useReagentPickablesStore.getState().unregister("workbench-stopper-holder");
  }, []);

  // A single always-on tracker for `sharedMouseNdc` (see its own doc) —
  // this component is mounted for the scene's whole lifetime, so a tube
  // that becomes held at any point already has an up-to-date cursor
  // position waiting for it instead of starting from (0, 0).
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      // Under Pointer Lock the cursor is frozen: the hand steers the carry then (`HandController`).
      if (document.pointerLockElement) return;
      const rect = gl.domElement.getBoundingClientRect();
      sharedMouseNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [gl]);


  const homePosition = useMemo(
    () => new THREE.Vector3(tablePosition[0] + config.x, tablePosition[1] + config.y, tablePosition[2] + config.z),
    [tablePosition, config.x, config.y, config.z],
  );
  const homeQuaternion = useMemo(
    () => new THREE.Quaternion().setFromEuler(new THREE.Euler(config.rotX, config.rotY, config.rotZ, "XYZ")),
    [config.rotX, config.rotY, config.rotZ],
  );
  const positionArray = useMemo<readonly [number, number, number]>(
    () => [homePosition.x, homePosition.y, homePosition.z],
    [homePosition],
  );
  const rotationArray = useMemo<readonly [number, number, number]>(
    () => [config.rotX, config.rotY, config.rotZ],
    [config.rotX, config.rotY, config.rotZ],
  );

  // Stage transform converted into this group's PARENT-local space once per
  // open, same reasoning as `ReagentContainerInstance`'s own `localStageRef`.
  const localStageRef = useRef({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
  const stageScaleRef = useRef(1);
  useEffect(() => {
    if (!isInspected) return;
    const group = groupRef.current;
    if (!group?.parent) return;
    const { stagePosition, stageQuaternion, stageScale } = useReagentInspectionStore.getState();
    const worldPos = new THREE.Vector3(...stagePosition);
    const worldQuat = new THREE.Quaternion(...stageQuaternion);
    localStageRef.current.position.copy(group.parent.worldToLocal(worldPos));
    const parentWorldQuat = new THREE.Quaternion();
    group.parent.getWorldQuaternion(parentWorldQuat);
    localStageRef.current.quaternion.copy(parentWorldQuat.invert().multiply(worldQuat));
    stageScaleRef.current = stageScale;
  }, [isInspected]);

  const phaseRef = useRef<Phase>("atRest");
  const wasInspectedRef = useRef(false);
  useEffect(() => {
    if (isInspected && !isClosing) {
      phaseRef.current = "pickupLift";
      wasInspectedRef.current = true;
    } else if (isInspected && isClosing && wasInspectedRef.current) {
      phaseRef.current = "returnMove";
      wasInspectedRef.current = false;
    }
  }, [isInspected, isClosing]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const phase = phaseRef.current;

    if (phase === "atRest") {
      group.position.x = THREE.MathUtils.damp(group.position.x, homePosition.x, MOVE_DAMPING, delta);
      group.position.y = THREE.MathUtils.damp(group.position.y, homePosition.y, MOVE_DAMPING, delta);
      group.position.z = THREE.MathUtils.damp(group.position.z, homePosition.z, MOVE_DAMPING, delta);
      group.quaternion.slerp(homeQuaternion, 1 - Math.exp(-MOVE_DAMPING * delta));
      group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, config.scale, MOVE_DAMPING, delta));
      return;
    }

    const liftedY = homePosition.y + PICKUP_LIFT;

    // STEP A: raise straight up only — mirrors `ReagentContainerInstance`'s
    // "pickupLift" so the rack can never sweep sideways through anything
    // sitting on the bench next to it.
    if (phase === "pickupLift") {
      group.position.x = THREE.MathUtils.damp(group.position.x, homePosition.x, MOVE_DAMPING, delta);
      group.position.y = THREE.MathUtils.damp(group.position.y, liftedY, MOVE_DAMPING, delta);
      group.position.z = THREE.MathUtils.damp(group.position.z, homePosition.z, MOVE_DAMPING, delta);
      group.quaternion.slerp(homeQuaternion, 1 - Math.exp(-MOVE_DAMPING * delta));
      group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, config.scale, MOVE_DAMPING, delta));
      if (Math.abs(group.position.y - liftedY) < RETURN_POSITION_EPSILON) {
        group.position.y = liftedY;
        phaseRef.current = "inspecting";
      }
      return;
    }

    // Reverse of STEP A: lower straight down from the lifted waypoint onto
    // the exact bench transform, then snap and report done.
    if (phase === "returnLower") {
      group.position.y = THREE.MathUtils.damp(group.position.y, homePosition.y, MOVE_DAMPING, delta);
      if (Math.abs(group.position.y - homePosition.y) < RETURN_POSITION_EPSILON) {
        group.position.copy(homePosition);
        group.quaternion.copy(homeQuaternion);
        group.scale.setScalar(config.scale);
        phaseRef.current = "atRest";
        useReagentInspectionStore.getState().finishClose();
        // A tube clicked from the button grid while inspecting only
        // actually becomes "held" (following the cursor) once the rack has
        // fully landed back on the bench — see `useTestTubeDragStore`'s
        // `pendingPickInstanceId` doc. A no-op if nothing is pending.
        useTestTubeDragStore.getState().promotePendingPick();
      }
      return;
    }

    // Reverse of the stage move: move+shrink back to the same lifted
    // waypoint above the bench spot, then hand off to "returnLower".
    if (phase === "returnMove") {
      group.position.x = THREE.MathUtils.damp(group.position.x, homePosition.x, MOVE_DAMPING, delta);
      group.position.y = THREE.MathUtils.damp(group.position.y, liftedY, MOVE_DAMPING, delta);
      group.position.z = THREE.MathUtils.damp(group.position.z, homePosition.z, MOVE_DAMPING, delta);
      group.quaternion.slerp(homeQuaternion, 1 - Math.exp(-MOVE_DAMPING * delta));
      group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, config.scale, MOVE_DAMPING, delta));
      if (
        Math.abs(group.position.y - liftedY) < RETURN_POSITION_EPSILON &&
        Math.abs(group.position.x - homePosition.x) < RETURN_POSITION_EPSILON &&
        Math.abs(group.position.z - homePosition.z) < RETURN_POSITION_EPSILON
      ) {
        group.position.set(homePosition.x, liftedY, homePosition.z);
        group.quaternion.copy(homeQuaternion);
        group.scale.setScalar(config.scale);
        phaseRef.current = "returnLower";
      }
      return;
    }

    // phase === "inspecting" — no drag-to-rotate here (removed per the
    // player's call: examining the rack is fixed-angle only), so the target
    // is simply the stage transform captured once at open time.
    const targetPos = localStageRef.current.position;
    group.position.x = THREE.MathUtils.damp(group.position.x, targetPos.x, MOVE_DAMPING, delta);
    group.position.y = THREE.MathUtils.damp(group.position.y, targetPos.y, MOVE_DAMPING, delta);
    group.position.z = THREE.MathUtils.damp(group.position.z, targetPos.z, MOVE_DAMPING, delta);
    group.quaternion.slerp(localStageRef.current.quaternion, 1 - Math.exp(-MOVE_DAMPING * delta));
    group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, stageScaleRef.current, MOVE_DAMPING, delta));
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (anyInspected) return; // only one thing inspected at a time
    // A held tube's own window-level "click releases it" listener
    // (`InspectableTestTubeSlot`) fires on ANY click, including one that
    // happens to land on the rack itself while dragging the tube across the
    // table — without this guard, that same click would ALSO open THIS
    // rack's inspection (since `anyInspected` is false out here in the
    // table view), yanking the camera back into the close-up stage right as
    // the player was just trying to drop the tube. This runs first (R3F's
    // canvas-level click fires before the bubbled `window` listener), so
    // checking "is a tube currently held" here reliably still sees it.
    if (useTestTubeDragStore.getState().heldInstanceId !== null) return;
    // The rack is about to fly to the inspection stage — its screen
    // position moves out from under the cursor WITHOUT the mouse itself
    // moving, and R3F only recomputes hover on actual pointer events, so a
    // `pointerout` would never fire on its own. Left stuck, a stale `true`
    // here would read as a fresh hover the instant `anyInspected` goes back
    // to false later (e.g. right after picking up a tube), lighting the rim
    // on a rack the cursor isn't actually over anymore. Clearing it right
    // here, in the same click that starts the flight, means it can only
    // ever become true again from a REAL hover afterward.
    setHovered(false);
    // This rack's OWN dev-tunable stage (F8 → "Держатели пробок") — NOT the
    // shared `inspectionBottle` (a round bottle's numbers, unrelated to this
    // much wider object) — see this component's own doc.
    const stage = useStopperHolderStore.getState().inspectionStage;
    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const stagePos = camera.position
      .clone()
      .addScaledVector(cameraRight, stage.x)
      .addScaledVector(cameraUp, stage.y)
      .addScaledVector(cameraForward, stage.z);
    // Tilt directly off the rack's OWN resting orientation — NOT anything
    // derived from `camera.quaternion`. The "table" camera is a fixed pose
    // (it never moves), so deriving the stage orientation from it every
    // click bought nothing but risk: whatever yaw delta that pose happens to
    // work out to (potentially close to 180° from the rack's flat resting
    // orientation) is exactly what made the flight slerp through an
    // unstable/arbitrary axis and read as a somersault. Tipping forward by a
    // small fixed `tiltX` from `homeQuaternion` is always a small,
    // predictable single-axis rotation — it can never surprise-flip — and
    // since the table camera's pose is constant, the correct tilt DIRECTION
    // is a one-time tuning choice (F8 → "Держатели пробок" → Tilt X), not
    // something that needs to be recomputed live.
    const stageQuat = homeQuaternion
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), stage.tiltX));
    useReagentInspectionStore
      .getState()
      .open(
        INSTANCE_ID,
        [stagePos.x, stagePos.y, stagePos.z],
        [stageQuat.x, stageQuat.y, stageQuat.z, stageQuat.w],
        stage.scale,
        "holder",
      );
  };

  const workbenchTubeCount = useTestTubeStorageStore((state) => state.workbenchTestTubes.length);
  const anyTubeHeld = useTestTubeDragStore((state) => state.heldInstanceId !== null);
  // While a tube is being carried, `isNearHolder` (a live 3D distance check
  // — see its own doc) drives the highlight instead of R3F pointer hover:
  // the TUBE is what's moving while the cursor may sit still, and hover
  // events only fire on an actual mouse move, so they either got stuck lit
  // far from the rack or never lit up right next to it. Distance is
  // reevaluated every frame regardless of mouse movement, so it can't go
  // stale the way hover did.
  const isNearHolder = useTestTubeDragStore((state) => state.isNearHolder);

  return (
    <LabTestTubeRackInstance
      ref={groupRef}
      position={positionArray}
      rotation={rotationArray}
      scale={config.scale}
      onClick={handleClick}
      onPointerOver={(event) => {
        event.stopPropagation();
        if (!anyInspected && !anyTubeHeld) setHovered(true);
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        setHovered(false);
      }}
      hoverActive={anyTubeHeld ? isNearHolder : hovered && !anyInspected}
    >
      {/* Tubes already taken from the glassware cabinet, standing in this
          SAME rack — rendered as children so they fly to the inspection
          stage and back together with the rack instead of being left
          behind on the bench (see `computeTubeSlotLocalOffset`'s doc). Each
          only raycasts/hovers while the rack is actually being inspected. */}
      {WORKBENCH_TUBE_SLOT_INDICES.map((index) => (
        <InspectableTestTubeSlot
          key={`workbench-tube-slot-${index}`}
          instanceId={`workbench-tube-slot-${index}`}
          index={index}
          localPosition={TUBE_SLOT_LOCAL_OFFSETS[index]}
          filled={index < workbenchTubeCount}
          // `isInspected` stays true through the whole staged return flight
          // (see `useReagentInspectionStore`'s doc), so `!isClosing` is
          // needed too — otherwise a tube could still register hover/raise
          // while the rack is already flying back to the bench, right after
          // the ОСТАВИТЬ/ВЗЯТЬ buttons have already disappeared.
          interactive={isInspected && !isClosing}
        />
      ))}
    </LabTestTubeRackInstance>
  );
}
