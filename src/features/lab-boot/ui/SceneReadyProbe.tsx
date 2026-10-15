import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

import { useLabBootStore } from "../lib/useLabBootStore";

/**
 * Frames the scene has to actually render before the loading screen lets go:
 * the first ones compile every material's shaders and upload textures, and
 * that hitch belongs behind the loading screen, not in front of the player.
 */
const READY_FRAMES = 8;

/**
 * Mounted inside `<Canvas>` next to the scene. The canvas content suspends
 * as a whole while any `useGLTF` model is still loading, so this only starts
 * counting frames once every model in the scene is in place.
 */
export function SceneReadyProbe() {
  const frames = useRef(0);

  useFrame(() => {
    if (frames.current > READY_FRAMES) return;
    frames.current += 1;
    if (frames.current === READY_FRAMES) useLabBootStore.getState().markSceneReady();
  });

  return null;
}
