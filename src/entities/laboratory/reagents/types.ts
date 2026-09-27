/**
 * Which master root node in `ReagentContainers.glb` a reagent is served in
 * — see `ReagentContainerInstance.tsx` for the containerType -> node-name
 * mapping. Exactly three container bodies exist in the asset; reagents
 * only ever pick one, never define their own geometry.
 */
export type ContainerType = "clear250" | "amber250" | "wide120";

/** Runtime metadata for one reagent's container instance — no chemistry/reaction data, just what's needed to render it (which body, label text, contents look). */
export interface ReagentContainerConfig {
  /** Stable machine id, e.g. "h2so4". */
  readonly id: string;
  /** Chemical formula with real Unicode subscripts, e.g. "H₂SO₄". */
  readonly formula: string;
  /** Human-facing name (Russian), e.g. "Серная кислота". */
  readonly displayName: string;
  readonly containerType: ContainerType;
  /** Exact text drawn onto `LabelSurface` — usually equals `formula`, but can differ (e.g. "HNO₃ разб."). */
  readonly labelText: string;
  /** CSS color string for the `ContentsVolume` mesh. */
  readonly contentsColor: string;
  /** 0-1. Solids (e.g. Cu) use 1 (opaque); clear/tinted liquids use a lower value. */
  readonly contentsOpacity: number;
  /** Solids keep a standard material and never receive liquid animation. */
  readonly contentsKind?: "liquid" | "solid";
  readonly glass?: {
    transparency?: number;
    roughness?: number;
    fresnelStrength?: number;
    fresnelPower?: number;
    edgeTint?: string;
    amberAbsorption?: number;
  };
  readonly liquid?: {
    reactionColor?: string;
    reactionMix?: number;
    cloudiness?: number;
    turbulenceStrength?: number;
    emissionStrength?: number;
    topHighlight?: number;
  };
  /** 0-1 fraction of the container's contents cavity height that's filled. */
  readonly fillLevel: number;
}
