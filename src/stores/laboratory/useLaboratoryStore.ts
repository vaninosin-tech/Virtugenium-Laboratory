import { create } from "zustand";

import type { EntityId } from "../../entities/laboratory";
import {
  ALTERNATIVE_LIQUID_COLOR,
  DEFAULT_LIQUID_COLOR,
  createEmptyEquationDraft,
  createInitialLaboratoryState,
} from "./initialState";
import { isSectionLockedWithoutTask, type LaboratoryStore, type TabletSection } from "./types";

const addUnique = (
  items: readonly EntityId[],
  itemId: EntityId,
): readonly EntityId[] =>
  items.includes(itemId) ? items : [...items, itemId];

const removeItem = (
  items: readonly EntityId[],
  itemId: EntityId,
): readonly EntityId[] =>
  items.filter((currentId) => currentId !== itemId);

const resolveSection = (
  section: TabletSection,
  selectedExperimentId: EntityId | null,
): TabletSection =>
  isSectionLockedWithoutTask(section, selectedExperimentId) ? "tasks" : section;

export const useLaboratoryStore = create<LaboratoryStore>((set) => ({
  ...createInitialLaboratoryState(),

  setMode: (mode) => set({ mode }),
  setScreen: (screen) => set({ screen }),
  setCameraView: (cameraView) => set({ cameraView }),

  openTablet: (section) =>
    set((state) => {
      const fallback = state.selectedExperimentId ? "stages" : "tasks";
      const requested = section ?? fallback;
      const tabletSection = resolveSection(requested, state.selectedExperimentId);
      return {
        tabletOpen: true,
        tabletSection,
        tabletHistory: tabletSection === "tasks" ? [] : (["tasks"] as const),
      };
    }),

  closeTablet: () => set({ tabletOpen: false }),

  setTabletSection: (tabletSection) =>
    set((state) => {
      const next = resolveSection(tabletSection, state.selectedExperimentId);
      if (next === state.tabletSection) return state;
      return { tabletSection: next };
    }),

  pushTabletSection: (tabletSection) =>
    set((state) => {
      const next = resolveSection(tabletSection, state.selectedExperimentId);
      if (next === state.tabletSection) return state;
      return {
        tabletSection: next,
        tabletHistory: [...state.tabletHistory, state.tabletSection],
      };
    }),

  goBackTablet: () =>
    set((state) => {
      if (state.tabletHistory.length > 0) {
        const tabletHistory = state.tabletHistory.slice(0, -1);
        const previous = state.tabletHistory[state.tabletHistory.length - 1]!;
        return {
          tabletSection: resolveSection(previous, state.selectedExperimentId),
          tabletHistory,
        };
      }
      if (state.tabletSection !== "tasks") {
        return { tabletSection: "tasks", tabletHistory: [] };
      }
      return state;
    }),

  setTheoryFocusId: (theoryFocusId) => set({ theoryFocusId }),

  addInventoryItem: (itemId) =>
    set((state) => ({
      inventoryItemIds: addUnique(state.inventoryItemIds, itemId),
    })),

  removeInventoryItem: (itemId) =>
    set((state) => ({
      inventoryItemIds: removeItem(state.inventoryItemIds, itemId),
    })),

  addBasketItem: (itemId) =>
    set((state) => ({
      basketItemIds: addUnique(state.basketItemIds, itemId),
    })),

  removeBasketItem: (itemId) =>
    set((state) => ({
      basketItemIds: removeItem(state.basketItemIds, itemId),
    })),

  selectExperiment: (selectedExperimentId) =>
    set((state) => ({
      selectedExperimentId,
      currentStepId: null,
      completedStepIds: [],
      completedExperimentIds: removeItem(state.completedExperimentIds, selectedExperimentId),
      scoreEvents: [],
      errors: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      equationDraft: createEmptyEquationDraft(),
      identifyAnswers: {},
      inventoryItemIds: [],
      basketItemIds: [],
      // Fresh attempt: drop stale answer/observations from the back stack
      // so «Назад» returns to «Опыты», not a locked equation screen.
      tabletSection: "stages",
      tabletHistory: ["tasks"],
    })),

  setCurrentStep: (currentStepId) => set({ currentStepId }),

  completeStep: (stepId) =>
    set((state) => ({
      completedStepIds: addUnique(state.completedStepIds, stepId),
    })),

  completeExperiment: (experimentId) =>
    set((state) => ({
      completedExperimentIds: addUnique(
        state.completedExperimentIds,
        experimentId,
      ),
    })),

  addScoreEvent: (event) =>
    set((state) => ({
      scoreEvents: [...state.scoreEvents, event],
    })),

  addError: (error) =>
    set((state) => ({
      errors: [...state.errors, error],
    })),

  clearErrorsForStep: (stepId) =>
    set((state) => ({
      errors: state.errors.filter((error) => error.stepId !== stepId),
    })),

  finishSession: (finishedAt) =>
    set({
      finishedAt,
      screen: "result",
    }),

  setEquationReactants: (reactants) =>
    set((state) => ({
      equationDraft: { ...state.equationDraft, reactants },
    })),

  setEquationProducts: (products) =>
    set((state) => ({
      equationDraft: { ...state.equationDraft, products },
    })),

  setEquationArrow: (arrow) =>
    set((state) => ({
      equationDraft: { ...state.equationDraft, arrow },
    })),

  setEquationMolecularText: (molecularText) =>
    set((state) => ({
      equationDraft: { ...state.equationDraft, molecularText },
    })),

  setEquationObservation: (blockId, optionId) =>
    set((state) => ({
      equationDraft: {
        ...state.equationDraft,
        observations: { ...state.equationDraft.observations, [blockId]: optionId },
      },
    })),

  resetEquationDraft: () => set({ equationDraft: createEmptyEquationDraft() }),

  setIdentifyAnswer: (fieldId, value) =>
    set((state) => ({
      identifyAnswers: { ...state.identifyAnswers, [fieldId]: value },
    })),

  clearIdentifyAnswers: () => set({ identifyAnswers: {} }),

  toggleLiquidColor: () =>
    set((state) => ({
      liquidColor:
        state.liquidColor === DEFAULT_LIQUID_COLOR
          ? ALTERNATIVE_LIQUID_COLOR
          : DEFAULT_LIQUID_COLOR,
    })),

  clearAssignment: () =>
    set((state) => ({
      selectedExperimentId: null,
      currentStepId: null,
      completedStepIds: [],
      completedExperimentIds: state.selectedExperimentId
        ? removeItem(state.completedExperimentIds, state.selectedExperimentId)
        : state.completedExperimentIds,
      scoreEvents: [],
      errors: [],
      startedAt: "",
      finishedAt: null,
      inventoryItemIds: [],
      basketItemIds: [],
      equationDraft: createEmptyEquationDraft(),
      identifyAnswers: {},
      tabletOpen: state.tabletOpen,
      tabletSection: "tasks",
      tabletHistory: [],
      theoryFocusId: null,
    })),

  resetAttempt: () => set(createInitialLaboratoryState()),

  resetLaboratory: () => set(createInitialLaboratoryState()),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __laboratoryStore?: unknown }).__laboratoryStore = useLaboratoryStore;
}
