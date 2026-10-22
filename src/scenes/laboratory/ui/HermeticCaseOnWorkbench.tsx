import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Select } from "@react-three/postprocessing";
import * as THREE from "three";

import type { Position3 } from "../lib/layout";
import { DRAWER_TRAVEL, TUBE_CASE_MOTION, TUBE_CASE_ZONE } from "../lib/tubeCaseZone";
import { useHandStore } from "../lib/useHandStore";
import { useTestTubeDragStore } from "../lib/useTestTubeDragStore";
import { useTubeCaseStore } from "../lib/useTubeCaseStore";
import { useWorkbenchReagentAreaStore } from "../lib/useWorkbenchReagentAreaStore";
import { useBoxObstacle } from "../lib/worktopBounds";

const MODEL_PATH = "/assets/models/HermeticCase.glb";

/**
 * Sealed aluminium case for test tubes (`HermeticCase.glb`, export/HermeticCase) — it lives in the bottom drawer
 * of the left cabinet under the workbench. Everything below is in WORKBENCH space (the group at the table's position),
 * where the drawer's front plane is at z = -0.85 and the countertop is `counterSurfaceY` high.
 *
 *   stowed        in the drawer, hidden inside the cabinet
 *   1. drawer     the drawer front slides out, the case rides in it
 *   2. lift       the case rises in front of the table edge
 *   3. across     it moves sideways to its place, 4. in: onto the worktop
 *   then          one click opens it (latches, lid) — the model's own animation clips, scrubbed by `openProgress`
 *
 * With the lid open its tray is a drop zone: a carried test tube brought over it is put away (`tubeToCase`).
 */
const ROOT_TO_BOTTOM = 0.135;               // the model's origin is the seam; the base is 135 mm below it
const STOW = { x: -0.925, y: 0.07 + ROOT_TO_BOTTOM, z: -0.85 + 0.03 + 0.145 };
const FINAL_X = -0.53;
const FINAL_Z = -0.65;
const LIFT_CLEARANCE = 0.045;               // how far the base passes above the countertop edge
const MOVE_SECONDS = 4.2;
const OPEN_SECONDS = 3.6;
const HALF_X = 0.17;
const HALF_Z = 0.14;
const BODY_TOP = 0.062;

