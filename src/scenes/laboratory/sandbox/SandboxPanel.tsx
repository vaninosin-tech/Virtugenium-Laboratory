import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { reactionKindFor, reactionTriggerFor, useTubeReactionStore, type ReactionKind } from "../lib/tubeReactions";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";
import { replaceSandboxTube } from "./setupSandbox";

const REACTION_NAMES: Record<ReactionKind, string> = {
  "copper-nitric": "Cu + HNO₃ (разб.) — голубой раствор, NO → бурый NO₂",
  "silver-chloride": "AgNO₃ + NaCl — белый творожистый осадок AgCl",
  "barium-sulfate": "BaCl₂ + K₂SO₄ — белый мелкокристаллический осадок BaSO₄",
  "permanganate-redox": "KMnO₄ + H₂SO₄ + Na₂SO₃ — обесцвечивание",
};

const formula = (id: string) =>
  (REAGENTS as Record<string, ReagentContainerConfig | undefined>)[id]?.formula ?? id;

/** TEMP sandbox: what is in the stand's tube, what it is doing, and a way to start over. */
export function SandboxPanel() {
  const navigate = useNavigate();
  const sandbox = useLaboratoryStore((state) => state.mode === "sandbox");
  const hoodTubes = useTestTubeStorageStore((state) => state.fumeHoodTestTubes);
  const clampedIndex = useBunsenStandStorageStore((state) => state.attachedTubeSlotIndex);
  const progressById = useTubeReactionStore((state) => state.progressById);

  if (!sandbox) return null;

  const tube = clampedIndex === null ? undefined : hoodTubes[clampedIndex];
  const contents = tube?.contents ?? [];
  const kind = reactionKindFor(contents);
  const progress = tube ? (progressById[tube.instanceId] ?? 0) : 0;
  const waitingForHeat = reactionTriggerFor(contents) === "heat" && progress === 0;

  return (
    <div style={panelStyle}>
      <strong style={titleStyle}>Песочница (временный режим)</strong>
      <span style={hintStyle}>
        Клик по склянке — налить в пробирку в штативе. Клик по штативу — нагреть.
      </span>

      <span>
        В пробирке: {contents.length === 0 ? "пусто" : contents.map(formula).join(" + ")}
      </span>
      <span style={{ color: kind ? "#6ee7a8" : "#94a3b8" }}>
        {kind ? REACTION_NAMES[kind] : "Реакции нет"}
      </span>
      {kind ? (
        <span style={hintStyle}>
          {waitingForHeat ? "Реакция идёт при нагревании" : `Прогресс реакции: ${Math.round(progress * 100)}%`}
        </span>
      ) : null}

      <div style={rowStyle}>
        <button type="button" style={buttonStyle} onClick={replaceSandboxTube}>
          Новая пробирка
        </button>
        <button type="button" style={buttonStyle} onClick={() => navigate("/")}>
          В меню
        </button>
      </div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  position: "absolute",
  // Below the tablet icon, which owns the top-left corner.
  top: 170,
  left: 20,
  zIndex: 12,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  maxWidth: 340,
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid rgba(250, 204, 21, 0.45)",
  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(8, 14, 26, 0.94))",
  color: "#e2e8f0",
  fontSize: 13,
};

const titleStyle: CSSProperties = { color: "#fde68a", fontSize: 14 };
const hintStyle: CSSProperties = { color: "#94a3b8", fontSize: 12 };
const rowStyle: CSSProperties = { display: "flex", gap: 8, marginTop: 4 };

const buttonStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid rgba(148, 163, 184, 0.35)",
  backgroundColor: "rgba(15, 23, 42, 0.8)",
  color: "#cbd5e1",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
