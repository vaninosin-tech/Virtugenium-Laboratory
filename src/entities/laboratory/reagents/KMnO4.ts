import type { ReagentContainerConfig } from "./types";

export const kmno4: ReagentContainerConfig = {
  id: "kmno4",
  formula: "KMnO₄",
  displayName: "Перманганат калия",
  containerType: "amber250",
  labelText: "KMnO₄",
  // Raspberry-magenta, as permanganate solution really looks — not the
  // blue-violet of the crystals' name.
  contentsColor: "#9c1c6b",
  contentsOpacity: 0.85,
  fillLevel: 0.65,
};
