import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { QUALITY_LEVELS, useRuntimeQualityStore } from "../lib/useRuntimeQualityStore";

/** Scene start-up (fonts, textures, first shader compiles) is not judged. */
const WARMUP_SECONDS = 5;
/** A frame this long is a hitch, not a frame rate. */
const HITCH_SECONDS = 0.25;

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
  const sinceMount = useRef(0);
  useFrame((_, delta) => {
    if (mode !== "AUTO") return;
    sinceMount.current += delta;
    // Only sustained slowness is the machine's fault. A single long frame is
    // a hitch — shader compilation, a model upload, the tab coming back from
    // the background (hidden tabs get no frames, so the next one reports the
    // whole gap) — and one of those in a 2 s window read as "0.5 FPS" and
    // dropped the quality for good on a machine that holds 60.
    if (document.hidden || sinceMount.current < WARMUP_SECONDS || delta > HITCH_SECONDS) {
      frames.current = 0; elapsed.current = 0;
      return;
    }
    frames.current += 1; elapsed.current += delta;
    if (elapsed.current < 2) return;
    const fps = frames.current / elapsed.current;
    if (fps < 28) poorSeconds.current += delta; else poorSeconds.current = Math.max(0, poorSeconds.current - delta * 0.5);
    if (poorSeconds.current > 1.25) { poorSeconds.current = -4; downgrade(); }
    frames.current = 0; elapsed.current = 0;
  });
  return null;
}
