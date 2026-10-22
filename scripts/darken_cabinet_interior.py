"""Darken the OPEN-door interior of the reagent cabinet by splitting each
shell panel's faces into interior-facing / exterior-facing groups and
assigning a darker material only to the interior-facing group.

Run against ReagentCabinet_MASTER.blend (or any .blend built on the same
asset — object/material names are checked defensively and skipped with a
warning if absent):

    blender --background ReagentCabinet_MASTER.blend --python darken_cabinet_interior.py -- --save

Without ``--save`` the script only modifies the in-memory scene (useful for
a render-and-inspect dry run before committing anything).

WHY A PER-FACE SPLIT, AND HOW IT'S DONE SAFELY:

The shell panels (``Cabinet_Body``, ``SidePost_Left``/``SidePost_Right``,
``ColumnTop_Closure``, ``ShelfTop_Closure``, ``UpperLower_Separator``,
``ServiceColumn``) are real solid panels with thickness, so each one has
faces on more than one side — an outward face (visible from outside the
cabinet) and an inward face (visible from inside the open cavity when the
doors are open), both currently painted with the same ``MAT_Cabinet_Body``
material. Darkening that material as a whole would darken the exterior too.

This script classifies every face of every shell panel by comparing its
world-space normal against the direction from a reference "interior
center" point (the bounding-box center of the upper glazed compartment's
own shelves — computed from the actual ``Shelf_*`` objects, not guessed) to
that face:

- A face whose normal points *away* from the interior center (same general
  direction as the vector from the center to the face) is exterior-facing
  — a wall's outside always looks away from the space it encloses.
- A face whose normal points *back toward* the interior center is
  interior-facing — an enclosure's inside walls always look back into the
  space, by definition of what "inside" means for a roughly box-shaped
  cavity.

This is a standard convex-enclosure heuristic and was verified against this
specific mesh before trusting it further: for `SidePost_Left`, its known
exterior flank (facing further away from the cabinet, `-X`) classified as
exterior, and its known interior flank (facing into the cavity, `+X`)
classified as interior — matching the object's actual geometry, not
assumed. It is re-verified by this script's own printed face counts every
time it runs (an interior/exterior split with either bucket at 0 faces on
a panel that clearly has both would indicate the heuristic broke on that
mesh — grep the printed report for exactly that before saving).

Faces classified as interior-facing get their `material_index` redirected
to a new, separate material — a straight duplicate of the original with
only the base color darkened (same roughness/metallic/IOR/name-suffixed) —
added as an *extra* material slot on the object. Nothing about the
existing slots, the exterior-facing faces' assignment, or the original
material itself is touched, so the exterior is unchanged by construction:
there is no shared material link left between the two face groups after
this runs.

Materials handled this way: ``MAT_Cabinet_Body`` (used by all six shell
panels above). ``MAT_Door_Frame`` and ``MAT_Shutter`` are deliberately left
alone — their faces (hinges, shutter guides/housing, the shutter panel
itself) are largely thin mechanism parts, not wall-like enclosure surfaces,
where the same normal-vs-center heuristic is far less reliable, and where
several of those faces are plainly exterior-visible once the door/shutter
is open. ``MAT_Shelf`` (the three shelves — no exterior-facing counterpart
at all) still gets the simpler whole-material darkening from the previous
version of this pass, since no split is needed there.

This replaces three approaches from earlier passes at this problem, each
confirmed (by rendering, not assumed) to be wrong for the open-door target:

- Reducing the World's lighting contribution via a Light-Path camera-ray
  branch: leaked ~56% brightness loss onto a genuinely exterior surface
  (the side post), since ordinary diffuse shading isn't camera-ray-aware.
- An invisible-to-camera occluder plane at the door opening: a real Cycles
  technique that is a confirmed no-op on this file's render engine
  (``BLENDER_EEVEE`` / EEVEE Next in Blender 5.1 doesn't respect per-ray
  object visibility).
- Tinting ``MAT_Glass``: only affects light *passing through* the glass,
  which isn't in the light path at all once the doors are swung open for
  inspection — and a render-and-measure check on the open-door view showed
  the tint still visibly darkened the glass pane itself at the angle it's
  seen from once open (an 11% brightness drop measured on that pane),
  which is exactly the kind of exterior/visible side effect this pass is
  supposed to avoid. Dropped entirely, not just de-prioritized.
"""

from __future__ import annotations

import sys

import bpy
import mathutils

# ---------------------------------------------------------------------------
# Tunable parameters
# ---------------------------------------------------------------------------

INTERIOR_BODY_COLOR_SCALE = 0.35  # base-color scale, NOT the resulting rendered brightness drop: a render+measurement check found a 0.6 scale here only produced an 18-23% actual rendered brightness drop, short of the 35-50% target — lighting contribution dilutes the material-color effect, so this had to be pushed further and re-measured (see the same check for the retuned value).
SHELF_BASE_COLOR_SCALE = 0.6
POINT_SHADOW_SOFT_SIZE = 0.06

