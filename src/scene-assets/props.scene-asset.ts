import {
  BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, LatheGeometry, Mesh,
  MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector2, Vector3,
} from '@iwsdk/core';

// Things to throw at the specimen. Each is a parentless prototype, origin at its centre,
// metres, drawn about 1.6x life size so it reads on a phone. Generic and unbranded.

const mat = (color: number, roughness: number, metalness = 0) => new MeshStandardMaterial({ color, roughness, metalness });

/** Soda can: axis +Y, 19 cm tall. Deep red body, brushed aluminium ends, a pull tab. */
export const sodaCan = new Group(); sodaCan.name = 'SodaCan';
{
  const h = .19, r = .053;
  const body = [[0, -h / 2], [r * .78, -h / 2], [r * .9, -h / 2 + .006], [r, -h / 2 + .022], [r, h / 2 - .026],
    [r * .86, h / 2 - .008], [r * .8, h / 2]].map(([x, y]) => new Vector2(x, y));
  const shell = new Mesh(new LatheGeometry(body, 28), mat(0xa8231d, .35, .25));
  shell.name = 'Body'; sodaCan.add(shell);
  const band = new Mesh(new CylinderGeometry(r + .0006, r + .0006, .05, 28, 1, true), mat(0xf3efe6, .45));
  band.name = 'Band'; band.position.y = .012; sodaCan.add(band);
  const lid = new Mesh(new CylinderGeometry(r * .8, r * .8, .004, 28), mat(0xc9ccd0, .3, .9));
  lid.name = 'Lid'; lid.position.y = h / 2 - .002; sodaCan.add(lid);
  const base = lid.clone(); base.name = 'Base'; base.position.y = -h / 2 + .002; sodaCan.add(base);
  const tab = new Mesh(new BoxGeometry(.022, .003, .034), mat(0xb7babf, .3, .9));
  tab.name = 'PullTab'; tab.position.set(0, h / 2 + .002, .006); sodaCan.add(tab);
}

/** Shuttlecock (毽子): weighted base at the origin, feathers fanning up +Y, 22 cm. */
export const shuttlecock = new Group(); shuttlecock.name = 'Shuttlecock';
shuttlecock.scale.setScalar(1.8);   // small and fast: drawn larger still so it reads on a phone
{
  const base = new Mesh(new CylinderGeometry(.034, .038, .02, 20), mat(0x2b2420, .7));
  base.name = 'Base'; shuttlecock.add(base);
  const coin = new Mesh(new CylinderGeometry(.036, .036, .006, 20), mat(0xc39a43, .35, .85));
  coin.name = 'BrassCoin'; coin.position.y = -.012; shuttlecock.add(coin);
  const quill = new Mesh(new CylinderGeometry(.008, .011, .05, 10), mat(0xe9e2d0, .6));
  quill.name = 'Quill'; quill.position.y = .034; shuttlecock.add(quill);
  const colors = [0x1d7f86, 0xe2712c, 0xf3efe6, 0x1d7f86, 0xe2712c, 0xf3efe6, 0x1d7f86, 0xe2712c];
  const feather = new ConeGeometry(.016, .16, 6, 1).scale(1, 1, .28).translate(0, .08, 0);
  colors.forEach((c, i) => {
    const pivot = new Group(); pivot.name = `Feather${i}`;
    pivot.position.y = .05; pivot.rotation.set(.32, i / colors.length * Math.PI * 2, 0, 'YXZ');
    pivot.add(new Mesh(feather, mat(c, .8)));
    shuttlecock.add(pivot);
  });
}

/** Water balloon: 16 cm, glossy blue, a knotted neck on +Y. */
export const waterBalloon = new Group(); waterBalloon.name = 'WaterBalloon';
{
  const skin = new MeshStandardMaterial({ color: 0x2f8fe0, roughness: .12, transparent: true, opacity: .88, emissive: 0x0a2a55, emissiveIntensity: .25 });
  const body = new Mesh(new SphereGeometry(.08, 24, 16), skin);
  body.name = 'Body'; body.scale.set(1, 1.08, 1); waterBalloon.add(body);
  const neck = new Mesh(new ConeGeometry(.018, .03, 12), skin);
  neck.name = 'Neck'; neck.rotation.x = Math.PI; neck.position.y = .095; waterBalloon.add(neck);
  const knot = new Mesh(new TorusGeometry(.011, .006, 8, 14), skin);
  knot.name = 'Knot'; knot.position.y = .112; waterBalloon.add(knot);
}

