import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { EffectComposer, N8AO, Outline, Selection } from "@react-three/postprocessing";
import { InspectionDepthOfField } from "./InspectionDepthOfField";
import { KernelSize, Resolution } from "postprocessing";
import * as THREE from "three";

import { Tablet } from "../../../features/tablet/ui/Tablet";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { Cabinet } from "./Cabinet";
import { CameraRig } from "./CameraRig";
import { DevExperimentShortcut } from "./DevExperimentShortcut";
import { DevMenuPanel } from "./DevMenuPanel";
import { FumeHood } from "./FumeHood";
import { FumeHoodWorkArea } from "./FumeHoodWorkArea";
import { HeatingControls } from "./HeatingControls";
import { InspectionControls } from "./InspectionControls";
import { LabAudioRuntime } from "./LabAudioRuntime";
import { LabNoticeOverlay } from "./LabNoticeOverlay";
import { StandActionPanel } from "./StandActionPanel";
import { useHeatingStore } from "../lib/useHeatingStore";
import { useBurnerStore } from "../lib/useBurnerStore";
import { useTubeCloseUpStore } from "../lib/useTubeCloseUpStore";
import { takeLabel } from "../lib/standTableActions";
import { escapeTakenByHand, takeIntoHand, useHandStore } from "../lib/useHandStore";
import { useStandHintStore } from "../lib/useStandHintStore";
import { StandActionHint } from "./StandActionHint";
import { HandController } from "./HandController";
import { ControlsHint, HeldItemHint } from "./HandHints";
import { PourMotion } from "./StandMotion";
import { POUR_POINT_HEIGHT, standBusy } from "../lib/useStandMotionStore";
import { SceneStepAutoAdvance } from "../../../features/tablet/lib/SceneStepAutoAdvance";
import { SandboxPanel } from "../sandbox/SandboxPanel";
import { setupSandbox, teardownSandbox } from "../sandbox/setupSandbox";
import { LabRoom } from "./LabRoom";
import { LabTrayInstance } from "./LabTrayInstance";
import { LightingRuntime } from "./LightingRuntime";
import { RuntimeQuality } from "./RuntimeQuality";
import { PPEBoard } from "./PPEBoard";
import { PPECabinet } from "./PPECabinet";
import { PPEStatusOverlay } from "./PPEStatusOverlay";
import { ReagentContainerPreviewRow } from "./ReagentContainerPreviewRow";
import { ReagentInspectionOverlay } from "./ReagentInspectionOverlay";
import { ReagentStaticDisplay } from "./ReagentStaticDisplay";
import { BunsenStandWorkbenchDisplay, LoneSpiritLampOnWorkbench } from "./BunsenStandWorkbenchDisplay";
import { WorkbenchInstance } from "./WorkbenchInstance";
import { WorkbenchTestTubeRackInstance } from "./WorkbenchTestTubeRackInstance";
import { SHOW_REAGENT_CONTAINER_PREVIEW } from "../lib/debugFlags";
import { CABINETS, CAMERA_TARGETS, TABLE_TRAY_POSITION, TRAY_ROTATION_Y, type SceneTargetId } from "../lib/layout";
import { REAGENTS, type ReagentContainerConfig, type ReagentId } from "../../../entities/laboratory/reagents";
import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useDevMenuStore } from "../lib/useDevMenuStore";
import { useReagentPickablesStore } from "../lib/useReagentPickablesStore";
import { useReagentStorageStore } from "../lib/useReagentStorageStore";
import { markPickablePressed, useTestTubeDragStore } from "../lib/useTestTubeDragStore";
import { computeWorkbenchReagentSlotOffsets, useWorkbenchReagentAreaStore } from "../lib/useWorkbenchReagentAreaStore";
import { useWorkbenchReagentDragStore } from "../lib/useWorkbenchReagentDragStore";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { useLightingStore } from "../lib/useLightingStore";

import {
  AMBIENT_FILL_INTENSITY,
  DAYTIME_CEILING_LIGHT_COLOR,
  DAYTIME_CEILING_LIGHT_HEIGHT,
  DAYTIME_CEILING_LIGHT_INTENSITY,
  DAYTIME_CEILING_LIGHT_WIDTH,
} from "../lib/lightingConfig";

RectAreaLightUniformsLib.init();

/** World XZ of the six physical LED_Panel_01..06 fixtures — read directly from LabRoom.glb, not guessed. */
const CEILING_FIXTURE_POSITIONS: readonly (readonly [number, number])[] = [
  [-3, 0.9],
  [0, 0.9],
  [3, 0.9],
  [-3, -0.9],
  [0, -0.9],
  [3, -0.9],
];

