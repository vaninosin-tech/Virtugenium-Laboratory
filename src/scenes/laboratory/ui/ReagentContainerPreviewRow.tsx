import { REAGENTS } from "../../../entities/laboratory/reagents";
import type { Position3 } from "../lib/layout";
import { ReagentContainerInstance } from "./ReagentContainerInstance";

const IDS = Object.keys(REAGENTS) as (keyof typeof REAGENTS)[];
/** Wider than the biggest container (the wide-mouth jar, ~0.11m diameter) so none of the 9 instances overlap. */
const SPACING = 0.22;

/**
 * Dev-only: one instance of all 9 reagents lined up at eye height in the
 * open floor space in front of the sink — gated behind
 * `SHOW_REAGENT_CONTAINER_PREVIEW` (see `debugFlags.ts`), same pattern as
 * `Cabinet.tsx`'s `SHOW_SCENE_DEBUG_LABELS` gate. Never rendered in normal
 * gameplay. `rotationY={Math.PI}` turns each instance's `LabelSurface`
 * face toward the default overview camera.
 */
export function ReagentContainerPreviewRow() {
  const y = 1.35;
  const z = -1.7;
  const startX = -((IDS.length - 1) * SPACING) / 2;

  return (
    <>
      {IDS.map((id, index) => {
        const position: Position3 = [startX + index * SPACING, y, z];
        return <ReagentContainerInstance key={id} reagent={REAGENTS[id]} position={position} rotationY={Math.PI} />;
      })}
    </>
  );
}
