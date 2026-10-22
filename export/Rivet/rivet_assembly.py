"""
Procedural solid-rivet joint for a small suitcase panel — run it inside Blender (Text editor -> Run Script,
or `blender --python rivet_assembly.py`).  Everything is built from the parameters below (millimetres).

Joint (outside -> inside):  Rivet_Head (domed) -> Rivet_Shaft -> Case_Panel (rigid shell) -> Case_Lining
                            -> Rivet_BackHead (the upset tail, a low mushroom head)
Origin of every rivet part sits on the rivet axis (local Z), Rivet_Assembly origin = where the head meets the panel.
Animation (24 fps, frames 1..120): holes line up -> rivet is pushed through -> tail sticks out -> the dolly and the
rivet set arrive -> the tail is upset (squashed and widened, volume kept) into the back head -> tools leave -> the
panels stay clamped.  A second coupon (".R") shows three finished rivets.
"""
import bpy, bmesh, math
from mathutils import Vector

# ----------------------------------------------------------------------------- parameters (mm)
P = dict(
    shaft_d=3.0,        # rivet shank diameter
    clearance=0.15,     # radial clearance in the holes
    head_d=6.0,         # outer (factory) head diameter
    head_h=1.6,         # outer head height
    head_edge=0.5,      # straight edge of the head before the dome starts
    back_d=5.2,         # upset (back) head diameter
    back_h=1.1,         # upset head height
    protrusion=3.0,     # tail length before upsetting (volume of the tail ~ volume of the back head)
    panel_t=2.5,        # rigid shell
    lining_t=1.5,       # lining
    seg=48,             # sides of the round parts
    bevel=0.07,         # bevel width on the metal parts
)
MM = 0.001
FRAME_END = 120


# ----------------------------------------------------------------------------- helpers
def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            block.remove(item)


def material(name, color, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def lathe(name, profile, seg=None):
    """solid of revolution about Z; profile = [(r, z), ...] in mm, first/last point may lie on the axis"""
    seg = seg or P["seg"]
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r < 1e-9:
            v = bm.verts.new((0, 0, z * MM))
            rings.append([v] * seg)
        else:
            rings.append([bm.verts.new((r * MM * math.cos(2 * math.pi * i / seg), r * MM * math.sin(2 * math.pi * i / seg), z * MM))
                          for i in range(seg)])
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            quad = []
            for v in (a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]):
                if v not in quad:
                    quad.append(v)
            if len(quad) >= 3:
                bm.faces.new(quad)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    for p in me.polygons:
        p.use_smooth = True
    return o


def arc(cx, cz, r, a0, a1, n=8):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * k / n)), cz + r * math.sin(math.radians(a0 + (a1 - a0) * k / n)))
            for k in range(n + 1)]


def add_bevel(obj, width=None, segments=2, angle=40):
    m = obj.modifiers.new("Bevel", 'BEVEL')
    m.width = (width or P["bevel"]) * MM
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    return m


def rounded_slab(name, w, d, t, r, z_top):
    """rectangular panel with rounded corners, top face at z_top (mm)"""
    pts = []
    for cx, cy, a0 in [(w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, 90), (-w / 2 + r, -d / 2 + r, 180), (w / 2 - r, -d / 2 + r, 270)]:
        for k in range(9):
            a = math.radians(a0 + 90 * k / 8)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    bm = bmesh.new()
    lo = [bm.verts.new((x * MM, y * MM, (z_top - t) * MM)) for x, y in pts]
    hi = [bm.verts.new((x * MM, y * MM, z_top * MM)) for x, y in pts]
    n = len(pts)
    for i in range(n):
        bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
    bm.faces.new(lo[::-1])
    bm.faces.new(hi)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return o


