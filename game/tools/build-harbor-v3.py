"""Run with Blender --background --python game/tools/build-harbor-v3.py.

Repairs the existing harbor in a separate file. Inputs are the shipped v2 GLB
and verified CC0 Poly Haven source files in game/art/polyhaven (sources.json).
Does not open or overwrite the user's live Blender project.
"""
import bpy, json, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'game/art/polyhaven'
OUT = ROOT / 'game/public/assets/environment'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(OUT / 'bellweather-harbor-v2.glb'))
# Keep world transforms before removing the import hierarchy.
for ob in list(bpy.context.scene.objects):
    if ob.type == 'MESH':
        matrix = ob.matrix_world.copy(); ob.parent = None; ob.matrix_world = matrix
for ob in list(bpy.context.scene.objects):
    if ob.type != 'MESH': bpy.data.objects.remove(ob, do_unlink=True)

def bounds(ob):
    pts=[ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return Vector([min(p[i] for p in pts) for i in range(3)]),Vector([max(p[i] for p in pts) for i in range(3)])

def pbr(name, asset, rough=.6, normal=.4):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    n=mat.node_tree.nodes;l=mat.node_tree.links;bs=n.get('Principled BSDF')
    bs.inputs['Roughness'].default_value=rough
    for suffix,slot in [('diff','Base Color'),('nor_gl','Normal')]:
        image=bpy.data.images.load(str(ART/asset/f'{asset}_{suffix}_1k.jpg'),check_existing=True)
        tex=n.new('ShaderNodeTexImage');tex.image=image
        if suffix=='nor_gl':
            image.colorspace_settings.name='Non-Color'
            node=n.new('ShaderNodeNormalMap');node.inputs['Strength'].default_value=normal
            l.new(tex.outputs['Color'],node.inputs['Color']);l.new(node.outputs['Normal'],bs.inputs['Normal'])
        else:l.new(tex.outputs['Color'],bs.inputs[slot])
    return mat

wood=pbr('CC0 weathered harbor timber','dark_wooden_planks',.43,.3)
slate=pbr('CC0 overlapping coastal slate','roof_slates_02',.6,.65)
stone=pbr('CC0 salt weathered masonry','stone_wall_02',.84,.55)
ground=pbr('CC0 harbor cobblestone','cobblestone_floor_08',.68,.5)

def metric_uv(ob, metres=3):
    uv=ob.data.uv_layers.active or ob.data.uv_layers.new(name='UVMap')
    for face in ob.data.polygons:
        normal=ob.matrix_world.to_3x3() @ face.normal
        axis=max(range(3),key=lambda i:abs(normal[i]))
        axes=[i for i in range(3) if i!=axis]
        for li in face.loop_indices:
            pos=ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co
            uv.data[li].uv=(pos[axes[0]]/metres,pos[axes[1]]/metres)

for ob in list(bpy.context.scene.objects):
    if ob.type!='MESH' or 'Tripo' in ob.name:continue
    old=[m.name for m in ob.data.materials if m]
    replacement=None
    if any('slate' in m.lower() for m in old):replacement=slate
    elif any('siding' in m.lower() or 'plaster' in m.lower() or 'Oiled dark timber' in m for m in old):replacement=wood
    elif any('Tidal stone' in m for m in old):replacement=stone
    elif any('Damp coastal earth' in m for m in old):replacement=ground
    if replacement:
        ob.data.materials.clear();ob.data.materials.append(replacement);metric_uv(ob)

repairs=[]
for prefix in ['Turner chandlery','Harbor rooms','Net menders cottage','Tide office']:
    body=next(o for o in bpy.context.scene.objects if o.name.startswith(prefix+' plaster body'))
    lo,hi=bounds(body);cx=(lo.x+hi.x)/2
    gables=[o for o in bpy.context.scene.objects if o.name.startswith(prefix) and 'gable' in o.name]
    peak=max(bounds(o)[1].z for o in gables)
    for ob in list(bpy.context.scene.objects):
        if ob.name.startswith(prefix) and ('slate roof' in ob.name or 'ridge beam' in ob.name):
            bpy.data.objects.remove(ob,do_unlink=True)
    # Correct gable roof: ridge follows building depth, not world X.
    for side,x in [('west',lo.x-.3),('east',hi.x+.3)]:
        verts=[(cx,lo.y-.3,peak+.06),(cx,hi.y+.3,peak+.06),(x,hi.y+.3,hi.z-.06),(x,lo.y-.3,hi.z-.06)]
        mesh=bpy.data.meshes.new(prefix+' repaired '+side);mesh.from_pydata(verts,[],[(0,1,2,3)]);mesh.update()
        ob=bpy.data.objects.new(prefix+' repaired '+side+' slate roof',mesh);bpy.context.collection.objects.link(ob)
        mesh.materials.append(slate);metric_uv(ob,2.5)
        modifier=ob.modifiers.new('Slate thickness','SOLIDIFY');modifier.thickness=.14
        bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_apply(modifier=modifier.name)
    repairs.append(dict(building=prefix,eave=hi.z,ridge=peak))

def import_scan(asset):
    old=set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(ART/asset/f'{asset}_1k.gltf'))
    meshes=[o for o in bpy.context.scene.objects if o not in old and o.type=='MESH']
    for ob in meshes:
        matrix=ob.matrix_world.copy();ob.parent=None;ob.matrix_world=matrix
    for ob in list(bpy.context.scene.objects):
        if ob not in old and ob.type!='MESH':bpy.data.objects.remove(ob,do_unlink=True)
    return meshes

