import type { ReagentContainerConfig } from "./types";

/** Diluted nitric acid — display name and label both read "HNO₃ разб." per spec (not the plain formula alone). */
export const hno3: ReagentContainerConfig = {
  id: "hno3",
  formula: "HNO₃",
  displayName: "HNO₃ разб.",
  containerType: "amber250",
  labelText: "HNO₃ разб.",
  contentsColor: "#eef6fb",
  contentsOpacity: 0.35,
  fillLevel: 0.7,
};
