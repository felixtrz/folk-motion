import type { LessonStep } from './motion.js';

export const Phase = { Ready: 0, Watch: 1, CountIn: 2, Copy: 3, StepDone: 4, Complete: 5, Explore: 6 } as const;
export const HOLD_SECONDS = 1.2;

/** Small deterministic lesson state machine. Completion records rehearsal, never mastery. */
export class LessonFlow {
  phase: number = Phase.Ready;
  poseIndex = 0;
  time = 0;
  playing = false;
  countdown = 0;
  holdSeconds = 0;
  completedMask = 0;
  trackedMask = 0;
  private steps: readonly LessonStep[] = [];
  private exploreStart = 0;
  private exploreEnd = 1;

  get step(): LessonStep { return this.steps[this.poseIndex]; }
  get completedPoses(): number { let n = 0; for (let i = 0; i < this.steps.length; i++) if (this.completedMask & (1 << i)) n++; return n; }
  get trackedPoses(): number { let n = 0; for (let i = 0; i < this.steps.length; i++) if (this.trackedMask & (1 << i)) n++; return n; }

  load(steps: readonly LessonStep[], start: number, end: number, completed = 0, tracked = 0): void {
    this.steps = steps; this.exploreStart = start; this.exploreEnd = end;
    this.completedMask = completed & ((1 << steps.length) - 1); this.trackedMask = tracked & this.completedMask;
    this.select(0);
    if (this.completedPoses === steps.length) this.phase = Phase.Complete;
  }
  select(index: number): void {
    this.poseIndex = Math.max(0, Math.min(this.steps.length - 1, index));
    this.phase = Phase.Ready; this.time = this.step.focus; this.playing = false; this.clearTransient();
  }
  start(): void { this.phase = Phase.Watch; this.time = this.step.start; this.playing = true; this.clearTransient(); }
  countIn(): void { this.phase = Phase.CountIn; this.time = this.step.focus; this.playing = false; this.holdSeconds = 0; this.countdown = 3; }
  copyNow(): void { this.phase = Phase.Copy; this.time = this.step.focus; this.playing = false; this.clearTransient(); }
  explore(): void {
    if (this.phase === Phase.Explore) { this.playing = !this.playing; return; }
    this.phase = Phase.Explore; this.time = this.exploreStart; this.playing = true; this.clearTransient();
  }
  confirm(tracked: boolean): boolean {
    if (this.phase !== Phase.Copy) return false;
    this.completedMask |= 1 << this.poseIndex;
    if (tracked) this.trackedMask |= 1 << this.poseIndex;
    this.phase = this.completedPoses === this.steps.length ? Phase.Complete : Phase.StepDone;
    this.holdSeconds = 0; return true;
  }
  nextUnfinished(autoDemo = true): void {
    for (let offset = 1; offset <= this.steps.length; offset++) {
      const next = (this.poseIndex + offset) % this.steps.length;
      if (!(this.completedMask & (1 << next))) { this.select(next); if (autoDemo) this.start(); else this.countIn(); return; }
    }
  }
  suspend(): void {
    this.playing = false; this.clearTransient();
    if (this.phase === Phase.Watch || this.phase === Phase.CountIn) { this.phase = Phase.Ready; this.time = this.step.focus; }
  }
  clearTransient(): void { this.holdSeconds = 0; this.countdown = 0; }
  tick(delta: number, speed: number, visible: boolean, bothHandsInPlace: boolean): boolean {
    if (!visible) { this.suspend(); return false; }
    const elapsed = Math.max(0, Math.min(delta, .1));
    if (this.phase === Phase.Watch && this.playing) {
      this.time += elapsed * speed;
      if (this.time >= this.step.end) this.countIn();
    } else if (this.phase === Phase.Explore && this.playing) {
      this.time = this.exploreStart + (this.time - this.exploreStart + elapsed * speed) % (this.exploreEnd - this.exploreStart);
    } else if (this.phase === Phase.CountIn) {
      this.countdown = Math.max(0, this.countdown - elapsed);
      if (this.countdown <= .0001) this.copyNow();
    } else if (this.phase === Phase.Copy) {
      this.holdSeconds = bothHandsInPlace ? this.holdSeconds + elapsed : 0;
      if (this.holdSeconds >= HOLD_SECONDS) return this.confirm(true);
    }
    return false;
  }
}
