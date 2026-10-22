---
name: virtugenium-lab-furniture
description: Design laboratory furniture for Virtugenium as one coherent family. Use for cabinets, workbenches, glassware storage, fume hood furniture, technical cupboards, counters, and other large lab furnishings.
---

# Virtugenium Laboratory Furniture

Apply together with `virtugenium-3d-modeling`.

## Furniture family

All large furniture should look like it belongs to the same modern university chemistry lab.

- Light-gray painted/satin body panels.
- Graphite frames, handles, plinths and mechanisms.
- Darker chemical-resistant worktops.
- Straight clean geometry with modest bevels.
- No ornate residential cabinetry.
- No futuristic holographic/sci-fi styling.
- Avoid heavy dark monolithic blocks.
- Use visible construction logic: panels meet frames, hinges meet posts, shelves have support, doors have clearance.

## Layout rule

The game creates the lab scene procedurally. Existing placement and orientation are locked unless the user explicitly asks to change them.

For each furniture asset:

1. inspect the current procedural slot or placeholder dimensions;
2. keep its intended origin/orientation compatible with that slot;
3. model the furniture to fit the slot;
4. do not move other furniture to accommodate the new model.

## Interaction readability

- Keep handles large enough to read at normal camera distance.
- Keep interactive doors/buttons mechanically obvious.
- Noninteractive lower storage should remain visually plausible but simple.
- Prefer separate objects for parts that will animate or receive hover/click states.
- Decorative drawers and doors are not interactive unless the gameplay specification says they are.

## Closed engineering volumes

When furniture logically contains pipes, drainage, motors, wiring or technical systems, close the corresponding volume with panels/doors rather than exposing implausibly empty space.

Do not model hidden engineering in detail unless it can actually be seen or is required for animation.

## Shared asset strategy

Prefer reusable base geometry:

- one reagent-cabinet base reused across chemical categories;
- reusable door/handle/frame language;
- reusable technical materials;
- reusable reagent bottle/jar families differentiated by labels/contents;
- reusable furniture modules where dimensions permit.

Do not duplicate whole assets just to change a label or contents.

## QA

Before approval, check:

- family consistency;
- symmetry where the design calls for symmetry;
- realistic support of moving parts;
- no exposed meaningless voids;
- no conflicts with the existing procedural placement slot;
- no accidental gameplay-visible clutter.
