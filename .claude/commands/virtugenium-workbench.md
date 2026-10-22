---
name: virtugenium-workbench
description: Create the Virtugenium central chemistry workbench. Use for its clean experiment surface, small sink, closed lower cabinets that hide drainage, item-placement anchors, and compatibility with tray-based transfer from storage cabinets.
---

# Virtugenium Workbench

Apply together with `virtugenium-3d-modeling` and `virtugenium-lab-furniture`.

## Core concept

The workbench is the primary experiment stage. It must remain visually clean and easy to read from the gameplay camera.

Do not turn it into a cluttered storage table.

The current procedural workbench position/orientation is locked. Fit the asset to the existing slot.

## Appearance

- light-gray closed base;
- dark matte chemical-resistant worktop;
- restrained graphite handles/details;
- relatively light visual mass, not a huge dark block;
- closed lower volumes;
- no unnecessary exposed framework.

## Small sink

A sink is required but must be compact so it does not consume the experiment surface.

Starting design range:

- bowl width: about 0.30–0.35 m;
- bowl front-to-back depth: about 0.25–0.30 m;
- place it toward one side, preferably the LEFT when viewed from the main player interaction side;
- do not place it in the center of the experiment zone.

Add a simple believable laboratory faucet.

The sink is a functional wet zone, not the universal chemical-waste disposal mechanic.

## Closed lower volume and drainage

The area under the worktop must be visually closed with cabinet fronts/panels.

Under the sink, create a closed service cupboard because drainage, trap/sewer connection and water supply are logically inside it.

- Do not leave the sink hanging over an empty open frame.
- Hidden plumbing does not need detailed modeling unless visible through an interaction later.
- Lower cabinet doors/panels are noninteractive by default.

## Clean working surface

Keep a large uninterrupted dry experiment zone, primarily center/right of the compact sink.

Do not permanently model reagent bottles, glassware or equipment onto the tabletop.

The game should place only currently selected experiment items.

## Tray/basket transfer mechanic

The player approaches storage cabinets and clicks reagent containers or glassware. Chosen items enter a virtual laboratory tray/basket. When cabinet focus ends, the game transfers those items to the workbench.

The physical tray does not need to remain permanently on the workbench unless explicitly requested later.

Prepare invisible/empty placement anchors instead.

Suggested semantic groups:

- `ReagentPlacement_01...`
- `GlasswarePlacement_01...`
- `EquipmentPlacement_01...`
- `ExperimentWorkZone`
- optional `WetPlacement`

## Placement layout

Preserve a clean center.

A good default organization from the main player view:

- compact sink/wet area: left edge;
- reagent staging: left/back or back edge outside the sink;
- glassware/equipment staging: right/back;
- central foreground/middle: clear `ExperimentWorkZone`.

Do not create visible grid markings unless explicitly requested. Anchors are runtime-only.

## Interaction readiness

Separate objects when needed for:

- faucet controls if they will be interactive;
- sink basin;
- worktop;
- lower cabinet fronts;
- any future waste module if separately approved.

Do not invent disposal containers or extra cleanup machinery during this modeling task unless the user has separately finalized that mechanic.

## Camera/readability checks

Before approval verify:

- sink does not dominate the top surface;
- experiment zone remains large and unobstructed;
- spawned bottles and glassware can stand without intersecting sink/faucet;
- lower base hides the area where drainage would run;
- silhouette remains clear from the established gameplay focus camera.