const smooth = (t: number) => {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

/** Case position in workbench space for travel `p` (0..1), and how far the drawer is out. */
function pathAt(p: number, counter: number, out: THREE.Vector3): number {
  const outZ = STOW.z - DRAWER_TRAVEL;
  const liftY = counter + ROOT_TO_BOTTOM + LIFT_CLEARANCE;
  const finalY = counter + ROOT_TO_BOTTOM + 0.001;
  if (p < 0.3) {
    const u = smooth(p / 0.3);
    out.set(STOW.x, STOW.y, STOW.z - DRAWER_TRAVEL * u);
    return u;
  }
  if (p < 0.62) {
    out.set(STOW.x, THREE.MathUtils.lerp(STOW.y, liftY, smooth((p - 0.3) / 0.32)), outZ);
    return 1;
  }
  if (p < 0.8) {
    out.set(THREE.MathUtils.lerp(STOW.x, FINAL_X, smooth((p - 0.62) / 0.18)), liftY, outZ);
    return 1;
  }
  const u = smooth((p - 0.8) / 0.2);
  out.set(FINAL_X, THREE.MathUtils.lerp(liftY, finalY, u), THREE.MathUtils.lerp(outZ, FINAL_Z, u));
  return 1;
}

export function HermeticCaseOnWorkbench({ tableWorldPosition }: { readonly tableWorldPosition: Position3 }) {
  const { scene, animations } = useGLTF(MODEL_PATH);
  const counter = useWorkbenchReagentAreaStore((state) => state.config.originY);
  const deployed = useTubeCaseStore((state) => state.deployed);
  const isOpen = useTubeCaseStore((state) => state.isOpen);
  const storedCount = useTubeCaseStore((state) => state.stored.length);
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef<THREE.Group>(null);
  const zoneRef = useRef<THREE.Group>(null);
  const moveProgress = useRef(0);
  const openProgress = useRef(0);
  const scratch = useMemo(() => new THREE.Vector3(), []);

  const { instance, tubes, zoneY, glass } = useMemo(() => {
    const clone = scene.clone(true);
    const glassMaterials: THREE.Material[] = [];
    const tubeNodes: { index: number; node: THREE.Object3D }[] = [];
    clone.traverse((object) => {
      const match = /^CaseTube_(\d+)$/.exec(object.name);
      if (match) tubeNodes.push({ index: Number(match[1]) - 1, node: object });
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const material = object.material as THREE.MeshStandardMaterial;
      if (material.name === "Lab_Glass") {
        // Plain alpha-blended glass (no transmission pass), drawn after the opaque case parts.
        const own = material.clone();
        own.transparent = true;
        own.depthWrite = false;
        own.opacity = 0.32;
        object.material = own;
        object.castShadow = false;
        object.renderOrder = 2;
        glassMaterials.push(own);
      }
    });
    const zone = clone.getObjectByName("TubeZone");
    return { instance: clone, tubes: tubeNodes, zoneY: zone?.position.y ?? 0, glass: glassMaterials };
  }, [scene]);
  useEffect(() => () => glass.forEach((material) => material.dispose()), [glass]);

  // Tubes the player has put away stand in the first cells; the rest of the 50 are hidden.
  useEffect(() => {
    for (const { index, node } of tubes) node.visible = index < storedCount;
  }, [tubes, storedCount]);

  // All moving parts (lid, levers, links, safety gates, gasket) are clips on one timeline: closed → open.
  const { mixer, duration } = useMemo(() => {
    const m = new THREE.AnimationMixer(instance);
    for (const clip of animations) m.clipAction(clip).play();
    return { mixer: m, duration: Math.max(0, ...animations.map((clip) => clip.duration)) };
  }, [instance, animations]);
  useEffect(() => {
    mixer.setTime(0);
  }, [mixer]);

  useEffect(() => {
    TUBE_CASE_ZONE.object = zoneRef.current;
    return () => {
      TUBE_CASE_ZONE.object = null;
      TUBE_CASE_ZONE.armed = false;
      TUBE_CASE_MOTION.drawer = 0;
    };
  }, []);

  useBoxObstacle("tube-case", groupRef, { minX: -HALF_X, maxX: HALF_X, minZ: -HALF_Z, maxZ: HALF_Z });

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    // The lid opens only once the case is on the table, and the case is put away only with the lid shut.
    const wantOpen = deployed && isOpen && moveProgress.current >= 0.999;
    openProgress.current = THREE.MathUtils.clamp(openProgress.current + (wantOpen ? 1 : -1) * delta / OPEN_SECONDS, 0, 1);
    if (deployed || openProgress.current <= 0.001) {
      moveProgress.current = THREE.MathUtils.clamp(moveProgress.current + (deployed ? 1 : -1) * delta / MOVE_SECONDS, 0, 1);
    }
    mixer.setTime(Math.min(openProgress.current * duration, duration - 0.001));
    TUBE_CASE_MOTION.drawer = pathAt(moveProgress.current, counter, scratch);
    group.position.copy(scratch);
    group.visible = moveProgress.current > 0.001;
    TUBE_CASE_ZONE.armed = moveProgress.current >= 0.999 && openProgress.current >= 0.995;
  });

  const hitbox = useMemo(() => new THREE.BoxGeometry(HALF_X * 2, ROOT_TO_BOTTOM + BODY_TOP, HALF_Z * 2), []);
  useEffect(() => () => hitbox.dispose(), [hitbox]);

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 || moveProgress.current < 0.999) return;
    // With a tube in the hand the click belongs to the drop zone, not to the lid.
    if (useTestTubeDragStore.getState().heldInstanceId !== null || useHandStore.getState().held) return;
    event.stopPropagation();
    useTubeCaseStore.getState().toggleOpen();
  };

  return (
    <group position={[tableWorldPosition[0], tableWorldPosition[1], tableWorldPosition[2]]}>
      <group ref={groupRef} rotation={[0, Math.PI, 0]} visible={false}>
        <Select enabled={hovered}>
          <primitive object={instance} />
        </Select>
        <group ref={zoneRef} position={[0, zoneY, 0]} />
        <mesh
          geometry={hitbox}
          position={[0, (BODY_TOP - ROOT_TO_BOTTOM) / 2, 0]}
          onPointerDown={handlePointerDown}
          onPointerOver={(event) => {
            if (moveProgress.current < 0.999) return;
            event.stopPropagation();
            document.body.style.cursor = "pointer";
            setHovered(true);
          }}
          onPointerOut={(event) => {
            event.stopPropagation();
            document.body.style.cursor = "auto";
            setHovered(false);
          }}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

useGLTF.preload(MODEL_PATH);
