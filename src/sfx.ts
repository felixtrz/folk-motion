/** Tiny synthesised sound effects (no audio files), plus an optional looping music bed.
 * Created on the first user gesture. */
export type Cue = 'throw' | 'clank' | 'clink' | 'thud' | 'kick' | 'splash' | 'chime' | 'swoosh';

const KEY = 'fms-sound';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  private musicUrl: string | null = null;
  private music: HTMLAudioElement | null = null;
  private readonly onVisibility = () => {
    if (!this.music) return;
    if (document.visibilityState === 'hidden') this.music.pause(); else if (this.enabled) this.resumeMusic();
  };

  constructor() {
    try { this.enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* storage blocked: default on */ }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* not persisted */ }
    if (on) this.wake(); else this.music?.pause();
  }

  /** A looping music bed (a packaged audio file); it starts with the first gesture. */
  setMusic(url: string): void {
    this.musicUrl = url;
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private resumeMusic(): void {
    const playing = this.music?.play();
    if (playing) playing.catch(() => undefined);   // blocked until a gesture: the next wake() retries
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
    if (this.musicUrl) {
      if (!this.music) {
        this.music = new Audio(this.musicUrl);
        this.music.loop = true; this.music.volume = .32;
      }
      if (this.music.paused && document.visibilityState !== 'hidden') this.resumeMusic();
    }
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
    void this.ctx?.close();
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.music) { this.music.pause(); this.music.removeAttribute('src'); this.music.load(); this.music = null; }
  }
}
