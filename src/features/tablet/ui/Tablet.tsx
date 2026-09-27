import { useEffect, useRef, useState } from "react";

import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { TabletIcon } from "./TabletIcon";
import { TabletOverlay } from "./TabletOverlay";
import "./tabletTransitions.css";

const HOLO_DISSOLVE_MS = 320;
const HOLO_APPEAR_MS = 480;
const OVERLAY_EXIT_MS = 480;
const OVERLAY_ENTER_SETTLE_MS = 540;

/**
 * The tablet as a whole: top-left hologram when collapsed, full overlay when open.
 * Mounted once at the scene root so it's reachable from every 3D zone.
 */
export function Tablet({ onReturnToGame }: { readonly onReturnToGame?: () => void }) {
  const tabletOpen = useLaboratoryStore((state) => state.tabletOpen);
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const openTablet = useLaboratoryStore((state) => state.openTablet);

  const [holoMounted, setHoloMounted] = useState(!tabletOpen);
  const [holoExiting, setHoloExiting] = useState(false);
  const [holoEntering, setHoloEntering] = useState(false);
  const [overlayMounted, setOverlayMounted] = useState(tabletOpen);
  const [overlayPhase, setOverlayPhase] = useState<"entering" | "exiting" | "idle">(
    tabletOpen ? "idle" : "idle",
  );
  const holoVisibleRef = useRef(!tabletOpen);
  const openingLockRef = useRef(false);

  useEffect(() => {
    if (tabletOpen && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [tabletOpen]);

  // Genuine effect-driven animation sequencing (schedules setTimeouts,
  // mutates a ref) reacting to `tabletOpen` — not simple derived state, so
  // the "adjust during render" pattern doesn't apply here.
  useEffect(() => {
    const timers: number[] = [];

    if (tabletOpen) {
      openingLockRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHoloEntering(false);

      if (holoVisibleRef.current) {
        setHoloExiting(true);
        setOverlayMounted(false);

        timers.push(
          window.setTimeout(() => {
            setHoloMounted(false);
            setHoloExiting(false);
            holoVisibleRef.current = false;
            setOverlayMounted(true);
            setOverlayPhase("entering");
            openingLockRef.current = false;
          }, HOLO_DISSOLVE_MS),
          window.setTimeout(
            () => setOverlayPhase("idle"),
            HOLO_DISSOLVE_MS + OVERLAY_ENTER_SETTLE_MS,
          ),
        );
      } else {
        setOverlayMounted(true);
        setOverlayPhase("entering");
        openingLockRef.current = false;
        timers.push(window.setTimeout(() => setOverlayPhase("idle"), OVERLAY_ENTER_SETTLE_MS));
      }
    } else {
      openingLockRef.current = false;
      setOverlayPhase("exiting");
      setHoloMounted(false);
      setHoloExiting(false);
      setHoloEntering(false);
      holoVisibleRef.current = false;

      timers.push(
        window.setTimeout(() => {
          setOverlayMounted(false);
          setOverlayPhase("idle");
          setHoloMounted(true);
          setHoloEntering(true);
          holoVisibleRef.current = true;
        }, OVERLAY_EXIT_MS),
        window.setTimeout(() => setHoloEntering(false), OVERLAY_EXIT_MS + HOLO_APPEAR_MS),
      );
    }

    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [tabletOpen]);

  const handleOpen = () => {
    if (openingLockRef.current || holoExiting) return;
    openTablet(selectedExperimentId ? "stages" : "tasks");
  };

  return (
    <>
      {holoMounted ? (
        <TabletIcon
          onOpen={handleOpen}
          exiting={holoExiting}
          entering={holoEntering}
        />
      ) : null}
      {overlayMounted ? (
        <TabletOverlay
          onClose={onReturnToGame}
          shellClassName={
            overlayPhase === "entering"
              ? "tablet-overlay-shell is-entering"
              : overlayPhase === "exiting"
                ? "tablet-overlay-shell is-exiting"
                : "tablet-overlay-shell"
          }
        />
      ) : null}
    </>
  );
}
