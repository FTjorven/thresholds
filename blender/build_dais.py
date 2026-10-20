"""
Builds the dais mechanism and the archway for Thresholds in Blender, bakes them, and exports a glTF.

Run from the project folder:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python blender/build_dais.py

Makes:
  blender/dais.blend         the scene (open it in Blender to look around or change things)
  blender/dais_baked.jpg     the baked texture: stone color x ambient occlusion
  public/assets/dais.glb     what the game loads: meshes, baked texture, animations

Objects (the game finds them by name):
  Arch                       the archway, used for all four doorways (the game puts the doorway itself in)
  Arch_4                     the final archway, waits under the floor
  Dais_Rings                 empty, the game turns it slowly once the rings are awake
    Dais_Ring_1..3           stone rings lying around the dais, each with glowing studs (Dais_Ring_N_Studs)
  Dais_Socket_1..3           where the lights go, each with a glowing ring (Dais_Socket_N_Glow)

Actions (exported as glTF animations, played by the game's AnimationMixer):
  Awaken_1..3                ring N rises from the floor and settles, tilted, above the dais (4 s)
  Finale                     Arch_4 grinds up out of the dais (5 s)

Blender is Z up, the game is Y up: Blender (x, y, z) becomes (x, z, -y) in the game,
so the front of an archway (game +z) is Blender -y.
"""

import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS = 30

# the same measurements the game uses (js/ruin.js): the doorway opening must line up
OPENING_HALF_WIDTH = 0.95
OPENING_BOTTOM = 0.12
SPRING = 2.62  # where the round top starts (OPENING_BOTTOM + pillar height 2.5)
ARCH_OUTER = 1.45
ARCH_DEPTH = 0.6
DAIS_TOP = 0.3
ARCH_BELOW = -4.4
RING_HEIGHT = 5.2
RINGS = [  # radius, tilt (Blender rotation)
    (1.6, Quaternion((1, 0, 0), 0.45)),
    (1.9, Quaternion((0, 1, 0), 0.4)),
    (2.2, Quaternion((1, 0, 0), 0.1)),
]
SOCKET_RADIUS = 1.25

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS


# --- mesh helpers ---

def new_object(name, bm, parent=None, location=(0, 0, 0)):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    return obj


def append(bm, part):
    """add the geometry of one bmesh to another"""
    mesh = bpy.data.meshes.new('tmp')
    part.to_mesh(mesh)
    part.free()
    bm.from_mesh(mesh)
    bpy.data.meshes.remove(mesh)


def box(size, center):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(center) @ Matrix.Diagonal((*size, 1)))
    return bm


