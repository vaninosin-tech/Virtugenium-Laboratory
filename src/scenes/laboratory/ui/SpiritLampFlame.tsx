import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { flameAirflow, flameHotZone } from "../lib/flameAirflow";
import { EQUIPMENT } from "../lib/layout";
import { LAMP_FLAME } from "../lib/lampFlame";
import { useBurnerStore } from "../lib/useBurnerStore";
import { useFumeHoodControlsStore } from "../lib/useFumeHoodControlsStore";
import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";

/**
 * Spirit-lamp flame per `docs/assets/SpiritLamp_flame_logic.txt` (section 3):
 * a calm, translucent teardrop, H tall, 0.010 m wide at the base and 0.012 m
 * at 0.3·H; the lower third pale blue (#4F73FF, alpha ~0.5), above it
 * yellow-orange (#FF9D3A → #FFD166, alpha ~0.6 → 0), an inner blue cone 0.3·H
 * high and 0.55 of the outer width. Additive, no depth write.
 *
 * One quad, turned to the camera around the flame's own vertical axis in the
 * vertex shader, so it never shows as a flat card. The outline and the
 * flicker are drawn in the fragment shader: the tip sways and stretches with
 * noise; the mesh itself is not scaled by the flicker.
 */

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  // Cylindrical billboard: keep the flame's height axis, face the camera sideways.
  vec4 base = modelViewMatrix * vec4(0.0, position.y, 0.0, 1.0);
  float scaleX = length(modelMatrix[0].xyz);
  base.x += position.x * scaleX;
  gl_Position = projectionMatrix * base;
}`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform float uFlickerHz;
uniform float uFlickerAmp;
uniform float uRaggedness;
uniform float uDetach;
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise1(float x) {
  float i = floor(x), f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), u) * 2.0 - 1.0;
}

// Half-width of the teardrop at relative height y (0 = wick, 1 = nominal tip),
// in units of the quad half-width: 0.010 m at the base, 0.012 m at 0.3·H.
float halfWidth(float y, float tip) {
  float t = clamp(y / tip, 0.0, 1.0);
  float body = mix(0.83, 1.0, smoothstep(0.0, 0.3, t));
  float taper = 1.0 - smoothstep(0.3, 1.0, t);
  return body * pow(max(taper, 0.0), 0.62);
}

void main() {
  float t = uTime;
  // Height flicker: sum of slow noise, ±amp around the nominal tip.
  float flicker = noise1(t * uFlickerHz) * 0.6 + noise1(t * uFlickerHz * 1.7 + 3.1) * 0.4;
  float tip = 0.84 * (1.0 + flicker * uFlickerAmp);
  float y = vUv.y;
  // The upper part sways sideways; the base stays on the wick.
  float sway = (noise1(t * 1.3 + y * 2.0) * 0.06 + noise1(t * 3.7 - y * 5.0) * 0.025)
    * smoothstep(0.15, 1.0, y / tip);
  float x = (vUv.x - 0.5) * 2.0 - sway;
  x -= uRaggedness * smoothstep(0.18, 0.9, y) * noise1(t * 8.0 + y * 24.0) * 0.11;

  float w = halfWidth(y, tip);
  w *= 1.0 + uRaggedness * (noise1(y * 37.0 + t * 11.0) * 0.2);
  float edge = abs(x) / max(w, 0.001);
  float inside = 1.0 - smoothstep(0.72, 1.0, edge);
  // Soft root just above the wick and a soft, thinning tip.
  float root = smoothstep(0.015 * uDetach, 0.05 + 0.09 * uDetach, y);
  float fadeTop = 1.0 - smoothstep(tip * 0.55, tip, y);
  float h = clamp(y / tip, 0.0, 1.0);

  // Outer flame: blue, nearly clear lower third; warm above, fading to the tip.
  vec3 blue = vec3(0.31, 0.45, 1.0);
  vec3 orange = vec3(1.0, 0.616, 0.227);
  vec3 yellow = vec3(1.0, 0.82, 0.40);
  float warmMix = smoothstep(0.22, 0.42, h);
  vec3 warm = mix(orange, yellow, smoothstep(0.35, 0.85, h));
  vec3 color = mix(blue, warm * 1.25, warmMix);
  float alpha = mix(0.18, 0.92, warmMix) * (1.0 - smoothstep(0.55, 1.0, h));
  // Brighter where the light passes through more flame.
  alpha *= inside * root * mix(0.75, 1.0, 1.0 - edge * edge);

  // Inner cone: 0.3·H high, 0.55 of the outer width, clearer blue.
  float coneH = 0.3 * tip;
  float coneW = 0.55 * w * (1.0 - smoothstep(0.0, coneH, y));
  float cone = (1.0 - smoothstep(0.6, 1.0, abs(x) / max(coneW, 0.001))) * step(y, coneH) * root;
  color = mix(color, vec3(0.42, 0.55, 1.0), cone * 0.6);
  alpha = max(alpha, cone * 0.35);

  alpha *= fadeTop > 0.0 ? mix(1.0, fadeTop, smoothstep(0.6, 1.0, h)) : 0.0;
  alpha *= uStrength;
  if (alpha < 0.003) discard;
  // Additive: premultiply so the background is brightened, not covered.
  gl_FragColor = vec4(color * alpha, alpha);
}`;

