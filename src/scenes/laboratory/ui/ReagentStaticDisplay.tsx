import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { createTextTexture } from "../lib/createTextTexture";
import { remapPlanarUV } from "../lib/remapPlanarUV";
import { installReagentMaterials } from "../lib/reagentMaterials";
import { useReagentInspectionStore } from "../lib/useReagentInspectionStore";
import { useReagentMaterials } from "../lib/useReagentMaterials";
import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import type { Position3 } from "../lib/layout";
import { useReagentStorageStore } from "../lib/useReagentStorageStore";
import type { ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import {
  CONTAINER_ROOT_NAME,
  createFlippedGeometry,
  createHoverHitboxGeometry,
  disableRaycast,
  findByPrefix,
  LABEL_BACKGROUND_COLOR,
  LABEL_CANVAS_HEIGHT,
  LABEL_CANVAS_WIDTH,
  LABEL_TEXT_COLOR,
  MODEL_PATH,
} from "./ReagentContainerInstance";
import { ReagentHoverRim } from "./ReagentHoverRim";

interface StaticDisplayOwnedResources {
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
  readonly textures: THREE.Texture[];
}

/**
 * Display of a TAKEN reagent — resting in a tray slot or on the workbench.
 * Shares `ReagentContainerInstance`'s exact geometry/label construction
 * (front-only text, blank-back label, contents fill/color — see its module
 * doc for why each of those exists) via its exported helpers. No animation
 * phase machine of its own — once taken, these never move on their own —
 * but IS clickable when `instanceId` is given: clicking it captures this
 * exact world pose and asks `ReagentContainerInstance` (the shelf original,
 * still mounted, just hidden) to fly back to the shelf with it (see
 * `useReagentStorageStore.requestReturn`) — the object the player is
 * looking at (this tray copy) vanishes the SAME frame the shelf original
 * reappears already at that exact pose and starts flying, so it reads as
 * one continuous object launching off the tray, not two separate meshes
 * swapping. Only meaningful for tray items — workbench copies omit
 * `instanceId` and use `hoverable` instead, gaining the same visual hover
 * cue without the tray-only click-to-shelf action.
 * Interactive items get the SAME hover treatment as a shelf original —
 * `ReagentHoverRim`'s on-object Fresnel glow is the primary, reliable hover
 * cue (see its own doc for why), without an additional postprocessing
 * outline pass — via a single invisible
 * hitbox mesh, for the same flicker-avoiding reason — see
 * `createHoverHitboxGeometry`'s doc.
 */
export function ReagentStaticDisplay({
  reagent,
  position = [0, 0, 0],
  rotationY = 0,
  scale = 1,
  worldScale,
  instanceId,
  hoverable = false,
  highlighted = false,
  onPointerDown,
  interactionRef,
}: {
  readonly reagent: ReagentContainerConfig;
  readonly position?: Position3;
  readonly rotationY?: number;
  /** Plain local scale — ignored when `worldScale` is set. */
  readonly scale?: number;
  /**
   * Absolute WORLD size to hold regardless of this group's parent's own
   * scale (e.g. `heldTray.reagentScale` for tray items — the parent, the
   * held tray, can be animating its own scale independently) — compensated
   * live, every frame, not just once on mount, so it also tracks a value
   * that keeps changing (e.g. while tuning it in the F8 dev panel).
   */
  readonly worldScale?: number;
  /** When set, clicking this display sends it back to its shelf — see the module doc. */
  readonly instanceId?: string;
  /** Enables hover feedback without enabling the tray-only click-to-shelf action. */
  readonly hoverable?: boolean;
  /** Keeps hover feedback active externally, e.g. while a workbench jar is being dragged. */
  readonly highlighted?: boolean;
  /** Optional direct press handler attached to the single interactive hitbox. */
  readonly onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  /**
   * Exposes only the lightweight hitbox to callers that perform their own
   * raycasts. The full rendered hierarchy is deliberately not used as a
   * pick target because it contains many visual-only meshes.
   */
  readonly interactionRef?: Ref<THREE.Mesh>;
}) {
  const { scene } = useGLTF(MODEL_PATH);

  const instance = useMemo(() => {
    const rootName = CONTAINER_ROOT_NAME[reagent.containerType];
    const master = scene.getObjectByName(rootName);
    if (!master) {
      throw new Error(`ReagentStaticDisplay: root node "${rootName}" not found in ${MODEL_PATH}`);
    }

    const clone = master.clone(true);
    const ownedResources: StaticDisplayOwnedResources = {
      geometries: [],
      materials: [],
      textures: [],
    };
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const label = findByPrefix(clone, "LabelSurface") as THREE.Mesh | null;
    if (label) {
      label.geometry = label.geometry.clone();
      ownedResources.geometries.push(label.geometry);
      remapPlanarUV(label, false, false);
      const texture = createTextTexture({
        lines: [reagent.labelText],
        backgroundColor: LABEL_BACKGROUND_COLOR,
        textColor: LABEL_TEXT_COLOR,
        width: LABEL_CANVAS_WIDTH,
        height: LABEL_CANVAS_HEIGHT,
      });
      ownedResources.textures.push(texture);
      // Diffuse-only paper follows scene lighting without glossy highlights.
      label.material = new THREE.MeshLambertMaterial({ map: texture, color: "#ffffff", emissive: "#ffffff", emissiveMap: texture, emissiveIntensity: 0.22, side: THREE.FrontSide });
      ownedResources.materials.push(label.material);
      label.receiveShadow = true;
      const backMaterial = new THREE.MeshLambertMaterial({
        color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.22,
        side: THREE.FrontSide,
      });
      ownedResources.materials.push(backMaterial);
      const backGeometry = createFlippedGeometry(label.geometry);
      ownedResources.geometries.push(backGeometry);
      const backMesh = new THREE.Mesh(backGeometry, backMaterial);
      backMesh.name = "LabelSurfaceBack";
      backMesh.receiveShadow = true;
      label.add(backMesh);
    }

    installReagentMaterials(clone, reagent);

    const bbox = new THREE.Box3().setFromObject(clone);
    const bboxCenter = bbox.getCenter(new THREE.Vector3());
    clone.position.x -= bboxCenter.x;
    clone.position.z -= bboxCenter.z;

    // See `createHoverHitboxGeometry`'s doc — the invisible hitbox mesh
    // rendered below is the only thing hover/click should ever hit.
    disableRaycast(clone);
    clone.userData.staticDisplayOwnedResources = ownedResources;

    return clone;
  }, [scene, reagent]);

  useReagentMaterials(instance);

  useEffect(() => {
    cancelDeferredDispose(instance);
    return () => deferDispose(instance, () => {
      const owned = instance.userData.staticDisplayOwnedResources as StaticDisplayOwnedResources;
      owned.textures.forEach((texture) => texture.dispose());
      owned.materials.forEach((material) => material.dispose());
      owned.geometries.forEach((geometry) => geometry.dispose());
    });
  }, [instance]);

  const hoverHitboxGeometry = useMemo(() => createHoverHitboxGeometry(instance), [instance]);
  useEffect(() => {
    cancelDeferredDispose(hoverHitboxGeometry);
    return () => deferDispose(hoverHitboxGeometry, () => hoverHitboxGeometry.dispose());
  }, [hoverHitboxGeometry]);

  const [hovered, setHovered] = useState(false);
  // While ANY item is being inspected (the ВЗЯТЬ/ОСТАВИТЬ decision is up —
  // `inspectedId !== null`), a jar or tube already resting on the tray must
  // not be clickable or even hoverable — same rule shelf originals
  // (`LabTestTubeCabinetInstance`'s `anyInspected`) already enforce on
  // themselves, but this component (taken items on the tray/workbench) had
  // no such guard, so the player could return a DIFFERENT jar mid-decision.
  const anyInspected = useReagentInspectionStore((state) => state.inspectedId !== null);
  const canReturnToShelf = !!instanceId && !anyInspected;
  const interactive = (hoverable || !!instanceId) && !anyInspected;
  const showHighlight = interactive && (hovered || highlighted);
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    if (worldScale === undefined) return;
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;
    // Reads the parent's own LOCAL `.scale` directly, not
    // `parent.getWorldScale()` — that decomposes the cached `matrixWorld`,
    // which the renderer only recomputes once per frame AFTER every
    // `useFrame` callback has already run, so it always lagged one frame
    // behind whatever the tray's own `step()` (`LabTrayInstance`) had just
    // set `.scale` to that same frame. Harmless while the tray sits fully
    // settled (its scale isn't changing frame-to-frame), but every frame
    // it's actively transitioning — being picked up, held near a moving
    // camera, or put back down — this mismatch read as the jar visibly
    // swimming/floating relative to the tray surface. `LabTrayInstance`'s
    // own `useFrame` now runs at priority -1 specifically so it always
    // commits `.scale` before this one reads it, making the direct read
    // exact rather than merely "usually fine". Only valid because the tray
    // group itself has no scaled ancestor above it (verified in
    // `Laboratory.tsx` — it sits directly in `<Selection>`, unscaled) — if
    // that ever changes, this would need `getWorldScale()` again, with the
    // same priority-ordering guarantee extended up that whole chain.
    group.scale.setScalar(worldScale / parent.scale.x);
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!canReturnToShelf || !instanceId) return;
    event.stopPropagation();
    const group = groupRef.current;
    if (!group) return;
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    const ws = new THREE.Vector3();
    group.getWorldPosition(wp);
    group.getWorldQuaternion(wq);
    group.getWorldScale(ws);
    useReagentStorageStore
      .getState()
      .requestReturn(instanceId, [wp.x, wp.y, wp.z], [wq.x, wq.y, wq.z, wq.w], ws.x);
  };

  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    if (!interactive) return;
    event.stopPropagation();
    document.body.style.cursor = "pointer";
    setHovered(true);
  };

  const handlePointerOut = () => {
    if (!interactive) return;
    document.body.style.cursor = "auto";
    setHovered(false);
  };

  // If an inspection starts WHILE this item is already hovered (player was
  // hovering this jar, then clicked a different one to inspect it), drop
  // the stale hover state and cursor instead of leaving them stuck.
  useEffect(() => {
    if (anyInspected && hovered) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off reset on an external change, not a render loop
      setHovered(false);
      document.body.style.cursor = "auto";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyInspected]);

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[0, rotationY, 0]}
      onClick={canReturnToShelf ? handleClick : undefined}
      onPointerOver={interactive ? handlePointerOver : undefined}
      onPointerOut={interactive ? handlePointerOut : undefined}
      {...(worldScale === undefined ? { scale } : {})}
    >
      <primitive object={instance} />
      <ReagentHoverRim object={instance} active={showHighlight} />
      {interactive && (
        // Only interactive items need a hitbox — workbench copies (no
        // `instanceId`) and items disabled during another inspection have
        // no click handler to trigger, see the module doc.
        <mesh ref={interactionRef} geometry={hoverHitboxGeometry} onPointerDown={onPointerDown}>
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
