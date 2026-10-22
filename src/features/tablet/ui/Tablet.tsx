import { useEffect, useRef, useState } from "react";

import { mustChooseExperiment, useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { useLabBootStore } from "../../lab-boot/lib/useLabBootStore";
import { isTypingKeyboardUp } from "../lib/typingKeyboards";
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

  // E opens and closes the tablet from anywhere in the lab — same rules as
  // its own buttons: it can't be closed before an experiment is chosen, and
  // nothing happens while the loading screen is up. By physical key, so it is
  // the same key (У) on the Russian layout; never while something is being
  // typed (a text field, or one of the tablet's on-screen keyboards).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyE" || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      if (isTypingKeyboardUp() || isEditable(event.target)) return;
      if (useLabBootStore.getState().phase !== "done") return;
      event.preventDefault();
      const lab = useLaboratoryStore.getState();
      if (!lab.tabletOpen) {
        if (openingLockRef.current) return;
        lab.openTablet(lab.selectedExperimentId ? "stages" : "tasks");
        return;
      }
      if (mustChooseExperiment(lab)) return;
      // The key press is the user activation Pointer Lock needs to come back.
      onReturnToGame?.();
      lab.closeTablet();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onReturnToGame]);

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

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));
}
