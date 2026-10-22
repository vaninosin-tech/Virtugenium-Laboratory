import { create } from "zustand";

import type { EntityId } from "../../entities/laboratory";
import {
  ALTERNATIVE_LIQUID_COLOR,
  DEFAULT_LIQUID_COLOR,
  createInitialLaboratoryState,
} from "./initialState";
import type { LaboratoryStore } from "./types";

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

export const useLaboratoryStore = create<LaboratoryStore>((set) => ({
  ...createInitialLaboratoryState(),

  setMode: (mode) => set({ mode }),
  setScreen: (screen) => set({ screen }),
  setCameraView: (cameraView) => set({ cameraView }),

  openTablet: (section = "tasks") =>
    set({
      tabletOpen: true,
      tabletSection: section,
    }),

  closeTablet: () => set({ tabletOpen: false }),

  setTabletSection: (tabletSection) => set({ tabletSection }),

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
    set({
      selectedExperimentId,
      currentStepId: null,
      completedStepIds: [],
      scoreEvents: [],
      errors: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }),

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

  finishSession: (finishedAt) =>
    set({
      finishedAt,
      screen: "result",
    }),

  toggleLiquidColor: () =>
    set((state) => ({
      liquidColor:
        state.liquidColor === DEFAULT_LIQUID_COLOR
          ? ALTERNATIVE_LIQUID_COLOR
          : DEFAULT_LIQUID_COLOR,
    })),

  resetAttempt: () => set(createInitialLaboratoryState()),

  resetLaboratory: () => set(createInitialLaboratoryState()),
}));
