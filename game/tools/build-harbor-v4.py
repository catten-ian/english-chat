"""Compose detailed Tripo storefronts over the repaired CC0 harbor.

Run with Blender --background --python game/tools/build-harbor-v4.py.
Preserves v3, all original art sources, and the live Blender project.
Logical world X maps to render -X: only presentation changes, never saves.
"""
import bpy, json, math, hashlib
from pathlib import Path
from mathutils import Vector, Matrix
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'game/public/assets/environment'
MODEL=ROOT/'game/tools/assets/chandlery-tripo-p2.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(OUT/'bellweather-harbor-v3.glb'))
for ob in list(bpy.context.scene.objects):
    if ob.type=='MESH':
        matrix=ob.matrix_world.copy();ob.parent=None;ob.matrix_world=matrix
for ob in list(bpy.context.scene.objects):
    if ob.type!='MESH':bpy.data.objects.remove(ob,do_unlink=True)

# The original procedural post cylinders used center+height twice; ground them
# and align their heads before the real storefront lamps take over the view.
for ob in list(bpy.context.scene.objects):
    if ob.name.startswith('Harbor lamp post'):
        bottom=min((ob.matrix_world@Vector(c)).z for c in ob.bound_box);ob.location.z-=bottom
    if ob.name=='Cube':bpy.data.objects.remove(ob,do_unlink=True)

# The generated model has its shop front along local +X. Rotate toward the quay
# (+Blender Y / -game Z), then fit it to the existing public-map footprints.
prefixes=['Turner chandlery','Harbor rooms','Tide office']
for ob in list(bpy.context.scene.objects):
    if any(ob.name.startswith(prefix) for prefix in prefixes):bpy.data.objects.remove(ob,do_unlink=True)
old=set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=str(MODEL))
sources=[o for o in bpy.context.scene.objects if o not in old and o.type=='MESH']
for ob in sources:
    matrix=ob.matrix_world.copy();ob.parent=None
    # Apply glTF Y-up -> Blender Z-up before orienting the storefront.
    ob.data.transform(matrix);ob.matrix_world=Matrix.Identity(4)
for ob in list(bpy.context.scene.objects):
    if ob not in old and ob.type!='MESH':bpy.data.objects.remove(ob,do_unlink=True)

# Warm-window emission uses a mask extracted from the generated color atlas,
# not a rectangle over the facade. Bright yellow panes glow; dark timber does not.
for mat in {m for ob in sources for m in ob.data.materials if m}:
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;bs=nodes.get('Principled BSDF')
    tex=next((n for n in nodes if n.type=='TEX_IMAGE'),None)
    if tex and tex.image:
        image=tex.image;w,h=image.size
        pixels=np.empty(w*h*4,dtype=np.float32);image.pixels.foreach_get(pixels)
        rgb=pixels.reshape(h,w,4)[:,:,:3]
        # Input atlas is scene-linear. Restrict warm, bright baked glass.
        warm=(rgb[:,:,0]>.28)&(rgb[:,:,1]>.18)&(rgb[:,:,0]>rgb[:,:,2]*1.2)&(rgb[:,:,1]>rgb[:,:,2]*1.05)
        strength=np.clip((rgb[:,:,0]+rgb[:,:,1]-0.5)*1.8,0,1)*warm
        mask=np.ones((h,w,4),dtype=np.float32)
        mask[:,:,:3]=strength[:,:,None]*np.array([1,.54,.22],dtype=np.float32)
        output=bpy.data.images.new('Chandlery warm pane emission',width=w,height=h)
        output.pixels.foreach_set(mask.ravel());output.pack()
        node=nodes.new('ShaderNodeTexImage');node.image=output
        links.new(node.outputs['Color'],bs.inputs['Emission Color'])
        bs.inputs['Emission Strength'].default_value=2.4
        bs.inputs['Roughness'].default_value=.66

placements=[
    ('Tripo Turner chandlery',(9,-13,4.0),(2.0,2.2,2.0)),
    ('Tripo Harbor rooms',(18,-16,4.7),(1.85,2.0,2.35)),
    ('Tripo Tide office',(5,-7,2.9),(1.4,1.5,1.45)),
]
for source in sources:
    for name,position,scale in placements:
        ob=source.copy();ob.data=source.data;bpy.context.collection.objects.link(ob)
        ob.name=name;ob.rotation_mode='XYZ';ob.rotation_euler=(0,0,math.pi/2);ob.location=position;ob.scale=scale
    bpy.data.objects.remove(source,do_unlink=True)

# Ground imported saplings; v3 inherited the original cone-trunk center heights.
bpy.context.view_layer.update()
for ob in bpy.context.scene.objects:
    if ob.name.startswith('CC0 coastal pine'):
        bottom=min((ob.matrix_world@Vector(c)).z for c in ob.bound_box)
        ob.location.z-=bottom

# Place lighthouse on its coastal rock. Keep its footprint unchanged for the map.
for ob in bpy.context.scene.objects:
    if 'tripo' in ob.name.lower() and '60f3b0b7' not in ob.name and not any(ob.name.startswith(p[0]) for p in placements):
        ob.location.z+=.8

# Present the same logical world from a right-handed screen orientation. All
# characters and runtime lights apply this same reflection in three-renderer.
reflection=Matrix.Diagonal((-1,1,1,1))
bpy.context.view_layer.update()
for ob in bpy.context.scene.objects:
    if ob.type=='MESH':ob.matrix_world=reflection@ob.matrix_world

for image in bpy.data.images:
    if max(image.size)>2048:
        scale=2048/max(image.size);image.scale(int(image.size[0]*scale),int(image.size[1]*scale))
    if image.source=='FILE':image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'game/art/bellweather-harbor-v4.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'bellweather-harbor-v4.glb'),export_format='GLB',export_cameras=False,export_lights=False,export_image_format='JPEG',export_jpeg_quality=88)
report=dict(sourceModelSha256=hashlib.sha256(MODEL.read_bytes()).hexdigest(),sourceModelTask='60f3b0b7-3288-4559-8cd0-f9c9d9aec5f5',renderTransform='logicalX -> -renderX; logicalZ unchanged',storefronts=[p[0] for p in placements],meshes=sum(o.type=='MESH' for o in bpy.context.scene.objects),faces=sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH'),bytes=(OUT/'bellweather-harbor-v4.glb').stat().st_size)
(ROOT/'.dream-loop/harbor-v4-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
