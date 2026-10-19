/** Fixed rig measurements in meters; pose frames rotate these bones, never resize them. */
export type InstructorProportions = {
  shoulderWidth: number;
  hipWidth: number;
  torso: number;
  upperArm: number;
  forearm: number;
  thigh: number;
  shin: number;
  head: number;
};

export const INSTRUCTOR_FORWARD_AXIS = '+Z';
export const INSTRUCTOR_UP_AXIS = '+Y';

// Conservative rounded measurements from the high-confidence flash-step clip.
// Camera foreshortening prevents these from being an anatomical measurement.
export const PROPORTIONS: InstructorProportions = Object.freeze({
  shoulderWidth: .36, hipWidth: .20, torso: .52,
  upperArm: .255, forearm: .235, thigh: .39, shin: .36, head: .23,
});

export const ARM_X = .53;
export const ARM_Y = -Math.sqrt(1 - ARM_X * ARM_X);
export const B = {
  Hips: 0, Spine: 1, Chest: 2, Neck: 3, Head: 4,
  LeftUpperArm: 5, LeftForeArm: 6, LeftHand: 7,
  RightUpperArm: 8, RightForeArm: 9, RightHand: 10,
  LeftUpperLeg: 11, LeftLowerLeg: 12, LeftFoot: 13,
  RightUpperLeg: 14, RightLowerLeg: 15, RightFoot: 16,
} as const;
export const RIG = [
  ['Hips', -1, 0, .86, 0], ['Spine', 0, 0, .24, 0],
  ['Chest', 1, 0, .28, 0], ['Neck', 2, 0, .09, 0], ['Head', 3, 0, .08, 0],
  ['LeftUpperArm', 2, .18, 0, .015],
  ['LeftForeArm', 5, ARM_X * .255, ARM_Y * .255, 0],
  ['LeftHand', 6, ARM_X * .235, ARM_Y * .235, 0],
  ['RightUpperArm', 2, -.18, 0, .015],
  ['RightForeArm', 8, -ARM_X * .255, ARM_Y * .255, 0],
  ['RightHand', 9, -ARM_X * .235, ARM_Y * .235, 0],
  ['LeftUpperLeg', 0, .1, 0, 0], ['LeftLowerLeg', 11, 0, -.39, 0], ['LeftFoot', 12, 0, -.36, 0],
  ['RightUpperLeg', 0, -.1, 0, 0], ['RightLowerLeg', 14, 0, -.39, 0], ['RightFoot', 15, 0, -.36, 0],
] as const;
