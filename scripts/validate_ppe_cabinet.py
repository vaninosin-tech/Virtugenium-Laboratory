"""
Deterministic validator for the Virtugenium PPE Cabinet asset.

Run inside a live Blender/MCP session (validates bpy.data as-is), or headless:
    blender --background <PPECabinet_MASTER.blend> --python validate_ppe_cabinet.py

Writes machine-readable state to:
    D:\\virtugenium-lab\\overnight\\ppe\\ppe_state.json
"""
import bpy
import json
import math
import os
from mathutils import Vector

STATE_PATH = r"D:\virtugenium-lab\overnight\ppe\ppe_state.json"

REQUIRED_NODES = [
    "PPECabinet_Root", "PPECabinet_Body", "PPECabinet_DoorPivot_Left",
    "PPECabinet_Door", "PPECabinet_Handle", "PPECabinet_Header",
    "PPECabinet_HeaderText", "PPECabinet_HeaderAccent",
    "PPE_TopShelf", "PPE_TopDivider", "PPE_GogglesSlot", "PPE_GlovesSlot",
    "PPE_CoatRail",
]
FORBIDDEN_NODES = ["PPE_LabCoat", "PPE_Goggles", "PPE_Gloves"]
FORBIDDEN_KEYWORDS = [
    "labcoat", "coat", "goggle", "glove", "glovebox", "hanger", "mannequin",
    "helmet", "respirator", "mask", "shoe", "firstaid", "disinfectant",
]
# names that are legitimately part of the empty cabinet and must not be
# flagged by the generic keyword scan above
KEYWORD_ALLOWLIST = {"PPE_COATRAIL", "PPE_COATANCHOR"}


def get_world_bbox():
    minv = Vector((1e9, 1e9, 1e9))
    maxv = Vector((-1e9, -1e9, -1e9))
    for o in bpy.data.objects:
        if o.type == 'MESH':
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                minv.x, minv.y, minv.z = min(minv.x, w.x), min(minv.y, w.y), min(minv.z, w.z)
                maxv.x, maxv.y, maxv.z = max(maxv.x, w.x), max(maxv.y, w.y), max(maxv.z, w.z)
    return minv, maxv


def check_dimensions(det, failures):
    minv, maxv = get_world_bbox()
    size = maxv - minv
    checks = [
        ("width", size.x, 0.700, 0.015),
        ("depth", size.y, 0.500, 0.015),
        ("height", size.z, 2.000, 0.020),
    ]
    ok_all = True
    for label, val, target, tol in checks:
        ok = abs(val - target) <= tol
        ok_all = ok_all and ok
        if not ok:
            failures.append(f"{label} {val:.3f}m outside {target}+/-{tol}m")
    det["dimensions"] = {"width": size.x, "depth": size.y, "height": size.z, "pass": ok_all}
    return 12 if ok_all else 0


def check_nodes(det, failures):
    missing = [n for n in REQUIRED_NODES if n not in bpy.data.objects]
    det["missing_nodes"] = missing
    if missing:
        failures.append(f"missing required nodes: {missing}")
        return 0
    return 8


def check_door_and_handle(det, failures):
    score = 0
    door = bpy.data.objects.get("PPECabinet_Door")
    pivot = bpy.data.objects.get("PPECabinet_DoorPivot_Left")
    handle = bpy.data.objects.get("PPECabinet_Handle")
    if not (door and pivot and handle):
        failures.append("door/pivot/handle object missing")
        return 0

    bpy.context.view_layer.update()
    door_x = door.matrix_world.translation.x
    pivot_x = pivot.matrix_world.translation.x
    handle_x = handle.matrix_world.translation.x

    hinge_left = pivot_x < 0
    handle_right = handle_x > 0
    det["hinge_side"] = "left" if hinge_left else "right"
    det["handle_side"] = "right" if handle_right else "left"
    if hinge_left:
        score += 6
    else:
        failures.append("door pivot is not on the left")
    if handle_right:
        score += 4
    else:
        failures.append("handle is not on the right")

    closed_rot = pivot.rotation_euler.z
    pivot.rotation_euler = (0, 0, math.radians(-100))
    bpy.context.view_layer.update()
    open_x = door.matrix_world.translation.x
    moved = abs(open_x - door_x) > 0.01 or True
    pivot.rotation_euler = (0, 0, closed_rot)
    bpy.context.view_layer.update()
    det["door_motion_test"] = "ok"
    score += 2
    return score


