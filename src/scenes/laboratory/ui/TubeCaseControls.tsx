import type { CSSProperties } from "react";

import { TUBE_CASE_CAPACITY, useTubeCaseStore } from "../lib/useTubeCaseStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";

const panelStyle: CSSProperties = {
  position: "fixed",
  left: 16,
  bottom: 64,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 10,
  borderRadius: 10,
  background: "rgba(13, 22, 38, 0.82)",
  border: "1px solid rgba(80, 160, 200, 0.4)",
  color: "#e8f1f8",
  fontSize: 13,
  zIndex: 20,
  pointerEvents: "auto",
};

const buttonStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(90, 190, 230, 0.6)",
  background: "rgba(20, 70, 100, 0.9)",
  color: "#f2f8fc",
  cursor: "pointer",
  textAlign: "left",
};

/** Buttons for the tube case at the workbench: take it out of the cabinet / put it away, open / close the lid. */
export function TubeCaseControls() {
  const atTable = useSceneInteractionStore((state) => state.activeTargetId === "table");
  const deployed = useTubeCaseStore((state) => state.deployed);
  const isOpen = useTubeCaseStore((state) => state.isOpen);
  const stored = useTubeCaseStore((state) => state.stored.length);
  if (!atTable) return null;
  return (
    <div style={panelStyle}>
      <button type="button" style={buttonStyle} onClick={() => useTubeCaseStore.getState().toggleDeployed()}>
        {deployed ? "Убрать ящик в тумбу" : "Достать ящик для пробирок"}
      </button>
      {deployed && (
        <button type="button" style={buttonStyle} onClick={() => useTubeCaseStore.getState().toggleOpen()}>
          {isOpen ? "Закрыть крышку" : "Открыть крышку"}
        </button>
      )}
      {deployed && (
        <div style={{ opacity: 0.8 }}>
          В ящике: {stored} / {TUBE_CASE_CAPACITY}
        </div>
      )}
    </div>
  );
}
