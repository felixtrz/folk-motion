import { BufferGeometry, DoubleSide, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3 } from '@iwsdk/core';
import { limbWeight, profile, skin, type Section } from './instructor-geometry.js';
import { B, FOOT_SECTIONS, LEG_DIR, P, armDir, attach, createAvatar, cutQuads, joints, segment, wristGuides } from './avatar-kit.js';

// A Parisian gentleman: blond bob with a straight fringe, a waxed moustache curled at the
// tips, a brown tweed three-piece suit, white shirt and tie, on the instructor rig. Origin at
// floor centre; +Y up; +Z forward. The suit front is layered panels on the skinned jacket,
// each a few millimetres proud with identical weights, so they bend together and never split.
const av = createAvatar('SpecimenGentleman');
export const gentleman = av.root;
gentleman.userData.character = 'Parisian gentleman in a tweed suit, locally authored.';
const tweed = new MeshStandardMaterial({ color: 0x7b5636, roughness: .92 });
const lapel = new MeshStandardMaterial({ color: 0x8d6643, roughness: .9 });
const waistcoat = new MeshStandardMaterial({ color: 0x5e3f27, roughness: .9 });
const shirt = new MeshStandardMaterial({ color: 0xf3f0e8, roughness: .7 });
const tie = new MeshStandardMaterial({ color: 0x5a1f24, roughness: .6 });
const flesh = new MeshStandardMaterial({ color: 0xe0b394, roughness: .75 });
// Both sides: the face is cut out of the bob, and seen through that opening its inside must
// read as hair (a volume on the head), not as a hollow shell you can see the room through.
const hair = new MeshStandardMaterial({ color: 0xe4c46e, roughness: .55, side: DoubleSide });
const tache = new MeshStandardMaterial({ color: 0xb08a3e, roughness: .55 });
const leather = new MeshStandardMaterial({ color: 0x3b2417, roughness: .45 });
const ink = new MeshStandardMaterial({ color: 0x1a1a18, roughness: .5 });
const horn = new MeshStandardMaterial({ color: 0x2e2018, roughness: .4 });
const at = (g: BufferGeometry, p: Vector3) => g.translate(p.x, p.y, p.z);
const ball = (r: number) => new SphereGeometry(r, 10, 8);
const grow = (sections: Section[], by: number) => sections.map(s => ({ ...s, w: s.w + by, d: s.d + by, front: s.front !== undefined ? s.front + by : undefined }));

// Jacket: one skinned body, fitted at the waist with a short skirt over the hips.
// Fine rings (every ~2 cm) so the V, the tie and the lapels cut cleanly from whole quads.
const densify = (s: Section[], step: number): Section[] => s.flatMap((a, i) => {
  const b = s[i + 1];
  if (!b) return [a];
  const n = Math.max(1, Math.round((b.y - a.y) / step)), lerp = (u: number, v: number, t: number) => u + (v - u) * t;
  return Array.from({ length: n }, (_, k) => {
    const t = k / n, fa = a.front ?? a.d, fb = b.front ?? b.d;
    return { y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), d: lerp(a.d, b.d, t), front: a.front !== undefined || b.front !== undefined ? lerp(fa, fb, t) : undefined };
  });
});
const torsoS: Section[] = densify([
  { y: .7, w: .07, d: .06 }, { y: .73, w: .19, d: .12 }, { y: .8, w: .19, d: .12, front: .124 }, { y: .92, w: .178, d: .114, front: .128 },
  { y: 1.05, w: .158, d: .106, front: .132 }, { y: 1.19, w: .166, d: .104, front: .13 }, { y: 1.3, w: .186, d: .104, front: .124 },
  { y: 1.38, w: .19, d: .096, front: .108 }, { y: 1.44, w: .12, d: .07, front: .075 }, { y: 1.47, w: .07, d: .055 },
], .02);
const torsoWeight = (_x: number, y: number): [number, number, number] => y < 1.05
  ? [B.Hips, B.Spine, Math.min(1, Math.max(0, (y - .9) / .15))] : [B.Spine, B.Chest, Math.min(1, (y - 1.05) / .25)];
