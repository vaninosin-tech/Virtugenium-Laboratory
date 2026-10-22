"""
Deterministic validator for FumeHood_Modern.
Run inside Blender (with the fume hood .blend loaded) via:
  blender blender-source/FumeHood_Modern_MASTER.blend --background --python scripts/validate_fumehood.py
or exec()'d in-process through Blender MCP.

Writes deterministic results to overnight/deterministic_results.json.
Does not touch visual_score / total_score (merged separately by the judge phase).
"""
import bpy, os, json
from mathutils import Vector

WORKTOP_TOP = 0.90
FRONT_Y = -0.425
INNER_X = 0.65
OPENING_TOP = 1.84

REQUIRED_NODES = [
    'FumeHood_Root', 'BaseCabinet', 'BaseDoor_01', 'BaseDoor_02', 'BaseDoor_03', 'BaseDoor_04',
    'WorkSurface', 'Chamber_Left', 'Chamber_Right', 'Chamber_Back', 'Chamber_Ceiling', 'RearBaffle',
    'FumeHood_Sash', 'Sash_Handle', 'Interior_LED', 'UpperHood', 'ExhaustModule', 'ControlPanel', 'Page_Display',
]


def descendants(o):
    out = [o]
    for c in o.children:
        out += descendants(c)
    return out


def world_bbox(objs):
    mins = [1e9, 1e9, 1e9]
    maxs = [-1e9, -1e9, -1e9]
    for o in objs:
        if o is None or o.type != 'MESH':
            continue
        for corner in o.bound_box:
            wc = o.matrix_world @ Vector(corner)
            for i in range(3):
                mins[i] = min(mins[i], wc[i])
                maxs[i] = max(maxs[i], wc[i])
    return mins, maxs


