import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_LIQUID_COLOR } from "./initialState";
import { useLaboratoryStore } from "./useLaboratoryStore";

describe("useLaboratoryStore", () => {
  beforeEach(() => {
    useLaboratoryStore.getState().resetAttempt();
  });

  it("создаётся с начальным состоянием", () => {
    const state = useLaboratoryStore.getState();

    expect(state.mode).toBe("training");
    expect(state.screen).toBe("main-menu");
    expect(state.cameraView).toBe("overview");
    expect(state.selectedExperimentId).toBeNull();
    expect(state.inventoryItemIds).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  it("изменяет режим, экран и ракурс камеры", () => {
    const actions = useLaboratoryStore.getState();

    actions.setMode("classic");
    actions.setScreen("laboratory");
    actions.setCameraView("workbench");

    const state = useLaboratoryStore.getState();

    expect(state.mode).toBe("classic");
    expect(state.screen).toBe("laboratory");
    expect(state.cameraView).toBe("workbench");
  });

  it("открывает, переключает и закрывает планшет", () => {
    const actions = useLaboratoryStore.getState();

    actions.openTablet("theory");
    expect(useLaboratoryStore.getState().tabletOpen).toBe(true);
    expect(useLaboratoryStore.getState().tabletSection).toBe("theory");

    actions.setTabletSection("equations");
    expect(useLaboratoryStore.getState().tabletSection).toBe("equations");

    actions.closeTablet();
    expect(useLaboratoryStore.getState().tabletOpen).toBe(false);
  });

  it("добавляет предметы в инвентарь без повторов и удаляет их", () => {
    const actions = useLaboratoryStore.getState();

    actions.addInventoryItem("test-tube");
    actions.addInventoryItem("test-tube");

    expect(useLaboratoryStore.getState().inventoryItemIds).toEqual([
      "test-tube",
    ]);

    actions.removeInventoryItem("test-tube");
    expect(useLaboratoryStore.getState().inventoryItemIds).toEqual([]);
  });

  it("добавляет предметы в корзину без повторов и удаляет их", () => {
    const actions = useLaboratoryStore.getState();

    actions.addBasketItem("burner");
    actions.addBasketItem("burner");

    expect(useLaboratoryStore.getState().basketItemIds).toEqual(["burner"]);

    actions.removeBasketItem("burner");
    expect(useLaboratoryStore.getState().basketItemIds).toEqual([]);
  });

  it("выбирает опыт и начинает новую попытку", () => {
    useLaboratoryStore.getState().selectExperiment("experiment-1");

    const state = useLaboratoryStore.getState();

    expect(state.selectedExperimentId).toBe("experiment-1");
    expect(state.startedAt).not.toBe("");
    expect(state.currentStepId).toBeNull();
    expect(state.finishedAt).toBeNull();
  });

  it("устанавливает текущий этап и отмечает этап завершённым без повторов", () => {
    const actions = useLaboratoryStore.getState();

    actions.setCurrentStep("step-1");
    actions.completeStep("step-1");
    actions.completeStep("step-1");

    const state = useLaboratoryStore.getState();

    expect(state.currentStepId).toBe("step-1");
    expect(state.completedStepIds).toEqual(["step-1"]);
  });

  it("отмечает опыт завершённым без повторов", () => {
    const actions = useLaboratoryStore.getState();

    actions.completeExperiment("experiment-1");
    actions.completeExperiment("experiment-1");

    expect(useLaboratoryStore.getState().completedExperimentIds).toEqual([
      "experiment-1",
    ]);
  });

  it("добавляет событие баллов и ошибку", () => {
    const actions = useLaboratoryStore.getState();

    actions.addScoreEvent({
      ruleId: "score-1",
      points: 2,
      stepId: "step-1",
      createdAt: "2026-08-03T00:00:00.000Z",
    });

    actions.addError({
      code: "wrong-order",
      message: "Неверный порядок действий.",
      stepId: "step-1",
    });

    const state = useLaboratoryStore.getState();

    expect(state.scoreEvents).toHaveLength(1);
    expect(state.scoreEvents[0].points).toBe(2);
    expect(state.errors).toHaveLength(1);
    expect(state.errors[0].code).toBe("wrong-order");
  });

  it("завершает сессию и открывает экран результата", () => {
    const finishedAt = "2026-08-03T01:00:00.000Z";

    useLaboratoryStore.getState().finishSession(finishedAt);

    const state = useLaboratoryStore.getState();

    expect(state.finishedAt).toBe(finishedAt);
    expect(state.screen).toBe("result");
  });

  it("сбрасывает изменённую попытку в начальное состояние", () => {
    const actions = useLaboratoryStore.getState();

    actions.setMode("clean");
    actions.setScreen("laboratory");
    actions.addInventoryItem("flask");
    actions.toggleLiquidColor();
    actions.resetAttempt();

    const state = useLaboratoryStore.getState();

    expect(state.mode).toBe("training");
    expect(state.screen).toBe("main-menu");
    expect(state.inventoryItemIds).toEqual([]);
    expect(state.liquidColor).toBe(DEFAULT_LIQUID_COLOR);
  });
});