const panel = (by: number, keep: (x: number, y: number, z: number) => boolean, m: MeshStandardMaterial, name: string) =>
  gentleman.add(skin(cutQuads(profile(grow(torsoS, by), 36), keep), name, m, av.skeleton, torsoWeight));
gentleman.add(skin(profile(torsoS, 36), 'Jacket', tweed, av.skeleton, torsoWeight));
// The open front: waistcoat in the V, the shirt above it, the tie down the middle, lapels on the edges.
const vee = (y: number) => .42 * (y - 1.06);
panel(.006, (x, y, z) => z > .05 && y > 1.06 && y < 1.43 && Math.abs(x) < vee(y), waistcoat, 'Waistcoat');
panel(.010, (x, y, z) => z > .05 && y > 1.25 && y < 1.45 && Math.abs(x) < .32 * (y - 1.23), shirt, 'ShirtFront');
panel(.014, (x, y, z) => z > .05 && y > 1.12 && y < 1.44 && Math.abs(x) < .016 + (1.44 - y) * .03, tie, 'Tie');
panel(.012, (x, y, z) => z > .05 && y > 1.06 && y < 1.43 && Math.abs(x) >= vee(y) && Math.abs(x) < vee(y) + .03, lapel, 'Lapels');
for (const [i, y] of [1.1, 1.15].entries()) attach(av, B.Spine, at(ball(.007), new Vector3(0, y, .146)), horn, `Button${i}`);
attach(av, B.Chest, profile([{ y: 1.44, w: .064, d: .058 }, { y: 1.5, w: .058, d: .054 }], 12), shirt, 'Collar');
attach(av, B.Neck, profile([{ y: 1.47, w: .05, d: .046 }, { y: 1.54, w: .048, d: .045 }], 10), flesh, 'Neck');

// Head: face, eyes, a small nose; the bob is a flared helmet open at the face, cut straight
// across the brow (the fringe) and hanging to the jaw at the sides and back.
const headS: Section[] = [{ y: 1.52, w: .05, d: .052 }, { y: 1.55, w: .066, d: .066 }, { y: 1.6, w: .08, d: .08 }, { y: 1.66, w: .086, d: .084 }, { y: 1.72, w: .08, d: .077 }, { y: 1.76, w: .05, d: .05 }, { y: 1.775, w: .02, d: .02 }];
attach(av, B.Head, profile(headS, 14), flesh, 'Face');
for (const side of [1, -1]) attach(av, B.Head, at(ball(.0095), new Vector3(side * .029, 1.648, .08)), ink, `${side > 0 ? 'Left' : 'Right'}Eye`);
attach(av, B.Head, at(new SphereGeometry(.013, 8, 6).scale(1, 1.2, 1), new Vector3(0, 1.618, .088)), flesh, 'Nose');
const hairS: Section[] = [
  // A bell: close at the crown, flaring well past the head to a wide, blunt edge at the jaw.
  // The underside rim keeps the end cap inside the head, so cutting the face out leaves no sliver.
  { y: 1.531, w: .062, d: .062 }, { y: 1.533, w: .162, d: .142 }, { y: 1.548, w: .164, d: .146 }, { y: 1.585, w: .152, d: .138 },
  { y: 1.63, w: .136, d: .124 }, { y: 1.68, w: .118, d: .11 }, { y: 1.73, w: .102, d: .098 }, { y: 1.775, w: .076, d: .074 },
  { y: 1.8, w: .036, d: .036 }, { y: 1.806, w: .006, d: .006 },
];
attach(av, B.Head, cutQuads(profile(hairS, 20), (x, y, z) => !(z > .02 && Math.abs(x) < .056 + Math.max(0, 1.65 - y) * .45 && y < 1.692)), hair, 'Bob');
// Moustache: two tapered wings off the lip, rising into tight curls at the tips.
for (const side of [1, -1]) {
  const root = new Vector3(side * .003, 1.598, .092), dir = new Vector3(side, -.1, -.3).normalize();
  attach(av, B.Head, segment([{ y: 0, w: .014, d: .009 }, { y: .025, w: .012, d: .008 }, { y: .048, w: .007, d: .005 }, { y: .058, w: .005, d: .004 }], root, dir, 10), tache, `Moustache${side}`);
  const tip = root.clone().addScaledVector(dir, .058);
  const curl = new TorusGeometry(.012, .0042, 8, 16, Math.PI * 1.6).rotateZ(side > 0 ? -Math.PI / 2 : Math.PI * .9).rotateY(side * -.45);
  attach(av, B.Head, curl.translate(tip.x + side * .002, tip.y + .012, tip.z - .004), tache, `Curl${side}`);
}

