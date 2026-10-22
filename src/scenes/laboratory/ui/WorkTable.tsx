import { TABLE, type Position3 } from "../lib/layout";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";

const TOP_COLOR = "#eef2f6";
const TOP_COLOR_HOVER = "#f4f7fb";
const TRIM_COLOR = "#475569";
const LEG_COLOR = "#94a3b8";
const MAT_COLOR = "#334155";
const SINK_BASIN_COLOR = "#0f172a";
const SINK_RIM_COLOR = "#1f2937";
const FAUCET_COLOR = "#9aa5b1";

const LEG_INSET = 0.14;
const LEG_OFFSETS: readonly (readonly [number, number])[] = [
  [-TABLE.width / 2 + LEG_INSET, -TABLE.depth / 2 + LEG_INSET],
  [TABLE.width / 2 - LEG_INSET, -TABLE.depth / 2 + LEG_INSET],
  [-TABLE.width / 2 + LEG_INSET, TABLE.depth / 2 - LEG_INSET],
  [TABLE.width / 2 - LEG_INSET, TABLE.depth / 2 - LEG_INSET],
];

/** Y of the tabletop's actual top face — the box mesh is centered on `TABLE.height`, so anything resting "on" the table needs this, not `TABLE.height` itself. */
const TOP_Y = TABLE.height + TABLE.topThickness / 2;

/** Sink sits toward the left end of the table; the rest is the reagent/instrument work zone. */
const SINK_WIDTH = 1.0;
const SINK_X = -TABLE.width / 2 + SINK_WIDTH / 2 + 0.25;
const SINK_RIM_THICKNESS = 0.02;
const SINK_BASIN_THICKNESS = 0.01;
const MAT_THICKNESS = 0.01;

const MAT_WIDTH = TABLE.width - SINK_WIDTH - 0.6;
const MAT_X = SINK_X + SINK_WIDTH / 2 + 0.25 + MAT_WIDTH / 2;

const TOOL_OFFSETS: readonly (readonly [number, number])[] = [
  [MAT_X - MAT_WIDTH * 0.22, -TABLE.depth * 0.2],
  [MAT_X + MAT_WIDTH * 0.05, -TABLE.depth * 0.06],
  [MAT_X - MAT_WIDTH * 0.22, TABLE.depth * 0.08],
  [MAT_X + MAT_WIDTH * 0.05, TABLE.depth * 0.22],
];

/**
 * The central work table: a real work zone rather than a bare slab —
 * tabletop with a contrasting edge band, a sink with a faucet at one end,
 * and a distinct dark work mat on the rest of the surface where reagents
 * and tools (taken from the cabinets) get set down. It's one of the
 * crosshair hotspots (see CameraRig / `useSceneInteractionStore`) —
 * mouse-look at it and click to focus the "workbench" viewpoint.
 */
export function WorkTable({ position }: { readonly position: Position3 }) {
  const [x, y, z] = position;
  const isHovered = useSceneInteractionStore((state) => state.hoveredTargetId === "table");
  const topColor = isHovered ? TOP_COLOR_HOVER : TOP_COLOR;

  return (
    <group position={[x, y, z]}>
      <mesh position={[0, TABLE.height, 0]} castShadow receiveShadow>
        <boxGeometry args={[TABLE.width, TABLE.topThickness, TABLE.depth]} />
        <meshStandardMaterial color={topColor} metalness={0.1} roughness={0.35} />
      </mesh>

      {/* apron / edge band, for a more solid "framed" silhouette than a bare slab */}
      <mesh position={[0, TABLE.height - TABLE.topThickness / 2 - 0.03, 0]} castShadow>
        <boxGeometry args={[TABLE.width - 0.06, 0.05, TABLE.depth - 0.06]} />
        <meshStandardMaterial color={TRIM_COLOR} metalness={0.3} roughness={0.4} />
      </mesh>

      {LEG_OFFSETS.map(([legX, legZ]) => (
        <mesh key={`${legX}-${legZ}`} position={[legX, TABLE.height / 2, legZ]} castShadow>
          <boxGeometry args={[0.07, TABLE.height - 0.12, 0.07]} />
          <meshStandardMaterial color={LEG_COLOR} metalness={0.4} roughness={0.4} />
        </mesh>
      ))}

      {/* lower stretcher shelf, ties the legs together and reads as extra storage */}
      <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[TABLE.width - 0.5, 0.03, TABLE.depth - 0.3]} />
        <meshStandardMaterial color={LEG_COLOR} metalness={0.2} roughness={0.5} />
      </mesh>

      {/* sink: rim flush on the tabletop, basin stacked on top of the rim — each
          layer's bottom face sits exactly on the previous layer's top, so
          nothing shares a coplanar face with the tabletop and z-fights. */}
      <mesh position={[SINK_X, TOP_Y + SINK_RIM_THICKNESS / 2, 0]}>
        <boxGeometry args={[SINK_WIDTH, SINK_RIM_THICKNESS, TABLE.depth - 0.16]} />
        <meshStandardMaterial color={SINK_RIM_COLOR} roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[SINK_X, TOP_Y + SINK_RIM_THICKNESS + SINK_BASIN_THICKNESS / 2, 0]}>
        <boxGeometry args={[SINK_WIDTH - 0.1, SINK_BASIN_THICKNESS, TABLE.depth - 0.28]} />
        <meshStandardMaterial color={SINK_BASIN_COLOR} roughness={0.5} />
      </mesh>
      <mesh position={[SINK_X, TOP_Y + SINK_RIM_THICKNESS + 0.18, -TABLE.depth / 2 + 0.18]} castShadow>
        <cylinderGeometry args={[0.015, 0.015, 0.36, 8]} />
        <meshStandardMaterial color={FAUCET_COLOR} metalness={0.6} roughness={0.25} />
      </mesh>
      <mesh position={[SINK_X, TOP_Y + SINK_RIM_THICKNESS + 0.35, -TABLE.depth / 2 + 0.28]} castShadow>
        <boxGeometry args={[0.03, 0.03, 0.22]} />
        <meshStandardMaterial color={FAUCET_COLOR} metalness={0.6} roughness={0.25} />
      </mesh>

      {/* work mat — where reagents/tools from the cabinets get set down */}
      <mesh position={[MAT_X, TOP_Y + MAT_THICKNESS / 2, 0]}>
        <boxGeometry args={[MAT_WIDTH, MAT_THICKNESS, TABLE.depth - 0.2]} />
        <meshStandardMaterial color={MAT_COLOR} roughness={0.85} />
      </mesh>

      {TOOL_OFFSETS.map(([toolX, toolZ]) => (
        <mesh key={`${toolX}-${toolZ}`} position={[toolX, TOP_Y + MAT_THICKNESS + 0.06, toolZ]}>
          <cylinderGeometry args={[0.015, 0.015, 0.12, 6]} />
          <meshStandardMaterial color="#64748b" metalness={0.5} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}