def prism(outline, depth):
    """a 2D outline (x, z) extruded along y, centered: the archway's shape"""
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((x, -depth / 2, z)) for x, z in outline])
    extruded = bmesh.ops.extrude_face_region(bm, geom=[face], use_keep_orig=True)
    moved = [v for v in extruded['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0, depth, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def bevel_sharp(bm, offset=0.025):
    """round off the hard edges a little, so they catch light and ambient occlusion"""
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle() > 0.6]
    bmesh.ops.bevel(bm, geom=edges, offset=offset, segments=2, affect='EDGES', profile=0.5)


def arc(radius, start, end, segments=16, center=(0, SPRING)):
    return [
        (center[0] + math.cos(a) * radius, center[1] + math.sin(a) * radius)
        for a in (start + (end - start) * i / segments for i in range(segments + 1))
    ]


def torus(major, minor, major_segments=48, minor_segments=6):
    bm = bmesh.new()
    rows = []
    for i in range(major_segments):
        u = i / major_segments * math.tau
        rows.append([
            bm.verts.new((
                (major + minor * math.cos(v)) * math.cos(u),
                (major + minor * math.cos(v)) * math.sin(u),
                minor * math.sin(v),
            ))
            for v in (j / minor_segments * math.tau for j in range(minor_segments))
        ])
    for i in range(major_segments):
        a, b = rows[i], rows[(i + 1) % major_segments]
        for j in range(minor_segments):
            k = (j + 1) % minor_segments
            bm.faces.new((a[j], b[j], b[k], a[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


# --- the archway ---

def build_arch(name, location=(0, 0, 0)):
    bm = bmesh.new()
    # pillars and the round top as one U shape
    outline = (
        [(-ARCH_OUTER, 0)]
        + arc(ARCH_OUTER, math.pi, 0)
        + [(ARCH_OUTER, 0), (OPENING_HALF_WIDTH, 0)]
        + arc(OPENING_HALF_WIDTH, 0, math.pi)
        + [(-OPENING_HALF_WIDTH, 0)]
    )
    shape = prism(outline, ARCH_DEPTH)
    bevel_sharp(shape)
    append(bm, shape)
    for side in (-1, 1):
        x = side * (OPENING_HALF_WIDTH + ARCH_OUTER) / 2
        plinth = box((0.68, 0.74, 0.36), (x, 0, 0.18))  # a wider foot
        bevel_sharp(plinth, 0.03)
        append(bm, plinth)
        capital = box((0.64, 0.72, 0.14), (x, 0, SPRING - 0.05))  # a ledge where the round top starts
        bevel_sharp(capital, 0.02)
        append(bm, capital)
    keystone = box((0.42, 0.72, 0.62), (0, 0, SPRING + OPENING_HALF_WIDTH + 0.28))  # the carving sits on its front
    bevel_sharp(keystone, 0.03)
    append(bm, keystone)
    step = box((3.0, 1.2, OPENING_BOTTOM), (0, 0, OPENING_BOTTOM / 2))
    bevel_sharp(step, 0.02)
    append(bm, step)
    return new_object(name, bm, location=location)


# --- the dais mechanism ---

rings_parent = bpy.data.objects.new('Dais_Rings', None)
scene.collection.objects.link(rings_parent)

rings, studs = [], []
for i, (radius, _) in enumerate(RINGS):
    ring = new_object(f'Dais_Ring_{i + 1}', torus(radius, 0.07), parent=rings_parent, location=(0, 0, 0.035))
    ring.rotation_mode = 'QUATERNION'
    bm = bmesh.new()
    for k in range(8):  # glowing studs around the ring, so you can see it turn
        u = k / 8 * math.tau + i
        stud = bmesh.new()
        bmesh.ops.create_cube(
            stud,
            size=1,
            matrix=Matrix.Translation((math.cos(u) * radius, math.sin(u) * radius, 0))
            @ Matrix.Rotation(u, 4, 'Z')
            @ Matrix.Diagonal((0.16, 0.09, 0.16, 1)),
        )
        append(bm, stud)
    studs.append(new_object(f'Dais_Ring_{i + 1}_Studs', bm, parent=ring))
    rings.append(ring)

sockets, socket_glows = [], []
for i in range(3):
    angle = math.pi + i * math.tau / 3  # facing its archway (same angles as the game)
    position = (math.sin(angle) * SOCKET_RADIUS, -math.cos(angle) * SOCKET_RADIUS, DAIS_TOP)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.21, radius2=0.16, depth=0.12,
                          matrix=Matrix.Translation((0, 0, 0.06)))
    bevel_sharp(bm, 0.015)
    socket = new_object(f'Dais_Socket_{i + 1}', bm, location=position)
    glow = torus(0.12, 0.022, 24, 6)
    bmesh.ops.translate(glow, verts=glow.verts[:], vec=(0, 0, 0.125))
    socket_glows.append(new_object(f'Dais_Socket_{i + 1}_Glow', glow, parent=socket))
    sockets.append(socket)

arch = build_arch('Arch', location=(0, 14, 0))  # out of the way: the game copies it into place
arch_4 = build_arch('Arch_4', location=(0, 0, DAIS_TOP))  # risen, for baking; animated down below
stone_objects = [arch, arch_4, *rings, *sockets]
glow_objects = [*studs, *socket_glows]

for obj in [*stone_objects, *glow_objects]:
    for polygon in obj.data.polygons:
        polygon.use_smooth = False


# --- materials ---

def stone_material():
    """procedural stone: two layers of noise, for the bake"""
    material = bpy.data.materials.new('Stone')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes['Principled BSDF']
    coords = nodes.new('ShaderNodeTexCoord')
    big = nodes.new('ShaderNodeTexNoise')
    big.inputs['Scale'].default_value = 1.8
    big.inputs['Detail'].default_value = 6
    fine = nodes.new('ShaderNodeTexNoise')
    fine.inputs['Scale'].default_value = 14
    fine.inputs['Detail'].default_value = 8
    links.new(coords.outputs['Object'], big.inputs['Vector'])
    links.new(coords.outputs['Object'], fine.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.16, 0.15, 0.135, 1)
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = (0.42, 0.40, 0.36, 1)
    links.new(big.outputs['Fac'], ramp.inputs['Fac'])
    speckle = nodes.new('ShaderNodeMix')
    speckle.data_type = 'RGBA'
    speckle.blend_type = 'MULTIPLY'
    speckle.inputs['Factor'].default_value = 0.35
    links.new(ramp.outputs['Color'], speckle.inputs['A'])
    links.new(fine.outputs['Color'], speckle.inputs['B'])
    links.new(speckle.outputs['Result'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.9
    return material


def glow_material():
    material = bpy.data.materials.new('Glow')
    material.use_nodes = True
    bsdf = material.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.8, 0.85, 1, 1)
    bsdf.inputs['Emission Color'].default_value = (0.8, 0.85, 1, 1)
    bsdf.inputs['Emission Strength'].default_value = 2
    return material


stone = stone_material()
glow = glow_material()
for obj in stone_objects:
    obj.data.materials.append(stone)
for obj in glow_objects:
    obj.data.materials.append(glow)


# --- UVs: every stone object shares one texture, so unwrap them together ---

bpy.ops.object.select_all(action='DESELECT')
for obj in stone_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = stone_objects[0]
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
bpy.ops.uv.pack_islands(margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')


# --- baking ---
# The rings are baked where they end up (hanging above the dais), the final archway risen on the dais:
# the poses you see them in most. Helpers (floor, dais) only give the ambient occlusion something to touch.

for i, ring in enumerate(rings):
    ring.location = (0, 0, RING_HEIGHT)
    ring.rotation_quaternion = RINGS[i][1]

helpers = []
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40)
helpers.append(new_object('Bake_Floor', bm))
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=9, radius1=1.5, radius2=1.4, depth=DAIS_TOP,
                      matrix=Matrix.Translation((0, 0, DAIS_TOP / 2)))
helpers.append(new_object('Bake_Dais', bm))

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 64
scene.render.bake.margin = 8
world = bpy.data.worlds.new('World')
scene.world = world
world.light_settings.distance = 1.2  # ambient occlusion reach, in meters

SIZE = 2048
color_image = bpy.data.images.new('Dais_Color', SIZE, SIZE)
ao_image = bpy.data.images.new('Dais_AO', SIZE, SIZE)
image_node = stone.node_tree.nodes.new('ShaderNodeTexImage')

bpy.ops.object.select_all(action='DESELECT')
for obj in stone_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = stone_objects[0]

stone.node_tree.nodes.active = image_node
image_node.image = color_image
print('baking color…')
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})
image_node.image = ao_image
print('baking ambient occlusion…')
bpy.ops.object.bake(type='AO')

# combine: color x ambient occlusion (never fully black, the game still lights it)
color = np.empty(SIZE * SIZE * 4, dtype=np.float32)
ao = np.empty(SIZE * SIZE * 4, dtype=np.float32)
color_image.pixels.foreach_get(color)
ao_image.pixels.foreach_get(ao)
baked = color.reshape(-1, 4).copy()
baked[:, :3] *= (0.25 + 0.75 * ao.reshape(-1, 4)[:, :1])
baked_image = bpy.data.images.new('Dais_Baked', SIZE, SIZE)
baked_image.pixels.foreach_set(baked.ravel())
baked_image.filepath_raw = os.path.join(PROJECT, 'blender', 'dais_baked.jpg')
baked_image.file_format = 'JPEG'
baked_image.save()

# the material the game gets: just the baked texture
nodes, links = stone.node_tree.nodes, stone.node_tree.links
for node in list(nodes):
    if node.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'):
        nodes.remove(node)
texture = nodes.new('ShaderNodeTexImage')
texture.image = baked_image
links.new(texture.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])

