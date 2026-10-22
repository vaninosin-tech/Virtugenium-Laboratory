import { useEffect } from "react";

import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { TabletIcon } from "./TabletIcon";
import { TabletOverlay } from "./TabletOverlay";

/**
 * The tablet as a whole: the always-visible corner icon plus the overlay it
 * opens. Mounted once at the scene root so it's reachable from every 3D
 * zone, not just the workbench.
 */
export function Tablet() {
  const tabletOpen = useLaboratoryStore((state) => state.tabletOpen);
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const openTablet = useLaboratoryStore((state) => state.openTablet);

  // Opening the tablet is a 2D-UI moment — release mouse-look so the cursor
  // is free to click inside it instead of rotating the 3D camera.
  useEffect(() => {
    if (tabletOpen && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [tabletOpen]);

  const handleOpen = () => {
    openTablet(selectedExperimentId ? "stages" : "tasks");
  };

  return (
    <>
      {!tabletOpen && <TabletIcon onOpen={handleOpen} />}
      <TabletOverlay />
    </>
  );
}
