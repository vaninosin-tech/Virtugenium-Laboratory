import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

import { CLAMP_CHANNEL_OFFSET_Z, CLAMP_MOUNT_HEIGHT } from "./bunsenStandGeometry";

/**
 * The stand ships as three models (see `docs/assets/BunsenStand_notes.txt`):
 * the rod on its base, the double boss (`ClampMount`) that rides the rod, and
 * the removable clamp (`TubeClamp`) whose handle sits in the boss's side
 * channel. Each is exported with its root at the origin, so they are put
 * together here, once, by the formulas from the notes:
 *
 *   ClampMount = BunsenStand · T(0, h, 0) · Ry(φ)
 *   TubeClamp  = ClampMount · ClampHandleChannel · T(reach, 0, 0) · Rx(tilt)
 *
 * φ and reach stay at 0. The clamp hangs under its own pivot group
 * (`TUBE_CLAMP_PIVOT`) at the channel, so `rotation.x` on that group is the
 * tilt and detaching that group takes the clamp off the boss.
 */
export const STAND_MODEL_PATH = "/assets/models/BunsenStand.glb";
export const CLAMP_MOUNT_MODEL_PATH = "/assets/models/ClampMount.glb";
export const TUBE_CLAMP_MODEL_PATH = "/assets/models/TubeClamp.glb";

export const TUBE_CLAMP_PIVOT = "TubeClampPivot";

export function useBunsenStandScene(): THREE.Group {
  const stand = useGLTF(STAND_MODEL_PATH).scene;
  const mount = useGLTF(CLAMP_MOUNT_MODEL_PATH).scene;
  const clamp = useGLTF(TUBE_CLAMP_MODEL_PATH).scene;

  return useMemo(() => {
    const root = new THREE.Group();
    root.name = "BunsenStandAssembly";
    root.add(stand.clone(true));

    const mountGroup = mount.clone(true);
    mountGroup.position.set(0, CLAMP_MOUNT_HEIGHT, 0);
    root.add(mountGroup);

    const pivot = new THREE.Group();
    pivot.name = TUBE_CLAMP_PIVOT;
    pivot.position.set(0, 0, CLAMP_CHANNEL_OFFSET_Z);
    pivot.add(clamp.clone(true));
    mountGroup.add(pivot);
    return root;
  }, [stand, mount, clamp]);
}

useGLTF.preload(STAND_MODEL_PATH);
useGLTF.preload(CLAMP_MOUNT_MODEL_PATH);
useGLTF.preload(TUBE_CLAMP_MODEL_PATH);
