import { Bone, Group, Mesh, Skeleton, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3, BufferGeometry, Float32BufferAttribute, BoxGeometry } from '@iwsdk/core';
import { B, RIG, ARM_X, ARM_Y, PROPORTIONS as P } from './instructor-proportions.js';
import { profile, skin, rigidWeight, limbWeight } from './instructor-geometry.js';
import { placeOnSurface, surfaceFrame } from './hardsurface.js';
import { cutQuads } from './avatar-kit.js';

// Floor origin; +Y up; +Z faces the learner. Static body depth is authored,
// while the animation remains a camera-plane approximation of the footage.
export const instructor = new Group(); instructor.name = 'FolkInstructor';
instructor.userData.character = 'Stylized instructor inspired by the first demonstrator; locally authored mesh, not a Tripo output.';
const materials = {
  shirt: new MeshStandardMaterial({ color: 0xe5e1d6, roughness: .9, flatShading: false }),
  pants: new MeshStandardMaterial({ color: 0x86857f, roughness: .95, flatShading: false }),
  skin: new MeshStandardMaterial({ color: 0xb98d70, roughness: .8, flatShading: false }),
  hair: new MeshStandardMaterial({ color: 0x747570, roughness: 1, flatShading: true }),
  trim: new MeshStandardMaterial({ color: 0x4b4c45, roughness: .9, flatShading: true }),
  shoe: new MeshStandardMaterial({ color: 0x262e30, roughness: .85, flatShading: true }),
  eye: new MeshStandardMaterial({ color: 0x251c16, roughness: .9 }),
  white: new MeshStandardMaterial({ color: 0xe6d9c5, roughness: .8 }),
};
const bones: Bone[] = RIG.map(([name, , x, y, z]) => { const b = new Bone(); b.name = name; b.position.set(x, y, z); return b; });
RIG.forEach(([, parent], i) => { if (parent < 0) instructor.add(bones[i]); else bones[parent].add(bones[i]); });
instructor.updateMatrixWorld(true);
const skeleton = new Skeleton(bones);
const torso = profile([
  { y: .79, w: .196, d: .122 }, { y: .83, w: .19, d: .118 }, { y: .9, w: .178, d: .11 },
  { y: 1.06, w: .158, d: .104 }, { y: 1.23, w: .17, d: .104 },
  { y: 1.35, w: .209, d: .095 }, { y: 1.395, w: .212, d: .077 },
  { y: 1.44, w: .09, d: .056 }, { y: 1.46, w: .068, d: .05 },
], 12);
instructor.add(skin(torso, 'CreamShirt', materials.shirt, skeleton, (_x, y) => y < 1.05 ? [B.Hips, B.Spine, Math.max(0, (y - .9) / .15)] : [B.Spine, B.Chest, Math.min(1, (y - 1.05) / .25)]));
instructor.add(skin(profile([
  { y: .765, w: .14, d: .08 }, { y: .8, w: .146, d: .086 },
  { y: .83, w: .136, d: .078 }, { y: .86, w: .118, d: .066 },
], 12), 'TrouserWaist', materials.pants, skeleton, rigidWeight(B.Hips)));
instructor.add(skin(profile([
  { y: 1.425, w: .05, d: .04 }, { y: 1.47, w: .05, d: .041 }, { y: 1.5, w: .053, d: .045 }, { y: 1.535, w: .05, d: .042 },
]), 'NeckSkin', materials.skin, skeleton, rigidWeight(B.Neck)));
const head = profile([
  { y: 1.512, w: .05, d: .052 }, { y: 1.54, w: .067, d: .064 },
  { y: 1.59, w: .084, d: .077 }, { y: 1.65, w: .09, d: .083 },
  { y: 1.71, w: .083, d: .077 }, { y: 1.755, w: .057, d: .052 },
  { y: 1.771, w: .018, d: .02 },
], 12);
instructor.add(skin(head, 'FacetedHead', materials.skin, skeleton, rigidWeight(B.Head)));

