# Bellweather harbor v4

This scene replaces the simple chandlery, harbor rooms and tide-office shells
with the detailed Tripo P2 timber workshop in `assets/chandlery-tripo-p2.glb`.
Its source task is `60f3b0b7-3288-4559-8cd0-f9c9d9aec5f5`; the SHA-256 is
recorded by the build report. The generated color atlas supplies the warm
window emission mask. The other harbor objects and pinned CC0 Poly Haven
sources are inherited from v3. All three shop instances share one mesh.

Run Blender 5.2 with `--background --python game/tools/build-harbor-v4.py`
after building v3. The script writes a separate editable v4 `.blend` and
shipping `bellweather-harbor-v4.glb`; the v2/v3 originals are preserved.

The scene reflects world X for presentation. The Three.js adapter reflects
actor positions, movement facing, sun tracking and practical lights the same
way. Simulation coordinates, NPC interaction radii, 2D rendering, saved
position and server narrative data stay in their original logical system.
The mirrored view puts the lighthouse left and timber storefronts right when
looking toward the town from the pier. The map and the game remain aligned.

The offline `.dream-loop/harbor-v4-preview.png` is an art preview. Browser
screenshots, rendering quality and device performance require separate live
acceptance. In particular, the target image has denser buildings, atmospheric
vessels and stronger wet-surface reflections than this source currently gives.
