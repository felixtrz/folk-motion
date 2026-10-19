/**
 * Rig-ready motion produced offline by scripts/pose_solve.py (format version 2).
 * Each frame stores the Hips position and a local quaternion per instructor bone,
 * plus forward-kinematics positions of the coached joints (nose, wrists).
 */
export type Motion = {
  version: 2;
  id: string;
  fps: number;
  duration: number;
  frameCount: number;
  bones: string[];
  root: number[];
  rotations: number[];
  joints: number[];
  estimated: { start: number; end: number; upper: boolean; legs: boolean }[];
  contacts?: { foot: 'left' | 'right'; start: number; end: number }[];
  segments: { start: number; end: number; framing: 'full' | 'closeup' }[];
  quality: { observedUpper: number; observedLegs: number; ensembleSpread: number };
};
export type LessonStep = { title: string; cue: string; feet: string; focus: number; start: number; end: number };

export const MOVES = [
  { id: 'flash-step', name: 'Flash step', chinese: '闪身步', pronunciation: 'Shan shen bu', tradition: 'Anhui / Flower Drum Lantern', teacher: 'Zhao Tiechun', watchStart: .3, watchEnd: 7.0,
    steps: [
      { title: 'Step out', cue: 'One arm swings across the body as the first step opens to the side.', feet: 'A small side step is enough. Keep the standing knee soft.', focus: 1.33, start: .4, end: 1.6 },
      { title: 'Flash into the lunge', cue: 'Drop into the side lunge; the body leans away and one arm reaches low across.', feet: 'Lunge only as deep as is comfortable. Point the bent knee over the toes.', focus: 2.67, start: 1.9, end: 3.2 },
      { title: 'Dodge again', cue: 'Repeat the dodge, then rise and collect the feet under the hips.', feet: 'Return to standing before you try it faster.', focus: 5.97, start: 5.3, end: 6.6 },
    ] },
  { id: 'ball-kick', name: 'Wanderer kicks the ball', chinese: '浪子踢球', pronunciation: 'Lang zi ti qiu', tradition: 'Anhui / Flower Drum Lantern', teacher: 'Zhao Tiechun', watchStart: .3, watchEnd: 4.7,
    steps: [
      { title: 'Open the arms', cue: 'Spread both arms wide, shoulders down, as the knees soften.', feet: 'Weight settles evenly on both feet.', focus: .93, start: .4, end: 1.3 },
      { title: 'Kick behind', cue: 'Keep the arms open; the free heel flicks up behind you.', feet: 'Balance on the standing foot. A small heel lift is fine.', focus: 2.33, start: 1.6, end: 2.6 },
      { title: 'Cross and flick', cue: 'Arms stay wide while the free foot crosses in front and flicks out.', feet: 'Cross only a little. Lower the foot and reset at your own pace.', focus: 3.23, start: 2.8, end: 3.7 },
    ] },
  { id: 'bear-shake', name: 'Bear shakes its fur', chinese: '狗熊哆嗦毛', pronunciation: 'Gou xiong duo suo mao', tradition: 'Shandong / Drum Yangge', teacher: 'Ming Wenjun', watchStart: 1.0, watchEnd: 8.5,
    steps: [
      { title: 'Arms up, wide stance', cue: 'Both arms lift high and loose as the feet land wide apart.', feet: 'Land softly with bent knees.', focus: 2.27, start: 1.6, end: 2.6 },
      { title: 'Lurch to the side', cue: 'Throw the arms out to one side as the body tips into a lunge.', feet: 'Shift weight sideways; a small step replaces the lurch.', focus: 3.43, start: 2.8, end: 3.8 },
      { title: 'Shake it out', cue: 'Arms rise again and shake loosely, like a bear shaking off water.', feet: 'Keep the knees soft; the shake comes from the shoulders.', focus: 7.7, start: 7.0, end: 8.2 },
    ] },
  { id: 'head-shake', name: 'Shaking the head', chinese: '摇头晃脑', pronunciation: 'Yao tou huang nao', tradition: 'Shandong / Drum Yangge', teacher: 'Ming Wenjun', watchStart: .8, watchEnd: 8.6,
    steps: [
      { title: 'Horse stance', cue: 'Hands gather in front of the chest as you sink into a wide stance.', feet: 'Feet wide, knees over toes. Sink only as far as is comfortable.', focus: 3.0, start: 2.0, end: 3.3 },
      { title: 'Circle the arm', cue: 'One arm sweeps out to the side while the other stays near the chest.', feet: 'Hold the stance steady while the arms circle.', focus: 4.2, start: 3.5, end: 4.6 },
      { title: 'Open to the side', cue: 'Extend one arm long to the side; let the head follow the movement gently.', feet: 'Keep the stance; move the head slowly, never forcefully.', focus: 7.5, start: 6.9, end: 7.9 },
    ] },
] as const;

const BONES = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'LeftUpperArm', 'LeftForeArm', 'LeftHand', 'RightUpperArm', 'RightForeArm', 'RightHand',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot'];

export function validateMotion(value: unknown): Motion {
  if (!value || typeof value !== 'object') throw new Error('Motion is not an object');
  const motion = value as Motion;
  const n = motion.frameCount;
  if (motion.version !== 2 || !Number.isInteger(n) || n < 2 || !Number.isFinite(motion.fps) || motion.fps <= 0 || !Number.isFinite(motion.duration)
    || Math.abs(motion.duration - n / motion.fps) > .01) throw new Error('Invalid motion header');
  if (!Array.isArray(motion.bones) || motion.bones.length !== BONES.length || motion.bones.some((b, i) => b !== BONES[i])) throw new Error('Motion bones do not match the instructor rig');
  const sized = (a: unknown, size: number) => Array.isArray(a) && a.length === size && a.every(Number.isFinite);
  if (!sized(motion.root, n * 3) || !sized(motion.rotations, n * BONES.length * 4) || !sized(motion.joints, n * 9)) throw new Error('Invalid motion arrays');
  for (let i = 0; i < n * BONES.length; i++) {
    const o = i * 4, r = motion.rotations;
    if (Math.abs(Math.hypot(r[o], r[o + 1], r[o + 2], r[o + 3]) - 1) > .01) throw new Error('Motion rotation is not a unit quaternion');
  }
  if (!Array.isArray(motion.estimated) || motion.estimated.some(e => !(e.start >= 0 && e.end > e.start && e.end <= motion.duration + .01))) throw new Error('Invalid estimated ranges');
  return motion;
}

/** True when the upper body at `time` comes from observed footage, not interpolation. */
export function upperObserved(motion: Motion, time: number): boolean {
  for (const e of motion.estimated) if (e.upper && time >= e.start && time < e.end) return false;
  return true;
}

/** True when the legs at `time` come from observed footage, not interpolation. */
export function legsObserved(motion: Motion, time: number): boolean {
  for (const e of motion.estimated) if (e.legs && time >= e.start && time < e.end) return false;
  return true;
}
