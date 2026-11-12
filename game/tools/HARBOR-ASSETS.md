# Harbor v3 source and rebuild

`harbor-sources.json` pins the original Poly Haven URLs, CC0-1.0 license,
byte sizes, and SHA-256 digests. The game uses real photographed PBR timber,
slate, stone and cobblestone, coastal-cliff and pine scans, a scanned wooden crate, and
the `small_harbour_sunset` HDRI. The inherited lighthouse is the project's
existing Tripo image-to-3D model, retained from `bellweather-harbor-v2.glb`.

Run `python game/tools/fetch-harbor-sources.py` from any directory. Then run
Blender 5.2 with `--background --python game/tools/build-harbor-v3.py`.
The build imports the tracked v2 GLB and writes a **separate**
`game/art/bellweather-harbor-v3.blend` and shipping v3 GLB. Original Blender
files are preserved. Source downloads and editable Blender files remain
ignored; only the shipping asset, source manifest and tools belong in Git.

The pipeline repairs four malformed roof transforms, gives existing houses
metric PBR UVs, decimates scanned trees/coastline, shares duplicate meshes,
caps textures at 2K, and exports embedded textures. The output contains
roughly 116,000 source polygons across 240 meshes. Its geometry is suitable
for profiling on the actual target devices; this count alone is not an FPS
acceptance claim. The lightweight 2D path does not load these 3D assets.

The optional offline preview in `.dream-loop` is an art inspection, not
browser acceptance. Dream Loop judging must use actual game screenshots.
