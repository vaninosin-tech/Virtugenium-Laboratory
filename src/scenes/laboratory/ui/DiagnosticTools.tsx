import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { simNowMs, setSimulationPaused, useStandMotionStore, CLAMP_TUBE_MOUTH } from "../lib/useStandMotionStore";
import { useReagentStorageStore } from "../lib/useReagentStorageStore";

export type DiagnosticBackground = "lab" | "black" | "gray";
export type DiagnosticCameraSettings = { dist?: number; lateral?: number; height?: number; targetY?: number; targetSide?: number; fov?: number };
type DiagnosticApi = {
  pauseSimulation(): number;
  resumeSimulation(): void;
  setBackground(mode: DiagnosticBackground): void;
  setOpticsMode(mode: 0 | 1 | 2 | 3): void;
  setCamera(settings: DiagnosticCameraSettings): void;
  frozen(): { paused: boolean; simMs: number };
  /** The app's own source-container accounting (a dynamically imported copy of the store would be another instance). */
  sourceAccounting(): { sourceMl: Record<string, number>; debitedEvents: number };
};

declare global {
  interface Window { __diag?: DiagnosticApi; __diagCamera?: DiagnosticCameraSettings }
}

/** A camera-facing, unlit diagnostic backdrop immediately behind the clamped tube. */
export function DiagnosticTools() {
  const { scene } = useThree();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const material = new THREE.MeshBasicMaterial({ color: 0, depthTest: true, depthWrite: true, toneMapped: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), material);
    plane.name = "SilverDiagnosticBackdrop";
    plane.renderOrder = 100;
    plane.visible = false;
    scene.add(plane);
    let opticsMode: 0 | 1 | 2 | 3 = 0;
    const api: DiagnosticApi = {
      pauseSimulation: () => { setSimulationPaused(true); return simNowMs(); },
      resumeSimulation: () => setSimulationPaused(false),
      setBackground: (mode) => {
        if (mode !== "lab" && mode !== "black" && mode !== "gray") throw new RangeError("Invalid diagnostic background");
        material.color.set(mode === "gray" ? 0x808080 : 0x000000);
        plane.visible = mode !== "lab";
      },
      setOpticsMode: (mode) => {
        if (![0, 1, 2, 3].includes(mode)) throw new RangeError("Invalid optics mode");
        opticsMode = mode;
      },
      setCamera: (settings) => { window.__diagCamera = { ...settings }; },
      frozen: () => ({ paused: useStandMotionStore.getState().simulationPaused, simMs: simNowMs() }),
      sourceAccounting: () => { const st = useReagentStorageStore.getState(); return { sourceMl: { ...st.sourceMl }, debitedEvents: st.debitedEvents.size }; },
    };
    window.__diag = api;
    const update = () => {
      scene.traverse((object) => {
        if (object.name !== "TubeSilverDenseField" || !(object instanceof THREE.Mesh)) return;
        const shader = object.material as THREE.ShaderMaterial;
        if (shader.uniforms?.uOpticsMode) shader.uniforms.uOpticsMode.value = opticsMode;
      });
    };
    // useFrame below calls this through a stable ref stored on the scene.
    scene.userData.silverDiagnosticUpdate = update;
    return () => {
      if (window.__diag === api) delete window.__diag;
      delete scene.userData.silverDiagnosticUpdate;
      scene.remove(plane);
      plane.geometry.dispose(); material.dispose();
    };
  }, [scene]);
  useFrame(({ camera, scene }) => {
    if (!import.meta.env.DEV) return;
    const plane = scene.getObjectByName("SilverDiagnosticBackdrop") as THREE.Mesh | undefined;
    if (plane?.visible && CLAMP_TUBE_MOUTH.valid) {
      const target = CLAMP_TUBE_MOUTH.point.clone();
      target.y -= 0.035;
      const away = target.clone().sub(camera.position).normalize();
      plane.position.copy(target).addScaledVector(away, 0.045);
      plane.quaternion.copy(camera.quaternion);
    }
    (scene.userData.silverDiagnosticUpdate as (() => void) | undefined)?.();
  });
  return null;
}
