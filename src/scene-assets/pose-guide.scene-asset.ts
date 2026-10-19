import { Group, Mesh, SphereGeometry, CylinderGeometry, MeshStandardMaterial, Vector3 } from '@iwsdk/core';

export const JOINTS = [0,11,12,13,14,15,16,23,24,25,26,27,28,29,30,31,32];
export const BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32],[0,11],[0,12]];
const mint = new MeshStandardMaterial({color:0x92f3d3, roughness:0.4, emissive:0x1b5c50, emissiveIntensity:0.35});
const orange = new MeshStandardMaterial({color:0xffbd83, roughness:0.4, emissive:0x8b4220, emissiveIntensity:0.25});
const white = new MeshStandardMaterial({color:0xfff6e5, roughness:0.4});
const sphere = new SphereGeometry(1,12,8);
const cylinder = new CylinderGeometry(1,1,1,10);
const standing: Record<number,number[]> = {0:[0,1.7,0],11:[.23,1.42,0],12:[-.23,1.42,0],13:[.4,1.14,0],14:[-.4,1.14,0],15:[.45,.9,0],16:[-.45,.9,0],23:[.15,.88,0],24:[-.15,.88,0],25:[.18,.49,0],26:[-.18,.49,0],27:[.19,.09,0],28:[-.19,.09,0],29:[.19,.055,.035],30:[-.19,.055,.035],31:[.19,.04,.16],32:[-.19,.04,.16]};

// An intentionally schematic landmark guide, not an anatomically rigged avatar.
export const poseGuide = new Group();
poseGuide.name = 'PoseGuide';
for (const index of JOINTS) {
  const mesh = new Mesh(sphere,index===0 ? white : index%2 ? mint : orange);
  mesh.name = `joint-${index}`;
  mesh.position.fromArray(standing[index]);
  mesh.scale.setScalar(index===0 ? .095 : .035);
  poseGuide.add(mesh);
}
const up = new Vector3(0,1,0), direction = new Vector3();
for (const [a,b] of BONES) {
  const mesh = new Mesh(cylinder,a%2 ? mint : orange);
  mesh.name = `bone-${a}-${b}`;
  const p = new Vector3().fromArray(standing[a]), q = new Vector3().fromArray(standing[b]);
  direction.subVectors(q,p);
  mesh.position.addVectors(p,q).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(up,direction.clone().normalize());
  mesh.scale.set(.023,direction.length(),.023);
  poseGuide.add(mesh);
}
