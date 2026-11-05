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

The welding robot's arm, the truck's cab and wheels, the forklift, the band saw, the drill press,
the grinder and the measuring machine start from meshes generated from a written description
(generated/, see its README). Their builders cut, paint and fit those meshes and keep to the same
rules as the rest.
"""

import math
import os
import sys
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT_DIR = argv[0] if argv else "public/models"
PREVIEW = argv[1] if len(argv) > 1 else None
# Meshes generated from a written description of each machine (see README), kept as they came
# out; the builders below cut, paint and fit them.
GENERATED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "generated")


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

    def adopt(self, piece, mat, shape, split=None):
        """Takes in a generated piece: moved into the model by shape, painted mat, or with split
        (other, test) painted other on the faces test picks, then thinned and its edges kept
        sharp only where they turn more than 35 degrees."""
        obj, mesh = piece.obj, piece.obj.data
        mesh.materials.clear()
        mesh.materials.append(material(mat))
        if split:
            other, test = split
            mesh.materials.append(material(other))
            for polygon in mesh.polygons:
                polygon.material_index = 1 if test(polygon) else 0
        mesh.transform(shape)
        if len(mesh.vertices) > 60:
            obj.modifiers.new("thin", "DECIMATE").ratio = 0.75
            apply_modifiers(obj)
        with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
        obj.name = mesh.name = f"{self.name}_piece"
        self.made.append(obj)
        self._place(obj, (0, 0, 0))
        return obj

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


class Piece:
    """One loose part of a generated mesh and its bounds, in the mesh's own units."""

    def __init__(self, obj):
        self.obj = obj
        points = [vertex.co for vertex in obj.data.vertices]
        self.lo = Vector([min(point[i] for point in points) for i in range(3)])
        self.hi = Vector([max(point[i] for point in points) for i in range(3)])
        self.center = (self.lo + self.hi) / 2
        self.size = self.hi - self.lo
        skin = 2 * (self.size.x * self.size.y + self.size.y * self.size.z + self.size.z * self.size.x)
        # How much of its bounding box's skin it covers: wires and thin rods score low.
        self.fill = sum(polygon.area for polygon in obj.data.polygons) / skin if skin else 0


