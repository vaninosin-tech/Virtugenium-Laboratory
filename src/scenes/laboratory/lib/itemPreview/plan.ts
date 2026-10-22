import type {
  InteractionTarget,
  ItemPreviewData,
  PlacementPreview,
  PlannedPreview,
  PreviewItem,
  PreviewValidator,
  PreviewWhen,
  TargetAnchor,
  UsagePreview,
} from "./types";

/** `key:variant` before `key`: one reagent may have its own frame, the rest share the kind's. */
export function lookupPreviewData(
  table: Readonly<Record<string, ItemPreviewData>>,
  item: Pick<PreviewItem, "key" | "variant">,
): ItemPreviewData | null {
  return (item.variant ? table[`${item.key}:${item.variant}`] : undefined) ?? table[item.key] ?? null;
}

export interface TargetCandidate {
  readonly target: InteractionTarget;
  readonly anchor: TargetAnchor;
}

/**
 * Which previews to show: every enabled rule × every live target it accepts.
 * Pure — it reads no scene, so what it decides is testable. Usage comes
 * first (the more specific hint), then placements, each rule capped.
 */
export function planPreviews(
  data: ItemPreviewData,
  item: PreviewItem,
  candidates: readonly TargetCandidate[],
  validators: Readonly<Record<string, PreviewValidator>>,
  mode: PreviewWhen = "hover",
): PlannedPreview[] {
  const planned: PlannedPreview[] = [];
  const accepts = (rule: PlacementPreview | UsagePreview, tone: "placement" | "usage", { target, anchor }: TargetCandidate) => {
    if (!rule.enabled) return false;
    if ((rule.when ?? (tone === "usage" ? "held" : "hover")) !== mode) return false;
    if (target.kind !== "both" && target.kind !== tone) return false;
    if (!rule.targetTags.some((tag) => target.tags.includes(tag))) return false;
    if (rule.sameLocation && (anchor.location === null || anchor.location !== item.location)) return false;
    if (rule.validator) {
      const validate = validators[rule.validator];
      // An unknown validator refuses: a typo in data must not show a false hint.
      if (!validate || !validate(item, anchor)) return false;
    }
    return true;
  };
  for (const rule of data.usage) {
    for (const candidate of candidates) {
      if (accepts(rule, "usage", candidate)) planned.push({ tone: "usage", targetId: candidate.target.id, rule });
    }
  }
  for (const rule of data.placement) {
    let shown = 0;
    for (const candidate of candidates) {
      if (shown >= (rule.maxGhosts ?? 1)) break;
      if (accepts(rule, "placement", candidate)) {
        planned.push({ tone: "placement", targetId: candidate.target.id, rule });
        shown += 1;
      }
    }
  }
  return planned;
}