export interface SpiritLampFlameProps {
  /** 0 = out, 1 = full flame; eased by the owner (lighting / smothering). */
  readonly strength: React.MutableRefObject<number>;
  /** Wick tip height in the lamp's frame (`FLAME_BASE_Y`). */
  readonly baseY: number;
  /** Nominal flame height `H`. */
  readonly height: number;
}

/** Calm air on the table: ±5 % height at 1.5–3 Hz (flame logic, section 4). */
const CALM_FLICKER_HZ = 2.2;
const CALM_FLICKER_AMP = 0.05;
const HOOD = EQUIPMENT.find((equipment) => equipment.id === "fume-hood")!;
const UP = new THREE.Vector3(0, 1, 0);
const worldPosition = new THREE.Vector3();
const hoodPosition = new THREE.Vector3();
const localDirection = new THREE.Vector3();
const hotCenter = new THREE.Vector3();
const worldQuaternion = new THREE.Quaternion();

export function SpiritLampFlame({ strength, baseY, height }: SpiritLampFlameProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const transition = useRef(0);
  const nearSeconds = useRef(0);
  // The quad is a little taller than H so the flickering tip never clips;
  // half-width 0.006 m covers the 0.012 m maximum width.
  const quadHeight = height * 1.2;
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.012, quadHeight);
    g.translate(0, quadHeight / 2, 0);
    return g;
  }, [quadHeight]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uStrength: { value: 0 },
      uFlickerHz: { value: CALM_FLICKER_HZ },
      uFlickerAmp: { value: CALM_FLICKER_AMP },
      uRaggedness: { value: 0 },
      uDetach: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
    toneMapped: false,
  }), []);

  useFrame((state, rawDelta) => {
    const s = strength.current;
    const mesh = meshRef.current;
    if (mesh) mesh.visible = s > 0.01;
    const t = state.clock.elapsedTime;
    const lamp = useBurnerStore.getState();
    const inHood = lamp.place === "fumeHood";
    const fanOn = inHood && (useFumeHoodControlsStore.getState().fanOnById[HOOD.id] ?? false);
    const meshWorld = mesh ?? lightRef.current;
    let d = 1;
    let hoodYaw = HOOD.rotationY;
    if (inHood && meshWorld) {
      meshWorld.getWorldPosition(worldPosition);
      const override = useFurniturePositionStore.getState().getOverride(HOOD.id);
      hoodPosition.set(...override.position);
      hoodYaw = override.rotationY ?? HOOD.rotationY;
      worldPosition.sub(hoodPosition).applyAxisAngle(UP, -hoodYaw);
      d = 0.35 - worldPosition.z;
    }
    const delta = Math.min(rawDelta, 0.1);
    transition.current = THREE.MathUtils.clamp(transition.current + (fanOn ? delta : -delta), 0, 1);
    nearSeconds.current = fanOn && d < 0.15 && lamp.lit ? nearSeconds.current + delta : 0;
    const airflow = flameAirflow({ inHood, fanOn, d, transition: transition.current, nearSeconds: nearSeconds.current });
    material.uniforms.uFlickerHz.value = airflow.flickerHz;
    material.uniforms.uFlickerAmp.value = airflow.flickerAmp;
    material.uniforms.uRaggedness.value = airflow.raggedness;
    material.uniforms.uDetach.value = airflow.detachment;
    const zone = flameHotZone(baseY, height, airflow);
    if (mesh) {
      // Hood -Z is the rear wall. Convert that vector to the lamp's frame.
      mesh.parent?.getWorldQuaternion(worldQuaternion);
      localDirection.set(0, 0, -1).applyAxisAngle(UP, hoodYaw).applyQuaternion(worldQuaternion.invert());
      const axis = localDirection.multiplyScalar(Math.sin(airflow.tiltRad)).addScaledVector(UP, Math.cos(airflow.tiltRad)).normalize();
      mesh.quaternion.setFromUnitVectors(UP, axis);
      mesh.scale.set(1, (0.35 + 0.65 * s) * airflow.heightScale, 1);
      hotCenter.set(axis.x * height * airflow.heightScale * 0.8,
        zone.point.y,
        axis.z * height * airflow.heightScale * 0.8);
      mesh.parent?.localToWorld(hotCenter);
      LAMP_FLAME.point.copy(hotCenter);
    }
    material.uniforms.uTime.value = t;
    // Grows from the wick when lit, shrinks into it when smothered.
    material.uniforms.uStrength.value = Math.min(1, s * 1.15);
    if (lightRef.current) {
      const flicker = 1 + Math.sin(t * 2 * Math.PI * airflow.flickerHz) * 0.03
        + Math.sin(t * 2 * Math.PI * 1.6 + 1.3) * 0.02;
      lightRef.current.intensity = 0.38 * s * flicker;
      lightRef.current.position.set(
        localDirection.x * height * airflow.heightScale * 0.4,
        baseY + height * 0.4 * airflow.heightScale * Math.cos(airflow.tiltRad),
        localDirection.z * height * airflow.heightScale * 0.4,
      );
    }
  });

  return (
    <>
      <mesh ref={meshRef} geometry={geometry} material={material} position={[0, baseY, 0]}
        renderOrder={10} frustumCulled={false} raycast={() => {}} />
      <pointLight ref={lightRef} position={[0, baseY + height * 0.4, 0]} color="#ffb060"
        intensity={0} distance={0.6} decay={1} />
    </>
  );
}