def generated(name, turn=0.0):
    """The loose parts of generated/<name>.glb, turned turn degrees round Z, largest first."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(GENERATED, f"{name}.glb"))
    new = [obj for obj in bpy.data.objects if obj not in before]
    source = next(obj for obj in new if obj.type == "MESH")
    source.data.transform(Matrix.Rotation(math.radians(turn), 4, "Z") @ source.matrix_world)
    source.parent = None
    source.matrix_world = Matrix.Identity(4)
    for obj in new:
        if obj is not source:
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = source
    source.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    pieces = [Piece(obj) for obj in bpy.data.objects if obj.type == "MESH" and obj not in before]
    return sorted(pieces, key=lambda piece: -len(piece.obj.data.vertices))


def drop(pieces):
    for piece in pieces:
        bpy.data.objects.remove(piece.obj, do_unlink=True)


def tidy(pieces, least=0.012):
    """The pieces that read at the app's distance: wires and cable loops (thin skins) and specks
    smaller than least go."""
    kept = [piece for piece in pieces if piece.fill >= 0.15 and max(piece.size) >= least]
    drop([piece for piece in pieces if piece not in kept])
    return kept


def fitted(pieces, height=None, length=None):
    """The shape that stands the pieces on the floor, centered on the origin, scaled to a height
    or to a length along X, and that scale."""
    lo = Vector([min(piece.lo[i] for piece in pieces) for i in range(3)])
    hi = Vector([max(piece.hi[i] for piece in pieces) for i in range(3)])
    scale = height / (hi.z - lo.z) if height else length / (hi.x - lo.x)
    return Matrix.Scale(scale, 4) @ Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)), scale


def volume(piece):
    return piece.size.x * piece.size.y * piece.size.z


def wheels_of(pieces, tires):
    """Each tire with the pieces wholly inside its bounds (rim, hub, nuts): one wheel apiece."""
    groups = []
    taken = set(id(tire) for tire in tires)
    for tire in tires:
        group = [tire]
        for piece in pieces:
            if id(piece) in taken:
                continue
            if all(tire.lo[i] - 0.005 <= piece.lo[i] and piece.hi[i] <= tire.hi[i] + 0.005 for i in range(3)):
                group.append(piece)
                taken.add(id(piece))
        groups.append(group)
    return groups


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
    # The generated arm on a riser at the left, turned so its torch reaches over the work on the
    # table at the right and scaled so its tip stops just over the seam at the rib's foot.
    pieces = generated("welding_arm")
    body = pieces[0]
    foot = [vertex.co for vertex in body.obj.data.vertices if vertex.co.z < 0.01]
    foot = Vector((sum(co.x for co in foot) / len(foot), sum(co.y for co in foot) / len(foot), 0))
    torch = min((vertex.co for piece in pieces if piece.lo.x > 0.4 for vertex in piece.obj.data.vertices), key=lambda co: co.z)
    pivot, tip = Vector((-0.6, 0.15, 0)), Vector((0.44, 0.15, 0.9))
    scale = (tip - pivot).xy.length / (torch - foot).xy.length
    lift = tip.z - scale * torch.z
    turn = math.atan2(*reversed((tip - pivot).xy)) - math.atan2(*reversed((torch - foot).xy))
    shape = Matrix.Translation(pivot + Vector((0, 0, lift))) @ Matrix.Rotation(turn, 4, "Z") @ Matrix.Scale(scale, 4) @ Matrix.Translation(-foot)
    # Its own floor flange goes for the riser's still base, which the arm turns on.
    cut = 0.098
    bm = bmesh.new()
    bm.from_mesh(body.obj.data)
    bmesh.ops.delete(bm, geom=[face for face in bm.faces if face.calc_center_median().z < cut], context="FACES")
    bmesh.ops.delete(bm, geom=[vertex for vertex in bm.verts if not vertex.link_faces], context="VERTS")
    bm.to_mesh(body.obj.data)
    bm.free()
    with m.moving("arm", (pivot.x, pivot.y, lift)):
        for index, piece in enumerate(pieces):
            # The control box at its foot and the cable from it; wires, pins and bolts, which
            # read as specks at the app's distance. The torch tip stays.
            x, y, z = piece.center
            if x < -0.25 or (y > 0.04 and x < -0.07 and z < 0.2) or ((piece.fill < 0.15 or max(piece.size) < 0.04) and piece.lo.x < 0.465):
                drop([piece])
                continue
            if index < 2:
                mat = "clay"
            elif piece.lo.z > 0.1 and piece.hi.z < 0.125 and piece.size.x > 0.15:
                mat = "steel"
            elif piece.lo.x > 0.465:
                mat = "steel"
            elif piece.lo.x > 0.4:
                mat = "ink"
            else:
                mat = "panel"
            m.adopt(piece, mat, shape)
        m.mark("tip_torch", tuple(tip))
    m.box("riser", (0.8, 0.8, lift), (-0.6, 0.15, 0), "panel", bevel=0.05)
    m.cylinder("robot_flange", 0.34, 0.05, (-0.6, 0.15, lift + 0.025), "ink", segments=24, bevel=0.015)
    top = lift + scale * cut + 0.005
    m.cylinder("robot_base", 0.27, top - lift, (-0.6, 0.15, (lift + top) / 2), "ink", segments=24, bevel=0.02)
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
    # The generated surface grinder: the table, its chuck and its end stop slide to and fro on the
    # bed under the wheel. At rest they sit a little left, so their travel clears the column at
    # the right; at the left end of it the table runs out past the bed, as a long stroke does.
    pieces = tidy(generated("grinder"))
    shape, scale = fitted(pieces, length=2.3)
    bed = max((piece for piece in pieces if 0.3 < piece.hi.z < 0.4), key=lambda piece: piece.size.x * piece.size.y)
    table = [
        piece
        for piece in pieces
        if piece is not bed and piece.lo.z >= bed.hi.z - 0.025 and piece.hi.z < bed.hi.z + 0.03 and piece.hi.x < 0.2
    ]
    slid = shape @ Matrix.Translation((-0.06, 0, 0))
    lo = Vector([min(piece.lo[i] for piece in table) for i in range(3)])
    hi = Vector([max(piece.hi[i] for piece in table) for i in range(3)])
    with m.moving("table", tuple(slid @ Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z)))):
        for piece in table:
            m.adopt(piece, "panel" if piece is max(table, key=volume) else "steel", slid)
    rest = [piece for piece in pieces if piece not in table]
    guard = max((piece for piece in rest if piece.lo.z > 0.42 and piece.hi.z < 0.6 and piece.center.x < 0.15), key=lambda piece: len(piece.obj.data.vertices))
    for piece in rest:
        if piece is guard:
            mat = "clay"
        elif piece is bed:
            mat = "trim"
        elif volume(piece) > 0.004 and piece.hi.z < 0.36:
            mat = "body"
        elif piece.lo.z > 0.4 and volume(piece) > 0.0004:
            mat = "trim"
        else:
            mat = "ink"
        m.adopt(piece, mat, shape)
    m.lamp(tuple(shape @ Vector((bed.hi.x - 0.03, bed.hi.y - 0.03, bed.hi.z))), pole=0.4)
    return m


def drill_press():
    m = Model("drill_press")
    # The generated drill press, its spindle and bit turned toward -Y; they come down onto the
    # table while it drills.
    pieces = tidy(generated("drill_press", turn=90))
    shape, scale = fitted(pieces, height=2.2)
    spindle = [piece for piece in pieces if 0.45 < piece.lo.z and piece.hi.z < 0.75 and -0.06 < piece.center.x < 0.04 and -0.135 < piece.center.y < -0.04]
    lo = Vector([min(piece.lo[i] for piece in spindle) for i in range(3)])
    hi = Vector([max(piece.hi[i] for piece in spindle) for i in range(3)])
    with m.moving("spindle", tuple(shape @ Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z)))):
        for piece in spindle:
            m.adopt(piece, "ink" if piece.hi.z < lo.z + 0.1 else "steel", shape)
    rest = [piece for piece in pieces if piece not in spindle]
    head = max((piece for piece in rest if piece.lo.z > 0.6), key=volume)
    cover = max((piece for piece in rest if piece.lo.z > 0.9), key=volume)
    for piece in rest:
        if piece is head:
            mat = "body"
        elif piece is cover:
            mat = "clay"
        elif piece.size.z > 0.5 or (piece.size.x > 0.3 and piece.size.z < 0.05 and piece.lo.z > 0.3):
            mat = "steel"
        elif (piece.center.y > 0.09 and piece.lo.z > 0.7) or (piece.hi.z < 0.06 and piece.size.x > 0.3):
            mat = "panel"
        else:
            mat = "ink"
        m.adopt(piece, mat, shape)
    m.lamp(tuple(shape @ Vector((cover.hi.x - 0.04, cover.hi.y - 0.04, cover.hi.z))), pole=0.2)
    return m


def inspection_table():
    m = Model("inspection_table")
    # The generated measuring machine: its bridge rides to and fro over the granite, the ram and
    # probe with it. The box behind its right leg goes and its monitor moves a little forward,
    # so the legs pass both.
    pieces = tidy(generated("inspection_table"))
    shape, scale = fitted(pieces, height=2.6)
    bridge = [
        piece
        for piece in pieces
        if piece.hi.z > 0.7 or (piece.lo.z > 0.37 and abs(piece.center.x) < 0.06 and -0.03 < piece.center.y < 0.08)
    ]
    legs = [piece for piece in bridge if piece.size.z > 0.5]
    behind = [piece for piece in pieces if piece not in bridge and piece.lo.x > 0.24 and piece.lo.y > 0.09 and piece.hi.z > 0.3]
    drop(behind)
    pieces = [piece for piece in pieces if piece not in behind]
    lo = Vector([min(piece.lo[i] for piece in bridge) for i in range(3)])
    hi = Vector([max(piece.hi[i] for piece in bridge) for i in range(3)])
    with m.moving("bridge", tuple(shape @ Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z)))):
        for piece in bridge:
            if piece in legs or piece.size.x > 0.4:
                mat = "body"
            elif piece.hi.z < 0.43:
                mat = "clay"
            else:
                mat = "panel"
            m.adopt(piece, mat, shape)
    forward = shape @ Matrix.Translation((0, -0.07, 0))
    rest = [piece for piece in pieces if piece not in bridge]
    granite = max((piece for piece in rest if abs(piece.center.x) < 0.05), key=volume)
    for piece in rest:
        monitor = piece.center.x > 0.2 and piece.center.y < -0.05 and piece.lo.z > 0.2
        if piece is granite:
            mat = "ink"
        elif monitor:
            mat = "panel" if piece is max(rest, key=lambda other: other.size.x * other.size.z if other.center.x > 0.2 and other.center.y < -0.05 else 0) else "steel"
        elif volume(piece) > 0.005:
            mat = "body"
        elif piece.lo.z > granite.hi.z - 0.01:
            mat = "trim"
        else:
            mat = "ink"
        m.adopt(piece, mat, forward if monitor else shape)
    side = max((piece for piece in rest if piece.center.x > 0.2), key=volume)
    m.lamp(tuple(shape @ Vector((side.center.x, side.hi.y - 0.04, side.hi.z))), pole=0.35)
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
    # The generated band saw: a cabinet base with the bar in its vise, and over the vise the saw
    # frame, wheel housing at each end, which comes down through the bar. All that stands clear
    # above the bar rides with the frame.
    pieces = tidy(generated("cutter"))
    shape, scale = fitted(pieces, height=1.87)
    frame = [piece for piece in pieces if piece.lo.z > 0.47]
    lo = Vector([min(piece.lo[i] for piece in frame) for i in range(3)])
    hi = Vector([max(piece.hi[i] for piece in frame) for i in range(3)])
    with m.moving("head", tuple(shape @ Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z)))):
        for piece in frame:
            if piece.size.z < 0.05 and piece.size.x > 0.3:
                mat = "steel"
            elif max(piece.size) > 0.1:
                mat = "clay"
            else:
                mat = "ink"
            m.adopt(piece, mat, shape)
    rest = [piece for piece in pieces if piece not in frame]
    base = max(rest, key=volume)
    for piece in rest:
        if piece is base:
            mat = "panel"
        elif piece.size.x > 0.8:
            mat = "steel"
        elif piece.lo.z < 0.01:
            mat = "ink"
        elif piece.size.x > 0.4 and piece.size.z < 0.1:
            mat = "trim"
        else:
            mat = "ink"
        m.adopt(piece, mat, shape)
    m.lamp(tuple(shape @ Vector((base.hi.x - 0.03, base.lo.y + 0.03, base.hi.z))), pole=0.25)
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
    # The generated forklift, its forks turned toward -Y. Its fork heels stand at the origin; a
    # pallet it carries sits centered 0.55 m in front (-Y).
    pieces = tidy(generated("forklift", turn=90))
    lift = [piece for piece in pieces if piece.hi.y < -0.14]
    # Centered across its body, as its forks sit a little to one side.
    tines = [vertex.co for piece in lift for vertex in piece.obj.data.vertices if vertex.co.z < 0.045]
    heel = Vector(((min(piece.lo.x for piece in pieces) + max(piece.hi.x for piece in pieces)) / 2, max(co.y for co in tines), 0))
    shape = Matrix.Scale(2.17 / max(piece.hi.z for piece in pieces), 4) @ Matrix.Translation(-heel)
    tires = {}
    for piece in pieces:
        if piece in lift or piece.lo.z > 0.03 or piece.size.z < 0.12:
            continue
        key = (piece.center.x > heel.x, piece.center.y > 0.15)
        if key not in tires or len(piece.obj.data.vertices) > len(tires[key].obj.data.vertices):
            tires[key] = piece
    wheels = wheels_of([piece for piece in pieces if piece not in lift], list(tires.values()))
    # The forks and their carriage rise; the rest stands, the overhead guard dark over the body.
    with m.apart("lift", (0, 0, 0)):
        for piece in lift:
            m.adopt(piece, "steel", shape)
    for group in wheels:
        tire = group[0]
        at = shape @ tire.center
        name = f"wheel_{'rear' if at.y > 1.0 else 'front'}_{'right' if at.x > 0 else 'left'}"
        with m.apart(name, tuple(at)):
            for piece in group:
                m.adopt(piece, "ink" if piece is tire else "trim", shape)
    taken = set(id(piece) for group in wheels for piece in group) | set(id(piece) for piece in lift)
    rest = [piece for piece in pieces if id(piece) not in taken]
    m.adopt(rest[0], "clay", shape, split=("panel", lambda face: face.center.z > 0.47))
    for piece in rest[1:]:
        m.adopt(piece, "panel", shape)
    return m


def truck():
    m = Model("truck")
    # The generated truck's cab and axles under the open cargo box the entrance loads at the
    # dock; its own box, shorter and shut, is left out. It faces +X with the box's rear at x = 0.
    pieces = tidy(generated("truck", turn=180))
    scale = 5.4
    front = [piece for piece in pieces if piece.lo.x > 0.192]
    rear = [piece for piece in pieces if piece.lo.x > -0.375 and piece.hi.x < -0.14 and piece.hi.z < 0.2]
    drop([piece for piece in pieces if piece not in front and piece not in rear])
    tires = [piece for piece in front + rear if piece.lo.z < 0.005 and piece.size.z > 0.15]
    front_shape = Matrix.Translation((6.86 - scale * max(piece.hi.x for piece in front), 0, 0)) @ Matrix.Scale(scale, 4)
    axle = sum(tire.center.x for tire in tires if tire in rear) / 2
    rear_shape = Matrix.Translation((1.5 - scale * axle, 0, 0)) @ Matrix.Scale(scale, 4)
    taken = set()
    for group in wheels_of(front + rear, tires):
        tire = group[0]
        shape = front_shape if tire in front else rear_shape
        at = shape @ tire.center
        with m.apart(f"wheel_{(0 if at.y > 0 else 1) + (2 if at.x > 3 else 0)}", tuple(at)):
            for piece in group:
                m.adopt(piece, "ink" if piece is tire else "trim", shape)
                taken.add(id(piece))
    cab = max(front, key=lambda piece: piece.size.z * piece.size.y)

    def window(face):
        # The windscreen and the door windows: the cab's faces that look ahead or aside
        # between its waist and its roof.
        x, y, z = face.center
        return 0.3 < z < 0.44 and (face.normal.x > 0.55 or (abs(face.normal.y) > 0.8 and x > 0.27))

    for piece in front:
        if id(piece) in taken:
            continue
        bumper = piece.hi.x > 0.47 and piece.hi.z < 0.15 and piece.size.y > 0.3
        if piece is cab:
            m.adopt(piece, "body", front_shape, split=("glass", window))
        else:
            m.adopt(piece, "clay" if bumper else "ink", front_shape)
    for piece in rear:
        if id(piece) not in taken:
            m.adopt(piece, "ink", rear_shape)
    m.box("chassis", (5.6, 0.9, 0.22), (2.9, 0, 0.62), "ink", bevel=0.02)
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
        m.box(f"side_guard_{y}", (2.4, 0.04, 0.06), (3.45, y * 0.96, 0.5), "ink", bevel=0)
    m.box("rear_bumper", (0.1, 2.0, 0.12), (0.15, 0, 0.45), "ink", bevel=0.01)
    for y in (0.85, -0.85):
        m.box(f"tail_light_{y}", (0.04, 0.25, 0.1), (0.1, y, 0.57), "clay", bevel=0.005)
    m.cylinder("fuel_tank", 0.22, 0.9, (3.4, -0.7, 0.62), "steel", axis="X", segments=16, bevel=0.02)
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