CABINET_ROOT_NAME = "Cabinet_Oxides"
POINT_LIGHT_NAME = "Fill_Light_Temp"
SHELF_MATERIAL_NAME = "MAT_Shelf"
SHELL_MATERIAL_NAME = "MAT_Cabinet_Body"
SHELL_INTERIOR_MATERIAL_NAME = "MAT_Cabinet_Body_Interior"
SHELL_OBJECT_NAMES = (
    "Cabinet_Body", "SidePost_Left", "SidePost_Right",
    "ColumnTop_Closure", "ShelfTop_Closure", "UpperLower_Separator", "ServiceColumn",
)
SHELF_OBJECT_NAMES = ("Shelf_01", "Shelf_02", "Shelf_03")

# Materials intentionally left untouched by the per-face split — see the
# module docstring for why (mechanism parts, not enclosure walls).
UNSPLIT_MATERIALS = {"MAT_Door_Frame", "MAT_Shutter"}


def log(message: str) -> None:
    print(f"[darken_cabinet_interior] {message}")


def get_principled_bsdf(material: bpy.types.Material) -> bpy.types.ShaderNodeBsdfPrincipled | None:
    if not material or not material.use_nodes:
        return None
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def scale_material_base_color(name: str, scale: float, note: str) -> None:
    material = bpy.data.materials.get(name)
    bsdf = get_principled_bsdf(material) if material else None
    if not bsdf:
        log(f"WARNING: material '{name}' or its Principled BSDF not found — skipping.")
        return
    color_input = bsdf.inputs["Base Color"]
    r, g, b, a = color_input.default_value
    color_input.default_value = (r * scale, g * scale, b * scale, a)
    log(
        f"Material '{name}' base color scaled by {scale} ({note}): "
        f"({r:.3f}, {g:.3f}, {b:.3f}) -> ({r*scale:.3f}, {g*scale:.3f}, {b*scale:.3f})"
    )


def compute_interior_center(shelf_names: tuple[str, ...]) -> mathutils.Vector | None:
    """World-space bounding-box center of the upper glazed compartment's own
    shelves — the actual space that becomes visible when the doors open —
    rather than the whole cabinet's bbox (which also includes the separate,
    never-opened lower cabinet behind solid doors)."""
    min_corner = mathutils.Vector((float("inf"),) * 3)
    max_corner = mathutils.Vector((float("-inf"),) * 3)
    found = False
    for name in shelf_names:
        obj = bpy.data.objects.get(name)
        if not obj or obj.type != "MESH":
            continue
        found = True
        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ mathutils.Vector(corner)
            min_corner = mathutils.Vector(min(a, b) for a, b in zip(min_corner, world_corner))
            max_corner = mathutils.Vector(max(a, b) for a, b in zip(max_corner, world_corner))
    if not found:
        return None
    center = (min_corner + max_corner) / 2
    log(f"Interior reference center (from {shelf_names}): {tuple(round(c, 3) for c in center)}")
    return center


def get_or_create_interior_variant(source_name: str, interior_name: str, color_scale: float) -> bpy.types.Material:
    existing = bpy.data.materials.get(interior_name)
    if existing:
        return existing
    source = bpy.data.materials[source_name]
    variant = source.copy()
    variant.name = interior_name
    bsdf = get_principled_bsdf(variant)
    if bsdf:
        r, g, b, a = bsdf.inputs["Base Color"].default_value
        bsdf.inputs["Base Color"].default_value = (r * color_scale, g * color_scale, b * color_scale, a)
    log(f"Created '{interior_name}' as a darkened (x{color_scale}) copy of '{source_name}' "
        f"(roughness/metallic/IOR unchanged).")
    return variant


def split_object_faces_by_facing(
    obj_name: str,
    source_material_name: str,
    interior_material: bpy.types.Material,
    interior_center: mathutils.Vector,
) -> None:
    obj = bpy.data.objects.get(obj_name)
    if not obj or obj.type != "MESH":
        log(f"WARNING: object '{obj_name}' not found or not a mesh — skipping.")
        return
    mesh = obj.data

    interior_slot_index = None
    for i, slot in enumerate(obj.material_slots):
        if slot.material and slot.material.name == interior_material.name:
            interior_slot_index = i
            break
    if interior_slot_index is None:
        mesh.materials.append(interior_material)
        interior_slot_index = len(obj.material_slots) - 1

    normal_matrix = obj.matrix_world.to_3x3().inverted_safe().transposed()
    source_face_count = 0
    interior_face_count = 0
    exterior_face_count = 0
    for poly in mesh.polygons:
        if poly.material_index >= len(obj.material_slots):
            continue
        slot_material = obj.material_slots[poly.material_index].material
        if not slot_material or slot_material.name != source_material_name:
            continue
        source_face_count += 1

        world_normal = (normal_matrix @ poly.normal)
        if world_normal.length < 1e-9:
            continue
        world_normal.normalize()
        world_center = obj.matrix_world @ poly.center
        outward = world_center - interior_center
        if outward.length < 1e-6:
            continue
        outward.normalize()

        if world_normal.dot(outward) < 0:
            poly.material_index = interior_slot_index
            interior_face_count += 1
        else:
            exterior_face_count += 1

    mesh.update()
    status = "OK" if source_face_count == 0 or (interior_face_count > 0 and exterior_face_count > 0) else "WARNING"
    log(
        f"{status}: '{obj_name}': {source_face_count} face(s) using '{source_material_name}' -> "
        f"{interior_face_count} interior-facing (reassigned), {exterior_face_count} exterior-facing (untouched)."
    )
    if status == "WARNING":
        log(f"    ^ one bucket is empty — the facing heuristic may not apply cleanly to '{obj_name}'; "
            f"verify visually before trusting this object's split.")


