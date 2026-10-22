"""
Generates a studio scene with three pharmaceutical/cosmetic glass containers:
a short wide clear jar, a medium amber bottle, and a medium clear bottle.
Each has a hollow glass body (real wall/bottom thickness, rounded shoulder,
short cylindrical neck, a raised retaining bead below the cap) and a
separate white screw cap with real modeled vertical grip ribs and a
simplified internal thread.

Run from Blender > Scripting > Text Editor > Run Script (the existing
default scene is cleared first).

Dimensions follow the mandatory table below (all millimetres). Body/neck/
bead radii and cap outer radius/height are used directly as given; the
straight body-wall height is solved so the assembled total height (glass +
cap) matches the target exactly.

                        Short jar   Medium amber   Medium clear
Body diameter              110            76             76
Total height                88           144.5          144.5
Neck diameter               78            38             38
Bead diameter                86            44             44
Bead height (vertical)      5.3           4.5            4.5
Cap diameter                 94            46             46
Cap height                  16.5           19             19
Glass wall                  2.3           2.5            2.5
"""

import bpy
import bmesh
import math
import mathutils

MM = 0.001  # meters per millimetre


# ---------------------------------------------------------------------------
# Scene setup
# ---------------------------------------------------------------------------

def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    purge_groups = (bpy.data.meshes, bpy.data.materials, bpy.data.cameras,
                    bpy.data.lights, bpy.data.worlds, bpy.data.node_groups,
                    bpy.data.images)
    for group in purge_groups:
        for block in list(group):
            if block.users == 0:
                group.remove(block)


def new_collection(name):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


# ---------------------------------------------------------------------------
# Profile geometry helpers (all coordinates in millimetres, r-z plane)
# ---------------------------------------------------------------------------

def ease_points(r0, r1, z0, z1, n):
    """Interior points of a cosine (S-curve, tangent-continuous) blend from
    (r0,z0) to (r1,z1). Endpoints are NOT included."""
    pts = []
    for i in range(1, n):
        t = i / n
        e = 0.5 - 0.5 * math.cos(math.pi * t)
        pts.append((r0 + (r1 - r0) * e, z0 + (z1 - z0) * t))
    return pts


def arc_points_deg(cx, cz, radius, a0_deg, a1_deg, n):
    """Points along a circular arc (inclusive of both ends)."""
    pts = []
    a0 = math.radians(a0_deg)
    a1 = math.radians(a1_deg)
    for i in range(0, n + 1):
        t = i / n
        a = a0 + (a1 - a0) * t
        pts.append((cx + radius * math.cos(a), cz + radius * math.sin(a)))
    return pts


def vertical_points(r, z0, z1, n):
    """Interior points along a straight vertical run, needed wherever a
    radial bump (ribs, threads) must later displace real geometry."""
    pts = []
    for i in range(1, n):
        t = i / n
        pts.append((r, z0 + (z1 - z0) * t))
    return pts


def bead_points(neck_r, z_start, bead_h, protrusion, plateau_frac=0.3, n_ease=8):
    """Interior points of the retaining bead: a rounded-collar cross-section
    (soft rounded rise, a flat plateau at full bead radius, soft rounded
    fall) so the bead reads as a distinct ring rather than a subtle sine
    bump."""
    bead_r = neck_r + protrusion
    ease_h = bead_h * (1.0 - plateau_frac) / 2.0
    z1 = z_start + ease_h
    z2 = z_start + bead_h - ease_h
    pts = []
    pts += ease_points(neck_r, bead_r, z_start, z1, n_ease)
    pts.append((bead_r, z1))
    pts.append((bead_r, z2))
    pts += ease_points(bead_r, neck_r, z2, z_start + bead_h, n_ease)
    return pts


def smooth_taper(z, z0, z1, feather):
    """0 outside [z0,z1], smoothly rises to 1 and back down within the band."""
    if z <= z0 or z >= z1:
        return 0.0
    d0 = min(1.0, (z - z0) / feather)
    d1 = min(1.0, (z1 - z) / feather)
    d = min(d0, d1)
    return 0.5 - 0.5 * math.cos(math.pi * d)


