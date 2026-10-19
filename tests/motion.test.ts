import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateMotion, upperObserved, legsObserved, MOVES, type Motion } from '../src/motion.ts';
import { RIG } from '../src/scene-assets/instructor-proportions.ts';

const load = (id: string) => validateMotion(JSON.parse(readFileSync(`public/motion/${id}.json`, 'utf8')));
type Q = [number, number, number, number];
const mul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const rotate = (q: Q, v: number[]): number[] => {
  const r = mul(mul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [r[0], r[1], r[2]];
};
/** Bone positions from root + local rotations using the TypeScript rig table. */
function fk(m: Motion, frame: number, rotations?: Q[]): number[][] {
  const global: Q[] = [], pos: number[][] = [];
  RIG.forEach(([, parent, x, y, z], i) => {
    const o = (frame * RIG.length + i) * 4, r = m.rotations;
    const local: Q = [r[o], r[o + 1], r[o + 2], r[o + 3]];
    if (parent < 0) { global[i] = local; if (rotations) rotations[i] = local; pos[i] = m.root.slice(frame * 3, frame * 3 + 3); return; }
    global[i] = mul(global[parent], local);
    if (rotations) rotations[i] = global[i];
    const off = rotate(global[parent], [x, y, z]);
    pos[i] = pos[parent].map((p, k) => p + off[k]);
  });
  return pos;
}

test('rejects malformed motion without accepting corrupt data', () => {
  const good = load('flash-step');
  for (const value of [null, {}, { ...good, version: 1 }, { ...good, frameCount: 1 }, { ...good, bones: good.bones.slice(1) },
    { ...good, root: good.root.slice(3) }, { ...good, rotations: good.rotations.map((v, i) => i === 3 ? 2 : v) },
    { ...good, joints: good.joints.map((v, i) => i === 0 ? NaN : v) }]) assert.throws(() => validateMotion(value));
});

test('every move ships, matches its id, and every named shape is observed footage', () => {
  for (const move of MOVES) {
    const m = load(move.id);
    assert.equal(m.id, move.id);
    assert.equal(move.steps.length, 3);
    assert.ok(move.watchStart < move.watchEnd && move.watchEnd <= m.duration);
    for (const step of move.steps) {
      assert.ok(step.start <= step.focus && step.focus <= step.end && step.end <= m.duration);
      assert.ok(upperObserved(m, step.focus), `${move.id} ${step.title} must use observed arms`);
      assert.ok(legsObserved(m, step.focus), `${move.id} ${step.title} must use observed legs`);
    }
  }
});

test('exported coaching joints agree with the TypeScript rig, and feet stay above the floor', () => {
  for (const move of MOVES) {
    const m = load(move.id);
    for (let f = 0; f < m.frameCount; f += 7) {
      const p = fk(m, f);
      for (const [slot, bone] of [[1, 7], [2, 10]]) {
        const d = Math.hypot(...p[bone].map((v, k) => v - m.joints[f * 9 + slot * 3 + k]));
        assert.ok(d < .006, `${move.id} frame ${f} joint ${slot} off by ${d}`);
      }
      assert.ok(p[13][1] > .09 && p[16][1] > .09, `${move.id} frame ${f} ankle below floor`);
      assert.ok(p.every(q => q.every(Number.isFinite)));
    }
  }
});

test('motion is temporally smooth: no bone flips between consecutive frames', () => {
  for (const move of MOVES) {
    const m = load(move.id), r = m.rotations, nb = RIG.length;
    for (let f = 1; f < m.frameCount; f++) for (let b = 0; b < nb; b++) {
      const o = (f * nb + b) * 4, p = ((f - 1) * nb + b) * 4;
      const dot = Math.abs(r[o] * r[p] + r[o + 1] * r[p + 1] + r[o + 2] * r[p + 2] + r[o + 3] * r[p + 3]);
      // Arm whips and forearm circling reach ~1 rad of upper-arm twist per frame; flips are ~3 rad.
      assert.ok(dot > Math.cos(1.2 / 2), `${move.id} frame ${f} bone ${b} jumps ${(2 * Math.acos(Math.min(1, dot))).toFixed(2)} rad`);
    }
  }
});

test('planted feet stay on the floor and their contact points never drift', () => {
  // Toe and heel of the authored shoe, in the foot bone's frame (see pose_solve.py SOLE).
  const sole = [[0, -.105, .145], [0, -.105, -.063]];
  for (const move of MOVES) {
    const m = load(move.id) as Motion & { contacts: { foot: 'left' | 'right'; start: number; end: number }[] };
    assert.ok(m.contacts.length > 0, `${move.id} has no contacts`);
    for (const c of m.contacts) {
      const bone = c.foot === 'left' ? 13 : 16;
      let first: number[][] | undefined;
      for (let f = Math.round(c.start * m.fps); f < Math.round(c.end * m.fps); f++) {
        const rot: Q[] = [], p = fk(m, f, rot);
        const points = sole.map(o => rotate(rot[bone], o).map((v, k) => v + p[bone][k]));
        for (const q of points) assert.ok(Math.abs(q[1]) < .005, `${move.id} ${c.foot} contact at frame ${f} is ${(q[1] * 100).toFixed(1)} cm off the floor`);
        first ??= points;
        points.forEach((q, i) => {
          const drift = Math.hypot(q[0] - first![i][0], q[2] - first![i][2]);
          assert.ok(drift < .005, `${move.id} ${c.foot} contact drifts ${(drift * 100).toFixed(1)} cm at frame ${f}`);
        });
      }
    }
  }
});