def soften_point_light_shadow(name: str, soft_size: float) -> None:
    obj = bpy.data.objects.get(name)
    if not obj or obj.type != "LIGHT":
        log(f"WARNING: light '{name}' not found — skipping shadow softening.")
        return
    before = obj.data.shadow_soft_size
    obj.data.shadow_soft_size = soft_size
    obj.data.use_shadow = True
    log(f"Light '{name}' shadow_soft_size: {before:.3f} -> {soft_size:.3f} (use_shadow=True)")


def apply_engine_specific_shadow_and_ao_settings(scene: bpy.types.Scene) -> None:
    engine = scene.render.engine
    log(f"Render engine: {engine}")
    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        for attr, value in (("use_gtao", True), ("gtao_factor", 1.0), ("gtao_distance", 0.4)):
            if hasattr(eevee, attr):
                setattr(eevee, attr, value)
                log(f"scene.eevee.{attr} = {value}")
        if hasattr(eevee, "use_raytracing"):
            eevee.use_raytracing = True
            log("scene.eevee.use_raytracing = True")
        for attr, value in (("shadow_ray_count", 4), ("shadow_step_count", 12)):
            if hasattr(eevee, attr):
                setattr(eevee, attr, value)
                log(f"scene.eevee.{attr} = {value}")
    if engine == "CYCLES":
        cycles = scene.cycles
        if hasattr(cycles, "samples"):
            cycles.samples = max(cycles.samples, 128)
            log(f"scene.cycles.samples raised to {cycles.samples}")


def check_no_lights_inside_cabinet(cabinet_root_name: str) -> None:
    root = bpy.data.objects.get(cabinet_root_name)
    if not root:
        return
    min_corner = mathutils.Vector((float("inf"),) * 3)
    max_corner = mathutils.Vector((float("-inf"),) * 3)
    stack = [root]
    mesh_count = 0
    while stack:
        obj = stack.pop()
        stack.extend(obj.children)
        if obj.type != "MESH":
            continue
        mesh_count += 1
        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ mathutils.Vector(corner)
            min_corner = mathutils.Vector(min(a, b) for a, b in zip(min_corner, world_corner))
            max_corner = mathutils.Vector(max(a, b) for a, b in zip(max_corner, world_corner))
    if mesh_count == 0:
        return
    offenders = [
        obj.name for obj in bpy.data.objects
        if obj.type == "LIGHT" and obj.data.type != "SUN"
        and all(min_corner[i] <= obj.location[i] <= max_corner[i] for i in range(3))
    ]
    if offenders:
        log(f"WARNING: light(s) placed inside the cabinet's bounding box: {offenders}")
    else:
        log("OK: no non-directional lights are placed inside the cabinet's bounding box.")


def run() -> None:
    scene = bpy.context.scene

    log("=== Applying interior-darkening pass (per-face split, open-door target) ===")

    interior_center = compute_interior_center(SHELF_OBJECT_NAMES)
    if interior_center is None:
        log("ERROR: could not compute interior reference center (shelf objects not found) — aborting face split.")
    else:
        interior_variant = get_or_create_interior_variant(
            SHELL_MATERIAL_NAME, SHELL_INTERIOR_MATERIAL_NAME, INTERIOR_BODY_COLOR_SCALE
        )
        for name in SHELL_OBJECT_NAMES:
            split_object_faces_by_facing(name, SHELL_MATERIAL_NAME, interior_variant, interior_center)

    scale_material_base_color(
        SHELF_MATERIAL_NAME, SHELF_BASE_COLOR_SCALE,
        "shelves are fully interior, no exterior-facing counterpart",
    )
    soften_point_light_shadow(POINT_LIGHT_NAME, POINT_SHADOW_SOFT_SIZE)
    apply_engine_specific_shadow_and_ao_settings(scene)

    log("=== Verification ===")
    check_no_lights_inside_cabinet(CABINET_ROOT_NAME)
    log(f"Materials deliberately left un-split (mechanism parts, not enclosure walls): {sorted(UNSPLIT_MATERIALS)}")
    log("Exterior-facing faces keep the original 'MAT_Cabinet_Body' slot untouched — "
        "exterior appearance is unchanged by construction, not by compensation.")

    if "--save" in sys.argv:
        bpy.ops.wm.save_mainfile()
        log(f"Saved changes to {bpy.data.filepath}")
    else:
        log("Dry run only (pass --save after -- to write changes back to the .blend file).")


if __name__ == "__main__":
    run()