for (const side of [1, -1]) {
  const left = side === 1, arm = left ? B.LeftUpperArm : B.RightUpperArm;
  const forearm = arm + 1, hand = arm + 2, dx = side * ARM_X;
  const name = left ? 'Left' : 'Right';
  const originX = side * P.shoulderWidth / 2, originY = 1.38;
  const orient = (g: BufferGeometry) => g.rotateZ(Math.atan2(-dx, ARM_Y)).translate(originX, originY, .015);
  const armWeights = limbWeight(originX, originY, dx, ARM_Y, arm, forearm, hand, P.upperArm, P.forearm);
  const skinArm = orient(profile([
    { y: 0, w: .067, d: .063 }, { y: .07, w: .065, d: .059 },
    { y: .18, w: .047, d: .045 }, { y: .235, w: .038, d: .037 },
    { y: .255, w: .038, d: .037 }, { y: .28, w: .041, d: .036 },
    { y: .34, w: .043, d: .036 }, { y: .44, w: .028, d: .025 },
    { y: .49, w: .026, d: .023 }, { y: .515, w: .039, d: .022 },
    { y: .56, w: .039, d: .02 }, { y: .595, w: .027, d: .016 },
    { y: .607, w: .011, d: .009 },
  ], 8));
  instructor.add(skin(skinArm, `${name}ArmSkin`, materials.skin, skeleton, armWeights));
  instructor.add(skin(orient(profile([
    // The sleeve's inner end tapers away inside the torso, so no open rim can show at the shoulder.
    { y: -.04, w: .03, d: .03 }, { y: -.012, w: .068, d: .064 }, { y: .035, w: .09, d: .079 },
    { y: .13, w: .081, d: .066 }, { y: .162, w: .077, d: .062 },
  ], 10)), `${name}Sleeve`, materials.shirt, skeleton, rigidWeight(arm)));
  const leg = left ? B.LeftUpperLeg : B.RightUpperLeg, knee = leg + 1, foot = leg + 2;
  const trouser = profile([
    { y: -.03, w: .062, d: .058 }, { y: .04, w: .08, d: .072 }, { y: .11, w: .092, d: .08 },
    { y: .23, w: .084, d: .072 }, { y: .34, w: .074, d: .064 },
    { y: .39, w: .071, d: .061 }, { y: .43, w: .075, d: .062 },
    { y: .54, w: .07, d: .06 }, { y: .66, w: .064, d: .054 },
    { y: .69, w: .059, d: .062 }, { y: .725, w: .06, d: .064 },
  ], 10).rotateZ(Math.PI).translate(side * .1, .86, 0);
  const legWeights = limbWeight(side * .1, .86, 0, -1, leg, knee, foot, P.thigh, P.shin);
  // Above the shirt hem the trouser moves with the pelvis, so a swinging thigh can never
  // cut through the shirt; it blends into the thigh over the 9 cm below the hem.
  instructor.add(skin(trouser, `${name}TrouserLeg`, materials.pants, skeleton, (x, y) => {
    if (y >= .755) return [B.Hips, B.Hips, 0];
    if (y >= .655) { const t = (.755 - y) / .1; return [B.Hips, leg, t * t * (3 - 2 * t)]; }
    return legWeights(x, y);
  }));
  const shoe = new Mesh(profile([
    { y: -.105, w: .046, d: .063, front: .145 },
    { y: -.087, w: .05, d: .066, front: .15 },
    { y: -.045, w: .046, d: .057, front: .132 },
    { y: .02, w: .036, d: .04, front: .05 },
    { y: .055, w: .032, d: .033, front: .035 },
  ], 10), materials.shoe);
  shoe.name = `${name}DanceShoe`; bones[foot].add(shoe);
  const marker = new Mesh(new TorusGeometry(.047, .006, 5, 16), new MeshStandardMaterial({ color: left ? 0x92f3d3 : 0xffbd83, emissive: left ? 0x296c59 : 0x8b4220, emissiveIntensity: .5, roughness: .6 }));
  marker.name = `${name}WristGuide`; marker.position.z = .075;
  marker.userData.iwsdkPreviewBounds = 'exclude'; bones[hand].add(marker);
  const thumb = new Mesh(new SphereGeometry(1, 6, 4), materials.skin);
  thumb.name = `${name}Thumb`; thumb.scale.set(.018, .037, .018);
  thumb.position.set(-side * .005, -.045, .025); bones[hand].add(thumb);
}

const face = new Group(); face.name = 'FaceDetails'; bones[B.Head].add(face);
const addFace = (mesh: Mesh, name: string, x: number, y: number, z: number, nx = 0) => {
  mesh.name = name;
  placeOnSurface(mesh, surfaceFrame(new Vector3(x, y, z), new Vector3(nx, 0, 1).normalize(), new Vector3(1, 0, 0)), 0);
  face.add(mesh);
};
for (const side of [1, -1]) {
  const iris = new Mesh(new SphereGeometry(1, 8, 6), materials.eye); iris.scale.set(.0065, .0075, .004);
  addFace(iris, `${side}EyeIris`, side * .034, .091, .082, side * .2);
  addFace(new Mesh(new BoxGeometry(.03, .005, .006), materials.hair), `${side}Eyebrow`, side * .031, .109, .081, side * .2);
  const ear = new Mesh(new SphereGeometry(1, 8, 5), materials.skin); ear.scale.set(.017, .032, .02);
  addFace(ear, `${side}Ear`, side * .086, .074, -.005, side * 3);
}
const noseGeometry = new BufferGeometry();
noseGeometry.setAttribute('position', new Float32BufferAttribute([
  -.012, .085, .078, .012, .085, .078, 0, .053, .109,
  -.012, .085, .078, 0, .053, .109, -.014, .044, .077,
  .012, .085, .078, .014, .044, .077, 0, .053, .109,
  -.014, .044, .077, 0, .053, .109, .014, .044, .077,
], 3)); noseGeometry.setIndex([0, 2, 1, 3, 5, 4, 6, 8, 7, 9, 11, 10]); noseGeometry.computeVertexNormals();
const nose = new Mesh(noseGeometry, materials.skin); nose.name = 'FacetedNose'; face.add(nose);
const hair = profile([
  { y: 1.655, w: .095, d: .088 }, { y: 1.69, w: .094, d: .088 }, { y: 1.725, w: .087, d: .081 },
  { y: 1.764, w: .066, d: .063 }, { y: 1.79, w: .026, d: .028 },
], 12);
// Remove front-centre hair below the crown (whole quads, so the hairline is a clean edge).
const scalp = cutQuads(hair, (x, y, z) => !(z > 0 && Math.abs(x) < .06 && y < 1.742));
instructor.add(skin(scalp, 'CroppedGrayHair', materials.hair, skeleton, rigidWeight(B.Head)));
const collar = new BufferGeometry();
collar.setAttribute('position', new Float32BufferAttribute([
  -.068, 1.46, .055, -.063, 1.463, .06, 0, 1.4, .11,
  -.068, 1.46, .055, 0, 1.4, .11, 0, 1.392, .111,
  0, 1.4, .11, .063, 1.463, .06, .068, 1.46, .055,
  0, 1.4, .11, .068, 1.46, .055, 0, 1.392, .111,
], 3)); collar.setIndex([0, 2, 1, 3, 5, 4, 6, 8, 7, 9, 11, 10]); collar.computeVertexNormals();
collar.dispose();   // the V trim floated off the faceted shirt; the neckline reads without it
instructor.updateMatrixWorld(true);
