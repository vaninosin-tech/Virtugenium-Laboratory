import type { StandTarget } from "../standTableActions";
import type { HeldItem } from "../useHandStore";
import type { PreviewItem } from "./types";

/**
 * What the hover caption's target (`useStandHintStore`) is, for previews:
 * a reagent bottle or a tube taken from a rack. The stand's own parts and the
 * clamped tube are not items that move, so they have no previews.
 */
export function itemFromHint(owner: string | null, target: StandTarget | null): PreviewItem | null {
  if (!owner || !target) return null;
  switch (target.kind) {
    case "bottle":
      return { id: target.instanceId ?? owner, key: "bottle", variant: target.reagentId, location: target.location, standTarget: target };
    case "rack-tube":
      return { id: owner, key: "tube", location: target.location, standTarget: target };
    default:
      return null;
  }
}

/**
 * The item in the hand, for previews. A tray item is not one: where it came
 * from and what it holds are not known here, and it is set down, not used.
 */
export function itemFromHeld(held: HeldItem | null): PreviewItem | null {
  if (!held) return null;
  switch (held.kind) {
    case "bottle":
      return {
        id: held.instanceId,
        key: "bottle",
        variant: held.reagentId,
        location: held.location,
        standTarget: { kind: "bottle", location: held.location, reagentId: held.reagentId, instanceId: held.instanceId } satisfies StandTarget,
      };
    case "tube":
      return { id: held.instanceId, key: "tube", location: "fumeHood" };
    case "workbench-tube":
      return { id: held.instanceId, key: "tube", location: "workbench" };
    default:
      return null;
  }
}
