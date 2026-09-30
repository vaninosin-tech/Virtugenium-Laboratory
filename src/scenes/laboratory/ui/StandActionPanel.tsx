import type { CSSProperties, ReactNode } from "react";

import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import { tryAddToTube, tryPourBetweenTubes } from "../lib/pourIntoTube";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useBurnerStore, type BurnerPhase } from "../lib/useBurnerStore";
import { useHeatingStore } from "../lib/useHeatingStore";
import { useReagentStorageStore } from "../lib/useReagentStorageStore";
import { useStandStationStore } from "../lib/useStandStationStore";
import { useTestTubeStorageStore, type StoredTestTube } from "../lib/useTestTubeStorageStore";

const reagentConfig = (id: string): ReagentContainerConfig | undefined =>
  (REAGENTS as Record<string, ReagentContainerConfig | undefined>)[id];

const formula = (id: string) => reagentConfig(id)?.formula ?? id;
const contentsLabel = (tube: StoredTestTube) =>
  tube.contents.length === 0 ? "пустая" : tube.contents.map(formula).join(" + ");

const LAMP_ACTION: Record<BurnerPhase, string> = {
  capped: "Снять колпачок со спиртовки",
  open: "Зажечь спиртовку",
  lit: "Погасить спиртовку колпачком",
};

/**
 * «У штатива» — what the player can do at the stand, wherever it stands
 * (workbench or fume hood). Opened by clicking the stand or its tube; the
 * camera leans in to the clamp (`CameraRig`, `TUBE_FOCUS`) and this panel
 * lists the actions that make sense right now. Heating appears only once the
 * spirit lamp is lit; while heating, the heating panel takes over and brings
 * the clamp back.
 */
