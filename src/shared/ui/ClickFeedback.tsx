import { useEffect } from "react";

import "./clickFeedback.css";

/** Same fields that get the "I" cursor in `gameCursor.css`. */
const TEXT_FIELD =
  'input:not([type="button"], [type="submit"], [type="reset"], [type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="file"], :disabled), textarea:not(:disabled), [contenteditable="true"], [style*="cursor: text"]';

/** Browsers can't animate a cursor, so pressed frames are swapped in by class — preload them so the first press doesn't blink. */
const PRESSED_FRAMES = ["hand", "glove", "hand-text", "glove-text"].flatMap((name) => [
  `/assets/cursors/${name}-pressed.png`,
  `/assets/cursors/${name}-pressed@2x.png`,
]);

/**
 * Click feedback for the game cursor (`gameCursor.css`): while the left button
 * is held the cursor shows its "pressed" frame (`html.vg-pressing`), and a
 * ring spreads out from the click point and fades — cyan, or orange on a text
 * field (the colour of the cursor's "I"). No ring under Pointer Lock: the
 * cursor is hidden there and the crosshair has its own feedback.
 */
export function ClickFeedback() {
  useEffect(() => {
    for (const src of PRESSED_FRAMES) new Image().src = src;

    const root = document.documentElement;
    const layer = document.createElement("div");
    layer.className = "vg-click-layer";
    document.body.append(layer);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const release = () => root.classList.remove("vg-pressing");
    const handleDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      root.classList.add("vg-pressing");
      if (document.pointerLockElement || reducedMotion.matches) return;

      const ring = document.createElement("span");
      const onText = event.target instanceof Element && event.target.closest(TEXT_FIELD) !== null;
      ring.className = onText ? "vg-click-ring is-text" : "vg-click-ring";
      ring.style.left = `${event.clientX}px`;
      ring.style.top = `${event.clientY}px`;
      ring.addEventListener("animationend", () => ring.remove());
      layer.append(ring);
    };

    window.addEventListener("pointerdown", handleDown, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerdown", handleDown, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", release);
      release();
      layer.remove();
    };
  }, []);

  return null;
}