def rib_bump(theta, num_ribs, sharpness=2.2):
    """Bipolar rib waveform in [-0.5, 0.5]: +0.5 at rib peaks, -0.5 in the
    valleys between ribs, with rounded (beveled) transitions."""
    c = math.cos(theta * num_ribs)
    signed = math.copysign(abs(c) ** sharpness, c)
    return 0.5 * signed


def thread_bump(theta, z_mm, turns_per_mm, sharpness=2.2):
    phase = theta - 2.0 * math.pi * turns_per_mm * z_mm
    c = math.cos(phase)
    v = max(0.0, c)
    return v ** sharpness


# ---------------------------------------------------------------------------
# Mesh construction: revolve a closed r-z profile loop around the Z axis
# ---------------------------------------------------------------------------

def revolve_profile(name, profile_mm, segments):
    """profile_mm: ordered list of (r, z) millimetre points forming a CLOSED
    loop (closed automatically from the last point back to the first).
    Produces a clean manifold mesh via bmesh.ops.spin - no booleans, no
    overlapping shells, no seam artifacts."""
    bm = bmesh.new()
    verts = [bm.verts.new((p[0] * MM, 0.0, p[1] * MM)) for p in profile_mm]
    n = len(verts)
    edges = [bm.edges.new((verts[i], verts[(i + 1) % n])) for i in range(n)]
    geom_in = list(verts) + list(edges)
    bmesh.ops.spin(bm, geom=geom_in, cent=(0.0, 0.0, 0.0), axis=(0.0, 0.0, 1.0),
                   angle=math.radians(360.0), steps=segments, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name + "_Mesh")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    return obj


def apply_radial_bump(obj, z_lo, z_hi, feather, side, r_mid_mm, bump_fn):
    """Displaces vertices radially (local mesh space, millimetres) using
    bump_fn(theta, z_mm) -> delta_mm, restricted to the outer or inner shell
    (split at r_mid_mm) and tapered smoothly at the z band edges."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for v in bm.verts:
        x, y, z = v.co
        z_mm = z / MM
        r_mm = math.hypot(x, y) / MM
        if side == 'outer' and r_mm <= r_mid_mm:
            continue
        if side == 'inner' and r_mm >= r_mid_mm:
            continue
        taper = smooth_taper(z_mm, z_lo, z_hi, feather)
        if taper <= 0.0 or r_mm < 1e-6:
            continue
        theta = math.atan2(y, x)
        delta_mm = bump_fn(theta, z_mm) * taper
        new_r_mm = max(0.0, r_mm + delta_mm)
        scale = new_r_mm / r_mm
        v.co.x = x * scale
        v.co.y = y * scale
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def shade_smooth_object(obj, angle_deg=45):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_deg))
    except Exception:
        try:
            obj.data.use_auto_smooth = True
            obj.data.auto_smooth_angle = math.radians(angle_deg)
        except Exception:
            pass
    obj.select_set(False)


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def _set_input(bsdf, names, value):
    for n in names:
        if n in bsdf.inputs:
            bsdf.inputs[n].default_value = value
            return


def make_glass_material(name, rgb, roughness=0.07, ior=1.45):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    _set_input(bsdf, ["Base Color"], (rgb[0], rgb[1], rgb[2], 1.0))
    _set_input(bsdf, ["Transmission Weight", "Transmission"], 1.0)
    _set_input(bsdf, ["Roughness"], roughness)
    _set_input(bsdf, ["IOR"], ior)
    return mat


def make_plastic_material(name, rgb=(0.93, 0.93, 0.90), roughness=0.28):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    _set_input(bsdf, ["Base Color"], (rgb[0], rgb[1], rgb[2], 1.0))
    _set_input(bsdf, ["Roughness"], roughness)
    _set_input(bsdf, ["Metallic"], 0.0)
    return mat


def make_label_material(name, rgb=(0.97, 0.96, 0.93), roughness=0.45):
    """Neutral matte placeholder stock, ready for product branding."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    _set_input(bsdf, ["Base Color"], (rgb[0], rgb[1], rgb[2], 1.0))
    _set_input(bsdf, ["Roughness"], roughness)
    _set_input(bsdf, ["Metallic"], 0.0)
    return mat


# ---------------------------------------------------------------------------
# Label area: a clean curved placeholder panel wrapped around the front of
# the straight body wall, standing a hair proud of the glass surface
# ---------------------------------------------------------------------------