function CeilingLights() {
  const groupA = useLightingStore(state => state.groupA);
  const groupB = useLightingStore(state => state.groupB);
  return <>{CEILING_FIXTURE_POSITIONS.map(([x, z], index) => (
    <rectAreaLight key={index} name={`CeilingPanelLight_${index + 1}`}
      position={[x, 3.05, z]} rotation={[-Math.PI / 2, 0, 0]}
      width={DAYTIME_CEILING_LIGHT_WIDTH} height={DAYTIME_CEILING_LIGHT_HEIGHT}
      intensity={(index % 2 === 0 ? groupA : groupB) ? DAYTIME_CEILING_LIGHT_INTENSITY : 0}
      color={DAYTIME_CEILING_LIGHT_COLOR} />
  ))}</>;
}
import { loadCabinetFonts } from "../lib/loadCabinetFonts";
import { useReagentInspectionStore } from "../lib/useReagentInspectionStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { QUALITY_LEVELS, useRuntimeQualityStore } from "../lib/useRuntimeQualityStore";

const TARGET_LABELS: Record<Exclude<SceneTargetId, "overview">, string> = {
  table: "Рабочий стол",
  "cabinet-acids": "Шкаф: Кислоты",
  "cabinet-bases": "Шкаф: Основания",
  "cabinet-oxides": "Шкаф: Оксиды",
  "cabinet-salts": "Шкаф: Соли",
  "cabinet-simple": "Шкаф: Простые вещества",
  "cabinet-glassware": "Шкаф: Хим. посуда",
  "cabinet-lab-equipment": "Шкаф: Лаб. оборудование",
  "fume-hood": "Вытяжной шкаф",
  "ppe-cabinet": "Шкаф: СИЗ",
};

/** Exponential-smoothing time constant for a workbench jar gliding to a new grid slot after the table's jar count changes — see `DraggableWorkbenchReagent`'s doc. */
const GRID_REFLOW_TIME_CONSTANT_S = 0.18;
/** Fixed duration of a swap-into-place tween (semicircular position arc, no rotation) — see `DraggableWorkbenchReagent`'s handling of `useWorkbenchReagentDragStore`'s `swaps`. A deterministic tween (not the exponential `GRID_REFLOW_TIME_CONSTANT_S` glide above), so both jars visibly complete their trade and land exactly on their new slots at the same moment. */
const SWAP_DURATION_S = 0.45;
/** A press on a workbench jar that travels less than this many pixels is a click (pour at the stand), not a drag. */
const JAR_CLICK_SLOP_PX = 5;
/** Bulge-radius scale for the `reverseSpin` jar in a swap tween — must be anything other than `1` so its arc traces a different circle than the other jar's (see the swap-tween comment in `DraggableWorkbenchReagent` for why that's what keeps the two collision-free). */
const REVERSE_SPIN_BULGE_SCALE = 0.6;

/**
 * One workbench reagent, wrapped in its own drag handle — the wrapper
 * `<group>` (not `ReagentStaticDisplay`'s own internal one, which has no
 * forwarded ref) is what's registered in `useWorkbenchReagentDragStore` and
 * carries the actual world position, so `ReagentStaticDisplay` itself
 * always renders at a plain local `[0,0,0]`. Falls back to the grid's own
 * computed `gridOffset` until the player drags this specific jar (see
 * `useWorkbenchReagentDragStore`'s doc for why per-instance, not
 * per-slot-index — a taken/returned reagent shifting the array would
 * otherwise reassign some OTHER jar's drag override).
 *
 * `prewarm` renders this same jar at negligible scale, non-interactive, with
 * no drag registration — used for a jar still riding the tray (not yet in
 * `workbenchItems`) so its `ReagentStaticDisplay` (clone + label canvas
 * texture + materials, the expensive part) mounts and actually gets drawn
 * once — at negligible size, but NOT `visible={false}`, which would skip the
 * draw call and defer the GPU texture upload to whenever it later becomes
 * real size — right when the jar is taken, one at a time, instead of in a
 * batch when `transferTrayToWorkbench` moves several jars at once at
 * cabinet-session end. See `WorkbenchReagentDisplayArea`'s doc for why this
 * is the SAME React element (same `key`) across that transition, not a
 * remount.
 */
