import { standActionFor, type StandTarget } from "../standTableActions";
import type { PreviewValidator } from "./types";

/**
 * Named checks a rule may require (`validator` in the data). Each answers
 * from the same code the click itself uses, so a preview is never shown for
 * something the click would refuse.
 */
export const PREVIEW_VALIDATORS: Readonly<Record<string, PreviewValidator>> = {
  /** The stand would do this item's action right now (not refused, not busy). */
  standAction: (item) => {
    if (!item.standTarget) return false;
    const action = standActionFor(item.standTarget as StandTarget);
    return action !== null && !action.blocked;
  },
};
