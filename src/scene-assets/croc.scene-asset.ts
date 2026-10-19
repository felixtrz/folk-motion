import { BufferGeometry, ConeGeometry, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from '@iwsdk/core';
import { limbWeight, profile, skin, type Section } from './instructor-geometry.js';
import { B, FOOT_SECTIONS, LEG_DIR, P, armDir, attach, createAvatar, cutQuads, joints, segment, wristGuides } from './avatar-kit.js';

// A man in a plush green crocodile onesie with red trim, on the instructor rig.
// Origin at floor centre; +Y up; +Z forward. Parts are rigid to bones with plush ball
// joints at every articulation; the face peeks out from under the croc hood.
const av = createAvatar('SpecimenCroc');
export const croc = av.root;
croc.userData.character = 'Man in a crocodile costume, locally authored.';
const plush = new MeshStandardMaterial({ color: 0x6f8a4c, roughness: .95, flatShading: false });
const belly = new MeshStandardMaterial({ color: 0xddd8b4, roughness: .95, flatShading: false });
const trim = new MeshStandardMaterial({ color: 0xb04a3b, roughness: .85, flatShading: true });
const flesh = new MeshStandardMaterial({ color: 0xc89a78, roughness: .8, flatShading: false });
const ivory = new MeshStandardMaterial({ color: 0xf6f1e4, roughness: .6, flatShading: true });
const ink = new MeshStandardMaterial({ color: 0x1a1a18, roughness: .5 });
const at = (g: BufferGeometry, p: Vector3) => g.translate(p.x, p.y, p.z);
const ball = (r: number) => new SphereGeometry(r, 10, 8);
const cut = cutQuads;
const grow = (sections: Section[], by: number) => sections.map(s => ({ ...s, w: s.w + by, d: s.d + by, front: s.front !== undefined ? s.front + by : undefined }));

// Torso: one continuous skinned plush body (pelvis to collar) that bends with the spine
// like the instructor's shirt, so there is no seam between blocks; the belly panel is the
// same surface 12 mm proud with identical weights, so it can never z-fight or split.
const torsoS: Section[] = [
  { y: .68, w: .07, d: .06 }, { y: .72, w: .16, d: .11 }, { y: .77, w: .196, d: .124, front: .128 }, { y: .9, w: .194, d: .124, front: .136 },
  { y: 1.05, w: .164, d: .113, front: .142 }, { y: 1.19, w: .168, d: .108, front: .136 }, { y: 1.3, w: .182, d: .104, front: .128 },
  { y: 1.38, w: .182, d: .095, front: .11 }, { y: 1.44, w: .12, d: .07, front: .075 }, { y: 1.47, w: .07, d: .055 },
];
const torsoWeight = (_x: number, y: number): [number, number, number] => y < 1.05
  ? [B.Hips, B.Spine, Math.min(1, Math.max(0, (y - .9) / .15))] : [B.Spine, B.Chest, Math.min(1, (y - 1.05) / .25)];
croc.add(skin(profile(torsoS, 14), 'SuitBody', plush, av.skeleton, torsoWeight));
croc.add(skin(cut(profile(grow(torsoS, .012), 14), (x, y, z) => z > .07 && Math.abs(x) < .105 && y > .86 && y < 1.34), 'BellyPanel', belly, av.skeleton, torsoWeight));
attach(av, B.Chest, profile([{ y: 1.465, w: .076, d: .062 }, { y: 1.49, w: .074, d: .06 }], 12), trim, 'CollarTrim');
attach(av, B.Neck, profile([{ y: 1.43, w: .055, d: .05 }, { y: 1.53, w: .05, d: .046 }], 10), flesh, 'Neck');

// Head: the man's face inside a hood whose top carries the croc's upper jaw.
const headS: Section[] = [{ y: 1.52, w: .05, d: .052 }, { y: 1.55, w: .068, d: .066 }, { y: 1.6, w: .083, d: .08 }, { y: 1.66, w: .088, d: .084 }, { y: 1.72, w: .08, d: .077 }, { y: 1.76, w: .05, d: .05 }, { y: 1.775, w: .02, d: .02 }];
attach(av, B.Head, profile(headS, 12), flesh, 'Face');
for (const side of [1, -1]) {
  attach(av, B.Head, at(ball(.011), new Vector3(side * .03, 1.648, .079)), ink, `${side > 0 ? 'Left' : 'Right'}Eye`);
}
attach(av, B.Head, at(new SphereGeometry(.014, 8, 6).scale(1.6, .55, .7), new Vector3(0, 1.585, .08)), ink, 'Grin');
// The hood widens into a cowl that drapes over the neck and the tops of the shoulders.
const hoodS = [{ y: 1.42, w: .13, d: .1 }, { y: 1.47, w: .105, d: .09 }, ...grow(headS, .022).map(s => ({ ...s, y: s.y + .005 }))];
attach(av, B.Head, cut(profile(hoodS, 14), (x, y, z) => !((z > 0 && y < 1.74 && y > 1.43 && Math.abs(x) < .074) || (y < 1.52 && z > -.025))), plush, 'Hood');
// Upper jaw: a flat tapered snout off the forehead, ivory teeth along its rim, eye bumps on top.
const jaw = new Vector3(0, 1.765, .07), fwd = new Vector3(0, -.05, 1).normalize();
attach(av, B.Head, segment([{ y: 0, w: .088, d: .044 }, { y: .1, w: .08, d: .038 }, { y: .22, w: .066, d: .03 }, { y: .31, w: .052, d: .026 }, { y: .33, w: .032, d: .017 }], jaw, fwd, 10), plush, 'Snout');
const toothQ = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(0, -1, 0));
for (const side of [1, -1]) for (let i = 0; i < 3; i++) {
  const along = .17 + i * .05, half = .078 - along * .1;
  const p = jaw.clone().addScaledVector(fwd, along).add(new Vector3(side * half * .92, -.03 - along * .02, 0));
  attach(av, B.Head, new ConeGeometry(.009, .02, 4).applyQuaternion(toothQ).translate(p.x, p.y, p.z), ivory, `Tooth${side}_${i}`);
}
for (const side of [1, -1]) {
  const e = new Vector3(side * .045, 1.815, .1);
  attach(av, B.Head, at(new SphereGeometry(.03, 10, 8).scale(1, .85, 1), e.clone()), plush, `EyeBump${side}`);
  attach(av, B.Head, at(new SphereGeometry(.02, 10, 8), e.clone().add(new Vector3(side * .004, .006, .014))), ivory, `EyeWhite${side}`);
  attach(av, B.Head, at(new SphereGeometry(.01, 8, 6), e.clone().add(new Vector3(side * .006, .01, .031))), ink, `Pupil${side}`);
  const nose = jaw.clone().addScaledVector(fwd, .305).add(new Vector3(side * .018, .022, 0));
  attach(av, B.Head, at(new SphereGeometry(.009, 6, 4), nose), plush, `Nostril${side}`);
}
// Crown ridge: the costume's red scutes run up over the back of the hood.
for (const [y, z, h] of [[1.56, -.1, .045], [1.64, -.108, .05], [1.71, -.1, .05], [1.77, -.07, .044]] as const) {
  attach(av, B.Head, new ConeGeometry(h * .55, h, 5).rotateX(-.9).translate(0, y, z), trim, `CrownSpike${y}`);
}
// Back ridge and tail: red spikes on the plush ridge, the tail angled down and back.
const spike = (bone: number, p: Vector3, h: number, name: string) =>
  attach(av, bone, new ConeGeometry(h * .55, h, 5).rotateX(-.3).translate(p.x, p.y + h / 2 - .008, p.z), trim, name);