/** Red paper flower (小红花), the classroom merit badge: faces +Z, 13 cm across. */
export const redFlower = new Group(); redFlower.name = 'RedFlower';
{
  const paper = mat(0xc8202a, .85), deep = mat(0x9e1620, .85);
  const petal = new SphereGeometry(1, 12, 8).scale(.028, .042, .008);
  for (const [ring, count, radius, z, m] of [[0, 9, .04, 0, paper], [1, 7, .024, .008, deep], [2, 5, .011, .014, paper]] as const) {
    for (let i = 0; i < count; i++) {
      const a = (i + ring * .5) / count * Math.PI * 2;
      const p = new Mesh(petal, m); p.name = `Petal${ring}-${i}`;
      p.position.set(Math.sin(a) * radius, Math.cos(a) * radius, z);
      p.rotation.set(-.35, 0, -a, 'ZXY');
      redFlower.add(p);
    }
  }
  const heart = new Mesh(new SphereGeometry(.012, 12, 8), mat(0xe9c043, .5, .2));
  heart.name = 'Heart'; heart.position.z = .02; redFlower.add(heart);
  for (const side of [-1, 1]) {
    const ribbon = new Mesh(new BoxGeometry(.018, .07, .003), paper);
    ribbon.name = `Ribbon${side}`; ribbon.position.set(side * .016, -.07, -.004); ribbon.rotation.z = side * .25;
    redFlower.add(ribbon);
  }
}

// ---- Second and third items in each tray slot -------------------------------------------

/** Beer bottle: green glass, axis +Y, 36 cm, crown cap and a cream label. */
export const beerBottle = new Group(); beerBottle.name = 'BeerBottle';
{
  const glass = new MeshStandardMaterial({ color: 0x2c6a3a, roughness: .12, metalness: .1, transparent: true, opacity: .9 });
  const profile = [[0, -.18], [.052, -.18], [.058, -.172], [.058, .04], [.05, .075], [.024, .12], [.019, .16], [.021, .172], [.019, .18], [0, .18]]
    .map(([x, y]) => new Vector2(x, y));
  const body = new Mesh(new LatheGeometry(profile, 24), glass); body.name = 'Glass'; beerBottle.add(body);
  const label = new Mesh(new CylinderGeometry(.0585, .0585, .09, 24, 1, true), mat(0xefe6cf, .6)); label.name = 'Label'; label.position.y = -.05; beerBottle.add(label);
  const cap = new Mesh(new CylinderGeometry(.022, .022, .012, 14), mat(0xc9a64a, .35, .8)); cap.name = 'Cap'; cap.position.y = .184; beerBottle.add(cap);
}

/** 拖鞋, the flying slipper: flat sole along +Z, strap across the toe, 40 cm. */
export const slipper = new Group(); slipper.name = 'Slipper';
{
  const sole = new Mesh(new CylinderGeometry(1, 1, 1, 24).scale(.075, .028, .2), mat(0x2f62b0, .7)); sole.name = 'Sole'; slipper.add(sole);
  const foot = new Mesh(new CylinderGeometry(1, 1, 1, 24).scale(.068, .006, .19), mat(0xdfe6ef, .8)); foot.name = 'Footbed'; foot.position.y = .016; slipper.add(foot);
  const strap = new Mesh(new TorusGeometry(.07, .022, 8, 18, Math.PI), mat(0xf2f2ee, .6)); strap.name = 'Strap';
  strap.scale.set(1, .55, 1); strap.position.set(0, .016, .07); slipper.add(strap);
}

/** Football: 30 cm, white with black pentagon patches (flat-shaded, low poly). */
export const football = new Group(); football.name = 'Football';
{
  const geometry = new IcosahedronGeometry(.15, 2).toNonIndexed();
  const pos = geometry.getAttribute('position'), colors: number[] = [];
  const corners = new IcosahedronGeometry(1, 0).getAttribute('position');
  const v = new Vector3(), c = new Vector3();
  for (let f = 0; f < pos.count; f += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, f + k));
    c.normalize();
    let black = false;
    for (let i = 0; i < corners.count; i++) if (c.dot(v.fromBufferAttribute(corners, i).normalize()) > .94) black = true;
    for (let k = 0; k < 3; k++) colors.push(...(black ? [.07, .07, .07] : [.95, .95, .93]));
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const ball = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: .5, flatShading: true }));
  ball.name = 'Ball'; football.add(ball);
}

