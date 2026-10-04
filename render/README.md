# Rendering the glove

Scripts and settings for a product render. They set up everything around the
glove -- camera, lights, materials, output -- so the modelling is the only part
left to do by hand.

Written for Blender 4.x; the material script also works on 3.6.

## Running a script

Blender's own editor, not a terminal:

1. Open Blender. Click the **Scripting** tab along the top.
2. In the text editor, **Open** (or Text > Open) and pick the `.py` file.
3. Press the **play button** at the top right of the editor, or **Alt+P**.
4. Output and errors appear in the **System Console**, which on macOS does not
   exist as a menu item -- that is Windows only. To see what a script prints,
   quit Blender and start it from Terminal instead:

   ```
   /Applications/Blender.app/Contents/MacOS/Blender
   ```

   Everything the scripts print then appears in that Terminal window. Without
   it a script that stops early looks like it did nothing at all.

**Do not paste a script into the Python Console.** The console is the small
panel that executes one line at a time, and a pasted function body comes back
as `IndentationError: unexpected indent` on every indented line. Scripts go in
the Text Editor, which is the large panel in the Scripting workspace.

Each file ends with `if __name__ == "__main__": main()`, which fires when the
text editor runs it, so there is nothing to call by hand.

What each one needs selected before you press play:

| Script | Selection |
|---|---|
| `scene_setup.py` | nothing |
| `prep_mesh.py` | the imported mesh (`.obj` only) |
| `glove_shell.py` | the hand mesh, selected **and** active |
| `materials.py` | the glove (assigns fabric to whatever is selected) |

Active means last clicked -- light outline rather than dark. With several things
selected, only the active one counts.

## If your hand is an .obj

Simpler to bring in, but it carries three problems a `.blend` does not, and all
three fail quietly rather than throwing an error.

**File > Import > Wavefront (.obj).** Then run `prep_mesh.py` with it selected,
which fixes all three and prints what it found.

**No units.** An `.obj` records numbers with no statement of what they mean.
Blender reads one unit as one metre, so a hand modelled in centimetres arrives
100 times too big and one modelled in inches arrives at 48cm. `prep_mesh.py`
scales the longest axis to 0.19m.

**Normals may point inward.** Shrinkwrap with an offset pushes along the normal,
so a mesh with inverted normals puts the glove shell *inside* the hand. You get
a shell that appears to have done nothing. The script recalculates them outward.

**Often triangulated.** Shrinkwrap copes with triangles; subdivision does not. A
triangulated mesh subdivides into a mess of poles and the shell inherits every
one. The script counts faces and tells you to drop `SHRINK_LEVELS` to 1 if more
than 60% are triangles.

**One thing no script can fix: the pose.** An `.obj` is a frozen mesh with no
rig. If it arrives splayed flat or in a fist, you cannot pose it without rigging
or sculpting it yourself, both of which are real work. Check the pose before you
build anything on it -- a `.blend` base mesh is often rigged, which is the one
genuine advantage it has here.

## Getting a hand out of the .blend

The base mesh bundle is a `.blend`, which is a Blender file rather than a model
format, so you bring pieces of it into your own file instead of importing it.

1. **File > Append** -- not Open, which would discard your scene.
2. Double-click into the downloaded `.blend` as though it were a folder.
3. Go into **Object**, pick the body mesh, Append.

That copies it in, with no link back to the original.

Then isolate the hand, since the meshes are whole bodies:

1. Tab into **Edit Mode**, press **3** for face select.
2. Turn on **X-ray** (Alt+Z) so box select reaches through the mesh.
3. Box-select the hand and a few centimetres of wrist.
4. **P > Selection** to split it into its own object.
5. Tab out, delete the body.

**Then apply the scale, before anything else.** Select the hand, **Ctrl+A >
Scale**. This matters more than it sounds: `glove_shell.py` works in real units
-- a 1.5mm offset and 1.2mm thickness -- and those are multiplied by the
object's scale. On a mesh scaled to 0.01 your 1.5mm gap becomes 15 microns and
the shell will look like it did nothing.

Check the size in the **N panel > Item > Dimensions** while you are there. A
hand runs about 0.19m wrist to fingertip. If the mesh is in centimetres it will
read 19, and the lighting rig will be inside the model.

## Order

1. **Get a hand.** Blender Studio publishes CC0 human base meshes, which include
   hands, at studio.blender.org. Any CC0 hand works. Modelling one from scratch
   is a week of sculpting and is not the point of this.
2. **Pose it.** Relaxed, fingers slightly apart. Not splayed flat, which reads as
   a medical diagram, and not a fist, which hides the electrodes.
3. **Scale it to life size.** A hand is about 19cm from wrist to fingertip. The
   rig assumes roughly that; everything is positioned in metres.
4. `scene_setup.py` -- camera, lights, render settings.
   For an `.obj`, run `prep_mesh.py` on the hand first.
5. `glove_shell.py` -- with the hand selected, builds the glove over it.
6. Apply the modifiers, then cut the cuff edge and the electrode holes.
7. `materials.py` -- with the glove selected, assigns fabric and creates the rest.
8. Render.

## What the rig does

**Camera, 90mm at 62cm.** Product shots are long lenses. Anything wider than
about 50mm bends the fingers outward at the edges of frame and the render starts
reading as a phone snap. Depth of field is on at f/4, focused on an empty at the
glove's centre -- move that empty to pull focus rather than moving the camera.

**Three-point lighting.** A large soft key at 45 degrees, a wider dimmer fill to
keep the shadow side readable, and a rim light behind. The rim is the one most
people leave out and the one that makes a product look photographed rather than
rendered: it separates the glove from the background with a bright edge.

**Transparent background.** `film_transparent` is on, so you get a PNG with alpha
and composite it onto whatever the page needs. Rendering onto a background locks
you into one use.

**AgX view transform.** Standard clips the highlights on light fabric to flat
white. AgX rolls them off. On Blender 3.x the script falls back to Filmic.

## Materials, and why

**Fabric needs sheen.** Knitted compression fabric scatters light at grazing
angles. Without a sheen component a glove renders as latex every time -- that
single setting is most of the difference between cloth and rubber. The noise
bump gives the weave enough break-up that it does not read as plastic.

**Snaps are stainless, not chrome.** Roughness 0.28, slightly anisotropic. A
mirror finish reflects the whole scene and reads as jewellery.

**NV_Trace is optional.** An emissive material in the site's accent green, for a
signal line running over the glove if you want the render to carry the same idea
as the heading glyph.

## Settings worth knowing

| | Value | Why |
|---|---|---|
| Samples | 256 | 128 while posing, 512 for a final |
| Denoising | On | At 256 samples you need it |
| Resolution | 2400x1350 | Crop down afterwards; you cannot crop up |
| Caustics | Off | Fabric has none, and they are most of the noise |
| Shell offset | 1.5mm | Air gap between skin and fabric |
| Shell thickness | 1.2mm | Compression fabric |

## Where this is worth using

Full-size images: a hero, the Specs page, funding material. **Not the heading
chip** -- that renders at 194x86 on desktop and 80x36 on a phone, where detail
and material are exactly what gets thrown away. The line-art glyph reads better
at that size than any render would.

## Before spending a weekend on it

The electrode standoff found on 3 October changes the glove's surface -- the
electrodes have to stand proud of the fabric rather than sit flush, which is
visible geometry. Settle the mounting first, or expect to rebuild the shell.
