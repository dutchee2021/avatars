"""
Trading Card Slab - procedural Blender model (Blender 4.2+, tested on 5.0).

Builds a graded-card style slab (clear acrylic case, frosted inner holder,
a swappable card and a swappable label), then exports `slab.glb` and saves
`slab.blend` next to this script.

Run headless:
    blender -b -P build_slab.py
    blender -b -P build_slab.py -- --card-front ~/my_card.jpg --label-front ~/my_label.png --glb ~/my_slab.glb
Or open this file in Blender's Text Editor and press "Run Script".

Every image is read from ./textures by default:
    card_front.jpg   2.5 x 3.5 in card, portrait (e.g. 1000 x 1400 px)
    card_back.jpg    same size, shown on the back of the slab
    label_front.png  69.2 x 20.6 mm label (e.g. 2048 x 610 px)
    label_back.png   same size, shown on the back of the slab

Dimensions below are millimetres. The exported model is in metres (glTF
standard), standing upright, front facing +Z in glTF (-Y in Blender).
"""

import argparse
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix

# --------------------------------------------------------------- dimensions (mm)
SLAB_W, SLAB_H, SLAB_T = 80.0, 135.5, 6.0
CASE_CORNER_R = 2.6        # plan-view corner radius of the case
CASE_EDGE_R = 0.6          # fillet on the front/back perimeter edges
SEAM_W, SEAM_D = 0.35, 0.2  # groove where the two case halves meet
RIM_SIDE, RIM_TOP, RIM_BOTTOM = 2.9, 2.7, 3.4  # raised border widths
RIM_STEP, RIM_STEP_DEPTH = 1.6, 0.25  # outer lip, then a ledge (incl. divider) down to the windows
WINDOW_DEPTH = 0.5         # how far the label/card windows sit below the rim
WINDOW_R = 1.2
DIVIDER_Y = (37.0, 39.0)   # raised bar between the label and card windows

CARD_W, CARD_H, CARD_T, CARD_R = 63.5, 88.9, 0.4, 1.0  # standard 2.5 x 3.5 in
CARD_CY = -13.5
LABEL_W, LABEL_H, LABEL_T, LABEL_R = 69.2, 20.6, 0.25, 0.4
LABEL_CY = 52.0

HOLDER_HW, HOLDER_HH, HOLDER_T, HOLDER_R = 38.7, 66.9, 2.0, 2.0
POCKET_DEPTH = 0.3
CARD_POCKET = (35.3, -62.6, 32.8)   # half width, bottom y, top y
LABEL_POCKET = (36.4, 40.0, 63.9)
CARD_GAP, LABEL_GAP = 0.5, 0.25     # clearance around the card / label
CAVITY_GAP = 0.2                    # air gap between the holder and the case
FROST_TILE = 10.0                   # mm per repeat of the frosted texture

SEG = 12                            # segments per rounded corner
TO_BLENDER = Matrix.Rotation(math.radians(90), 4, "X") @ Matrix.Scale(0.001, 4)


def script_dir():
    f = globals().get("__file__", "")
    if f and os.path.isfile(f):
        return os.path.dirname(os.path.abspath(f))
    if bpy.data.filepath:
        return os.path.dirname(bpy.data.filepath)
    return os.getcwd()


HERE = script_dir()
TEX = os.path.join(HERE, "textures")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description="Build the trading card slab model.")
    p.add_argument("--card-front", default=os.path.join(TEX, "card_front.jpg"))
    p.add_argument("--card-back", default=os.path.join(TEX, "card_back.jpg"))
    p.add_argument("--label-front", default=os.path.join(TEX, "label_front.png"))
    p.add_argument("--label-back", default=os.path.join(TEX, "label_back.png"))
    p.add_argument("--glb", default=os.path.join(HERE, "slab.glb"), help="GLB output path ('' to skip)")
    p.add_argument("--blend", default=os.path.join(HERE, "slab.blend"), help=".blend output path ('' to skip)")
    p.add_argument("--render", default="", help="optional PNG path for a Cycles preview render")
    p.add_argument("--samples", type=int, default=96)
    return p.parse_args(argv)