/** 包子, a steamed bun: soft dome with a pleated twist on top, 17 cm across. */
export const bun = new Group(); bun.name = 'SteamedBun';
{
  const dough = mat(0xf3eee1, .9);
  const dome = new Mesh(new SphereGeometry(.085, 20, 12, 0, Math.PI * 2, 0, Math.PI * .62), dough);
  dome.name = 'Dome'; dome.scale.set(1, .72, 1); dome.position.y = -.03; bun.add(dome);
  const base = new Mesh(new CylinderGeometry(.083, .075, .02, 20), dough); base.name = 'Base'; base.position.y = -.04; bun.add(base);
  for (let i = 0; i < 8; i++) {
    const pleat = new Mesh(new ConeGeometry(.012, .04, 5), dough); pleat.name = `Pleat${i}`;
    const a = i / 8 * Math.PI * 2;
    pleat.position.set(Math.sin(a) * .016, .035, Math.cos(a) * .016); pleat.rotation.set(Math.cos(a) * .5, 0, -Math.sin(a) * .5);
    bun.add(pleat);
  }
}

/** Paper cup of coffee: tapered white cup, kraft sleeve, domed lid, 21 cm. */
export const coffeeCup = new Group(); coffeeCup.name = 'CoffeeCup';
{
  const cup = new Mesh(new CylinderGeometry(.06, .044, .19, 22), mat(0xf4f1ea, .7)); cup.name = 'Cup'; coffeeCup.add(cup);
  const sleeve = new Mesh(new CylinderGeometry(.0565, .0495, .07, 22, 1, true), mat(0xa8774a, .85)); sleeve.name = 'Sleeve'; sleeve.position.y = -.005; coffeeCup.add(sleeve);
  const lid = new Mesh(new CylinderGeometry(.056, .064, .022, 22), mat(0xe9e5dc, .5)); lid.name = 'Lid'; lid.position.y = .105; coffeeCup.add(lid);
  const dome = new Mesh(new SphereGeometry(.05, 18, 8, 0, Math.PI * 2, 0, Math.PI * .3), mat(0xe9e5dc, .5)); dome.name = 'LidDome'; dome.position.y = .09; coffeeCup.add(dome);
}

/** 珍珠奶茶: clear cup of milk tea with tapioca pearls, sealed top, fat striped straw, 27 cm. */
export const bubbleTea = new Group(); bubbleTea.name = 'BubbleTea';
{
  const cup = new Mesh(new CylinderGeometry(.06, .048, .2, 22), new MeshStandardMaterial({ color: 0xffffff, roughness: .1, transparent: true, opacity: .35 }));
  cup.name = 'Cup'; bubbleTea.add(cup);
  const tea = new Mesh(new CylinderGeometry(.056, .045, .17, 20), mat(0xd2ab82, .5)); tea.name = 'MilkTea'; tea.position.y = -.012; bubbleTea.add(tea);
  const pearl = new SphereGeometry(.011, 8, 6), dark = mat(0x2a1a12, .3);
  for (let i = 0; i < 16; i++) {
    const p = new Mesh(pearl, dark); p.name = `Pearl${i}`;
    const a = i * 2.39996, r = .012 + (i % 4) * .009;
    p.position.set(Math.sin(a) * r, -.085 + Math.floor(i / 8) * .02, Math.cos(a) * r);
    bubbleTea.add(p);
  }
  const seal = new Mesh(new CylinderGeometry(.061, .061, .006, 22), mat(0xf4efe4, .6)); seal.name = 'Seal'; seal.position.y = .1; bubbleTea.add(seal);
  const straw = new Mesh(new CylinderGeometry(.009, .009, .2, 10), mat(0xe86b8c, .5)); straw.name = 'Straw';
  straw.position.set(.015, .16, 0); straw.rotation.z = -.18; bubbleTea.add(straw);
}

/** Gold medal: faces +Z, disc 10 cm with a raised rim and a red ribbon above. */
export const goldMedal = new Group(); goldMedal.name = 'GoldMedal';
{
  const gold = mat(0xd4a73a, .3, .9);
  const disc = new Mesh(new CylinderGeometry(.05, .05, .01, 28).rotateX(Math.PI / 2), gold); disc.name = 'Disc'; goldMedal.add(disc);
  const rim = new Mesh(new TorusGeometry(.046, .004, 6, 28), gold); rim.name = 'Rim'; rim.position.z = .006; goldMedal.add(rim);
  const star = new Mesh(new CylinderGeometry(.022, .022, .004, 5).rotateX(Math.PI / 2), mat(0xe9c45a, .3, .9)); star.name = 'Star'; star.position.z = .007; goldMedal.add(star);
  for (const side of [-1, 1]) {
    const ribbon = new Mesh(new BoxGeometry(.03, .1, .003), mat(0xc0222c, .7)); ribbon.name = `Ribbon${side}`;
    ribbon.position.set(side * .017, .085, -.003); ribbon.rotation.z = side * -.32; goldMedal.add(ribbon);
  }
}

