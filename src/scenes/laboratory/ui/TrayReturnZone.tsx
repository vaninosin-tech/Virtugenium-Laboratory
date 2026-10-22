import { Html, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type CSSProperties } from "react";
import * as THREE from "three";

import { TRAY_RETURN_ZONE_LOCAL_POSITION, TRAY_RETURN_ZONE_SIZE } from "../lib/trayReturnZone";
import { useWorkbenchReagentDragStore } from "../lib/useWorkbenchReagentDragStore";

const FOG_VERTEX_SHADER = /* glsl */ `
  varying vec3 vLocalPosition;

  void main() {
    vLocalPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FOG_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  uniform vec3 uCameraLocal;
  uniform vec3 uHalfSize;
  varying vec3 vLocalPosition;

  float hash(vec3 point) {
    point = fract(point * 0.3183099 + vec3(0.1, 0.2, 0.3));
    point *= 17.0;
    return fract(point.x * point.y * point.z * (point.x + point.y + point.z));
  }

  float noise3d(vec3 point) {
    vec3 cell = floor(point);
    vec3 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);

    return mix(
      mix(
        mix(hash(cell), hash(cell + vec3(1.0, 0.0, 0.0)), local.x),
        mix(hash(cell + vec3(0.0, 1.0, 0.0)), hash(cell + vec3(1.0, 1.0, 0.0)), local.x),
        local.y
      ),
      mix(
        mix(hash(cell + vec3(0.0, 0.0, 1.0)), hash(cell + vec3(1.0, 0.0, 1.0)), local.x),
        mix(hash(cell + vec3(0.0, 1.0, 1.0)), hash(cell + vec3(1.0, 1.0, 1.0)), local.x),
        local.y
      ),
      local.z
    );
  }

  float fogNoise(vec3 point) {
    float value = 0.0;
    float amplitude = 0.58;
    for (int octave = 0; octave < 3; octave++) {
      value += noise3d(point) * amplitude;
      point = point * 2.03 + vec3(2.1, 3.4, 1.7);
      amplitude *= 0.48;
    }
    return value;
  }

  vec2 intersectBox(vec3 origin, vec3 direction) {
    vec3 inverseDirection = 1.0 / direction;
    vec3 nearPlane = (-uHalfSize - origin) * inverseDirection;
    vec3 farPlane = (uHalfSize - origin) * inverseDirection;
    vec3 smaller = min(nearPlane, farPlane);
    vec3 larger = max(nearPlane, farPlane);
    float nearDistance = max(max(smaller.x, smaller.y), smaller.z);
    float farDistance = min(min(larger.x, larger.y), larger.z);
    return vec2(nearDistance, farDistance);
  }

  void main() {
    if (uOpacity < 0.001) discard;

    vec3 rayDirection = normalize(vLocalPosition - uCameraLocal);
    vec2 hit = intersectBox(uCameraLocal, rayDirection);
    float startDistance = max(hit.x, 0.0);
    float travelDistance = max(0.0, hit.y - startDistance);
    float stepLength = travelDistance / 28.0;
    float accumulatedDensity = 0.0;

    for (int stepIndex = 0; stepIndex < 28; stepIndex++) {
      float distanceAlongRay = startDistance + (float(stepIndex) + 0.5) * stepLength;
      vec3 samplePoint = uCameraLocal + rayDirection * distanceAlongRay;
      vec3 edgeDistance = uHalfSize - abs(samplePoint);
      float edgeFade = smoothstep(0.0, 0.022, min(min(edgeDistance.x, edgeDistance.y), edgeDistance.z));
      vec3 movingPoint = samplePoint * vec3(4.2, 16.0, 7.0)
        + vec3(uTime * 0.035, -uTime * 0.08, uTime * 0.025);
      float density = smoothstep(0.38, 0.78, fogNoise(movingPoint)) * edgeFade;
      accumulatedDensity += density * stepLength * 7.0 * (1.0 - accumulatedDensity);
    }

    float alpha = clamp(accumulatedDensity * uOpacity, 0.0, 0.42);
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/** Rounded return volume, mounted inside the tray group so it follows the tray. */
export function TrayReturnZone() {
  const isDragging = useWorkbenchReagentDragStore((state) => state.draggingInstanceId !== null);
  const isOver = useWorkbenchReagentDragStore((state) => state.isOverReturnZone);
  const outerMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const fogMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const fogVolumeRef = useRef<THREE.Mesh>(null);
  const cameraWorldPosition = useMemo(() => new THREE.Vector3(), []);
  const fogUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color("#ef4444") },
      uCameraLocal: { value: new THREE.Vector3() },
      uHalfSize: {
        value: new THREE.Vector3(
          TRAY_RETURN_ZONE_SIZE[0] / 2,
          TRAY_RETURN_ZONE_SIZE[1] / 2,
          TRAY_RETURN_ZONE_SIZE[2] / 2,
        ),
      },
    }),
    [],
  );

  useFrame((state, delta) => {
    const outerTarget = isDragging ? (isOver ? 0.105 : 0.038) : 0;
    const fogTarget = isDragging ? (isOver ? 0.38 : 0.2) : 0;

    if (outerMaterialRef.current) {
      outerMaterialRef.current.opacity = THREE.MathUtils.damp(
        outerMaterialRef.current.opacity,
        outerTarget,
        6,
        delta,
      );
    }
    if (fogMaterialRef.current) {
      fogMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      if (fogVolumeRef.current) {
        state.camera.getWorldPosition(cameraWorldPosition);
        fogMaterialRef.current.uniforms.uCameraLocal.value.copy(cameraWorldPosition);
        fogVolumeRef.current.worldToLocal(fogMaterialRef.current.uniforms.uCameraLocal.value);
      }
      fogMaterialRef.current.uniforms.uOpacity.value = THREE.MathUtils.damp(
        fogMaterialRef.current.uniforms.uOpacity.value,
        fogTarget,
        4.5,
        delta,
      );
    }
  });

  return (
    <group position={TRAY_RETURN_ZONE_LOCAL_POSITION}>
      <RoundedBox
        args={[TRAY_RETURN_ZONE_SIZE[0], TRAY_RETURN_ZONE_SIZE[1], TRAY_RETURN_ZONE_SIZE[2]]}
        radius={0.025}
        smoothness={8}
        renderOrder={5}
        raycast={() => undefined}
      >
        <meshBasicMaterial
          ref={outerMaterialRef}
          color="#ef4444"
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </RoundedBox>
      <mesh
        ref={fogVolumeRef}
        renderOrder={6}
        frustumCulled={false}
        raycast={() => undefined}
      >
        <boxGeometry
          args={[TRAY_RETURN_ZONE_SIZE[0], TRAY_RETURN_ZONE_SIZE[1], TRAY_RETURN_ZONE_SIZE[2]]}
        />
        <shaderMaterial
          ref={fogMaterialRef}
          uniforms={fogUniforms}
          vertexShader={FOG_VERTEX_SHADER}
          fragmentShader={FOG_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          depthTest={false}
          side={THREE.BackSide}
          blending={THREE.NormalBlending}
        />
      </mesh>
      <Html
        position={[0, TRAY_RETURN_ZONE_SIZE[1] / 2 + 0.004, 0]}
        center
        style={labelStyle(isDragging, isOver)}
      >
        ВЕРНУТЬ
      </Html>
    </group>
  );
}

function labelStyle(isDragging: boolean, isOver: boolean): CSSProperties {
  return {
    color: isOver ? "rgba(255, 255, 255, 1)" : "rgba(254, 226, 226, 0.94)",
    fontFamily: "IBM Plex Sans, sans-serif",
    fontSize: 28,
    fontWeight: 900,
    letterSpacing: "0.14em",
    lineHeight: 1,
    opacity: isDragging ? 1 : 0,
    pointerEvents: "none",
    textShadow: isOver
      ? "0 0 12px rgba(255, 255, 255, 0.95), 0 0 24px rgba(239, 68, 68, 0.9)"
      : "0 0 10px rgba(248, 113, 113, 0.8)",
    transform: isDragging ? "translateY(0) scale(1)" : "translateY(4px) scale(0.96)",
    transition: "opacity 320ms ease, transform 320ms ease, color 160ms ease, text-shadow 160ms ease",
    userSelect: "none",
    whiteSpace: "nowrap",
  };
}