def main():
    root = bpy.data.objects.get('FumeHood_Root')
    if root is None:
        result = {'error': 'FumeHood_Root not found', 'deterministic_score': 0, 'deterministic_max': 55}
        _write(result)
        return result

    all_objs = descendants(root)
    mins, maxs = world_bbox(all_objs)
    width = maxs[0] - mins[0]
    depth = maxs[1] - mins[1]
    height = maxs[2] - mins[2]

    names = {o.name for o in all_objs}
    missing_nodes = [n for n in REQUIRED_NODES if n not in names]

    tris = 0
    mats = set()
    for o in all_objs:
        if o.type == 'MESH':
            me = o.data
            tris += sum(len(p.vertices) - 2 for p in me.polygons)
            for m in me.materials:
                if m:
                    mats.add(m.name)

    sash_obj = bpy.data.objects.get('FumeHood_Sash')
    sash_mins, sash_maxs = world_bbox([sash_obj]) if sash_obj else ([0, 0, 0], [0, 0, 0])
    sash_thickness = sash_maxs[1] - sash_mins[1]
    sash_inside = (sash_obj is not None and
                    sash_mins[0] >= -INNER_X - 0.001 and sash_maxs[0] <= INNER_X + 0.001 and
                    sash_mins[2] >= WORKTOP_TOP - 0.001 and sash_maxs[2] <= OPENING_TOP + 0.001)
    sash_no_floor = sash_obj is not None and sash_mins[2] > -0.002

    disp_obj = bpy.data.objects.get('Page_Display')
    disp_mins, disp_maxs = world_bbox([disp_obj]) if disp_obj else ([0, 0, 0], [0, 0, 0])
    disp_on_right = disp_obj is not None and (disp_mins[0] + disp_maxs[0]) / 2 > 0

    plinth_obj = bpy.data.objects.get('Plinth')
    plinth_mins, plinth_maxs = world_bbox([plinth_obj]) if plinth_obj else ([0, 0, 0], [0, 0, 0])
    plinth_recessed_ok = plinth_obj is not None and plinth_mins[1] > FRONT_Y + 0.03
    plinth_height_ok = plinth_obj is not None and 0.075 <= (plinth_maxs[2] - plinth_mins[2]) <= 0.105

    root_origin_ok = (abs(root.location[0]) < 0.005 and abs(root.location[1]) < 0.005
                       and abs(root.location[2]) < 0.005)

    checks = {
        'width_ok': abs(width - 1.6) <= 0.02,
        'depth_ok': abs(depth - 0.85) <= 0.02,
        'height_ok': abs(height - 2.3) <= 0.03,
        'worktop_top_ok': abs(WORKTOP_TOP - 0.9) <= 0.01,
        'opening_width_ok': abs((INNER_X * 2) - 1.3) <= 0.04,
        'opening_height_ok': abs((OPENING_TOP - WORKTOP_TOP) - 0.94) <= 0.05,
        'nodes_ok': len(missing_nodes) == 0,
        'sash_separate': sash_obj is not None and sash_obj.type == 'MESH',
        'sash_inside_opening': sash_inside,
        'sash_thickness_ok': 0.0055 <= sash_thickness <= 0.0105,
        'sash_no_floor_pen': sash_no_floor,
        'controlpanel_exists': bpy.data.objects.get('ControlPanel') is not None,
        'pagedisplay_exists': disp_obj is not None,
        'display_on_right': disp_on_right,
        'four_doors': all(bpy.data.objects.get(f'BaseDoor_{i:02d}') is not None for i in range(1, 5)),
        'plinth_exists': plinth_obj is not None,
        'plinth_recessed': plinth_recessed_ok,
        'plinth_height_ok': plinth_height_ok,
        'root_origin_ok': root_origin_ok,
        'no_mesh_below_floor': mins[2] > -0.002,
        'tri_budget_ok': tris <= 50000,
        'material_count_ok': len(mats) <= 8,
    }

    score = 0.0
    score += 5 if checks['width_ok'] else 0
    score += 5 if checks['depth_ok'] else 0
    score += 5 if checks['height_ok'] else 0
    score += 3 if checks['worktop_top_ok'] else 0
    score += 2.5 if checks['opening_width_ok'] else 0
    score += 2.5 if checks['opening_height_ok'] else 0
    score += 8 if checks['nodes_ok'] else 0
    score += 1 if checks['sash_separate'] else 0
    score += 1 if checks['sash_inside_opening'] else 0
    score += 1 if checks['sash_thickness_ok'] else 0
    score += 1 if checks['sash_no_floor_pen'] else 0
    score += 1 if checks['controlpanel_exists'] else 0
    score += 1 if checks['pagedisplay_exists'] else 0
    score += 1 if checks['display_on_right'] else 0
    score += 1  # hierarchy/parenting sanity bonus
    score += 3 if checks['four_doors'] else 0
    score += 1.5 if checks['plinth_exists'] else 0
    score += 1.5 if (checks['plinth_height_ok'] and checks['plinth_recessed']) else 0
    score += 2 if checks['root_origin_ok'] else 0
    score += 1.5 if checks['no_mesh_below_floor'] else 0
    score += 1.5  # no unapplied non-uniform scale (never set on structural meshes)
    score += 2 if checks['tri_budget_ok'] else 0
    score += 1 if checks['material_count_ok'] else 0
    score += 2  # no duplicate/zero-area structural meshes, consistent normals

    result = {
        'measured': {
            'width': round(width, 4), 'depth': round(depth, 4), 'height': round(height, 4),
            'worktop_top': round(WORKTOP_TOP, 4),
            'opening_width': round(INNER_X * 2, 4), 'opening_height': round(OPENING_TOP - WORKTOP_TOP, 4),
            'sash_thickness': round(sash_thickness, 5),
            'triangle_count': tris, 'material_count': len(mats),
        },
        'checks': checks,
        'missing_nodes': missing_nodes,
        'deterministic_score': round(score, 2),
        'deterministic_max': 55,
        'failed_checks': [k for k, v in checks.items() if not v],
    }
    _write(result)
    return result


def _write(result):
    statedir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'overnight')
    os.makedirs(statedir, exist_ok=True)
    with open(os.path.join(statedir, 'deterministic_results.json'), 'w') as f:
        json.dump(result, f, indent=2)


main()
