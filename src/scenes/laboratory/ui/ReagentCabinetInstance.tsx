import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { REAGENTS, type ReagentId } from "../../../entities/laboratory/reagents";
import { createTextTexture } from "../lib/createTextTexture";
import { CONTROL_PANEL_SCREEN_MESH_NAME, useCabinetDoorAnimation } from "../lib/useCabinetDoorAnimation";
import { useCabinetOpenStore } from "../lib/useCabinetOpenStore";
import { CABINET_SCALE, type CabinetDef, type HotspotTargetId, type Position3 } from "../lib/layout";
import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";
import { loadCabinetFonts } from "../lib/loadCabinetFonts";
import { remapPlanarUV } from "../lib/remapPlanarUV";
import { useHotspotObjectsStore } from "../lib/useHotspotObjectsStore";
import { useReagentStorageStore } from "../lib/useReagentStorageStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { Select } from "@react-three/postprocessing";
import { BunsenStandInstance } from "./BunsenStandInstance";
import { SpiritLampShelfInstance } from "./SpiritLampItem";
import { LabTestTubeCabinetInstance } from "./LabTestTubeCabinetInstance";
import { LabTestTubeRackInstance } from "./LabTestTubeRackInstance";
import { computeTubeSlotPosition, TEST_TUBE_TRAY_CAPACITY } from "../lib/useTestTubeStorageStore";
import { ReagentContainerInstance } from "./ReagentContainerInstance";

const MODEL_PATH = "/assets/models/ReagentCabinet.glb";

/**
 * `ReagentCabinet.glb`'s `Shelf_01`/`02`/`03` mesh bounding boxes (verified
 * from the glb's own accessor data, not measured/guessed): each spans local
 * X −0.328..0.468 (0.796m) and Z −0.08..0.19 (depth, centered at 0.055 —
 * used unchanged for every slot), with top surface Y at 0.986 / 1.273 /
 * 1.559 respectively. `ServiceColumn` (X −0.468..−0.328) and
 * `SidePost_Left`/`SidePost_Right` (X −0.550..−0.468 / 0.468..0.550) sit
 * immediately OUTSIDE this range already — they don't overlap the shelf
 * bbox at all — so EDGE_CLEARANCE below is a pure visual buffer (no bottle
 * edge flush against the shelf's own frame or the adjacent service column),
 * not a correction for an actual geometry overlap.
 *
 * Each shelf's USABLE width (shelf bbox shrunk by EDGE_CLEARANCE on both
 * sides) is split into 4 EQUAL slots, reagent centered in each:
 *   usableWidth = (0.468 − 0.03) − (−0.328 + 0.03) = 0.736m
 *   slotWidth = 0.736 / 4 = 0.184m
 *   slot i center = usableMinX + slotWidth × (i + 0.5)
 * A container's bottom sits SHELF_SURFACE_CLEARANCE above the shelf's real
 * top surface (not an arbitrary anchor Y) — `ReagentContainerInstance`
 * itself guarantees the container's Y=0 is its true visual bottom and its
 * X/Z=0 is its true visual center, so placing a group at this position is
 * placing the actual bottle, not some off-center studio-layout origin.
 *
 * Listed in FILL ORDER: top shelf first, left-to-right within each shelf,
 * then the next shelf down — so `CABINET_REAGENT_IDS[cabinet].map(...)` can
 * index straight into this array with no extra sorting. 12 slots (4 per
 * shelf) total.
 */
const SHELF_MIN_X = -0.3279999783098617;
const SHELF_MAX_X = 0.4680000077933073;
const EDGE_CLEARANCE = 0.03;
const USABLE_MIN_X = SHELF_MIN_X + EDGE_CLEARANCE;
const USABLE_MAX_X = SHELF_MAX_X - EDGE_CLEARANCE;
const SLOT_WIDTH = (USABLE_MAX_X - USABLE_MIN_X) / 4;
/**
 * Descending (USABLE_MAX_X down to USABLE_MIN_X), not ascending — verified
 * on-screen: for a wall cabinet rotated `rotationY: Math.PI / 2` (e.g.
 * `cabinet-salts`), increasing local X renders further LEFT on screen, not
 * right. Slot index 0 must be the visually-leftmost slot (per the fill
 * spec's "left to right"), so it takes the LARGEST local X.
 */
