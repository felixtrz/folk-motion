import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Vector3, WebXRManager } from '@iwsdk/core';
import { HandCoach } from '../src/hand-coach.ts';

type Position = { x: number; y: number; z: number };
const point = (x: number, y: number, z = 0): Vector3 => ({ x, y, z }) as Vector3;
const pose = (position: Position, yaw = 0) => ({
  transform: { position, orientation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } },
});

function reference(mirror = false) {
  const points = Array.from({ length: 33 }, () => point(0, 0));
  points[0] = point(0, 1.7);
  points[15] = point(mirror ? 0.4 : -0.4, 1.2);
  points[16] = point(mirror ? -0.4 : 0.4, 1.2);
  return { points, confidence: new Float32Array(33).fill(1) };
}

function fixture(kind: 'hand' | 'controller' = 'hand', yaw = 0, height = 1.7) {
  const head = { x: 2, y: height, z: 3 };
  const scale = Math.max(0.65, Math.min(1.3, height / 1.7));
  const inReferenceSpace = (x: number, y: number, z = -0.25): Position => ({
    x: head.x + Math.cos(yaw) * x + Math.sin(yaw) * z,
    y: head.y + y,
    z: head.z - Math.sin(yaw) * x + Math.cos(yaw) * z,
  });
  const leftWrist = {} as XRJointSpace;
  const rightWrist = {} as XRJointSpace;
  const leftGrip = {} as XRSpace;
  const rightGrip = {} as XRSpace;
  const leftRay = {} as XRSpace;
  const rightRay = {} as XRSpace;
  const left = {
    handedness: 'left', gripSpace: leftGrip, targetRaySpace: leftRay,
    hand: kind === 'hand' ? new Map([['wrist', leftWrist]]) : undefined,
  };
  const right = {
    handedness: 'right', gripSpace: rightGrip, targetRaySpace: rightRay,
    hand: kind === 'hand' ? new Map([['wrist', rightWrist]]) : undefined,
  };
  const positions = new Map<XRSpace, Position>([
    [leftWrist, inReferenceSpace(-0.4 * scale, -0.5 * scale)],
    [rightWrist, inReferenceSpace(0.4 * scale, -0.5 * scale)],
    [leftGrip, kind === 'controller' ? inReferenceSpace(-0.4 * scale, -0.5 * scale) : { x: 90, y: 90, z: 90 }],
    [rightGrip, kind === 'controller' ? inReferenceSpace(0.4 * scale, -0.5 * scale) : { x: -90, y: -90, z: -90 }],
    [leftRay, { x: 50, y: 50, z: 50 }],
    [rightRay, { x: -50, y: -50, z: -50 }],
  ]);
  const calls: { method: string; source: unknown; space: unknown }[] = [];
  const state = {
    session: { inputSources: [left, right], visibilityState: 'visible' } as unknown as XRSession | null,
    space: {} as XRReferenceSpace | null,
    viewer: pose(head, yaw) as unknown as XRViewerPose | null,
    expire: false,
    frameAvailable: true,
  };
  const frame = {
    getViewerPose(space: XRReferenceSpace) {
      if (state.expire) throw new Error('XRFrame is not active');
      calls.push({ method: 'viewer', source: null, space });
      return state.viewer;
    },
    getJointPose(source: XRJointSpace, space: XRReferenceSpace) {
      calls.push({ method: 'joint', source, space });
      const position = positions.get(source);
      return position ? pose(position) : null;
    },
    getPose(source: XRSpace, space: XRReferenceSpace) {
      calls.push({ method: 'grip', source, space });
      const position = positions.get(source);
      return position ? pose(position) : null;
    },
  } as unknown as XRFrame;
  const manager = {
    getSession: () => state.session,
    getReferenceSpace: () => state.space,
    getFrame: () => state.frameAvailable ? frame : undefined,
  } as unknown as WebXRManager;
  return { manager, state, head, positions, calls, leftWrist, rightWrist, leftGrip, rightGrip, leftRay, rightRay };
}

function prepare(f = fixture()) {
  const coach = new HandCoach();
  coach.update(f.manager, true);
  assert.equal(coach.calibrate(), true);
  return { coach, f, ...reference() };
}

function assertUnavailable(coach: HandCoach) {
  assert.equal(coach.feedback.match, -1);
  assert.equal(coach.feedback.leftError, -1);
  assert.equal(coach.feedback.rightError, -1);
  assert.equal(coach.feedback.left, '');
  assert.equal(coach.feedback.right, '');
  assert.equal(coach.feedback.available, false);
}

