"""
Deterministic parametric generator for LabTestTubeRack.
Run inside Blender. Deletes existing LabTestTubeRack hierarchy and rebuilds from zero.
"""

import bpy
import bmesh
import math
from mathutils import Vector

# =========================================================================
# PARAMETERS
# =========================================================================

RACK_LENGTH = 0.30      # X - overall length of the rack
RACK_DEPTH = 0.09       # Y - overall depth of the rack
RACK_HEIGHT = 0.14      # Z - overall height (feet to top rail)

RAIL_THICKNESS = 0.006  # rail vertical thickness
RAIL_DEPTH = 0.05       # rail depth (Y)

SIDE_WIDTH = 0.006          # side frame thickness (extrusion depth becomes RACK_DEPTH via profile)
SIDE_DEPTH = RACK_DEPTH     # side frame footprint depth (Y), matches rack depth
SIDE_BOTTOM_WIDTH = 0.05    # width of the solid base of the side profile (X)
HANDLE_OPENING_WIDTH = 0.028
HANDLE_OPENING_HEIGHT = 0.05
HANDLE_CORNER_RADIUS = 0.008

HOLE_COUNT = 6
HOLE_DIAMETER = 0.018
HOLE_SPACING = 0.034

INSERT_OUTER_DIAMETER = HOLE_DIAMETER
INSERT_INNER_DIAMETER = HOLE_DIAMETER - 0.004
INSERT_HEIGHT = 0.012

FOOT_HEIGHT = 0.008
BEVEL_SIZE = 0.0008

ROOT_NAME = "LabTestTubeRack"

# =========================================================================
# CLEANUP
# =========================================================================

def delete_existing():
    root = bpy.data.objects.get(ROOT_NAME)
    names_to_kill = set()
    if root:
        stack = [root]
        while stack:
            o = stack.pop()
            names_to_kill.add(o.name)
            stack.extend(o.children)
    # also catch previously-generated children even if root missing
    for prefix in ("Rack_TopRail", "Rack_BottomRail", "SideSupport_Left",
                   "SideSupport_Right", "TubeInsertSet", "Feet", ROOT_NAME):
        for obj in bpy.data.objects:
            if obj.name == prefix or obj.name.startswith(prefix + "."):
                names_to_kill.add(obj.name)

    for name in names_to_kill:
        obj = bpy.data.objects.get(name)
        if obj:
            bpy.data.objects.remove(obj, do_unlink=True)


delete_existing()

# =========================================================================
# MATERIALS
# =========================================================================

def get_or_create_material(name, base_color, metallic, roughness):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
    return mat


mat_steel = get_or_create_material("Mat_BrushedSteel", (0.62, 0.63, 0.65), 1.0, 0.35)
mat_black = get_or_create_material("Mat_MatteBlackFrame", (0.02, 0.02, 0.02), 0.0, 0.55)
mat_silicone = get_or_create_material("Mat_BlueSilicone", (0.05, 0.18, 0.55), 0.0, 0.4)

# =========================================================================
# COLLECTION / EMPTY ROOT
# =========================================================================

root_empty = bpy.data.objects.new(ROOT_NAME, None)
bpy.context.scene.collection.objects.link(root_empty)
root_empty.empty_display_size = 0.05

# =========================================================================
# HELPERS
# =========================================================================

def new_mesh_object(name, mesh_data, parent):
    obj = bpy.data.objects.new(name, mesh_data)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def add_bevel(obj, size=BEVEL_SIZE, segments=2):
    mod = obj.modifiers.new("Bevel", 'BEVEL')
    mod.width = size
    mod.segments = segments
    mod.limit_method = 'ANGLE'


def bmesh_to_mesh(bm, mesh):
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

# =========================================================================
# RAILS (top + bottom) - thin brushed stainless bars running the length
# =========================================================================