const REAGENT_COLUMN_X: readonly number[] = [0, 1, 2, 3].map((i) => USABLE_MAX_X - SLOT_WIDTH * (i + 0.5));

/**
 * Shelf top-surface Y (max Y of each shelf mesh's bbox), sorted by REAL
 * height — HIGHEST first — not by the glb's `Shelf_01`/`02`/`03` naming.
 * `Shelf_01` is actually the BOTTOM shelf (Y 0.986) and `Shelf_03` the TOP
 * (Y 1.559); listing them in name order previously filled the cabinet
 * bottom-up instead of top-down. Plus a small clearance so a container's
 * bottom doesn't z-fight the shelf surface.
 */
const SHELF_TOP_Y_HIGHEST_FIRST = [1.5587999913841486, 1.2725000474601984, 0.9861999843269587] as const;
const SHELF_SURFACE_CLEARANCE = 0.002;
const REAGENT_SHELF_Y: readonly number[] = SHELF_TOP_Y_HIGHEST_FIRST.map((y) => y + SHELF_SURFACE_CLEARANCE);

/** Shelf depth center (midpoint of Shelf's own Z −0.08..0.19 bbox) — same for every slot. */
const REAGENT_ANCHOR_Z = 0.054999999701976776;

/** The spirit lamp on the equipment shelf: 0.23 m to the side of the stand's centre — clear of its 0.12 m base, on the side its clamp arm does not reach. */
const SPIRIT_LAMP_SHELF_POSITION: Position3 = [(SHELF_MIN_X + SHELF_MAX_X) / 2 + 0.23, REAGENT_SHELF_Y[0], REAGENT_ANCHOR_Z];

const REAGENT_ANCHOR_POSITIONS: readonly Position3[] = REAGENT_SHELF_Y.flatMap((y) =>
  REAGENT_COLUMN_X.map((x): Position3 => [x, y, REAGENT_ANCHOR_Z]),
);

// Center the stocked rack on the top shelf, clear of the service column.
const GLASSWARE_RACK = {
  x: (SHELF_MIN_X + SHELF_MAX_X) / 2,
  y: REAGENT_SHELF_Y[0],
  z: REAGENT_ANCHOR_Z,
  rotY: 0,
  scale: 1,
};
const GLASSWARE_TUBE_POSITIONS = Array.from({ length: TEST_TUBE_TRAY_CAPACITY }, (_, index) =>
  computeTubeSlotPosition(GLASSWARE_RACK, index),
);

/**
 * Every reagent prepared so far (`entities/laboratory/reagents`), sorted
 * into its cabinet by category — the single source of truth for "which
 * reagents are stocked where". `cabinet-bases`/`cabinet-oxides` have no
 * entry (no base/oxide reagent exists yet) so those cabinets render empty
 * shelves rather than fabricated placeholders. Fills anchors 1..N in order,
 * so adding a reagent to a list is the entire "add it to the game" step.
 */
const CABINET_REAGENT_IDS: Partial<Record<HotspotTargetId, readonly ReagentId[]>> = {
  "cabinet-acids": ["hno3", "h2so4"],
  "cabinet-salts": ["agno3", "nacl", "bacl2", "k2so4", "na2so3", "kmno4"],
  "cabinet-simple": ["cu"],
};

/**
 * `CategoryLabelPlate` (the physical sign plate above the doors, rebuilt in
 * `ReagentCabinet_MASTER.blend` this pass — dimensions verified from the
 * glb's own accessor data, not guessed) is 0.62m x 0.095m ≈ 6.53:1, so the
 * canvas matches that ratio (1024x157, power-of-two width) to avoid
 * stretching. Two-line labels (currently only "Хим. посуда") split on the
 * first space — a data-driven rule, not a hardcoded special case for that
 * one label.
 */
const LABEL_CANVAS_WIDTH = 1024;
const LABEL_CANVAS_HEIGHT = 157;
/**
 * Dark graphite plate + pure white text — the plate's material is unlit
 * (see below), so this renders exactly as drawn, with no scene-lighting or
 * tone-mapping desaturation to compensate for.
 */
