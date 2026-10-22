import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { POUR_TILT, pourTip } from "../pourPose";
import { ITEM_PREVIEW_DATA } from "./itemPreviewData";
import { lookupPreviewData, planPreviews, type TargetCandidate } from "./plan";
import { POSE_CLIPS, applyPoseOffset } from "./poseClips";
import { createAnchor } from "./anchor";
import type { InteractionTarget, ItemPreviewData, PreviewItem } from "./types";

const target = (id: string, kind: InteractionTarget["kind"], tags: string[], location: "workbench" | "fumeHood" | null = "workbench"): TargetCandidate => {
  const anchor = createAnchor();
  anchor.location = location;
  return { target: { id, kind, tags, resolve: () => true }, anchor };
};
const item = (patch: Partial<PreviewItem> = {}): PreviewItem => ({ id: "a", key: "x", location: "workbench", ...patch });

const data: ItemPreviewData = {
  placement: [{ enabled: true, targetTags: ["shelf", "table"], maxGhosts: 2 }],
  usage: [
    { enabled: true, targetTags: ["nail"], clip: "pour", normalizedTime: 0.65 },
    { enabled: true, targetTags: ["board"], clip: "pour", normalizedTime: 0.7 },
    { enabled: false, targetTags: ["lock"], clip: "pour", normalizedTime: 0.5 },
  ],
};

