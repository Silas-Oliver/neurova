"""Neurova render -- prepare an imported mesh.

Run with the imported hand selected, before glove_shell.py.

An .obj carries no units, no orientation convention you can rely on, and often
no sane normals. Each of those breaks the shell script quietly rather than
loudly, which is worse: you get a shell that looks like nothing happened and no
error explaining it.

This normalises all three and tells you what it found.
"""

import bpy

TARGET_LENGTH = 0.19   # a hand, wrist to fingertip, in metres


def report(obj, label):
    d = obj.dimensions
    print("%s  dimensions: %.4f x %.4f x %.4f m  (longest %.4f)"
          % (label, d.x, d.y, d.z, max(d)))


def scale_to_life(obj, target=TARGET_LENGTH):
    """An .obj's units are whatever the exporter felt like. Blender reads one
    unit as one metre, so a hand modelled in centimetres arrives 100x too big
    and a hand modelled in inches arrives at 48cm."""
    longest = max(obj.dimensions)
    if longest <= 0:
        print("  mesh has no size; nothing to scale")
        return 1.0
    factor = target / longest
    if 0.97 < factor < 1.03:
        print("  already life sized, leaving it")
        return 1.0
    obj.scale = [s * factor for s in obj.scale]
    print("  scaled by %.4f to bring the longest axis to %.3f m" % (factor, target))
    return factor


def topology(obj):
    """Shrinkwrap copes with triangles. Subdivision does not -- a triangulated
    mesh subdivides into a mess of poles, and the shell inherits every one."""
    tris = quads = ngons = 0
    for poly in obj.data.polygons:
        n = len(poly.vertices)
        if n == 3:
            tris += 1
        elif n == 4:
            quads += 1
        else:
            ngons += 1
    total = tris + quads + ngons
    if total == 0:
        return
    print("  faces: %d tris, %d quads, %d ngons" % (tris, quads, ngons))
    if tris > total * 0.6:
        print("  WARNING mostly triangles. Drop SHRINK_LEVELS to 1 in")
        print("  glove_shell.py, or the subdivision will produce a lumpy shell.")


def main():
    obj = bpy.context.active_object
    if obj is None or obj.type != 'MESH':
        print("Select the imported mesh first, then run this.")
        return

    report(obj, "before")

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    scale_to_life(obj)

    # Bake scale and rotation in. glove_shell.py offsets by 1.5mm in world
    # units, and an unapplied scale multiplies that silently.
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # Normals facing out. Shrinkwrap with an offset pushes along the normal, so
    # inverted normals put the glove shell inside the hand.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    bpy.ops.object.shade_smooth()
    obj.data.use_auto_smooth = True if hasattr(obj.data, "use_auto_smooth") else None

    report(obj, "after ")
    topology(obj)
    print("Ready for glove_shell.py.")


if __name__ == "__main__":
    main()
