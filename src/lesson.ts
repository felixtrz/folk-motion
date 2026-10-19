import { createSystem, Entity, Object3D, UIKit, UIKitMLAsset, Vector3, VisibilityState } from '@iwsdk/core';
import { Lesson } from './components.js';
import { Motion, MOVES, upperObserved, validateMotion } from './motion.js';
import { LessonFlow, Phase, HOLD_SECONDS } from './lesson-flow.js';
import { HandCoach } from './hand-coach.js';
import { InstructorRig } from './instructor-rig.js';
const SOURCE_URL = 'https://www.bilibili.com/video/BV1YMaA6jEpK/';

export class LessonSystem extends createSystem({ lessons: { required: [Lesson] } }) {
  private entity!: Entity;
  private panel!: UIKitMLAsset;
  private guide!: Object3D;
  private motions: Motion[] = [];
  private rig!: InstructorRig;
  private positions = Array.from({ length: 33 }, () => new Vector3());
  private confidence = new Float32Array(33);
  private flow = new LessonFlow();
  private coach = new HandCoach();
  private selected = 0;
  private speed = .5;
  private mirror = true;
  private ready = false;
  private loading = false;
  private loadError = false;
  private missing = true;
  private options = false;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private masks = MOVES.map(() => 0);
  private trackedMasks = MOVES.map(() => 0);
  private uiElapsed = 0;
  private notice = '';
  private entryDeadline = 0;
  private xrSupported: boolean | null = null;
  private fetchAbort?: AbortController;
  private disposed = false;
  private audio?: AudioContext;
  private sound = false;
  private lastPhase = -1;
  private lastCount = -1;
  private lastAnnounced = '';
  private lastText = new Map<string, string>();
  private lastStyle = new Map<string, string>();
  private textElements = new Map<string, UIKit.Text>();

