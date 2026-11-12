# Bellweather harbor v5

Build with Blender 5.2 `--background --python game/tools/build-harbor-v5.py`
after v4. Editable originals remain in separate ignored `.blend` files.
The output GLB embeds all textures and retains the detailed Tripo storefronts
and CC0 coast, pine and timber sources from v3/v4.

The first actual browser screenshot exposed a flat oversized cobblestone
rectangle, oversized slab seams, and foreground rope bars through both actors.
V5 opens water around the pier, gives the lighthouse a distinct headland and
causeway, lays continuous narrow planks, removes foreground rails, and steps
the shop row into the distance. Decorative logical centers are tide office
`(7,-1)`, chandlery `(10,8)`, harbor rooms `(18,17)`. The Canvas2D coast and
building footprints follow the same layout. NPC and saved coordinates stay
unchanged. Three rendering retains its logical-X reflection from v4.

The new CC0 `qwantani_dusk_1_puresky` 1K HDRI is pinned in
`harbor-sources.json`; the source loader verifies SHA-256 and byte length.
It supplies both a visible cloudy dusk sky and specular environment lighting.
The lower sun intensity and blue ambient light preserve warm window contrast.

One 512x256 Reflector pass supplies wet-deck reflections on desktop screens
above 900 CSS pixels with a fine pointer. Coarse-pointer phones/tablets use
the PBR clearcoat material without that extra pass. Three.js Reflector hides
itself during its reflection render, and disposal releases its render target.
Performance must be measured on target hardware; no frame-rate claim follows
from a build or offline render.

`.dream-loop/harbor-v5-preview.png` is an offline art check only. Dream Loop
scoring requires a fresh actual browser image after deployment. V4 scored
poorly and this version must not inherit an acceptance claim from it.