def drill(obj, xs, y=0.0):
    """through holes (shank + clearance) at the given x positions, boolean baked into the mesh"""
    r = (P["shaft_d"] / 2 + P["clearance"]) * MM
    bm = bmesh.new()
    for x in xs:
        lo = [bm.verts.new((x * MM + r * math.cos(2 * math.pi * i / 32), y * MM + r * math.sin(2 * math.pi * i / 32), -0.02)) for i in range(32)]
        hi = [bm.verts.new((x * MM + r * math.cos(2 * math.pi * i / 32), y * MM + r * math.sin(2 * math.pi * i / 32), 0.02)) for i in range(32)]
        for i in range(32):
            bm.faces.new((lo[i], lo[(i + 1) % 32], hi[(i + 1) % 32], hi[i]))
        bm.faces.new(lo[::-1])
        bm.faces.new(hi)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("cutter")
    bm.to_mesh(me)
    bm.free()
    cutter = bpy.data.objects.new("cutter", me)
    bpy.context.collection.objects.link(cutter)
    cutter.matrix_world = obj.matrix_world.copy()
    bpy.context.view_layer.update()
    mod = obj.modifiers.new("holes", 'BOOLEAN')
    mod.object = cutter
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    bpy.context.view_layer.update()
    baked = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    old = obj.data
    obj.modifiers.clear()
    obj.data = baked
    bpy.data.meshes.remove(old)
    bpy.data.objects.remove(cutter)
    for p in obj.data.polygons:
        p.use_smooth = True


# ----------------------------------------------------------------------------- rivet parts
def rivet_parts(mat_metal):
    R = P["head_d"] / 2
    hd = P["head_h"] - P["head_edge"]                      # dome height
    Rs = (R * R + hd * hd) / (2 * hd)                      # sphere radius of the dome
    fil = 0.25                                             # edge rounding of the head's underside
    head = [(0, 0), (R - fil, 0)] + arc(R - fil, fil, fil, -90, 0, 4)[1:]
    head += [(R, P["head_edge"])]
    dome = []
    for k in range(1, 13):
        r = R * (1 - k / 12)
        dome.append((r, P["head_edge"] + (math.sqrt(Rs * Rs - r * r) - (Rs - hd))))
    head += dome
    o_head = lathe("Rivet_Head", head)

    grip = P["panel_t"] + P["lining_t"]
    r = P["shaft_d"] / 2
    ch = 0.12
    o_shaft = lathe("Rivet_Shaft", [(0, 0), (r, 0), (r, -(grip - ch)), (r - ch, -grip), (0, -grip)])

    # back head: built at its FINAL size; the animation squashes/widens it from the tail (volume ~ kept)
    Rb, hb, rf = P["back_d"] / 2, P["back_h"], 0.3
    back = [(0, 0), (Rb - rf, 0)] + arc(Rb - rf, -rf, rf, 90, 0, 4)[1:]
    back += [(Rb, -(hb - rf))] + arc(Rb - rf, -(hb - rf), rf, 0, -90, 4)[1:] + [(0, -hb)]
    o_back = lathe("Rivet_BackHead", back)
    for o in (o_head, o_shaft, o_back):
        o.data.materials.append(mat_metal)
        add_bevel(o)
    return o_head, o_shaft, o_back


def assemble(suffix, location_mm, parts, mat_metal):
    """one rivet = empty 'Rivet_Assembly' on the axis + head, shank and back head (final state)"""
    grip = P["panel_t"] + P["lining_t"]
    root = bpy.data.objects.new("Rivet_Assembly" + suffix, None)
    root.empty_display_type = 'ARROWS'
    root.empty_display_size = 0.004
    bpy.context.collection.objects.link(root)
    root.location = Vector(location_mm) * MM
    objs = []
    for src in parts:
        o = src if suffix == "" else src.copy()
        if suffix:
            o.name = src.name.split(".")[0] + suffix
            bpy.context.collection.objects.link(o)
        o.parent = root
        o.location = (0, 0, -grip * MM if "BackHead" in src.name else 0)
        objs.append(o)
    return root, objs