test('uses native hand wrists and one native reference space, ignoring misleading grip and rays', () => {
  const { coach, f, points, confidence } = prepare();
  const feedback = coach.evaluate(points, confidence, false, true);
  assert.ok(feedback.match > 0.999999);
  assert.equal(feedback.left, 'In place');
  assert.equal(feedback.right, 'In place');
  assert.deepEqual(f.calls.map(c => c.method), ['viewer', 'joint', 'joint']);
  assert.ok(f.calls.every(c => c.space === f.state.space));
  assert.equal(f.calls[1].source, f.leftWrist);
  assert.equal(f.calls[2].source, f.rightWrist);
});

test('uses native controller grip poses, never target-ray poses', () => {
  const { coach, f, points, confidence } = prepare(fixture('controller'));
  assert.ok(coach.evaluate(points, confidence, false, true).match > 0.999999);
  assert.deepEqual(f.calls.map(c => c.method), ['viewer', 'grip', 'grip']);
  assert.equal(f.calls[1].source, f.leftGrip);
  assert.equal(f.calls[2].source, f.rightGrip);
});

test('subtracts native viewer origin and removes calibrated yaw', () => {
  for (const yaw of [Math.PI / 2, -Math.PI / 3, Math.PI]) {
    const { coach, points, confidence } = prepare(fixture('hand', yaw));
    assert.ok(coach.evaluate(points, confidence, false, true).match > 0.999999);
  }
});

test('maps mirror hands to opposite source wrists after reference x reflection', () => {
  const { coach } = prepare();
  const { points, confidence } = reference(true);
  assert.ok(coach.evaluate(points, confidence, true, true).match > 0.999999);
  assert.equal(coach.evaluate(points, confidence, false, true).match, 0);
});

test('scales the reference from head height with lower and upper clamps', () => {
  for (const height of [0.6, 1.36, 1.7, 2.8]) {
    const { coach, points, confidence } = prepare(fixture('hand', 0, height));
    assert.ok(coach.evaluate(points, confidence, false, true).match > 0.999999);
  }
});

test('scores x and y only, and gives directional guidance and independent errors', () => {
  const { coach, f, points, confidence } = prepare();
  f.positions.set(f.leftWrist, { x: f.head.x - 0.4, y: f.head.y - 1, z: -100 });
  f.positions.set(f.rightWrist, { x: f.head.x + 0.9, y: f.head.y - 0.5, z: 100 });
  coach.update(f.manager, true);
  const feedback = coach.evaluate(points, confidence, false, true);
  assert.equal(feedback.left, 'Raise your hand');
  assert.equal(feedback.right, 'Move your hand left');
  assert.ok(Math.abs(feedback.leftError - 0.5) < 1e-10);
  assert.ok(Math.abs(feedback.rightError - 0.5) < 1e-10);
  assert.ok(Math.abs(feedback.match - (1 - 0.5 / 0.7)) < 1e-10);
  f.positions.set(f.leftWrist, { x: f.head.x - 0.9, y: f.head.y - 0.5, z: 0 });
  f.positions.set(f.rightWrist, { x: f.head.x + 0.4, y: f.head.y, z: 0 });
  coach.update(f.manager, true);
  coach.evaluate(points, confidence, false, true);
  assert.equal(feedback.left, 'Move your hand right');
  assert.equal(feedback.right, 'Lower your hand');
});

test('in-place guidance uses each hand error, independent of mean match', () => {
  const { coach, points, confidence } = prepare();
  points[15].x -= 0.13;
  points[16].x += 0.15;
  const feedback = coach.evaluate(points, confidence, false, true);
  assert.equal(feedback.left, 'In place');
  assert.equal(feedback.right, 'Move your hand right');
  assert.ok(feedback.leftError < 0.14);
  assert.ok(feedback.rightError > 0.14);
});

test('low or missing reference confidence and gaps immediately clear all prior guidance', () => {
  const { coach, points, confidence } = prepare();
  const stable = coach.feedback;
  assert.equal(coach.evaluate(points, confidence, false, true), stable);
  confidence[15] = 0.64;
  assert.equal(coach.evaluate(points, confidence, false, true), stable);
  assertUnavailable(coach);
  assert.match(stable.reason, /unclear/);
  confidence[15] = Number.NaN;
  coach.evaluate(points, confidence, false, true);
  assertUnavailable(coach);
  confidence[15] = 1;
  coach.evaluate(points, confidence, false, false);
  assertUnavailable(coach);
  assert.match(stable.reason, /pose is unavailable/);
  coach.evaluate([], confidence, false, true);
  assertUnavailable(coach);
  assert.match(stable.reason, /landmarks are missing/);
});

