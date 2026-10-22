import { useEffect, useMemo, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import type { EntityId } from "../../../entities/laboratory";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { createTextTexture } from "../lib/createTextTexture";
import { EQUIPMENT, type Position3 } from "../lib/layout";
import { loadCabinetFonts } from "../lib/loadCabinetFonts";
import { useCabinetOpenStore } from "../lib/useCabinetOpenStore";
import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";

const DEF = EQUIPMENT.find((equipment) => equipment.id === "ppe-cabinet")!;

const LABEL_FONT_FAMILY = '"Unbounded", "Russo One", "Exo 2", sans-serif';
const CANVAS_WIDTH = 512;
const CANVAS_HEIGHT = 288;

const IDLE_BACKGROUND = "#20242a";
const IDLE_TEXT = "#e2e8f0";
const WORN_BACKGROUND = "#123524";
const WORN_TEXT = "#6ee7a8";

interface PPEPlateDef {
  readonly catalogItemId: EntityId;
  readonly title: string;
  /**
   * Taken from `PPECabinet.glb`'s own empty anchors (see
   * `tests/measure-ppe-cabinet.mjs`), not eyeballed:
   *   PPE_GogglesSlot [-0.17, 1.68, 0] and PPE_GlovesSlot [0.17, 1.68, 0] are
   *   the centres of the two top-shelf compartments either side of
   *   `PPE_TopDivider` (shelf surface 1.53, divider top 1.83) — exactly a
   *   plate's worth of space each. The coat keeps `PPE_CoatAnchor`'s x/z but
   *   hangs lower, in the open space under `PPE_CoatRail` (y 1.438..1.462).
   */
  readonly position: Position3;
  readonly size: readonly [number, number];
}

const PPE_PLATES: readonly PPEPlateDef[] = [
  {
    catalogItemId: "safety-goggles",
    title: "ОЧКИ",
    position: [-0.17, 1.68, 0],
    size: [0.26, 0.13],
  },
  {
    catalogItemId: "safety-gloves",
    title: "ПЕРЧАТКИ",
    position: [0.17, 1.68, 0],
    size: [0.26, 0.13],
  },
  {
    catalogItemId: "safety-coat",
    title: "ХАЛАТ",
    position: [0, 1.15, -0.05],
    size: [0.3, 0.15],
  },
];

function PPEPlate({
  plate,
  worn,
  fontsReady,
  onPut,
}: {
  readonly plate: PPEPlateDef;
  readonly worn: boolean;
  readonly fontsReady: boolean;
  readonly onPut: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  const texture = useMemo(
    () =>
      createTextTexture({
        lines: [plate.title, worn ? "НАДЕТО" : "НАДЕТЬ"],
        backgroundColor: worn ? WORN_BACKGROUND : IDLE_BACKGROUND,
        textColor: worn ? WORN_TEXT : IDLE_TEXT,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        fontFamily: fontsReady ? LABEL_FONT_FAMILY : undefined,
        letterSpacing: "0.04em",
      }),
    [plate.title, worn, fontsReady],
  );

  useEffect(() => () => texture.dispose(), [texture]);

  // A worn item stays on as a status plate, so it must stop advertising
  // itself as something still to click.
  const interactive = !worn;

  return (
    <mesh
      position={plate.position}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        if (interactive) onPut();
      }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        if (!interactive) return;
        document.body.style.cursor = "pointer";
        setHovered(true);
      }}
      onPointerOut={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        document.body.style.cursor = "auto";
        setHovered(false);
      }}
    >
      <planeGeometry args={[plate.size[0], plate.size[1]]} />
      <meshStandardMaterial
        map={texture}
        roughness={0.9}
        metalness={0}
        emissiveMap={texture}
        emissive={new THREE.Color("#ffffff")}
        emissiveIntensity={hovered && interactive ? 0.45 : 0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * The three PPE plates inside the СИЗ cabinet — the only way to actually put
 * PPE on. Deliberately flat signage rather than modelled goggles/gloves/coat:
 * a plate that is SUPPOSED to be flat never reads as a failed 3D object, and
 * this project has no capacity for new Blender assets.
 *
 * Only mounted while the door is open, so a click can't reach a plate through
 * the closed door.
 */
export function PPEBoard() {
  const override = useFurniturePositionStore((state) => state.getOverride(DEF.id));
  const [x, y, z] = override.position;
  const rotationY = override.rotationY ?? DEF.rotationY;

  const isOpen = useCabinetOpenStore((state) => state.openById[DEF.id] ?? false);
  const inventoryItemIds = useLaboratoryStore((state) => state.inventoryItemIds);
  const addInventoryItem = useLaboratoryStore((state) => state.addInventoryItem);

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

  if (!isOpen) return null;

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      {PPE_PLATES.map((plate) => (
        <PPEPlate
          key={plate.catalogItemId}
          plate={plate}
          worn={inventoryItemIds.includes(plate.catalogItemId)}
          fontsReady={fontsReady}
          onPut={() => addInventoryItem(plate.catalogItemId)}
        />
      ))}
    </group>
  );
}
