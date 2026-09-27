import type { CSSProperties } from "react";
import { Html } from "@react-three/drei";

import { SHOW_SCENE_DEBUG_LABELS } from "../lib/debugFlags";
import type { CabinetDef } from "../lib/layout";
import { ReagentCabinetInstance } from "./ReagentCabinetInstance";

/**
 * Dispatches each cabinet slot to either the real asset (`assetReady: true`
 * — see `ReagentCabinetInstance`) or a reserved, invisible anchor
 * (`assetReady: false`): the camera target and crosshair hotspot both still
 * work at a reserved slot, but nothing is rendered there by default — no
 * mesh, no floating label, no debug crosshair — per the standing rule
 * against fabricating a substitute cabinet model for an asset that isn't
 * ready yet (currently glassware).
 */
export function Cabinet({ cabinet }: { readonly cabinet: CabinetDef }) {
  if (cabinet.assetReady) {
    return <ReagentCabinetInstance cabinet={cabinet} />;
  }

  if (!SHOW_SCENE_DEBUG_LABELS) {
    return null;
  }

  return <ReservedCabinetDebugMarker cabinet={cabinet} />;
}

/** Dev-only visualization of a reserved slot — never rendered unless `SHOW_RESERVED_CABINET_DEBUG` is flipped on locally. */
function ReservedCabinetDebugMarker({ cabinet }: { readonly cabinet: CabinetDef }) {
  const [x, y, z] = cabinet.position;

  return (
    <Html position={[x, y + 2.35, z]} center style={debugLabelStyle}>
      {cabinet.label} — reserved
    </Html>
  );
}

const debugLabelStyle: CSSProperties = {
  padding: "3px 10px",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "sans-serif",
  fontWeight: 600,
  whiteSpace: "nowrap",
  color: "#94a3b8",
  backgroundColor: "rgba(15, 23, 42, 0.6)",
  border: "1px dashed rgba(255,255,255,0.25)",
  pointerEvents: "none",
};