const LABEL_TEXT_COLOR = "#FFFFFF";
const LABEL_BACKGROUND_COLOR = "#20242a";
/**
 * Preferred → fallback chain per spec: Unbounded, then Russo One, then
 * Exo 2, all with Cyrillic subsets self-hosted via `@fontsource` (see
 * `cabinetLabelFonts.css`) — a Tauri desktop build can't rely on a Google
 * Fonts CDN link being reachable at runtime. `sans-serif` is a last-resort
 * safety net only; `loadCabinetFonts` is what actually keeps it from ever
 * being needed in practice.
 */
const LABEL_FONT_FAMILY = '"Unbounded", "Russo One", "Exo 2", sans-serif';
const LABEL_LETTER_SPACING = "0.04em";

function buildLabelTexture(displayName: string, fontsReady: boolean): THREE.CanvasTexture {
  // Physical category plate reads in full caps per spec ("ОКСИДЫ", not
  // "Оксиды") even though the stored label stays title-case for the HUD's
  // "Шкаф: Оксиды" line.
  // Always a single line — createTextTexture already auto-shrinks the font
  // to fit the widest line, so long names ("ПРОСТЫЕ ВЕЩЕСТВА", "ХИМ.
  // ПОСУДА") stay on one row instead of wrapping.
  const lines = [displayName.toUpperCase()];

  // Until the webfonts are confirmed loaded, draw with the plain system
  // stack (always available, no async race) rather than requesting
  // "Unbounded" before it's ready — canvas `fillText` would otherwise
  // silently draw with whatever default the browser substitutes and never
  // redraw on its own. The `fontsReady` flip re-runs this (see the
  // `useMemo` deps in `ReagentCabinetInstance`) to pick up the real font.
  return createTextTexture({
    lines,
    backgroundColor: LABEL_BACKGROUND_COLOR,
    textColor: LABEL_TEXT_COLOR,
    width: LABEL_CANVAS_WIDTH,
    height: LABEL_CANVAS_HEIGHT,
    fontFamily: fontsReady ? LABEL_FONT_FAMILY : undefined,
    letterSpacing: LABEL_LETTER_SPACING,
  });
}

function findByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!found && object.name === name) found = object;
  });
  return found;
}

/**
 * One reusable reagent cabinet body (`public/assets/models/ReagentCabinet.glb`)
 * placed at four wall positions — acids, bases, oxides, salts — per the
 * reagent-cabinet asset design ("one reusable base cabinet serves four
 * categories ... do not build four different cabinet bodies"). The asset
 * itself is loaded once and deep-cloned per instance so each cabinet is an
 * independent scene object (own transform, own page/shutter/label state)
 * without re-parsing the glTF four times.
 *
 * `CategoryLabelPlate` gets a per-instance lit `MeshStandardMaterial` with a
 * canvas texture showing this cabinet's own Russian category name — real
 * geometry, not an `<Html>` overlay, so it's naturally occluded like any
 * other solid mesh and moves with the cabinet. It's a plain `.map` (not
 * `emissiveMap`), since the sign is meant to stay readable at all times,
 * unlike the ControlPanel's screen which powers on/off with the cabinet.
 * Unlit rather than the shipped lit material, specifically so the text
 * renders as true white regardless of scene lighting or tone mapping.
 * A `CategoryLabelAnchor` empty also ships on the plate (centered, ~1cm
 * proud of its face) for any future non-texture text approach — this pass
 * keeps rendering through the proven CanvasTexture-on-mesh path, which
 * already satisfies "no hardcoded per-cabinet coordinates" structurally
 * (the plate's own shared local geometry is identical across instances).
 * `CategoryLabelAccent` (the plate's thin trim strip) is a separate mesh
 * with its own material, cloned and recolored per instance from
 * `cabinet.accentColor` — the shared glb itself never bakes in any one
 * category's color; only the plate body's neutral material and blank
 * geometry ship in the asset.
 */