export function StandActionPanel() {
  const open = useStandStationStore((state) => state.viewing);
  const close = useStandStationStore((state) => state.close);
  const heating = useHeatingStore((state) => state.active);
  const enterHeating = useHeatingStore((state) => state.enter);
  const burnerPhase = useBurnerStore((state) => state.phase);
  const advanceBurner = useBurnerStore((state) => state.advance);

  const onFumeHood = useBunsenStandStorageStore((state) => state.onFumeHood);
  const onWorkbench = useBunsenStandStorageStore((state) => state.onWorkbench);
  const clampedIndex = useBunsenStandStorageStore((state) => state.attachedTubeSlotIndex);
  const workbenchTubes = useTestTubeStorageStore((state) => state.workbenchTestTubes);
  const hoodTubes = useTestTubeStorageStore((state) => state.fumeHoodTestTubes);
  const workbenchItems = useReagentStorageStore((state) => state.workbenchItems);
  const hoodItems = useReagentStorageStore((state) => state.fumeHoodItems);

  if (!open || heating) return null;
  const location = onFumeHood ? "fumeHood" : onWorkbench ? "workbench" : null;
  if (location === null) return null;

  const tubes = location === "fumeHood" ? hoodTubes : workbenchTubes;
  const bottles = location === "fumeHood" ? hoodItems : workbenchItems;
  const clamped = clampedIndex === null ? undefined : tubes[clampedIndex];
  const otherTubes = tubes
    .map((tube, index) => ({ tube, index }))
    .filter(({ index }) => index !== clampedIndex);
  // One bottle per reagent is enough to pour from.
  const reagentIds = [...new Set(bottles.map((item) => item.reagentId))];

  return (
    <div style={panelStyle} data-testid="stand-panel">
      <div style={headerStyle}>
        <span>Штатив · {location === "fumeHood" ? "вытяжной шкаф" : "рабочий стол"}</span>
      </div>

      <Section title="Пробирка в лапке">
        {clamped ? (
          <>
            <span style={statusStyle}>{contentsLabel(clamped)}</span>
            <Action onClick={() => useBunsenStandStorageStore.getState().detachTestTube()}>
              Вынуть пробирку из лапки
            </Action>
          </>
        ) : otherTubes.length === 0 ? (
          <span style={mutedStyle}>
            {location === "fumeHood"
              ? "В шкафу нет пробирок — перенесите их со стола."
              : "На столе нет пробирок — возьмите их в шкафу «Хим. посуда»."}
          </span>
        ) : (
          otherTubes.map(({ tube, index }) => (
            <Action
              key={tube.instanceId}
              onClick={() => useBunsenStandStorageStore.getState().attachTestTube(index, [0, 0, 0])}
            >
              Закрепить пробирку {index + 1} ({contentsLabel(tube)})
            </Action>
          ))
        )}
      </Section>

      {clamped && (
        <Section title="Добавить в пробирку">
          {reagentIds.length === 0 && otherTubes.every(({ tube }) => tube.contents.length === 0) ? (
            <span style={mutedStyle}>Рядом нет реактивов.</span>
          ) : null}
          {reagentIds.map((id) => (
            <Action
              key={id}
              disabled={clamped.contents.includes(id)}
              onClick={() => clampedIndex !== null && tryAddToTube(location, clampedIndex, id)}
            >
              {reagentConfig(id)?.contentsKind === "solid" ? "Насыпать" : "Прилить"} {formula(id)}
            </Action>
          ))}
          {otherTubes
            .filter(({ tube }) => tube.contents.length > 0)
            .map(({ tube, index }) => (
              <Action
                key={tube.instanceId}
                onClick={() => clampedIndex !== null && tryPourBetweenTubes(location, index, clampedIndex)}
              >
                Перелить из пробирки {index + 1} ({contentsLabel(tube)})
              </Action>
            ))}
        </Section>
      )}

      <Section title="Спиртовка">
        <Action onClick={advanceBurner}>{LAMP_ACTION[burnerPhase]}</Action>
        {burnerPhase === "lit" && clamped ? (
          <Action primary onClick={() => enterHeating()}>
            Снять лапку и нагреть пробирку
          </Action>
        ) : null}
      </Section>

      <Action onClick={close}>Отойти от штатива</Action>
    </div>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div style={sectionStyle}>
      <span style={sectionTitleStyle}>{title}</span>
      {children}
    </div>
  );
}

function Action({
  children,
  onClick,
  disabled = false,
  primary = false,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly primary?: boolean;
}) {
  return (
    <button type="button" style={actionStyle(disabled, primary)} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

const panelStyle: CSSProperties = {
  position: "absolute",
  right: 20,
  top: 70,
  zIndex: 11,
  width: 300,
  maxHeight: "calc(100vh - 160px)",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: "14px 16px",
  borderRadius: 14,
  border: "1px solid rgba(56, 189, 248, 0.35)",
  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(8, 14, 26, 0.95))",
  boxShadow: "0 0 24px rgba(56, 189, 248, 0.18)",
  color: "#d6f3ff",
  fontSize: 13,
  fontWeight: 600,
};

const headerStyle: CSSProperties = { fontSize: 14, fontWeight: 700, color: "#e6f6ff" };

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };

const sectionTitleStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  color: "#38bdf8",
};

const statusStyle: CSSProperties = { fontSize: 13, color: "#f1f5f9" };

const mutedStyle: CSSProperties = { fontSize: 12, fontWeight: 500, color: "#94a3b8" };

const actionStyle = (disabled: boolean, primary: boolean): CSSProperties => ({
  padding: "8px 12px",
  borderRadius: 9,
  textAlign: "left",
  border: `1px solid ${primary ? "rgba(251, 191, 36, 0.7)" : "rgba(148, 163, 184, 0.3)"}`,
  backgroundColor: primary ? "rgba(120, 53, 15, 0.55)" : "rgba(15, 23, 42, 0.85)",
  color: disabled ? "#475569" : primary ? "#fde68a" : "#cbd5e1",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: disabled ? "default" : "pointer",
});
