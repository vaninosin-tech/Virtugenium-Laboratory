/**
 * A workbench rack tube carried with the button held down (VL-018): letting
 * go sets it down — in the clamp if it is at the clamp, on the tray if over
 * it, else back in its hole. The carried tube's own slot
 * (`InspectableTestTubeSlot`) owns that decision and registers it here while
 * it is carried; `HandController` calls it on the release. Also what the
 * outlines need to know (`HandGhosts`): is it at the clamp right now.
 */
export const WORKBENCH_TUBE_DROP = {
  /** Set by the carried slot; null — no rack tube is carried. */
  drop: null as (() => void) | null,
  /** At the clamp: let go here, it goes into the clamp. */
  nearRing: false,
  /** The click that follows a release must not also act on the tube (it ran already). */
  suppressClickUntil: 0,
};
