"""
Hermetic protective case with an OVER-CENTRE TOGGLE LATCH and a compressing rubber gasket.
Run inside Blender (Text editor -> Run Script) or:  blender --python hermetic_latch.py
Everything is procedural; dimensions are millimetres (scene unit = metre, geometry scaled by 0.001).

KINEMATIC SCHEME (side view, d = distance out of the front wall, z up, z = 0 is the seam / rim plane)

      lid wall                                   A = lever axis      (d 8,  z  -8)   on the housing
        |   C  catch pin on the lid               B = toggle-link axis (d 5, z -24)   on the lever, 3 mm towards the wall
        |   |  (d 8, z +16.3)                     C = catch pin                       on the lid
        |   |                                     link  B -> C  is a rigid bar of L = 40.4 mm with a hook that
 seam ---+---|--- body                                         curls over the catch pin
        |  A o                                    lever hangs from A along the wall, pull tab at its lower end
        |   | \\  lever (fork)
        |  B o  \\
        |       |

  * dead centre  : B lies on the line A-C   ->  tan(theta) = 3 / 16  ->  theta = 10.6 deg
  * theta > 10.6 : the link pulls on the catch, the lever wants to open (needs the hand)
  * theta < 10.6 : B is on the wall side of A-C ("over-centre") -> the pull now pushes the lever against its stop;
                   the spring and a safety gate keep it there; opening needs the lever moved the other way.
  * clamp        : catch height  z_C(theta) = z_B + sqrt(L^2 - (d_C - d_B)^2); it falls as theta falls, so the last
                   degrees draw the lid down onto the gasket with a large mechanical advantage (d z_C / d theta -> 0).
  * the gasket stands PROTRUDE = 1.4 mm proud of the seat; closed it is squeezed 25 % (the lid sits on the rim).

OBJECT NAMES: Case_Body, Case_Lid, Rubber_Gasket, Latch_Housing, Locking_Lever, Toggle_Link, Catch, Pivot_Pin_A,
Pivot_Pin_B, Spring, Mounting_Plate, Safety_Lock (+ Safety_Pin, Safety_Bracket).  Test section: objects ending in ".T".
Animation (frames 1..120): 1 open | 20 lid starts closing | 35 lid enters the guides | 45 lid touches the gasket |
55 gasket starts to take load | 65 catch enters the hook | 75 lever starts | 85 dead centre | 95 over-centre, gasket
fully squeezed | 110 safety gate snaps shut.  Open = play backwards.  Lid height and gasket squeeze are DRIVERS of the lever angle.
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix

MM = 0.001
# ----------------------------------------------------------------------------- parameters (mm)
W, D, R = 340.0, 240.0, 20.0            # outer plan of the case, corner radius
H_BODY, H_LID, T_TOP = 135.0, 62.0, 3.0   # body deep enough for 150 mm test tubes standing up (tops rise into the lid)
PROTRUDE = 1.4                          # gasket proud of the seat when the lid is not pressed
GASKET_H = 5.6                          # free height of the gasket (compressed 25 % when closed)
GROOVE_D, GROOVE_Z = (1.2, 5.4), 4.2    # gasket groove in the body rim: d range, depth
# kinematics
A_D, A_Z = 10.0, -8.0                   # lever axis A
B_OFF = (-3.0, -16.0)                   # axis B relative to A: (d, z) with the lever hanging (d>0 = outwards)
LINK_L = 40.4                           # toggle link length B -> C
THETA_OPEN, THETA_ENGAGE = 85.0, None   # lever opening angle; engage angle is solved below
SAFE_OPEN = 75.0                        # gate swung out of the way (deg)
LATCH_X = (-90.0, 90.0)                 # latch centres along the front wall
FRAMES = 120


def solve():
    """derived values: catch height, engage angle, dead-centre angle"""
    bd, bz = A_D + B_OFF[0], A_Z + B_OFF[1]
    zc0 = bz + math.sqrt(LINK_L ** 2 - (A_D - bd) ** 2)
    return bd, bz, zc0


BD, BZ, ZC0 = solve()


def link_state(theta_deg):
    """B position and catch height for lever angle theta (deg, 0 = closed, opening outwards)"""
    t = math.radians(theta_deg)
    e, h = B_OFF
    bd = A_D + e * math.cos(t) - h * math.sin(t)
    bz = A_Z + e * math.sin(t) + h * math.cos(t)
    dd = A_D - bd
    zc = bz + math.sqrt(max(LINK_L ** 2 - dd * dd, 0.0)) if abs(dd) <= LINK_L else None
    return bd, bz, zc


def rise(theta_deg):
    """lid height above the closed position implied by the linkage (mm), limited by the gasket"""
    zc = link_state(theta_deg)[2]
    return None if zc is None else zc - ZC0


THETA_ENGAGE = next(t / 10 for t in range(850, 0, -1) if rise(t / 10) is not None and rise(t / 10) <= PROTRUDE)
THETA_DEAD = math.degrees(math.atan2(-B_OFF[0], -B_OFF[1]))


# ----------------------------------------------------------------------------- mesh helpers (mm)
def new_obj(name, bm, mat=None, parent=None, loc=(0, 0, 0), smooth=40, bevel=None):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.transform(Matrix.Scale(MM, 4))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.parent = parent
    o.location = Vector(loc) * MM
    if mat:
        me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    if bevel:
        m = o.modifiers.new("Bevel", 'BEVEL')
        m.width = bevel * MM
        m.segments = 2
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(35)
    return o


def empty(name, parent=None, loc=(0, 0, 0), size=3.0):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    e.parent = parent
    e.location = Vector(loc) * MM
    e.empty_display_size = size * MM
    return e


def box(bm, c, s):
    v = [bm.verts.new((c[0] + dx * s[0] / 2, c[1] + dy * s[1] / 2, c[2] + dz * s[2] / 2)) for dz in (-1, 1) for dy in (-1, 1) for dx in (-1, 1)]
    for f in [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]:
        bm.faces.new([v[i] for i in f])


def cyl_x(bm, c, r, h, seg=24):
    rings = [[bm.verts.new((c[0] + t, c[1] + r * math.cos(2 * math.pi * i / seg), c[2] + r * math.sin(2 * math.pi * i / seg))) for i in range(seg)] for t in (-h / 2, h / 2)]
    a, b = rings
    for i in range(seg):
        bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]))
    bm.faces.new(a[::-1])
    bm.faces.new(b)


def tube_x(bm, c, ro, ri, h, seg=24):
    rings = []
    for r in (ro, ri):
        rings.append([[bm.verts.new((c[0] + t, c[1] + r * math.cos(2 * math.pi * i / seg), c[2] + r * math.sin(2 * math.pi * i / seg))) for i in range(seg)] for t in (-h / 2, h / 2)])
    (oa, ob), (ia, ib) = rings
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((oa[i], oa[j], ob[j], ob[i]))
        bm.faces.new((ib[i], ib[j], ia[j], ia[i]))
        bm.faces.new((oa[j], oa[i], ia[i], ia[j]))
        bm.faces.new((ob[i], ob[j], ib[j], ib[i]))


def rr_pts(w, d, r, seg=8):
    pts = []
    r = max(r, 0.4)
    for cx, cy, a0 in [(w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, 90), (-w / 2 + r, -d / 2 + r, 180), (w / 2 - r, -d / 2 + r, 270)]:
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def plate(bm, plane, c, w, h, r, t, soft=0.5):
    """rounded-corner plate; plane 'xz' (thickness along y) or 'yz' (thickness along x)"""
    pts = rr_pts(w, h, r)
    n = len(pts)
    loops = []
    for off, k in ((-t / 2, soft), (-t / 2 + soft, 0.0), (t / 2 - soft, 0.0), (t / 2, soft)):
        ring = []
        for u, v in rr_pts(w - 2 * k, h - 2 * k, max(r - k, 0.5)):
            ring.append(bm.verts.new((c[0] + u, c[1] + off, c[2] + v)) if plane == 'xz' else bm.verts.new((c[0] + off, c[1] + u, c[2] + v)))
        loops.append(ring)
    for a, b in zip(loops, loops[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(loops[0][::-1])
    bm.faces.new(loops[-1])


def prism_xy(bm, pts, z0, z1):
    n = len(pts)
    a = [bm.verts.new((x, y, z0)) for x, y in pts]
    b = [bm.verts.new((x, y, z1)) for x, y in pts]
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(a[::-1])
    bm.faces.new(b)


def sweep(bm, path, normals, prof, closed):
    """profile prof = [(u, z)] with u along the outward normal (negative = inwards), swept along path"""
    rings = [[bm.verts.new((P[0] + n[0] * u, P[1] + n[1] * u, z)) for u, z in prof] for P, n in zip(path, normals)]
    m = len(prof)
    for a, b in zip(rings, rings[1:] + (rings[:1] if closed else [])):
        for j in range(m):
            bm.faces.new((a[j], a[(j + 1) % m], b[(j + 1) % m], b[j]))
    if not closed:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])


def outward_normals(pts):
    ns = []
    for i in range(len(pts)):
        p0, p1 = Vector(pts[i - 1]), Vector(pts[(i + 1) % len(pts)])
        t = p1 - p0
        n = Vector((t.y, -t.x)).normalized()
        ns.append((n.x, n.y))
    return ns


def strip(d0, d1, z0, z1):
    return [(-d1, z0), (-d0, z0), (-d0, z1), (-d1, z1)]          # rectangle in (u, z), u inward = negative


def material(name, color, rough, metal):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def boolean_bake(obj, cutter, op='DIFFERENCE'):
    """object and cutter must sit at the same identity-ish transform; result baked into obj.data"""
    bpy.context.view_layer.update()
    cutter.matrix_world = obj.matrix_world.copy()          # the Boolean works in world space
    bpy.context.view_layer.update()
    m = obj.modifiers.new("b", 'BOOLEAN')
    m.object = cutter
    m.operation = op
    m.solver = 'EXACT'
    bpy.context.view_layer.update()
    em = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    old = obj.data
    mats = [s.material for s in obj.material_slots]
    obj.modifiers.remove(m)
    obj.data = em
    em.materials.clear()
    for mt in mats:
        em.materials.append(mt)
    bpy.data.meshes.remove(old)
    for p in em.polygons:
        p.use_smooth = True


# ----------------------------------------------------------------------------- gasket profiles
GC = (GROOVE_D[0] + GROOVE_D[1]) / 2      # groove centre (d)


def gasket_profile(a, b, p, n=12):
    zb, zs = -GROOVE_Z + 0.05, -GROOVE_Z + 2.4
    pts = [(-GC - a, zb), (-GC + a, zb), (-GC + a, zs)]
    for k in range(1, n):
        th = math.pi * k / n
        c, s = math.cos(th), math.sin(th)
        pts.append((-GC + a * math.copysign(abs(c) ** (2 / p), c), zs + b * abs(s) ** (2 / p)))
    pts.append((-GC - a, zs))
    return pts


FREE = gasket_profile(2.0, 3.2, 2.0)                                                                   # top at +1.4
SQUEEZED = gasket_profile(2.05, 1.8, 3.2)                                                              # top at 0.0


def make_gasket(name, path, normals, closed, mat, parent, loc=(0, 0, 0)):
    bm = bmesh.new()
    sweep(bm, path, normals, FREE, closed)
    o = new_obj(name, bm, mat, parent, loc, smooth=60)
    o.shape_key_add(name="Basis")
    key = o.shape_key_add(name="Squeezed")
    bm2 = bmesh.new()
    sweep(bm2, path, normals, SQUEEZED, closed)
    bm2.verts.ensure_lookup_table()
    for i, v in enumerate(bm2.verts):
        key.data[i].co = v.co * MM
    bm2.free()
    return o, key


# ----------------------------------------------------------------------------- the latch
def build_latch(tag, frame, lid_parent, lid_offset, mats, sx=1.0):
    """frame: empty at the wall outer face on the seam (x along the wall, y = -d outwards).
       lid_parent / lid_offset: object that carries the catch and where `frame` sits in its space (mm)."""
    M_alu, M_mech, M_steel, M_rubber = mats
    t = tag
    out = {}
    # --- Mounting_Plate (+ four domed rivet heads)
    bm = bmesh.new()
    plate(bm, 'xz', (0, -1.25, -33), 50, 54, 8, 2.5)
    for x in (-21.5, 21.5):
        for z in (-22, -54):
            cyl = [[bm.verts.new((x + 2.6 * math.cos(2 * math.pi * i / 16), -2.5 - dy, z + 2.6 * math.sin(2 * math.pi * i / 16))) for i in range(16)] for dy in (0.0, 1.4)]
            for i in range(16):
                bm.faces.new((cyl[0][i], cyl[0][(i + 1) % 16], cyl[1][(i + 1) % 16], cyl[1][i]))
            bm.faces.new(cyl[0][::-1])
            bm.faces.new(cyl[1])
    out["plate"] = new_obj("Mounting_Plate" + t, bm, M_mech, frame, bevel=0.3)
    # --- Latch_Housing: two bored ears round axis A + a stiffening rib
    bm = bmesh.new()
    for s in (-1, 1):
        x = s * 19.0
        tube_x(bm, (x, -A_D, A_Z), 7.8, 2.7, 3.0)
    out["housing"] = new_obj("Latch_Housing" + t, bm, M_mech, frame, bevel=0.3)
    # --- Pivot_Pin_A: two stubs (the middle stays free for the toggle link), heads outside the ears
    bm = bmesh.new()
    for s in (-1, 1):
        cyl_x(bm, (s * 20.7, -A_D, A_Z), 2.5, 12.6, 20)
        cyl_x(bm, (s * 27.5, -A_D, A_Z), 3.6, 1.6, 20)
    out["pin_a"] = new_obj("Pivot_Pin_A" + t, bm, M_steel, frame, bevel=0.2)
    # --- Spring: torsion coil on each stub between ear and head, legs rest on the plate
    bm = bmesh.new()
    for s in (-1, 1):
        n = 5 * 24
        coil = [Vector((s * (21.7 + 4.9 * i / n), -A_D + 5.0 * math.cos(2 * math.pi * 5 * i / n), A_Z + 5.0 * math.sin(2 * math.pi * 5 * i / n))) for i in range(n + 1)]
        path_tube(bm, coil, 0.7)
        e = coil[-1]
        path_tube(bm, [e, e + Vector((0, -1.0, 0)), Vector((e.x, -3.3, e.z + 1.5))], 0.7)
        st = coil[0]
        path_tube(bm, [st, st + Vector((0, 0, -3)), Vector((st.x, -3.3, st.z - 7))], 0.7)
    out["spring"] = new_obj("Spring" + t, bm, M_steel, frame, smooth=60)
    # --- Locking_Lever (fork with a pull tab), pivot empty at A
    lp = empty("Lever_Pivot" + t, frame, (0, -A_D, A_Z), 4)
    bm = bmesh.new()
    for s in (-1, 1):
        plate(bm, 'yz', (s * 15.75, 0, -15.0), 9.0, 39.0, 3.8, 2.5)
    for s in (-1, 1):                                                 # thumb lugs outside the swing of the link (x > 14.5)
        plate(bm, 'xz', (s * 18.5, -6.75, -31.5), 8.0, 6.0, 2.0, 5.5)
    lever = new_obj("Locking_Lever" + t, bm, M_mech, lp, bevel=0.25)
    cutter_bm = bmesh.new()
    for s in (-1, 1):
        cyl_x(cutter_bm, (s * 15.75, 0, 0), 2.7, 6.0, 20)                           # bore for A
        cyl_x(cutter_bm, (s * 15.75, -B_OFF[0], B_OFF[1]), 2.7, 6.0, 20)            # bore for B  (y local = -d)
    cut = new_obj("cutter", cutter_bm)
    boolean_bake(lever, cut)
    bpy.data.objects.remove(cut)
    out["lever"], out["lever_pivot"] = lever, lp
    # --- Pivot_Pin_B through the lever flanges and the link bushings
    bm = bmesh.new()
    cyl_x(bm, (0, -B_OFF[0], B_OFF[1]), 2.5, 35.0, 20)
    cyl_x(bm, (-17.9, -B_OFF[0], B_OFF[1]), 3.4, 1.2, 20)
    cyl_x(bm, (17.9, -B_OFF[0], B_OFF[1]), 3.4, 1.2, 20)
    out["pin_b"] = new_obj("Pivot_Pin_B" + t, bm, M_steel, lp, bevel=0.2)
    # --- Toggle_Link, pivot empty at B (child of the lever pivot)
    lk = empty("Link_Pivot" + t, lp, (0, -B_OFF[0], B_OFF[1]), 3)
    bm = bmesh.new()
    for s in (-1, 1):
        x = s * 12.75
        tube_x(bm, (x, 0, 0), 3.6, 2.7, 2.5, 20)
        plate(bm, 'yz', (x, -4.8, (LINK_L + 5.8) / 2), 4.0, LINK_L + 5.8, 1.5, 2.5, soft=0.4)
        plate(bm, 'yz', (x, -1.6, LINK_L + 4.3), 10.4, 3.0, 1.0, 2.5, soft=0.4)
    box(bm, (0, -4.8, 33.0), (23.5, 3.0, 4.0))
    link = new_obj("Toggle_Link" + t, bm, M_steel, lk, bevel=0.2)
    out["link"], out["link_pivot"] = link, lk
    # --- Catch on the lid: mounting plate, two bored ears, stirrup pin C
    bm = bmesh.new()
    plate(bm, 'xz', (0, -1.5, ZC0), 46, 21.4, 6, 3.0)
    for s in (-1, 1):
        tube_x(bm, (s * 15.75, -A_D, ZC0), 5.8, 2.5, 2.5, 20)
        box(bm, (s * 15.75, -3.5, ZC0), (2.5, 2.2, 11.0))                       # web: plate -> ear, clear of the bore
    cat = new_obj("Catch" + t, bm, M_mech, lid_parent, lid_offset, bevel=0.25)
    bm = bmesh.new()
    cyl_x(bm, (0, -A_D, ZC0), 2.3, 34.5, 20)
    pin_c = new_obj("Catch_Pin" + t, bm, M_steel, lid_parent, lid_offset, bevel=0.2)
    out["catch"], out["catch_pin"] = cat, pin_c
    # --- Safety_Lock: a spring-loaded gate that stands in front of the lever's pull tab
    GY, GZ = -(A_D + 12.25), -56.0
    bm = bmesh.new()
    for s in (-1, 1):
        tube_x(bm, (s * 24.0, GY, GZ), 4.2, 1.8, 2.5, 20)
        box(bm, (s * 24.0, -(2.0 + abs(GY) - 4.4) / 2, GZ - 1.0), (2.5, abs(GY) - 4.4 - 2.0, 6.0))
    out["gate_bracket"] = new_obj("Safety_Bracket" + t, bm, M_mech, frame, bevel=0.2)
    bm = bmesh.new()
    cyl_x(bm, (0, GY, GZ), 1.6, 53.0, 16)
    out["gate_pin"] = new_obj("Safety_Pin" + t, bm, M_steel, frame, bevel=0.15)
    gp = empty("Safety_Pivot" + t, frame, (0, GY, GZ), 3)
    bm = bmesh.new()
    plate(bm, 'xz', (0, 0, 12.8), 42.0, 20.0, 3.0, 2.5, soft=0.4)
    tube_x(bm, (0, 0, 0), 3.2, 1.8, 42.0, 20)
    out["gate"] = new_obj("Safety_Lock" + t, bm, M_mech, gp, bevel=0.2)
    out["gate_pivot"] = gp
    # rotation limits (mechanical stops)
    for obj, lo, hi in ((lp, -THETA_OPEN, 0.0), (gp, 0.0, SAFE_OPEN), (lk, -10.0, 190.0)):
        c = obj.constraints.new('LIMIT_ROTATION')
        c.use_limit_x = True
        c.min_x, c.max_x = math.radians(lo), math.radians(hi)
        c.owner_space = 'LOCAL'
    return out


def path_tube(bm, pts, r, seg=8):
    rings = []
    for i, p in enumerate(pts):
        q = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        T = q.normalized()
        a_ = Vector((1, 0, 0)) if abs(T.x) < 0.9 else Vector((0, 1, 0))
        N = T.cross(a_).normalized()
        B = T.cross(N).normalized()
        rings.append([bm.verts.new(p + N * r * math.cos(2 * math.pi * k / seg) + B * r * math.sin(2 * math.pi * k / seg)) for k in range(seg)])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(seg):
            bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])


# ----------------------------------------------------------------------------- animation (keys + drivers)
def sm(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def theta_of(f):
    """lever angle: open until 55, swings to the engage angle by 65, holds, then closes through dead centre"""
    if f <= 55:
        return THETA_OPEN
    if f <= 65:
        return THETA_OPEN + (THETA_ENGAGE - THETA_OPEN) * sm((f - 55) / 10)
    if f <= 75:
        return THETA_ENGAGE
    if f <= 85:
        return THETA_ENGAGE + (THETA_DEAD - THETA_ENGAGE) * sm((f - 75) / 10)
    if f <= 95:
        return THETA_DEAD * (1 - sm((f - 85) / 10))
    return 0.0


def alpha_of(f, th):
    """world angle of the link: hangs free until it reaches the pin at frame 65, then follows the linkage"""
    bd, bz, _ = link_state(th)
    rz = min(max(rise(th) if rise(th) is not None else PROTRUDE, 0.0), PROTRUDE)
    hooked = math.atan2(A_D - bd, ZC0 + rz - bz)
    eng = link_state(THETA_ENGAGE)
    eng_a = math.atan2(A_D - eng[0], ZC0 + PROTRUDE - eng[1])
    hang = math.radians(165)
    if f < 55:
        return hang
    if f < 65:
        return hang + (eng_a - hang) * sm((f - 55) / 10)
    return hooked


def gate_of(f):
    if f <= 98:
        return SAFE_OPEN
    if f <= 110:
        u = sm((f - 98) / 12)
        return SAFE_OPEN * (1 - u) - 3.0 * math.sin(math.pi * u) * (1 - u)       # small overshoot = the snap
    return 0.0


def lid_angle(f):
    return 75.0 * (1 - sm((f - 20) / 25)) if f > 20 else 75.0


def add_driver(target, path, index, expr, var_obj, var_path, var_index=0):
    fc = target.driver_add(path, index)
    d = fc.driver
    d.type = 'SCRIPTED'
    v = d.variables.new()
    v.name = "v"
    v.type = 'SINGLE_PROP'
    v.targets[0].id = var_obj
    v.targets[0].data_path = f"{var_path}[{var_index}]"
    d.expression = expr


def animate(unit):
    """unit: dict(lid_pivot, lid_seat, gasket_key, latches=[out dicts])"""
    lp0 = unit["latches"][0]
    for f in range(1, FRAMES + 1):
        th = theta_of(f)
        for L in unit["latches"]:
            L["lever_pivot"].rotation_euler[0] = -math.radians(th)
            L["lever_pivot"].keyframe_insert("rotation_euler", index=0, frame=f)
            L["link_pivot"].rotation_euler[0] = alpha_of(f, th) + math.radians(th)
            L["link_pivot"].keyframe_insert("rotation_euler", index=0, frame=f)
            L["gate_pivot"].rotation_euler[0] = math.radians(gate_of(f))
            L["gate_pivot"].keyframe_insert("rotation_euler", index=0, frame=f)
        unit["lid_pivot"].rotation_euler[0] = -math.radians(lid_angle(f))
        unit["lid_pivot"].keyframe_insert("rotation_euler", index=0, frame=f)
    for o in [unit["lid_pivot"]] + [L[k] for L in unit["latches"] for k in ("lever_pivot", "link_pivot", "gate_pivot")]:
        act = o.animation_data.action
        try:
            fcs = list(act.fcurves)
        except Exception:
            fcs = [fc for l in act.layers for s in l.strips for b in s.channelbags for fc in b.fcurves]
        for fc in fcs:
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
    # lid height: a DRIVER of the lever angle (linkage formula); gasket squeeze: a DRIVER of the lid height
    e, h = B_OFF
    dd = f"(({h})*sin(-v)-({e})*cos(-v))"
    expr = (f"0.001*min({PROTRUDE}, max(0, ({A_Z}+({e})*sin(-v)+({h})*cos(-v))"
            f"+sqrt({LINK_L}*{LINK_L}-{dd}*{dd})-({ZC0})))")
    add_driver(unit["lid_seat"], "location", 2, expr, lp0["lever_pivot"], "rotation_euler", 0)
    key_data = unit["gasket"].data.shape_keys
    fc = key_data.driver_add('key_blocks["Squeezed"].value')
    d = fc.driver
    d.type = 'SCRIPTED'
    var = d.variables.new()
    var.name = "v"
    var.type = 'SINGLE_PROP'
    var.targets[0].id = unit["lid_seat"]
    var.targets[0].data_path = "location[2]"
    d.expression = f"({PROTRUDE}*0.001-v)/({PROTRUDE}*0.001)"



# ----------------------------------------------------------------------------- contents: 10 x 5 test tubes
TUBE_D, TUBE_L = 19.6, 150.0
NX, NY, PX, PY = 10, 5, 31.5, 40.0


def build_contents(mats, glass_mat, tray_mat, rubber_mat, parent=None):
    """tray with a cell grid, rubber pads under the tubes, a rubber grip plate over the dividers and 50 tubes standing in it"""
    z_f = -H_BODY + 4.0                       # top of the body floor
    base_t, div_h, plate_t, pad_t = 6.0, 100.0, 6.0, 2.0
    Wt, Dt = NX * PX, NY * PY
    root = empty("Case_Contents", parent, (0, 0, 0), 8)
    # tray: base plate + dividers (one mesh)
    bm = bmesh.new()
    box(bm, (0, 0, z_f + base_t / 2), (Wt + 2.0, Dt + 2.0, base_t))
    for i in range(NX + 1):
        box(bm, (-Wt / 2 + i * PX, 0, z_f + base_t + div_h / 2), (2.0, Dt + 2.0, div_h))
    for j in range(NY + 1):
        box(bm, (0, -Dt / 2 + j * PY, z_f + base_t + div_h / 2), (Wt + 2.0, 2.0, div_h))
    new_obj("Tube_Tray", bm, tray_mat, root, bevel=0.4)
    # rubber pads (tube seat) and grip plate with 20.4 mm holes
    centres = [(-Wt / 2 + PX * (i + 0.5), -Dt / 2 + PY * (j + 0.5)) for j in range(NY) for i in range(NX)]
    bm = bmesh.new()
    for x, y in centres:
        rings = [[bm.verts.new((x + 11.0 * math.cos(2 * math.pi * k / 24), y + 11.0 * math.sin(2 * math.pi * k / 24), z)) for k in range(24)] for z in (z_f + base_t, z_f + base_t + pad_t - 0.1)]
        for k in range(24):
            bm.faces.new((rings[0][k], rings[0][(k + 1) % 24], rings[1][(k + 1) % 24], rings[1][k]))
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[1])
    new_obj("Tube_Pads", bm, rubber_mat, root)
    zp0 = z_f + base_t + div_h + 0.1
    bm = bmesh.new()
    plate(bm, 'xz', (0, 0, 0), 1, 1, 0.5, 0.1)     # placeholder, replaced below
    bm.free()
    bm = bmesh.new()
    box(bm, (0, 0, zp0 + plate_t / 2), (Wt, Dt, plate_t))
    grip = new_obj("Tube_Grip_Plate", bm, rubber_mat, root, bevel=0.4)
    cb = bmesh.new()
    for x, y in centres:
        rings = [[cb.verts.new((x + 10.2 * math.cos(2 * math.pi * k / 24), y + 10.2 * math.sin(2 * math.pi * k / 24), z)) for k in range(24)] for z in (zp0 - 1.0, zp0 + plate_t + 1.0)]
        for k in range(24):
            cb.faces.new((rings[0][k], rings[0][(k + 1) % 24], rings[1][(k + 1) % 24], rings[1][k]))
        cb.faces.new(rings[0][::-1])
        cb.faces.new(rings[1])
    cut = new_obj("cutter", cb)
    boolean_bake(grip, cut)
    bpy.data.objects.remove(cut)
    # one tube mesh (round bottom, rolled rim) instanced 50 times
    r = TUBE_D / 2
    prof = [(0.0, 0.0)]
    for k in range(1, 9):
        a = math.radians(90 * k / 8)
        prof.append((r * math.sin(a), r - r * math.cos(a)))
    prof += [(r, TUBE_L - 1.2), (r + 0.9, TUBE_L - 0.6), (r + 0.9, TUBE_L), (r - 0.2, TUBE_L)]
    bm = bmesh.new()
    rings = []
    for rr_, z in prof:
        if rr_ < 1e-6:
            rings.append([bm.verts.new((0, 0, z))] * 32)
        else:
            rings.append([bm.verts.new((rr_ * math.cos(2 * math.pi * i / 32), rr_ * math.sin(2 * math.pi * i / 32), z)) for i in range(32)])
    for a, b in zip(rings, rings[1:]):
        for i in range(32):
            q = []
            for v in (a[i], a[(i + 1) % 32], b[(i + 1) % 32], b[i]):
                if v not in q:
                    q.append(v)
            if len(q) >= 3:
                bm.faces.new(q)
    tube = new_obj("Test_Tube", bm, glass_mat, root, (centres[0][0], centres[0][1], z_f + base_t + pad_t))
    for n, (x, y) in enumerate(centres[1:], start=1):
        t = tube.copy()
        t.name = f"Test_Tube.{n:02d}"
        bpy.context.collection.objects.link(t)
        t.parent = root
        t.location = Vector((x, y, z_f + base_t + pad_t)) * MM
    return root


# ----------------------------------------------------------------------------- folding handle sunk into the lid
def ring_xy(bm, outer, inner, z0, z1):
    n = len(outer)
    L = [[bm.verts.new((x, y, z)) for x, y in pts] for pts, z in ((outer, z0), (outer, z1), (inner, z1), (inner, z0))]
    for a, b in zip(L, L[1:] + L[:1]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))


def cyl_z(bm, c, r, z0, z1, seg=20):
    rings = [[bm.verts.new((c[0] + r * math.cos(2 * math.pi * i / seg), c[1] + r * math.sin(2 * math.pi * i / seg), z)) for i in range(seg)] for z in (z0, z1)]
    a, b = rings
    for i in range(seg):
        bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]))
    bm.faces.new(a[::-1])
    bm.faces.new(b)


def oval_x(bm, x0, x1, cy, cz, ry, rz, seg=28):
    rings = [[bm.verts.new((x, cy + ry * math.cos(2 * math.pi * i / seg), cz + rz * math.sin(2 * math.pi * i / seg))) for i in range(seg)] for x in (x0, x1)]
    a, b = rings
    for i in range(seg):
        bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]))
    bm.faces.new(a[::-1])
    bm.faces.new(b)


def hole_cut(obj, cutter_bm):
    cut = new_obj("cutter", cutter_bm)
    boolean_bake(obj, cut)
    bpy.data.objects.remove(cut)


def build_handle(mats, lid, seat):
    """Folding carry handle: two arms on two pivot pins, a grip between them, all sunk in a sealed recess of the lid.
       Load path:  Handle_Grip -> Handle_Arms -> Pivot_Pins -> Mounting_Brackets -> recess floor / flange ->
                   (gasket sealed) Reinforcement_Plate -> lid top skin.  Nothing connects the outside with the case interior:
                   the pins are blind (they end in the bracket cheeks), the recess is a closed tub, the flange is gasketed."""
    M_alu, M_mech, M_steel, M_rubber = mats
    HYL = D / 2 + 6.0
    LID_LOC = (0.0, -HYL, -2.0)              # meshes below are in case coordinates; their parent (the seat) sits at (0, HY, 2)
    ZT = H_LID                               # lid top surface
    ZP, YP, XP = ZT - 8.0, 34.0, 90.0        # pivot height / position of the two pins
    ZF = ZT - 22.0                           # recess floor (22 mm deep)
    ZS = ZT - T_TOP                          # underside of the lid skin
    # --- opening in the lid skin
    cb = bmesh.new()
    prism_xy(cb, rr_pts(224.8, 108.8, 12.4), ZS - 1.0, ZT + 1.0)
    hole_cut(lid, cb)
    # --- Handle_Recess: tub (floor + walls) with a flange under the lid skin
    studs = [(sx * 116.0, sy * 25.0) for sx in (-1, 1) for sy in (-1, 1)] + [(sx * 45.0, sy * 58.0) for sx in (-1, 1) for sy in (-1, 1)]
    bm = bmesh.new()
    prism_xy(bm, rr_pts(224.0, 108.0, 12.0), ZF - 4.0, ZF)
    ring_xy(bm, rr_pts(224.0, 108.0, 12.0), rr_pts(216.0, 100.0, 8.0), ZF, ZT)
    ring_xy(bm, rr_pts(240.0, 124.0, 14.0), rr_pts(224.0, 108.0, 12.0), ZS - 7.0, ZS - 5.0)
    recess = new_obj("Handle_Recess", bm, M_alu, seat, LID_LOC, bevel=0.4)
    cb = bmesh.new()
    for x, y in studs:
        cyl_z(cb, (x, y), 2.25, ZS - 8.0, ZS - 4.0)
    hole_cut(recess, cb)
    # --- Sealing_Gasket between the flange and the reinforcement plate (bores for the studs)
    bm = bmesh.new()
    ring_xy(bm, rr_pts(240.0, 124.0, 14.0), rr_pts(228.0, 112.0, 12.0), ZS - 5.0, ZS - 3.0)
    gasket = new_obj("Sealing_Gasket", bm, M_rubber, seat, LID_LOC)
    cb = bmesh.new()
    for x, y in studs:
        cyl_z(cb, (x, y), 2.25, ZS - 6.0, ZS - 2.0)
    hole_cut(gasket, cb)
    # --- Reinforcement_Plate: steel ring under the lid skin round the opening, with welded studs and nuts under the flange
    bm = bmesh.new()
    ring_xy(bm, rr_pts(272.0, 156.0, 18.0), rr_pts(224.8, 108.8, 12.4), ZS - 3.0, ZS)
    new_obj("Reinforcement_Plate", bm, M_steel, seat, LID_LOC, bevel=0.4)
    bm = bmesh.new()
    for x, y in studs:
        cyl_z(bm, (x, y), 2.0, ZS - 7.0, ZS - 3.0)
    new_obj("Reinforcement_Studs", bm, M_steel, seat, LID_LOC, bevel=0.15)
    bm = bmesh.new()
    for x, y in studs:
        cyl_z(bm, (x, y), 3.6, ZS - 9.4, ZS - 7.0, 6)
    new_obj("Reinforcement_Nuts", bm, M_steel, seat, LID_LOC, bevel=0.2)
    # --- Mounting_Brackets: four rounded cheeks standing on the recess floor, bored for the pins
    bm = bmesh.new()
    for sx in (-1, 1):
        for xc in (81.5, 98.5):
            plate(bm, 'yz', (sx * xc, YP, (ZF + ZP + 7.5) / 2), 22.0, ZP + 7.5 - ZF, 7.0, 6.0, soft=0.4)
        box(bm, (sx * 90.0, YP, ZF + 1.0), (23.0, 22.0, 2.0))
    brackets = new_obj("Mounting_Brackets", bm, M_steel, seat, LID_LOC, bevel=0.3)
    cb = bmesh.new()
    for sx in (-1, 1):
        cyl_x(cb, (sx * 90.0, YP, ZP), 3.5, 26.0, 20)
    hole_cut(brackets, cb)
    # --- Pivot_Pins (blind: they end in the cheeks, nothing goes through the lid)
    bm = bmesh.new()
    for sx in (-1, 1):
        cyl_x(bm, (sx * 90.0, YP, ZP), 3.4, 23.0, 20)
        cyl_x(bm, (sx * 102.25, YP, ZP), 4.6, 1.5, 20)
        cyl_x(bm, (sx * 77.75, YP, ZP), 4.6, 1.5, 20)
    new_obj("Pivot_Pins", bm, M_steel, seat, LID_LOC, bevel=0.2)
    # --- Rubber_Bushings round the pins (they give the controlled resistance to turning)
    bm = bmesh.new()
    for sx in (-1, 1):
        tube_x(bm, (sx * 90.0, YP, ZP), 5.0, 3.5, 10.0, 24)
    new_obj("Rubber_Bushings", bm, M_rubber, seat, LID_LOC)
    # --- Stopper: rubber blocks on the recess back wall, the raised arms rest against them
    bm = bmesh.new()
    for sx in (-1, 1):
        box(bm, (sx * 90.0, (41.7 + 50.0) / 2, (ZP - 7.0 + ZT) / 2), (9.0, 50.0 - 41.7, ZT - ZP + 7.0))
    new_obj("Stopper", bm, M_rubber, seat, LID_LOC, bevel=0.3)
    # --- control empty + pivots (children of the seat) + arms + grip
    ctrl = empty("Handle_Control", seat, (0, 0, 0), 6)
    ctrl["working"] = 0.0
    pivots = []
    for tag, sx in (("L", -1), ("R", 1)):
        pv = empty("Handle_Pivot_" + tag, seat, (sx * XP, YP - HYL, ZP - 2.0), 5)
        bm = bmesh.new()
        tube_x(bm, (0, 0, 0), 7.5, 5.1, 10.0, 28)
        plate(bm, 'yz', (0, -36.0, 0), 60.0, 14.2, 5.0, 10.0, soft=0.5)
        new_obj("Handle_Arm_" + tag, bm, M_mech, pv, bevel=0.4)
        c = pv.constraints.new('LIMIT_ROTATION')
        c.use_limit_x = True
        c.min_x, c.max_x = -math.pi / 2, 0.0
        c.owner_space = 'LOCAL'
        fc = pv.driver_add("rotation_euler", 0)
        d = fc.driver
        d.type = 'SCRIPTED'
        v = d.variables.new()
        v.name = "w"
        v.type = 'SINGLE_PROP'
        v.targets[0].id = ctrl
        v.targets[0].data_path = '["working"]'
        d.expression = "-1.5708*w"
        pivots.append(pv)
    bm = bmesh.new()
    oval_x(bm, 5.0, 2 * XP - 5.0, -60.0, 0.0, 9.0, 7.5)
    new_obj("Handle_Grip", bm, M_rubber, pivots[0])
    # --- demonstration: FOLDED (working = 0) <-> WORKING (working = 1); frames 1 folded, 15 lifted by hand, 45 raised, 105 folded again
    for f, w in ((1, 0.0), (15, 0.0), (30, 0.5), (45, 1.0), (70, 1.0), (85, 1.0), (105, 0.0), (120, 0.0)):
        ctrl["working"] = w
        ctrl.keyframe_insert('["working"]', frame=f)
    act = ctrl.animation_data.action
    try:
        fcs = list(act.fcurves)
    except Exception:
        fcs = [fc for l in act.layers for s_ in l.strips for b in s_.channelbags for fc in b.fcurves]
    for fc in fcs:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
    return ctrl


# ----------------------------------------------------------------------------- seat for a name plate on the lid front
def build_nameplate_seat(mats, lid, seat):
    """A recess in the front wall of the lid, between the two latches, sized for a 112 x 32 mm plate
       ("ПРИЕМНИК ОТРАБОТАННЫХ РЕАКТИВОВ" goes here): rounded pocket 1.5 mm deep, four blind screw holes (the wall is 6.4 mm,
       nothing goes through), and a BLANK plate insert with a UV map, flush with the wall, ready to take a label texture.
       Names: NamePlate_Seat (the pocket is cut into Case_Lid), NamePlate_Surface (the blank plate, UV 0..1)."""
    M_alu, M_mech, M_steel, M_rubber = mats
    plate_mat = material("NamePlate_Blank", (0.90, 0.90, 0.87), 0.5, 0.0)
    HYL = D / 2 + 6.0
    LID_LOC = (0.0, -HYL, -2.0)
    yw = -D / 2                                   # outer face of the lid front wall
    zc, pw, ph, depth = 30.0, 112.0, 32.0, 1.5
    # pocket + four blind holes, cut into the lid
    cb = bmesh.new()
    pts = rr_pts(pw, ph, 4.0)
    n = len(pts)
    a = [cb.verts.new((x, yw - 1.0, zc + z)) for x, z in pts]
    b = [cb.verts.new((x, yw + depth, zc + z)) for x, z in pts]
    for i in range(n):
        cb.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    cb.faces.new(a[::-1])
    cb.faces.new(b)
    holes = [(sx * (pw / 2 - 6.0), zc + sz * (ph / 2 - 6.0)) for sx in (-1, 1) for sz in (-1, 1)]
    for hx, hz in holes:
        rings = [[cb.verts.new((hx + 1.3 * math.cos(2 * math.pi * i / 16), y, hz + 1.3 * math.sin(2 * math.pi * i / 16))) for i in range(16)] for y in (yw + depth - 0.5, yw + 5.0)]
        for i in range(16):
            cb.faces.new((rings[0][i], rings[0][(i + 1) % 16], rings[1][(i + 1) % 16], rings[1][i]))
        cb.faces.new(rings[0][::-1])
        cb.faces.new(rings[1])
    hole_cut(lid, cb)
    # blank insert, 1.2 mm thick, resting on the pocket floor, front face 0.3 mm below the wall
    bm = bmesh.new()
    plate(bm, 'xz', (0.0, yw + depth - 0.6, zc), pw - 0.8, ph - 0.8, 3.6, 1.2, soft=0.25)
    ins = new_obj("NamePlate_Surface", bm, plate_mat, seat, LID_LOC, bevel=0.1)
    cb2 = bmesh.new()
    for hx, hz in holes:                                         # the insert carries the same four mounting holes
        rings = [[cb2.verts.new((hx + 1.5 * math.cos(2 * math.pi * i / 16), y, hz + 1.5 * math.sin(2 * math.pi * i / 16))) for i in range(16)] for y in (yw - 1.0, yw + depth + 1.0)]
        for i in range(16):
            cb2.faces.new((rings[0][i], rings[0][(i + 1) % 16], rings[1][(i + 1) % 16], rings[1][i]))
        cb2.faces.new(rings[0][::-1])
        cb2.faces.new(rings[1])
    hole_cut(ins, cb2)
    uv = ins.data.uv_layers.new(name="Label")
    w_, h_ = pw - 0.8, ph - 0.8
    for loop in ins.data.loops:
        v = ins.data.vertices[loop.vertex_index].co / MM
        uv.data[loop.index].uv = ((v.x + w_ / 2) / w_, (v.z - zc + h_ / 2) / h_)
    return ins


# ----------------------------------------------------------------------------- the case
def build_case(mats):
    M_alu, M_mech, M_steel, M_rubber = mats
    path = rr_pts(W, D, R, 12)
    normals = outward_normals(path)
    # body
    bm = bmesh.new()
    for d0, d1, z0, z1 in ((0, GROOVE_D[0], -H_BODY + 4, 0), (GROOVE_D[0], GROOVE_D[1], -H_BODY + 4, -GROOVE_Z), (GROOVE_D[1], 6.4, -H_BODY + 4, 0),
                           (6.4, 9.8, -6.0, 0.0), (7.4, 9.8, 0.0, 4.0)):
        sweep(bm, path, normals, strip(d0, d1, z0, z1), True)
    prism_xy(bm, path, -H_BODY, -H_BODY + 4)
    body = new_obj("Case_Body", bm, M_alu, None, bevel=0.5)
    # lid hierarchy: hinge pivot -> seat (vertical squeeze) -> lid parts
    HY = D / 2 + 6.0
    lid_pivot = empty("Lid_Pivot", None, (0, HY, 2.0), 8)
    seat = empty("Lid_Seat", lid_pivot, (0, 0, 0), 8)
    bm = bmesh.new()
    for d0, d1, z0, z1 in ((0, 6.4, 0, H_LID - T_TOP), (6.4, 10.8, 5.0, H_LID - T_TOP), (10.8, 14.8, 0, H_LID - T_TOP)):
        sweep(bm, path, normals, strip(d0, d1, z0, z1), True)
    prism_xy(bm, path, H_LID - T_TOP, H_LID)
    lid = new_obj("Case_Lid", bm, M_alu, seat, (0, -HY, -2.0), bevel=0.5)
    # gasket (child of the seat so it travels with the lid, sitting in the body groove)
    gasket, key = make_gasket("Rubber_Gasket", path, normals, True, M_rubber, None, (0, 0, 0))
    # hinges: barrels on the lid pivot axis, leaves on both back walls, arms bridging wall -> axis
    bm = bmesh.new()
    for sx in (-1, 1):
        cyl_x(bm, (sx * 110, 0, 0), 5.0, 40.0, 24)
    new_obj("Hinge_Barrels", bm, M_steel, lid_pivot, (0, 0, 0), bevel=0.3)
    bm = bmesh.new()
    for sx in (-1, 1):
        plate(bm, 'xz', (sx * 110, D / 2 + 1.5, -12.0), 40, 26, 4, 3.0)
        box(bm, (sx * 110, (D / 2 + 3.0 + HY) / 2, -2.0), (40.0, HY - D / 2 - 3.0 - 4.0 + 4.0, 5.0))
    new_obj("Hinge_Leaf_Body", bm, M_mech, None, (0, 0, 0), bevel=0.3)
    bm = bmesh.new()
    for sx in (-1, 1):
        plate(bm, 'xz', (sx * 110, D / 2 + 1.5, 18.0), 40, 26, 4, 3.0)
    new_obj("Hinge_Leaf_Lid", bm, M_mech, seat, (0, -HY, -2.0), bevel=0.3)
    # latches on the front wall
    latches = []
    for i, x in enumerate(LATCH_X):
        tag = "" if i == 0 else f".{i}"
        frame = empty("Latch_Frame" + tag, None, (x, -D / 2, 0), 6)
        latches.append(build_latch(tag, frame, seat, (x, -D / 2 - HY, -2.0), mats))
        latches[-1]["frame"] = frame
    # fix: catch parts are children of the lid seat; their local origin is the seat origin
    unit = dict(lid_pivot=lid_pivot, lid_seat=seat, gasket_key=key, latches=latches, body=body, lid=lid, gasket=gasket)
    return unit


def build_test_section(mats, x0):
    """a 4x scale cutaway of one latch zone: straight wall / lid / gasket segments, same latch builder, same animation"""
    M_alu, M_mech, M_steel, M_rubber = mats
    S = 4.0
    root = empty("Test_Rig.T", None, (x0, 0, 0), 20)
    root.scale = (S, S, S)
    n = 14
    path = [(-45.0 + 90.0 * i / n, 0.0) for i in range(n + 1)]
    normals = [(0.0, -1.0)] * (n + 1)
    # body wall segment (walls only down to -40, plus a floor tongue)
    bm = bmesh.new()
    for d0, d1, z0, z1 in ((0, GROOVE_D[0], -40, 0), (GROOVE_D[0], GROOVE_D[1], -40, -GROOVE_Z), (GROOVE_D[1], 6.4, -40, 0), (6.4, 9.8, -6.0, 0.0), (7.4, 9.8, 0.0, 4.0)):
        sweep(bm, path, normals, strip(d0, d1, z0, z1), False)
    sweep(bm, path, normals, strip(0, 30, -44, -40), False)
    body = new_obj("Case_Body.T", bm, M_alu, root, bevel=0.5)
    HY = 240.0
    lid_pivot = empty("Lid_Pivot.T", root, (0, HY, 2.0), 8)
    seat = empty("Lid_Seat.T", lid_pivot, (0, 0, 0), 8)
    bm = bmesh.new()
    for d0, d1, z0, z1 in ((0, 6.4, 0, H_LID - T_TOP), (6.4, 10.8, 5.0, H_LID - T_TOP), (10.8, 14.8, 0, H_LID - T_TOP)):
        sweep(bm, path, normals, strip(d0, d1, z0, z1), False)
    sweep(bm, path, normals, strip(0, 60, H_LID - T_TOP, H_LID), False)
    lid = new_obj("Case_Lid.T", bm, M_alu, seat, (0, -HY, -2.0), bevel=0.5)
    gasket, key = make_gasket("Rubber_Gasket.T", path, normals, False, M_rubber, root, (0, 0, 0))
    frame = empty("Latch_Frame.T", root, (0, 0, 0), 6)
    L = build_latch(".T", frame, seat, (0, -HY, -2.0), mats)
    L["frame"] = frame
    return dict(lid_pivot=lid_pivot, lid_seat=seat, gasket_key=key, latches=[L], body=body, lid=lid, gasket=gasket, root=root)


def section_cut(unit_objs, x_world):
    """live Boolean cut through the latch centre plane (everything at x > x_world is removed) on every mesh of the test rig.
       Look at it from +X to see the cut face."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    me = bpy.data.meshes.new("Section_Cutter")
    bm.to_mesh(me)
    bm.free()
    c = bpy.data.objects.new("Section_Cutter", me)
    bpy.context.collection.objects.link(c)
    c.location = (x_world + 1.0, 0, 0)
    c.scale = (2.0, 4.0, 4.0)
    c.display_type = 'WIRE'
    c.hide_render = True
    for o in unit_objs:
        if o.type == 'MESH':
            m = o.modifiers.new("Section", 'BOOLEAN')
            m.object = c
            m.operation = 'DIFFERENCE'
            m.solver = 'EXACT'
    return c