function DraggableWorkbenchReagent({
  instanceId,
  reagent,
  gridOffset,
  tablePosition,
  rotationY,
  scale,
  prewarm = false,
}: {
  readonly instanceId: string;
  readonly reagent: ReagentContainerConfig;
  readonly gridOffset: readonly [number, number, number];
  readonly tablePosition: readonly [number, number, number];
  readonly rotationY: number;
  readonly scale: number;
  readonly prewarm?: boolean;
}) {
  const override = useWorkbenchReagentDragStore((state) => state.overrides[instanceId]);
  const isDragging = useWorkbenchReagentDragStore((state) => state.draggingInstanceId === instanceId);
  const isSwapTarget = useWorkbenchReagentDragStore((state) => state.swapTargetInstanceId === instanceId);
  const held = useHandStore((state) => state.held?.instanceId === instanceId);
  // Post-drop swap-into-place tween — see `WorkbenchReagentSwapSpec`'s doc.
  // Distinct from `isSwapTarget` above, which is just the live drag-hover
  // highlight before a drop, not this after-the-fact animation state.
  const swapSpec = useWorkbenchReagentDragStore((state) => state.swaps[instanceId]);
  const groupRef = useRef<THREE.Group>(null);
  const pickTargetRef = useRef<THREE.Mesh>(null);
  // `ReagentStaticDisplay` only renders its `<mesh ref={interactionRef}>`
  // hitbox while `interactive` (its OWN internal `hoverable && !anyInspected`)
  // is true — so `pickTargetRef.current` is null, and a fresh DIFFERENT mesh,
  // each time `anyInspected` flips off then back on (e.g. the player opens
  // the test tube rack for inspection, unrelated to THIS jar, then closes
  // it — `anyInspected` is global, shared by every reagent). Without tracking
  // it here too, this effect's stale `[instanceId, prewarm]` deps never
  // re-ran on that remount: the store kept pointing at the FIRST hitbox
  // mesh, now detached from the scene (parent null, matrix stuck at
  // identity) — `getWorldPosition()` on it silently returned (0,0,0)
  // forever after, which is exactly why a tube held near this jar stopped
  // registering as "close enough" to fill (`InspectableTestTubeSlot`'s own
  // proximity check) the moment ANY inspection had happened in between.
  const anyInspected = useReagentInspectionStore((state) => state.inspectedId !== null);

  useEffect(() => {
    // CameraRig moves the wrapper, but raycasts only this lightweight
    // hitbox instead of recursively visiting the whole reagent hierarchy.
    const instance = groupRef.current;
    const pickTarget = pickTargetRef.current;
    if (prewarm || !instance || !pickTarget) return;
    useWorkbenchReagentDragStore.getState().register(instanceId, instance, pickTarget);
    return () => useWorkbenchReagentDragStore.getState().unregister(instanceId);
  }, [instanceId, prewarm, anyInspected]);

  const targetLocalX = override?.x ?? gridOffset[0];
  const targetLocalZ = override?.z ?? gridOffset[2];
  // Taking/returning a jar elsewhere on the table changes this one's
  // `gridOffset` too (`computeWorkbenchReagentSlotOffsets` re-centers the
  // whole row on the new count), which used to snap every remaining jar
  // straight to its new slot. Glide there instead.
  const smoothedLocalRef = useRef<[number, number]>([targetLocalX, targetLocalZ]);
  // Elapsed time into the CURRENT swap tween — reset whenever a NEW
  // `swapSpec` object arrives (`beginSwap` always sets a fresh object, even
  // if the numeric from/to happen to repeat), not derived from it, since it
  // must count up frame by frame independently of React's render cycle.
  const swapElapsedRef = useRef(0);
  useEffect(() => {
    if (swapSpec) swapElapsedRef.current = 0;
  }, [swapSpec]);
  // `CameraRig`'s grab/swap/return gesture (`tableDragRef.write`, see its
  // doc) drives this same group's X/Z by DIRECT mutation while dragging —
  // it never goes through `override`/React re-renders for that part,
  // precisely so it can track the pointer every frame without waiting on a
  // store round-trip. This `useFrame` used to stomp that every frame
  // (recomputing X/Z from the pre-drag `gridOffset`), pinning the jar in
  // place and making it look undraggable. Never write X/Z here while
  // `isDragging` (Y — the small pick-up lift — is unrelated to that mutation
  // and stays reactive/instant, same as before) — instead keep `smoothed`
  // continuously resynced from wherever CameraRig's mutation actually put
  // the jar, so the glide path below always picks up from its real current
  // position instead of a stale pre-drag value.
  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // Swap-into-place: travel a semicircular arc to the other jar's old
    // slot instead of a straight line — the jar's own orientation never
    // changes (no spin), only its position. Both swapped jars arc around the
    // same shared midpoint between their two slots, but the `reverseSpin`
    // one sweeps the opposite angular direction (genuinely clockwise vs.
    // counterclockwise, not just "the other side of the line") AND at a
    // different bulge radius (`REVERSE_SPIN_BULGE_SCALE`) than the other.
    // The different radius is what keeps them collision-free: two distinct
    // circles that both pass through `from` and `to` only ever meet at
    // those two shared points (basic circle geometry — two circles meet in
    // at most 2 points), so as long as the scale isn't 1, the two jars'
    // positions can never coincide anywhere mid-tween, regardless of
    // direction. Stays flat on the table (constant Y) — no lift — the whole
    // arc lives in the X/Z plane the slots themselves sit in. Takes
    // priority over both the drag and grid-reflow-glide paths below.
    if (swapSpec) {
      swapElapsedRef.current += delta;
      const t = THREE.MathUtils.clamp(swapElapsedRef.current / SWAP_DURATION_S, 0, 1);
      const eased = THREE.MathUtils.smoothstep(t, 0, 1);
      const theta = eased * Math.PI;
      const midX = (swapSpec.fromX + swapSpec.toX) / 2;
      const midZ = (swapSpec.fromZ + swapSpec.toZ) / 2;
      const axisX = swapSpec.fromX - midX;
      const axisZ = swapSpec.fromZ - midZ;
      // 90°-rotated `axis`, same length — together they parametrize the
      // circle `from`/`to` sit on (diametrically opposite, since `mid` is
      // their midpoint): angle 0 lands on `from`, angle π lands on `to`,
      // regardless of how the perpendicular term below gets scaled/flipped.
      const perpX = -axisZ;
      const perpZ = axisX;
      const perpSign = swapSpec.reverseSpin ? -REVERSE_SPIN_BULGE_SCALE : 1;
      const x = midX + axisX * Math.cos(theta) + perpX * perpSign * Math.sin(theta);
      const z = midZ + axisZ * Math.cos(theta) + perpZ * perpSign * Math.sin(theta);
      group.position.x = tablePosition[0] + x;
      group.position.z = tablePosition[2] + z;
      group.position.y = tablePosition[1] + gridOffset[1];
      if (t >= 1) {
        // Land exactly on the target slot, and prime `smoothed` so the
        // ordinary glide path below picks up cleanly from here on later
        // grid reflows.
        smoothedLocalRef.current[0] = swapSpec.toX;
        smoothedLocalRef.current[1] = swapSpec.toZ;
        useWorkbenchReagentDragStore.getState().clearSwap(instanceId);
      }
      return;
    }

    if (isDragging) {
      group.position.y = tablePosition[1] + gridOffset[1] + 0.04;
      smoothedLocalRef.current[0] = group.position.x - tablePosition[0];
      smoothedLocalRef.current[1] = group.position.z - tablePosition[2];
      return;
    }
    group.position.y = tablePosition[1] + gridOffset[1];
    const smoothed = smoothedLocalRef.current;
    const t = 1 - Math.exp(-delta / GRID_REFLOW_TIME_CONSTANT_S);
    smoothed[0] = THREE.MathUtils.lerp(smoothed[0], targetLocalX, t);
    smoothed[1] = THREE.MathUtils.lerp(smoothed[1], targetLocalZ, t);
    group.position.x = tablePosition[0] + smoothed[0];
    group.position.z = tablePosition[2] + smoothed[1];
  });
  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    // A pour (maybe this very jar's) is under way at the stand.
    if (standBusy()) return;
    // A held tube fills by hovering it near a jar (`InspectableTestTubeSlot`'s
    // own `useFrame` proximity check) — grabbing the jar itself out from
    // under it at the same time fought that gesture and, before the
    // jar-click exception there, used to read as "clicking a jar drops the
    // tube". Simplest fix: while a tube is held, jars just aren't grabbable.
    if (useTestTubeDragStore.getState().heldInstanceId !== null) {
      // Still tell the held tube's own click-drop listener this press landed
      // HERE, not on empty air — see `markPickablePressed`'s doc.
      markPickablePressed();
      return;
    }
    useWorkbenchReagentDragStore
      .getState()
      .requestGrab(instanceId, event.clientX, event.clientY);
    // The same press may turn out to be a click: then the jar pours into
    // the tube in the stand's clamp (VL-014) and the drag that began just
    // snaps it back home, as any short drag does.
    const { clientX, clientY } = event;
    const handleUp = (up: PointerEvent) => {
      window.removeEventListener("pointerup", handleUp);
      if (Math.hypot(up.clientX - clientX, up.clientY - clientY) > JAR_CLICK_SLOP_PX) return;
      // A click takes it into the hand (VL-015).
      if (!takeLabel({ kind: "bottle", location: "workbench", reagentId: reagent.id })) return;
      takeIntoHand(
        { kind: "bottle", location: "workbench", instanceId, reagentId: reagent.id, containerType: reagent.containerType },
        [0, 0, 0],
      );
    };
    window.addEventListener("pointerup", handleUp);
  };

  return (
    // No declarative `position` here — `useFrame` above owns it every frame
    // (initialized once from the target, so there's no origin-flash on
    // mount). A declarative position using the live target would reassert
    // itself on every re-render and cancel the smoothing mid-glide.
    <group ref={groupRef} scale={prewarm ? 0.0001 : 1}>
      <PourMotion instanceId={instanceId} pourPointHeight={POUR_POINT_HEIGHT[reagent.containerType] * scale}>
        <ReagentStaticDisplay
          reagent={reagent}
          rotationY={rotationY}
          scale={scale}
          hoverable={!prewarm}
          highlighted={!prewarm && (isDragging || isSwapTarget || held)}
          onPointerDown={prewarm ? undefined : handlePointerDown}
          onHoverChange={(hovered) =>
            hovered
              ? useStandHintStore.getState().show(instanceId, { kind: "bottle", location: "workbench", reagentId: reagent.id, instanceId })
              : useStandHintStore.getState().hide(instanceId)
          }
          interactionRef={prewarm ? undefined : pickTargetRef}
        />
      </PourMotion>
      {/* `hoverable` creates the display's shared invisible hitbox without
          enabling the tray-only click-to-shelf action. CameraRig raycasts
          this same hitbox for drag pickup, while the display owns hover. */}
    </group>
  );
}

