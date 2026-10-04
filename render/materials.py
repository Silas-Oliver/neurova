"""Neurova render -- materials.

Run after scene_setup.py. Creates the three materials and, if you have objects
selected, assigns the glove material to them.

Blender 4.x renamed several Principled BSDF sockets ('Specular' became
'Specular IOR Level', 'Subsurface' became 'Subsurface Weight', and so on), so
every input here is set through a helper that tries each known name and skips
what the running version does not have. That keeps the file working on 3.6 and
4.x without a version check.
"""

import bpy

NEUROVA_GREEN = (0.055, 0.14, 0.12, 1.0)   # #0f1f1b, the site's dark panel
ACCENT = (0.33, 0.73, 0.57, 1.0)           # #8ed8b7


def set_input(node, names, value):
    """Set the first socket that exists out of `names`."""
    if isinstance(names, str):
        names = [names]
    for name in names:
        if name in node.inputs:
            node.inputs[name].default_value = value
            return True
    return False


def new_material(name):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    return mat, bsdf


def glove_fabric(colour=NEUROVA_GREEN):
    """Compression fabric. The sheen is what sells it as cloth rather than
    rubber -- knitted fabric scatters at grazing angles, and without it a glove
    reads as a latex glove every time."""
    mat, bsdf = new_material("NV_GloveFabric")
    set_input(bsdf, "Base Color", colour)
    set_input(bsdf, "Roughness", 0.82)
    set_input(bsdf, ["Specular IOR Level", "Specular"], 0.22)
    set_input(bsdf, ["Sheen Weight", "Sheen"], 0.5)
    set_input(bsdf, ["Sheen Roughness"], 0.35)
    set_input(bsdf, ["Sheen Tint"], (0.6, 0.75, 0.7, 1.0))
    set_input(bsdf, "Metallic", 0.0)

    # A weave needs some surface break-up or it looks like plastic at any size.
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    tex = nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 420.0
    tex.inputs["Detail"].default_value = 2.0
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.14
    links.new(tex.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def snap_metal():
    """The electrode studs. Stainless, not chrome -- a mirror finish picks up
    the whole room and reads as jewellery."""
    mat, bsdf = new_material("NV_SnapMetal")
    set_input(bsdf, "Base Color", (0.78, 0.80, 0.80, 1.0))
    set_input(bsdf, "Metallic", 1.0)
    set_input(bsdf, "Roughness", 0.28)
    set_input(bsdf, ["Anisotropic"], 0.3)
    return mat


def cable():
    """Lead wire. Slightly glossy PVC."""
    mat, bsdf = new_material("NV_Cable")
    set_input(bsdf, "Base Color", (0.03, 0.05, 0.045, 1.0))
    set_input(bsdf, "Roughness", 0.36)
    set_input(bsdf, ["Specular IOR Level", "Specular"], 0.5)
    return mat


def emissive_trace():
    """Optional: a glowing signal line over the glove, matching the site."""
    mat = bpy.data.materials.get("NV_Trace") or bpy.data.materials.new("NV_Trace")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    out = nodes.get("Material Output")
    for n in list(nodes):
        if n is not out:
            nodes.remove(n)
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = ACCENT
    emit.inputs["Strength"].default_value = 6.0
    links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def main():
    fabric = glove_fabric()
    snap_metal()
    cable()
    emissive_trace()

    assigned = 0
    for obj in bpy.context.selected_objects:
        if obj.type == 'MESH':
            obj.data.materials.clear()
            obj.data.materials.append(fabric)
            assigned += 1

    print("Materials ready. Fabric assigned to %d selected mesh(es)." % assigned)
    print("Assign NV_SnapMetal and NV_Cable by hand -- they are small parts.")


if __name__ == "__main__":
    main()