# --------------------------------------------------------------------- scene
def reset_scene(factory):
    if factory:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        return
    # Running inside an open Blender session: only remove what we built before.
    for name in ("Slab", "Studio"):
        coll = bpy.data.collections.get(name)
        if coll:
            for obj in list(coll.objects):
                bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.collections.remove(coll)
    bpy.data.orphans_purge(do_recursive=True)


def new_collection(name):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


# ------------------------------------------------------------------ geometry
def rrect(hw, hh, r, cx=0.0, cy=0.0):
    """Rounded rectangle outline (counter-clockwise seen from +Z)."""
    r = min(r, hw, hh)
    pts = []
    for ox, oy, a0 in ((hw - r, -hh + r, -90), (hw - r, hh - r, 0),
                       (-hw + r, hh - r, 90), (-hw + r, -hh + r, 180)):
        for i in range(SEG + 1):
            a = math.radians(a0 + 90.0 * i / SEG)
            pts.append((cx + ox + r * math.cos(a), cy + oy + r * math.sin(a)))
    return pts


def rrect_span(hw, y0, y1, r):
    return rrect(hw, (y1 - y0) / 2, r, 0.0, (y0 + y1) / 2)


def loft(bm, rings):
    """Skin closed rings (list of (points, z), bottom to top) and cap both ends."""
    vrings = [[bm.verts.new((x, y, z)) for x, y in pts] for pts, z in rings]
    sides = []
    for a, b in zip(vrings, vrings[1:]):
        n = len(a)
        for i in range(n):
            j = (i + 1) % n
            sides.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    bottom = bm.faces.new(list(reversed(vrings[0])))
    top = bm.faces.new(vrings[-1])
    return sides, bottom, top


def prism(bm, pts, z0, z1):
    return loft(bm, [(pts, z0), (pts, z1)])


def mesh_object(bm, name, coll, materials=()):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in materials:
        me.materials.append(m)
    obj = bpy.data.objects.new(name, me)
    coll.objects.link(obj)
    return obj