/**
 * Where reagents land after `LabTrayInstance` transfers them off the held
 * tray when a cabinet session ends (see `useReagentStorageStore`'s
 * `workbenchItems`/`transferTrayToWorkbench`) — a regular origin+spacing
 * grid near the workbench stopper holder, dev-tunable via
 * `WorkbenchReagentAreaCalibrationPanel` (F12). Slots beyond
 * `maxDisplaySlots` simply aren't rendered (items stay tracked, just not
 * shown) rather than dropped from the store. Each item is individually
 * drag-repositionable in dev mode — see `DraggableWorkbenchReagent`.
 *
 * Also renders a `prewarm` copy (see `DraggableWorkbenchReagent`'s doc) for
 * every jar still on `trayItems` — the whole point is that this is the SAME
 * `key={item.instanceId}` element the jar gets once `transferTrayToWorkbench`
 * moves it into `visibleItems` below. All states are flattened into one
 * keyed list, so that transition is a prop update (prewarm goes false,
 * position/scale become real) on an already-mounted component, not an
 * unmount+remount. The expensive work is spread across individual takes.
 */
function WorkbenchReagentDisplayArea() {
  const config = useWorkbenchReagentAreaStore((state) => state.config);
  const tablePosition = useFurniturePositionStore((state) => state.getOverride("table").position);
  const items = useReagentStorageStore((state) => state.workbenchItems);
  const trayItems = useReagentStorageStore((state) => state.trayItems);
  const inspectedId = useReagentInspectionStore((state) => state.inspectedId);
  const visibleItems = useMemo(
    () => {
      const seen = new Set<string>();
      return items
        .filter((item) => {
          if (seen.has(item.instanceId)) return false;
          seen.add(item.instanceId);
          return true;
        })
        .slice(0, Math.max(0, config.maxDisplaySlots));
    },
    [items, config.maxDisplaySlots],
  );
  const visibleIds = useMemo(
    () => new Set(visibleItems.map((item) => item.instanceId)),
    [visibleItems],
  );
  const prewarmItems = useMemo(
    () => trayItems.filter((item) => !visibleIds.has(item.instanceId)),
    [trayItems, visibleIds],
  );
  const inspectedReagent = useMemo(() => {
    if (!inspectedId) return null;
    const entry = Object.entries(REAGENTS).find(([reagentId]) => inspectedId.endsWith(`-${reagentId}`));
    if (!entry) return null;
    const alreadyMounted = [...items, ...trayItems].some((item) => item.instanceId === inspectedId);
    return alreadyMounted ? null : { instanceId: inspectedId, reagent: entry[1] };
  }, [inspectedId, items, trayItems]);
  const offsets = useMemo(
    () => computeWorkbenchReagentSlotOffsets(config, visibleItems.length),
    [config, visibleItems.length],
  );
  // Keep tray-prewarmed and visible workbench jars in one keyed array.
  // Separate nested map arrays are separate reconciliation scopes and would
  // remount every expensive reagent display during tray-to-table transfer.
  const displayItems = useMemo(() => {
    const visible = visibleItems.flatMap((item, index) => {
      const gridOffset = offsets[index];
      return gridOffset ? [{
        item,
        reagent: REAGENTS[item.reagentId as ReagentId],
        gridOffset,
        prewarm: false as const,
      }] : [];
    });
    // Project prewarm items onto their eventual real slot (as if the tray
    // had already transferred) instead of [0,0,0] — the same key/component
    // instance carries a prewarm copy through the actual transfer, so a
    // gridOffset that only becomes correct AFTER transfer produces a visible
    // glide from the table's center to the slot the instant prewarm flips to
    // false (`smoothedLocalRef` in `DraggableWorkbenchReagent` seeds itself
    // from this offset at mount, while still prewarming/off-table).
    const projectedOffsets = computeWorkbenchReagentSlotOffsets(
      config,
      Math.min(visibleItems.length + prewarmItems.length, config.maxDisplaySlots),
    );
    const prewarmed = prewarmItems.map((item, index) => ({
      item,
      reagent: REAGENTS[item.reagentId as ReagentId],
      gridOffset: projectedOffsets[visibleItems.length + index] ?? ([0, 0, 0] as const),
      prewarm: true as const,
    }));
    const inspected = inspectedReagent
      ? [{
          item: {
            instanceId: inspectedReagent.instanceId,
            reagentId: inspectedReagent.reagent.id,
          },
          reagent: inspectedReagent.reagent,
          gridOffset: [0, 0, 0] as const,
          prewarm: true as const,
        }]
      : [];
    return [...visible, ...prewarmed, ...inspected];
  }, [config, inspectedReagent, offsets, prewarmItems, visibleItems]);

  return (
    <>
      {displayItems.map(({ item, reagent, gridOffset, prewarm }) => (
        <DraggableWorkbenchReagent
          key={item.instanceId}
          instanceId={item.instanceId}
          reagent={reagent}
          gridOffset={gridOffset}
          tablePosition={tablePosition}
          rotationY={config.rotationY}
          scale={config.scale}
          prewarm={prewarm}
        />
      ))}
    </>
  );
}

