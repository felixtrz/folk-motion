import { createComponent, defineComponents, Types } from '@iwsdk/core';
export const Lesson = createComponent('Lesson', {
  move: {type:Types.Int8,default:0},
  playing: {type:Types.Boolean,default:false},
  time: {type:Types.Float32,default:0},
  speed: {type:Types.Float32,default:.5},
  mirror: {type:Types.Boolean,default:true},
  practice: {type:Types.Boolean,default:false},
  calibrated: {type:Types.Boolean,default:false},
  ready: {type:Types.Boolean,default:false},
  handMatch: {type:Types.Float32,default:-1},
  lessonPhase: {type:Types.Int8,default:0},
  poseIndex: {type:Types.Int8,default:0},
  completedPoses: {type:Types.Int8,default:0},
  holdSeconds: {type:Types.Float32,default:0},
  countdown: {type:Types.Float32,default:0},
});
export default defineComponents([Lesson]);
