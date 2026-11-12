# Bellweather 3D Asset Production Checklist

The supplied target image is the visual target for the 3D game only. The 2D mode is a lower-cost camera/rendering mode of the same world; it does not get a separate art direction.

## Shared Character Art Direction

- Realistic, premium narrative-game character; grounded coastal New England fishing village at late dusk after rain.
- Natural human anatomy and believable adult proportions, expressive but restrained faces, layered weatherproof fabrics with visible seams and dampness.
- Muted slate, sea-glass and charcoal palette; Eli's ochre oilskin is the warm focal accent. Avoid chibi, anime, plastic skin, exaggerated proportions, weapons, text, logos and scenic backgrounds.
- Generate one clean full-body front orthographic character sheet on a neutral light-gray studio background, feet visible, relaxed A-pose, even soft lighting. Keep the face, hair, outfit, accessories and body proportions consistent across front, side and back views.
- Use the approved sheet as the image-to-multiview source for Tripo. Do not independently prompt each view.

## Priority A: Three Playable Characters

1. `protagonist-front.png` / `protagonist-sides.png`: young adult woman harbor investigator, dark brown hair in a practical low bun, weathered charcoal-blue hooded coat, slate knit layers, leather crossbody field satchel, practical trousers and boots. No visible weapon. Calm, observant face. This is the player character in the target image.
2. `eli-turner-front.png` / `eli-turner-sides.png`: 58-year-old lighthouse keeper, lined kind face, gray beard, dark knit cap, mustard-ochre oilskin over a charcoal sweater, sturdy trousers and wet boots. Lean, weathered build; left ear slightly less prominent is not required visually.
3. `mara-quinn-front.png` / `mara-quinn-sides.png`: 29-year-old harbor electrician, dark hair tied back, deep teal work jacket with restrained reflective details, tool belt and compact insulated hand tools, waterproof trousers and boots. Practical, direct expression; no large props obscuring the silhouette.

For each character, please provide either a 4-view sheet (front, left, back, right) or one approved front sheet and permission to derive the remaining views from that same image. A single front image is enough for an initial Tripo image-to-3D pass, but the 4-view input should reduce outfit drift.

For the first pass, three individual front 3/4-view full-body references are sufficient. Save them as `game/public/assets/source/protagonist-front.png`, `game/public/assets/source/eli-turner-front.png` and `game/public/assets/source/mara-quinn-front.png`.

### Character Prompt Template

Append this to the specific character description above:

> Full-body photorealistic 3D game character turnaround reference, single adult person centered, neutral light-gray seamless studio background, front orthographic view, relaxed A-pose with arms slightly away from torso, hands and boots fully visible, natural realistic anatomy, refined face detail, high-end narrative adventure game character design, soft even studio lighting, fabric materials clearly separated, clean silhouette, no props in hands, no text, no labels, no watermark, no crop. Preserve this exact face, hair, outfit, colors and proportions for any additional view.

## Priority B: Scene Kit

4. Lighthouse tower + lantern room, isolated modular GLB; tower height 10-14 m, separate emissive beacon element if possible.
5. Weathered harbor building modules: fish shed, lighthouse keeper's cottage, workshop frontage and warm window variants. Generate consistent façade materials; assemble and light them in Blender rather than shipping one large fused town mesh.
6. Pier kit: wet timber deck segments, posts, rope rails, ladder, cleats and broken/empty lantern mount.
7. Story props: old brass harbor lantern, replacement marker, work order board, coiled rope, lobster traps, net bundles, rain barrel and hand tools.
8. Background silhouettes: one fishing boat and distant roofline modules. Low detail is acceptable because they are far from the camera.

For scene objects, request isolated single objects on a plain studio background with the entire object visible and no ground plane. Use Poly Haven CC0 textures/HDRIs for reusable wet wood, stone, metal, sky and environment lighting. Save each chosen asset locally and record source ID, license, attribution requirement, resolution and hash.

## Priority C: Motion and Runtime

9. Player and NPC clips: name embedded GLB clips with `idle`, `walk`, `turn` and `talk` prefixes so the runtime can select them; `idle` and `walk` are required for playable characters. Keep clips short and loopable; reuse the same rig per character.
10. Optional environment: shallow harbor water, low-cost fog cards/volumes, gulls at distance and subtle beacon pulse. These should be implemented or assembled after the character and landmark assets pass review.
11. Blender cleanup: apply transforms, normalize facing and ground pivots, check materials/UVs/weights, create collision proxies and mobile LODs, export GLB.
12. Runtime budgets: target under 8 MB per hero character after optimization; 1K-2K textures for mobile, no more than 2 shadow-casting hero lights, and a 2D mode that disables expensive shadows and lowers pixel ratio.

## Current Runtime Contract

Place final character files at:

- `game/public/assets/characters/protagonist.glb`
- `game/public/assets/characters/eli-turner.glb`
- `game/public/assets/characters/mara-quinn.glb`

The TypeScript renderer loads these paths, normalizes each model to about 1.86 m tall, uses embedded idle/walk clips when available, and keeps a temporary prototype fallback if an asset is absent. Scene prop assets will be added to a manifest after the first approved GLBs arrive.
