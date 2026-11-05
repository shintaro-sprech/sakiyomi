"""Builds Sakiyomi's low-poly factory models in Blender and writes them as .glb files.

    Blender --background --factory-startup --python scripts/models/build_models.py -- <out dir> [preview.png]

`npm run models` runs this and compresses the result into public/models (scripts/models/build.mjs).

Every model stands on the floor at the origin, front facing -Y (toward the viewer), in
meters. Each machine has a signal lamp with its own material named "lamp", which the app
recolors by the machine's state. The parts that move while a machine runs hang under an
empty named move_<role> at the point they move round, which the app animates by role; the
rest of a model is joined into one mesh. A preview render of all models side by side is
written when a second path is given.
"""

import math
import os
import sys
from contextlib import contextmanager

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT_DIR = argv[0] if argv else "public/models"
PREVIEW = argv[1] if len(argv) > 1 else None


def linear(hex_color):
    """sRGB hex to the linear color Blender's materials take."""
    channels = [int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels) + (1.0,)


# The app's palette: ivory machines with ink panels, clay for moving parts and warnings.
COLORS = {
    "body": ("#F0EEE6", 0.55, 0.0),
    "panel": ("#3D3D3A", 0.5, 0.0),
    "ink": ("#262624", 0.45, 0.0),
    "glass": ("#2B3440", 0.15, 0.1),
    "steel": ("#9C9A92", 0.35, 0.6),
    "clay": ("#D97757", 0.5, 0.0),
    "lamp": ("#87867F", 0.4, 0.0),
    "wood": ("#C8A273", 0.7, 0.0),
    "cardboard": ("#C69C6D", 0.8, 0.0),
}