def build_label_area(name, body_r, z_lo, z_hi, segments=128, wrap_deg=300,
                      standoff=0.15):
    """A single-layer curved strip (no volume needed - it's a placeholder
    zone, not a physical sticker) centred on the side facing the camera
    (-Y), spanning `wrap_deg` degrees so a small gap is left at the back."""
    r = body_r + standoff
    theta_center = -90.0
    theta_lo = theta_center - wrap_deg / 2.0
    theta_hi = theta_center + wrap_deg / 2.0
    n = max(8, round(segments * wrap_deg / 360.0))

    bm = bmesh.new()
    bottom_verts = []
    top_verts = []
    for i in range(n + 1):
        t = i / n
        theta = math.radians(theta_lo + (theta_hi - theta_lo) * t)
        x = r * math.cos(theta) * MM
        y = r * math.sin(theta) * MM
        bottom_verts.append(bm.verts.new((x, y, z_lo * MM)))
        top_verts.append(bm.verts.new((x, y, z_hi * MM)))
    for i in range(n):
        # winding order (bottom_i, bottom_i+1, top_i+1, top_i) with theta
        # increasing gives an outward-facing normal directly - no need for
        # recalc_face_normals, which can't infer "outward" on an open shell
        bm.faces.new((bottom_verts[i], bottom_verts[i + 1],
                      top_verts[i + 1], top_verts[i]))

    mesh = bpy.data.meshes.new(name + "_Mesh")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    return obj


# ---------------------------------------------------------------------------
# Glass body profile: bottom -> straight body -> shoulder -> neck -> bead ->
# rim -> (inner wall back down) -> inner floor
# ---------------------------------------------------------------------------

def build_glass_profile(body_r, body_straight_h, shoulder_h, neck_r,
                         neck_before_bead, bead_h, bead_prot,
                         upper_neck_after_bead, wall, bottom_t,
                         bottom_corner, floor_corner=1.8, rim_round=1.2):
    pts = []

    # ---- outer wall: bottom -> body -> shoulder -> neck -> bead -> rim ----
    pts.append((0.0, 0.0))
    pts.append((body_r - bottom_corner, 0.0))
    pts += arc_points_deg(body_r - bottom_corner, bottom_corner, bottom_corner,
                           -90, 0, 6)[1:]
    z_body_top = bottom_corner + body_straight_h
    pts += vertical_points(body_r, bottom_corner, z_body_top, 8)
    pts.append((body_r, z_body_top))

    z_shoulder_top = z_body_top + shoulder_h
    shoulder_outer = ease_points(body_r, neck_r, z_body_top, z_shoulder_top, 14)
    pts += shoulder_outer
    pts.append((neck_r, z_shoulder_top))

    z_bead_start = z_shoulder_top + neck_before_bead
    pts.append((neck_r, z_bead_start))
    z_bead_end = z_bead_start + bead_h
    pts += bead_points(neck_r, z_bead_start, bead_h, bead_prot)
    pts.append((neck_r, z_bead_end))

    z_mouth_wall_top = z_bead_end + upper_neck_after_bead
    pts.append((neck_r, z_mouth_wall_top))

    pts += arc_points_deg(neck_r - rim_round, z_mouth_wall_top, rim_round,
                           0, 90, 8)[1:]
    z_top = z_mouth_wall_top + rim_round

    # ---- across the rim to the inner wall, then down to the floor ----
    inner_r_at_mouth = neck_r - wall
    pts.append((inner_r_at_mouth, z_mouth_wall_top))
    pts.append((inner_r_at_mouth, z_shoulder_top))

    shoulder_inner = [(r - wall, z) for (r, z) in reversed(shoulder_outer)]
    pts += shoulder_inner
    pts.append((body_r - wall, z_body_top))

    z_floor_corner_top = bottom_t + floor_corner
    pts += vertical_points(body_r - wall, z_body_top, z_floor_corner_top, 8)
    pts.append((body_r - wall, z_floor_corner_top))
    pts += arc_points_deg(body_r - wall - floor_corner, z_floor_corner_top,
                           floor_corner, 0, -90, 6)[1:]
    pts.append((0.0, bottom_t))
    # loop auto-closes back to (0, 0)

    markers = {
        "z_body_bottom": bottom_corner,
        "z_body_top": z_body_top,
        "z_shoulder_top": z_shoulder_top,
        "z_bead_start": z_bead_start,
        "z_bead_end": z_bead_end,
        "z_mouth_wall_top": z_mouth_wall_top,
        "z_top": z_top,
    }
    return pts, markers