def make_rail(name, z_center):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= RACK_LENGTH
        v.co.y *= RAIL_DEPTH
        v.co.z *= RAIL_THICKNESS
    mesh = bpy.data.meshes.new(name + "_Mesh")
    bmesh_to_mesh(bm, mesh)
    obj = new_mesh_object(name, mesh, root_empty)
    obj.location = (0.0, 0.0, z_center)
    obj.data.materials.append(mat_steel)
    add_bevel(obj)
    return obj


bottom_rail_z = FOOT_HEIGHT + RAIL_THICKNESS / 2.0
top_rail_z = RACK_HEIGHT - RAIL_THICKNESS / 2.0

rail_bottom = make_rail("Rack_BottomRail", bottom_rail_z)
rail_top = make_rail("Rack_TopRail", top_rail_z)

# cut the holes through both rails
def cut_holes(obj, z_local):
    start_x = -((HOLE_COUNT - 1) * HOLE_SPACING) / 2.0
    for i in range(HOLE_COUNT):
        x = start_x + i * HOLE_SPACING
        bpy.ops.mesh.primitive_cylinder_add(
            radius=HOLE_DIAMETER / 2.0,
            depth=RAIL_DEPTH * 2.0,
            rotation=(math.radians(90), 0, 0),
            location=(x, 0.0, z_local),
        )
        cutter = bpy.context.active_object
        mod = obj.modifiers.new("Bool_%d" % i, 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cutter
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter, do_unlink=True)


cut_holes(rail_bottom, bottom_rail_z)
cut_holes(rail_top, top_rail_z)

# =========================================================================
# SIDE SUPPORT - single 2D profile, extruded, then mirrored
# =========================================================================

def build_side_profile_bmesh():
    """Builds a closed 2D profile (in XZ plane, Y=0) as a bmesh face,
    representing the side frame silhouette with a handle cutout."""
    bm = bmesh.new()

    hx = SIDE_BOTTOM_WIDTH / 2.0

    # Outer silhouette: simple upright post with a wide foot base.
    outer_pts = [
        (-hx, 0.0),
        (hx, 0.0),
        (hx, RACK_HEIGHT),
        (-hx, RACK_HEIGHT),
    ]
    outer_verts = [bm.verts.new((x, 0.0, z)) for x, z in outer_pts]
    outer_face = bm.faces.new(outer_verts)

    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    # Handle opening: rounded rectangle centered in the middle of the post
    handle_cx = 0.0
    handle_cz = RACK_HEIGHT / 2.0
    hw = HANDLE_OPENING_WIDTH / 2.0
    hh = HANDLE_OPENING_HEIGHT / 2.0
    r = min(HANDLE_CORNER_RADIUS, hw, hh)

    seg = 6  # segments per rounded corner
    handle_verts = []

    corners = [
        (handle_cx + hw - r, handle_cz + hh - r, 0, 90),    # top-right
        (handle_cx - hw + r, handle_cz + hh - r, 90, 180),  # top-left
        (handle_cx - hw + r, handle_cz - hh + r, 180, 270), # bottom-left
        (handle_cx + hw - r, handle_cz - hh + r, 270, 360), # bottom-right
    ]
    for cx, cz, a_start, a_end in corners:
        for s in range(seg + 1):
            a = math.radians(a_start + (a_end - a_start) * s / seg)
            x = cx + r * math.cos(a)
            z = cz + r * math.sin(a)
            handle_verts.append(bm.verts.new((x, 0.0, z)))

    handle_face = bm.faces.new(handle_verts)

    bm.faces.ensure_lookup_table()
    result = bmesh.ops.difference(bm, geom=[outer_face] + [v for v in outer_verts],
                                   geom_offset=[handle_face] + handle_verts)

    return bm


