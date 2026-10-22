---
name: virtugenium-3d-modeling
description: Create or revise Blender 3D assets for Virtugenium. Use for any laboratory furniture, equipment, props, architecture, moving parts, or game-ready asset work. Enforces the project visual language, staged workflow, physical plausibility, procedural-layout preservation, and Blender MCP review gates.
---

# Virtugenium 3D Modeling

Use this as the base skill for every Blender asset in Virtugenium. If a more specific Virtugenium skill exists for the requested object, apply both this skill and that object skill.

## Non-negotiable project rules

- Virtugenium is a modern educational chemistry laboratory, not sci-fi, industrial horror, hospital-white, or a dark bunker.
- Prefer clean semi-realistic hard-surface design with restrained detail.
- Existing procedural room layout is the source of truth. Do not move existing furniture, resize the room, rotate established zones, or redesign placement unless explicitly requested.
- Adapt new assets to the existing game layout/slot. Do not adapt the layout to a newly modeled asset.
- Do not invent gameplay mechanics while modeling. Prepare geometry and anchors for confirmed mechanics only.
- Keep objects readable at normal gameplay camera distance.
- Avoid decorative geometry that does not improve silhouette, interaction readability, or structural credibility.

## Visual language

Use the following design family unless an object-specific skill overrides it:

- furniture body: light neutral gray, approximately `#D0D4D2`;
- handles, frames, mechanisms and small technical details: graphite, approximately `#3F484D`;
- work surfaces: medium dark gray-blue, approximately `#687377`;
- restrained cool accent only for controls/status;
- matte or satin finishes; avoid mirror metal and strong neon emissive surfaces.

Final materials belong to Stage 3. During earlier stages use simple technical materials only when they help separate parts.

## Workflow

### Stage 0 — inspect

Before changing an existing asset:

1. Inspect the hierarchy, dimensions, transforms and nearby geometry.
2. Identify objects that are already used by gameplay code.
3. Preserve names, pivots and transforms that may be runtime dependencies unless change is explicitly required.
4. If a requirement is spatially ambiguous, stop and report the ambiguity instead of guessing.

### Stage 1 — blockout

Establish:

- exact bounding dimensions;
- silhouette and proportions;
- interaction-facing side;
- major compartments;
- clearance zones;
- relation to the existing procedural placement slot.

Do not add small detail.

### Stage 2 — construction

Build credible final geometry:

- real panel thickness;
- frames and supports;
- hinges connected to fixed structure;
- handles attached to solid geometry;
- shelves visibly supported;
- closed volumes where engineering systems are meant to be hidden;
- separate moving/interactable parts;
- sensible bevels only where they improve readability.

Structural plausibility is a release gate. No floating moving parts.

### Stage 3 — materials and shading

Only after geometry approval:

- create restrained PBR materials;
- keep furniture family visually consistent;
- avoid excessive roughness variation/noise;
- glass must remain readable without becoming invisible;
- emissive control elements must remain subtle.

### Stage 4 — interaction readiness

Prepare only confirmed runtime features:

- pivots on physical axes;
- separate buttons/doors/shutters;
- empty/anchor objects for spawn and placement points;
- semantic names;
- closed/open extrema that do not intersect neighboring geometry.

### Stage 5 — game-ready QA

Before export/report:

- apply intended scale policy consistently;
- verify normals;
- remove accidental duplicate/internal geometry;
- inspect intersections in all required moving states;
- report bounding box and approximate triangle count;
- preserve gameplay-facing object names and anchors;
- keep collision strategy simple unless the project explicitly needs detailed collision.

## Blender MCP behavior

When working through Blender MCP:

- make one coherent geometry change at a time;
- inspect the result before continuing;
- do not jump automatically to materials after geometry changes;
- use orthographic front/top/side views when spatial relationships matter;
- use numeric transforms/bounding boxes for acceptance checks, not only perspective screenshots;
- if a task asks only for analysis, do not modify the scene.

## Default report

At the end of a modeling stage report only:

- final dimensions;
- major hierarchy changes;
- moving/interactable objects and pivots;
- minimum clearances relevant to motion;
- approximate triangle count;
- unresolved problems.

Stop after the requested stage.
