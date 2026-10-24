"""Soundtrack for the throwing promo: a cheeky oom-pah in G major, 128 BPM, plus the app's own
sound effects placed at the exact times the capture logged them.

Synthesised from scratch (reuses the instruments in music.py), nothing to license.
Usage: python music_trial.py <framesDir> <out.wav>
       python music_trial.py loop <out.wav>   (seamless 8-bar bed for the mini-tool)
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np

from music import SR, glock, hz, kick, place, pluck, reed, rng, swoosh, tick

HERE = Path(__file__).parent
spec = json.loads((HERE / 'trial-shots.json').read_text())
BPM = 128
BEAT = 60 / BPM


def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def tone(f, dur, decay, to=None, kind='sine'):
    n = int(SR * dur); t = np.arange(n) / SR
    freq = f * (to / f) ** (t / dur) if to else np.full(n, f)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    w = np.sin(phase) if kind == 'sine' else 2 / np.pi * np.arcsin(np.sin(phase))
    return w * env(n, .002, decay)


def noise(dur, cutoff, decay):
    n = int(SR * dur); x = rng.normal(0, 1, n)
    a = np.exp(-2 * np.pi * cutoff / SR); y = np.empty(n); s = 0.0
    for i in range(n):
        s = (1 - a) * x[i] + a * s; y[i] = s
    y /= np.abs(y).max() + 1e-9
    return y * env(n, .001, decay)


def mix(*parts):
    out = np.zeros(max(len(p) for p in parts))
    for p in parts:
        out[:len(p)] += p
    return out


# The app's cues (src/sfx.ts), rebuilt.
SFX = {
    'throw': lambda: swoosh(.28, True) * .5,
    'swoosh': lambda: swoosh(.24, False) * .45,
    'clank': lambda: mix(*(g * tone(f, .3, .08, kind='tri') for f, g in ((1830, .5), (2470, .35), (3120, .22))), noise(.06, 4000, .015) * .5),
    'clink': lambda: sum(g * tone(f, .4, .1) for f, g in ((2900, .35), (4300, .2))),
    'thud': lambda: mix(tone(110, .2, .06, 55), noise(.08, 900, .02) * .5),
    'kick': lambda: mix(tone(180, .14, .05, 420), noise(.04, 2500, .01) * .4),
    'splash': lambda: mix(noise(.55, 1400, .15) * 1.1, tone(300, .1, .03, 90) * .5),
    'chime': lambda: mix(tone(1318.5, .9, .3) * .4, np.concatenate([np.zeros(int(SR * .07)), tone(1975.5, .9, .3) * .4])),
}


def boing(at, track):
    """Slide-whistle 'boing' for the opening."""
    n = int(SR * .5); t = np.arange(n) / SR
    f = 500 * 2 ** (1.5 * np.sin(np.pi * t / .5) * t / .5) * (1 + .03 * np.sin(2 * np.pi * 9 * t))
    w = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, .02, .3)
    place(track, w, at, .18)


def render(frames_dir, loop=False):
    """loop=True: the music alone, 8 bars, wrapped so it repeats seamlessly (the mini-tool bed)."""
    segs, at = [], 0.0
    for s in [s for s in spec['segments'] if not s.get('still')]:
        segs.append((s, at)); at += s['dur']
    seconds = 8 * 4 * BEAT if loop else at
    track = np.zeros(int(SR * (seconds + 1)) + (int(SR * 8 * BEAT) if loop else 0))
    bars = 10 if loop else int(np.ceil(seconds / (4 * BEAT)))
    intro = 0 if loop else 1
    roots = [('G1', 'D2'), ('C2', 'G2'), ('D2', 'A2'), ('G1', 'D2')]
    chords = [['G3', 'B3', 'D4'], ['C4', 'E4', 'G4'], ['D4', 'F#4', 'A4'], ['G3', 'B3', 'D4']]
    # Tiptoe-then-bounce tune: short notes, cheeky chromatic grace notes.
    mel_a = [['B4', None, 'D5', 'C#5', 'D5', None, 'B4', None], ['C5', None, 'E5', 'D#5', 'E5', None, 'C5', None],
             ['A4', 'B4', 'C5', None, 'D5', None, 'F#4', None], ['G4', None, 'D4', None, 'G4', None, None, None]]
    mel_b = [['G5', None, 'F#5', None, 'E5', None, 'D5', None], ['E5', 'F#5', 'G5', None, 'C5', None, None, None],
             ['D5', None, 'C5', None, 'B4', None, 'A4', None], ['G4', 'B4', 'D5', None, 'G5', None, None, None]]
    montage = next(a for s, a in segs if s['id'] == 'm-tomato'), next(a for s, a in segs if s['id'] == 'plate')
    for bar in range(bars):
        t0 = bar * 4 * BEAT
        lo, fifth = roots[bar % 4]
        for k in range(4):   # oom-pah: bass on 1 and 3, chord stab on 2 and 4
            if k % 2 == 0:
                place(track, reed(hz(lo if k == 0 else fifth), BEAT * .5), t0 + k * BEAT, .34)
            else:
                for note in chords[bar % 4]:
                    place(track, pluck(hz(note), .22, .6), t0 + k * BEAT, .11)
        mel = (mel_a if (bar // 4) % 2 == 0 else mel_b)[bar % 4]
        if bar >= intro:
            for k, note in enumerate(mel):
                if note:
                    place(track, pluck(hz(note), .35, .5), t0 + k * BEAT / 2, .30)
                    place(track, glock(hz(note) * 2, .4), t0 + k * BEAT / 2, .035)
        busy = not loop and montage[0] <= t0 < montage[1]
        for k in range(16 if busy else 8):
            step = BEAT / (4 if busy else 2)
            place(track, tick(2600 if k % 2 == 0 else 1900, .03), t0 + k * step, .07 if k % 2 == 0 else .035)
        if bar >= intro:
            for k in range(4):
                place(track, kick(), t0 + k * BEAT, .32 if k % 2 == 0 else .14)
    if loop:
        n = int(SR * seconds)
        bed = track[:n].copy()
        tail = track[n:]
        bed[:len(tail)] += tail[:n]   # notes ringing past the end continue at the start
        bed /= np.abs(bed).max() + 1e-9
        return (bed * .8 * 32767).astype(np.int16)
    boing(.05, track)
    # Game cues, from the capture logs (pre-roll cues before the first frame are dropped).
    d = Path(frames_dir)
    for s, start in segs:
        log = d / f"{s['id']}.json"
        if not log.exists():
            continue
        for c in json.loads(log.read_text())['cues']:
            if -.05 <= c['t'] < s['dur']:
                place(track, SFX[c['cue']](), start + c['t'], .55)
        # A soft whoosh on every cut into a new shot.
        if start > 0:
            place(track, swoosh(.26, True), start - .13, .10)
    # End card: ta-da.
    end = segs[-1][1]
    for k, note in enumerate(('G4', 'B4', 'D5', 'G5')):
        place(track, pluck(hz(note), .9, .5), end + .1 + k * .07, .3)
        place(track, glock(hz(note) * 2, 1.4), end + .1 + k * .07, .12)
    place(track, reed(hz('G1'), 1.2), end + .1, .4)
    track = track[:int(SR * seconds)]
    fade = int(SR * 1.0)
    track[-fade:] *= np.linspace(1, 0, fade)
    track /= np.abs(track).max() + 1e-9
    return (track * .89 * 32767).astype(np.int16)


if __name__ == '__main__':
    pcm = render(sys.argv[1], loop=sys.argv[1] == 'loop')
    with wave.open(sys.argv[2], 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print('wrote', sys.argv[2], len(pcm) / SR, 's')
