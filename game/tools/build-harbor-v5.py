"""Recompose harbor v4 for the actual diagonal conversation camera.

Logical coordinates stay unchanged; this asset already uses render X=-world X.
Run with Blender 5.2 --background --python game/tools/build-harbor-v5.py.
"""
import bpy,json,math
from pathlib import Path
from mathutils import Vector,Matrix
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'game/public/assets/environment'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(OUT/'bellweather-harbor-v4.glb'))
for ob in list(bpy.context.scene.objects):
    if ob.type=='MESH':
        matrix=ob.matrix_world.copy();ob.parent=None;ob.matrix_world=matrix
for ob in list(bpy.context.scene.objects):
    if ob.type!='MESH':bpy.data.objects.remove(ob,do_unlink=True)

def bounds(ob):
    points=[ob.matrix_world@Vector(c) for c in ob.bound_box]
    return Vector([min(p[i] for p in points) for i in range(3)]),Vector([max(p[i] for p in points) for i in range(3)])

# Remove the rigid rope-bars in front of both actors and the empty legacy wall.
# Mooring posts still anchor the pier silhouette; the target ropes live far left.
for ob in list(bpy.context.scene.objects):
    if ob.name.startswith('Mooring rope') or ob.name.startswith('Net menders cottage'):
        bpy.data.objects.remove(ob,do_unlink=True)

def polygon(name,points,material):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(points,[],[tuple(range(len(points)))]);mesh.update()
    ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);mesh.materials.append(material)
    uv=mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        p=mesh.vertices[loop.vertex_index].co;uv.data[loop.index].uv=(p.x/3,p.y/3)
    return ob

# Open water around the pier and a distinct lighthouse headland replace the
# enormous rectangular cobblestone plane that flattened the browser screenshot.
shore=next(o for o in bpy.context.scene.objects if o.name.startswith('Bellweather shore'))
ground_material=shore.data.materials[0];bpy.data.objects.remove(shore,do_unlink=True)
polygon('Harbor stone quay',[(-40,-50,-.1),(-2,-50,-.1),(-2,-14,-.1),(3,-14,-.1),(3,5,-.1),(-40,5,-.1)],ground_material)
polygon('Keeper causeway',[(3,-17,-.1),(17,-17,-.1),(17,-14,-.1),(3,-14,-.1)],ground_material)
polygon('Lighthouse headland',[(17+6.8*math.cos(a*math.tau/18),-19+7*math.sin(a*math.tau/18),.55) for a in range(18)],ground_material)
water=next(o for o in bpy.context.scene.objects if o.name.startswith('Sculpted harbor water'))
water_material=water.data.materials[0];bpy.data.objects.remove(water,do_unlink=True)
polygon('Sculpted harbor water',[(-100,-100,-.54),(100,-100,-.54),(100,100,-.54),(-100,100,-.54)],water_material)

# Continuous narrow planks with millimetre seams, rather than cracked square
# slabs. One shared mesh/material keeps this detailed deck to one draw call.
deck=next(o for o in bpy.context.scene.objects if o.name.startswith('Main wet timber pier'))
wood=deck.data.materials[0];bpy.data.objects.remove(deck,do_unlink=True)
verts=[];faces=[]
for i in range(118):
    x=-10.95+i*30.18/118;w=30.18/118-.006;y0=4.88;y1=10.64
    k=len(verts);verts.extend([(x,y0,-.16),(x+w,y0,-.16),(x+w,y1,-.16),(x,y1,-.16),(x,y0,.045),(x+w,y0,.045),(x+w,y1,.045),(x,y1,.045)])
    faces.extend([tuple(k+j for j in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]])
mesh=bpy.data.meshes.new('Closely laid oak planks');mesh.from_pydata(verts,[],faces);mesh.update()
deck=bpy.data.objects.new('Main wet timber pier',mesh);bpy.context.collection.objects.link(deck);mesh.materials.append(wood)
uv=mesh.uv_layers.new(name='UVMap')
for loop in mesh.loops:
    p=mesh.vertices[loop.vertex_index].co;uv.data[loop.index].uv=(p.y/2.5,p.x/2.5)
polygon('Keeper landing',[(-3.8,10.63,.045),(-.2,10.63,.045),(-.2,12.3,.045),(-3.8,12.3,.045)],wood)
for ob in list(bpy.context.scene.objects):
    if ob.name.startswith('Tidal granite'):bpy.data.objects.remove(ob,do_unlink=True)
    elif ob.name.startswith('Pier piling'):
        lo,hi=bounds(ob);center=(lo+hi)/2
        if center.y>10 and -6<center.x<3:bpy.data.objects.remove(ob,do_unlink=True)

placements=[
 ('Tripo Tide office',(-7,1,2.9),(.92,.92,1),-.1),
 ('Tripo Turner chandlery',(-10,-8,4),(.95,.95,1),.05),
 ('Tripo Harbor rooms',(-18,-17,4.7),(1,1,1),-.08),
]
for prefix,location,scale,angle in placements:
    ob=next(o for o in bpy.context.scene.objects if o.name.startswith(prefix))
    center=ob.matrix_world.translation.copy()
    transform=Matrix.Translation(Vector(location))@Matrix.Rotation(angle,4,'Z')@Matrix.Diagonal((*scale,1))@Matrix.Translation(-center)
    ob.matrix_world=transform@ob.matrix_world

for ob in bpy.context.scene.objects:
    if ob.name.startswith('Main wet timber pier'):
        # Shallow seams; retain plank texture but remove the huge slab channels.
        lo,hi=bounds(ob);center=(lo+hi)/2
        for vert in ob.data.vertices:
            p=ob.matrix_world@vert.co
            if p.z>-.04:p.z=.045
            vert.co=ob.matrix_world.inverted()@p
    for mat in ob.data.materials if ob.type=='MESH' else []:
        if not mat or not mat.use_nodes:continue
        bs=mat.node_tree.nodes.get('Principled BSDF')
        if not bs:continue
        if 'Rain-darkened oak' in mat.name:
            bs.inputs['Roughness'].default_value=.24
            bs.inputs['Metallic'].default_value=.06
            bs.inputs['Coat Weight'].default_value=.7
            bs.inputs['Coat Roughness'].default_value=.17
        if 'Tidal water' in mat.name or 'harbor water' in mat.name.lower():
            bs.inputs['Base Color'].default_value=(.025,.07,.095,1)
            bs.inputs['Roughness'].default_value=.14
            bs.inputs['Metallic'].default_value=.12

# Remove redundant warm squares/floating roof caps left from the old architecture.
for ob in list(bpy.context.scene.objects):
    if ob.name.startswith('Lantern roof'):
        lo,hi=bounds(ob)
        if lo.z>4:ob.location.z-=.3
for image in bpy.data.images:
    if image.source=='FILE':image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'game/art/bellweather-harbor-v5.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'bellweather-harbor-v5.glb'),export_format='GLB',export_cameras=False,export_lights=False,export_image_format='JPEG',export_jpeg_quality=88)
report=dict(decorativeLogicalCenters={'tideOffice':[7,-1],'chandlery':[10,8],'harborRooms':[18,17]},source='bellweather-harbor-v4.glb',meshes=sum(o.type=='MESH' for o in bpy.context.scene.objects),faces=sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH'),bytes=(OUT/'bellweather-harbor-v5.glb').stat().st_size)
(ROOT/'.dream-loop/harbor-v5-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