cliff=import_scan('coastal_cliff_01')[0]
bpy.context.view_layer.objects.active=cliff
dec=cliff.modifiers.new('Browser coastline LOD','DECIMATE');dec.ratio=.025
bpy.ops.object.modifier_apply(modifier=dec.name)
cliff.name='CC0 scanned coastal cliff west';cliff.scale=(.32,.32,.32);cliff.location=(-18,-17,-1.9)
# Coastline detail remains outside the walking pier, preserving navigation.
for name,loc,scale,angle in [
 ('CC0 scanned coastal cliff east',(29,-26,-2.2),(.35,.35,.35),.12),
 ('CC0 scanned outer headland',(-34,-34,-1.8),(.5,.5,.5),.45)]:
    copy=cliff.copy();copy.data=cliff.data;bpy.context.collection.objects.link(copy)
    copy.name=name;copy.location=loc;copy.scale=scale;copy.rotation_euler.z=angle

old_crates=[o for o in bpy.context.scene.objects if o.name.startswith('Stacked fish crate')]
placements=[]
for ob in old_crates:
    lo,hi=bounds(ob);placements.append((Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z)),ob.rotation_euler.copy()))
for ob in old_crates:bpy.data.objects.remove(ob,do_unlink=True)
crates=import_scan('wooden_crate_01')
lo=Vector([min(bounds(o)[0][i] for o in crates) for i in range(3)])
hi=Vector([max(bounds(o)[1][i] for o in crates) for i in range(3)])
factor=.9/max(hi-lo);center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
for ob in crates:
    ob.scale*=factor;offset=(ob.location-center)*factor
    for idx,(pos,rot) in enumerate(placements):
        copy=ob.copy();copy.data=ob.data;bpy.context.collection.objects.link(copy)
        copy.name=f'CC0 stacked fish crate {idx}';copy.location=pos+offset;copy.rotation_euler=rot
    bpy.data.objects.remove(ob,do_unlink=True)

trunks=[o for o in bpy.context.scene.objects if o.name.startswith('Pine trunk')]
trees=[(o.location.copy(),bounds(o)[1].z*1.35) for o in trunks]
for ob in list(bpy.context.scene.objects):
    if ob.name.startswith('Pine trunk') or ob.name.startswith('Salt-worn pine canopy'):
        bpy.data.objects.remove(ob,do_unlink=True)
tree_sources=import_scan('pine_sapling_small')
tree=next((o for o in tree_sources if o.name=='pine_sapling_small_a'),tree_sources[0])
for ob in tree_sources:
    if ob!=tree:bpy.data.objects.remove(ob,do_unlink=True)
for source in [tree]:
    lo,hi=bounds(source);height=hi.z-lo.z
    bpy.context.view_layer.objects.active=source
    if len(source.data.polygons)>8000:
        mod=source.modifiers.new('Browser tree LOD','DECIMATE');mod.ratio=8000/len(source.data.polygons)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for i,(pos,target_height) in enumerate(trees):
        ob=source.copy();ob.data=source.data;bpy.context.collection.objects.link(ob)
        ob.name=f'CC0 coastal pine {i}';ob.scale*=max(3,target_height)/height;ob.location=pos
        ob.rotation_euler.z=i*1.4
    bpy.data.objects.remove(source,do_unlink=True)

# Shipping textures are capped at 2K. All CC0 material sources are already 1K.
for img in bpy.data.images:
    if img.size[0]>2048 or img.size[1]>2048:
        factor=2048/max(img.size);img.scale(int(img.size[0]*factor),int(img.size[1]*factor))
    if img.source=='FILE':img.pack()
for ob in bpy.context.scene.objects:
    if ob.type=='MESH':
        for p in ob.data.polygons:
            if 'CC0' in ob.name:p.use_smooth=True

OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'game/art/bellweather-harbor-v3.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'bellweather-harbor-v3.glb'),export_format='GLB',export_cameras=False,export_lights=False,export_image_format='JPEG',export_jpeg_quality=88)
report=dict(roofRepairs=repairs,meshes=sum(o.type=='MESH' for o in bpy.context.scene.objects),faces=sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH'),bytes=(OUT/'bellweather-harbor-v3.glb').stat().st_size)
(ROOT/'.dream-loop/harbor-v3-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
