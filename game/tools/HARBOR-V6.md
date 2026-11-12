# Bellweather harbor v6

Run Blender 5.2 `--background --python game/tools/build-harbor-v6.py` after
v5. It preserves earlier assets and creates a separate editable scene and
shipping GLB. The ferry branch reaches Jonah's existing logical position
`(22,-16)` from the main pier without crossing water. The three logical
navigation rectangles are cross-pier `[10.5,-8.5,23.4,-6.3]`, approach
`[20.6,-17.5,23.4,-6.3]`, and landing `[19.5,-18.4,25,-13.6]`. Rendered
planks are trimmed at shared edges to avoid overlapping coplanar surfaces.
Existing textured timber and mooring posts are reused without API calls.

The build emits `harbor-navigation.json` in logical XZ coordinates, with
walkable surface rectangles/polygons, heights, and conservative building
AABBs measured from the actual exported scene. The simulation, server and
render adapter share the navigation module based on this data. The Canvas2D
map depicts the same ferry decks and coastline. NPC coordinates and saved
coordinate conventions stay unchanged; the Three adapter still presents
logical X as reflected render X.

Mara `(5,4)` stands on the stone quay outside the nearest chandlery footprint
`[5.9007,4.2248,14.0993,11.7752]`. The render adapter uses `floorHeightAt`
for actors, so pier and quay elevations no longer make them float. Current
world bounds remain unchanged; extending the full lighthouse headland is a
separate map-design change.

The source remains the v5 asset and its pinned CC0/Tripo provenance; no new
third-party resource was introduced. Actual browser movement through all
three chapter NPC locations remains a separate acceptance step.
