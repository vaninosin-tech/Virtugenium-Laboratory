import { agno3 } from "./AgNO3";
import { bacl2 } from "./BaCl2";
import { cu } from "./Cu";
import { hno3 } from "./HNO3";
import { h2so4 } from "./H2SO4";
import { k2so4 } from "./K2SO4";
import { kmno4 } from "./KMnO4";
import { na2so3 } from "./Na2SO3";
import { nacl } from "./NaCl";

export type { ContainerType, ReagentContainerConfig } from "./types";

/** Single source of truth for all 9 reagent container configs, keyed by stable id — no reagent metadata is duplicated anywhere else. */
export const REAGENTS = {
  cu,
  hno3,
  h2so4,
  agno3,
  nacl,
  bacl2,
  k2so4,
  na2so3,
  kmno4,
} as const;

export type ReagentId = keyof typeof REAGENTS;