/** 红包, a red envelope: faces +Z, 10 x 16 cm, with a gold seal. */
export const redEnvelope = new Group(); redEnvelope.name = 'RedEnvelope';
{
  const env = new Mesh(new BoxGeometry(.1, .16, .008), mat(0xc81f2a, .6)); env.name = 'Envelope'; redEnvelope.add(env);
  const flap = new Mesh(new ConeGeometry(.071, .05, 4).rotateZ(Math.PI).rotateY(Math.PI / 4).scale(1, 1, .08), mat(0xb01a24, .6));
  flap.name = 'Flap'; flap.position.set(0, .055, .005); redEnvelope.add(flap);
  const seal = new Mesh(new CylinderGeometry(.018, .018, .004, 20).rotateX(Math.PI / 2), mat(0xd9b04a, .3, .85)); seal.name = 'GoldSeal'; seal.position.set(0, .03, .007); redEnvelope.add(seal);
  const band = new Mesh(new BoxGeometry(.07, .006, .002), mat(0xd9b04a, .3, .85)); band.name = 'GoldBand'; band.position.set(0, -.045, .005); redEnvelope.add(band);
}

// ---- Fourth and fifth items ---------------------------------------------------------------

/** 黑板擦, the blackboard eraser: varnished wood back, grey felt face, 22 cm. */
export const boardEraser = new Group(); boardEraser.name = 'BoardEraser';
{
  const wood = new Mesh(new BoxGeometry(.22, .045, .085), mat(0xb5834f, .5)); wood.name = 'WoodBack'; wood.position.y = .012; boardEraser.add(wood);
  const felt = new Mesh(new BoxGeometry(.215, .025, .08), mat(0x55575a, .95)); felt.name = 'Felt'; felt.position.y = -.022; boardEraser.add(felt);
  const chalk = new Mesh(new BoxGeometry(.2, .004, .07), mat(0xf2f1ec, 1)); chalk.name = 'ChalkDust'; chalk.position.y = -.036; boardEraser.add(chalk);
}

/** 鸡毛掸子, the feather duster: bamboo handle along +Y, a fluffy head of rooster feathers, 60 cm. */
export const featherDuster = new Group(); featherDuster.name = 'FeatherDuster';
{
  const handle = new Mesh(new CylinderGeometry(.011, .013, .34, 10), mat(0xc9a86a, .6)); handle.name = 'Handle'; handle.position.y = -.13; featherDuster.add(handle);
  const plume = new ConeGeometry(.02, .2, 5).translate(0, .1, 0);
  const tones = [0x3b2a20, 0x8a4a22, 0x1f1a17, 0xa8642e];
  for (let i = 0; i < 26; i++) {
    const pivot = new Group(); pivot.name = `Feather${i}`;
    const ring = i % 3, a = i * 2.39996;
    pivot.position.y = .02 + ring * .07;
    pivot.rotation.set(.35 + ring * .12, a, 0, 'YXZ');
    pivot.add(new Mesh(plume, mat(tones[i % tones.length], .9)));
    featherDuster.add(pivot);
  }
}

/** A small watermelon: 32 cm, dark stripes on green (vertex colours, low poly). */
export const watermelon = new Group(); watermelon.name = 'Watermelon';
{
  const geometry = new SphereGeometry(.16, 24, 14).toNonIndexed();
  geometry.scale(1, .92, 1);
  const pos = geometry.getAttribute('position'), colors: number[] = [];
  for (let f = 0; f < pos.count; f += 3) {
    const x = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3, z = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
    const stripe = Math.sin(Math.atan2(z, x) * 8) > .35;
    for (let k = 0; k < 3; k++) colors.push(...(stripe ? [.1, .28, .12] : [.33, .58, .26]));
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const melon = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: .45 })); melon.name = 'Rind'; watermelon.add(melon);
  const stem = new Mesh(new CylinderGeometry(.006, .01, .03, 6), mat(0x6b5a2a, .8)); stem.name = 'Stem'; stem.position.y = .155; watermelon.add(stem);
}