for (const side of [1, -1]) {
  const j = joints(av, side), n = side === 1 ? 'Left' : 'Right', dir = armDir(side);
  // Sleeves: slim tailored tweed to the wrist, a white shirt cuff, a bare hand.
  const armWeights = limbWeight(j.shoulder.x, j.shoulder.y, dir.x, dir.y, j.ua, j.fa, j.hand, P.upperArm, P.forearm);
  gentleman.add(skin(segment([
    { y: -.09, w: .04, d: .04 }, { y: -.03, w: .062, d: .06 }, { y: .04, w: .064, d: .062 }, { y: .2, w: .054, d: .052 }, { y: .255, w: .05, d: .048 },
    { y: .34, w: .047, d: .045 }, { y: .44, w: .043, d: .041 }, { y: .47, w: .042, d: .04 },
  ], j.shoulder, dir, 12), `${n}Sleeve`, tweed, av.skeleton, armWeights));
  attach(av, j.fa, segment([{ y: .2, w: .037, d: .035 }, { y: .236, w: .036, d: .034 }], j.elbow, dir, 10), shirt, `${n}Cuff`);
  attach(av, j.hand, segment([{ y: -.004, w: .026, d: .02 }, { y: .03, w: .034, d: .016 }, { y: .075, w: .036, d: .015 }, { y: .1, w: .03, d: .013 }, { y: .112, w: .014, d: .01 }], j.wrist, dir, 8), flesh, `${n}Hand`);
  const thumb = j.wrist.clone().addScaledVector(dir, .035).add(new Vector3(0, 0, .022));
  attach(av, j.hand, segment([{ y: 0, w: .009, d: .009 }, { y: .035, w: .007, d: .007 }], thumb, dir.clone().add(new Vector3(0, 0, .6)).normalize(), 6), flesh, `${n}Thumb`);
  // Trousers: straight-cut, the top riding the pelvis inside the jacket skirt.
  const legWeights = limbWeight(j.hip.x, j.hip.y, 0, -1, j.ul, j.ll, j.foot, P.thigh, P.shin);
  gentleman.add(skin(segment([
    { y: -.06, w: .058, d: .058 }, { y: .02, w: .074, d: .076 }, { y: .14, w: .078, d: .08 }, { y: .34, w: .066, d: .066 },
    { y: .39, w: .062, d: .062 }, { y: .5, w: .056, d: .056 }, { y: .66, w: .054, d: .054 }, { y: .74, w: .055, d: .058 },
  ], j.hip, LEG_DIR, 12), `${n}Trouser`, tweed, av.skeleton, (x, y) => {
    if (y >= .78) return [B.Hips, B.Hips, 0];
    if (y >= .68) { const t = (.78 - y) / .1; return [B.Hips, j.ul, t * t * (3 - 2 * t)]; }
    return legWeights(x, y);
  }));
  attach(av, j.foot, at(profile(FOOT_SECTIONS, 12), j.ankle.clone()), leather, `${n}Brogue`);
}
wristGuides(av);
gentleman.updateMatrixWorld(true);
