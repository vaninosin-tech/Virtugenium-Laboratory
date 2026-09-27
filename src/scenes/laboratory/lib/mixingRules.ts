import type { EntityId } from "../../../entities/laboratory";
import { REAGENTS, type ReagentContainerConfig, type ReagentId } from "../../../entities/laboratory/reagents";

interface MixingRule {
  /**
   * What goes into the reaction tube, in stages: everything in a stage must
   * be in the tube before anything from a later stage, while the order WITHIN
   * a stage is free. Experiment 4 is why this is not a flat list — the
   * permanganate and the acid may meet in either order, the sulfite only
   * after both (without the acid the reduction stops at brown MnO₂ instead
   * of the decolorisation the experiment asks about).
   */
  readonly stages: readonly (readonly ReagentId[])[];
  /**
   * The experiment's own `errorScoreRules` id for a wrong order. Experiments
   * whose data has no such rule refuse the pour instead of charging for it.
   */
  readonly wrongOrderRuleId?: EntityId;
}

export const MIXING_RULES: Readonly<Record<EntityId, MixingRule>> = {
  "experiment-copper-nitric-acid": {
    stages: [["cu"], ["hno3"]],
    wrongOrderRuleId: "error-1-pour",
  },
  "experiment-silver-nitrate-sodium-chloride": {
    stages: [["agno3", "nacl"]],
  },
  "experiment-barium-chloride-potassium-sulfate": {
    stages: [["bacl2", "k2so4"]],
  },
  "experiment-redox-permanganate-sulfite": {
    stages: [["kmno4", "h2so4"], ["na2so3"]],
  },
};

export type MixVerdict =
  | { readonly kind: "ok" }
  /** A reagent this experiment does not use — never poured, just refused. */
  | { readonly kind: "foreign"; readonly reagentId: string }
  | { readonly kind: "wrong-order"; readonly reagentId: string; readonly ruleId: EntityId | undefined };

const stageOf = (rule: MixingRule, reagentId: string): number =>
  rule.stages.findIndex((stage) => (stage as readonly string[]).includes(reagentId));

/**
 * Judges pouring `adding` (in order) into a tube that already holds
 * `contents`. Only MIXING is judged: an empty tube may take any reagent of
 * the experiment on its own, because preparing the acid in a second tube is
 * the ToR's own procedure for experiment 1.
 *
 * With no experiment selected (or one without rules) everything is allowed —
 * the lab stays a lab outside an assignment.
 */
export const judgeMix = (
  experimentId: EntityId | null,
  contents: readonly string[],
  adding: readonly string[],
): MixVerdict => {
  const rule = experimentId === null ? undefined : MIXING_RULES[experimentId];
  if (!rule) return { kind: "ok" };

  const present = [...contents];
  for (const reagentId of adding) {
    const stage = stageOf(rule, reagentId);
    if (stage === -1) return { kind: "foreign", reagentId };
    if (present.length > 0) {
      const laterAlreadyIn = present.some((id) => stageOf(rule, id) > stage);
      const earlierMissing = rule.stages
        .slice(0, stage)
        .some((earlier) => earlier.some((id) => !present.includes(id)));
      if (laterAlreadyIn || earlierMissing) {
        return { kind: "wrong-order", reagentId, ruleId: rule.wrongOrderRuleId };
      }
    }
    present.push(reagentId);
  }
  return { kind: "ok" };
};

export const reagentName = (reagentId: string): string =>
  (REAGENTS as Record<string, ReagentContainerConfig | undefined>)[reagentId]?.displayName ?? reagentId;
