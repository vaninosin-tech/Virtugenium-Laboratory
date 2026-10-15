/**
 * The colours of the outlines a carried item shows of itself (`HandGhosts`,
 * `placementGhosts`) — the only place a ghost's state becomes a colour:
 * - blue — it may be set down here;
 * - white — it goes here if let go now;
 * - green — it can be used here now (in the clamp, poured, over the flame);
 * - red — it is used here, but not now.
 */
export type GhostState = "blue" | "white" | "green" | "red";

export const GHOST_COLOR: Record<GhostState, string> = {
  white: "#f8fafc",
  blue: "#3b82f6",
  green: "#22c55e",
  red: "#ef4444",
};
