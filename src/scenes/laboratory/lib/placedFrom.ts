import type { Position3 } from "./layout";

/** A put-down older than this was for an item that never mounted — dropped, not played late. */
const STALE_MS = 1000;

const pending = new Map<string, { readonly world: Position3; readonly at: number }>();

/**
 * A bottle was just set down from the hand into a new place (off the tray,
 * onto the table or into the hood): remember where it was, so the display
 * that now stands there (`PourMotion`) flies it in from that spot instead of
 * showing it already at rest. Plain module state: read once, on the item's
 * next frame — never a reason to re-render.
 */
export function notePlacedFrom(instanceId: string, world: Position3): void {
  pending.set(instanceId, { world, at: Date.now() });
}

/** Where `instanceId` was set down from, once; null if it was not (or too long ago). */
export function takePlacedFrom(instanceId: string): Position3 | null {
  const entry = pending.get(instanceId);
  if (!entry) return null;
  pending.delete(instanceId);
  return Date.now() - entry.at <= STALE_MS ? entry.world : null;
}