# ----------------------------------------------------------------------------- tools
def tools(mat_tool):
    R = P["head_d"] / 2
    hd = P["head_h"] - P["head_edge"]
    Rs = (R * R + hd * hd) / (2 * hd)
    # dolly: a concave cup that follows the dome (0.04 mm off it); origin = seated position on the head
    gap = 0.04
    zr = P["head_edge"] + gap
    cup = [(R * k / 12, P["head_edge"] + (math.sqrt(Rs * Rs - (R * k / 12) ** 2) - (Rs - hd)) + gap) for k in range(11, -1, -1)]
    dolly = lathe("Rivet_Dolly", [(0, 20), (4.2, 20), (4.2, zr + 0.4), (3.9, zr), (R, zr)] + cup)
    # rivet set (punch): flat anvil face with a small chamfer
    punch = lathe("Rivet_Set", [(0, -22), (4.0, -22), (4.0, -0.35), (3.65, 0), (0, 0)])
    for o in (dolly, punch):
        o.data.materials.append(mat_tool)
        add_bevel(o, 0.05, 2)
    return dolly, punch


# ----------------------------------------------------------------------------- build
def build():
    clear_scene()
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.frame_start, sc.frame_end = 1, FRAME_END
    sc.render.fps = 24

    metal = material("Rivet_Metal", (0.62, 0.58, 0.50), 0.38, 1.0)            # slightly matte brass/steel
    tool_m = material("Tool_Steel", (0.30, 0.31, 0.33), 0.45, 1.0)
    shell_m = material("Case_Shell", (0.20, 0.10, 0.06), 0.62, 0.0)            # vintage leatherette / thin rigid panel
    lining_m = material("Case_Lining_Fabric", (0.70, 0.62, 0.45), 0.92, 0.0)

    grip = P["panel_t"] + P["lining_t"]
    # --- coupon 1: the one that is riveted in the animation
    panel = rounded_slab("Case_Panel", 36, 26, P["panel_t"], 4, 0)
    lining = rounded_slab("Case_Lining", 36, 26, P["lining_t"], 4, -P["panel_t"])
    # --- coupon 2: finished result, three rivets
    panel_r = rounded_slab("Case_Panel.R", 54, 26, P["panel_t"], 4, 0)
    lining_r = rounded_slab("Case_Lining.R", 54, 26, P["lining_t"], 4, -P["panel_t"])
    for o, m in ((panel, shell_m), (panel_r, shell_m), (lining, lining_m), (lining_r, lining_m)):
        o.data.materials.append(m)
    drill(panel, [0]); drill(lining, [0])
    drill(panel_r, [-16, 0, 16]); drill(lining_r, [-16, 0, 16])
    for o in (panel, lining, panel_r, lining_r):
        add_bevel(o, 0.12, 2, 35)
    RX = 62.0                                               # the finished coupon stands beside the animated one
    panel_r.location.x = lining_r.location.x = RX * MM
    # --- rivets
    head, shaft, back = rivet_parts(metal)
    hero, hero_parts = assemble("", (0, 0, 0), (head, shaft, back), metal)
    for i, x in enumerate((-16, 0, 16)):
        assemble(f".R{i}", (RX + x, 0, 0), (head, shaft, back), metal)
    # --- tools
    dolly, punch = tools(tool_m)

    # ------------------------------------------------------------------ animation
    def key(o, attr, idx, f, v):
        getattr(o, attr)[idx] = v
        o.keyframe_insert(attr, index=idx, frame=f)

    def lin(o):
        act = o.animation_data.action
        try:
            fcs = list(act.fcurves)
        except Exception:
            fcs = [fc for l in act.layers for s in l.strips for b in s.channelbags for fc in b.fcurves]
        for fc in fcs:
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'

    sm = lambda t: t * t * (3 - 2 * t)
    clamp = lambda t: min(max(t, 0.0), 1.0)
    h_tail = P["protrusion"]
    sxy0 = P["shaft_d"] / P["back_d"]                       # tail is as wide as the shank
    sz0 = h_tail / P["back_h"]                              # ... and as tall as the protrusion

    def upset(f):                                           # 0 = straight tail, 1 = finished back head
        return sm(clamp((f - 56) / 24))

    lining.location.x = 0.0006                              # f1: holes of panel and lining are 0.6 mm off
    for f in range(1, FRAME_END + 1):
        u = upset(f)
        # 1) lining slides until the holes coincide (f1..10)
        lining.location.x = 0.6 * MM * (1 - sm(clamp((f - 1) / 9)))
        lining.keyframe_insert("location", index=0, frame=f)
        # 2) rivet pushed through (f12..36): from 14 mm above to seated
        hero.location.z = 14 * MM * (1 - sm(clamp((f - 12) / 24)))
        hero.keyframe_insert("location", index=2, frame=f)
        # 3) tail upset (f56..80): wider and flatter, volume kept
        sxy = sxy0 + (1 - sxy0) * u
        sz = sz0 + (1 - sz0) * u
        back.scale = (sxy, sxy, sz)
        back.keyframe_insert("scale", frame=f)
        # tools: dolly on the head, rivet set under the tail, both leave afterwards
        dolly_up = 0.0 + 12 * (1 - sm(clamp((f - 36) / 8))) + 12 * sm(clamp((f - 82) / 12))
        dolly.location = (0, 0, (0.0 + dolly_up) * MM)
        dolly.keyframe_insert("location", frame=f)
        tail_bottom = -(grip + P["back_h"] * sz)             # the set follows the underside of the squashing tail
        if f < 56:
            set_z = tail_bottom - 14 * (1 - sm(clamp((f - 40) / 14)))
        elif f <= 80:
            set_z = tail_bottom
        else:
            set_z = tail_bottom - 14 * sm(clamp((f - 82) / 12))
        punch.location = (0, 0, set_z * MM)
        punch.keyframe_insert("location", frame=f)
    for o in (lining, hero, back, dolly, punch):
        lin(o)

    # camera + light rig for the preview (not part of the model)
    cam = bpy.data.objects.new("Preview_Cam", bpy.data.cameras.new("Preview_Cam"))
    bpy.context.collection.objects.link(cam)
    cam.data.lens = 50
    cam.data.clip_start = 0.001          # the model is only a few centimetres across
    cam.data.clip_end = 2.0
    tgt = Vector((0.031, 0.0, -0.004))
    cam.location = Vector((0.031, -0.150, 0.030))
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    for n, direction, e in (("Key", (-0.4, 0.5, -0.8), 2.6), ("Fill", (0.8, 0.3, -0.3), 0.8), ("Rim", (0.2, -0.8, -0.4), 1.2)):
        l = bpy.data.lights.new(n, 'SUN')
        l.energy = e
        lo = bpy.data.objects.new(n, l)
        bpy.context.collection.objects.link(lo)
        lo.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    sc.frame_set(1)
    return hero


def section_view():
    """preview helper: cut the animated joint in half (y < 0 removed) and look at the cut face from the front —
    shows the clearance in the holes, the clamp and the upset back head.  Non-destructive (live Boolean modifiers)."""
    sc = bpy.context.scene
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.05, 0))      # removes the near half (y < 0): the camera looks at the cut face
    cutter = bpy.context.object
    cutter.name = "Section_Cutter"
    cutter.scale = (0.2, 0.1, 0.2)
    cutter.hide_render = True
    cutter.display_type = 'WIRE'
    for n in ("Case_Panel", "Case_Lining", "Rivet_Head", "Rivet_Shaft", "Rivet_BackHead", "Rivet_Dolly", "Rivet_Set"):
        o = bpy.data.objects[n]
        m = o.modifiers.new("Section", 'BOOLEAN')
        m.object = cutter
        m.operation = 'DIFFERENCE'
        m.solver = 'EXACT'
    cam = sc.camera
    cam.data.lens = 85
    tgt = Vector((0, 0, -0.0045))
    cam.location = Vector((0.0, -0.085, -0.002))
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()


if __name__ == "__main__":
    build()