def apply_modifiers(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    bpy.data.meshes.remove(old)


def cut(obj, cutters, coll):
    """Boolean-subtract closed, non-overlapping solids given as point outlines + z ranges."""
    bm = bmesh.new()
    for pts, z0, z1 in cutters:
        prism(bm, pts, z0, z1)
    tool = mesh_object(bm, obj.name + "_cutter", coll)
    mod = obj.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = tool
    apply_modifiers(obj)
    tool_mesh = tool.data
    bpy.data.objects.remove(tool, do_unlink=True)
    bpy.data.meshes.remove(tool_mesh)


def finish(obj, smooth_angle=35.0, bevel_mm=0.0, bevel_segments=3):
    """Move from the mm design frame into Blender metres, shade smooth with sharp
    corners, then optionally round the sharp edges with a small bevel. The bevel
    hardens normals so big flat faces (the windows) stay perfectly flat."""
    me = obj.data
    me.name = obj.name
    me.transform(TO_BLENDER)
    for poly in me.polygons:
        poly.material_index = min(poly.material_index, len(me.materials) - 1)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    if bevel_mm:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel_mm * 0.001
        mod.segments = bevel_segments
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(40.0)
        mod.harden_normals = True
        apply_modifiers(obj)
        obj.data.name = obj.name


def set_planar_uvs(obj, tile):
    """Box-project UVs (in mm / tile) so the frosted texture repeats evenly."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        for loop in f.loops:
            x, y, z = loop.vert.co
            if abs(n.z) >= max(abs(n.x), abs(n.y)):
                loop[uv].uv = (x / tile, y / tile)
            elif abs(n.x) > abs(n.y):
                loop[uv].uv = (y / tile, z / tile)
            else:
                loop[uv].uv = (x / tile, z / tile)
    bm.to_mesh(obj.data)
    bm.free()


def build_case(coll, mats):
    """Clear outer case: rounded slab with filleted edges, a seam groove,
    recessed label/card windows on both faces (leaving a raised rim + divider)
    and an internal cavity for the holder."""
    R, T, n = CASE_EDGE_R, SLAB_T, 8
    profile = []  # (inset from outline, z), bottom face edge -> top face edge
    for i in range(n + 1):
        a = math.radians(90.0 * i / n)
        profile.append((R - R * math.sin(a), -T / 2 + R - R * math.cos(a)))
    profile += [(0.0, -SEAM_W / 2), (SEAM_D, -SEAM_W / 2), (SEAM_D, SEAM_W / 2), (0.0, SEAM_W / 2)]
    for i in range(n + 1):
        a = math.radians(90.0 * i / n)
        profile.append((R - R * math.cos(a), T / 2 - R + R * math.sin(a)))
    rings = [(rrect(SLAB_W / 2 - d, SLAB_H / 2 - d, CASE_CORNER_R - d), z) for d, z in profile]

    bm = bmesh.new()
    sides, _, _ = loft(bm, rings)
    bm.normal_update()
    for f in sides:  # outer walls get the satin edge material
        if abs(f.normal.z) < 0.5:
            f.material_index = 1
    case = mesh_object(bm, "Case", coll, mats)

    deep = T / 2 + 1.0
    ledge = rrect(SLAB_W / 2 - RIM_STEP, SLAB_H / 2 - RIM_STEP, CASE_CORNER_R - RIM_STEP + 0.4)
    top = T / 2 - RIM_STEP_DEPTH
    cut(case, [(ledge, top, deep), (ledge, -deep, -top)], coll)
    win_hw = SLAB_W / 2 - RIM_SIDE
    label_win = rrect_span(win_hw, DIVIDER_Y[1], SLAB_H / 2 - RIM_TOP, WINDOW_R)
    card_win = rrect_span(win_hw, -SLAB_H / 2 + RIM_BOTTOM, DIVIDER_Y[0], WINDOW_R)
    top = T / 2 - WINDOW_DEPTH
    cut(case, [(label_win, top, deep), (card_win, top, deep),
               (label_win, -deep, -top), (card_win, -deep, -top)], coll)
    # Hollow inside like the real thing: the holder sits in an air gap. (A solid
    # block traps light from the holder by total internal reflection and fogs the card.)
    g = CAVITY_GAP
    cavity = rrect(HOLDER_HW + g, HOLDER_HH + g, HOLDER_R + g)
    cut(case, [(cavity, -HOLDER_T / 2 - g / 2, HOLDER_T / 2 + g / 2)], coll)
    finish(case, bevel_mm=0.22)
    return case


def build_holder(coll, mat):
    """Frosted inner holder with pockets and through-holes for the card and label."""
    bm = bmesh.new()
    prism(bm, rrect(HOLDER_HW, HOLDER_HH, HOLDER_R), -HOLDER_T / 2, HOLDER_T / 2)
    holder = mesh_object(bm, "Holder", coll, [mat])

    t, d = HOLDER_T / 2, HOLDER_T / 2 + 1.0
    card_pocket = rrect_span(CARD_POCKET[0], CARD_POCKET[1], CARD_POCKET[2], 1.0)
    label_pocket = rrect_span(LABEL_POCKET[0], LABEL_POCKET[1], LABEL_POCKET[2], 0.8)
    cut(holder, [(card_pocket, t - POCKET_DEPTH, d), (label_pocket, t - POCKET_DEPTH, d),
                 (card_pocket, -d, -t + POCKET_DEPTH), (label_pocket, -d, -t + POCKET_DEPTH)], coll)

    card_hole = rrect(CARD_W / 2 + CARD_GAP, CARD_H / 2 + CARD_GAP, CARD_R + CARD_GAP, 0.0, CARD_CY)
    label_hole = rrect(LABEL_W / 2 + LABEL_GAP, LABEL_H / 2 + LABEL_GAP, LABEL_R + LABEL_GAP, 0.0, LABEL_CY)
    cut(holder, [(card_hole, -d, d), (label_hole, -d, d)], coll)
    set_planar_uvs(holder, FROST_TILE)
    finish(holder, bevel_mm=0.12, bevel_segments=2)
    return holder


def build_insert(name, coll, w, h, t, r, cy, mats):
    """Thin double-sided panel: face 0 = front image, 1 = back image, 2 = edge."""
    x0, y0 = -w / 2, cy - h / 2
    bm = bmesh.new()
    sides, back, front = prism(bm, rrect(w / 2, h / 2, r, 0.0, cy), -t / 2, t / 2)
    uv = bm.loops.layers.uv.verify()
    for loop in front.loops:
        x, y, _ = loop.vert.co
        loop[uv].uv = ((x - x0) / w, (y - y0) / h)
    for loop in back.loops:  # mirrored so the back image reads correctly from behind
        x, y, _ = loop.vert.co
        loop[uv].uv = (1.0 - (x - x0) / w, (y - y0) / h)
    front.material_index, back.material_index = 0, 1
    for f in sides:
        f.material_index = 2
    obj = mesh_object(bm, name, coll, mats)
    finish(obj, smooth_angle=30.0)
    return obj


# ----------------------------------------------------------------- materials
def principled(name):
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    mat.use_backface_culling = True  # every part is a closed solid -> single-sided glTF
    return mat, mat.node_tree, mat.node_tree.nodes["Principled BSDF"]


def load_image(path, name, colorspace="sRGB"):
    path = os.path.expanduser(path or "")
    if path and os.path.isfile(path):
        img = bpy.data.images.load(os.path.abspath(path), check_existing=False)
    else:
        print(f"[slab] image not found: {path!r} - using a flat grey placeholder")
        img = bpy.data.images.new(name, 64, 64)
        img.generated_color = (0.75, 0.75, 0.75, 1.0)
    img.name = name
    img.colorspace_settings.name = colorspace
    return img


def image_material(name, path, roughness):
    mat, nt, bsdf = principled(name)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.location = (-400, 250)
    tex.image = load_image(path, os.path.splitext(os.path.basename(path))[0] or name)
    tex.extension = "CLIP"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def clear_material(name="Slab_Clear", roughness=0.03):
    mat, _, bsdf = principled(name)
    bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["IOR"].default_value = 1.49  # acrylic
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    if hasattr(mat, "use_raytrace_refraction"):
        mat.use_raytrace_refraction = True  # EEVEE viewport
    return mat


def frost_textures():
    """Tileable stipple texture for the frosted holder (generated once, then reused)."""
    color_path = os.path.join(TEX, "frost_color.png")
    normal_path = os.path.join(TEX, "frost_normal.png")
    if not (os.path.isfile(color_path) and os.path.isfile(normal_path)):
        n = 512
        rng = np.random.default_rng(7)
        f = np.fft.fftfreq(n)
        fx, fy = np.meshgrid(f, f)
        rad = np.sqrt((0.55 * fx) ** 2 + (1.3 * fy) ** 2)
        band = np.exp(-((rad - 0.035) / 0.025) ** 2) + 0.6 * np.exp(-((rad - 0.13) / 0.06) ** 2)
        h = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n))) * band))
        h = (h - h.mean()) / h.std()
        dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
        dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
        nrm = np.dstack([-dx * 1.4, -dy * 1.4, np.ones_like(h)])
        nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
        grey = 0.60 + 0.13 * np.tanh(h * 0.9)
        for path, rgb in ((color_path, np.dstack([grey, grey, grey])), (normal_path, nrm * 0.5 + 0.5)):
            img = bpy.data.images.new("tmp_frost", n, n, alpha=False)
            img.pixels.foreach_set(np.dstack([rgb, np.ones((n, n))]).astype(np.float32).ravel())
            img.filepath_raw = path
            img.file_format = "PNG"
            img.save()
            bpy.data.images.remove(img)
    return color_path, normal_path


def frosted_material():
    color_path, normal_path = frost_textures()
    mat, nt, bsdf = principled("Holder_Frosted")
    col = nt.nodes.new("ShaderNodeTexImage")
    col.location = (-500, 300)
    col.image = load_image(color_path, "frost_color")
    nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    nor = nt.nodes.new("ShaderNodeTexImage")
    nor.location = (-500, -100)
    nor.image = load_image(normal_path, "frost_normal", "Non-Color")
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.location = (-220, -100)
    nmap.inputs["Strength"].default_value = 1.2
    nt.links.new(nor.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.35
    return mat


def paper_edge_material():
    mat, _, bsdf = principled("Paper_Edge")
    bsdf.inputs["Base Color"].default_value = (0.86, 0.85, 0.82, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.8
    return mat


# -------------------------------------------------------------------- studio
def setup_studio(samples):
    """Camera, lights and a black-backdrop world so F12 gives a product shot."""
    scene = bpy.context.scene
    coll = new_collection("Studio")
    try:
        import addon_utils
        addon_utils.enable("cycles", default_set=True)
    except Exception:
        pass
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = 1500
    scene.view_settings.view_transform = "Standard"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "MILLIMETERS"

    # Dark studio: black backdrop for the camera, a soft top-lit gradient for reflections.
    world = bpy.data.worlds.get("Studio") or bpy.data.worlds.new("Studio")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    coords = nt.nodes.new("ShaderNodeTexCoord")
    xyz = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[0].color = (0.02, 0.02, 0.02, 1.0)
    ramp.color_ramp.elements[1].position = 0.9
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
    remap = nt.nodes.new("ShaderNodeMapRange")  # direction z in [-1, 1] -> [0, 1]
    remap.inputs["From Min"].default_value = -1.0
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.35
    black = nt.nodes.new("ShaderNodeBackground")
    black.inputs["Color"].default_value = (0, 0, 0, 1)
    path = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(coords.outputs["Generated"], xyz.inputs["Vector"])
    nt.links.new(xyz.outputs["Z"], remap.inputs["Value"])
    nt.links.new(remap.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(bg.outputs["Background"], mix.inputs[1])
    nt.links.new(black.outputs["Background"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])

    def area(name, loc, size, energy, size_y=None):
        light = bpy.data.lights.new(name, "AREA")
        light.energy = energy
        light.shape = "RECTANGLE"
        light.size, light.size_y = size, size_y or size
        obj = bpy.data.objects.new(name, light)
        obj.location = loc
        coll.objects.link(obj)
        direction = -obj.location.normalized()
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        return obj

    area("Key", (0.02, -0.30, 0.45), 0.40, 23)
    area("Fill", (0.40, -0.20, 0.00), 0.30, 7)
    area("Top", (0.00, 0.08, 0.40), 0.05, 9, 0.40)

    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 85
    cam = bpy.data.objects.new("Camera", cam_data)
    coll.objects.link(cam)
    cam.location = (0.16, -0.40, 0.09)
    cam.rotation_euler = (-cam.location).normalized().to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    return coll


# ---------------------------------------------------------------------- main
def main(factory_reset=None):
    args = parse_args()
    reset_scene(bpy.app.background if factory_reset is None else factory_reset)
    slab = new_collection("Slab")

    clear = [clear_material(), clear_material("Slab_Edge", 0.3)]
    frosted = frosted_material()
    edge = paper_edge_material()
    card_mats = [image_material("Card_Front", args.card_front, 0.6),
                 image_material("Card_Back", args.card_back, 0.7), edge]
    label_mats = [image_material("Label_Front", args.label_front, 0.7),
                  image_material("Label_Back", args.label_back, 0.7), edge]

    root = bpy.data.objects.new("TradingCardSlab", None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.02
    slab.objects.link(root)
    parts = [
        build_case(slab, clear),
        build_holder(slab, frosted),
        build_insert("Card", slab, CARD_W, CARD_H, CARD_T, CARD_R, CARD_CY, card_mats),
        build_insert("Label", slab, LABEL_W, LABEL_H, LABEL_T, LABEL_R, LABEL_CY, label_mats),
    ]
    for obj in parts:
        obj.parent = root

    setup_studio(args.samples)

    if args.glb:
        for obj in bpy.context.scene.objects:
            obj.select_set(obj in parts or obj == root)
        bpy.ops.export_scene.gltf(
            filepath=os.path.abspath(args.glb), export_format="GLB", use_selection=True,
            export_apply=True, export_yup=True, export_cameras=False, export_lights=False,
            export_animations=False, export_image_format="AUTO", export_materials="EXPORT")
        print(f"[slab] wrote {args.glb}")
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend), relative_remap=True, compress=True)
        print(f"[slab] wrote {args.blend}")
    if args.render:
        bpy.context.scene.render.filepath = os.path.abspath(args.render)
        bpy.ops.render.render(write_still=True)
        print(f"[slab] wrote {args.render}")


if __name__ == "__main__":
    main()