/**
 * Invisible (dev-mode-visible) drag handle for the workbench reagent area
 * as a WHOLE cluster — there's no single always-present mesh to click on
 * otherwise (the area can be empty of items), and dragging the whole
 * cluster by its origin keeps the grid intact instead of scattering
 * individual jars. Registered as a `useReagentPickablesStore` pick target
 * ("workbench-reagent-area") — see `CameraRig`'s `handlePointerDown`/
 * `handleMouseMove` for the actual drag-to-`config.originX/originZ` logic.
 * Rendered only while the F8 dev menu is open, same as it's only pickable
 * then (`CameraRig` gates the whole raycast on `useDevMenuStore.isOpen`).
 */
function WorkbenchReagentAreaAnchor() {
  const config = useWorkbenchReagentAreaStore((state) => state.config);
  const tablePosition = useFurniturePositionStore((state) => state.getOverride("table").position);
  const isDevMenuOpen = useDevMenuStore((state) => state.isOpen);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const instance = groupRef.current;
    if (!instance) return;
    useReagentPickablesStore.getState().register("workbench-reagent-area", instance);
    return () => useReagentPickablesStore.getState().unregister("workbench-reagent-area");
  }, []);

  return (
    <group
      ref={groupRef}
      position={[
        tablePosition[0] + config.originX,
        tablePosition[1] + config.originY,
        tablePosition[2] + config.originZ,
      ]}
      visible={isDevMenuOpen}
    >
      <mesh>
        <sphereGeometry args={[0.03, 12, 12]} />
        <meshBasicMaterial color="#facc15" />
      </mesh>
    </group>
  );
}

