import { HAND } from "./useHandStore";

/** How far (px) the mouse moves with the button down before a press is a drag, not a click. */
const DRAG_SLOP_PX = 6;

/**
 * A press on something that can be taken into the hand (VL-018): dragged —
 * it is taken at once and carried while the button stays down, and set
 * down where it is let go (`HandController`); clicked — it is taken and
 * carried with the button up, and set down by the next click (VL-015).
 *
 * @param take takes it into the hand; false if it cannot be taken now
 */
export function pressToTake(event: { readonly button: number; readonly clientX: number; readonly clientY: number }, take: () => boolean): void {
  if (event.button !== 0) return;
  const { clientX, clientY } = event;
  const cleanup = () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
  };
  const handleMove = (move: PointerEvent) => {
    if (Math.hypot(move.clientX - clientX, move.clientY - clientY) < DRAG_SLOP_PX) return;
    cleanup();
    if (take()) HAND.dragging = true;
  };
  const handleUp = () => {
    cleanup();
    take();
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
}
