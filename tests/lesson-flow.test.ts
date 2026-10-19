import test from 'node:test';
import assert from 'node:assert/strict';
import { LessonFlow, Phase } from '../src/lesson-flow.ts';
const steps = [0,1,2].map(i => ({ title: `Shape ${i}`, cue: 'Arms', feet: 'Visual only', focus: i + .5, start: i + .1, end: i + .8 }));
const make = () => { const flow = new LessonFlow(); flow.load(steps,.1,2.9); return flow; };
const advance = (flow: LessonFlow, seconds: number, matched = false) => { for (let i=0; i<Math.ceil(seconds/.05); i++) flow.tick(.05,.5,true,matched); };

test('watch becomes count-in and then paused copy; manual confirmation is explicit', () => {
 const f=make(); assert.equal(f.phase,Phase.Ready); assert.equal(f.confirm(false),false);
 f.start();advance(f,1.5);assert.equal(f.phase,Phase.CountIn);assert.equal(f.playing,false);
 advance(f,3.1);assert.equal(f.phase,Phase.Copy);assert.equal(f.time,steps[0].focus);
 assert.equal(f.completedPoses,0);f.confirm(false);assert.equal(f.phase,Phase.StepDone);assert.equal(f.trackedPoses,0);
});
test('both hands must continuously match; dropout resets hold', () => {
 const f=make();f.copyNow();advance(f,.8,true);assert.ok(f.holdSeconds>.7);
 f.tick(.05,.5,true,false);assert.equal(f.holdSeconds,0);
 advance(f,.8,true);assert.equal(f.completedPoses,0);advance(f,.5,true);assert.equal(f.completedPoses,1);assert.equal(f.trackedPoses,1);
});
test('three distinct self-confirmations reach honest completion and next unfinished skips completed shapes', () => {
 const f=make();f.select(2);f.copyNow();f.confirm(false);f.nextUnfinished();assert.equal(f.poseIndex,0);
 f.copyNow();f.confirm(false);f.nextUnfinished();assert.equal(f.poseIndex,1);
 f.copyNow();f.confirm(false);assert.equal(f.phase,Phase.Complete);assert.equal(f.completedPoses,3);assert.equal(f.trackedPoses,0);
});
test('hidden/blurred view cancels countdown and hold, and never awards progress', () => {
 const f=make();f.countIn();f.tick(.1,.5,false,true);assert.equal(f.phase,Phase.Ready);assert.equal(f.countdown,0);
 f.copyNow();advance(f,.8,true);f.tick(.1,.5,false,true);assert.equal(f.holdSeconds,0);assert.equal(f.completedPoses,0);
 f.start();f.tick(.1,.5,false,false);assert.equal(f.playing,false);assert.equal(f.phase,Phase.Ready);
});
test('reference changes clear timers, complete progress restores, restart clears progress', () => {
 const f=make();f.copyNow();advance(f,.8,true);f.select(1);assert.equal(f.holdSeconds,0);assert.equal(f.phase,Phase.Ready);
 f.load(steps,.1,2.9,7,3);assert.equal(f.phase,Phase.Complete);assert.equal(f.trackedPoses,2);
 f.load(steps,.1,2.9);assert.equal(f.phase,Phase.Ready);assert.equal(f.completedPoses,0);
});
test('explore respects the action range and pause resumes without changing the position', () => {
 const f=make();f.explore();advance(f,8);assert.ok(f.time>=.1&&f.time<2.9);
 f.explore();const t=f.time;advance(f,.5);assert.equal(f.time,t);f.explore();assert.equal(f.time,t);
});

test('auto-demo off applies when advancing to the next unfinished shape',()=>{
 const f=make();f.copyNow();f.confirm(false);f.nextUnfinished(false);assert.equal(f.poseIndex,1);assert.equal(f.phase,Phase.CountIn);assert.equal(f.playing,false);
});
