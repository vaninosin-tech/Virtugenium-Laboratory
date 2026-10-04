import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { useBurnerStore } from "../lib/useBurnerStore";
import { standTargetEvents } from "./standTargetEvents";

export const SPIRIT_LAMP_MODEL_PATH = "/assets/models/SpiritLamp.glb";
const MODEL_PATH = SPIRIT_LAMP_MODEL_PATH;

/**
 * Spirit lamp (спиртовка) — `SpiritLamp.glb`, measurements and behaviour from
 * `docs/assets/SpiritLamp_flame_logic.txt`. The origin is the centre of the
 * lamp's bottom on the table.
 */
/** Tip of the wick — where the flame stands (`FLAME_BASE`). */
export const FLAME_BASE_Y = 0.0765;
/** Nominal flame height `H`. */
export const FLAME_HEIGHT = 0.04;
const FLAME_CORE_HEIGHT = FLAME_HEIGHT * 0.3;

/** The cap comes off straight up first — the wick holder inside leaves only 0.5 mm of play. */
const CAP_LIFT = 0.035;
/** Where the removed cap stands on the table beside the lamp, relative to its seat (`CAP_ASIDE` minus `CAP_SEAT`). */
const CAP_ASIDE = new THREE.Vector3(0.07, -0.0505, 0);
const CAP_MOVE_SECONDS = 0.6;
/** The flame under a replaced cap goes out once the air in it is used up, not the instant the cap seats. */
const SMOTHER_SECONDS = 0.3;

const FLAME_COLOR = "#ffb347";
const FLAME_CORE_COLOR = "#4f73ff";

/**
 * The model's glass uses `KHR_materials_transmission`, which in three.js adds
 * a whole transmission render pass per frame. Same trade the reagent jars
 * make (`reagentMaterials.ts`): plain alpha-blended glass instead.
 */
export function prepareLampMaterials(root: THREE.Object3D): THREE.Material[] {
  const owned: THREE.Material[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const source = object.material as THREE.MeshStandardMaterial;
    if (source.name === "SpiritLamp_Glass" || source.name === "SpiritLamp_Spirit") {
      const spirit = source.name === "SpiritLamp_Spirit";
      const material = new THREE.MeshPhysicalMaterial({
        name: source.name,
        color: source.color,
        roughness: spirit ? 0.02 : 0.06,
        metalness: 0,
        transparent: true,
        opacity: spirit ? 0.28 : 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
        clearcoat: 0,
        clearcoatRoughness: 0.04,
        envMapIntensity: 0.5,
      });
      object.material = material;
      object.castShadow = false;
      // The spirit shows through the glass around it, never over it.
      object.renderOrder = spirit ? 1 : 2;
      owned.push(material);
    }
  });
  return owned;
}

function Flame({ strength }: { readonly strength: React.MutableRefObject<number> }) {
  const groupRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    // Calm air: ±5 % height at 1.5–3 Hz (flame logic, section 4).
    const t = state.clock.elapsedTime;
    const flicker = 1 + Math.sin(t * 2 * Math.PI * 2.3) * 0.03 + Math.sin(t * 2 * Math.PI * 1.6 + 1.3) * 0.02;
    const s = strength.current;
    group.visible = s > 0.01;
    group.scale.set(s * (1 + (flicker - 1) * 0.4), s * flicker, s * (1 + (flicker - 1) * 0.4));
    if (lightRef.current) lightRef.current.intensity = 0.03 * s * flicker;
  });

  // A spirit-lamp flame is pale and nearly see-through. Kept dim on purpose:
  // it has to LIGHT the tube, not hide it.
  return (
    <>
      <group ref={groupRef} position={[0, FLAME_BASE_Y, 0]}>
        <mesh position={[0, FLAME_HEIGHT / 2, 0]}>
          <coneGeometry args={[0.006, FLAME_HEIGHT, 12]} />
          <meshStandardMaterial
            color={FLAME_COLOR}
            emissive={FLAME_COLOR}
            emissiveIntensity={0.4}
            transparent
            opacity={0.32}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, FLAME_CORE_HEIGHT / 2, 0]}>
          <coneGeometry args={[0.0033, FLAME_CORE_HEIGHT, 10]} />
          <meshStandardMaterial
            color={FLAME_CORE_COLOR}
            emissive={FLAME_CORE_COLOR}
            emissiveIntensity={0.5}
            transparent
            opacity={0.45}
            depthWrite={false}
          />
        </mesh>
      </group>
      <pointLight
        ref={lightRef}
        position={[0, FLAME_BASE_Y + FLAME_HEIGHT * 0.4, 0]}
        color="#ffb060"
        intensity={0}
        distance={0.6}
        decay={1}
      />
    </>
  );
}

/**
 * Rendered as a child of whatever group the stand itself is in, so it
 * inherits the stand's own placement; `position` is stand-local.
 *
 * One click advances the lamp: take the cap off, light it, put the cap back on.
 */
export function SpiritBurner({
  position = [0.104, 0, 0.018],
}: {
  readonly position?: readonly [number, number, number];
}) {
  const { scene } = useGLTF(MODEL_PATH);

  const { instance, cap, capSeat, materials } = useMemo(() => {
    const clone = scene.clone(true);
    const materials = prepareLampMaterials(clone);
    const cap = clone.getObjectByName("LampCap") ?? null;
    return { instance: clone, cap, capSeat: cap?.position.clone() ?? new THREE.Vector3(), materials };
  }, [scene]);
  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials]);

  // 0 = cap seated, 1 = cap standing aside on the table.
  const capOff = useRef(useBurnerStore.getState().phase === "capped" ? 0 : 1);
  const flameStrength = useRef(useBurnerStore.getState().lit ? 1 : 0);
  const smotherTimer = useRef(0);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const { phase } = useBurnerStore.getState();
    const target = phase === "capped" ? 0 : 1;
    capOff.current = THREE.MathUtils.clamp(
      capOff.current + Math.sign(target - capOff.current) * (delta / CAP_MOVE_SECONDS),
      0,
      1,
    );
    if (cap) {
      // Straight up off the seat, across, then down onto the table.
      const k = capOff.current;
      const lift = Math.min(1, k / 0.35);
      const across = THREE.MathUtils.smoothstep(k, 0.35, 1);
      // It clears the lamp body sideways before coming down onto the table.
      const aside = THREE.MathUtils.smoothstep(across, 0, 0.8);
      const down = THREE.MathUtils.smoothstep(across, 0.8, 1);
      cap.position.set(
        capSeat.x + CAP_ASIDE.x * aside,
        capSeat.y + THREE.MathUtils.lerp(CAP_LIFT * lift, CAP_ASIDE.y, down),
        capSeat.z + CAP_ASIDE.z * aside,
      );
    }

    // The flame dies a moment after the cap seats, and catches over a few frames.
    if (phase === "lit") {
      smotherTimer.current = 0;
      flameStrength.current = Math.min(1, flameStrength.current + delta / 0.25);
    } else if (flameStrength.current > 0) {
      const seated = capOff.current <= 0;
      if (seated) smotherTimer.current += delta;
      if (phase === "open" || smotherTimer.current >= SMOTHER_SECONDS) {
        flameStrength.current = Math.max(0, flameStrength.current - delta / 0.12);
      }
    }
  });

  return (
    <group
      position={position as unknown as [number, number, number]}
      // Click and caption both come from `standTableActions` (VL-014).
      {...standTargetEvents("spirit-burner", { kind: "burner" })}
    >
      <primitive object={instance} />
      <Flame strength={flameStrength} />
    </group>
  );
}

useGLTF.preload(MODEL_PATH);