describe("planPreviews", () => {
  it("matches by tag and by kind, and keeps placement and usage apart", () => {
    const candidates = [target("n", "usage", ["nail"]), target("s", "placement", ["shelf"]), target("sNail", "placement", ["nail"]), target("uShelf", "usage", ["shelf"])];
    expect(planPreviews(data, item(), candidates, {}, "held").map((p) => `${p.tone}:${p.targetId}`)).toEqual(["usage:n"]);
    expect(planPreviews(data, item(), candidates, {}, "hover").map((p) => `${p.tone}:${p.targetId}`)).toEqual(["placement:s"]);
  });

  it("gives each kind of target its own frame", () => {
    const plan = planPreviews(data, item(), [target("n", "usage", ["nail"]), target("b", "usage", ["board"])], {}, "held");
    expect(plan.map((p) => (p.rule as { normalizedTime: number }).normalizedTime)).toEqual([0.65, 0.7]);
  });

  it("skips disabled rules and caps the ghosts per rule", () => {
    const candidates = [target("l", "usage", ["lock"]), target("s1", "placement", ["shelf"]), target("s2", "placement", ["table"]), target("s3", "placement", ["shelf"])];
    const plan = planPreviews(data, item(), candidates, {}, "hover");
    expect(plan.map((p) => p.targetId)).toEqual(["s1", "s2"]);
    expect(planPreviews(data, item(), candidates, {}, "held")).toEqual([]);
  });

  it("a `both` target serves either kind", () => {
    const both = [target("t", "both", ["table", "nail"])];
    expect(planPreviews(data, item(), both, {}, "held").map((p) => p.tone)).toEqual(["usage"]);
    expect(planPreviews(data, item(), both, {}, "hover").map((p) => p.tone)).toEqual(["placement"]);
  });

  it("sameLocation refuses another place and an unplaced target", () => {
    const same: ItemPreviewData = { placement: [{ enabled: true, targetTags: ["tray"], sameLocation: true }], usage: [] };
    expect(planPreviews(same, item({ location: "fumeHood" }), [target("t", "placement", ["tray"])], {})).toEqual([]);
    expect(planPreviews(same, item(), [target("t", "placement", ["tray"], null)], {})).toEqual([]);
    expect(planPreviews(same, item(), [target("t", "placement", ["tray"])], {})).toHaveLength(1);
  });

  it("a validator can refuse, and an unknown one refuses too", () => {
    const checked: ItemPreviewData = { placement: [], usage: [{ enabled: true, targetTags: ["nail"], clip: "pour", normalizedTime: 0.6, validator: "v" }] };
    const candidates = [target("n", "usage", ["nail"])];
    expect(planPreviews(checked, item(), candidates, { v: () => false }, "held")).toEqual([]);
    expect(planPreviews(checked, item(), candidates, { v: () => true }, "held")).toHaveLength(1);
    expect(planPreviews(checked, item(), candidates, {}, "held")).toEqual([]);
  });

  it("a rule can override when it shows", () => {
    const early: ItemPreviewData = { placement: [], usage: [{ enabled: true, when: "hover", targetTags: ["nail"], clip: "pour", normalizedTime: 0.6 }] };
    const candidates = [target("n", "usage", ["nail"])];
    expect(planPreviews(early, item(), candidates, {}, "hover")).toHaveLength(1);
    expect(planPreviews(early, item(), candidates, {}, "held")).toEqual([]);
  });

  it("the shipped data shows usage in the hand and placement on hover", () => {
    const bottle = ITEM_PREVIEW_DATA.bottle;
    const candidates = [target("tube", "usage", ["tube-mouth"]), target("tray", "placement", ["tray"])];
    const ok = { standAction: () => true };
    expect(planPreviews(bottle, item({ key: "bottle" }), candidates, ok, "hover").map((p) => p.tone)).toEqual(["placement"]);
    expect(planPreviews(bottle, item({ key: "bottle" }), candidates, ok, "held").map((p) => p.tone)).toEqual(["usage"]);
  });

  it("looks a variant up before the kind", () => {
    const table = { bottle: ITEM_PREVIEW_DATA.bottle, "bottle:Cu": ITEM_PREVIEW_DATA.tube };
    expect(lookupPreviewData(table, { key: "bottle", variant: "Cu" })).toBe(ITEM_PREVIEW_DATA.tube);
    expect(lookupPreviewData(table, { key: "bottle", variant: "NaCl" })).toBe(ITEM_PREVIEW_DATA.bottle);
    expect(lookupPreviewData(table, { key: "stand" })).toBeNull();
  });

  it("the shipped data refers only to clips that exist", () => {
    for (const entry of Object.values(ITEM_PREVIEW_DATA)) {
      for (const rule of entry.usage) {
        expect(POSE_CLIPS[rule.clip]).toBeTypeOf("function");
        expect(rule.normalizedTime).toBeGreaterThanOrEqual(0);
        expect(rule.normalizedTime).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("pour clip — the frozen frame", () => {
  const bottle = { mouthOffset: new THREE.Vector3(0, 0.13, 0), radius: 0.04, neckRadius: 0.012 };
  const anchor = createAnchor();
  anchor.point.set(1, 1, 2);
  anchor.side.set(1, 0, 0);
  anchor.axis.crossVectors(new THREE.Vector3(0, 1, 0), anchor.side).normalize();
  const at = (t: number) => {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    POSE_CLIPS.pour(t, bottle, anchor, position, quaternion);
    return { position, quaternion };
  };

  it("at 0.6 the bottle is fully tipped, its mouth just over the tube's", () => {
    expect(pourTip(0.6)).toBe(1);
    const { position, quaternion } = at(0.6);
    const angle = 2 * Math.acos(Math.abs(quaternion.w));
    expect(angle).toBeCloseTo(POUR_TILT, 5);
    const mouth = bottle.mouthOffset.clone().applyQuaternion(quaternion).add(position);
    expect(mouth.x).toBeCloseTo(1.004, 5);
    expect(mouth.z).toBeCloseTo(2, 5);
    expect(mouth.y).toBeGreaterThan(1);
    expect(mouth.y).toBeLessThan(1.03);
  });

  it("is a pure function of the time: the same frame every time, nothing plays", () => {
    const first = at(0.6);
    const second = at(0.6);
    expect(first.position.toArray()).toEqual(second.position.toArray());
    expect(first.quaternion.toArray()).toEqual(second.quaternion.toArray());
    expect(at(0.1).quaternion.w).toBeCloseTo(1, 5);
    expect(at(0.6).quaternion.w).not.toBeCloseTo(1, 1);
  });

  it("an offset moves, turns and scales the frame", () => {
    const { position, quaternion } = at(0.6);
    const before = position.clone();
    const scale = applyPoseOffset({ position: [0, 0.01, 0], rotationDeg: [0, 90, 0], scale: 1.2 }, position, quaternion);
    expect(position.y - before.y).toBeCloseTo(0.01, 6);
    expect(scale).toBe(1.2);
    expect(applyPoseOffset(undefined, position, quaternion)).toBe(1);
  });
});