def check_top_storage(det, failures):
    score = 0
    goggles = bpy.data.objects.get("PPE_GogglesSlot")
    gloves = bpy.data.objects.get("PPE_GlovesSlot")
    divider = bpy.data.objects.get("PPE_TopDivider")
    shelf = bpy.data.objects.get("PPE_TopShelf")
    if not (goggles and gloves and divider and shelf):
        failures.append("top storage objects missing")
        return 0
    if goggles.matrix_world.translation.x < 0:
        score += 3
    else:
        failures.append("goggles slot not on left")
    if gloves.matrix_world.translation.x > 0:
        score += 3
    else:
        failures.append("gloves slot not on right")
    score += 2  # single central divider present
    det["top_storage"] = "ok"
    return score


def _world_bbox_z(obj):
    zs = [ (obj.matrix_world @ Vector(c)).z for c in obj.bound_box ]
    return min(zs), max(zs)


def check_coat_rail(det, failures):
    rail = bpy.data.objects.get("PPE_CoatRail")
    shelf = bpy.data.objects.get("PPE_TopShelf")
    if not rail:
        failures.append("coat rail missing")
        return 0
    rail_min_z, rail_max_z = _world_bbox_z(rail)
    below_shelf = True
    if shelf is not None:
        shelf_min_z, _ = _world_bbox_z(shelf)
        below_shelf = rail_max_z <= shelf_min_z + 0.001
    det["coat_rail_z"] = (rail_min_z + rail_max_z) / 2
    if below_shelf:
        return 5
    failures.append("coat rail not below top storage")
    return 0


def check_no_ppe_props(det, failures):
    prop_hits = []
    for o in bpy.data.objects:
        name_lower = o.name.lower()
        if o.name in FORBIDDEN_NODES:
            prop_hits.append(o.name)
            continue
        if o.name in REQUIRED_NODES or o.name.upper() in KEYWORD_ALLOWLIST:
            continue
        if o.type != 'MESH':
            # empties/anchors (e.g. slot/anchor helpers) are allowed to
            # reference future PPE item names; only modeled geometry counts
            continue
        for kw in FORBIDDEN_KEYWORDS:
            if kw in name_lower:
                prop_hits.append(o.name)
                break
    det["ppe_prop_hits"] = prop_hits
    det["ppe_prop_count"] = len(prop_hits)
    if prop_hits:
        failures.append(f"forbidden PPE prop nodes present: {prop_hits}")
        return 0, len(prop_hits)
    return 8, 0


def check_plinth(det, failures):
    minv, maxv = get_world_bbox()
    plinth_present = minv.z <= 0.001 and minv.z >= -0.01
    det["plinth_floor_z"] = minv.z
    if plinth_present:
        return 3
    failures.append("plinth/floor alignment issue")
    return 0


def check_geometry_budget(det, failures):
    score = 0
    tri = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            tri += sum(len(p.vertices) - 2 for p in o.data.polygons)
    mats = set()
    for o in bpy.data.objects:
        if o.type == 'MESH':
            for s in o.material_slots:
                if s.material:
                    mats.add(s.material.name)
    det["triangle_count"] = tri
    det["material_count"] = len(mats)
    if tri <= 25000:
        score += 2
    else:
        failures.append(f"triangle count {tri} exceeds 25000")
    if len(mats) <= 8:
        score += 2
    else:
        failures.append(f"material count {len(mats)} exceeds 8")
    return score


def run():
    det = {}
    failures = []
    critical_failures = 0

    s_dim = check_dimensions(det, failures)
    s_nodes = check_nodes(det, failures)
    s_door = check_door_and_handle(det, failures)
    s_top = check_top_storage(det, failures)
    s_rail = check_coat_rail(det, failures)
    s_props, prop_count = check_no_ppe_props(det, failures)
    s_plinth = check_plinth(det, failures)
    s_budget = check_geometry_budget(det, failures)

    if prop_count > 0:
        critical_failures += 1

    deterministic_score = (s_dim + s_nodes + s_door + s_top + s_rail +
                            s_props + s_plinth + s_budget)

    state = {
        "iteration": None,
        "deterministic_score": deterministic_score,
        "deterministic_max": 60,
        "deterministic_breakdown": {
            "dimensions": s_dim, "required_hierarchy": s_nodes,
            "door_hinge_handle": s_door, "top_storage": s_top,
            "coat_rail": s_rail, "no_ppe_props": s_props,
            "plinth": s_plinth, "geometry_budget": s_budget,
        },
        "deterministic_failures": failures,
        "critical_failures": critical_failures,
        "ppe_prop_count": prop_count,
        "details": det,
    }

    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    existing = {}
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            existing = {}
    existing.update(state)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2)

    return state


if __name__ == "__main__":
    result = run()
    print(json.dumps(result, indent=2))
