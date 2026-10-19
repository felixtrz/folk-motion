"""Package the exported bind-pose geometry and skin as a self-contained glTF 2.0.

Input is produced by `iwsdk browser run scripts/export-instructor.mjs`.
No geometry simplification or bone rescaling occurs during packaging.
"""
import json
import struct
import sys
from pathlib import Path

AVATAR = sys.argv[1] if len(sys.argv) > 1 else 'instructor'
source = json.loads(Path(f'.local/{AVATAR}-bind.json').read_text())
binary = bytearray()
gltf = dict(asset=dict(version='2.0', generator='Folk Motion Studio / deterministic avatar'),
            scene=0, scenes=[dict(nodes=[0])], nodes=[], meshes=[], materials=[],
            skins=[], accessors=[], bufferViews=[], buffers=[])

def accessor(array, width, kind, component=5126, target=None):
    while len(binary) % 4:
        binary.append(0)
    start = len(binary)
    binary.extend(struct.pack('<' + ('H' if component == 5123 else 'f') * len(array), *array))
    view = dict(buffer=0, byteOffset=start, byteLength=len(binary) - start)
    if target:
        view['target'] = target
    gltf['bufferViews'].append(view)
    value = dict(bufferView=len(gltf['bufferViews']) - 1, componentType=component, count=len(array) // width, type=kind)
    if kind == 'VEC3':
        value['min'] = [min(array[i::3]) for i in range(3)]
        value['max'] = [max(array[i::3]) for i in range(3)]
    gltf['accessors'].append(value)
    return len(gltf['accessors']) - 1

materials = {m['uuid']: i for i, m in enumerate(source['materials'])}
for m in source['materials']:
    gltf['materials'].append(dict(pbrMetallicRoughness=dict(baseColorFactor=m['color'] + [1],
        roughnessFactor=m['roughness'], metallicFactor=m['metalness']), emissiveFactor=m['emissive']))
attributes = {'position': 'POSITION', 'normal': 'NORMAL', 'skinIndex': 'JOINTS_0', 'skinWeight': 'WEIGHTS_0'}
geometry = {}
for geo in source['geometries']:
    geometry[geo['uuid']] = {}
    for name, a in geo['attributes'].items():
        if name not in attributes:
            continue
        width = a['itemSize']
        if name == 'skinIndex':
            a['array'] = [joint if weight else 0 for joint, weight in zip(a['array'], geo['attributes']['skinWeight']['array'])]
        geometry[geo['uuid']][attributes[name]] = accessor(a['array'], width, 'VEC' + str(width), 5123 if name == 'skinIndex' else 5126, 34962)
nodes = {}
def walk(obj):
    index = len(gltf['nodes']); nodes[obj['uuid']] = index
    node = dict(name=obj.get('name', obj['type']), matrix=obj['matrix'])
    if obj['matrix'] == [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]:
        del node['matrix']
    gltf['nodes'].append(node)
    if 'geometry' in obj:
        node['mesh'] = len(gltf['meshes'])
        gltf['meshes'].append(dict(name=node['name'], primitives=[dict(attributes=geometry[obj['geometry']], material=materials[obj['material']])]))
        if 'skeleton' in obj:
            node['skin'] = 0
    if obj.get('children'):
        node['children'] = [walk(child) for child in obj['children']]
    return index
walk(source['object'])
# glTF skins are scene roots so their transforms cannot be ambiguously inherited.
skinned_nodes = [i for i, node in enumerate(gltf['nodes']) if 'skin' in node]
for node in gltf['nodes']:
    if 'children' in node:
        node['children'] = [i for i in node['children'] if i not in skinned_nodes]
gltf['scenes'][0]['nodes'] += skinned_nodes
joints = []
for skin in source.get('skeletons', []):
    inverse = [v for matrix in skin['boneInverses'] for v in matrix]
    joints = [nodes[uuid] for uuid in skin['bones']]
    gltf['skins'].append(dict(joints=joints, skeleton=joints[0], inverseBindMatrices=accessor(inverse, 16, 'MAT4')))
if not gltf['skins']:
    del gltf['skins']
gltf['buffers'] = [dict(byteLength=len(binary))]
document = json.dumps(gltf, separators=(',', ':')).encode()
document += b' ' * (-len(document) % 4); binary += b'\0' * (-len(binary) % 4)
total = 12 + 8 + len(document) + 8 + len(binary)
output = Path(f'public/characters/{AVATAR}.glb'); output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(document), 0x4E4F534A) + document + struct.pack('<II', len(binary), 0x004E4942) + binary)
print(json.dumps(dict(path=str(output), bytes=total, bones=len(joints) or 17, meshes=len(gltf['meshes']))))
