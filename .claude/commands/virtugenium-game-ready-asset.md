---
name: virtugenium-game-ready-asset
description: Prepare Virtugenium Blender assets for runtime integration and export. Use after geometry approval to verify hierarchy, pivots, semantic anchors, transforms, normals, interaction parts, performance, and GLB-ready structure without changing approved design.
---

# Virtugenium Game-Ready Asset

Use after an asset's geometry is approved. Do not use this skill as permission to redesign it.

## Preserve approved design

- Do not change silhouette or proportions unless a technical defect requires it.
- Do not move procedural placement/origin expectations.
- Do not merge parts that need runtime interaction or animation.

## Hierarchy

Use semantic stable names for gameplay-facing parts.

Typical separate objects include:

- doors;
- buttons;
- displays;
- shutters;
- faucet controls if interactive;
- spawn/placement anchors;
- collision proxies if used.

Keep static decorative subparts simple.

## Pivots

- Door origins: hinge axes.
- Button origins: sensible local center/press axis.
- Shutter origin/transform: supports the approved top-down motion.
- Root origin: compatible with the game's established placement convention.

Do not change an already-integrated root convention without reporting it first.

## Transforms and geometry checks

Before export:

- check dimensions in meters;
- check scale/rotation policy expected by the engine/export pipeline;
- verify normals and face orientation;
- remove accidental duplicate/internal faces;
- eliminate non-manifold defects that are not intentional;
- verify glass and thin panels are not zero-thickness when thickness matters visually;
- inspect all animated extrema for intersections.

## Performance

Keep assets economical. Do not chase arbitrary ultra-low-poly counts at the cost of silhouette, but avoid invisible subdivision and excessive bevel segments.

Report approximate triangle count and identify the largest contributors.

## Anchors and runtime metadata

Anchor objects should be clearly named and remain stable between asset revisions.

Examples:

- `ReagentAnchor_01...12`
- `ReagentPlacement_01...`
- `GlasswarePlacement_01...`
- `ExperimentWorkZone`

Do not bake runtime-selected contents into static furniture meshes.

## Export check

Before creating the final GLB/export:

1. verify approved state against the object-specific skill;
2. verify root/hierarchy names expected by code;
3. verify moving parts remain separate;
4. verify no hidden legacy geometry is unintentionally exported;
5. verify transform scale and orientation;
6. report warnings before destructive cleanup.

After export, report:

- exported file/path;
- root object;
- bounding dimensions;
- triangle count;
- animation/moving parts present;
- anchors present;
- any integration caveats.