def build():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for blk in (bpy.data.meshes, bpy.data.materials):
        for it in list(blk):
            blk.remove(it)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.frame_start, sc.frame_end = 1, FRAMES
    sc.render.fps = 24
    glass = material("Lab_Glass", (0.85, 0.93, 0.95), 0.06, 0.0)
    glass.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.3
    tray = material("Tray_Polypropylene", (0.78, 0.80, 0.82), 0.55, 0.0)
    mats = (material("Anodised_Aluminium", (0.07, 0.08, 0.10), 0.42, 0.85),
            material("Matte_Metal", (0.45, 0.47, 0.50), 0.45, 1.0),
            material("Stainless_Steel", (0.72, 0.73, 0.75), 0.28, 1.0),
            material("Black_Rubber", (0.015, 0.015, 0.017), 0.85, 0.0))
    case = build_case(mats)
    build_contents(mats, glass, tray, mats[3])
    build_handle(mats, case["lid"], case["lid_seat"])
    build_nameplate_seat(mats, case["lid"], case["lid_seat"])
    rig = build_test_section(mats, 620.0)         # mm: 620 mm beside the case (x), 4x scale
    for u in (case, rig):
        animate(u)
    sc.frame_set(1)
    return case, rig


if __name__ == "__main__":
    build()
