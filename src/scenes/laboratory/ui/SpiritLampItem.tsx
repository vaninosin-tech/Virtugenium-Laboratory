import { useGLTF } from "@react-three/drei";
import { type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";

import type { HotspotTargetId, Position3 } from "../lib/layout";
import { BURNER_TRAY_REST_POSITION, useBurnerStore } from "../lib/useBurnerStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { useShelfTrayFlight } from "../lib/useShelfTrayFlight";
import { useTestTubeDragStore } from "../lib/useTestTubeDragStore";
import { createHoverHitboxGeometry, disableRaycast } from "./ReagentContainerInstance";
import { ReagentHoverRim } from "./ReagentHoverRim";
import { SPIRIT_LAMP_MODEL_PATH, prepareLampMaterials } from "./SpiritBurner";
import { TrayEquipmentDisplay } from "./TrayEquipmentDisplay";

/** A capped, non-interactive copy of the lamp model; its materials go with it. */
function useLampCopy() {
  const { scene } = useGLTF(SPIRIT_LAMP_MODEL_PATH);
  const { instance, materials } = useMemo(() => {
    const clone = scene.clone(true);
    const owned = prepareLampMaterials(clone);
    disableRaycast(clone);
    return { instance: clone, materials: owned };
  }, [scene]);
  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials]);
  return instance;
}

/**
 * The spirit lamp on its shelf in «Лаб. оборудование», beside the stand —
 * its own item since VL-014, taken with its own click. Flies to the held
 * tray like the stand does (`useShelfTrayFlight`).
 *
 * @param position the shelf surface; the lamp's origin is the centre of its bottom
 */
export function SpiritLampShelfInstance({
  cabinetId,
  position,
  rotationY = 0,
}: {
  readonly cabinetId: HotspotTargetId;
  readonly position: Position3;
  readonly rotationY?: number;
}) {
  const instance = useLampCopy();
  const hoverHitboxGeometry = useMemo(() => createHoverHitboxGeometry(instance), [instance]);
  useEffect(() => () => hoverHitboxGeometry.dispose(), [hoverHitboxGeometry]);
  const [hovered, setHovered] = useState(false);

  const place = useBurnerStore((state) => state.place);
  const returnRequest = useBurnerStore((state) => state.returnRequest);
  const isCabinetInspectable = useSceneInteractionStore(
    (state) => state.focusedCabinetId === cabinetId && state.cabinetPhase === "inspecting",
  );
  const tubeHeld = useTestTubeDragStore((state) => state.heldInstanceId !== null);

  const { groupRef, beginTake, isMoving } = useShelfTrayFlight({
    cabinetId,
    home: position,
    rotationY,
    trayRestPosition: BURNER_TRAY_REST_POSITION,
    returnRequest,
    onArrived: useBurnerStore.getState().take,
    onReturnHandled: useBurnerStore.getState().clearReturnRequest,
  });

  if (place !== "shelf") return null;

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[0, rotationY, 0]}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        if (!isCabinetInspectable || isMoving() || tubeHeld) return;
        // It leaves under the cursor, so no `pointerout` will come.
        if (beginTake()) setHovered(false);
      }}
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
      <ReagentHoverRim object={instance} active={hovered && isCabinetInspectable} />
      <mesh geometry={hoverHitboxGeometry}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** The lamp riding the held tray; a click sends it back to its shelf. */
export function SpiritLampTrayDisplay() {
  const instance = useLampCopy();
  return (
    <TrayEquipmentDisplay
      instance={instance}
      restPosition={BURNER_TRAY_REST_POSITION}
      onReturn={useBurnerStore.getState().requestReturn}
    />
  );
}