export function ReagentCabinetInstance({ cabinet }: { readonly cabinet: CabinetDef }) {
  const { scene } = useGLTF(MODEL_PATH);
  const override = useFurniturePositionStore((state) => state.getOverride(cabinet.id));
  const [x, y, z] = override.position;
  const rotationY = override.rotationY ?? cabinet.rotationY;

  // Canvas `fillText` silently falls back to a default font if the
  // requested `@font-face` family isn't loaded yet — there's no automatic
  // re-draw once it becomes available, so the label texture must be
  // (re)built once this flips true. `Laboratory.tsx` already kicks the same
  // load off on scene mount as a head start; this is the correctness
  // guarantee regardless of that timing.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadCabinetFonts().then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const label = findByName(clone, "CategoryLabelPlate") as THREE.Mesh | null;
    if (label && label.material) {
      // The mesh's own UV layout is a packed 6-face box unwrap (verified
      // from the glb's accessor data: U confined to [0.125, 0.875], not a
      // clean front-face 0-1 range) — sampling a custom texture through
      // that produces banding, which is what actually caused the earlier
      // "black stripes" bug. Remap to a simple front-face projection first.
      // Verified in-browser: the plate's local U/V axes run opposite to
      // screen right/up, so the default projection renders mirrored and
      // upside-down — flip both to read correctly.
      remapPlanarUV(label, true, false);
      // Printed sign: its brightness follows room lighting.
      label.material = new THREE.MeshStandardMaterial({
        map: buildLabelTexture(cabinet.label, fontsReady),
        roughness: 0.9,
        metalness: 0,
      });
    }

    // The plate's own body stays one neutral shared material — only this
    // dedicated accent strip (`MAT_Label_Accent` in the source asset, a
    // cyan trim by default) is recolored per instance, so the shared glb
    // never bakes in a single category's color. Base/emissive ratio (~0.5)
    // matches the asset's own shipped cyan trim (emissiveFactor ≈ baseColor
    // * 0.5) — keeps every category's accent equally subtle, not neon.
    const accent = findByName(clone, "CategoryLabelAccent") as THREE.Mesh | null;
    if (accent && accent.material) {
      const cloned = (accent.material as THREE.MeshStandardMaterial).clone();
      const categoryColor = new THREE.Color(cabinet.accentColor);
      cloned.color = categoryColor;
      cloned.emissive = categoryColor.clone().multiplyScalar(0.5);
      accent.material = cloned;
    }

    return clone;
  }, [scene, cabinet.label, cabinet.accentColor, fontsReady]);

  useEffect(() => {
    return () => {
      instance.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
        }
      });
    };
  }, [instance]);

  // Registers the actual rendered hierarchy for `CameraRig`'s crosshair
  // hover raycast — any mesh under `instance` (doors, shelves, panel, ...)
  // now counts as "hovering this cabinet", not just a fixed point near it.
  useEffect(() => {
    useHotspotObjectsStore.getState().register(cabinet.id, instance);
    return () => useHotspotObjectsStore.getState().unregister(cabinet.id);
  }, [instance, cabinet.id]);

  const isHovered = useSceneInteractionStore((state) => state.hoveredTargetId === cabinet.id);
  const isOpen = useCabinetOpenStore((state) => state.openById[cabinet.id] ?? false);
  const controlPanelScreen = useCabinetDoorAnimation(instance, isOpen, cabinet.id, cabinet.totalPages);

  // Shelf stock is SESSION-LOCAL: reset this cabinet's taken-reagent set the
  // instant it's FRESHLY focused (room -> this cabinet, or another cabinet
  // -> this cabinet via the chain switch) so re-entering always shows
  // original stock, regardless of what was taken last time. Guarded by
  // `wasFocusedRef` so it fires exactly once per fresh focus, not on every
  // phase change (focusing -> inspecting -> returning) while still on this
  // same cabinet.
  const focusedCabinetId = useSceneInteractionStore((state) => state.focusedCabinetId);
  const cabinetPhase = useSceneInteractionStore((state) => state.cabinetPhase);
  const wasFocusedRef = useRef(false);
  useEffect(() => {
    const isThisFocused = focusedCabinetId === cabinet.id && cabinetPhase !== "room";
    if (isThisFocused && !wasFocusedRef.current) {
      useReagentStorageStore.getState().resetCabinetSession(cabinet.id);
    }
    wasFocusedRef.current = isThisFocused;
  }, [focusedCabinetId, cabinetPhase, cabinet.id]);

  // R3F raycasts the whole cloned hierarchy (doors, shelves, screen, ...)
  // through this single `<primitive>` — `event.object` tells us which
  // specific mesh was actually hit, so the screen's own touch-zone
  // interaction (see `useCabinetDoorAnimation`) only ever fires for hits on
  // `Page_Display` itself, never an invisible box layered in front of it.
  const handleScreenPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (event.object.name !== CONTROL_PANEL_SCREEN_MESH_NAME) {
      controlPanelScreen.handlePointerLeave();
      return;
    }
    event.stopPropagation();
    controlPanelScreen.handlePointerMove(event.uv);
  };

  const handleScreenPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.object.name !== CONTROL_PANEL_SCREEN_MESH_NAME) return;
    event.stopPropagation();
    controlPanelScreen.handlePointerDown(event.uv);
  };

  // Stocked reagents (if any) for this cabinet's category — see
  // CABINET_REAGENT_IDS. Rendered as ordinary children of this same scaled
  // group so REAGENT_ANCHOR_POSITIONS' local (unscaled) coordinates need no
  // extra conversion; they're simply occluded by the closed doors like any
  // other interior geometry, so no open/closed visibility check is needed.
  // Capped at REAGENT_ANCHOR_POSITIONS.length (12, the 4-per-shelf display
  // spec) so a future category list growing past that can't index past the
  // anchor array — it just doesn't render the overflow rather than crashing.
  const reagentIds = (CABINET_REAGENT_IDS[cabinet.id] ?? []).slice(0, REAGENT_ANCHOR_POSITIONS.length);

  // All 16 rack slots are stocked. A tube is taken immediately on click;
  // shelf stock remains visible as the cabinet's reusable supply.
  const isGlasswareCabinet = cabinet.id === "cabinet-glassware";
  // First piece of content for this cabinet (previously an empty shelf —
  // see the `CABINETS` doc). Placed on the top shelf: `BunsenStand.glb`'s
  // own rod is 0.30m tall, taller than the ~0.286m gap between shelves, so
  // it only clears under the cabinet's ceiling, not a shelf above it.
  const isLabEquipmentCabinet = cabinet.id === "cabinet-lab-equipment";

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]} scale={CABINET_SCALE}>
      <Select enabled={isHovered}>
        <primitive
          object={instance}
          onPointerMove={handleScreenPointerMove}
          onPointerDown={handleScreenPointerDown}
          onPointerUp={() => controlPanelScreen.handlePointerUp()}
          onPointerLeave={() => controlPanelScreen.handlePointerLeave()}
        />
      </Select>
      {reagentIds.map((reagentId, index) => (
        <ReagentContainerInstance
          key={reagentId}
          id={`${cabinet.id}-${reagentId}`}
          cabinetId={cabinet.id}
          reagent={REAGENTS[reagentId]}
          position={REAGENT_ANCHOR_POSITIONS[index]}
          rotationY={Math.PI}
        />
      ))}
      {isGlasswareCabinet && (
        <group>
          <LabTestTubeRackInstance
            position={[GLASSWARE_RACK.x, GLASSWARE_RACK.y, GLASSWARE_RACK.z]}
          />
          {GLASSWARE_TUBE_POSITIONS.map((position, index) => (
            <LabTestTubeCabinetInstance
              key={index}
              id={`${cabinet.id}-test-tube-${index}`}
              cabinetId={cabinet.id}
              position={position}
              rotationY={Math.PI}
            />
          ))}
        </group>
      )}
      {isLabEquipmentCabinet && (
        <>
          <BunsenStandInstance
            cabinetId={cabinet.id}
            position={[(SHELF_MIN_X + SHELF_MAX_X) / 2, REAGENT_SHELF_Y[0], REAGENT_ANCHOR_Z]}
            rotationY={Math.PI}
          />
          {/* Beside the stand, on the side away from its clamp arm (turned to −X by the half turn). */}
          <SpiritLampShelfInstance cabinetId={cabinet.id} position={SPIRIT_LAMP_SHELF_POSITION} rotationY={Math.PI} />
        </>
      )}
    </group>
  );
}

useGLTF.preload(MODEL_PATH);