def material(name):
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    hex_color, roughness, metallic = COLORS[name]
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = linear(hex_color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    mat.diffuse_color = linear(hex_color)
    return mat


class Model:
    """The parts of one model, parented to an empty named after it."""

    def __init__(self, name):
        self.name = name
        self.root = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(self.root)
        self.pivot = None

    @contextmanager
    def moving(self, role, at):
        """Parts made inside move together round at; the app moves them by role."""
        pivot = bpy.data.objects.new(f"move_{role}", None)
        bpy.context.scene.collection.objects.link(pivot)
        pivot.location = at
        pivot.parent = self.root
        self.pivot = pivot
        try:
            yield pivot
        finally:
            self.pivot = None

    def mark(self, name, at):
        """A point the app finds by name, such as the tip of a torch, moving with its part."""
        empty = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(empty)
        self._place(empty, at)
        return empty

    def _place(self, obj, location):
        parent = self.pivot or self.root
        obj.parent = parent
        offset = parent.location if self.pivot else (0, 0, 0)
        obj.location = tuple(value - shift for value, shift in zip(location, offset))

    def _link(self, name, bm, mat, location, rotation, bevel):
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
        for polygon in mesh.polygons:
            polygon.use_smooth = False
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.data.materials.append(material(mat))
        self._place(obj, location)
        obj.rotation_euler = rotation
        if bevel:
            modifier = obj.modifiers.new("bevel", "BEVEL")
            modifier.width = bevel
            modifier.segments = 2
            modifier.limit_method = "ANGLE"
        return obj

    def box(self, name, size, at, mat="body", bevel=0.02, rotation=(0, 0, 0)):
        """A box of size (x, y, z) whose bottom center sits at (x, y, z)."""
        sx, sy, sz = size
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for vertex in bm.verts:
            vertex.co.x *= sx
            vertex.co.y *= sy
            vertex.co.z *= sz
        bevel = min(bevel, min(size) * 0.3) if bevel else 0
        x, y, z = at
        return self._link(name, bm, mat, (x, y, z + sz / 2), rotation, bevel)

    def cylinder(self, name, radius, depth, at, mat="steel", axis="Z", segments=20, bevel=0.0):
        """A cylinder whose center sits at at, standing along axis."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius, radius2=radius, depth=depth)
        rotation = {"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0)}[axis]
        return self._link(name, bm, mat, at, rotation, bevel)

    def lamp(self, at, pole=0.35):
        """A signal tower: a pole and the lamp the app recolors."""
        x, y, z = at
        self.cylinder("lamp_pole", 0.025, pole, (x, y, z + pole / 2), "steel", segments=12)
        self.cylinder("lamp", 0.065, 0.2, (x, y, z + pole + 0.1), "lamp", segments=16, bevel=0.01)

    def objects(self):
        return [self.root, *self.root.children_recursive]


def machining_center():
    m = Model("machining_center")
    m.box("plinth", (2.2, 1.9, 0.14), (0, 0, 0), "ink")
    m.box("enclosure", (2.1, 1.8, 2.0), (0, 0, 0.14), bevel=0.06)
    m.box("roof", (2.12, 1.82, 0.08), (0, 0, 2.14), "steel")
    m.box("door", (1.1, 0.05, 1.15), (-0.25, -0.92, 0.7), "panel", bevel=0.03)
    m.box("window", (0.8, 0.04, 0.7), (-0.25, -0.95, 0.92), "glass", bevel=0.02)
    m.box("handle", (0.06, 0.06, 0.4), (0.22, -0.98, 1.05), "steel", bevel=0.01)
    m.box("console", (0.45, 0.14, 0.75), (0.82, -0.98, 0.9), "panel", bevel=0.03)
    m.box("screen", (0.34, 0.03, 0.24), (0.82, -1.05, 1.32), "glass", bevel=0.01)
    m.box("chip_conveyor", (0.45, 1.3, 0.55), (1.3, 0.15, 0), "steel", bevel=0.03)
    m.box("chip_bin", (0.5, 0.5, 0.4), (1.3, -0.8, 0), "clay", bevel=0.03)
    # The tool magazine on the left side turns while the machine cuts.
    with m.moving("magazine", (-1.1, 0.1, 1.25)):
        m.cylinder("magazine", 0.46, 0.1, (-1.1, 0.1, 1.25), "panel", axis="X", segments=32, bevel=0.01)
        for index in range(10):
            angle = index * math.tau / 10
            m.box(f"pocket_{index}", (0.08, 0.1, 0.1), (-1.17, 0.1 + 0.36 * math.cos(angle), 1.2 + 0.36 * math.sin(angle)), "steel", bevel=0.01)
    m.lamp((-0.85, 0.7, 2.22))
    return m


def press_brake():
    m = Model("press_brake")
    for side, x in (("left", -1.12), ("right", 1.12)):
        m.box(f"frame_{side}", (0.24, 0.95, 2.2), (x, 0.1, 0), bevel=0.04)
    m.box("bed", (2.0, 0.55, 0.85), (0, -0.02, 0), "panel", bevel=0.03)
    m.box("die", (2.0, 0.14, 0.1), (0, -0.16, 0.85), "steel", bevel=0.01)
    with m.moving("ram", (0, -0.16, 1.35)):
        m.box("ram", (2.0, 0.16, 0.4), (0, -0.16, 1.15), "steel", bevel=0.02)
    m.box("beam", (2.5, 0.6, 0.62), (0, 0.02, 1.55), bevel=0.05)
    m.box("tank", (0.9, 0.45, 0.42), (0, 0.15, 2.17), "panel", bevel=0.04)
    m.box("guard_stripe", (2.0, 0.02, 0.06), (0, -0.3, 0.72), "clay", bevel=0)
    m.cylinder("pendant_arm", 0.03, 1.2, (1.55, -0.55, 0.6), "steel", segments=10)
    m.box("pendant", (0.3, 0.12, 0.38), (1.55, -0.62, 1.2), "panel", bevel=0.02)
    m.lamp((1.12, 0.4, 2.2))
    return m


def welding_robot():
    m = Model("welding_robot")
    m.box("floor_plate", (2.4, 2.0, 0.05), (0, 0, 0), "panel", bevel=0.01)
    m.cylinder("robot_base", 0.3, 0.3, (-0.45, 0.25, 0.2), "clay", segments=24, bevel=0.02)
    # The arm swings over the work round the turret's axis; the app lights the torch's tip.
    with m.moving("arm", (-0.45, 0.25, 0.35)):
        m.cylinder("turret", 0.22, 0.3, (-0.45, 0.25, 0.5), "clay", segments=24, bevel=0.02)
        m.box("lower_arm", (0.17, 0.17, 0.85), (-0.38, 0.25, 0.55), "clay", rotation=(0, math.radians(18), 0), bevel=0.03)
        m.cylinder("elbow", 0.12, 0.24, (-0.25, 0.25, 1.35), "clay", axis="Y", segments=20, bevel=0.01)
        m.box("upper_arm", (0.75, 0.15, 0.15), (0.08, 0.25, 1.2), "clay", rotation=(0, math.radians(14), 0), bevel=0.03)
        # The tip stops just over the work, so the arc lights its top.
        m.cylinder("torch", 0.03, 0.32, (0.42, 0.25, 1.01), "ink", segments=10)
        m.mark("tip_torch", (0.42, 0.25, 0.85))
    m.box("positioner", (0.9, 0.9, 0.62), (0.5, -0.15, 0.05), "panel", bevel=0.03)
    m.box("fixture", (1.0, 1.0, 0.05), (0.5, -0.15, 0.67), "steel", bevel=0.01)
    # Long enough that the torch's tip stays over it as the arm swings.
    m.box("workpiece", (0.5, 0.5, 0.12), (0.45, 0.2, 0.72), "steel", bevel=0.01)
    m.box("controller", (0.6, 0.5, 1.25), (-0.95, 0.75, 0.05), bevel=0.04)
    m.box("controller_panel", (0.4, 0.02, 0.25), (-0.95, 0.49, 0.95), "glass", bevel=0)
    for side, x in (("left", -1.15), ("right", 1.15)):
        m.box(f"curtain_{side}", (0.07, 0.07, 1.4), (x, -0.95, 0.05), "panel", bevel=0.01)
    m.lamp((-0.95, 0.75, 1.3))
    return m


def furnace():
    m = Model("furnace")
    m.box("body", (1.8, 1.6, 1.9), (0, 0.1, 0), bevel=0.06)
    m.box("door", (1.15, 0.08, 1.15), (-0.15, -0.74, 0.42), "panel", bevel=0.04)
    m.box("door_bar", (0.9, 0.06, 0.06), (-0.15, -0.8, 1.3), "steel", bevel=0.01)
    # Kept apart, so the app can make it glow while the furnace heats.
    m.box("glow_window", (0.3, 0.03, 0.1), (-0.15, -0.79, 1.12), "clay", bevel=0)
    m.box("base_stripe", (1.8, 0.03, 0.12), (0, -0.71, 0.08), "clay", bevel=0)
    m.cylinder("duct", 0.16, 0.75, (0.45, 0.45, 2.27), "steel", segments=20)
    m.box("cabinet", (0.5, 0.55, 1.55), (1.2, 0.25, 0), bevel=0.04)
    m.box("cabinet_screen", (0.3, 0.03, 0.2), (1.2, -0.04, 1.2), "glass", bevel=0)
    m.lamp((1.2, 0.35, 1.55))
    return m


def grinder():
    m = Model("grinder")
    m.box("base", (2.0, 1.2, 0.9), (0, 0, 0), bevel=0.05)
    with m.moving("table", (0, -0.2, 0.96)):
        m.box("table", (1.4, 0.6, 0.12), (0, -0.2, 0.9), "steel", bevel=0.02)
    m.box("column", (0.5, 0.5, 1.2), (0, 0.35, 0.9), bevel=0.04)
    m.box("head", (0.55, 0.6, 0.38), (0, 0.1, 1.55), bevel=0.04)
    m.cylinder("wheel_guard", 0.26, 0.16, (0, -0.15, 1.42), "panel", axis="X", segments=24, bevel=0.01)
    m.box("splash_guard", (1.5, 0.04, 0.35), (0, -0.52, 0.9), "glass", bevel=0)
    m.box("console", (0.4, 0.14, 0.6), (1.2, -0.45, 0.6), "panel", bevel=0.02)
    m.lamp((0.85, 0.45, 0.9))
    return m


def drill_press():
    m = Model("drill_press")
    m.box("base", (0.7, 0.6, 0.12), (0, 0, 0), "panel", bevel=0.02)
    m.cylinder("column", 0.065, 1.65, (0, 0.18, 0.95), "steel", segments=16)
    m.box("table", (0.5, 0.45, 0.06), (0, -0.05, 0.72), "steel", bevel=0.01)
    m.box("head", (0.38, 0.62, 0.38), (0, 0.05, 1.35), bevel=0.04)
    m.cylinder("motor", 0.13, 0.28, (0, 0.28, 1.87), "panel", segments=16, bevel=0.01)
    # Long enough to stay in the head when it is fed down.
    with m.moving("spindle", (0, -0.15, 1.2)):
        m.cylinder("spindle", 0.028, 0.45, (0, -0.15, 1.275), "steel", segments=10)
    m.lamp((0.3, 0.25, 1.73), pole=0.2)
    return m


def inspection_table():
    m = Model("inspection_table")
    m.box("cabinet", (1.6, 0.95, 0.78), (0, 0, 0), bevel=0.04)
    m.box("granite", (1.5, 0.9, 0.12), (0, 0, 0.78), "ink", bevel=0.02)
    with m.moving("bridge", (0, 0.2, 1.3)):
        for side, x in (("left", -0.6), ("right", 0.6)):
            m.box(f"bridge_{side}", (0.08, 0.12, 0.75), (x, 0.2, 0.9), "steel", bevel=0.01)
        m.box("bridge_top", (1.3, 0.14, 0.1), (0, 0.2, 1.65), "steel", bevel=0.01)
        m.box("probe", (0.1, 0.1, 0.35), (0.15, 0.2, 1.3), "panel", bevel=0.01)
    m.box("monitor", (0.5, 0.05, 0.32), (-1.05, -0.1, 1.05), "glass", bevel=0.01)
    m.cylinder("monitor_post", 0.025, 1.05, (-1.05, -0.06, 0.52), "steel", segments=10)
    m.lamp((0.75, 0.38, 0.9), pole=0.25)
    return m


def packing_table():
    m = Model("packing_table")
    m.box("table", (1.6, 0.85, 0.78), (0, 0, 0), bevel=0.03)
    m.box("top", (1.65, 0.9, 0.05), (0, 0, 0.78), "wood", bevel=0.01)
    m.box("carton_a", (0.45, 0.35, 0.3), (-0.4, 0.05, 0.83), "cardboard", bevel=0.01)
    m.box("carton_b", (0.35, 0.3, 0.25), (0.1, 0.15, 0.83), "cardboard", bevel=0.01)
    m.box("tape", (0.18, 0.08, 0.12), (0.55, -0.2, 0.83), "clay", bevel=0.01)
    m.box("conveyor_frame", (1.6, 0.6, 0.06), (0, -0.95, 0.68), "steel", bevel=0.01)
    for index in range(7):
        m.cylinder(f"roller_{index}", 0.035, 0.56, (-0.68 + index * 0.225, -0.95, 0.77), "steel", axis="Y", segments=10)
    for side, x in (("left", -0.75), ("right", 0.75)):
        m.box(f"conveyor_leg_{side}", (0.05, 0.5, 0.68), (x, -0.95, 0), "steel", bevel=0)
    # A packed carton rides along the rollers.
    with m.moving("carton", (-0.6, -0.95, 0.81)):
        m.box("riding_carton", (0.3, 0.32, 0.24), (-0.6, -0.95, 0.81), "cardboard", bevel=0.01)
    m.lamp((0.75, 0.38, 0.83), pole=0.3)
    return m


def cutter():
    m = Model("cutter")
    m.box("infeed", (2.3, 0.55, 0.06), (-0.35, -0.1, 0.72), "steel", bevel=0.01)
    for index in range(8):
        m.cylinder(f"roller_{index}", 0.035, 0.5, (-1.35 + index * 0.27, -0.1, 0.81), "steel", axis="Y", segments=10)
    for x in (-1.4, -0.2):
        m.box(f"leg_{x}", (0.06, 0.45, 0.72), (x, -0.1, 0), "steel", bevel=0)
    m.box("saw_base", (0.95, 0.95, 0.9), (0.85, 0.05, 0), bevel=0.04)
    # The head stands raised on two guide columns and comes down them onto the base as it
    # cuts; the lamp stands on the console, clear of it.
    for x in (0.45, 1.25):
        m.box(f"guide_{x}", (0.08, 0.08, 0.95), (x, 0.47, 0.9), "steel", bevel=0.01)
    with m.moving("head", (0.85, 0.05, 1.45)):
        m.box("saw_frame", (0.95, 0.75, 0.55), (0.85, 0.05, 1.19), "clay", bevel=0.04)
        m.box("blade_guard", (0.15, 0.6, 0.4), (0.85, -0.05, 1.14), "panel", bevel=0.02)
    m.box("console", (0.35, 0.12, 0.5), (1.45, -0.45, 0.75), "panel", bevel=0.02)
    m.lamp((1.5, -0.45, 1.25), pole=0.3)
    return m


def generic_machine():
    m = Model("generic_machine")
    m.box("body", (1.4, 1.2, 1.6), (0, 0, 0), bevel=0.05)
    m.box("panel", (0.9, 0.04, 0.8), (-0.15, -0.61, 0.5), "panel", bevel=0.02)
    m.box("window", (0.6, 0.03, 0.4), (-0.15, -0.64, 0.75), "glass", bevel=0)
    m.box("console", (0.3, 0.1, 0.5), (0.5, -0.65, 0.8), "panel", bevel=0.02)
    m.lamp((-0.5, 0.4, 1.6))
    return m


def material_rack():
    m = Model("material_rack")
    for x in (-1.2, 0, 1.2):
        for y in (-0.4, 0.4):
            m.box(f"upright_{x}_{y}", (0.07, 0.07, 2.2), (x, y, 0), "ink", bevel=0.005)
    for level, z in enumerate((0.15, 1.05, 1.95)):
        for y in (-0.4, 0.4):
            m.box(f"beam_{level}_{y}", (2.47, 0.06, 0.1), (0, y, z), "clay", bevel=0.005)
        m.box(f"deck_{level}", (2.4, 0.86, 0.02), (0, 0, z + 0.1), "steel", bevel=0)
    return m


def pallet():
    m = Model("pallet")
    for index in range(5):
        m.box(f"board_{index}", (1.1, 0.16, 0.025), (0, -0.46 + index * 0.23, 0.12), "wood", bevel=0.004)
    for x in (-0.5, 0, 0.5):
        m.box(f"block_{x}", (0.1, 1.1, 0.1), (x, 0, 0.02), "wood", bevel=0.004)
    for index in range(3):
        m.box(f"bottom_{index}", (1.1, 0.1, 0.02), (0, -0.5 + index * 0.5, 0), "wood", bevel=0.003)
    return m


BUILDERS = [
    machining_center,
    press_brake,
    welding_robot,
    furnace,
    grinder,
    drill_press,
    inspection_table,
    packing_table,
    cutter,
    generic_machine,
    material_rack,
    pallet,
]


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)


def join(meshes, name):
    with bpy.context.temp_override(object=meshes[0], active_object=meshes[0], selected_objects=meshes, selected_editable_objects=meshes):
        bpy.ops.object.join()
    meshes[0].name = name


def finish(model):
    """Bevels applied, the still parts joined into one mesh and each moving part into one."""
    for obj in model.objects():
        if obj.type == "MESH":
            with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
                for modifier in list(obj.modifiers):
                    bpy.ops.object.modifier_apply(modifier=modifier.name)
    for group in [model.root, *[child for child in model.root.children if child.name.startswith("move_")]]:
        meshes = [child for child in group.children if child.type == "MESH" and not child.name.startswith("glow_")]
        if len(meshes) > 1:
            # Only the empty a part moves round is named move_<role>; its mesh is not.
            join(meshes, f"{group.name.removeprefix('move_')}_parts")


def export(model):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in model.objects():
        obj.select_set(True)
    bpy.context.view_layer.objects.active = model.root
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT_DIR, f"{model.name}.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )


def render_preview(models):
    """All models on a grid, seen from the front left and above as the app shows them."""
    columns = 4
    spacing = 3.4
    for index, model in enumerate(models):
        model.root.location = ((index % columns) * spacing, -(index // columns) * spacing, 0)
    from mathutils import Vector

    rows = (len(models) + columns - 1) // columns
    center = Vector(((columns - 1) * spacing / 2, -(rows - 1) * spacing / 2, 0.6))
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "MATERIAL"
    shading.show_shadows = True
    shading.show_cavity = True
    shading.background_type = "VIEWPORT"
    shading.background_color = (0.95, 0.94, 0.9)
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1400
    camera_data = bpy.data.cameras.new("preview")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = columns * spacing * 1.05
    camera = bpy.data.objects.new("preview", camera_data)
    scene.collection.objects.link(camera)
    # The app's camera: 45 degrees round from the front left, 35 degrees down.
    camera.location = center + Vector((-1, -1, 0.99)).normalized() * 40
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    clear_scene()
    models = []
    for build in BUILDERS:
        model = build()
        finish(model)
        export(model)
        models.append(model)
    if PREVIEW:
        render_preview(models)


main()
