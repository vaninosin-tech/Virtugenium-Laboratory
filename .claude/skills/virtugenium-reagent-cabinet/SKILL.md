---
name: virtugenium-reagent-cabinet
description: Create or repair the Virtugenium paged reagent cabinet. Use for the oxides, bases, salts, and acids cabinet base model, its doors, 12 reagent slots, left-side control panel, shutter mechanism, structural separators, and interaction-ready hierarchy.
---

# Virtugenium Reagent Cabinet

Apply together with `virtugenium-3d-modeling` and `virtugenium-lab-furniture`.

## Purpose

One reusable base cabinet serves four categories:

- ОКСИДЫ
- ОСНОВАНИЯ
- СОЛИ
- КИСЛОТЫ

Do not build four different cabinet bodies. Category label and reagent contents change at runtime/data level.

## Bounding design

Keep close to the established cabinet slot:

- width: about 1.10 m;
- depth: about 0.48–0.53 m;
- height: about 2.00 m.

Do not enlarge the procedural layout to fit the cabinet.

## Exterior

- Two upper glass doors of equal width.
- Symmetric facade.
- Equal-looking wide vertical outer posts/protrusions on left and right.
- Left post may hide mechanism; right post remains a symmetric structural counterpart.
- Lower section is closed, simple and noninteractive.

## Door construction

`Door_Left` and `Door_Right` must have:

- real frames;
- glass insert;
- handle attached to solid frame;
- hinges attached between door frame and fixed cabinet posts;
- pivots on hinge axes;
- about 85–90° usable opening without intersections.

Never leave floating hinges or visually unsupported doors.

## Upper/lower structural separator

A full horizontal structural panel must exist between the upper reagent compartment and lower closed compartment.

Required object name:

`UpperLower_Separator`

This is not a reagent shelf. It:

- physically divides upper and lower cabinet volumes;
- supports the upper compartment visually;
- closes the lower technical/storage volume;
- defines the lower boundary of the shutter travel.

Do not leave an open gap between upper and lower cabinet sections.

## Reagent rack

The reagent rack is STATIC.

- 3 rows × 4 positions = 12 visible reagent slots.
- Do not move the rack down or hide it mechanically.
- Remove/ignore obsolete `hide_travel_z` logic.
- Runtime changes contents while the shutter hides them.

Create semantic anchors:

- `ReagentAnchor_01` ... `ReagentAnchor_12`

or equivalent empty slot objects.

Reagent bottles/jars must not be irreversibly joined to the cabinet mesh.

## Selection mechanic compatibility

The player selects reagents by clicking containers while focused on the cabinet. Selection adds the item to a virtual laboratory tray/basket. When the player leaves cabinet focus, the selected items are transferred by game logic to the workbench.

Therefore the cabinet only needs:

- clear click targets/individual reagent objects;
- replaceable 12-slot contents;
- stable anchors;
- no physical hand-carry or cabinet-to-table animation unless explicitly requested later.

## Control panel — exact placement

This is critical.

`ControlPanel` is on the INNER LEFT SIDE WALL of the upper cabinet.

From the perspective of a player standing in front of the cabinet:

- panel is LEFT;
- never right;
- never centered;
- never on the outer facade;
- never under the reagent shelves;
- never below `ReagentRack`;
- never inside the shutter coverage rectangle.

Assume cabinet local axes:

- X = left/right;
- Y = front/back;
- Z = bottom/top.

Closed doors are approximately in XZ. The control panel is approximately in YZ. When `Door_Left` is open to about 90°, it is also approximately in YZ. Therefore the open left door and panel are PARALLEL.

The panel should sit near the front edge and at an ergonomic center height of about 1.15–1.30 m above the floor.

## Control panel niche

Do not merely glue buttons to a random wall.

Create a small coherent left-side control niche. Separate it from the reagent/shutter area with a narrow fixed vertical profile:

`InnerPost_Left` or `ControlPanel_Separator`

This profile can also carry `Shutter_Guide_Left`.

The panel remains on the left of this divider. The reagent/shutter zone begins to its right.

## Panel layout

Vertical order:

1. `Button_Previous` with ▲
2. `Page_Display`, e.g. `01/04`
3. `Button_Next` with ▼

Keep display text/state replaceable. Do not bake `01/04` permanently into the cabinet body.

Buttons must remain separate objects ready for:

- idle;
- hover;
- pressed;
- disabled.

Runtime logic to respect:

- previous enabled only when `currentPage > 1 && !isTransitioning`;
- next enabled only when `currentPage < totalPages && !isTransitioning`;
- both disabled during shutter transition;
- disabled button is dark/dim and does not hover or react to clicks.

## Shutter system

The page-change illusion uses a matte/frosted shutter moving TOP → BOTTOM.

Recommended objects:

- `Shutter_Housing`
- `Shutter_Roller`
- `Shutter_Motor_Left`
- `Shutter_Guide_Left`
- `Shutter_Guide_Right`
- `ChangeShutter`
- `Shutter_BottomBar`

The drive may be hidden inside the left wide outer post.

### Coverage rule

Define two conceptually separate zones:

`CONTROL_PANEL_ZONE` | `SHUTTER_COVERAGE_ZONE`

The shutter coverage zone contains only the reagent display area and all 12 reagent slots.

The control panel and all its buttons/display are OUTSIDE the shutter coverage zone.

`ChangeShutter` must never cover any part of the panel, even when fully closed.

`Shutter_Guide_Left` begins to the right of the control-panel zone, preferably on `InnerPost_Left`.

### Lower stop

When closed, `Shutter_BottomBar` stops immediately above `UpperLower_Separator` with a small credible gap. The shutter does not descend into the lower storage compartment.

## Runtime page-change sequence

Prepare geometry for this sequence only:

1. button pressed;
2. both buttons disabled;
3. shutter lowers in ~0.4–0.5 s;
4. all 12 reagent slots are hidden;
5. runtime swaps slot contents;
6. page display updates;
7. shutter rises in ~0.4–0.5 s;
8. buttons restore according to page bounds.

Do not model a physical carousel/warehouse behind the shelves.

## Acceptance views

Before declaring geometry complete, inspect:

1. Front view, doors closed — exterior must read as symmetric.
2. Front/perspective, left door open — control panel must be visibly on LEFT.
3. Top view, left door at 90° — door plane and panel plane must be parallel.
4. Shutter fully closed — all 12 reagent positions hidden while the entire panel remains visible.
5. Perspective/side — `UpperLower_Separator`, panel niche and support geometry must read as physically connected.

## Numeric acceptance checks

Measure, do not only eyeball:

- minimum clearance between open `Door_Left` and `ControlPanel`;
- positive separation between `ControlPanel` bounding box and `ChangeShutter` coverage/bounding box;
- door-to-post and handle clearances;
- shutter lower stop relative to `UpperLower_Separator`.

If any of these intersect, fix before continuing.

## Do not do

- no moving ReagentRack;
- no panel on the right;
- no panel under a shelf;
- no panel inside shutter rectangle;
- no shutter spanning the full interior width if that covers the panel;
- no external asymmetric control box;
- no carousel mechanism;
- no floating hinges;
- no Stage 3 materials until geometry is approved.
