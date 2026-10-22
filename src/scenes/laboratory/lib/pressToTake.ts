import { HAND, useHandStore } from "./useHandStore";

/** How far (px) the mouse moves with the button down before a press is a drag, not a click. */
const DRAG_SLOP_PX = 6;

/** `MouseEvent.button` values: dragging is on the right button, a click-to-carry on the left. */
const LEFT_BUTTON = 0;
const RIGHT_BUTTON = 2;

/**
 * A press on something that can be taken into the hand (VL-018): dragged with
 * the RIGHT button — it is taken at once and carried while the button stays
 * down, and set down where it is let go (`HandController`); clicked with the
 * LEFT — it is taken and carried with the button up, and set down by the next
 * click (VL-015). A right click without a drag does nothing.
 *
 * @param take takes it into the hand; false if it cannot be taken now
 */
export function pressToTake(event: { readonly button: number; readonly clientX: number; readonly clientY: number }, take: () => boolean): void {
  // The hand owns the buttons while it holds something: a second press never takes, nor starts a drag.
  if (useHandStore.getState().held) return;
  if (event.button !== LEFT_BUTTON && event.button !== RIGHT_BUTTON) return;
  const drags = event.button === RIGHT_BUTTON;
  const { clientX, clientY } = event;
  const cleanup = () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
  };
  const handleMove = (move: PointerEvent) => {
    if (!drags || Math.hypot(move.clientX - clientX, move.clientY - clientY) < DRAG_SLOP_PX) return;
    cleanup();
    if (!useHandStore.getState().held && take()) HAND.dragging = true;
  };
  const handleUp = () => {
    cleanup();
    if (!drags && !useHandStore.getState().held) take();
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
}
