# Rendering the glove

Scripts and settings for a product render. They set up everything around the
glove -- camera, lights, materials, output -- so the modelling is the only part
left to do by hand.

Written for Blender 4.x; the material script also works on 3.6.

## Order

1. **Get a hand.** Blender Studio publishes CC0 human base meshes, which include
   hands, at studio.blender.org. Any CC0 hand works. Modelling one from scratch
   is a week of sculpting and is not the point of this.
2. **Pose it.** Relaxed, fingers slightly apart. Not splayed flat, which reads as
   a medical diagram, and not a fist, which hides the electrodes.
3. **Scale it to life size.** A hand is about 19cm from wrist to fingertip. The
   rig assumes roughly that; everything is positioned in metres.
4. `scene_setup.py` -- camera, lights, render settings.
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
