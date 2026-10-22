import type { ReagentContainerConfig } from "./types";

/** Solid copper (granules/wire) in the wide-mouth jar — opaque, not a liquid, so opacity is 1 and the fill sits lower than a liquid reagent's. */
export const cu: ReagentContainerConfig = {
  id: "cu",
  formula: "Cu",
  displayName: "Медь",
  containerType: "wide120",
  labelText: "Cu",
  contentsColor: "#b5651d",
  contentsOpacity: 1.0,
  fillLevel: 0.45,
};
