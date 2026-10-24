/**
 * The music bed: a cheeky oom-pah in G major, 128 BPM, 8 bars (15 s), synthesised on the
 * device (the mini-tool container accepts no audio files). A port of
 * scripts/promo/music_trial.py `loop`: Karplus-Strong plucks, a reedy bass, glockenspiel,
 * ticks and a soft kick. The bars after the loop are folded onto its start so notes ringing
 * past the end continue seamlessly when it repeats.
 */
const BPM = 128, BEAT = 60 / BPM, BARS = 8;
const NOTES: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, A: 9, B: 11 };
const hz = (note: string) => 440 * 2 ** ((NOTES[note.slice(0, -1)] + 12 * (Number(note.slice(-1)) + 1) - 69) / 12);

const ROOTS = [['G1', 'D2'], ['C2', 'G2'], ['D2', 'A2'], ['G1', 'D2']];
const CHORDS = [['G3', 'B3', 'D4'], ['C4', 'E4', 'G4'], ['D4', 'F#4', 'A4'], ['G3', 'B3', 'D4']];
const _ = null;
const MEL_A = [['B4', _, 'D5', 'C#5', 'D5', _, 'B4', _], ['C5', _, 'E5', 'D#5', 'E5', _, 'C5', _],
  ['A4', 'B4', 'C5', _, 'D5', _, 'F#4', _], ['G4', _, 'D4', _, 'G4', _, _, _]];
const MEL_B = [['G5', _, 'F#5', _, 'E5', _, 'D5', _], ['E5', 'F#5', 'G5', _, 'C5', _, _, _],
  ['D5', _, 'C5', _, 'B4', _, 'A4', _], ['G4', 'B4', 'D5', _, 'G5', _, _, _]];

/** Renders the loop as mono samples at `sr`, peak .8. */
export function renderMusic(sr: number): Float32Array {
  const steps = musicSteps(sr);
  for (let r = steps.next(); ; r = steps.next()) if (r.done) return r.value;
}

/** The same render, one note per step, so it can run in slices between frames. */
export function* musicSteps(sr: number): Generator<void, Float32Array, void> {
  const loop = Math.round(sr * BARS * 4 * BEAT);
  const track = new Float32Array(loop + Math.round(sr * 2 * 4 * BEAT) + sr);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646 * 2 - 1;
  const add = (at: number, n: number, gain: number, sample: (i: number, t: number) => number) => {
    const start = Math.round(at * sr), end = Math.min(track.length, start + n);
    for (let i = start; i < end; i++) track[i] += gain * sample(i - start, (i - start) / sr);
  };
  const pluck = (at: number, f: number, dur: number, bright: number, gain: number) => {
    const period = Math.max(2, Math.floor(sr / f)), buf = new Float32Array(period);
    for (let i = 0; i < period; i++) buf[i] = rand();
    add(at, Math.round(sr * dur), gain, (i, t) => {
      const k = i % period, out = buf[k];
      buf[k] = .996 * ((1 - bright) * buf[k] + bright * buf[(i + 1) % period]);
      return out * Math.exp(-t / .35);
    });
  };
  const reed = (at: number, f: number, dur: number, gain: number) => {
    // Square-ish wave through an 18-sample moving average: woody, bassoon-ish.
    const n = Math.round(sr * dur), raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr, s = Math.sin(2 * Math.PI * f * t);
      raw[i] = (Math.sign(s) * .5 + s * .5 + .25 * Math.sin(4 * Math.PI * f * t)) * Math.min(1, t / .01) * Math.exp(-t / .12);
    }
    let sum = 0;
    const smooth = new Float32Array(n);
    for (let i = 0; i < n + 9; i++) {
      if (i < n) sum += raw[i];
      if (i >= 18) sum -= raw[i - 18];
      if (i >= 9 && i - 9 < n) smooth[i - 9] = sum / 18;
    }
    add(at, n, gain, i => smooth[i]);
  };
  const glock = (at: number, f: number, dur: number, gain: number) => add(at, Math.round(sr * dur), gain, (_i, t) =>
    (Math.sin(2 * Math.PI * f * t) * Math.exp(-t / .9) + .35 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t / .25)
      + .15 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t / .1)) * Math.min(1, t / .002));
  const tick = (at: number, f: number, gain: number) => add(at, Math.round(sr * .03), gain, (_i, t) => Math.sin(2 * Math.PI * f * t) * Math.exp(-t / .008));
  const kick = (at: number, gain: number) => add(at, Math.round(sr * .25), gain, (_i, t) =>
    Math.sin(2 * Math.PI * (45 * t + 60 * (1 - Math.exp(-t / .03)) * .03)) * Math.exp(-t / .12));

  for (let bar = 0; bar < BARS + 2; bar++) {
    const t0 = bar * 4 * BEAT, [lo, fifth] = ROOTS[bar % 4];
    for (let k = 0; k < 4; k++) {   // oom-pah: bass on 1 and 3, chord stab on 2 and 4
      if (k % 2 === 0) reed(t0 + k * BEAT, hz(k === 0 ? lo : fifth), BEAT * .5, .34);
      else for (const note of CHORDS[bar % 4]) { pluck(t0 + k * BEAT, hz(note), .22, .6, .11); yield; }
    }
    const mel = (Math.floor(bar / 4) % 2 === 0 ? MEL_A : MEL_B)[bar % 4];
    for (let k = 0; k < mel.length; k++) {
      const note = mel[k];
      if (!note) continue;
      pluck(t0 + k * BEAT / 2, hz(note), .35, .5, .30);
      glock(t0 + k * BEAT / 2, hz(note) * 2, .4, .035);
      yield;
    }
    for (let k = 0; k < 8; k++) tick(t0 + k * BEAT / 2, k % 2 === 0 ? 2600 : 1900, k % 2 === 0 ? .07 : .035);
    for (let k = 0; k < 4; k++) kick(t0 + k * BEAT, k % 2 === 0 ? .32 : .14);
    yield;
  }
  const out = track.slice(0, loop);
  for (let i = loop; i < track.length && i - loop < loop; i++) out[i - loop] += track[i];
  let peak = 1e-9;
  for (let i = 0; i < loop; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < loop; i++) out[i] *= .8 / peak;
  return out;
}
