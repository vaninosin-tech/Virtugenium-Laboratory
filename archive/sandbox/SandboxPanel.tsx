import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { reactionKindFor, reactionTriggerFor, useTubeReactionStore, type ReactionKind } from "../lib/tubeReactions";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";
import { useBurnerStore } from "../lib/useBurnerStore";
import { replaceSandboxTube, setSandboxBurnerLit, showExperiment } from "./setupSandbox";

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
  const [pourPoint, setPourPoint] = useState<"left" | "center" | "right">("right");
  const [pourSpeed, setPourSpeed] = useState<"slow" | "fast">("slow");
  const navigate = useNavigate();
  const sandbox = useLaboratoryStore((state) => state.mode === "sandbox");
  const burnerLit = useBurnerStore((state) => state.lit);
  const hoodTubes = useTestTubeStorageStore((state) => state.fumeHoodTestTubes);
  const clampedIndex = useBunsenStandStorageStore((state) => state.attachedTubeSlotIndex);
  const chemistryById = useTubeReactionStore((state) => state.chemistryById);

  if (!sandbox) return null;

  const tube = clampedIndex === null ? undefined : hoodTubes[clampedIndex];
  const contents = tube?.contents ?? [];
  const kind = reactionKindFor(contents);
  const chemistry = tube ? chemistryById[tube.instanceId] : undefined;
  const progress = chemistry?.progress ?? 0;
  const temperature = chemistry?.temperature ?? 0;
  const slowCold = reactionTriggerFor(contents) === "heat" && temperature < 0.2 && progress < 1;

  return (
    <div style={panelStyle}>
      <strong style={titleStyle}>Песочница (временный режим)</strong>
      <span style={hintStyle}>
        Наведите на предмет — подпись скажет, что сделает клик. Склянка — налить в пробирку в лапке; пробирка в лапке — нагреть, если спиртовка горит, иначе вернуть в стойку; штатив — рассмотреть.
      </span>

      <span>
        В пробирке: {contents.length === 0 ? "пусто" : contents.map(formula).join(" + ")}
      </span>
      <span style={{ color: kind ? "#6ee7a8" : "#94a3b8" }}>
        {kind ? REACTION_NAMES[kind] : "Реакции нет"}
      </span>
      {kind ? (
        <span style={hintStyle}>
          Прогресс реакции: {Math.round(progress * 100)}%
          {slowCold ? " — без нагрева идёт медленно" : ""}
        </span>
      ) : null}
      <span style={hintStyle}>Температура содержимого: {Math.round(20 + temperature * 80)} °C</span>

      <span style={hintStyle}>Показать опыт вблизи (Q или Esc — отойти):</span>
      <div style={rowStyle}>
        <label>Попадание <select value={pourPoint} onChange={event => setPourPoint(event.target.value as typeof pourPoint)}>
          <option value="left">слева</option><option value="center">центр</option><option value="right">справа</option>
        </select></label>
        <label>Струя <select value={pourSpeed} onChange={event => setPourSpeed(event.target.value as typeof pourSpeed)}>
          <option value="slow">медленно</option><option value="fast">быстро</option>
        </select></label>
      </div>
      <div style={rowStyle}>
        {([1, 2, 3, 4] as const).map((experiment) => (
          <button key={experiment} type="button" style={buttonStyle}
            onClick={() => showExperiment(experiment, pourPoint, pourSpeed)}>
            Опыт {experiment}
          </button>
        ))}
        <button type="button" style={buttonStyle} onClick={() => showExperiment(1, pourPoint, pourSpeed, true)}>
          Опыт 1, с нагревом
        </button>
      </div>
      <label style={hintStyle}>
        <input type="checkbox" checked={burnerLit} onChange={event => setSandboxBurnerLit(event.target.checked)} /> Спиртовка горит
      </label>

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