test('accepts exactly 0.65 confidence represented in Float32Array', () => {
  const { coach, points, confidence } = prepare();
  confidence[0] = confidence[15] = confidence[16] = 0.65;
  assert.ok(coach.evaluate(points, confidence, false, true).match > 0.999999);
});

test('non-finite source and reference coordinates suppress guidance', () => {
  const { coach, f, points, confidence } = prepare();
  points[0].x = Number.NaN;
  coach.evaluate(points, confidence, false, true);
  assertUnavailable(coach);
  assert.match(coach.feedback.reason, /coordinates are invalid/);
  points[0].x = 0;
  f.positions.set(f.rightWrist, { x: Number.NaN, y: 1.2, z: 0 });
  coach.update(f.manager, true);
  assertUnavailable(coach);
  assert.match(coach.feedback.reason, /Right hand is untracked/);
});

test('missing wrist never falls back to the hand grip or ray and recovers with native wrist', () => {
  const { coach, f, points, confidence } = prepare();
  const left = f.positions.get(f.leftWrist)!;
  coach.evaluate(points, confidence, false, true);
  f.positions.delete(f.leftWrist);
  f.calls.length = 0;
  coach.update(f.manager, true);
  coach.evaluate(points, confidence, false, true);
  assertUnavailable(coach);
  assert.match(coach.feedback.reason, /Left hand is untracked/);
  assert.equal(f.calls.some(c => c.method === 'grip'), false);
  f.positions.set(f.leftWrist, left);
  coach.update(f.manager, true);
  assert.ok(coach.evaluate(points, confidence, false, true).match > 0.999999);
});

test('missing native viewer, input, frame or reference space suppresses stale results', () => {
  const { coach, f, points, confidence } = prepare();
  const originalViewer = f.state.viewer;
  coach.evaluate(points, confidence, false, true);
  f.state.viewer = null;
  coach.update(f.manager, true);
  coach.evaluate(points, confidence, false, true);
  assertUnavailable(coach);
  assert.match(coach.feedback.reason, /Headset position/);
  assert.equal(coach.calibrate(), false);
  f.state.viewer = originalViewer;
  f.state.space = null;
  coach.update(f.manager, true);
  assertUnavailable(coach);
  assert.match(coach.feedback.reason, /fresh frame/);
  f.state.space = {} as XRReferenceSpace;
  f.state.frameAvailable = false;
  coach.update(f.manager, true);
  assertUnavailable(coach);
  f.state.frameAvailable = true;
  Object.assign(f.state.session!, { inputSources: [] });
  coach.update(f.manager, true);
  assertUnavailable(coach);
  assert.match(coach.feedback.reason, /Both hands/);
});

test('blur, nonvisibility, and a different session require a new calibration', () => {
  const { coach, f, points, confidence } = prepare();
  coach.evaluate(points, confidence, false, true);
  const session = f.state.session!;
  Object.assign(session, { visibilityState: 'visible-blurred' });
  coach.update(f.manager, true);
  assert.equal(coach.calibrated, false);
  assertUnavailable(coach);
  assert.match(coach.feedback.reason, /paused/);
  assert.equal(coach.calibrate(), false);
  Object.assign(session, { visibilityState: 'visible' });
  coach.update(f.manager, true);
  coach.evaluate(points, confidence, false, true);
  assertUnavailable(coach);
  assert.match(coach.feedback.reason, /calibrate/);
  assert.equal(coach.calibrate(), true);
  coach.update(f.manager, false);
  assert.equal(coach.calibrated, false);
  assertUnavailable(coach);
  coach.update(f.manager, true);
  assert.equal(coach.calibrate(), true);
  f.state.session = { inputSources: session.inputSources, visibilityState: 'visible' } as XRSession;
  coach.update(f.manager, true);
  assert.equal(coach.calibrated, false);
  assert.equal(coach.evaluate(points, confidence, false, true).match, -1);
  assert.match(coach.feedback.reason, /New headset session/);
  assert.equal(coach.calibrate(), true);
  f.state.session = null;
  coach.update(f.manager, true);
  assert.equal(coach.calibrated, false);
  assertUnavailable(coach);
});

test('expired native frames are caught conservatively and explicit invalidation clears calibration', () => {
  const { coach, f, points, confidence } = prepare();
  const stable = coach.evaluate(points, confidence, false, true);
  f.state.expire = true;
  assert.doesNotThrow(() => coach.update(f.manager, true));
  assert.equal(coach.evaluate(points, confidence, false, true), stable);
  assertUnavailable(coach);
  assert.match(stable.reason, /expired/);
  coach.invalidate();
  assert.equal(coach.calibrated, false);
  assertUnavailable(coach);
});
