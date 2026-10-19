import { Bone, BufferGeometry, Float32BufferAttribute, Group, Material, Mesh, MeshStandardMaterial, Quaternion, Skeleton, TorusGeometry, Vector3 } from '@iwsdk/core';
import { ARM_X, ARM_Y, B, PROPORTIONS as P, RIG } from './instructor-proportions.js';
import { profile, type Section } from './instructor-geometry.js';

/**
 * Shared construction kit for the alternate avatars. Every avatar uses the instructor's
 * 17-bone rig (identity rest rotations, +Z forward, floor at y=0) so the same motion
 * plays on it. Rigid parts are parented straight to bones: no skin blending, nothing
 * to tear. Geometry is authored in world rest pose and converted to bone space here.
 */
export type Avatar = { root: Group; bones: Bone[]; skeleton: Skeleton; world: Vector3[] };

export function createAvatar(name: string): Avatar {
  const root = new Group(); root.name = name;
  const bones = RIG.map(([n, , x, y, z]) => { const b = new Bone(); b.name = n; b.position.set(x, y, z); return b; });
  RIG.forEach(([, parent], i) => { if (parent < 0) root.add(bones[i]); else bones[parent].add(bones[i]); });
  root.updateMatrixWorld(true);
  const world = bones.map(b => b.getWorldPosition(new Vector3()));
  return { root, bones, skeleton: new Skeleton(bones), world };
}

/** Attach world-rest-pose geometry rigidly to a bone. */
export function attach(av: Avatar, bone: number, geometry: BufferGeometry, material: Material, name: string): Mesh {
  const w = av.world[bone];
  const mesh = new Mesh(geometry.translate(-w.x, -w.y, -w.z), material);
  mesh.name = name; mesh.frustumCulled = false;
  av.bones[bone].add(mesh);
  return mesh;
}

const UP = new Vector3(0, 1, 0);
/** A lofted segment whose local +Y runs along `dir` from `origin` (sections use distance along the limb). */
export function segment(sections: Section[], origin: Vector3, dir: Vector3, radial = 10): BufferGeometry {
  const q = new Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  return profile(sections, radial).applyQuaternion(q).translate(origin.x, origin.y, origin.z);
}

export const armDir = (side: number) => new Vector3(side * ARM_X, ARM_Y, 0);
export const LEG_DIR = new Vector3(0, -1, 0);
/** World rest-pose joint centres for one side (1 = the avatar's left, +X). */
export function joints(av: Avatar, side: number) {
  const l = side === 1;
  return {
    shoulder: av.world[l ? B.LeftUpperArm : B.RightUpperArm], elbow: av.world[l ? B.LeftForeArm : B.RightForeArm],
    wrist: av.world[l ? B.LeftHand : B.RightHand], hip: av.world[l ? B.LeftUpperLeg : B.RightUpperLeg],
    knee: av.world[l ? B.LeftLowerLeg : B.RightLowerLeg], ankle: av.world[l ? B.LeftFoot : B.RightFoot],
    ua: l ? B.LeftUpperArm : B.RightUpperArm, fa: l ? B.LeftForeArm : B.RightForeArm, hand: l ? B.LeftHand : B.RightHand,
    ul: l ? B.LeftUpperLeg : B.RightUpperLeg, ll: l ? B.LeftLowerLeg : B.RightLowerLeg, foot: l ? B.LeftFoot : B.RightFoot,
  };
}

/** The lesson rig expects wrist guide rings on the hand bones; the viewer keeps them hidden. */
export function wristGuides(av: Avatar): void {
  for (const side of [1, -1]) {
    const marker = new Mesh(new TorusGeometry(.047, .006, 5, 16), new MeshStandardMaterial({ color: side === 1 ? 0x92f3d3 : 0xffbd83, roughness: .6 }));
    marker.name = `${side === 1 ? 'Left' : 'Right'}WristGuide`; marker.position.z = .075; marker.visible = false;
    marker.userData.iwsdkPreviewBounds = 'exclude';
    av.bones[side === 1 ? B.LeftHand : B.RightHand].add(marker);
  }
}

/** Shoe/foot footprint matching the solver's sole (toe +0.145, heel -0.063, sole 0.105 below the ankle). */
export const FOOT_SECTIONS: Section[] = [
  { y: -.105, w: .047, d: .064, front: .146 }, { y: -.087, w: .051, d: .067, front: .15 },
  { y: -.045, w: .047, d: .058, front: .132 }, { y: .015, w: .038, d: .042, front: .055 },
  { y: .045, w: .034, d: .035, front: .036 },
];
export { B, P, ARM_X, ARM_Y };

/**
 * Keep whole quads (consecutive triangle pairs of a loft) whose centroid passes `keep`.
 * Cutting single triangles leaves a sawtooth edge; quads follow the loft's clean grid.
 */
export function cutQuads(g: BufferGeometry, keep: (x: number, y: number, z: number) => boolean): BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g, p = src.getAttribute('position'), out: number[] = [];
  for (let i = 0; i + 5 < p.count; i += 6) {
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < 6; j++) { x += p.getX(i + j) / 6; y += p.getY(i + j) / 6; z += p.getZ(i + j) / 6; }
    if (keep(x, y, z)) for (let j = 0; j < 6; j++) out.push(p.getX(i + j), p.getY(i + j), p.getZ(i + j));
  }
  if (src !== g) src.dispose();
  g.dispose();
  const r = new BufferGeometry(); r.setAttribute('position', new Float32BufferAttribute(out, 3)); r.computeVertexNormals();
  return r;
}
