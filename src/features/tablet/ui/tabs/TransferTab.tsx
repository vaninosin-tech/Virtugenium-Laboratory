import { useState, type CSSProperties } from "react";
import { Check, FlaskConical, Microscope, TestTube } from "lucide-react";

import { REAGENTS, type ReagentContainerConfig } from "../../../../entities/laboratory/reagents";
import { transferSelectionToFumeHood } from "../../../../scenes/laboratory/lib/transferToFumeHood";
import { useBunsenStandStorageStore } from "../../../../scenes/laboratory/lib/useBunsenStandStorageStore";
import { useReagentStorageStore } from "../../../../scenes/laboratory/lib/useReagentStorageStore";
import { useTestTubeStorageStore } from "../../../../scenes/laboratory/lib/useTestTubeStorageStore";
import { colors, mutedTextStyle, splitDetailCtaButtonStyle, typography } from "../tabletStyles";

const reagentConfig = (id: string): ReagentContainerConfig | undefined =>
  (REAGENTS as Record<string, ReagentContainerConfig | undefined>)[id];

const reagentLabel = (id: string): string => {
  const config = reagentConfig(id);
  return config ? `${config.displayName} · ${config.formula}` : id;
};

const tubeLabel = (contents: readonly string[], position: number): string => {
  if (contents.length === 0) return `Пробирка ${position} — пустая`;
  const formulas = contents.map((id) => reagentConfig(id)?.formula ?? id).join(" + ");
  return `Пробирка ${position} — ${formulas}`;
};

/**
 * «Перенести» — opened from the fume hood zone. Deliberately lists
 * EVERYTHING standing on the workbench rather than only what this experiment
 * needs: choosing what belongs under the hood is the decision being tested,
 * so pre-filtering it would reduce the step to a confirmation dialog.
 */