spike(B.Chest, new Vector3(0, 1.3, -.1), .052, 'Spike1');
spike(B.Spine, new Vector3(0, 1.14, -.104), .056, 'Spike2');
const tailRoot = new Vector3(0, .86, -.1), tailDir = new Vector3(0, .12, -1).normalize();
attach(av, B.Hips, segment([{ y: -.04, w: .1, d: .09 }, { y: .04, w: .13, d: .11 }, { y: .2, w: .1, d: .085 }, { y: .4, w: .062, d: .052 }, { y: .55, w: .028, d: .024 }, { y: .6, w: .01, d: .01 }], tailRoot, tailDir, 12), plush, 'Tail');
attach(av, B.Hips, at(ball(.115), tailRoot.clone().add(new Vector3(0, .0, .03))), plush, 'TailRoot');
for (let i = 0; i < 3; i++) {
  const along = .1 + i * .14, p = tailRoot.clone().addScaledVector(tailDir, along);
  spike(B.Hips, p.add(new Vector3(0, .085 - i * .018, 0)), .05 - i * .008, `TailSpike${i}`);
}

for (const side of [1, -1]) {
  const j = joints(av, side), n = side === 1 ? 'Left' : 'Right', dir = armDir(side);
  // Arms: one continuous skinned plush sleeve from shoulder to wrist (bends like fabric).
  const armWeights = limbWeight(j.shoulder.x, j.shoulder.y, dir.x, dir.y, j.ua, j.fa, j.hand, P.upperArm, P.forearm);
  croc.add(skin(segment([
    { y: -.09, w: .04, d: .04 }, { y: -.03, w: .066, d: .064 }, { y: .04, w: .072, d: .07 }, { y: .2, w: .062, d: .06 }, { y: .255, w: .058, d: .056 },
    { y: .34, w: .056, d: .054 }, { y: .44, w: .05, d: .048 }, { y: .49, w: .047, d: .045 },
  ], j.shoulder, dir, 10), `${n}Sleeve`, plush, av.skeleton, armWeights));
  attach(av, j.fa, segment([{ y: .2, w: .054, d: .052 }, { y: .23, w: .054, d: .052 }], j.elbow, dir, 10), trim, `${n}CuffTrim`);
  attach(av, j.hand, at(ball(.042), j.wrist.clone()), plush, `${n}WristPad`);
  attach(av, j.hand, segment([{ y: .0, w: .036, d: .022 }, { y: .06, w: .044, d: .026 }, { y: .1, w: .038, d: .022 }, { y: .12, w: .02, d: .014 }], j.wrist, dir, 8), plush, `${n}Mitten`);
  for (let c = -1; c <= 1; c++) {
    const tip = j.wrist.clone().addScaledVector(dir, .118).add(new Vector3(c * .016 * Math.abs(dir.y), c * .016 * Math.abs(dir.x), .012));
    attach(av, j.hand, new ConeGeometry(.007, .024, 4).applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir)).translate(tip.x, tip.y, tip.z), ivory, `${n}Claw${c + 1}`);
  }
  // Legs: one continuous baggy leg; its top rides the pelvis inside the suit and blends into
  // the thigh below it, so a swinging thigh never steps out of the body.
  const legWeights = limbWeight(j.hip.x, j.hip.y, 0, -1, j.ul, j.ll, j.foot, P.thigh, P.shin);
  croc.add(skin(segment([
    { y: -.06, w: .06, d: .06 }, { y: .02, w: .078, d: .08 }, { y: .14, w: .092, d: .092 }, { y: .34, w: .082, d: .082 },
    { y: .39, w: .08, d: .08 }, { y: .5, w: .074, d: .074 }, { y: .66, w: .066, d: .066 }, { y: .73, w: .062, d: .062 },
  ], j.hip, LEG_DIR, 10), `${n}Leg`, plush, av.skeleton, (x, y) => {
    if (y >= .78) return [B.Hips, B.Hips, 0];
    if (y >= .68) { const t = (.78 - y) / .1; return [B.Hips, j.ul, t * t * (3 - 2 * t)]; }
    return legWeights(x, y);
  }));
  attach(av, j.ll, segment([{ y: .3, w: .068, d: .068 }, { y: .33, w: .068, d: .068 }], j.knee, LEG_DIR, 10), trim, `${n}AnkleTrim`);
  attach(av, j.foot, at(profile(grow(FOOT_SECTIONS, .006).map((s, i) => i === 0 ? { ...s, y: -.105 } : s), 10), j.ankle.clone()), plush, `${n}Bootie`);
  for (let c = -1; c <= 1; c++) {
    const tip = j.ankle.clone().add(new Vector3(c * .022, -.085, .155));
    attach(av, j.foot, new ConeGeometry(.008, .028, 4).rotateX(Math.PI / 2).translate(tip.x, tip.y, tip.z), ivory, `${n}ToeClaw${c + 1}`);
  }
}
wristGuides(av);
croc.updateMatrixWorld(true);
