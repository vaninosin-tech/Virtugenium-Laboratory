import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { QUALITY_LEVELS, useRuntimeQualityStore } from "../lib/useRuntimeQualityStore";

export function RuntimeQuality() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const frames = useRef(0);
  const elapsed = useRef(0);
  const poorSeconds = useRef(0);
  const downgrade = useRuntimeQualityStore((state) => state.downgrade);
  const mode = useRuntimeQualityStore((state) => state.mode);
  const quality = useRuntimeQualityStore((state) => state.quality);
  useEffect(() => {
    const level = QUALITY_LEVELS[quality];
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = quality === "LOW" ? 0.95 : quality === "ULTRA" ? 1.08 : 1;
    scene.userData.runtimeQuality = level;
  }, [gl, scene, quality]);
  useFrame((_, delta) => {
    if (mode !== "AUTO") return;
    frames.current += 1; elapsed.current += delta;
    if (elapsed.current < 2) return;
    const fps = frames.current / elapsed.current;
    if (fps < 28) poorSeconds.current += delta; else poorSeconds.current = Math.max(0, poorSeconds.current - delta * 0.5);
    if (poorSeconds.current > 1.25) { poorSeconds.current = -4; downgrade(); }
    frames.current = 0; elapsed.current = 0;
  });
  return null;
}