export function TransferTab() {
  const workbenchItems = useReagentStorageStore((state) => state.workbenchItems);
  const fumeHoodItems = useReagentStorageStore((state) => state.fumeHoodItems);
  const workbenchTubes = useTestTubeStorageStore((state) => state.workbenchTestTubes);
  const fumeHoodTubes = useTestTubeStorageStore((state) => state.fumeHoodTestTubes);
  const standOnWorkbench = useBunsenStandStorageStore((state) => state.onWorkbench);
  const standOnFumeHood = useBunsenStandStorageStore((state) => state.onFumeHood);
  const attachedTubeSlotIndex = useBunsenStandStorageStore((state) => state.attachedTubeSlotIndex);

  const [selectedReagents, setSelectedReagents] = useState<readonly string[]>([]);
  const [selectedTubes, setSelectedTubes] = useState<readonly string[]>([]);
  const [standSelected, setStandSelected] = useState(false);

  const clampedTube =
    attachedTubeSlotIndex !== null ? workbenchTubes[attachedTubeSlotIndex] : undefined;
  // A clamped tube is not an independent item — it rides the stand.
  const loudTubes = workbenchTubes.filter((tube) => tube.instanceId !== clampedTube?.instanceId);

  const toggle = (
    list: readonly string[],
    setList: (next: readonly string[]) => void,
    id: string,
  ) => {
    setList(list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]);
  };

  const selectionCount =
    selectedReagents.length + selectedTubes.length + (standSelected ? 1 : 0);

  const handleTransfer = () => {
    if (selectionCount === 0) return;
    transferSelectionToFumeHood({
      reagentInstanceIds: selectedReagents,
      tubeInstanceIds: selectedTubes,
      includeStand: standSelected,
    });
    setSelectedReagents([]);
    setSelectedTubes([]);
    setStandSelected(false);
  };

  const nothingOnBench =
    workbenchItems.length === 0 && loudTubes.length === 0 && !standOnWorkbench;

  const hoodEntries = [
    ...(standOnFumeHood ? ["Штатив со спиртовкой"] : []),
    ...fumeHoodTubes.map((tube, index) => tubeLabel(tube.contents, index + 1)),
    ...fumeHoodItems.map((item) => reagentLabel(item.reagentId)),
  ];

  return (
    <div style={panelStyle}>
      <div style={scrollStyle}>
        <div style={sectionStyle}>
          <span style={sectionLabelStyle}>На рабочем столе</span>
          {nothingOnBench ? (
            <p style={{ ...mutedTextStyle, margin: 0 }}>
              На столе ничего нет — сначала соберите реактивы и оборудование по шкафам.
            </p>
          ) : (
            <div style={gridStyle} role="list">
              {standOnWorkbench ? (
                <SelectRow
                  icon={<Microscope size={16} aria-hidden />}
                  label={
                    clampedTube
                      ? `Штатив со спиртовкой (с пробиркой: ${clampedTube.contents.map((id) => reagentConfig(id)?.formula ?? id).join(" + ") || "пустая"})`
                      : "Штатив со спиртовкой"
                  }
                  selected={standSelected}
                  onToggle={() => setStandSelected(!standSelected)}
                />
              ) : null}

              {loudTubes.map((tube) => {
                const position = workbenchTubes.indexOf(tube) + 1;
                return (
                  <SelectRow
                    key={tube.instanceId}
                    icon={<TestTube size={16} aria-hidden />}
                    label={tubeLabel(tube.contents, position)}
                    selected={selectedTubes.includes(tube.instanceId)}
                    onToggle={() => toggle(selectedTubes, setSelectedTubes, tube.instanceId)}
                  />
                );
              })}

              {workbenchItems.map((item) => (
                <SelectRow
                  key={item.instanceId}
                  icon={<FlaskConical size={16} aria-hidden />}
                  label={reagentLabel(item.reagentId)}
                  selected={selectedReagents.includes(item.instanceId)}
                  onToggle={() => toggle(selectedReagents, setSelectedReagents, item.instanceId)}
                />
              ))}
            </div>
          )}
        </div>

        <div style={sectionStyle}>
          <span style={sectionLabelStyle}>В вытяжном шкафу</span>
          {hoodEntries.length === 0 ? (
            <p style={{ ...mutedTextStyle, margin: 0 }}>Пока пусто.</p>
          ) : (
            <ul style={hoodListStyle}>
              {hoodEntries.map((entry) => (
                <li key={entry} style={hoodItemStyle}>
                  <Check size={14} color={colors.success} aria-hidden />
                  {entry}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div style={actionsStyle}>
        <button
          type="button"
          style={{
            ...splitDetailCtaButtonStyle,
            opacity: selectionCount > 0 ? 1 : 0.38,
            cursor: selectionCount > 0 ? "pointer" : "not-allowed",
          }}
          onClick={handleTransfer}
          disabled={selectionCount === 0}
        >
          {selectionCount > 0 ? `Перенести выбранное (${selectionCount})` : "Перенести выбранное"}
        </button>
      </div>
    </div>
  );
}

function SelectRow({
  icon,
  label,
  selected,
  onToggle,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly selected: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="listitem"
      aria-pressed={selected}
      onClick={onToggle}
      style={rowStyle(selected)}
    >
      <span style={rowIconStyle(selected)}>{selected ? <Check size={16} aria-hidden /> : icon}</span>
      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>{label}</span>
    </button>
  );
}

const panelStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "8px 8px 8px 16px",
  boxSizing: "border-box",
  overflow: "hidden",
};

const scrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const sectionLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: typography.weightSemibold,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: colors.accentBright,
};

const gridStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const rowStyle = (selected: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "10px 12px",
  boxSizing: "border-box",
  borderRadius: 10,
  border: `1px solid ${selected ? colors.accentBright : colors.borderStrong}`,
  backgroundColor: selected ? "rgba(6, 182, 212, 0.16)" : colors.bgInset,
  color: colors.textPrimary,
  fontFamily: typography.fontFamilyBase,
  fontSize: typography.sizeCaption,
  cursor: "pointer",
});

const rowIconStyle = (selected: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  color: selected ? colors.accentBright : colors.textMuted,
});

const hoodListStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const hoodItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: typography.sizeCaption,
  color: colors.textMuted,
};

const actionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  flexShrink: 0,
};
