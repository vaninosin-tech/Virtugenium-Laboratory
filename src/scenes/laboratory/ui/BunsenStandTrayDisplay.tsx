import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { useBunsenStandScene } from "../lib/bunsenStandAssembly";
import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import { STAND_BASE_BOTTOM_OFFSET, useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { standTrayRestPosition, useTrayReagentAreaStore } from "../lib/useTrayReagentAreaStore";
import { disableRaycast } from "./ReagentContainerInstance";
import { TrayEquipmentDisplay } from "./TrayEquipmentDisplay";

/** The stand riding the held tray; a click sends it back to its shelf — see `TrayEquipmentDisplay`. */
export function BunsenStandTrayDisplay({ rotationY = 0 }: { readonly rotationY?: number }) {
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

  const trayConfig = useTrayReagentAreaStore((state) => state.config);
  const restPosition = useMemo(() => standTrayRestPosition(STAND_BASE_BOTTOM_OFFSET, trayConfig), [trayConfig]);

  useEffect(() => {
    cancelDeferredDispose(instance);
    return () => deferDispose(instance, () => {});
  }, [instance]);

  return (
    <TrayEquipmentDisplay
      instance={instance}
      restPosition={restPosition}
      onReturn={useBunsenStandStorageStore.getState().requestReturn}
      what="stand"
      owner="tray-stand"
      rotationY={rotationY}
    />
  );
}
