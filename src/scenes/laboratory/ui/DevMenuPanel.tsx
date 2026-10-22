import { useEffect, type CSSProperties } from "react";

import { DEV_MENU_TABS, useDevMenuStore } from "../lib/useDevMenuStore";
import { useCameraCalibrationStore } from "../lib/useCameraCalibrationStore";
import { useNavButtonCalibrationStore } from "../lib/useNavButtonCalibrationStore";
import { useStopperHolderStore } from "../lib/useStopperHolderStore";
import { useTrayReagentAreaStore } from "../lib/useTrayReagentAreaStore";
import { useWorkbenchReagentAreaStore } from "../lib/useWorkbenchReagentAreaStore";
import { useWorktopZoneStore } from "../lib/useWorktopZoneStore";
import { CameraCalibrationPanel } from "./CameraCalibrationPanel";
import { NavButtonCalibrationPanel } from "./NavButtonCalibrationPanel";
import { TrayCalibrationPanel } from "./TrayCalibrationPanel";
import { StopperHolderCalibrationPanel } from "./StopperHolderCalibrationPanel";
import { TrayReagentAreaCalibrationPanel } from "./TrayReagentAreaCalibrationPanel";
import { WorkbenchReagentAreaCalibrationPanel } from "./WorkbenchReagentAreaCalibrationPanel";
import { FurniturePositionPanel } from "./devmenu/FurniturePositionPanel";
import { ReagentShaderPanel } from "./devmenu/ReagentShaderPanel";
import { LightingPanel } from "./devmenu/LightingPanel";
import { WorktopZonePanel } from "./devmenu/WorktopZonePanel";

/**
 * Single F8 entry point for every dev-only calibration tool. Replaces the
 * old F8/F9/F10/F11/F12 five-hotkey, five-independent-panel setup: this is
 * now the ONLY component with its own `keydown` listener, and it drives
 * each pre-existing feature store's `isOpen` (camera/nav-button/stopper-
 * holder/workbench-reagent-area) from one `category` here instead of each
 * having its own toggle — so at most one panel is ever open, and
 * `CameraRig`'s pointer-lock guard only needs to check this one `isOpen`
 * (see `useDevMenuStore`'s doc) to stop scene drags/clicks leaking through
 * *any* of them, not just the camera panel like before.
 *
 * Click-to-select (furniture in the 3D view, reagents like the held tray/
 * inspected bottle, HUD buttons) all resolve through this same store —
 * furniture/reagent picks come from `CameraRig`'s mouse raycast (gated on
 * `isOpen`, see its `handlePointerDown`), button picks are intercepted here
 * via `data-dev-pick-id` (added on `InspectionControls`'s nav/back buttons
 * and `ReagentInspectionOverlay`'s ОСТАВИТЬ/ВЗЯТЬ buttons). Furniture also
 * drags: the SAME `mousedown` that selects a piece starts a horizontal-plane
 * drag (`CameraRig`'s `furnitureDragRef`), tracked on `mousemove` and
 * released on `mouseup` — a plain click with no movement in between just
 * selects, per the "real cursor, no Pointer Lock" mode this whole menu runs
 * under (see the `exitPointerLock` effect below).
 */