  init(): void {
    this.entity = this.world.requireSceneEntity('LessonControls');
    this.panel = this.world.requireSceneObject<UIKitMLAsset>('LessonControls');
    this.guide = this.world.requireSceneObject('Instructor');
    this.guide.visible = false;
    this.rig = new InstructorRig(this.guide);
    const bind = (id: string, action: () => void, needsMotion = true) => {
      const element = this.panel.requireElementById(id); element.name = id;
      const callback = () => { if (needsMotion && !this.ready) return; action(); this.refresh(); };
      element.addEventListener('click', callback);
      this.cleanupFuncs.push(() => element.removeEventListener('click', callback));
    };
    for (let i = 0; i < MOVES.length; i++) bind(`Move${i}`, () => this.choose(i));
    bind('Primary', () => this.primary());
    bind('Play', () => { this.clearFeedback(); this.flow.explore(); });
    bind('Practice', () => { this.clearFeedback(); this.flow.countIn(); });
    bind('Next', () => this.selectStep(1)); bind('Previous', () => this.selectStep(-1));
    bind('Speed', () => { this.speed = this.speed === .5 ? 1 : this.speed === 1 ? .25 : .5; });
    bind('Mirror', () => { this.mirror = !this.mirror; this.clearFeedback(); });
    bind('Reset', () => this.reset());
    bind('Calibrate', () => this.calibrate());
    bind('Options', () => { this.options = !this.options; }, false);
    bind('Sound', () => this.toggleSound(), false);
    bind('ReducedMotion', () => { this.reducedMotion = !this.reducedMotion; }, false);
    bind('Retry', () => { void this.loadMotions(); }, false);
    bind('Source', () => { window.open(SOURCE_URL, '_blank', 'noopener,noreferrer'); }, false);
    bind('EnterXR', () => { void this.enterXR(); }, false);
    bind('ExitXR', () => { this.entryDeadline = 0; this.world.exitXR(); }, false);
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || !this.world.renderer.xr.isPresenting) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest('button,input,textarea,select,a')) return;
      const key = event.code;
      if (!['Enter','Space','ArrowRight','ArrowLeft','Digit1','Digit2','Digit3','Digit4','KeyC','KeyM','KeyO','KeyR','KeyA','Escape'].includes(key)) return;
      event.preventDefault();
      if (this.loadError && key === 'Enter') { void this.loadMotions(); return; }
      if (key === 'KeyO') this.options = !this.options;
      else if (key === 'KeyA') this.toggleSound();
      else if (this.ready) {
        if (key === 'Enter') this.primary();
        if (key === 'Space') { this.clearFeedback(); this.flow.explore(); }
        if (key === 'ArrowRight') this.selectStep(1);
        if (key === 'ArrowLeft') this.selectStep(-1);
        if (key.startsWith('Digit') && Number(key.slice(-1)) <= MOVES.length) this.choose(Number(key.slice(-1)) - 1);
        if (key === 'KeyC') this.calibrate();
        if (key === 'KeyM') { this.mirror = !this.mirror; this.clearFeedback(); }
        if (key === 'KeyR') this.reset();
        if (key === 'Escape') { this.flow.suspend(); this.clearFeedback(); }
      }
      this.refresh();
    };
    window.addEventListener('keydown', keydown);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', keydown));
    const hidden = () => { if (document.hidden) { this.flow.suspend(); this.coach.invalidate(); this.clearFeedback(); this.refresh(); } };
    document.addEventListener('visibilitychange', hidden);
    this.cleanupFuncs.push(() => document.removeEventListener('visibilitychange', hidden));
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(() => {
      const wasCalibrated = this.coach.calibrated;
      this.coach.invalidate(); this.clearFeedback(); this.flow.suspend();
      if (wasCalibrated) this.notice = 'Headset view changed. Recalibrate for hand guidance, or use self-confirmation.';
      this.refresh();
    }));
    this.cleanupFuncs.push(() => { this.disposed = true; this.fetchAbort?.abort(); void this.audio?.close(); });
    const canvas = document.querySelector('canvas');
    canvas?.setAttribute('tabindex', '0'); canvas?.setAttribute('aria-label', 'Folk Motion Studio. Enter starts a lesson. Space watches the move. Arrow keys choose a shape.');
    this.restoreProgress();
    void this.checkXR(); void this.loadMotions();
  }

  private async loadMotions(): Promise<void> {
    if (this.loading) return;
    this.fetchAbort?.abort(); this.fetchAbort = new AbortController();
    this.loading = true; this.ready = false; this.loadError = false; this.guide.visible = false;
    this.flow.suspend(); this.coach.invalidate(); this.clearFeedback(); this.notice = ''; this.refresh();
    try {
      const motions = await Promise.all(MOVES.map(async move => {
        const response = await fetch(`${import.meta.env.BASE_URL}motion/${move.id}.json`, { signal: this.fetchAbort!.signal });
        if (!response.ok) throw new Error(`Missing motion: ${move.id}`);
        const motion = validateMotion(await response.json());
        if (motion.id !== move.id) throw new Error(`Motion mismatch: ${move.id}`);
        for (const step of move.steps) {
          if (step.start < 0 || step.end > motion.duration || !upperObserved(motion, step.focus)) throw new Error('Practice reference unavailable');
        }
        return motion;
      }));
      if (this.disposed) return;
      this.motions = motions; this.ready = true; this.loading = false; this.choose(this.selected);
    } catch (error) {
      if (this.disposed) return;
      this.loading = false; this.loadError = true; this.notice = 'Motion did not load. Check your connection, then retry.';
      console.warn('Lesson motion unavailable', error);
    }
    this.refresh();
  }

  private choose(index: number): void {
    if (!this.ready) return;
    this.saveProgress(); this.selected = index;
    const move = MOVES[index];
    this.flow.load(move.steps, move.watchStart, move.watchEnd, this.masks[index], this.trackedMasks[index]);
    this.loadedFlow = true; this.clearFeedback(); this.notice = ''; this.lastPhase = -1;
    this.samplePose();
  }
  private primary(): void {
    if (!this.ready) return;
    this.clearFeedback(); this.notice = '';
    if (this.flow.phase === Phase.Complete) { this.choose((this.selected + 1) % MOVES.length); return; }
    if (this.flow.phase === Phase.StepDone) { this.flow.nextUnfinished(!this.reducedMotion); return; }
    if (this.flow.phase === Phase.Watch) { this.flow.countIn(); return; }
    if (this.flow.phase === Phase.CountIn) { this.flow.copyNow(); return; }
    if (this.flow.phase === Phase.Copy) { if (this.flow.confirm(false)) this.finishShape(); return; }
    if (this.reducedMotion) this.flow.countIn(); else this.flow.start();
  }
  private selectStep(direction: number): void {
    this.flow.select((this.flow.poseIndex + direction + MOVES[this.selected].steps.length) % MOVES[this.selected].steps.length);
    this.clearFeedback(); this.notice = ''; this.samplePose();
  }
  private reset(): void {
    this.masks[this.selected] = 0; this.trackedMasks[this.selected] = 0;
    this.coach.invalidate(); this.flow.load(MOVES[this.selected].steps, MOVES[this.selected].watchStart, MOVES[this.selected].watchEnd);
    this.clearFeedback(); this.notice = 'Lesson restarted. Choose Start lesson when you are ready.'; this.saveProgress();
  }
  private clearFeedback(): void {
    this.feedbackFresh = false;
    this.flow.holdSeconds = 0;
    this.confidence.fill(0);
    if (this.entity) this.entity.setValue(Lesson, 'handMatch', -1);
  }
  private calibrate(): void {
    this.clearFeedback();
    if (!this.world.renderer.xr.isPresenting) { this.notice = 'Enter a headset to calibrate. Desktop learners can use I tried this shape.'; return; }
    if (!this.coach.calibrate()) { this.notice = 'Tracking is not ready. Face the guide with both hands visible, then retry calibration.'; return; }
    this.notice = 'Calibrated. Copy the instructor’s wrist guides with a small, comfortable movement.';
    this.flow.copyNow();
  }

  update(delta: number): void {
    const immersive = this.world.renderer.xr.isPresenting;
    // Outside a headset the field-guide viewer owns the instructor; the lesson waits.
    if (!immersive && !this.entryDeadline) return;
    const visible = !document.hidden && (!immersive || this.world.visibilityState.peek() === VisibilityState.Visible);
    this.coach.update(this.world.renderer.xr, immersive && visible);
    if (immersive && this.entryDeadline) { this.entryDeadline = 0; this.notice = 'Headset connected. Face the guide and calibrate for hand guidance.'; }
    else if (this.entryDeadline && performance.now() > this.entryDeadline) {
      this.entryDeadline = 0; this.notice = 'Headset did not start. Check the headset connection and browser permission, then retry. Desktop lessons still work.';
    }
    if (this.ready) {
      this.samplePose();
      const feedback = this.coach.evaluate(this.positions, this.confidence, this.mirror, !this.missing);
      this.feedbackFresh = this.flow.phase === Phase.Copy && visible;
      const inPlace = this.feedbackFresh && feedback.available && feedback.leftError <= .14 && feedback.rightError <= .14;
      if (this.flow.tick(delta, this.speed, visible, inPlace)) this.finishShape();
      if (this.flow.phase !== this.lastPhase) {
        if (this.flow.phase === Phase.Copy) this.tone(540);
        this.lastPhase = this.flow.phase;
      }
      const count = this.flow.phase === Phase.CountIn ? Math.ceil(this.flow.countdown) : 0;
      if (count && count !== this.lastCount) this.tone(360);
      this.lastCount = count;
    }
    this.uiElapsed += delta;
    if (this.uiElapsed > .12) { this.uiElapsed = 0; this.refresh(); }
  }

  private samplePose(): void {
    // The guide stays visible through estimated frames; only observed frames feed hand coaching.
    this.missing = !this.rig.apply(this.motions[this.selected], this.flow.time, this.mirror, this.positions, this.confidence);
    this.guide.visible = true;
  }

  private feedbackFresh = false;
  private loadedFlow = false;
  private finishShape(): void { this.feedbackFresh = false; this.saveProgress(); this.tone(760); }
  private saveProgress(): void {
    if (!this.loadedFlow) return;
    this.masks[this.selected] = this.flow.completedMask; this.trackedMasks[this.selected] = this.flow.trackedMask;
    try { localStorage.setItem('folk-motion-progress-v3', JSON.stringify({ masks: this.masks, tracked: this.trackedMasks })); } catch { /* Storage is optional. */ }
  }
  private restoreProgress(): void {
    try {
      const data = JSON.parse(localStorage.getItem('folk-motion-progress-v3') ?? 'null');
      if (Array.isArray(data?.masks) && Array.isArray(data?.tracked) && data.masks.length === MOVES.length && data.tracked.length === MOVES.length && [...data.masks, ...data.tracked].every(n => Number.isInteger(n) && n >= 0 && n <= 7)) {
        this.masks = data.masks; this.trackedMasks = data.tracked.map((n: number, i: number) => n & this.masks[i]);
      }
    } catch { /* Malformed or disabled storage starts a fresh lesson. */ }
  }
  private async checkXR(): Promise<boolean> {
    try { this.xrSupported = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr'); }
    catch { this.xrSupported = false; }
    return this.xrSupported;
  }
  private async enterXR(): Promise<void> {
    if (this.entryDeadline) return;
    if (!(await this.checkXR())) { this.notice = 'WebXR headset access is unavailable in this browser. Continue with the desktop lesson or use a compatible headset browser.'; this.refresh(); return; }
    this.entryDeadline = performance.now() + 8000; this.notice = 'Starting headset session. Accept the browser prompt if shown.';
    try { this.world.launchXR(); } catch { this.entryDeadline = 0; this.notice = 'Headset session could not start. Check browser permissions and retry.'; }
    this.refresh();
  }
  private toggleSound(): void {
    this.sound = !this.sound;
    if (this.sound) { this.audio ??= new AudioContext(); void this.audio.resume(); this.tone(480); }
  }
  private tone(frequency: number): void {
    if (!this.sound || !this.audio || this.audio.state !== 'running') return;
    const oscillator = this.audio.createOscillator(), gain = this.audio.createGain(), now = this.audio.currentTime;
    oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.045, now); gain.gain.exponentialRampToValueAtTime(.001, now + .13);
    oscillator.connect(gain); gain.connect(this.audio.destination); oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(now); oscillator.stop(now + .14);
  }
  private text(id: string, value: string): void {
    if (this.lastText.get(id) === value) return;
    let element = this.textElements.get(id);
    if (!element) { element = this.panel.requireElementById<UIKit.Text>(id); this.textElements.set(id, element); }
    element.setProperties({ text: value }); this.lastText.set(id, value);
  }
  private color(id: string, color: string): void {
    if (this.lastStyle.get(id) === color) return;
    this.panel.requireElementById(id).setProperties({ backgroundColor: color }); this.lastStyle.set(id, color);
  }
  private display(id: string, show: boolean): void {
    const key = `${id}-display`, value = show ? 'flex' : 'none';
    if (this.lastStyle.get(key) === value) return;
    this.panel.requireElementById(id).setProperties({ display: value }); this.lastStyle.set(key, value);
  }
  private refresh(): void {
    if (!this.panel || !this.entity) return;
    const move = MOVES[this.selected], step = move.steps[this.flow.poseIndex], phase = this.flow.phase;
    const copying = phase === Phase.Copy, complete = phase === Phase.Complete, done = phase === Phase.StepDone;
    const feedback = this.coach.feedback, score = copying && this.feedbackFresh && feedback.available ? feedback.match : -1;
    let status = 'READY TO EXPLORE', instruction = 'Watch a short phrase. Copy three shapes at your own pace.', action = this.flow.poseIndex === 0 ? 'Start lesson' : 'Start this shape';
    if (phase === Phase.Watch) { status = '01 / WATCH THE PHRASE'; instruction = 'Notice the arms and the changing foot placement.'; action = 'Ready to copy'; }
    if (phase === Phase.CountIn) { status = `COPY IN ${Math.ceil(this.flow.countdown)}`; instruction = 'Look at the paused shape. Begin with a small arm movement.'; action = 'Copy now'; }
    if (copying) { status = '02 / COPY THE SHAPE'; instruction = this.coach.calibrated ? 'Match both hand outlines for 1.2 seconds, or self-confirm.' : 'Copy at your own pace. Self-confirm when you have tried it.'; action = 'I tried this shape'; }
    if (done) { status = 'SHAPE EXPLORED'; instruction = (this.flow.trackedMask & (1 << this.flow.poseIndex)) ? 'Hand outline checked. Footwork and balance were not assessed.' : 'Self-confirmed rehearsal. No body movement was measured.'; action = 'Next shape'; }
    if (complete) { status = 'LESSON EXPLORED'; instruction = `${this.flow.trackedPoses} hand-checked / ${this.flow.completedPoses - this.flow.trackedPoses} self-confirmed. Keep exploring at your pace.`; action = 'Try the next dance'; }
    if (phase === Phase.Explore) { status = this.flow.playing ? 'WATCH / FULL PHRASE' : 'WATCH / PAUSED'; instruction = 'Watch the whole movement, then return to a guided shape.'; action = 'Start guided practice'; }
    if (!this.ready) { status = this.loadError ? 'MOTION UNAVAILABLE' : 'PREPARING YOUR STUDIO'; instruction = this.notice || 'Loading the observed movement. You can begin in a moment.'; }
    this.text('MoveTitle', move.name); this.text('Tradition', `${move.pronunciation} / ${move.tradition}`);
    this.text('StepTitle', complete ? 'Three shapes, one folk phrase' : `${this.flow.poseIndex + 1} / 3  ${step.title}`);
    this.text('Cue', step.cue); this.text('FootCue', step.feet);
    this.text('Status', status); this.text('Instruction', instruction); this.text('Primary', action);
    this.text('Progress', `${this.flow.completedPoses} / 3 explored`);
    this.text('Timeline', `${this.flow.time.toFixed(1)}s / ${this.speed}x`);
    this.text('Tracking', copying ? (score >= 0 ? 'Both hands tracked / front-plane comparison' : feedback.reason || 'Use self-confirmation or calibrate in a headset.') : this.notice || 'Choose a small, comfortable movement. Stop whenever you need.');
    this.text('LeftCue', copying && this.coach.calibrated && this.feedbackFresh ? `Left: ${feedback.left || 'tracking unavailable'}` : this.mirror ? 'Your left / peach outline' : 'Your left / mint outline');
    this.text('RightCue', copying && this.coach.calibrated && this.feedbackFresh ? `Right: ${feedback.right || 'tracking unavailable'}` : this.mirror ? 'Your right / mint outline' : 'Your right / peach outline');
    if (this.lastStyle.get('legend-mirror') !== String(this.mirror)) {
      this.panel.requireElementById('LeftCue').setProperties({ color: this.mirror ? '#744119' : '#1f6653' });
      this.panel.requireElementById('RightCue').setProperties({ color: this.mirror ? '#1f6653' : '#744119' });
      this.lastStyle.set('legend-mirror', String(this.mirror));
    }
    this.text('Message', this.notice);
    this.text('Hold', copying && score >= 0 ? `Hold: ${Math.min(HOLD_SECONDS, this.flow.holdSeconds).toFixed(1)} / ${HOLD_SECONDS}s` : copying ? 'Hands optional / self-confirmation available' : 'Footwork is a visual reference; the headset does not assess legs.');
    this.text('Calibrate', this.coach.calibrated ? 'Recalibrate hands [C]' : 'Calibrate hands [C]');
    this.text('Play', this.flow.playing && phase === Phase.Explore ? 'Pause phrase [Space]' : 'Watch phrase [Space]');
    this.text('Speed', `Speed: ${this.speed}x`); this.text('Mirror', this.mirror ? 'Mirror: follow like a reflection' : 'Mirror off: orientation flipped');
    this.text('Options', this.options ? 'Close options' : 'More options');
    this.text('Sound', `Sound cues: ${this.sound ? 'on' : 'off'}`); this.text('ReducedMotion', `Auto demo: ${this.reducedMotion ? 'off' : 'on'}`);
    this.text('SourceInfo', `Motion: ${move.teacher}. 3D estimate from one camera; depth approximate, legs estimated in close-ups.`);
    this.text('EnterXR', this.entryDeadline ? 'Starting headset...' : this.xrSupported === false ? 'Retry headset access' : 'Enter headset');
    this.color('StatusBlock', complete || done ? '#bce9bd' : copying || phase === Phase.CountIn ? '#ffdcad' : '#e2eddf');
    this.color('Primary', complete || done ? '#206148' : '#153f47');
    for (let i = 0; i < MOVES.length; i++) this.color(`Move${i}`, i === this.selected ? '#badbc0' : '#e4e5d9');
    for (let i = 0; i < 3; i++) { this.color(`Step${i}`, this.flow.completedMask & (1 << i) ? '#458260' : i === this.flow.poseIndex ? '#e6a45f' : '#d9dfd5'); }
    const holdWidth = `${Math.round(Math.min(1, this.flow.holdSeconds / HOLD_SECONDS) * 100)}%`;
    if (this.lastStyle.get('hold-width') !== holdWidth) { this.panel.requireElementById('HoldFill').setProperties({ width: holdWidth }); this.lastStyle.set('hold-width', holdWidth); }
    this.display('OptionsBody', this.options); this.display('Retry', this.loadError); this.display('Primary', this.ready);
    this.display('EnterXR', !this.world.renderer.xr.isPresenting); this.display('ExitXR', this.world.renderer.xr.isPresenting);
    this.text('Reset', complete ? 'Replay this lesson [R]' : 'Restart lesson [R]');
    this.entity.setValue(Lesson, 'move', this.selected); this.entity.setValue(Lesson, 'playing', this.flow.playing);
    this.entity.setValue(Lesson, 'time', this.flow.time); this.entity.setValue(Lesson, 'speed', this.speed); this.entity.setValue(Lesson, 'mirror', this.mirror);
    this.entity.setValue(Lesson, 'practice', copying); this.entity.setValue(Lesson, 'calibrated', this.coach.calibrated); this.entity.setValue(Lesson, 'ready', this.ready); this.entity.setValue(Lesson, 'handMatch', score);
    this.entity.setValue(Lesson, 'lessonPhase', phase); this.entity.setValue(Lesson, 'poseIndex', this.flow.poseIndex); this.entity.setValue(Lesson, 'completedPoses', this.flow.completedPoses);
    this.entity.setValue(Lesson, 'holdSeconds', this.flow.holdSeconds); this.entity.setValue(Lesson, 'countdown', this.flow.countdown);
    const announcement = `${move.name}. ${status}. ${complete ? 'All three shapes explored.' : `${this.flow.poseIndex + 1} of 3: ${step.title}.`} ${instruction}`;
    if (announcement !== this.lastAnnounced) { const live = document.getElementById('accessible-status'); if (live) live.textContent = announcement; this.lastAnnounced = announcement; }
  }
}
