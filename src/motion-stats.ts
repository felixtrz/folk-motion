import type { Motion } from './motion.js';

/** Measured from the solved motion over the shown window. Pure; no allocation concerns. */
export type SpecimenStats = {
  duration: number;
  contacts: number;
  lateral: number;
  pelvisLow: number;
  pelvisHigh: number;
  wristPeak: number;
  wristHz: number;
  headYaw: number;
};

export function measure(m: Motion, start: number, end: number): SpecimenStats {
  const a = Math.max(0, Math.floor(start * m.fps)), b = Math.min(m.frameCount, Math.ceil(end * m.fps));
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, peak = 0, crossings = 0;
  let yawMin = Infinity, yawMax = -Infinity;
  const prev = [0, 0];
  for (let f = a; f < b; f++) {
    const x = m.root[f * 3], y = m.root[f * 3 + 1];
    xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    if (f > a) for (let w = 0; w < 2; w++) {
      const o = f * 9 + (w + 1) * 3, p = o - 9;
      const vx = (m.joints[o] - m.joints[p]) * m.fps, vy = (m.joints[o + 1] - m.joints[p + 1]) * m.fps;
      peak = Math.max(peak, Math.hypot(vx, vy, (m.joints[o + 2] - m.joints[p + 2]) * m.fps));
      // A reversal of horizontal hand travel at speed counts as half an oscillation.
      if (Math.abs(vx) > .35) { if (prev[w] && Math.sign(vx) !== prev[w]) crossings++; prev[w] = Math.sign(vx); }
    }
    // Neck x head local yaw (YXZ order) relative to the chest.
    const qn = rot(m, f, 3), qh = rot(m, f, 4);
    const w = qn[3] * qh[3] - qn[0] * qh[0] - qn[1] * qh[1] - qn[2] * qh[2];
    const qx = qn[3] * qh[0] + qn[0] * qh[3] + qn[1] * qh[2] - qn[2] * qh[1];
    const qy = qn[3] * qh[1] - qn[0] * qh[2] + qn[1] * qh[3] + qn[2] * qh[0];
    const qz = qn[3] * qh[2] + qn[0] * qh[1] - qn[1] * qh[0] + qn[2] * qh[3];
    const yaw = Math.atan2(2 * (qx * qz + w * qy), w * w - qx * qx - qy * qy + qz * qz) * 180 / Math.PI;
    yawMin = Math.min(yawMin, yaw); yawMax = Math.max(yawMax, yaw);
  }
  const duration = (b - a) / m.fps;
  const contacts = (m.contacts ?? []).filter(c => c.end > start && c.start < end).length;
  return {
    duration, contacts, lateral: xMax - xMin, pelvisLow: yMin, pelvisHigh: yMax,
    wristPeak: peak, wristHz: crossings / 2 / 2 / Math.max(duration, 1e-6), headYaw: yawMax - yawMin,
  };
}

function rot(m: Motion, f: number, bone: number): [number, number, number, number] {
  const o = (f * m.bones.length + bone) * 4, r = m.rotations;
  return [r[o], r[o + 1], r[o + 2], r[o + 3]];
}
