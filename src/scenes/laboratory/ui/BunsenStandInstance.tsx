import { useEffect, useMemo, useState } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { useBunsenStandScene } from "../lib/bunsenStandAssembly";

import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import type { HotspotTargetId, Position3 } from "../lib/layout";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { useShelfTrayFlight } from "../lib/useShelfTrayFlight";
import { STAND_BASE_BOTTOM_OFFSET, useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { standTrayRestPosition, useTrayReagentAreaStore } from "../lib/useTrayReagentAreaStore";
import { useTestTubeDragStore } from "../lib/useTestTubeDragStore";
import { createHoverHitboxGeometry, disableRaycast } from "./ReagentContainerInstance";
import { useNormalHoverOutline } from "./NormalHoverOutline";



/**
 * Retort/Bunsen stand — heavy round base, rod, sliding test-tube ring and
 * burner support ring. Shelf copy for `cabinet-lab-equipment`: sits at
 * `position` until clicked, then flies to the held tray's own dedicated spot
 * (the equipment half of the tray's grid, `standTrayRestPosition` — not the reagents' half or the glued-in
 * test-tube rack, see that constant's doc) and hands off to
 * `BunsenStandTrayDisplay`, the static copy `LabTrayInstance` renders as a
 * child of the tray's own group (so it inherits the tray's live held/return
 * transform "for free", same as `ReagentStaticDisplay`). Only one stand
 * exists — `useBunsenStandStorageStore` is a plain on/off flag, not a
 * per-instance list like the reagent/test-tube stores.
 */
export function BunsenStandInstance({
  cabinetId,
  position = [0, 0, 0],
  rotationY = 0,
}: {
  readonly cabinetId: HotspotTargetId;
  readonly position?: Position3;
  readonly rotationY?: number;
}) {
  const scene = useBunsenStandScene();
  const [hovered, setHovered] = useState(false);

  const onTray = useBunsenStandStorageStore((state) => state.onTray);
  const onWorkbench = useBunsenStandStorageStore((state) => state.onWorkbench);
  const onFumeHood = useBunsenStandStorageStore((state) => state.onFumeHood);
  const returnRequest = useBunsenStandStorageStore((state) => state.returnRequest);
  const isCabinetInspectable = useSceneInteractionStore(
    (state) => state.focusedCabinetId === cabinetId && state.cabinetPhase === "inspecting",
  );
  // Same "one free hand" rule `ReagentContainerInstance`/the workbench jar
  // and rack interactions already enforce — leaving the table with a tube
  // still held (nothing drops it on the way out, see `Laboratory.tsx`'s
  // `returnToOverview`) must not let the player also take the stand.
  const tubeHeld = useTestTubeDragStore((state) => state.heldInstanceId !== null);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    disableRaycast(clone);
    return clone;
  }, [scene]);

  const hoverHitboxGeometry = useMemo(() => createHoverHitboxGeometry(instance), [instance]);

  useEffect(() => {
    cancelDeferredDispose(instance);
    return () => deferDispose(instance, () => {});
  }, [instance]);
  useEffect(() => {
    cancelDeferredDispose(hoverHitboxGeometry);
    return () => deferDispose(hoverHitboxGeometry, () => hoverHitboxGeometry.dispose());
  }, [hoverHitboxGeometry]);

  // `position` is the shelf SURFACE height; the model's own root origin sits
  // level with `StandBase`'s TOP, not its bottom (see `STAND_BASE_BOTTOM_OFFSET`'s
  // doc), so resting it directly at `position` sank the base 12mm into the
  // shelf.
  const home = useMemo(
    (): Position3 => [position[0], position[1] + STAND_BASE_BOTTOM_OFFSET, position[2]],
    [position],
  );
  const trayConfig = useTrayReagentAreaStore((state) => state.config);
  const trayRest = useMemo(() => standTrayRestPosition(STAND_BASE_BOTTOM_OFFSET, trayConfig), [trayConfig]);
  const { groupRef, beginTake, isMoving } = useShelfTrayFlight({
    cabinetId,
    home,
    rotationY,
    trayRestPosition: trayRest,
    returnRequest,
    onArrived: useBunsenStandStorageStore.getState().take,
    onReturnHandled: useBunsenStandStorageStore.getState().clearReturnRequest,
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!isCabinetInspectable || onTray || isMoving() || tubeHeld) return;
    // It leaves under the cursor, so no `pointerout` will come: without
    // this it came back from the tray still outlined.
    if (beginTake()) setHovered(false);
  };

  // Hover: the silhouette outline (`NormalHoverOutline`).
  useNormalHoverOutline({ root: instance, active: hovered && isCabinetInspectable });

  // Gone from the shelf wherever it is now — the hood included, or a second
  // stand stood in the cabinet after «Перенести».
  if (onTray || onWorkbench || onFumeHood) return null;

  return (
    <group
      ref={groupRef}
      position={home}
      rotation={[0, rotationY, 0]}
      onClick={handleClick}
      onPointerOver={(event) => {
        event.stopPropagation();
        if (isCabinetInspectable && !tubeHeld) setHovered(true);
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        setHovered(false);
      }}
    >
      <primitive object={instance} />
      <mesh geometry={hoverHitboxGeometry}>
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
