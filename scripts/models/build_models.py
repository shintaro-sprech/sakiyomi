"""Builds Sakiyomi's low-poly factory models in Blender and writes them as .glb files.

    Blender --background --factory-startup --python scripts/models/build_models.py -- <out dir> [preview.png]

`npm run models` runs this and compresses the result into public/models (scripts/models/build.mjs).

Every model stands on the floor at the origin, front facing -Y (toward the viewer), in
meters. Each machine has a signal lamp with its own material named "lamp", which the app
recolors by the machine's state. The parts that move while a machine runs hang under an
empty named move_<role> at the point they move round, which the app animates by role; the
rest of a model is joined into one mesh. A preview render of all models side by side is
written when a second path is given.

The forklift and the truck keep their wheels, and the forklift its forks, as meshes of their
own named wheel_* and lift, each with its origin where it turns or rises. The truck alone
faces +X: the rear of its open box is at x = 0, as the entrance backs it up to the dock.
rack_stock is the material for the rack's three decks, made apart so the rack can stand empty.
"""

import math
import os
import sys
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT_DIR = argv[0] if argv else "public/models"
PREVIEW = argv[1] if len(argv) > 1 else None


def linear(hex_color):
    """sRGB hex to the linear color Blender's materials take."""
    channels = [int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels) + (1.0,)


# The app's palette, matte: ivory machines trimmed in warm grey, ink panels and bases, clay
# for moving parts and warnings.
COLORS = {
    "body": ("#F0EEE6", 0.8, 0.0),
    "trim": ("#D8D3C7", 0.8, 0.0),
    "panel": ("#3D3D3A", 0.75, 0.0),
    "ink": ("#262624", 0.7, 0.0),
    "glass": ("#2F3A46", 0.3, 0.0),
    "steel": ("#ADABA3", 0.55, 0.15),
    "clay": ("#D97757", 0.7, 0.0),
    "lamp": ("#87867F", 0.4, 0.0),
    "wood": ("#D3A974", 0.85, 0.0),
    "cardboard": ("#C99E6E", 0.85, 0.0),
    # The building around the line and the yard outside it.
    "floor": ("#EDEAE2", 0.9, 0.0),
    "wall": ("#E2DED4", 0.9, 0.0),
    "roof": ("#CBC7BD", 0.85, 0.0),
    "pane": ("#C9DCE6", 0.1, 0.0),
    "window": ("#AEBFCA", 0.3, 0.0),
    "shade": ("#ECE9E0", 0.95, 0.0),
    "tube": ("#FFE6BF", 0.4, 0.0),
    "road": ("#BDBAB2", 0.9, 0.0),
    "dash": ("#F8F6F0", 0.8, 0.0),
    "leaf": ("#A4B97F", 0.85, 0.0),
    "bark": ("#8E7C68", 0.85, 0.0),
}

# Materials that give off their own light: the hanging tubes.
GLOWING = {"tube": 0.75}


