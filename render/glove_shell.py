"""Neurova render -- build a glove shell from a hand mesh.

This is the step that is hard to do by hand and easy to script. Select the hand
mesh, run the file, and it produces a separate shell object sitting just off the
surface with thickness -- which is what a glove is.

It does not sculpt detail. Seams, the cuff edge and the electrode cutouts are
yours; this gives you the form to work on so you are not modelling a hand.
"""

import bpy

OFFSET = 0.0015      # 1.5mm of air between skin and fabric
THICKNESS = 0.0012   # 1.2mm of fabric
SHRINK_LEVELS = 2    # subdivision before shrinkwrap, for a shell that follows


def build_shell(hand):
    bpy.ops.object.select_all(action='DESELECT')
    hand.select_set(True)
    bpy.context.view_layer.objects.active = hand

    bpy.ops.object.duplicate()
    shell = bpy.context.active_object
    shell.name = "NV_GloveShell"

    # Subdivide first: shrinkwrap can only follow a surface as closely as the
    # shell has vertices to follow it with.
    sub = shell.modifiers.new("NV_Sub", 'SUBSURF')
    sub.levels = SHRINK_LEVELS
    sub.render_levels = SHRINK_LEVELS

    wrap = shell.modifiers.new("NV_Shrinkwrap", 'SHRINKWRAP')
    wrap.target = hand
    wrap.wrap_method = 'NEAREST_SURFACEPOINT'
    wrap.offset = OFFSET

    solid = shell.modifiers.new("NV_Solidify", 'SOLIDIFY')
    solid.thickness = THICKNESS
    solid.offset = 1.0
    solid.use_even_offset = True
    solid.use_rim = True

    smooth = shell.modifiers.new("NV_Smooth", 'SMOOTH')
    smooth.factor = 0.4
    smooth.iterations = 3

    bpy.ops.object.shade_smooth()
    return shell


def main():
    hand = bpy.context.active_object
    if hand is None or hand.type != 'MESH':
        print("Select the hand mesh first, then run this.")
        return

    shell = build_shell(hand)
    print("Built %s over %s." % (shell.name, hand.name))
    print("Next: apply the modifiers, then cut the cuff and the electrode holes.")
    print("Hide the hand before rendering, or leave it for the fingertips to show.")


if __name__ == "__main__":
    main()
