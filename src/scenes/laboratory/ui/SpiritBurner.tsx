import { useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { useBurnerStore } from "../lib/useBurnerStore";

/**
 * Stand-in spirit burner (спиртовка), built from primitives — there is no
 * burner in `BunsenStand.glb` (verified with `tests/measure-model.mjs`: the
 * asset is only the rod, the tube ring at y 0.22 and the support ring at
 * y 0.06, both offset to x 0.104) and this project has no capacity for new
 * Blender assets.
 *
 * Sizing is derived from the stand it has to heat, not invented: a tube
 * clamped in `TubeRing` hangs its base at 0.22 - `TUBE_RING_INSERT_DEPTH`
 * (0.1) = 0.12, so the body tops out at 0.062 and the flame reaches ~0.125 —
 * just onto the tube bottom.
 */
const BODY_HEIGHT = 0.05;
const BODY_RADIUS_BOTTOM = 0.036;
const BODY_RADIUS_TOP = 0.026;
const COLLAR_Y = BODY_HEIGHT + 0.006;
const WICK_TOP_Y = 0.062;
const FLAME_HEIGHT = 0.063;
const FLAME_CORE_HEIGHT = 0.036;

const GLASS_COLOR = "#b98a4a";
const COLLAR_COLOR = "#c9a227";
const FLAME_COLOR = "#ffb347";
const FLAME_CORE_COLOR = "#cfe4ff";

function Flame() {
  const meshRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // Cheap two-frequency flicker — no particles, no extra draw calls.
    const t = state.clock.elapsedTime;
    const flicker = 1 + Math.sin(t * 17) * 0.05 + Math.sin(t * 6.3) * 0.03;
    mesh.scale.set(1 + (flicker - 1) * 0.4, flicker, 1 + (flicker - 1) * 0.4);
  });

  // A real spirit-burner flame is pale and nearly see-through. Kept dim and
  // low-opacity on purpose: it has to LIGHT the tube, not hide it — a bright
  // emissive cone right under the glass blows out the very thing the player
  // is supposed to be watching.
  return (
    <group ref={meshRef} position={[0, WICK_TOP_Y, 0]}>
      <mesh position={[0, FLAME_HEIGHT / 2, 0]}>
        <coneGeometry args={[0.013, FLAME_HEIGHT, 12]} />
        <meshStandardMaterial
          color={FLAME_COLOR}
          emissive={FLAME_COLOR}
          emissiveIntensity={0.22}
          transparent
          opacity={0.26}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, FLAME_CORE_HEIGHT / 2, 0]}>
        <coneGeometry args={[0.0075, FLAME_CORE_HEIGHT, 10]} />
        <meshStandardMaterial
          color={FLAME_CORE_COLOR}
          emissive={FLAME_CORE_COLOR}
          emissiveIntensity={0.45}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Rendered as a child of whatever group the stand itself is in, so it
 * inherits the stand's own placement. `position` puts it under the rings —
 * the caller passes the stand-local offset.
 */
export function SpiritBurner({
  position = [0.104, 0, 0],
}: {
  readonly position?: readonly [number, number, number];
}) {
  const lit = useBurnerStore((state) => state.lit);
  const toggle = useBurnerStore((state) => state.toggle);
  const [hovered, setHovered] = useState(false);

  return (
    <group
      position={position as unknown as [number, number, number]}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        toggle();
      }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
        setHovered(true);
      }}
      onPointerOut={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        document.body.style.cursor = "auto";
        setHovered(false);
      }}
    >
      <mesh position={[0, BODY_HEIGHT / 2, 0]} castShadow>
        <cylinderGeometry args={[BODY_RADIUS_TOP, BODY_RADIUS_BOTTOM, BODY_HEIGHT, 24]} />
        <meshStandardMaterial
          color={GLASS_COLOR}
          roughness={0.18}
          metalness={0.05}
          transparent
          opacity={0.85}
          emissive="#ffffff"
          emissiveIntensity={hovered ? 0.25 : 0}
        />
      </mesh>
      <mesh position={[0, COLLAR_Y, 0]}>
        <cylinderGeometry args={[0.012, 0.014, 0.012, 16]} />
        <meshStandardMaterial color={COLLAR_COLOR} metalness={0.75} roughness={0.35} />
      </mesh>
      <mesh position={[0, WICK_TOP_Y - 0.002, 0]}>
        <cylinderGeometry args={[0.005, 0.005, 0.008, 10]} />
        <meshStandardMaterial color="#e8e2d2" roughness={0.95} />
      </mesh>
      {lit && (
        <>
          <Flame />
          <pointLight
            position={[0, WICK_TOP_Y + 0.04, 0]}
            color={FLAME_COLOR}
            intensity={0.18}
            distance={0.4}
            decay={2}
          />
        </>
      )}
    </group>
  );
}