export function DevMenuPanel() {
  const isOpen = useDevMenuStore((state) => state.isOpen);
  const category = useDevMenuStore((state) => state.category);
  const toggleOpen = useDevMenuStore((state) => state.toggleOpen);
  const setOpen = useDevMenuStore((state) => state.setOpen);
  const setCategory = useDevMenuStore((state) => state.setCategory);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F8") return;
      event.preventDefault();
      toggleOpen();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleOpen]);

  // Releasing Pointer Lock on open is what actually fixes "sliders leak
  // through to the scene" — under Pointer Lock there is no OS cursor
  // position at all, so `CameraRig` reads every mouse move as a camera turn
  // regardless of which DOM element is nominally under it. This one effect
  // now covers every tab, not just the camera panel (which used to do this
  // itself, and only for itself).
  useEffect(() => {
    if (isOpen && document.pointerLockElement) document.exitPointerLock();
  }, [isOpen]);

  // Drive each pre-existing panel's own `isOpen` from this shell's category
  // — their internal logic (draft previewing, cabinet auto-open effects,
  // etc.) is untouched, they just no longer decide their own open state.
  useEffect(() => {
    useCameraCalibrationStore.getState().setOpen(isOpen && category === "camera");
  }, [isOpen, category]);
  useEffect(() => {
    useNavButtonCalibrationStore.getState().setOpen(isOpen && category === "buttons");
  }, [isOpen, category]);
  useEffect(() => {
    useNavButtonCalibrationStore.getState().setTrayPanelOpen(isOpen && category === "tray");
  }, [isOpen, category]);
  useEffect(() => {
    useStopperHolderStore.getState().setOpen(isOpen && category === "stopper");
  }, [isOpen, category]);
  useEffect(() => {
    useWorkbenchReagentAreaStore.getState().setOpen(isOpen && category === "reagent-area");
  }, [isOpen, category]);
  useEffect(() => {
    useTrayReagentAreaStore.getState().setOpen(isOpen && category === "tray-reagents");
  }, [isOpen, category]);
  useEffect(() => {
    useWorktopZoneStore.getState().setOpen(isOpen && category === "zones");
  }, [isOpen, category]);

  // Button click-to-select: while open, any element carrying
  // `data-dev-pick-id` gets selected for calibration instead of firing its
  // real gameplay action (ОСТАВИТЬ/ВЗЯТЬ, nav chevrons, back). A capture-
  // phase listener on `document` runs before the button's own React
  // `onClick` (which fires on the bubble phase), so `stopPropagation` here
  // fully prevents it.
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const pickId = target?.closest<HTMLElement>("[data-dev-pick-id]")?.dataset.devPickId;
      if (!pickId) return;
      event.preventDefault();
      event.stopPropagation();
      setCategory("buttons");
      const [side, key] = pickId.split(":");
      if (side === "nav") {
        useNavButtonCalibrationStore.getState().setSelected(key as "left" | "right" | "bottom");
      } else if (side === "inspection") {
        useNavButtonCalibrationStore.getState().setSelectedInspectionButton(key as "left" | "right");
      }
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [isOpen, setCategory]);

  if (!import.meta.env.DEV || !isOpen) return null;

  return (
    <>
      <div style={shellStyle} onPointerDown={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          DEV MENU (F8)
          <button onClick={() => setOpen(false)} style={closeBtnStyle}>
            ✕
          </button>
        </div>
        <div style={tabBarStyle}>
          {DEV_MENU_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setCategory(tab.id)}
              style={{ ...tabBtnStyle, ...(category === tab.id ? activeTabBtnStyle : undefined) }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {category === "furniture" && <FurniturePositionPanel />}
        {category === "shaders" && <ReagentShaderPanel />}
        {category === "lighting" && <LightingPanel />}
        {category === "zones" && <WorktopZonePanel />}
        {category !== "furniture" && category !== "shaders" && category !== "lighting" && category !== "zones" && (
          <div style={noteStyle}>Панель «{DEV_MENU_TABS.find((t) => t.id === category)?.label}» открыта в своём окне ниже.</div>
        )}
      </div>

      {/* Each pre-existing panel still renders itself (own position/styling) — this shell only controls whether it's open, via `isOpen` above. */}
      <CameraCalibrationPanel />
      <NavButtonCalibrationPanel />
      <TrayCalibrationPanel />
      <StopperHolderCalibrationPanel />
      <WorkbenchReagentAreaCalibrationPanel />
      <TrayReagentAreaCalibrationPanel />
    </>
  );
}

const shellStyle: CSSProperties = {
  position: "absolute",
  bottom: 20,
  left: 20,
  zIndex: 21,
  width: 260,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  backgroundColor: "rgba(15, 23, 42, 0.95)",
  padding: "12px 14px",
  borderRadius: 10,
  color: "#e2e8f0",
  border: "1px solid rgba(250, 204, 21, 0.5)",
  fontSize: 12,
  fontFamily: "monospace",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontWeight: 700,
  fontSize: 13,
  color: "#facc15",
};

const closeBtnStyle: CSSProperties = {
  background: "none",
  border: "none",
  color: "#e2e8f0",
  cursor: "pointer",
  fontSize: 14,
};

const tabBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
};

const tabBtnStyle: CSSProperties = {
  backgroundColor: "rgba(56, 189, 248, 0.12)",
  color: "#38bdf8",
  border: "1px solid rgba(56, 189, 248, 0.4)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 10,
  padding: "4px 6px",
};

const activeTabBtnStyle: CSSProperties = {
  backgroundColor: "#38bdf8",
  color: "#0f172a",
};

const noteStyle: CSSProperties = {
  fontSize: 10,
  color: "#94a3b8",
  lineHeight: 1.3,
};