# ---------------------------------------------------------------------------
# Cap: hollow shell, rounded top/bottom edges, ribbed outside, threaded inside
# ---------------------------------------------------------------------------

def build_cap_profile(cap_outer_r, cap_inner_r, cap_height, top_round,
                       top_thickness, dome_height, bottom_fillet):
    """cap_height is the TRUE total outer height (bottom rim to dome apex)."""
    pts = []
    pts.append((cap_outer_r - bottom_fillet, 0.0))
    pts += arc_points_deg(cap_outer_r - bottom_fillet, bottom_fillet,
                           bottom_fillet, -90, 0, 6)[1:]

    z_shoulder_top_of_cap = cap_height - dome_height
    z_top_round_start = z_shoulder_top_of_cap - top_round
    pts += vertical_points(cap_outer_r, bottom_fillet, z_top_round_start, 24)
    pts.append((cap_outer_r, z_top_round_start))
    pts += arc_points_deg(cap_outer_r - top_round, z_top_round_start,
                           top_round, 0, 90, 8)[1:]

    pts += ease_points(cap_outer_r - top_round, 0.0, z_shoulder_top_of_cap,
                        cap_height, 8)
    pts.append((0.0, cap_height))

    inner_ceiling_z = z_shoulder_top_of_cap - top_thickness
    pts.append((0.0, inner_ceiling_z))
    pts.append((cap_inner_r, inner_ceiling_z))
    pts += vertical_points(cap_inner_r, inner_ceiling_z, 0.0, 24)
    pts.append((cap_inner_r, 0.0))
    # loop auto-closes back to the outer bottom-fillet point, leaving the
    # cap_inner_r..0 gap at z=0 open (the cap's mouth)

    return pts, inner_ceiling_z


def build_cap(name, cap_outer_r, cap_inner_r, cap_height, num_ribs, rib_depth,
              thread_depth, segments, cap_mat, collection,
              top_round=2.0, bottom_fillet=1.0):
    top_thickness = 2.0
    dome_height = 0.4

    profile, inner_ceiling_z = build_cap_profile(
        cap_outer_r, cap_inner_r, cap_height, top_round, top_thickness,
        dome_height, bottom_fillet)

    obj = revolve_profile(name, profile, segments)
    collection.objects.link(obj)

    r_mid = (cap_outer_r + cap_inner_r) / 2.0

    # vertical grip ribs on the outer shell (bipolar bump: the nominal
    # cap_outer_r is the mean radius, so the stated cap diameter is
    # preserved), fading out near the bottom fillet and top rounding
    rib_z_lo = bottom_fillet + 1.2
    rib_z_hi = (cap_height - dome_height - top_round) - 0.8
    apply_radial_bump(obj, rib_z_lo, rib_z_hi, 1.0, 'outer', r_mid,
                       lambda theta, z: rib_depth * rib_bump(theta, num_ribs))

    # simplified internal screw thread on the inner shell
    thread_z_lo = 1.5
    thread_z_hi = inner_ceiling_z - 1.5
    if thread_z_hi > thread_z_lo:
        span = thread_z_hi - thread_z_lo
        turns_per_mm = 1.3 / span
        apply_radial_bump(obj, thread_z_lo, thread_z_hi, 1.0, 'inner', r_mid,
                           lambda theta, z: -thread_depth *
                           thread_bump(theta, z, turns_per_mm))

    obj.data.materials.append(cap_mat)
    shade_smooth_object(obj, angle_deg=35)
    return obj


# ---------------------------------------------------------------------------
# Full container assembly (glass body + separate cap)
# ---------------------------------------------------------------------------

