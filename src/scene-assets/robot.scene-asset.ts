import { BufferGeometry, MeshStandardMaterial, SphereGeometry, Vector3 } from '@iwsdk/core';
import { profile } from './instructor-geometry.js';
import { B, FOOT_SECTIONS, LEG_DIR, armDir, attach, createAvatar, cutQuads, joints, segment, wristGuides } from './avatar-kit.js';
import { bevelBox } from './hardsurface.js';

// A generic sleek humanoid robot (white shells, black joints, glossy black face visor)
// on the instructor rig. Origin at floor centre; +Y up; +Z forward. Every part is rigid
// to one bone, and dark ball joints sit at every articulation, so no surface can tear.
const av = createAvatar('SpecimenRobot');
export const robot = av.root;
robot.userData.character = 'Generic humanoid robot, locally authored; no brand marks.';
const shell = new MeshStandardMaterial({ color: 0xe6e4df, roughness: .3, metalness: 0 });
const core = new MeshStandardMaterial({ color: 0x2a2d31, roughness: .42, metalness: .2 });
const visor = new MeshStandardMaterial({ color: 0x2c3036, roughness: .16, metalness: .45 });
const ball = (r: number) => new SphereGeometry(r, 16, 12);
const at = (g: BufferGeometry, p: Vector3) => g.translate(p.x, p.y, p.z);

// Pelvis, abdomen core, chest.
attach(av, B.Hips, profile([
  { y: .8, w: .1, d: .068 }, { y: .83, w: .156, d: .09, front: .096 }, { y: .9, w: .16, d: .094, front: .1 }, { y: .96, w: .12, d: .08 },
], 14), shell, 'Pelvis');
attach(av, B.Spine, profile([
  { y: .93, w: .088, d: .064 }, { y: .99, w: .1, d: .072 }, { y: 1.02, w: .108, d: .077 }, { y: 1.06, w: .116, d: .081 },
  { y: 1.1, w: .104, d: .074 }, { y: 1.13, w: .094, d: .068 }, { y: 1.17, w: .07, d: .05 }, { y: 1.19, w: .03, d: .025 },
], 14), core, 'AbdomenCore');
attach(av, B.Chest, profile([
  { y: 1.14, w: .12, d: .085, front: .096 }, { y: 1.21, w: .15, d: .094, front: .118 }, { y: 1.31, w: .18, d: .1, front: .124 },
  { y: 1.39, w: .186, d: .09, front: .104 }, { y: 1.45, w: .15, d: .07, front: .075 }, { y: 1.485, w: .075, d: .058 },
], 24), shell, 'ChestPlate');
attach(av, B.Neck, profile([{ y: 1.44, w: .052, d: .05 }, { y: 1.5, w: .046, d: .044 }, { y: 1.55, w: .038, d: .036 }], 12), core, 'NeckActuator');

// Head shell and a visor that follows the same egg shape, 4 mm proud, front only.
const headSections = [
  { y: 1.535, w: .048, d: .05 }, { y: 1.565, w: .068, d: .074 }, { y: 1.62, w: .08, d: .088 },
  { y: 1.685, w: .078, d: .085 }, { y: 1.735, w: .06, d: .066 }, { y: 1.765, w: .026, d: .03 },
];
attach(av, B.Head, profile(headSections, 18), shell, 'HeadShell');
// The visor reuses the head's exact rings and facet count, 6 mm proud (matching facets
// cannot intersect), trimmed to the face by whole quads.
const face = cutQuads(profile(headSections.map(h => ({ ...h, w: h.w + .006, d: h.d + .006 })), 18),
  (x, y, z) => z > .01 && y > 1.59 && y < 1.72);
attach(av, B.Head, face, visor, 'FaceVisor');

for (const side of [1, -1]) {
  const j = joints(av, side), n = side === 1 ? 'Left' : 'Right', dir = armDir(side);
  // Arm: shoulder ball, upper shell, elbow ball, forearm shell, wrist ball, hand.
  attach(av, j.ua, at(ball(.042), j.shoulder.clone()), core, `${n}ShoulderJoint`);
  // Pauldron mounted on the chest, so raising the arm never drives it into the torso.
  attach(av, B.Chest, at(new SphereGeometry(.062, 18, 10, 0, Math.PI * 2, 0, Math.PI * .5).rotateZ(-side * .55), j.shoulder.clone().add(new Vector3(side * .012, .012, 0))), shell, `${n}ShoulderCap`);
  attach(av, j.ua, segment([{ y: .04, w: .044, d: .046 }, { y: .08, w: .054, d: .056 }, { y: .16, w: .05, d: .052 }, { y: .21, w: .04, d: .041 }, { y: .224, w: .032, d: .032 }], j.shoulder, dir, 14), shell, `${n}UpperArmShell`);
  attach(av, j.fa, at(ball(.03), j.elbow.clone()), core, `${n}ElbowJoint`);
  attach(av, j.fa, segment([{ y: .03, w: .036, d: .038 }, { y: .07, w: .05, d: .048 }, { y: .14, w: .044, d: .043 }, { y: .2, w: .032, d: .031 }, { y: .214, w: .026, d: .026 }], j.elbow, dir, 14), shell, `${n}ForearmShell`);
  attach(av, j.hand, at(ball(.024), j.wrist.clone()), core, `${n}WristJoint`);
  attach(av, j.hand, segment([{ y: .015, w: .03, d: .016 }, { y: .055, w: .036, d: .018 }, { y: .1, w: .032, d: .015 }, { y: .118, w: .02, d: .01 }], j.wrist, dir, 8), core, `${n}Hand`);
  // Leg: hip ball, thigh shell, knee ball and cap, shin shell, ankle ball, foot.
  attach(av, j.ul, at(ball(.044), j.hip.clone()), core, `${n}HipJoint`);
  // Domed top that rounds into the hip ball; widest high on the thigh, tapering to the knee.
  attach(av, j.ul, segment([{ y: .03, w: .02, d: .02 }, { y: .055, w: .05, d: .054 }, { y: .1, w: .074, d: .08 }, { y: .2, w: .068, d: .074 }, { y: .31, w: .052, d: .056 }, { y: .345, w: .042, d: .044 }], j.hip, LEG_DIR, 14), shell, `${n}ThighShell`);
  attach(av, j.ll, at(ball(.04), j.knee.clone()), core, `${n}KneeJoint`);
  attach(av, j.ll, segment([{ y: .04, w: .044, d: .05 }, { y: .1, w: .06, d: .07 }, { y: .2, w: .054, d: .06 }, { y: .3, w: .04, d: .043 }, { y: .322, w: .032, d: .034 }], j.knee, LEG_DIR, 14), shell, `${n}ShinShell`);
  attach(av, j.foot, at(ball(.03), j.ankle.clone()), core, `${n}AnkleJoint`);
  attach(av, j.foot, at(profile([FOOT_SECTIONS[0], FOOT_SECTIONS[1], { y: -.074, w: .049, d: .064, front: .146 }], 12), j.ankle.clone()), core, `${n}FootSole`);
  attach(av, j.foot, at(profile([{ y: -.072, w: .058, d: .073, front: .153 }, { y: -.05, w: .054, d: .066, front: .14 }, { y: -.02, w: .042, d: .048, front: .085 }, { y: .005, w: .036, d: .038, front: .045 }], 12), j.ankle.clone()), shell, `${n}FootShell`);
}
wristGuides(av);
robot.updateMatrixWorld(true);