for helper in helpers:
    bpy.data.objects.remove(helper)


# --- animations ---

def ease_in_out(t):
    return t * t * (3 - 2 * t)


def ease_out(t):
    return 1 - (1 - t) ** 3


def animate(obj, action_name, seconds, pose):
    """key the object every frame: pose(t) sets its transform for t from 0 to 1"""
    frames = round(seconds * FPS)
    for frame in range(frames + 1):
        pose(frame / frames)
        obj.keyframe_insert('location', frame=frame)
        if obj.rotation_mode == 'QUATERNION':
            obj.keyframe_insert('rotation_quaternion', frame=frame)
    obj.animation_data.action.name = action_name


for i, ring in enumerate(rings):
    tilt = RINGS[i][1]

    def pose(t, ring=ring, tilt=tilt):
        e = ease_in_out(t)
        # rises, overshoots a little, settles
        ring.location = (0, 0, 0.035 + (RING_HEIGHT - 0.035) * e + math.sin(t * math.pi) * 0.4)
        # one and a half turns around its own axis while it tilts into place
        ring.rotation_quaternion = Quaternion().slerp(tilt, e) @ Quaternion((0, 0, 1), e * math.pi * 3)

    animate(ring, f'Awaken_{i + 1}', 4, pose)


def finale_pose(t):
    # grinds up out of the dais, shaking, slowing down at the top
    arch_4.location = (math.sin(t * 90) * 0.025 * (1 - t), 0, ARCH_BELOW + (DAIS_TOP - ARCH_BELOW) * ease_out(t))


animate(arch_4, 'Finale', 5, finale_pose)

scene.frame_start = 0
scene.frame_end = 5 * FPS
scene.frame_set(0)  # the rest pose: rings on the floor, the final archway under it


# --- save and export ---

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(PROJECT, 'blender', 'dais.blend'))

os.makedirs(os.path.join(PROJECT, 'public', 'assets'), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(PROJECT, 'public', 'assets', 'dais.glb'),
    export_format='GLB',
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
    export_image_format='JPEG',
    export_yup=True,
)
print('done')