def build_container(name_glass, name_cap, body_r, shoulder_h, neck_r,
                     neck_before_bead, bead_h, bead_prot, cap_outer_r,
                     cap_height, gap_above_bead, total_height,
                     glass_mat, cap_mat, x_pos, collection,
                     wall=2.5, bottom_t=5.0, bottom_corner=2.5,
                     upper_neck_after_bead=2.0, clearance_above_mouth=3.0,
                     glass_segments=128, cap_segments=576,
                     num_ribs=72, rib_depth=0.7, thread_depth=0.6,
                     cap_radial_clearance=1.0, floor_corner=1.8,
                     rim_round=1.2, cap_top_round=2.0, cap_bottom_fillet=1.0):

    # Solve the straight-body height so the assembled total height (glass +
    # cap) hits `total_height` exactly, given every other piece is fixed by
    # spec. The cap never covers the bead: its bottom edge sits
    # `gap_above_bead` mm above the TOP of the bead, leaving a plain
    # cylindrical neck section visible between the cap and the bead, with
    # the bead fully exposed below that.
    body_straight_h = (total_height - cap_height - gap_above_bead
                        - bottom_corner - shoulder_h - neck_before_bead - bead_h)

    profile, m = build_glass_profile(
        body_r, body_straight_h, shoulder_h, neck_r, neck_before_bead,
        bead_h, bead_prot, upper_neck_after_bead, wall, bottom_t,
        bottom_corner, floor_corner, rim_round)

    glass_obj = revolve_profile(name_glass, profile, glass_segments)
    collection.objects.link(glass_obj)
    glass_obj.data.materials.append(glass_mat)
    shade_smooth_object(glass_obj, angle_deg=40)
    glass_obj.location = (x_pos, 0.0, 0.0)

    cap_bottom_world = m["z_bead_end"] + gap_above_bead

    # cap inner radius only ever has to clear the plain neck (the cap sits
    # entirely above the bead, with clearance)
    cap_inner_r = neck_r + cap_radial_clearance

    cap_obj = build_cap(name_cap, cap_outer_r, cap_inner_r, cap_height,
                         num_ribs, rib_depth, thread_depth, cap_segments,
                         cap_mat, collection,
                         top_round=cap_top_round, bottom_fillet=cap_bottom_fillet)
    cap_obj.location = (x_pos, 0.0, cap_bottom_world * MM)

    # sanity check: glass rim must sit below the cap's inner ceiling
    assert m["z_top"] < cap_bottom_world + cap_height, \
        f"{name_glass}: glass rim intersects cap interior"

    return glass_obj, cap_obj, m


# ---------------------------------------------------------------------------
# Studio (ground, lights, camera, world)
# ---------------------------------------------------------------------------

def build_studio(studio_coll):
    world = bpy.data.worlds.new("Studio_World")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.82, 0.82, 0.82, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    bpy.context.scene.world = world

    ground_mesh = bpy.data.meshes.new("Ground_Mesh")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0)
    bm.to_mesh(ground_mesh)
    bm.free()
    ground = bpy.data.objects.new("Ground_Plane", ground_mesh)
    studio_coll.objects.link(ground)
    ground_mat = bpy.data.materials.new("Ground_Material")
    ground_mat.use_nodes = True
    bsdf = ground_mat.node_tree.nodes.get("Principled BSDF")
    _set_input(bsdf, ["Base Color"], (0.75, 0.75, 0.74, 1.0))
    _set_input(bsdf, ["Roughness"], 0.55)
    ground.data.materials.append(ground_mat)

    def add_area_light(name, location, rotation, size, energy):
        light_data = bpy.data.lights.new(name, type='AREA')
        light_data.size = size
        light_data.energy = energy
        obj = bpy.data.objects.new(name, light_data)
        obj.location = location
        obj.rotation_euler = rotation
        studio_coll.objects.link(obj)
        return obj

    add_area_light("Key_Light", (-0.45, -0.65, 0.65),
                    (math.radians(55), 0, math.radians(-30)), 0.5, 28)
    add_area_light("Fill_Light", (0.55, -0.55, 0.35),
                    (math.radians(65), 0, math.radians(35)), 0.7, 10)
    add_area_light("Rim_Light", (0.0, 0.55, 0.55),
                    (math.radians(-55), 0, math.radians(180)), 0.5, 8)

    cam_data = bpy.data.cameras.new("Studio_Camera")
    cam_data.lens = 50
    cam_obj = bpy.data.objects.new("Studio_Camera", cam_data)
    cam_obj.location = (0.0, -0.85, 0.20)
    studio_coll.objects.link(cam_obj)

    target = mathutils.Vector((0.0, 0.0, 0.06))
    direction = target - mathutils.Vector(cam_obj.location)
    cam_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

    bpy.context.scene.camera = cam_obj

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 128
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1200
    scene.render.film_transparent = False
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.length_unit = 'MILLIMETERS'


