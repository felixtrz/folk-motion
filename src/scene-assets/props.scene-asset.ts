import {
  BoxGeometry, ConeGeometry, CylinderGeometry, Group, LatheGeometry, Mesh, MeshStandardMaterial,
  SphereGeometry, TorusGeometry, Vector2,
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
