import { musicSteps } from './music.js';

const MUSIC_RATE = 44100;   // rendered ahead of the AudioContext; playback resamples if it differs

/** Tiny synthesised sound effects, plus an optional looping music bed (also synthesised: no
 * audio files). Created on the first user gesture. */
export type Cue = 'throw' | 'clank' | 'clink' | 'thud' | 'kick' | 'splash' | 'chime' | 'swoosh';

const KEY = 'fms-sound';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  private musicWanted = false;
  private musicSamples: Float32Array | null = null;
  private musicTimer = 0;
  private musicBuffer: AudioBuffer | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  // Hidden: everything stops (the context suspends); visible again: it resumes where it was.
  private readonly onVisibility = () => {
    if (!this.ctx) return;
    if (document.visibilityState === 'hidden') void this.ctx.suspend();
    else if (this.enabled) void this.ctx.resume();
  };

  constructor() {
    try { this.enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* storage blocked: default on */ }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* not persisted */ }
    if (on) this.wake(); else this.stopMusic();
  }

  /** Turns on the looping music bed; it starts with the first gesture. */
  setMusic(): void {
    this.musicWanted = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    // Composed in the background, a few milliseconds at a time, starting once the page has
    // settled; the first tap then only has to press play.
    const steps = musicSteps(MUSIC_RATE);
    const slice = () => {
      const until = performance.now() + 8;
      for (let r = steps.next(); ; r = steps.next()) {
        if (r.done) { this.musicSamples = r.value; this.musicTimer = 0; if (this.ctx && this.enabled) this.startMusic(); return; }
        if (performance.now() > until) break;
      }
      this.musicTimer = window.setTimeout(slice, 16);
    };
    this.musicTimer = window.setTimeout(slice, 1500);
  }

  private startMusic(): void {
    const c = this.ctx!;
    if (this.musicSource || !this.musicSamples) return;   // not composed yet: starts when it is
    if (!this.musicBuffer) {
      this.musicBuffer = c.createBuffer(1, this.musicSamples.length, MUSIC_RATE);
      this.musicBuffer.getChannelData(0).set(this.musicSamples);
      this.musicGain = c.createGain(); this.musicGain.gain.value = .3; this.musicGain.connect(c.destination);
    }
    const s = c.createBufferSource();
    s.buffer = this.musicBuffer; s.loop = true;   // a buffer loop is sample-exact: no gap at the seam
    s.connect(this.musicGain!); s.start();
    this.musicSource = s;
  }

  private stopMusic(): void {
    if (!this.musicSource) return;
    try { this.musicSource.stop(); } catch { /* already stopped */ }
    this.musicSource.disconnect(); this.musicSource = null;
  }

  /** Must run inside a user gesture on mobile browsers. */
  wake(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain(); this.master.gain.value = .5; this.master.connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, n, n);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.musicWanted) this.startMusic();
  }

  play(cue: Cue): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const c = this.ctx, t = c.currentTime;
    switch (cue) {
      case 'throw': this.sweep(t, .28, 500, 2400, .35); break;
      case 'swoosh': this.sweep(t, .22, 2600, 700, .3); break;
      case 'clank':
        for (const [f, g] of [[1830, .18], [2470, .12], [3120, .08]]) this.tone(t, f, .25, g, 'triangle');
        this.burst(t, .05, 4000, .25);
        break;
      case 'clink': for (const [f, g] of [[2900, .12], [4300, .07]]) this.tone(t, f, .35, g, 'sine'); break;
      case 'thud': this.tone(t, 110, .18, .5, 'sine', 55); this.burst(t, .06, 900, .25); break;
      case 'kick': this.tone(t, 180, .12, .5, 'sine', 420); this.burst(t, .03, 2500, .2); break;
      case 'splash': this.burst(t, .5, 1400, .55); this.tone(t, 300, .08, .25, 'sine', 90); break;
      case 'chime': for (const [f, d] of [[1318.5, 0], [1975.5, .07]]) this.tone(t + d, f, .9, .14, 'sine'); break;
    }
  }

  private tone(t: number, freq: number, dur: number, gain: number, type: OscillatorType, to?: number): void {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(this.master!); o.start(t); o.stop(t + dur + .02);
  }

  private burst(t: number, dur: number, cutoff: number, gain: number): void {
    const c = this.ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master!); s.start(t); s.stop(t + dur + .02);
  }

  private sweep(t: number, dur: number, from: number, to: number, gain: number): void {
    const c = this.ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * .4); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master!); s.start(t); s.stop(t + dur + .02);
  }

  dispose(): void {
    clearTimeout(this.musicTimer);
    void this.ctx?.close();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stopMusic();
  }
}