def build_side_profile_via_boolean_2d():
    """Simpler, robust approach: build outer solid profile face and a
    separate handle face, then use bmesh boolean via bpy.ops with 2D faces
    extruded to thin solids, since bmesh.ops.difference on pure faces is
    unreliable for concave rounded shapes."""
    hx = SIDE_BOTTOM_WIDTH / 2.0

    # Outer rectangle profile mesh
    bm = bmesh.new()
    outer_pts = [(-hx, 0.0), (hx, 0.0), (hx, RACK_HEIGHT), (-hx, RACK_HEIGHT)]
    verts = [bm.verts.new((x, 0.0, z)) for x, z in outer_pts]
    bm.faces.new(verts)
    mesh = bpy.data.meshes.new("SideProfileOuter_Mesh")
    bmesh_to_mesh(bm, mesh)
    outer_obj = bpy.data.objects.new("SideProfileOuter_TEMP", mesh)
    bpy.context.scene.collection.objects.link(outer_obj)

    # extrude outer to a thin solid along Y
    bpy.context.view_layer.objects.active = outer_obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.extrude_region_move(
        TRANSFORM_OT_translate={"value": (0.0, SIDE_DEPTH, 0.0)}
    )
    bpy.ops.object.mode_set(mode='OBJECT')

    # Handle cutter: rounded rect profile extruded well beyond depth
    handle_cx = 0.0
    handle_cz = RACK_HEIGHT / 2.0
    hw = HANDLE_OPENING_WIDTH / 2.0
    hh = HANDLE_OPENING_HEIGHT / 2.0
    r = min(HANDLE_CORNER_RADIUS, hw, hh)
    seg = 6
    handle_pts = []
    corners = [
        (handle_cx + hw - r, handle_cz + hh - r, 0, 90),
        (handle_cx - hw + r, handle_cz + hh - r, 90, 180),
        (handle_cx - hw + r, handle_cz - hh + r, 180, 270),
        (handle_cx + hw - r, handle_cz - hh + r, 270, 360),
    ]
    for cx, cz, a_start, a_end in corners:
        for s in range(seg + 1):
            a = math.radians(a_start + (a_end - a_start) * s / seg)
            x = cx + r * math.cos(a)
            z = cz + r * math.sin(a)
            handle_pts.append((x, z))

    bm2 = bmesh.new()
    hverts = [bm2.verts.new((x, -SIDE_DEPTH, z)) for x, z in handle_pts]
    bm2.faces.new(hverts)
    mesh2 = bpy.data.meshes.new("SideHandleCutter_Mesh")
    bmesh_to_mesh(bm2, mesh2)
    cutter_obj = bpy.data.objects.new("SideHandleCutter_TEMP", mesh2)
    bpy.context.scene.collection.objects.link(cutter_obj)

    bpy.context.view_layer.objects.active = cutter_obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.extrude_region_move(
        TRANSFORM_OT_translate={"value": (0.0, SIDE_DEPTH * 3.0, 0.0)}
    )
    bpy.ops.object.mode_set(mode='OBJECT')

    # boolean difference
    mod = outer_obj.modifiers.new("HandleCut", 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter_obj
    bpy.context.view_layer.objects.active = outer_obj
    bpy.ops.object.modifier_apply(modifier=mod.name)

    bpy.data.objects.remove(cutter_obj, do_unlink=True)

    return outer_obj


side_solid = build_side_profile_via_boolean_2d()

# Now extrude the outer solid into a real SIDE_WIDTH thickness by solidify
solid_mod = side_solid.modifiers.new("Solidify", 'SOLIDIFY')
solid_mod.thickness = SIDE_WIDTH
solid_mod.offset = 0.0
bpy.context.view_layer.objects.active = side_solid
bpy.ops.object.modifier_apply(modifier=solid_mod.name)

# center side depth on Y=0 and offset to left side of rack
side_solid.name = "SideSupport_Left"
side_solid.data.name = "SideSupport_Left_Mesh"
side_solid.location = (-(RACK_LENGTH / 2.0 - SIDE_BOTTOM_WIDTH / 2.0), -SIDE_DEPTH / 2.0, 0.0)
side_solid.parent = root_empty
side_solid.data.materials.append(mat_black)
add_bevel(side_solid)

# Mirror for right side
side_right = side_solid.copy()
side_right.data = side_solid.data.copy()
side_right.name = "SideSupport_Right"
side_right.data.name = "SideSupport_Right_Mesh"
bpy.context.scene.collection.objects.link(side_right)
side_right.parent = root_empty
side_right.location = (RACK_LENGTH / 2.0 - SIDE_BOTTOM_WIDTH / 2.0, -SIDE_DEPTH / 2.0, 0.0)
side_right.scale = (-1.0, 1.0, 1.0)

# =========================================================================
# TUBE INSERTS (silicone grommets) - one ring per hole
# =========================================================================

insert_parent = bpy.data.objects.new("TubeInsertSet", None)
bpy.context.scene.collection.objects.link(insert_parent)
insert_parent.parent = root_empty
insert_parent.empty_display_size = 0.02

start_x = -((HOLE_COUNT - 1) * HOLE_SPACING) / 2.0
for i in range(HOLE_COUNT):
    x = start_x + i * HOLE_SPACING
    bpy.ops.mesh.primitive_cylinder_add(
        radius=INSERT_OUTER_DIAMETER / 2.0,
        depth=INSERT_HEIGHT,
        location=(x, 0.0, top_rail_z),
    )
    outer_tube = bpy.context.active_object

    bpy.ops.mesh.primitive_cylinder_add(
        radius=INSERT_INNER_DIAMETER / 2.0,
        depth=INSERT_HEIGHT * 2.0,
        location=(x, 0.0, top_rail_z),
    )
    inner_cutter = bpy.context.active_object

    mod = outer_tube.modifiers.new("Bore", 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = inner_cutter
    bpy.context.view_layer.objects.active = outer_tube
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(inner_cutter, do_unlink=True)

    outer_tube.name = "Insert_%02d" % (i + 1)
    outer_tube.parent = insert_parent
    outer_tube.data.materials.append(mat_silicone)

# =========================================================================
# FEET
# =========================================================================

feet_parent = bpy.data.objects.new("Feet", None)
bpy.context.scene.collection.objects.link(feet_parent)
feet_parent.parent = root_empty
feet_parent.empty_display_size = 0.02

foot_positions = [
    (-(RACK_LENGTH / 2.0 - SIDE_BOTTOM_WIDTH / 4.0), -(SIDE_DEPTH / 2.0 - 0.01)),
    (-(RACK_LENGTH / 2.0 - SIDE_BOTTOM_WIDTH / 4.0), (SIDE_DEPTH / 2.0 - 0.01)),
    ((RACK_LENGTH / 2.0 - SIDE_BOTTOM_WIDTH / 4.0), -(SIDE_DEPTH / 2.0 - 0.01)),
    ((RACK_LENGTH / 2.0 - SIDE_BOTTOM_WIDTH / 4.0), (SIDE_DEPTH / 2.0 - 0.01)),
]

for idx, (fx, fy) in enumerate(foot_positions):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.012,
        depth=FOOT_HEIGHT,
        location=(fx, fy, FOOT_HEIGHT / 2.0),
    )
    foot = bpy.context.active_object
    foot.name = "Foot_%02d" % (idx + 1)
    foot.parent = feet_parent
    foot.data.materials.append(mat_black)
    add_bevel(foot, size=BEVEL_SIZE, segments=1)

# =========================================================================
# CLEANUP SELECTION
# =========================================================================

bpy.ops.object.select_all(action='DESELECT')

# =========================================================================
# SAVE
# =========================================================================

bpy.ops.wm.save_as_mainfile(filepath=r"D:\virtugenium-lab\blender-source\LabTestTubeRack.blend")

result = {"status": "done", "saved_to": r"D:\virtugenium-lab\blender-source\LabTestTubeRack.blend"}
