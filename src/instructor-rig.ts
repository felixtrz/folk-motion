import { Bone, Object3D, Quaternion, Vector3, Mesh, Material } from '@iwsdk/core';
import { RIG } from './scene-assets/instructor-proportions.js';
import { upperObserved, type Motion } from './motion.js';

const NB = RIG.length;
const SLOTS = [0, 15, 16];
// Bone index that holds the opposite side's data when the pose is reflected.
const MIRROR = RIG.map(([name], i) => {
  const other = name.startsWith('Left') ? name.replace('Left', 'Right') : name.startsWith('Right') ? name.replace('Right', 'Left') : name;
  const index = RIG.findIndex(([n]) => n === other);
  return index < 0 ? i : index;
});

/**
 * Plays solved motion on an independently cloned skeleton: interpolated root
 * position and slerped local bone rotations. No per-frame allocations.
 */
export class InstructorRig {
  private readonly bones: Bone[];
  private readonly qa = new Quaternion();
  private readonly qb = new Quaternion();
  private readonly leftMarker: Mesh;
  private readonly rightMarker: Mesh;
  private readonly mint: Material | Material[];
  private readonly peach: Material | Material[];

  constructor(root: Object3D) {
    const require = (name: string): Object3D => {
      const object = root.getObjectByName(name);
      if (!object) throw new Error(`Instructor is missing ${name}`);
      return object;
    };
    this.bones = RIG.map(([name]) => require(name) as Bone);
    this.leftMarker = require('LeftWristGuide') as Mesh; this.rightMarker = require('RightWristGuide') as Mesh;
    this.mint = this.leftMarker.material; this.peach = this.rightMarker.material;
  }

  /**
   * Poses the rig at `time`. With `asRecorded` false the pose is reflected left/right.
   * Writes displayed coaching joints to points[0|15|16] (15 = performer's left wrist)
   * and returns whether the upper body at that time was observed rather than estimated.
   */
  apply(motion: Motion, time: number, asRecorded: boolean, points: Vector3[], confidence: Float32Array): boolean {
    const f = Math.max(0, Math.min(motion.frameCount - 1, time * motion.fps));
    const a = Math.floor(f), b = Math.min(a + 1, motion.frameCount - 1), t = f - a;
    const sign = asRecorded ? 1 : -1;
    const r = motion.root, q = motion.rotations, j = motion.joints;
    this.bones[0].position.set(
      (r[a * 3] + (r[b * 3] - r[a * 3]) * t) * sign,
      r[a * 3 + 1] + (r[b * 3 + 1] - r[a * 3 + 1]) * t,
      r[a * 3 + 2] + (r[b * 3 + 2] - r[a * 3 + 2]) * t);
    for (let i = 0; i < NB; i++) {
      const src = asRecorded ? i : MIRROR[i];
      const oa = (a * NB + src) * 4, ob = (b * NB + src) * 4;
      // Reflection across the YZ plane keeps x and negates y/z of each rotation.
      this.qa.set(q[oa], q[oa + 1] * sign, q[oa + 2] * sign, q[oa + 3]);
      this.qb.set(q[ob], q[ob + 1] * sign, q[ob + 2] * sign, q[ob + 3]);
      this.bones[i].quaternion.slerpQuaternions(this.qa, this.qb, t);
    }
    for (let k = 0; k < 3; k++) {
      const oa = a * 9 + k * 3, ob = b * 9 + k * 3;
      points[SLOTS[k]].set(
        (j[oa] + (j[ob] - j[oa]) * t) * sign,
        j[oa + 1] + (j[ob + 1] - j[oa + 1]) * t,
        j[oa + 2] + (j[ob + 2] - j[oa + 2]) * t);
    }
    // The performer's left wrist keeps the mint guide whichever bone displays it.
    this.leftMarker.material = asRecorded ? this.mint : this.peach;
    this.rightMarker.material = asRecorded ? this.peach : this.mint;
    const observed = upperObserved(motion, time);
    confidence.fill(0);
    if (observed) { confidence[0] = 1; confidence[15] = 1; confidence[16] = 1; }
    return observed;
  }
}
