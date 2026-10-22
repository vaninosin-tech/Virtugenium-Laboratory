import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";

import { reagentName } from "./mixingRules";
import { standLocation } from "./standStationActions";
import type { StandTarget } from "./standTableActions";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { useTestTubeStorageStore, type StoredTestTube } from "./useTestTubeStorageStore";
import { useTubeReactionStore } from "./tubeReactions";

/** Where a thing under the cursor is: on the table, in the hood, or riding the tray. */
export type HintPlace = "workbench" | "fumeHood" | "tray";

/**
 * What the caption names: the thing under the cursor and where it is. The
 * text is read off the live scene every frame (`describeSubject`), so it is
 * right the moment a click moves the thing.
 */
export type HintSubject =
  | { readonly kind: "bottle"; readonly reagentId: string; readonly place: HintPlace }
  /** A tube: by `instanceId` when known (anywhere), else by its `index` in the rack at `place`. */
  | { readonly kind: "tube"; readonly place: HintPlace; readonly instanceId?: string; readonly index?: number }
  | { readonly kind: "rack"; readonly place: HintPlace }
  | { readonly kind: "stand"; readonly place: HintPlace }
  | { readonly kind: "lamp"; readonly place: HintPlace };

export interface HintInfo {
  /** «Азотная кислота · на столе» */
  readonly title: string;
  /** «раствор, HNO₃» — what it is and what is in it; null when there is nothing to add. */
  readonly state: string | null;
}

const PLACE_TEXT: Record<HintPlace, string> = {
  workbench: "на столе",
  fumeHood: "в вытяжном шкафу",
  tray: "на подносе",
};

const reagentConfig = (id: string): ReagentContainerConfig | undefined =>
  (REAGENTS as Record<string, ReagentContainerConfig | undefined>)[id];

const tubeList = (place: HintPlace): readonly StoredTestTube[] => {
  const state = useTestTubeStorageStore.getState();
  return place === "tray" ? state.trayTestTubes : place === "workbench" ? state.workbenchTestTubes : state.fumeHoodTestTubes;
};

/** The subject a stand target's caption is about, so the table objects need not name it themselves. */
export function subjectOfTarget(target: StandTarget): HintSubject | null {
  switch (target.kind) {
    case "bottle":
      return { kind: "bottle", reagentId: target.reagentId, place: target.location };
    case "rack-tube":
      return { kind: "tube", place: target.location, index: target.index };
    case "clamped-tube": {
      const place = standLocation();
      const index = useBunsenStandStorageStore.getState().attachedTubeSlotIndex;
      return place && index !== null ? { kind: "tube", place, index } : null;
    }
    case "burner": {
      const place = useBurnerStore.getState().place;
      return place === "shelf" ? null : { kind: "lamp", place };
    }
  }
}

const LAMP_STATE = { capped: "закрыта колпачком", open: "открыта, не горит", lit: "горит" } as const;

function describeTube(subject: Extract<HintSubject, { kind: "tube" }>): HintInfo | null {
  const tubes = tubeList(subject.place);
  const index = subject.instanceId === undefined ? subject.index ?? -1 : tubes.findIndex((tube) => tube.instanceId === subject.instanceId);
  const tube = tubes[index];
  if (!tube) return null;
  const stand = useBunsenStandStorageStore.getState();
  const clamped = subject.place !== "tray" && stand.attachedTubeSlotIndex === index && standLocation() === subject.place;
  const where = clamped
    ? `в лапке штатива, ${subject.place === "workbench" ? "на столе" : "в вытяжке"}`
    : subject.place === "tray"
      ? PLACE_TEXT.tray
      : `в штативе для пробирок, ${subject.place === "workbench" ? "на столе" : "в вытяжке"}`;
  const contents = tube.contents.length === 0 ? "пустая" : tube.contents.map(reagentName).join(" + ");
  const temperature = useTubeReactionStore.getState().chemistryById[tube.instanceId]?.temperature ?? 0;
  const heat = temperature > 0.6 ? ", горячая" : temperature > 0.15 ? ", тёплая" : "";
  return { title: `Пробирка · ${where}`, state: `${contents}${heat}` };
}

/** The caption's name-and-state lines for what is under the cursor, or null if it is no longer there. */
export function describeSubject(subject: HintSubject): HintInfo | null {
  switch (subject.kind) {
    case "bottle": {
      const config = reagentConfig(subject.reagentId);
      const form = config?.contentsKind === "solid" ? "твёрдое вещество" : "раствор";
      return { title: `${reagentName(subject.reagentId)} · ${PLACE_TEXT[subject.place]}`, state: config ? `${form}, ${config.formula}` : form };
    }
    case "tube":
      return describeTube(subject);
    case "rack": {
      const count = tubeList(subject.place).length;
      return { title: `Штатив для пробирок · ${PLACE_TEXT[subject.place]}`, state: count === 0 ? "пробирок нет" : `пробирок: ${count}` };
    }
    case "stand": {
      const clamped = useBunsenStandStorageStore.getState().attachedTubeSlotIndex !== null;
      return {
        title: `Штатив с лапкой · ${PLACE_TEXT[subject.place]}`,
        state: subject.place === "tray" ? null : clamped ? "в лапке пробирка" : "лапка пуста",
      };
    }
    case "lamp":
      return {
        title: `Спиртовка · ${PLACE_TEXT[subject.place]}`,
        state: subject.place === "tray" ? null : LAMP_STATE[useBurnerStore.getState().phase],
      };
  }
}
