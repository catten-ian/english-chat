"""Add the connected ferry pier and export logical navigation geometry.

No NPC/save coordinate changes. Render coordinates remain (-logicalX,-logicalZ)
in Blender's horizontal XY plane; Blender Z is elevation.
"""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'game/public/assets/environment'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(OUT/'bellweather-harbor-v5.glb'))
for ob in list(bpy.context.scene.objects):
    if ob.type=='MESH':
        matrix=ob.matrix_world.copy();ob.parent=None;ob.matrix_world=matrix
for ob in list(bpy.context.scene.objects):
    if ob.type!='MESH':bpy.data.objects.remove(ob,do_unlink=True)

def bounds(ob):
    points=[ob.matrix_world@Vector(c) for c in ob.bound_box]
    lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
    return [-hi[0],-hi[1],-lo[0],-lo[1]]

deck=next(o for o in bpy.context.scene.objects if o.name.startswith('Main wet timber pier'))
wood=deck.data.materials[0]
rects=[('Ferry cross-pier',[10.5,-8.5,23.4,-6.3]),('Ferry approach',[20.6,-17.5,23.4,-6.3]),('Ferry landing',[19.5,-18.4,25,-13.6])]

def timber_deck(name,rect):
    x0,z0,x1,z1=rect;length=x1-x0;count=math.ceil(length/.26);verts=[];faces=[]
    for i in range(count):
        a=x0+i*length/count;b=a+length/count-.006;k=len(verts)
        verts.extend([(-a,-z0,-.18),(-b,-z0,-.18),(-b,-z1,-.18),(-a,-z1,-.18),(-a,-z0,.045),(-b,-z0,.045),(-b,-z1,.045),(-a,-z1,.045)])
        faces.extend([tuple(k+j for j in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]])
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();mesh.materials.append(wood)
    ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob)
    uv=mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        p=mesh.vertices[loop.vertex_index].co;uv.data[loop.index].uv=(p.y/2.5,p.x/2.5)

visual_rects=[('Ferry cross-pier',[10.95,-8.5,20.6,-6.3]),('Ferry approach',[20.6,-13.6,23.4,-6.3]),('Ferry landing',[19.5,-18.4,25,-13.6])]
for name,rect in visual_rects:timber_deck(name,rect)

# Reuse the real wood piling mesh at the pier perimeter. No torso-height crossbar
# crosses the landing center where Jonah and the player stand.
post=next(o for o in bpy.context.scene.objects if o.name.startswith('Pier piling'))
for i,(x,z) in enumerate([(11,-8.5),(15,-8.5),(19,-8.5),(23.4,-8.5),(23.4,-12),(23.4,-17.5),(19.5,-18.4),(25,-18.4),(25,-13.6),(19.5,-13.6)]):
    copy=post.copy();copy.data=post.data;bpy.context.collection.objects.link(copy)
    center=copy.matrix_world.translation.copy();copy.location.x+=-x-center.x;copy.location.y+=-z-center.y
    copy.name=f'Ferry mooring post {i}'

bpy.context.view_layer.update()
buildings=[dict(id=ob.name,rect=[round(v,4) for v in bounds(ob)]) for ob in bpy.context.scene.objects if ob.type=='MESH' and ob.name.startswith('Tripo')]
walkable=[
 {'id':'main-pier','rect':[-19.224,-10.64,10.95,-4.88],'height':.07},
 {'id':'keeper-landing','rect':[.2,-12.3,3.8,-10.63],'height':.07},
 {'id':'boardwalk','rect':[-3.01,-4.84,1.96,10.72],'height':.09},
 {'id':'stone-quay','polygon':[[40,50],[2,50],[2,14],[-3,14],[-3,-5],[40,-5]],'height':-.075},
 {'id':'keeper-causeway','rect':[-17,14,-3,17],'height':-.075},
 {'id':'lighthouse-headland','polygon':[[round(-17-6.8*math.cos(i*math.tau/18),4),round(19-7*math.sin(i*math.tau/18),4)] for i in range(18)],'height':.575},
]+[{'id':name.lower().replace(' ','-'),'rect':rect,'height':.07} for name,rect in rects]
manifest=dict(schemaVersion=1,coordinateSystem='logical world XZ; rectangle [minX,minZ,maxX,maxZ]',sourceAsset='bellweather-harbor-v6.glb',playerRadiusRecommendation=.3,walkableUnion=walkable,buildingObstacles=buildings,notes=['Test the avatar footprint against the union of walkable surfaces; do not shrink each rectangle separately.','Building boxes include roof/eave overhang and are intentionally conservative.','Current WORLD maxZ16 clips the lighthouse headland; full exploration needs maxZ28.','All heights include renderer harbor y offset +.025.'])
(ROOT/'game/tools/harbor-navigation.json').write_text(json.dumps(manifest,indent=2))
for image in bpy.data.images:
    if image.source=='FILE':image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'game/art/bellweather-harbor-v6.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'bellweather-harbor-v6.glb'),export_format='GLB',export_cameras=False,export_lights=False,export_image_format='JPEG',export_jpeg_quality=88)
print(json.dumps(dict(bytes=(OUT/'bellweather-harbor-v6.glb').stat().st_size,buildings=buildings,ferryDecks=rects)))
