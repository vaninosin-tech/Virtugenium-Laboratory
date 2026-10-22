import { useEffect } from "react";

import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";

const GLOVES_ID = "safety-gloves";

/**
 * Swaps the game cursor (`shared/ui/gameCursor.css`) to the gloved hand while
 * the gloves are on, and back to the bare hand when they come off or the
 * player leaves the lab.
 */
export function GloveCursorSync() {
  const glovesOn = useLaboratoryStore((state) => state.inventoryItemIds.includes(GLOVES_ID));

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("vg-gloves", glovesOn);
    return () => root.classList.remove("vg-gloves");
  }, [glovesOn]);

  return null;
}