/** 月饼, a mooncake: golden-brown drum with a scalloped rim and a pressed top, 13 cm. */
export const mooncake = new Group(); mooncake.name = 'Mooncake';
{
  const crust = mat(0xc4832f, .7), dark = mat(0x9c6020, .7);
  const body = new Mesh(new CylinderGeometry(.065, .065, .045, 24), crust); body.name = 'Body'; mooncake.add(body);
  for (let i = 0; i < 12; i++) {
    const lobe = new Mesh(new SphereGeometry(.014, 8, 6), crust); lobe.name = `Scallop${i}`;
    const a = i / 12 * Math.PI * 2; lobe.position.set(Math.sin(a) * .064, .012, Math.cos(a) * .064); lobe.scale.set(1, .9, 1);
    mooncake.add(lobe);
  }
  const top = new Mesh(new TorusGeometry(.036, .004, 6, 24).rotateX(Math.PI / 2), dark); top.name = 'PressedRing'; top.position.y = .024; mooncake.add(top);
  const seal = new Mesh(new CylinderGeometry(.016, .016, .003, 12), dark); seal.name = 'PressedSeal'; seal.position.y = .024; mooncake.add(seal);
}

/** An egg: 9 cm, slightly pointed, warm white shell. */
export const egg = new Group(); egg.name = 'Egg';
{
  const shell = new Mesh(new SphereGeometry(.045, 18, 12), mat(0xf3e9d8, .55)); shell.name = 'Shell';
  shell.geometry.translate(0, 0, 0); shell.scale.set(1, 1.3, 1); egg.add(shell);
}

/** 西红柿, a tomato: 12 cm, glossy red with a green calyx. */
export const tomato = new Group(); tomato.name = 'Tomato';
{
  const fruit = new Mesh(new SphereGeometry(.06, 20, 14), mat(0xd3312a, .3)); fruit.name = 'Fruit'; fruit.scale.set(1, .82, 1); tomato.add(fruit);
  for (let i = 0; i < 5; i++) {
    const leaf = new Mesh(new BoxGeometry(.008, .002, .035), mat(0x3d7a2c, .7)); leaf.name = `Sepal${i}`;
    const a = i / 5 * Math.PI * 2; leaf.position.set(Math.sin(a) * .015, .05, Math.cos(a) * .015); leaf.rotation.y = a;
    tomato.add(leaf);
  }
}

/** 锦旗, a silk pennant: faces +Z, red with a gold rod and fringe, 24 cm. */
export const pennant = new Group(); pennant.name = 'SilkPennant';
{
  const silk = mat(0xb81f2b, .55), gold = mat(0xd4a73a, .3, .85);
  const banner = new Mesh(new BoxGeometry(.13, .17, .004), silk); banner.name = 'Silk'; pennant.add(banner);
  const tail = new Mesh(new ConeGeometry(.092, .05, 4).rotateZ(Math.PI).rotateY(Math.PI / 4).scale(1, 1, .04), silk); tail.name = 'SwallowTail'; tail.position.y = -.1; pennant.add(tail);
  const rod = new Mesh(new CylinderGeometry(.005, .005, .17, 8).rotateZ(Math.PI / 2), gold); rod.name = 'Rod'; rod.position.y = .09; pennant.add(rod);
  for (const side of [-1, 1]) { const knob = new Mesh(new SphereGeometry(.009, 8, 6), gold); knob.name = `Finial${side}`; knob.position.set(side * .088, .09, 0); pennant.add(knob); }
  const band = new Mesh(new BoxGeometry(.1, .012, .002), gold); band.name = 'GoldBand'; band.position.set(0, .045, .003); pennant.add(band);
  const lines = new Mesh(new BoxGeometry(.012, .09, .002), gold); lines.name = 'GoldInscription'; lines.position.set(0, -.015, .003); pennant.add(lines);
}

/** 金星, a gold star sticker: faces +Z, five points, 9 cm. */
export const goldStar = new Group(); goldStar.name = 'GoldStar';
{
  const points: number[] = [];
  for (let i = 0; i < 10; i++) { const r = i % 2 ? .019 : .045, a = i / 10 * Math.PI * 2; points.push(Math.sin(a) * r, Math.cos(a) * r); }
  const positions: number[] = [];
  for (let i = 0; i < 10; i++) {
    const j = (i + 1) % 10;
    // Counter-clockwise seen from +Z, so the face looks outward.
    positions.push(0, 0, .004, points[j * 2], points[j * 2 + 1], .002, points[i * 2], points[i * 2 + 1], .002);
  }
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
  const face = new Mesh(geometry, mat(0xe2b23c, .25, .9)); face.name = 'Face'; goldStar.add(face);
  const back = new Mesh(new CylinderGeometry(.03, .03, .003, 10).rotateX(Math.PI / 2), mat(0xc79a32, .4, .7)); back.name = 'Backing'; goldStar.add(back);
}