def material(name):
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    hex_color, roughness, metallic = COLORS[name]
    mat = bpy.data.materials.new(name)
    # Found by type, as Blender names new nodes in the language of its interface.
    bsdf = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = linear(hex_color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    mat.diffuse_color = linear(hex_color)
    if name in GLOWING:
        bsdf.inputs["Emission Color"].default_value = linear(hex_color)
        bsdf.inputs["Emission Strength"].default_value = GLOWING[name]
    return mat


def rounded(width, height, radius, steps=3):
    """The outline of a width x height rectangle centered on 0, its corners rounded."""
    points = []
    for index, (sx, sy) in enumerate(((1, -1), (1, 1), (-1, 1), (-1, -1))):
        cx, cy = sx * (width / 2 - radius), sy * (height / 2 - radius)
        for step in range(steps + 1):
            angle = math.radians(-90 + 90 * index + 90 * step / steps)
            points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


class Model:
    """The parts of one model, parented to an empty named after it."""

    def __init__(self, name):
        self.name = name
        self.root = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(self.root)
        self.pivot = None
        self.made = []
        self.kept = []

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

    @contextmanager
    def apart(self, name, at):
        """Parts made inside become one mesh named name, its origin at at, kept out of the joined
        rest, so the app can turn or move it there, as a wheel on its axle."""
        start = len(self.made)
        yield
        parts = self.made[start:]
        for part in parts:
            apply_modifiers(part)
        if len(parts) > 1:
            join(parts, name)
        obj = parts[0]
        obj.name = name
        obj.data.transform(Matrix.Translation([-value for value in at]) @ obj.matrix_basis)
        obj.matrix_basis = Matrix.Translation(at)
        self.made[start:] = [obj]
        self.kept.append(obj)

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

    def _link(self, name, bm, mat, location, rotation, bevel, segments=None):
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
        for polygon in mesh.polygons:
            polygon.use_smooth = False
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.data.materials.append(material(mat))
        self.made.append(obj)
        self._place(obj, location)
        obj.rotation_euler = rotation
        if bevel:
            # Big parts get a softer, two-step edge; small ones a single chamfer.
            modifier = obj.modifiers.new("bevel", "BEVEL")
            modifier.width = bevel
            modifier.segments = segments or (2 if bevel >= 0.04 else 1)
            modifier.limit_method = "ANGLE"
            modifier.angle_limit = math.radians(40)
        return obj

    def box(self, name, size, at, mat="body", bevel=0.02, rotation=(0, 0, 0), segments=None):
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
        return self._link(name, bm, mat, (x, y, z + sz / 2), rotation, bevel, segments)

    def cylinder(self, name, radius, depth, at, mat="steel", axis="Z", segments=20, bevel=0.0):
        """A cylinder whose center sits at at, standing along axis."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius, radius2=radius, depth=depth)
        rotation = {"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0)}[axis]
        return self._link(name, bm, mat, at, rotation, bevel)

    def profile(self, name, outline, depth, at, mat="body", axis="Y", bevel=0.02, segments=None):
        """An outline drawn in the plane across axis, (x, z) for Y or (y, z) for X, made depth
        thick round at."""
        bm = bmesh.new()
        sides = []
        for offset in (-depth / 2, depth / 2):
            if axis == "Y":
                sides.append([bm.verts.new((u, offset, v)) for u, v in outline])
            else:
                sides.append([bm.verts.new((offset, u, v)) for u, v in outline])
        front, back = sides
        bm.faces.new(front)
        bm.faces.new(list(reversed(back)))
        for index in range(len(outline)):
            following = (index + 1) % len(outline)
            bm.faces.new((front[index], front[following], back[following], back[index]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self._link(name, bm, mat, at, (0, 0, 0), bevel, segments)

    def link(self, name, a, b, width, depth, mat="clay", bevel=0.03, plane="XZ"):
        """A bar from a to b, running past each end by half its width so joints sit inside it.
        It lies in the XZ plane, depth thick along Y, or in the YZ plane, depth thick along X."""
        dx, dy, dz = (b[i] - a[i] for i in range(3))
        length = math.sqrt(dx * dx + dy * dy + dz * dz) + width
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        across = (width, depth) if plane == "XZ" else (depth, width)
        for vertex in bm.verts:
            vertex.co.x *= across[0]
            vertex.co.y *= across[1]
            vertex.co.z *= length
        rotation = (0, math.atan2(dx, dz), 0) if plane == "XZ" else (math.atan2(-dy, dz), 0, 0)
        middle = tuple((a[i] + b[i]) / 2 for i in range(3))
        return self._link(name, bm, mat, middle, rotation, min(bevel, width * 0.3, depth * 0.3))

    def lamp(self, at, pole=0.3):
        """A signal tower: a foot, a pole and the lamp the app recolors, under a dark cap."""
        x, y, z = at
        self.cylinder("lamp_foot", 0.055, 0.04, (x, y, z + 0.02), "ink", segments=12)
        self.cylinder("lamp_pole", 0.022, pole, (x, y, z + pole / 2), "steel", segments=8)
        self.cylinder("lamp_socket", 0.06, 0.05, (x, y, z + pole + 0.025), "ink", segments=16)
        self.cylinder("lamp", 0.07, 0.18, (x, y, z + pole + 0.14), "lamp", segments=16, bevel=0.012)
        self.cylinder("lamp_cap", 0.062, 0.03, (x, y, z + pole + 0.245), "ink", segments=16, bevel=0.008)

    def ribbon(self, name, line, width, height, mat):
        """A flat strip width wide along line, a list of (x, y) points, at height."""
        bm = bmesh.new()
        sides = []
        for index, (x, y) in enumerate(line):
            ax, ay = line[max(index - 1, 0)]
            bx, by = line[min(index + 1, len(line) - 1)]
            length = math.hypot(bx - ax, by - ay)
            nx, ny = -(by - ay) / length * width / 2, (bx - ax) / length * width / 2
            sides.append((bm.verts.new((x + nx, y + ny, height)), bm.verts.new((x - nx, y - ny, height))))
        for (a, b), (c, d) in zip(sides, sides[1:]):
            face = bm.faces.new((a, b, d, c))
            face.normal_update()
            if face.normal.z < 0:
                face.normal_flip()
        return self._link(name, bm, mat, (0, 0, 0), (0, 0, 0), 0)

    def crown(self, name, radius, at, mat="leaf"):
        """A faceted ball of leaves."""
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius)
        return self._link(name, bm, mat, at, (0, 0, 0), 0)

    def wheel(self, name, radius, width, at, axis="Y"):
        """A tire on its hub, turning on an axle along axis, its origin at the axle."""
        with self.apart(name, at):
            self.cylinder(f"{name}_tire", radius, width, at, "ink", axis=axis, segments=18, bevel=min(0.035, radius * 0.15))
            self.cylinder(f"{name}_hub", radius * 0.55, width + 0.02, at, "trim", axis=axis, segments=12)

    def objects(self):
        return [self.root, *self.root.children_recursive]


def machining_center():
    m = Model("machining_center")
    m.box("plinth", (1.96, 1.86, 0.14), (0, 0.16, 0), "ink", bevel=0.03)
    m.box("stripe", (2.0, 1.9, 0.09), (0, 0.16, 0.14), "clay", bevel=0.02)
    # The enclosure is built round the machining room, so the room shows through the open doors;
    # the room runs on behind the frame's right side, so the table has room to travel.
    m.box("enclosure_back", (2.0, 0.82, 2.0), (0, 0.7, 0.23), bevel=0.09)
    m.box("enclosure_left", (0.16, 1.1, 2.0), (-0.92, -0.24, 0.23), bevel=0.05)
    m.box("enclosure_right", (0.51, 1.1, 2.0), (0.745, -0.24, 0.23), bevel=0.05)
    m.box("enclosure_floor", (1.36, 1.1, 0.19), (-0.18, -0.24, 0.23), bevel=0.02)
    m.box("enclosure_top", (1.36, 1.1, 0.28), (-0.18, -0.24, 1.95), bevel=0.02)
    m.box("front_right", (0.1, 0.06, 2.0), (0.46, -0.76, 0.23), bevel=0.01)
    m.box("roof", (1.84, 1.74, 0.06), (0, 0.16, 2.23), "trim", bevel=0.02)
    # Inside: a lit room with the machine's bed and the column the spindle head rides on.
    m.box("room_back", (1.32, 0.02, 1.53), (-0.18, 0.29, 0.42), "trim", bevel=0)
    m.box("room_light", (0.9, 0.12, 0.02), (-0.1, -0.5, 1.93), "tube", bevel=0)
    m.box("bed", (1.28, 0.9, 0.28), (-0.16, -0.25, 0.42), "panel", bevel=0.02)
    m.box("column", (0.3, 0.3, 1.25), (0.07, 0.12, 0.7), "panel", bevel=0.02)
    # The table carries the work in its vise to and fro under the spindle, near the opening.
    with m.moving("table", (0.07, -0.45, 0.73)):
        m.box("table", (0.3, 0.36, 0.06), (0.07, -0.45, 0.7), "steel", bevel=0.01)
        m.box("vise", (0.18, 0.2, 0.07), (0.07, -0.45, 0.76), "ink", bevel=0.01)
        m.box("work", (0.22, 0.16, 0.12), (0.07, -0.45, 0.83), "clay", bevel=0.01)
    # The spindle head reaches out from the column and comes down it, its tool into the work.
    with m.moving("spindle", (0.07, -0.45, 1.4)):
        m.box("spindle_head", (0.24, 0.52, 0.3), (0.07, -0.29, 1.32), "ink", bevel=0.03)
        m.cylinder("spindle_nose", 0.06, 0.1, (0.07, -0.45, 1.27), "steel", segments=12)
        m.cylinder("tool", 0.018, 0.18, (0.07, -0.45, 1.13), "steel", segments=8)
    # The door frame, and its two narrow sliding doors run open to the left, windows at eye level.
    m.box("frame_top", (1.3, 0.04, 0.08), (-0.22, -0.79, 1.92), "panel", bevel=0.01)
    m.box("frame_bottom", (1.3, 0.04, 0.06), (-0.22, -0.79, 0.4), "panel", bevel=0.01)
    for name, x in (("frame_left", -0.85), ("frame_right", 0.41)):
        m.box(name, (0.04, 0.04, 1.6), (x, -0.79, 0.4), "panel", bevel=0.005)
    for side, x, y in (("left", -0.62, -0.84), ("right", -0.58, -0.9)):
        m.box(f"door_{side}", (0.46, 0.05, 1.48), (x, y, 0.46), "trim", bevel=0.025)
        m.box(f"window_{side}", (0.32, 0.03, 0.62), (x, y - 0.03, 1.1), "glass", bevel=0.015)
    m.box("handle", (0.04, 0.05, 0.4), (-0.39, -0.95, 0.85), "steel", bevel=0.01)
    m.box("console", (0.42, 0.1, 1.1), (0.73, -0.81, 0.62), "panel", bevel=0.03)
    m.box("screen", (0.32, 0.03, 0.24), (0.73, -0.86, 1.38), "glass", bevel=0.01)
    for x in (0.63, 0.73, 0.83):
        m.box(f"key_{x}", (0.06, 0.03, 0.06), (x, -0.86, 1.2), "steel", bevel=0.008)
    m.cylinder("stop_button", 0.045, 0.04, (0.73, -0.87, 1.0), "clay", axis="Y", segments=12)
    # The spindle head stands up through the roof.
    m.box("head", (0.72, 0.72, 0.26), (-0.2, 0.35, 2.29), "panel", bevel=0.05)
    m.box("motor", (0.48, 0.48, 0.12), (-0.2, 0.35, 2.55), "ink", bevel=0.04)
    m.box("coolant_tank", (0.26, 1.1, 0.4), (1.13, 0.35, 0), "panel", bevel=0.03)
    m.link("chip_chute", (1.13, 0.0, 0.4), (1.13, 0.75, 0.95), 0.2, 0.22, "steel", bevel=0.02, plane="YZ")
    # The tool magazine on the left side turns while the machine cuts.
    with m.moving("magazine", (-1.08, 0.25, 1.35)):
        m.cylinder("magazine", 0.48, 0.1, (-1.08, 0.25, 1.35), "panel", axis="X", segments=24, bevel=0.015)
        m.cylinder("hub", 0.14, 0.14, (-1.12, 0.25, 1.35), "clay", axis="X", segments=16, bevel=0.01)
        for index in range(12):
            angle = index * math.tau / 12
            y, z = 0.25 + 0.38 * math.cos(angle), 1.35 + 0.38 * math.sin(angle)
            m.box(f"pocket_{index}", (0.12, 0.08, 0.08), (-1.15, y, z - 0.04), "steel", bevel=0.01)
    m.lamp((0.7, 0.75, 2.29), pole=0.2)
    return m


def press_brake():
    m = Model("press_brake")
    # Side frames open at the front between the beams, so the sheet goes in.
    throat = [(-0.5, 0), (0.55, 0), (0.55, 2.3), (-0.5, 2.3), (-0.5, 1.3), (0.02, 1.3), (0.02, 0.86), (-0.5, 0.86)]
    for side, x in (("left", -1.06), ("right", 1.06)):
        m.profile(f"frame_{side}", throat, 0.2, (x, 0, 0), "body", axis="X", bevel=0.04)
    # The die at the table's usual height, about 0.9 m.
    m.box("bed", (1.92, 0.42, 0.8), (0, -0.2, 0), "panel", bevel=0.03)
    m.box("die_holder", (1.9, 0.16, 0.05), (0, -0.2, 0.8), "steel", bevel=0.01)
    m.box("die", (1.9, 0.1, 0.07), (0, -0.2, 0.85), "ink", bevel=0.01)
    # The ram and its punches come down onto the die.
    with m.moving("ram", (0, -0.2, 1.45)):
        m.box("ram", (1.9, 0.2, 0.48), (0, -0.2, 1.26), "trim", bevel=0.03)
        m.box("ram_band", (1.9, 0.03, 0.12), (0, -0.315, 1.42), "clay", bevel=0.005)
        m.box("punch_holder", (1.8, 0.12, 0.06), (0, -0.2, 1.2), "steel", bevel=0.01)
        for x in (-0.72, -0.36, 0, 0.36, 0.72):
            m.box(f"punch_{x}", (0.32, 0.08, 0.09), (x, -0.2, 1.11), "ink", bevel=0.01)
    m.box("beam", (2.36, 0.66, 0.56), (0, 0.0, 1.74), bevel=0.05)
    m.box("tank", (0.7, 0.45, 0.32), (0, 0.12, 2.3), "panel", bevel=0.04)
    for x in (-0.62, 0.62):
        m.cylinder(f"cylinder_{x}", 0.13, 0.28, (x, 0.05, 2.44), "steel", segments=20, bevel=0.015)
    m.box("pedal", (0.28, 0.22, 0.12), (0.35, -0.75, 0), "ink", bevel=0.02)
    m.box("pedal_top", (0.22, 0.16, 0.03), (0.35, -0.75, 0.12), "clay", bevel=0.005)
    # The control pendant hangs on an arm from the beam.
    m.cylinder("pendant_arm", 0.03, 0.4, (1.0, -0.52, 1.95), "steel", axis="Y", segments=10)
    m.cylinder("pendant_drop", 0.03, 0.35, (1.0, -0.7, 1.78), "steel", segments=10)
    m.box("pendant", (0.3, 0.1, 0.4), (1.0, -0.72, 1.2), "panel", bevel=0.03)
    m.box("pendant_screen", (0.22, 0.02, 0.14), (1.0, -0.775, 1.38), "glass", bevel=0)
    m.lamp((1.06, 0.42, 2.3), pole=0.2)
    return m


def welding_robot():
    m = Model("welding_robot")
    # The robot on a riser at the left; the work on a table at the right.
    m.box("riser", (0.72, 0.72, 0.5), (-0.6, 0.15, 0), "panel", bevel=0.05)
    m.cylinder("robot_base", 0.27, 0.14, (-0.6, 0.15, 0.57), "ink", segments=24, bevel=0.02)
    # The arm swings over the work round the turret's axis; the app lights the torch's tip.
    # Its shoulder sits low and its two arms are near the same length.
    with m.moving("arm", (-0.6, 0.15, 0.64)):
        m.cylinder("turret", 0.25, 0.22, (-0.6, 0.15, 0.75), "clay", segments=24, bevel=0.03)
        m.box("shoulder", (0.38, 0.44, 0.24), (-0.52, 0.15, 0.8), "clay", bevel=0.06)
        m.cylinder("shoulder_joint", 0.15, 0.5, (-0.45, 0.15, 0.95), "panel", axis="Y", segments=20, bevel=0.015)
        m.link("lower_arm", (-0.45, 0.15, 0.95), (-0.56, 0.15, 1.56), 0.2, 0.22, "clay", bevel=0.05)
        m.cylinder("elbow", 0.13, 0.32, (-0.56, 0.15, 1.56), "clay", axis="Y", segments=20, bevel=0.015)
        m.box("elbow_motor", (0.26, 0.2, 0.22), (-0.82, 0.15, 1.45), "panel", bevel=0.03)
        m.link("upper_arm", (-0.56, 0.15, 1.56), (0.16, 0.15, 1.36), 0.16, 0.18, "clay", bevel=0.04)
        m.cylinder("wrist", 0.09, 0.22, (0.16, 0.15, 1.36), "panel", axis="Y", segments=16, bevel=0.01)
        m.link("torch_neck", (0.16, 0.15, 1.36), (0.4, 0.15, 1.02), 0.07, 0.07, "ink", bevel=0.01)
        m.link("nozzle", (0.4, 0.15, 1.02), (0.435, 0.15, 0.95), 0.05, 0.05, "steel", bevel=0.005)
        # The tip stops just over the seam at the foot of the rib, which runs the way it swings.
        m.mark("tip_torch", (0.44, 0.15, 0.9))
    for x in (0.03, 0.87):
        for y in (-0.22, 0.52):
            m.box(f"table_leg_{x}_{y}", (0.08, 0.08, 0.73), (x, y, 0), "ink", bevel=0.01)
    m.box("table_frame", (1.0, 0.95, 0.08), (0.45, 0.15, 0.65), "panel", bevel=0.02)
    m.box("table_top", (0.96, 0.9, 0.07), (0.45, 0.15, 0.73), "steel", bevel=0.015)
    m.box("work_plate", (0.6, 0.5, 0.04), (0.5, 0.15, 0.8), "trim", bevel=0.008)
    m.box("work_rib", (0.05, 0.5, 0.14), (0.5, 0.15, 0.84), "trim", bevel=0.008)
    for x, y in ((0.18, -0.12), (0.18, 0.42), (0.82, -0.12), (0.82, 0.42)):
        m.box(f"clamp_{x}_{y}", (0.08, 0.08, 0.1), (x, y, 0.8), "clay", bevel=0.01)
    m.box("controller", (0.5, 0.45, 1.15), (-1.0, 0.78, 0), bevel=0.04)
    m.box("controller_screen", (0.34, 0.02, 0.22), (-1.0, 0.55, 0.8), "glass", bevel=0)
    m.lamp((-1.0, 0.78, 1.15), pole=0.22)
    return m


def furnace():
    m = Model("furnace")
    # A thick-walled chamber on a stand, its small door at chest height.
    m.box("stand", (1.5, 1.3, 0.5), (-0.1, 0.1, 0), "ink", bevel=0.03)
    m.box("stripe", (1.62, 1.42, 0.08), (-0.1, 0.1, 0.5), "clay", bevel=0.02)
    m.box("body", (1.6, 1.4, 1.3), (-0.1, 0.1, 0.58), bevel=0.08)
    m.box("door_frame", (0.86, 0.05, 0.74), (-0.2, -0.62, 0.78), "panel", bevel=0.02)
    m.box("door", (0.7, 0.08, 0.58), (-0.2, -0.66, 0.86), "trim", bevel=0.03)
    m.box("door_bar", (0.56, 0.05, 0.05), (-0.2, -0.72, 0.98), "steel", bevel=0.01)
    for z in (0.95, 1.25):
        m.box(f"hinge_{z}", (0.08, 0.06, 0.12), (-0.58, -0.68, z), "ink", bevel=0.01)
    # Kept apart, so the app can make it glow while the furnace heats.
    m.box("glow_window", (0.26, 0.03, 0.09), (-0.2, -0.715, 1.22), "clay", bevel=0)
    m.box("hood", (0.8, 0.6, 0.2), (-0.2, 0.2, 1.88), "panel", bevel=0.04)
    m.cylinder("duct", 0.16, 0.55, (-0.2, 0.2, 2.355), "steel", segments=20, bevel=0.01)
    m.box("cabinet", (0.48, 0.55, 1.5), (1.05, 0.25, 0), bevel=0.04)
    m.box("cabinet_screen", (0.3, 0.03, 0.22), (1.05, -0.04, 1.1), "glass", bevel=0)
    for z in (0.75, 0.9):
        m.cylinder(f"dial_{z}", 0.04, 0.04, (1.05, -0.04, z), "steel", axis="Y", segments=12)
    m.lamp((1.05, 0.35, 1.5))
    return m


def grinder():
    m = Model("grinder")
    m.box("plinth", (1.9, 1.1, 0.1), (0, 0, 0), "ink", bevel=0.02)
    m.box("base", (2.0, 1.2, 0.8), (0, 0, 0.1), bevel=0.06)
    m.box("stripe", (2.02, 0.03, 0.08), (0, -0.605, 0.7), "clay", bevel=0.005)
    # The table runs to and fro under the wheel.
    with m.moving("table", (0, -0.2, 0.96)):
        m.box("table", (1.3, 0.55, 0.1), (0, -0.2, 0.9), "steel", bevel=0.02)
        m.box("chuck", (1.1, 0.45, 0.06), (0, -0.2, 1.0), "panel", bevel=0.01)
        m.box("workpiece", (0.5, 0.25, 0.05), (0, -0.2, 1.06), "trim", bevel=0.008)
        for x in (-0.68, 0.68):
            m.box(f"stop_{x}", (0.06, 0.55, 0.12), (x, -0.2, 0.9), "clay", bevel=0.01)
    m.box("column", (0.55, 0.5, 1.25), (0, 0.35, 0.9), bevel=0.05)
    m.box("head", (0.5, 0.55, 0.4), (0, 0.05, 1.55), "trim", bevel=0.04)
    m.cylinder("motor", 0.13, 0.3, (0.38, 0.12, 1.75), "panel", axis="X", segments=16, bevel=0.01)
    m.cylinder("wheel_guard", 0.21, 0.16, (0, -0.18, 1.37), "clay", axis="X", segments=24, bevel=0.015)
    m.cylinder("wheel", 0.17, 0.1, (0, -0.2, 1.31), "steel", axis="X", segments=24)
    m.box("console", (0.25, 0.12, 0.5), (1.12, -0.4, 0.55), "panel", bevel=0.02)
    m.box("console_screen", (0.18, 0.02, 0.14), (1.12, -0.465, 0.85), "glass", bevel=0)
    m.lamp((0.18, 0.45, 2.15), pole=0.2)
    return m


def drill_press():
    m = Model("drill_press")
    m.box("base", (0.55, 0.7, 0.12), (0, 0.05, 0), "panel", bevel=0.03)
    m.cylinder("column", 0.07, 1.75, (0, 0.2, 0.995), "steel", segments=16)
    m.box("table_collar", (0.18, 0.22, 0.12), (0, 0.15, 0.68), "panel", bevel=0.02)
    m.box("table", (0.55, 0.48, 0.06), (0, -0.05, 0.72), "steel", bevel=0.01)
    m.box("vise", (0.25, 0.18, 0.08), (0, -0.15, 0.78), "ink", bevel=0.01)
    m.box("head", (0.42, 0.68, 0.42), (0, 0.05, 1.32), bevel=0.05)
    m.box("belt_cover", (0.44, 0.5, 0.14), (0, 0.12, 1.74), "clay", bevel=0.03)
    m.cylinder("motor", 0.12, 0.3, (0, 0.38, 2.03), "panel", segments=16, bevel=0.01)
    m.cylinder("feed_hub", 0.05, 0.08, (0.25, -0.05, 1.55), "panel", axis="X", segments=12)
    for index in range(3):
        angle = math.radians(90 + index * 120)
        end = (0.27, -0.05 + 0.22 * math.cos(angle), 1.55 + 0.22 * math.sin(angle))
        m.link(f"feed_spoke_{index}", (0.27, -0.05, 1.55), end, 0.025, 0.025, "steel", bevel=0, plane="YZ")
    # Long enough to stay in the head when it is fed down.
    with m.moving("spindle", (0, -0.15, 1.2)):
        m.cylinder("spindle", 0.032, 0.45, (0, -0.15, 1.275), "steel", segments=10)
        m.cylinder("chuck", 0.05, 0.08, (0, -0.15, 1.09), "panel", segments=12)
        m.cylinder("bit", 0.012, 0.12, (0, -0.15, 0.99), "steel", segments=6)
    m.lamp((0.28, 0.25, 1.74), pole=0.2)
    return m


def inspection_table():
    m = Model("inspection_table")
    m.box("plinth", (1.5, 0.9, 0.1), (0, 0.05, 0), "ink", bevel=0.02)
    m.box("stand", (1.62, 1.02, 0.54), (0, 0.05, 0.1), bevel=0.05)
    m.box("stripe", (1.64, 1.04, 0.06), (0, 0.05, 0.5), "clay", bevel=0.01)
    m.box("granite", (1.72, 1.1, 0.16), (0, 0.05, 0.64), "ink", bevel=0.03)
    for x in (-0.7, 0.7):
        m.box(f"rail_{x}", (0.08, 1.0, 0.03), (x, 0.05, 0.8), "steel", bevel=0.005)
    m.box("workpiece", (0.42, 0.3, 0.1), (0.05, -0.05, 0.8), "trim", bevel=0.01)
    # The bridge runs along the rails; its slender ram rises through it and holds the probe
    # just over the work.
    with m.moving("bridge", (0, 0.05, 1.3)):
        for x in (-0.7, 0.7):
            m.box(f"bridge_leg_{x}", (0.14, 0.2, 0.86), (x, 0.05, 0.83), "trim", bevel=0.03)
        m.box("bridge_beam", (1.6, 0.22, 0.2), (0, 0.05, 1.66), bevel=0.04)
        m.box("carriage", (0.28, 0.12, 0.4), (0.12, -0.11, 1.5), "panel", bevel=0.03)
        m.box("quill", (0.1, 0.1, 1.6), (0.12, -0.11, 0.98), "ink", bevel=0.01)
        m.box("quill_cap", (0.14, 0.14, 0.04), (0.12, -0.11, 2.58), "panel", bevel=0.01)
        m.cylinder("stylus", 0.018, 0.06, (0.12, -0.11, 0.95), "steel", segments=8)
        m.cylinder("probe_ball", 0.032, 0.05, (0.12, -0.11, 0.935), "clay", segments=12, bevel=0.01)
    m.cylinder("monitor_foot", 0.16, 0.04, (-1.05, -0.12, 0.02), "ink", segments=16)
    m.cylinder("monitor_post", 0.03, 1.1, (-1.05, -0.12, 0.55), "steel", segments=10)
    m.box("monitor", (0.48, 0.05, 0.34), (-1.05, -0.16, 1.05), "panel", bevel=0.02)
    m.box("monitor_screen", (0.42, 0.02, 0.28), (-1.05, -0.195, 1.08), "glass", bevel=0)
    m.lamp((0.72, 0.5, 0.8), pole=0.35)
    return m


def packing_table():
    m = Model("packing_table")
    # A bench with cartons at the back; packed cartons leave along rollers in front.
    for x in (-0.84, 0.84):
        for y in (-0.02, 0.66):
            m.box(f"bench_leg_{x}_{y}", (0.07, 0.07, 0.8), (x, y, 0), "panel", bevel=0.01)
    m.box("bench_shelf", (1.7, 0.7, 0.03), (0, 0.32, 0.2), "steel", bevel=0.005)
    m.box("bench_top", (1.8, 0.8, 0.06), (0, 0.32, 0.8), bevel=0.02)
    m.box("carton_a", (0.5, 0.42, 0.36), (-0.45, 0.35, 0.86), "cardboard", bevel=0.012)
    m.box("carton_b", (0.42, 0.38, 0.32), (0.08, 0.38, 0.86), "cardboard", bevel=0.012)
    m.box("carton_c", (0.36, 0.32, 0.28), (-0.42, 0.37, 1.22), "cardboard", bevel=0.012)
    for name, x, y, z, depth in (("a", -0.45, 0.35, 1.22, 0.43), ("b", 0.08, 0.38, 1.18, 0.39), ("c", -0.42, 0.37, 1.5, 0.33)):
        m.box(f"carton_tape_{name}", (0.07, depth, 0.008), (x, y, z), "clay", bevel=0)
    m.box("flat_cartons", (0.5, 0.42, 0.08), (0.55, 0.36, 0.86), "cardboard", bevel=0.008)
    m.cylinder("tape_roll", 0.07, 0.06, (0.6, 0.06, 0.93), "clay", axis="X", segments=12)
    for y in (-0.35, -0.85):
        m.box(f"conveyor_rail_{y}", (1.8, 0.05, 0.1), (0, y, 0.62), "steel", bevel=0.01)
    for index in range(12):
        m.cylinder(f"roller_{index}", 0.025, 0.46, (-0.825 + index * 0.15, -0.6, 0.73), "steel", axis="Y", segments=8)
    for x in (-0.8, 0.8):
        for y in (-0.38, -0.82):
            m.box(f"conveyor_leg_{x}_{y}", (0.05, 0.05, 0.62), (x, y, 0), "panel", bevel=0)
    # A packed carton rides along the rollers.
    with m.moving("carton", (-0.62, -0.6, 0.76)):
        m.box("riding_carton", (0.34, 0.34, 0.28), (-0.62, -0.6, 0.76), "cardboard", bevel=0.012)
        m.box("riding_tape", (0.07, 0.35, 0.008), (-0.62, -0.6, 1.04), "clay", bevel=0)
    m.lamp((0.82, 0.66, 0.86), pole=0.4)
    return m


def cutter():
    m = Model("cutter")
    # An infeed roller stand carries the bar into the vise at the saw.
    m.box("infeed_frame", (0.85, 0.46, 0.06), (-0.88, -0.05, 0.64), "steel", bevel=0.01)
    for x in (-1.22, -0.55):
        m.box(f"infeed_leg_{x}", (0.06, 0.4, 0.64), (x, -0.05, 0), "panel", bevel=0)
    for x in (-1.15, -0.88, -0.61):
        m.cylinder(f"roller_{x}", 0.04, 0.42, (x, -0.05, 0.73), "steel", axis="Y", segments=10)
    m.box("base", (1.3, 0.85, 0.7), (0.2, 0.05, 0), "panel", bevel=0.05)
    m.box("base_top", (1.36, 0.9, 0.07), (0.2, 0.05, 0.7), "trim", bevel=0.02)
    m.box("stripe", (1.32, 0.03, 0.08), (0.2, -0.39, 0.55), "clay", bevel=0.005)
    m.box("bar", (2.0, 0.2, 0.17), (-0.27, -0.05, 0.77), "steel", bevel=0.015)
    for y in (0.12, -0.22):
        m.box(f"vise_{y}", (0.5, 0.1, 0.2), (0.25, y, 0.77), "ink", bevel=0.015)
    for x in (-0.15, 0.65):
        m.box(f"guide_{x}", (0.1, 0.1, 1.05), (x, 0.4, 0.77), "steel", bevel=0.01)
        m.box(f"guide_cap_{x}", (0.14, 0.14, 0.05), (x, 0.4, 1.82), "ink", bevel=0.01)
    # The saw bow comes down the guides, its blade through the bar and just short of the base.
    with m.moving("head", (0.25, 0.05, 1.45)):
        m.profile("bow", rounded(1.8, 0.6, 0.28, steps=4), 0.28, (0.25, 0.0, 1.5), "clay", bevel=0.03)
        m.box("bow_collar", (0.95, 0.3, 0.2), (0.25, 0.27, 1.5), "trim", bevel=0.03)
        for x in (-0.37, 0.87):
            m.cylinder(f"wheel_hub_{x}", 0.08, 0.04, (x, -0.15, 1.5), "ink", axis="Y", segments=12)
        for x in (-0.05, 0.6):
            m.box(f"blade_guide_{x}", (0.1, 0.12, 0.3), (x, -0.05, 1.22), "ink", bevel=0.015)
        m.box("blade", (0.75, 0.02, 0.1), (0.27, -0.05, 1.12), "steel", bevel=0)
    m.box("console", (0.3, 0.3, 1.05), (1.12, -0.45, 0), "panel", bevel=0.03)
    m.box("console_screen", (0.22, 0.02, 0.16), (1.12, -0.61, 0.8), "glass", bevel=0)
    m.lamp((1.12, -0.45, 1.05), pole=0.25)
    return m


def generic_machine():
    m = Model("generic_machine")
    m.box("plinth", (1.36, 1.16, 0.1), (0, 0, 0), "ink", bevel=0.02)
    m.box("stripe", (1.4, 1.2, 0.07), (0, 0, 0.1), "clay", bevel=0.015)
    m.box("body", (1.4, 1.2, 1.5), (0, 0, 0.17), bevel=0.07)
    m.box("door_frame", (0.86, 0.04, 0.9), (-0.15, -0.62, 0.42), "panel", bevel=0.02)
    m.box("door", (0.78, 0.05, 0.82), (-0.15, -0.64, 0.46), "trim", bevel=0.02)
    m.box("window", (0.5, 0.03, 0.36), (-0.15, -0.67, 0.82), "glass", bevel=0.01)
    m.box("console", (0.3, 0.1, 0.6), (0.48, -0.65, 0.75), "panel", bevel=0.02)
    m.box("console_screen", (0.22, 0.02, 0.16), (0.48, -0.705, 1.12), "glass", bevel=0)
    m.box("vent", (0.5, 0.4, 0.12), (0.2, 0.2, 1.67), "panel", bevel=0.03)
    m.lamp((-0.45, 0.35, 1.67))
    return m


def material_rack():
    m = Model("material_rack")
    # The deck tops stay at 0.27, 1.17 and 2.07 m, where the app stacks material.
    for x in (-1.2, 0, 1.2):
        for y in (-0.4, 0.4):
            m.box(f"upright_{x}_{y}", (0.08, 0.08, 2.2), (x, y, 0), "ink", bevel=0.01)
            m.box(f"foot_{x}_{y}", (0.14, 0.14, 0.02), (x, y, 0), "ink", bevel=0)
    for level, z in enumerate((0.15, 1.05, 1.95)):
        for y in (-0.4, 0.4):
            m.box(f"beam_{level}_{y}", (2.48, 0.07, 0.12), (0, y, z), "clay", bevel=0.01)
        m.box(f"deck_{level}", (2.4, 0.86, 0.02), (0, 0, z + 0.1), "steel", bevel=0)
    # The end frames are braced; the middle one stays open for the stock.
    for x in (-1.2, 1.2):
        for index, (z0, z1) in enumerate(((0.27, 1.05), (1.17, 1.95))):
            a, b = (x, -0.36, z0), (x, 0.36, z1)
            if index % 2:
                a, b = (x, 0.36, z0), (x, -0.36, z1)
            m.link(f"brace_{x}_{index}", a, b, 0.035, 0.035, "ink", bevel=0, plane="YZ")
    return m


def pallet():
    m = Model("pallet")
    # Two-way entry, as a T11 pallet: deck boards on three stringers, 144 mm high.
    for index in range(5):
        m.box(f"board_{index}", (1.1, 0.17, 0.022), (0, -0.465 + index * 0.2325, 0.122), "wood", bevel=0.005, segments=1)
    for x in (-0.5, 0, 0.5):
        m.box(f"stringer_{x}", (0.08, 1.1, 0.1), (x, 0, 0.022), "wood", bevel=0.004, segments=1)
    for y in (-0.465, 0, 0.465):
        m.box(f"bottom_{y}", (1.1, 0.17, 0.022), (0, y, 0), "wood", bevel=0)
    return m


def rack_stock():
    m = Model("rack_stock")
    # Plate on the lowest deck, round pipe on the middle one and square tube on the top, clear
    # of the middle uprights.
    for index in range(5):
        shift = (index % 2) * 0.03 - 0.015
        m.box(f"plate_{index}", (2.1, 0.62, 0.024), (shift, shift, 0.27 + index * 0.024), "steel" if index % 2 else "trim", bevel=0.004, segments=1)
    radius = 0.055
    for row, count in enumerate((5, 4, 3)):
        for index in range(count):
            y = (index - (count - 1) / 2) * 2 * radius
            z = 1.17 + radius + row * radius * math.sqrt(3)
            m.cylinder(f"pipe_{row}_{index}", radius, 2.2, (0, y, z), "steel", axis="X", segments=10)
            for x in (-1.101, 1.101):
                m.cylinder(f"pipe_bore_{row}_{index}_{x}", radius * 0.68, 0.004, (x, y, z), "ink", axis="X", segments=8)
    for row in range(2):
        for index in range(3):
            y, z = (index - 1) * 0.1, 2.07 + row * 0.1
            m.box(f"tube_{row}_{index}", (2.2, 0.09, 0.09), (0, y, z), "steel", bevel=0.008, segments=1)
            for x in (-1.101, 1.101):
                m.box(f"tube_bore_{row}_{index}_{x}", (0.004, 0.06, 0.06), (x, y, z + 0.015), "ink", bevel=0)
    return m


def forklift():
    m = Model("forklift")
    # Its fork heels stand at the origin; a pallet it carries sits centered 0.55 m in front (-Y).
    with m.apart("lift", (0, 0, 0)):
        for x in (-0.28, 0.28):
            m.box(f"fork_{x}", (0.1, 1.05, 0.045), (x, -0.525, 0.04), "steel", bevel=0.01)
            m.box(f"fork_shank_{x}", (0.1, 0.045, 0.45), (x, 0.0225, 0.04), "steel", bevel=0.01)
        m.box("carriage", (0.92, 0.05, 0.3), (0, 0.07, 0.12), "ink", bevel=0.01)
        for x in (-0.44, -0.15, 0.15, 0.44):
            m.box(f"backrest_{x}", (0.04, 0.03, 0.55), (x, 0.06, 0.42), "ink", bevel=0)
        m.box("backrest_top", (0.92, 0.03, 0.04), (0, 0.06, 0.97), "ink", bevel=0)
    for x in (-0.3, 0.3):
        m.box(f"mast_{x}", (0.09, 0.12, 2.0), (x, 0.15, 0.05), "steel", bevel=0.01)
    m.box("mast_top", (0.7, 0.1, 0.08), (0, 0.15, 1.97), "ink", bevel=0.01)
    m.box("mast_tie", (0.7, 0.1, 0.06), (0, 0.15, 0.95), "ink", bevel=0.01)
    m.cylinder("lift_cylinder", 0.05, 1.5, (0, 0.24, 0.85), "steel", segments=10)
    m.box("frame", (1.0, 1.75, 0.42), (0, 1.15, 0.16), "clay", bevel=0.05)
    m.box("counterweight", (1.04, 0.42, 0.8), (0, 1.86, 0.14), "ink", bevel=0.1)
    m.box("hood", (0.92, 0.75, 0.32), (0, 1.25, 0.58), "clay", bevel=0.05)
    m.box("cowl", (0.92, 0.3, 0.5), (0, 0.5, 0.58), "clay", bevel=0.05)
    m.box("seat", (0.46, 0.42, 0.1), (0, 1.3, 0.9), "ink", bevel=0.03)
    m.box("seat_back", (0.46, 0.1, 0.38), (0, 1.5, 0.95), "ink", bevel=0.03)
    m.link("steering_column", (0, 0.55, 1.05), (0, 0.72, 1.25), 0.05, 0.05, "ink", bevel=0, plane="YZ")
    m.cylinder("steering_wheel", 0.16, 0.04, (0, 0.74, 1.27), "ink", segments=16)
    # The overhead guard over the driver.
    for y, z in ((0.4, 0.58), (1.62, 0.9)):
        for x in (-0.45, 0.45):
            m.box(f"guard_post_{x}_{y}", (0.06, 0.06, 2.05 - z), (x, y, z), "ink", bevel=0.01)
    m.box("guard_roof", (0.98, 1.34, 0.05), (0, 1.01, 2.02), "ink", bevel=0.01)
    for x in (-0.45, 0.45):
        m.box(f"headlight_{x}", (0.1, 0.04, 0.08), (x, 0.36, 1.6), "trim", bevel=0.01)
    m.cylinder("beacon", 0.06, 0.1, (0.3, 1.5, 2.12), "clay", segments=12, bevel=0.01)
    for name, x in (("wheel_front_left", -0.44), ("wheel_front_right", 0.44)):
        m.wheel(name, 0.23, 0.18, (x, 0.52, 0.23), axis="X")
    for name, x in (("wheel_rear_left", -0.4), ("wheel_rear_right", 0.4)):
        m.wheel(name, 0.2, 0.12, (x, 1.82, 0.2), axis="X")
    return m


def truck():
    m = Model("truck")
    m.box("chassis", (6.5, 0.9, 0.22), (3.35, 0, 0.62), "ink", bevel=0.02)
    # The cargo box, open at the rear, its floor 1.0 m up, with its doors swung round to its sides.
    m.box("cargo_floor", (4.9, 2.2, 0.08), (2.45, 0, 0.92), "panel", bevel=0.01)
    for y in (1.075, -1.075):
        m.box(f"cargo_side_{y}", (4.9, 0.05, 2.15), (2.45, y, 1.0), bevel=0.01)
    m.box("cargo_front", (0.06, 2.2, 2.15), (4.87, 0, 1.0), bevel=0.01)
    m.box("cargo_roof", (4.9, 2.2, 0.06), (2.45, 0, 3.09), bevel=0.02)
    for x in (0.05, 4.85):
        for y in (1.06, -1.06):
            m.box(f"corner_post_{x}_{y}", (0.1, 0.1, 2.23), (x, y, 0.92), "trim", bevel=0.015)
    m.box("rear_header", (0.1, 2.22, 0.14), (0.05, 0, 3.02), "trim", bevel=0.015)
    m.box("rear_sill", (0.1, 2.22, 0.1), (0.05, 0, 0.9), "trim", bevel=0.015)
    for y in (1.105, -1.105):
        for index in range(6):
            m.box(f"rib_{y}_{index}", (0.05, 0.02, 2.0), (1.4 + index * 0.6, y, 1.07), "trim", bevel=0)
        m.box(f"stripe_{y}", (3.7, 0.02, 0.12), (2.95, y * 1.005, 1.08), "clay", bevel=0)
        m.box(f"door_{y}", (1.04, 0.05, 2.1), (0.52, y + (0.03 if y > 0 else -0.03), 1.0), "trim", bevel=0.01)
    m.box("rear_bumper", (0.1, 2.0, 0.12), (0.15, 0, 0.45), "ink", bevel=0.01)
    for y in (0.85, -0.85):
        m.box(f"tail_light_{y}", (0.04, 0.25, 0.1), (0.1, y, 0.57), "clay", bevel=0.005)
    # The cab: its roof rounds down onto the windscreen.
    cab = [(-0.85, -0.85), (0.85, -0.85), (0.85, 0.35)]
    cab += [(0.55 + 0.3 * math.cos(math.radians(a)), 0.35 + 0.5 * math.sin(math.radians(a))) for a in (30, 60, 90)]
    cab += [(-0.85, 0.85)]
    m.profile("cab", cab, 2.1, (5.95, 0, 1.8), "panel", axis="Y", bevel=0.04)
    m.box("windscreen", (0.03, 1.8, 0.55), (6.81, 0, 1.6), "glass", bevel=0.01)
    for y in (1.06, -1.06):
        m.box(f"side_window_{y}", (0.7, 0.03, 0.5), (6.0, y, 1.7), "glass", bevel=0.01)
        m.box(f"mirror_arm_{y}", (0.06, 0.25, 0.04), (6.65, y * 1.1, 2.12), "ink", bevel=0)
        m.box(f"mirror_{y}", (0.06, 0.08, 0.3), (6.68, y * 1.22, 1.84), "ink", bevel=0.01)
        m.box(f"step_{y}", (0.4, 0.15, 0.05), (5.25, y * 0.95, 0.6), "ink", bevel=0.01)
        m.box(f"side_guard_{y}", (2.6, 0.04, 0.06), (3.45, y * 0.96, 0.5), "ink", bevel=0)
    m.box("grille", (0.03, 1.3, 0.3), (6.81, 0, 1.05), "ink", bevel=0.005)
    for y in (0.78, -0.78):
        m.box(f"headlight_{y}", (0.04, 0.32, 0.16), (6.81, y, 1.08), "trim", bevel=0.01)
    m.box("bumper", (0.16, 2.08, 0.24), (6.78, 0, 0.78), "clay", bevel=0.03)
    m.cylinder("fuel_tank", 0.22, 0.9, (3.4, -0.7, 0.62), "steel", axis="X", segments=16, bevel=0.02)
    for index, (x, y, width) in enumerate(((1.5, 0.82, 0.5), (1.5, -0.82, 0.5), (5.75, 0.92, 0.3), (5.75, -0.92, 0.3))):
        m.wheel(f"wheel_{index}", 0.4, width, (x, y, 0.4))
    return m


def carton_stock():
    m = Model("carton_stock")
    # Cartons on the rack's three decks, for the store at the back of the building.
    for level, z in enumerate((0.27, 1.17, 2.07)):
        for slot, x in enumerate((-0.8, 0.0, 0.8)):
            for dx in (-0.18, 0.18):
                for dy in (-0.18, 0.18):
                    height = 0.3 if (level + slot) % 2 else 0.36
                    m.box(f"carton_{level}_{slot}_{dx}_{dy}", (0.34, 0.34, height), (x + dx, dy, z), "cardboard", bevel=0.008, segments=1)
    return m


def factory_hall():
    """The building the line stands in and the yard outside it, placed as it is, at the
    entrance's origin. Measures are in the entrance's frame: x along the line, z toward the
    viewer, y up; the floor's top is at y = 0 and the yard's ground at y = -0.5."""
    m = Model("factory_hall")

    def block(name, x0, x1, z0, z1, y0, y1, mat="wall", bevel=0.0):
        m.box(name, (x1 - x0, abs(z1 - z0), y1 - y0), ((x0 + x1) / 2, -(z0 + z1) / 2, y0), mat, bevel=bevel, segments=1)

    def rod(name, radius, length, x, y, z, axis, mat="steel", segments=10):
        m.cylinder(name, radius, length, (x, -z, y), mat, axis={"x": "X", "y": "Z", "z": "Y"}[axis], segments=segments)

    left, right, front, store, back = -28.0, 19.3, 3.6, -2.4, -9.25
    deck, eave, ridge = 4.8, 13.6, 13.85
    # The floor slab, cut open at the front and the ends, and a low curb along the front.
    block("floor", left, right, back, front, -0.42, 0, "floor", bevel=0.04)
    block("curb", left, 19.0, front - 0.2, front, 0, 0.35)
    # The wall behind the machines, rising well above them to the store's deck, with the air
    # pipe along it and a drop down to each machine.
    block("partition", -14.0, 19.0, store - 0.25, store, 0, deck)
    rod("air_pipe", 0.05, 32.4, 2.2, 4.15, store + 0.2, "x")
    for x in (-8.8, -4.8, -1.0, 2.8, 6.6, 10.2, 13.6):
        rod(f"drop_{x}", 0.03, 1.6, x, 3.35, store + 0.2, "y", segments=8)
    # Long lights hung over the line on arms from the wall, glowing warm.
    for x in (-8.8, -4.8, -1.0, 2.8, 6.6, 10.2, 13.6, 16.9):
        block(f"light_arm_{x}", x - 0.03, x + 0.03, store + 1.0, store, 4.5, 4.56, "steel")
        for side in (-0.55, 0.55):
            rod(f"light_rod_{x}_{side}", 0.012, 0.3, x + side, 4.38, store + 0.95, "y", segments=6)
        block(f"light_{x}", x - 0.8, x + 0.8, store + 1.12, store + 0.82, 4.1, 4.23, "tube")
    # The store: a deck over the back of the building with its railing, the tall back wall,
    # and the roof over the store's rear on a truss.
    block("deck", -14.0, 19.0, back, store, deck - 0.25, deck, "floor")
    for index in range(17):
        x = -13.8 + index * 2.0
        block(f"rail_post_{index}", x - 0.03, x + 0.03, store - 0.06, store, deck, deck + 0.9, "steel")
    block("rail_top", -14.0, 19.0, store - 0.06, store, deck + 0.85, deck + 0.9, "steel")
    block("rail_mid", -14.0, 19.0, store - 0.06, store, deck + 0.43, deck + 0.47, "steel")
    block("back_wall", -14.2, right, back - 0.25, back, 0, ridge)
    block("store_side", 19.0, right, back, store, 0, deck + 0.9)
    block("roof", -14.2, right + 0.2, back - 0.25, -6.9, eave, ridge, "roof", bevel=0.03)
    for x in (-9.0, -1.0, 7.0, 15.0):
        block(f"skylight_{x}", x - 1.5, x + 1.5, -8.9, -7.5, ridge, ridge + 0.05, "pane")
    block("truss_top", -14.2, right, -6.96, -6.84, eave - 0.12, eave, "steel")
    block("truss_bottom", -14.2, right, -6.96, -6.84, eave - 1.2, eave - 1.08, "steel")
    for index in range(33):
        x0 = -14.0 + index * 1.0
        a, b = (x0, 6.9, eave - 1.14), (x0 + 1.0, 6.9, eave - 0.06)
        if index % 2:
            a, b = (x0, 6.9, eave - 0.06), (x0 + 1.0, 6.9, eave - 1.14)
        m.link(f"truss_web_{index}", a, b, 0.06, 0.06, "steel", bevel=0)
    # Columns at the store's ends, clear of the board in front.
    for x in (-14.0, -10.5, 16.0, 19.0):
        block(f"column_{x}", x - 0.1, x + 0.1, -6.99, -6.81, deck, eave - 1.2, "steel")
    # The office block at the left, two storeys with mullioned windows on both.
    height = 7.4
    block("office_block", left, -14.0, back, store, 0, height)
    block("office_cap", left - 0.1, -13.9, back - 0.1, store + 0.1, height, height + 0.2, "roof")
    for floor_index, (y0, y1) in enumerate(((1.1, 3.1), (4.5, 6.5))):
        for x in (-26.2, -23.2, -20.2, -17.2):
            block(f"office_window_{floor_index}_{x}", x - 1.2, x + 1.2, store + 0.03, store - 0.01, y0, y1, "window")
            block(f"office_mullion_v_{floor_index}_{x}", x - 0.03, x + 0.03, store + 0.05, store - 0.02, y0, y1, "trim")
            block(f"office_mullion_h_{floor_index}_{x}", x - 1.2, x + 1.2, store + 0.05, store - 0.02, (y0 + y1) / 2 - 0.03, (y0 + y1) / 2 + 0.03, "trim")
        for z in (-4.1, -7.3):
            block(f"office_side_window_{floor_index}_{z}", -14.01, -13.97, z - 1.1, z + 1.1, y0, y1, "window")
    # The glass office in front of it, where the plan starts: open at the top and to the right.
    glass = 5.0
    block("office_glass_front", left, -10.4, front - 0.17, front - 0.13, 0.35, glass, "pane")
    block("office_glass_end", left, left + 0.04, store, front - 0.15, 0.35, glass, "pane")
    for index in range(9):
        x = left + index * 2.2
        block(f"office_post_{index}", x - 0.04, x + 0.04, front - 0.19, front - 0.11, 0.35, glass, "steel")
    block("office_corner", -10.48, -10.32, front - 0.19, front - 0.11, 0, glass + 0.05, "steel")
    block("office_head_front", left, -10.32, front - 0.2, front - 0.1, glass, glass + 0.1, "steel")
    block("office_head_end", left - 0.04, left + 0.06, store, front - 0.1, glass, glass + 0.1, "steel")
    block("desk_top", -26.6, -24.8, 0.9, 1.7, 0.72, 0.78, "body")
    for x in (-26.5, -24.9):
        block(f"desk_leg_{x}", x - 0.03, x + 0.03, 1.0, 1.6, 0, 0.72, "steel")
    block("monitor", -26.0, -25.4, 1.0, 1.06, 0.82, 1.2, "ink")
    block("chair", -25.95, -25.45, 1.9, 2.35, 0.42, 0.5, "ink")
    block("chair_back", -25.95, -25.45, 2.3, 2.36, 0.5, 0.95, "ink")
    m.cylinder("plant_pot", 0.18, 0.4, (-27.3, -2.6, 0.2), "clay", segments=10)
    m.crown("plant", 0.36, (-27.3, -2.6, 0.75))
    # The loading bay in the right wall, the canopy outside it and the rolled-up door.
    block("bay_wall", 19.0, right, store, 0.75, 0, deck)
    block("bay_lintel", 19.0, right, 0.75, 3.25, 3.12, deck)
    block("bay_jamb", 19.0, right, 3.25, front, 0, deck)
    m.cylinder("door_roll", 0.18, 2.5, (19.0, -2.0, 3.36), "panel", axis="Y", segments=12)
    for z0, z1 in ((0.4, 0.8), (3.2, 3.6)):
        block(f"bay_frame_{z0}", right, right + 0.14, z0, z1, 0, 3.5, "clay")
    block("bay_frame_head", right, right + 0.14, 0.4, 3.6, 3.1, 3.5, "clay")
    block("canopy", right, 22.8, -0.15, 3.95, 5.0, 5.2, "trim", bevel=0.03)
    block("canopy_post", 22.55, 22.7, -0.07, 0.07, -0.5, 5.0, "steel")
    for x in (20.2, 21.3, 22.4):
        m.cylinder(f"canopy_light_{x}", 0.15, 0.03, (x, -1.9, 4.99), "tube", segments=12)
    # The yard: the road leaves the bay along the line, then bends toward the viewer, and trees
    # stand on soft shade beside it.
    turn, radius = 30.0, 6.0
    bend = [(turn + radius * math.sin(math.radians(a)), -(2.0 + radius - radius * math.cos(math.radians(a)))) for a in range(0, 91, 10)]
    road = [(16.0, -2.0)] + bend + [(turn + radius, -46.0)]
    m.ribbon("road", road, 4.4, -0.492, "road")
    walked = 0.0
    for (ax, ay), (bx, by) in zip(road, road[1:]):
        length = math.hypot(bx - ax, by - ay)
        while walked < length:
            u = walked / length
            m.box(f"dash_{ax}_{walked}", (0.9, 0.12, 0.004), (ax + (bx - ax) * u, ay + (by - ay) * u, -0.49), "dash", bevel=0, rotation=(0, 0, math.atan2(by - ay, bx - ax)))
            walked += 2.0
        walked -= length
    trees = [(31.6, 9.5, 1.1), (32.4, 14.5, 1.2), (32.2, 19.5, 1.0), (39.0, 12.0, 1.3), (39.8, 18.0, 1.1), (24.5, -5.5, 1.2), (27.5, -3.0, 1.0)]
    for index, (x, z, size) in enumerate(trees):
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=True, segments=16, radius=1.0 * size)
        m._link(f"shade_{index}", bm, "shade", (x, -z, -0.485), (0, 0, 0), 0)
        m.cylinder(f"trunk_{index}", 0.12 * size, 1.1 * size, (x, -z, -0.5 + 0.55 * size), "bark", segments=8)
        m.crown(f"crown_{index}", 0.95 * size, (x, -z, -0.5 + 1.55 * size))
        m.crown(f"crown_top_{index}", 0.62 * size, (x + 0.25 * size, -z + 0.2 * size, -0.5 + 2.25 * size))
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
    rack_stock,
    forklift,
    truck,
    carton_stock,
    factory_hall,
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


def apply_modifiers(obj):
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)


def finish(model):
    """Bevels applied, the still parts joined into one mesh and each moving part into one."""
    for obj in model.objects():
        if obj.type == "MESH":
            apply_modifiers(obj)
    for group in [model.root, *[child for child in model.root.children if child.name.startswith("move_")]]:
        meshes = [child for child in group.children if child.type == "MESH" and not child.name.startswith("glow_") and child not in model.kept]
        if len(meshes) > 1:
            # Only the empty a part moves round is named move_<role>; its mesh is not.
            join(meshes, f"{group.name.removeprefix('move_')}_parts")
        if meshes:
            # The joined mesh keeps the place and turn of the part it was joined into; both go
            # into its vertices, so it sits unturned at its group's origin and measures true.
            meshes[0].data.transform(meshes[0].matrix_basis)
            meshes[0].matrix_basis = Matrix.Identity(4)


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
        # Blender keeps object names unique, so a later model's move_table would come out as
        # move_table.001; once a model is written, its names are given up for the next one.
        for obj in model.objects():
            obj.name = f"{model.name}/{obj.name}"
        models.append(model)
    if PREVIEW:
        render_preview(models)


main()
