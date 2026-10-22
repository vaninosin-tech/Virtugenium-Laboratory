import type { ItemPreviewData } from "./types";

/**
 * THE place to say what hovering an item shows. Key = what the item is
 * (`itemFromHint`): `bottle`, `tube`; `bottle:<reagentId>` overrides `bottle`
 * for one reagent.
 *
 * placement — «put it here»: the item's outline standing at each live target
 *   carrying one of `targetTags`.
 * usage — «use it here», shown once the item is TAKEN into the hand (placement: on hover; `when` overrides): the item frozen at `normalizedTime` (0..1) of the
 *   pose clip `clip` (`poseClips.ts`), at each live target with one of
 *   `targetTags`. Several usage rules = several kinds of target, each with
 *   its own frame.
 *
 * Targets and their tags: `targets.ts`. Validators: `validators.ts`.
 */
export const ITEM_PREVIEW_DATA: Readonly<Record<string, ItemPreviewData>> = {
  bottle: {
    // A bottle on the table may go onto the tray, into its next free slot.
    placement: [{ enabled: true, targetTags: ["tray"], sameLocation: true }],
    usage: [
      // Over the clamped tube, tipped, 60 % into the pour — where it holds while the reagent runs in.
      // Not shown where a click would be refused (same reagent twice, foreign reagent, no tube).
      { enabled: true, targetTags: ["tube-mouth"], clip: "pour", normalizedTime: 0.6, sameLocation: true, validator: "standAction" },
    ],
  },
  tube: {
    // A tube may go into the empty clamp.
    placement: [{ enabled: true, targetTags: ["clamp"], sameLocation: true }],
    usage: [],
  },
};
