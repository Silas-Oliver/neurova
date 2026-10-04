"""Neurova render -- scene, camera and lighting rig.

Run from Blender's Scripting tab: open this file, press Run. It is safe to run
again; it clears anything it made last time rather than stacking a second rig.

What it does NOT do is model anything. The glove is yours to build. This sets up
everything around it, which is the part that decides whether a render reads as a
product shot or as a 3D exercise.
"""

import bpy
import math
from mathutils import Vector

RIG_PREFIX = "NV_"          # everything this script owns is named with it
RESOLUTION = (2400, 1350)   # 16:9, large enough to crop down afterwards
SAMPLES = 256               # raise to 512 for a final; 128 is fine while posing


def clear_rig():
    """Remove a previous run so repeated runs do not stack lights."""
    for obj in list(bpy.data.objects):
        if obj.name.startswith(RIG_PREFIX):
            bpy.data.objects.remove(obj, do_unlink=True)


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'

    # GPU where there is one. Falls back silently on a machine without.
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.get_devices()
        for compute in ('METAL', 'OPTIX', 'CUDA', 'HIP'):
            try:
                prefs.compute_device_type = compute
                break
            except TypeError:
                continue
        scene.cycles.device = 'GPU'
    except Exception:
        scene.cycles.device = 'CPU'

    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.caustics_reflective = False   # noise you do not need on fabric
    scene.cycles.caustics_refractive = False

    scene.render.resolution_x, scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = True       # transparent background, composite later

    # AgX in 4.x, Filmic in 3.x. Standard blows out the highlights on white fabric.
    for transform in ('AgX', 'Filmic'):
        try:
            scene.view_settings.view_transform = transform
            break
        except TypeError:
            continue
    scene.view_settings.look = 'None'


def setup_world(strength=0.35):
    """A dim even fill so nothing goes black. The area lights do the real work."""
    world = bpy.data.worlds.get("NV_World") or bpy.data.worlds.new("NV_World")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.92, 0.95, 0.93, 1.0)
        bg.inputs[1].default_value = strength


def add_area_light(name, location, rotation, size, energy):
    light_data = bpy.data.lights.new(name=RIG_PREFIX + name, type='AREA')
    light_data.shape = 'RECTANGLE'
    light_data.size = size[0]
    light_data.size_y = size[1]
    light_data.energy = energy
    obj = bpy.data.objects.new(RIG_PREFIX + name, light_data)
    obj.location = location
    obj.rotation_euler = [math.radians(a) for a in rotation]
    bpy.context.collection.objects.link(obj)
    return obj


def setup_lights(subject_height=0.12):
    """Three-point, scaled to a hand-sized subject about 12cm tall.

    Big soft key, dimmer fill to keep the shadow side readable, and a rim behind
    to separate the glove from the background. The rim is the one most people
    leave out and the one that makes a product look photographed.
    """
    s = subject_height / 0.12

    add_area_light("Key",
                   location=(0.42 * s, -0.48 * s, 0.46 * s),
                   rotation=(55, 0, 42),
                   size=(0.9 * s, 0.9 * s),
                   energy=140 * s * s)

    add_area_light("Fill",
                   location=(-0.55 * s, -0.35 * s, 0.18 * s),
                   rotation=(78, 0, -55),
                   size=(1.2 * s, 1.2 * s),
                   energy=45 * s * s)

    add_area_light("Rim",
                   location=(-0.18 * s, 0.62 * s, 0.42 * s),
                   rotation=(55, 0, 200),
                   size=(0.5 * s, 0.5 * s),
                   energy=120 * s * s)


def setup_camera(target=(0.0, 0.0, 0.06), distance=0.62, lens=90):
    """90mm at a bit of distance. Anything wider than about 50mm bends the
    fingers outward and reads as a phone snap rather than a product shot."""
    cam_data = bpy.data.cameras.new(RIG_PREFIX + "Camera")
    cam_data.lens = lens
    cam_data.dof.use_dof = True
    cam_data.dof.aperture_fstop = 4.0

    cam = bpy.data.objects.new(RIG_PREFIX + "Camera", cam_data)
    bpy.context.collection.objects.link(cam)

    # Three-quarter view, slightly above. Straight-on flattens the glove.
    cam.location = (distance * 0.62, -distance * 0.72, target[2] + distance * 0.42)

    target_obj = bpy.data.objects.new(RIG_PREFIX + "Target", None)
    target_obj.location = target
    target_obj.empty_display_size = 0.02
    bpy.context.collection.objects.link(target_obj)

    track = cam.constraints.new(type='TRACK_TO')
    track.target = target_obj
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'

    cam_data.dof.focus_object = target_obj
    bpy.context.scene.camera = cam
    return cam


def main():
    clear_rig()
    setup_render()
    setup_world()
    setup_lights()
    setup_camera()
    print("Neurova rig ready. Model the glove around the origin, roughly 12cm tall.")


if __name__ == "__main__":
    main()