export function Laboratory() {
  const quality = useRuntimeQualityStore((state) => state.quality);
  const setScreen = useLaboratoryStore((state) => state.setScreen);
  const setCameraView = useLaboratoryStore((state) => state.setCameraView);

  const activeTargetId = useSceneInteractionStore((state) => state.activeTargetId);
  const isPointerLocked = useSceneInteractionStore((state) => state.isPointerLocked);
  const setActiveTarget = useSceneInteractionStore((state) => state.setActiveTarget);
  const requestCabinetReturn = useSceneInteractionStore((state) => state.requestCabinetReturn);
  const tablePosition = useFurniturePositionStore((state) => state.getOverride("table").position);
  const bunsenStandOnWorkbench = useBunsenStandStorageStore((state) => state.onWorkbench);
  const lampOnWorkbench = useBurnerStore((state) => state.place === "workbench");
  const tubeViewing = useTubeCloseUpStore((state) => state.viewing);
  const heatingActive = useHeatingStore((state) => state.active);
  const tubeCloseUp = tubeViewing || heatingActive;
  const handHeld = useHandStore((state) => state.held !== null);
  // RMB in the overview hides or shows the aiming dot — nothing else.
  const [crosshairHidden, setCrosshairHidden] = useState(false);
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 2 || !document.pointerLockElement) return;
      if (useSceneInteractionStore.getState().activeTargetId !== "overview") return;
      setCrosshairHidden((hidden) => !hidden);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);
  const gameCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const resumeMouseLook = useCallback(() => {
    const canvas = gameCanvasRef.current;
    if (!canvas || document.pointerLockElement === canvas) return;

    try {
      // Browsers reject Pointer Lock outside a user activation. All callers
      // invoke this synchronously from the click/key that exits an interactive
      // view; still swallow a rejection for browsers with stricter policies.
      const request = canvas.requestPointerLock() as Promise<void> | undefined;
      void request?.catch(() => undefined);
    } catch {
      // Pointer Lock is an enhancement; never break the actual return action.
    }
  }, []);

  useEffect(() => {
    setScreen("laboratory");
    setCameraView("overview");
    setActiveTarget("overview");
    // Fire-and-forget warm-up: gives the cabinet category-label webfonts a
    // head start while the player is still looking at the overview, before
    // any cabinet is opened. `ReagentCabinetInstance` still gates its own
    // texture draw on this same promise for correctness — this call is
    // purely a speed optimization, not the guarantee.
    void loadCabinetFonts();
    const sandbox = useLaboratoryStore.getState().mode === "sandbox";
    if (sandbox) setupSandbox();
    // The lab starts with the tablet open on the experiment list; it cannot
    // be closed until one is chosen (`closeTablet`).
    else if (!useLaboratoryStore.getState().selectedExperimentId) useLaboratoryStore.getState().openTablet("tasks");
    return () => {
      if (sandbox) teardownSandbox();
    };
    // Entering the scene always starts from the general overview, regardless
    // of where a previous visit left off — run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Esc with something in the hand puts it back, nothing more (VL-015).
      if (escapeTakenByHand()) return;
      // Do not navigate or recapture the scene behind the tablet overlay.
      if (useLaboratoryStore.getState().tabletOpen) return;
      // A focused cabinet owns Escape exclusively — CameraRig runs the
      // fly-back/close-cabinet sequence itself (it needs the camera refs
      // this component doesn't have). Only handle the plain table/overview
      // case here.
      const scene = useSceneInteractionStore.getState();
      if (scene.cabinetPhase !== "room" || scene.activeTargetId === "overview") return;
      event.preventDefault();
      resumeMouseLook();
      setCameraView("overview");
      setActiveTarget("overview");
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [resumeMouseLook, setCameraView, setActiveTarget]);

  const returnToOverview = () => {
    // The back button click is the user activation required by Pointer Lock.
    // Reclaim it before starting either the cabinet return flight or the
    // table-to-overview transition.
    resumeMouseLook();
    if (useSceneInteractionStore.getState().cabinetPhase !== "room") {
      requestCabinetReturn();
      return;
    }
    setCameraView("overview");
    setActiveTarget("overview");
  };

  const showCrosshair = isPointerLocked && activeTargetId === "overview" && !crosshairHidden;
  const showZonePanel = activeTargetId !== "overview";

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", touchAction: "none" }}>
      <Canvas
        shadows
        camera={{ position: CAMERA_TARGETS.overview.position, fov: 55 }}
        // localClippingEnabled: required for any material's `clippingPlanes`
        // to have effect at all — used by the reagent cabinet's shutter
        // concealment (see useCabinetDoorAnimation.ts). Off by default in
        // three.js; this is the one global switch, not a per-material one.
        gl={{ powerPreference: "high-performance", antialias: true, localClippingEnabled: true }}
        onCreated={(state) => {
          gameCanvasRef.current = state.gl.domElement;
          // DEV: lets the play-through scripts (tests/visual/e2e) find where a
          // 3D object is on screen and click it like a player would.
          if (import.meta.env.DEV) (window as unknown as { __three?: unknown }).__three = state;
          state.gl.toneMappingExposure = 1.0;
        }}
      >
        <color attach="background" args={["#dbe3ea"]} />
        {/*
          Ambient/environment fill only — not gated by the A/B wall switch,
          same as the sun (see lightingConfig.ts). Three.js has no bounce
          lighting, so a small ambient/hemisphere term keeps unlit corners
          (under furniture, cabinet interiors) from going fully black
          without becoming the primary room light itself.
        */}
        <ambientLight color="#ffffff" intensity={AMBIENT_FILL_INTENSITY} />

        <CeilingLights />

        <LabRoom />
        <LightingRuntime />
        <LabAudioRuntime />
        <RuntimeQuality />
        {SHOW_REAGENT_CONTAINER_PREVIEW && <ReagentContainerPreviewRow />}

        <Selection>
          <WorkbenchInstance position={tablePosition} />
          <WorkbenchTestTubeRackInstance />
          <WorkbenchReagentDisplayArea />
          <WorkbenchReagentAreaAnchor />
          {bunsenStandOnWorkbench && <BunsenStandWorkbenchDisplay tableWorldPosition={tablePosition} />}
          {lampOnWorkbench && !bunsenStandOnWorkbench && <LoneSpiritLampOnWorkbench tableWorldPosition={tablePosition} />}
        <LabTrayInstance mode="table" position={TABLE_TRAY_POSITION} rotationY={TRAY_ROTATION_Y} />
        <LabTrayInstance mode="held" position={TABLE_TRAY_POSITION} rotationY={TRAY_ROTATION_Y} />
          {CABINETS.map((cabinet) => (
            <Cabinet key={cabinet.id} cabinet={cabinet} />
          ))}
          <FumeHood />
          <FumeHoodWorkArea />
          <PPECabinet />
          <PPEBoard />
          <EffectComposer autoClear={false} multisampling={QUALITY_LEVELS[quality].multisampling}>
            {/* Subtle contact AO only — distinguishes adjacent white furniture planes without darkening the room. Higher sample counts than the library default to avoid visible dither/grain on large flat surfaces. */}
            {quality !== "LOW" && <N8AO aoRadius={0.35} intensity={2} distanceFalloff={1} color="#000000" aoSamples={quality === "ULTRA" ? 16 : 8} denoiseSamples={quality === "ULTRA" ? 8 : 4} screenSpaceRadius />}
              {/* Cabinet outlines; reagent jars use their surface rim. */}
            <Outline
              visibleEdgeColor={0x1d4ed8}
              hiddenEdgeColor={0x1d4ed8}
              edgeStrength={4}
              pulseSpeed={0}
              blur
              kernelSize={KernelSize.SMALL}
              xRay={false}
              width={Resolution.AUTO_SIZE}
              height={Resolution.AUTO_SIZE}
            />
            {/*
              Reagent inspection background blur: a real depth-of-field pass
              focused on the inspected bottle's stage position, so the lab
              behind it blurs while the bottle itself (right at the focus
                distance) stays sharp. Keep the pass mounted so opening a jar
                does not rebuild the composer; its blur work is skipped outside
                inspection.
            */}
              <InspectionDepthOfField />
          </EffectComposer>
        </Selection>

        <CameraRig onResumeMouseLook={resumeMouseLook} />
        <HandController />
      </Canvas>

      {showCrosshair && (
        <div style={crosshairStyle}>
          <div style={crosshairDotStyle} />
        </div>
      )}

      <Tablet
        onReturnToGame={() => {
          const scene = useSceneInteractionStore.getState();
          if (scene.cabinetPhase === "room" && scene.activeTargetId === "overview") {
            resumeMouseLook();
          }
        }}
      />
      <DevMenuPanel />
      <DevExperimentShortcut />
      <PPEStatusOverlay />
      <HeatingControls />
      <StandActionPanel />
      <StandActionHint />
      <HeldItemHint />
      <ControlsHint />
      <LabNoticeOverlay />
      <SandboxPanel />
      <SceneStepAutoAdvance />
      {/* The tube close-up has its own way out («Отойти» / «Отойти от
          штатива»), and these buttons sat right over the bottom of the tube,
          where the copper and the precipitate are. */}
      {/* While something is in the hand, the hand has the mouse: no «Назад» (VL-015). */}
      {tubeCloseUp || handHeld ? null : <InspectionControls onBack={returnToOverview} />}
      <ReagentInspectionOverlay />

      {showZonePanel ? (
        <div style={zonePanelStyle}>
          <span style={{ fontWeight: 600 }}>{TARGET_LABELS[activeTargetId as Exclude<SceneTargetId, "overview">]}</span>
        </div>
      ) : null}
    </div>
  );
}

const zonePanelStyle: CSSProperties = {
  position: "absolute",
  top: 20,
  right: 20,
  zIndex: 10,
  display: "flex",
  alignItems: "center",
  gap: 12,
  backgroundColor: "rgba(15, 23, 42, 0.85)",
  padding: "10px 16px",
  borderRadius: 10,
  color: "#e2e8f0",
  border: "1px solid rgba(56, 189, 248, 0.4)",
};

const crosshairStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  zIndex: 10,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 10,
  pointerEvents: "none",
};

const crosshairDotStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: "50%",
  border: "2px solid rgba(255,255,255,0.85)",
  boxShadow: "0 0 4px rgba(0,0,0,0.5)",
};
