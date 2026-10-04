import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { useBunsenStandScene } from "../lib/bunsenStandAssembly";
import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import { BUNSEN_STAND_TRAY_REST_POSITION, useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { disableRaycast } from "./ReagentContainerInstance";
import { TrayEquipmentDisplay } from "./TrayEquipmentDisplay";

/** The stand riding the held tray; a click sends it back to its shelf — see `TrayEquipmentDisplay`. */
export function BunsenStandTrayDisplay() {
  const scene = useBunsenStandScene();
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

  useEffect(() => {
    cancelDeferredDispose(instance);
    return () => deferDispose(instance, () => {});
  }, [instance]);

  return (
    <TrayEquipmentDisplay
      instance={instance}
      restPosition={BUNSEN_STAND_TRAY_REST_POSITION}
      onReturn={useBunsenStandStorageStore.getState().requestReturn}
    />
  );
}