# ---------------------------------------------------------------------------
# Bounding-box verification
# ---------------------------------------------------------------------------

def max_radius_in_z_range(obj, z_lo_mm, z_hi_mm, eps=1e-4):
    """Widest local-space radius among vertices with z in [z_lo_mm, z_hi_mm].
    Used to measure the neck/bead diameter directly (they are narrower than
    the body, so the object's overall bounding box can't see them). A range
    (rather than a single z + tolerance) is robust regardless of exactly
    where the profile happens to place vertex rings within that band. `eps`
    pads the range slightly since some segments have vertex rings only at
    the exact boundary, which mm<->metre round-tripping can shift by a
    floating-point ulp and drop out of a strict inclusive comparison."""
    best = 0.0
    for v in obj.data.vertices:
        z_mm = v.co.z / MM
        if z_lo_mm - eps <= z_mm <= z_hi_mm + eps:
            r = math.hypot(v.co.x, v.co.y) / MM
            if r > best:
                best = r
    return best


def report_container(label, glass_obj, cap_obj, markers):
    bpy.context.view_layer.update()

    def bbox_world(o):
        return [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]

    g = bbox_world(glass_obj)
    c = bbox_world(cap_obj)
    body_d = max(max(p.x for p in g) - min(p.x for p in g),
                 max(p.y for p in g) - min(p.y for p in g)) / MM
    cap_d = max(max(p.x for p in c) - min(p.x for p in c),
                max(p.y for p in c) - min(p.y for p in c)) / MM
    z_min = min(p.z for p in g)
    z_max = max(max(p.z for p in g), max(p.z for p in c))
    total_h = (z_max - z_min) / MM

    neck_d = 2.0 * max_radius_in_z_range(
        glass_obj, markers["z_shoulder_top"], markers["z_bead_start"])
    bead_d = 2.0 * max_radius_in_z_range(
        glass_obj, markers["z_bead_start"], markers["z_bead_end"])

    # bead vertical height: actual z-span of vertices that clearly bulge
    # past the plain neck radius (real geometry, not just the input param)
    neck_r_measured = neck_d / 2.0
    bead_zs = [v.co.z / MM for v in glass_obj.data.vertices
               if markers["z_bead_start"] - 1.0 <= v.co.z / MM
               <= markers["z_bead_end"] + 1.0
               and math.hypot(v.co.x, v.co.y) / MM > neck_r_measured + 0.05]
    bead_h_measured = (max(bead_zs) - min(bead_zs)) if bead_zs else 0.0

    print(f"{label}:")
    print(f"  Body Ø     = {body_d:.2f} mm   (Body R = {body_d / 2.0:.2f} mm)")
    print(f"  Neck Ø     = {neck_d:.2f} mm")
    print(f"  Bead Ø     = {bead_d:.2f} mm")
    print(f"  Bead H     = {bead_h_measured:.2f} mm  (vertical)")
    print(f"  Cap Ø      = {cap_d:.2f} mm")
    print(f"  Total H    = {total_h:.2f} mm")
    return body_d, neck_d, bead_d, bead_h_measured, cap_d, total_h


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    clear_scene()

    containers_coll = new_collection("Glass_Containers")
    studio_coll = new_collection("Studio")

    mat_clear = make_glass_material("Clear_Glass", (0.93, 0.96, 0.95),
                                     roughness=0.06, ior=1.45)
    mat_amber = make_glass_material("Amber_Glass", (0.55, 0.26, 0.05),
                                     roughness=0.08, ior=1.45)
    mat_plastic = make_plastic_material("White_Plastic_Cap")
    mat_label = make_label_material("Label_Area")

    def add_label(name, markers, body_r, x_pos, margin_frac=0.25, wrap_deg=300):
        """Places a clean placeholder label zone centred on the straight
        body wall, with a comfortable margin from the shoulder above and
        the rounded base below (so it never touches the neck, cap,
        retaining bead, or the bottom curvature)."""
        span = markers["z_body_top"] - markers["z_body_bottom"]
        margin = span * margin_frac
        z_lo = markers["z_body_bottom"] + margin
        z_hi = markers["z_body_top"] - margin
        obj = build_label_area(name, body_r, z_lo, z_hi, wrap_deg=wrap_deg)
        obj.data.materials.append(mat_label)
        obj.location = (x_pos, 0.0, 0.0)
        containers_coll.objects.link(obj)
        return obj

    # ---- Short clear jar: wide pharmaceutical/cosmetic jar (102 dia body /
    #      51 radius, 82 total height), 72 dia neck, 80 dia bead. The bead
    #      is wide in cross-section (4mm radial protrusion) but made TALL
    #      (5mm vertical height) rather than a thin flange, so it reads as
    #      a thick molded glass collar. Shoulder/neck stay short (5.5mm
    #      shoulder, 4.5mm neck) so the cap sits low and close to the body
    #      rather than on a tall neck ----
    jar_glass, jar_cap, jar_m = build_container(
        "Jar_Short_Clear_Glass", "Jar_Short_Cap",
        body_r=55.0, shoulder_h=6.0, neck_r=39.0, neck_before_bead=5.0,
        bead_h=5.3, bead_prot=4.3, cap_outer_r=47.0, cap_height=16.5,
        gap_above_bead=3.2, total_height=88.0,
        glass_mat=mat_clear, cap_mat=mat_plastic, x_pos=-0.13,
        collection=containers_coll,
        wall=2.3, bottom_t=4.5, bottom_corner=3.0,
        floor_corner=2.5, rim_round=1.8,
        cap_top_round=2.8, cap_bottom_fillet=1.6)

    # ---- Medium amber bottle: broad body (76 dia / 38 radius, ~144.5 total
    #      height), 38 dia neck, 44 dia bead. Bead is tall (4.5mm vertical)
    #      rather than radially oversized, 38 dia / 19 tall cap ----
    bottle_amber_glass, bottle_amber_cap, amber_m = build_container(
        "Bottle_Medium_Amber_Glass", "Bottle_Medium_Amber_Cap",
        body_r=38.0, shoulder_h=17.0, neck_r=19.0, neck_before_bead=6.0,
        bead_h=4.5, bead_prot=3.0, cap_outer_r=23.0, cap_height=19.0,
        gap_above_bead=3.5, total_height=144.5,
        glass_mat=mat_amber, cap_mat=mat_plastic, x_pos=0.0,
        collection=containers_coll,
        wall=2.5, bottom_t=5.0, bottom_corner=2.5)

    # ---- Medium clear bottle: same family as the amber bottle, slightly
    #      different proportions per spec ("slightly different across all
    #      three"), same critical dimensions ----
    bottle_clear_glass, bottle_clear_cap, clear_m = build_container(
        "Bottle_Medium_Clear_Glass", "Bottle_Medium_Clear_Cap",
        body_r=38.0, shoulder_h=16.0, neck_r=19.0, neck_before_bead=6.5,
        bead_h=4.5, bead_prot=3.0, cap_outer_r=23.0, cap_height=19.0,
        gap_above_bead=3.5, total_height=144.5,
        glass_mat=mat_clear, cap_mat=mat_plastic, x_pos=0.11,
        collection=containers_coll,
        wall=2.5, bottom_t=5.0, bottom_corner=2.5)

    # Labels are compact front-facing patches sized to hold a product
    # name/formula - NOT a band wrapping most of the way around the
    # container. The jar's patch is narrower but stretched taller
    # (portrait) since its body is short; the bottles' patches are a bit
    # wider but shorter (landscape), sized for a name + short formula line.
    add_label("Jar_Short_Label_Area", jar_m, 55.0, -0.13,
               margin_frac=0.14, wrap_deg=110)
    add_label("Bottle_Medium_Amber_Label_Area", amber_m, 38.0, 0.0,
               margin_frac=0.16, wrap_deg=160)
    add_label("Bottle_Medium_Clear_Label_Area", clear_m, 38.0, 0.11,
               margin_frac=0.16, wrap_deg=160)

    build_studio(studio_coll)

    print("Glass container scene generated.\n")
    report_container("Small clear jar", jar_glass, jar_cap, jar_m)
    report_container("Medium amber bottle", bottle_amber_glass,
                      bottle_amber_cap, amber_m)
    report_container("Medium clear bottle", bottle_clear_glass,
                      bottle_clear_cap, clear_m)


main()
