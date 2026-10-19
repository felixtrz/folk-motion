"""Original soundtrack for the promo: a deadpan tiptoe pizzicato in D minor, 120 BPM.

Synthesised from scratch (Karplus-Strong plucks, a reedy bass, glockenspiel, woodblock
ticks), so there is nothing to license. Usage: python music.py out.wav [seconds]
Cues: a glock sting at 0, a swoosh on every subject swap, a 'ding' on each new plate.
"""
import sys
import wave

import numpy as np

SR = 44100
BPM = 120
BEAT = 60 / BPM
rng = np.random.default_rng(7)


def hz(note):
    names = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
             'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
    name, octave = note[:-1], int(note[-1])
    return 440 * 2 ** ((names[name] + 12 * (octave + 1) - 69) / 12)


def pluck(f, dur, bright=.5):
    n = int(SR * dur)
    period = max(2, int(SR / f))
    buf = rng.uniform(-1, 1, period)
    out = np.empty(n)
    for i in range(n):
        out[i] = buf[i % period]
        j = (i + 1) % period
        buf[i % period] = .996 * ((1 - bright) * buf[i % period] + bright * buf[j]) if True else 0
    return out * np.exp(-np.arange(n) / (SR * .35))


def reed(f, dur):
    t = np.arange(int(SR * dur)) / SR
    wave_ = np.sign(np.sin(2 * np.pi * f * t)) * .5 + np.sin(2 * np.pi * f * t) * .5
    wave_ += .25 * np.sin(2 * np.pi * 2 * f * t)
    env = np.minimum(1, t / .01) * np.exp(-t / .12)
    k = np.ones(18) / 18  # soften the edges: woody, bassoon-ish
    return np.convolve(wave_ * env, k, 'same')


def glock(f, dur):
    t = np.arange(int(SR * dur)) / SR
    s = sum(a * np.sin(2 * np.pi * f * m * t) * np.exp(-t / d) for m, a, d in ((1, 1, .9), (2.76, .35, .25), (5.4, .15, .1)))
    return s * np.minimum(1, t / .002)


def tick(f=1800, dur=.05):
    t = np.arange(int(SR * dur)) / SR
    return np.sin(2 * np.pi * f * t) * np.exp(-t / .008)


def kick(dur=.25):
    t = np.arange(int(SR * dur)) / SR
    return np.sin(2 * np.pi * (45 * t + 60 * (1 - np.exp(-t / .03)) * .03)) * np.exp(-t / .12)


def swoosh(dur=.35, up=True):
    n = int(SR * dur)
    noise = rng.normal(0, 1, n)
    t = np.arange(n) / SR
    out = np.zeros(n)
    # sweep a resonant band through the noise
    f = np.linspace(500, 3500, n) if up else np.linspace(3500, 500, n)
    y1 = y2 = 0.0
    for i in range(n):
        w = 2 * np.pi * f[i] / SR
        r = .985
        y = noise[i] * (1 - r) + 2 * r * np.cos(w) * y1 - r * r * y2
        y2, y1 = y1, y
        out[i] = y
    env = np.sin(np.pi * t / dur) ** 2
    return out / (np.abs(out).max() + 1e-9) * env


def place(track, sound, at, gain):
    i = int(at * SR)
    j = min(len(track), i + len(sound))
    if i < len(track):
        track[i:j] += sound[:j - i] * gain


def render(seconds, swaps=(), plates=()):
    track = np.zeros(int(SR * (seconds + 1)))
    bars = int(np.ceil(seconds / (4 * BEAT)))
    bass = [['D2', 'A2', 'D2', 'A2'], ['Bb1', 'F2', 'Bb1', 'F2'], ['G1', 'D2', 'G1', 'D2'], ['A1', 'E2', 'A1', 'C#3']]
    mel_a = [['D4', None, 'F4', None, 'A4', None, 'G4', 'F4'], ['E4', None, 'D4', None, 'C#4', None, None, None],
             ['D4', None, 'F4', None, 'A4', None, 'Bb4', 'A4'], ['G4', None, 'E4', None, 'A4', None, None, None]]
    mel_b = [['A4', 'Bb4', 'A4', None, 'F4', None, 'D4', None], ['G4', 'A4', 'G4', None, 'E4', None, 'C#4', None],
             ['D4', None, 'F4', 'E4', 'D4', None, 'A3', None], ['D4', None, None, None, 'D5', None, None, None]]
    for bar in range(bars):
        t0 = bar * 4 * BEAT
        b = bass[bar % 4]
        for k, note in enumerate(b):
            place(track, reed(hz(note), BEAT * .9), t0 + k * BEAT, .32)
        mel = (mel_a if (bar // 4) % 2 == 0 else mel_b)[bar % 4]
        if bar >= 1:
            for k, note in enumerate(mel):
                if note:
                    place(track, pluck(hz(note), .45, .45), t0 + k * BEAT / 2, .38)
        if bar >= 8:   # second half: the glockenspiel doubles the tune an octave up, very 'laboratory'
            for k, note in enumerate(mel):
                if note:
                    place(track, glock(hz(note) * 2, .6), t0 + k * BEAT / 2, .07)
        for k in range(8):
            place(track, tick(2200 if k % 2 == 0 else 1600), t0 + k * BEAT / 2, .10 if k % 2 == 0 else .05)
        if bar >= 2:
            for k in (0, 2):
                place(track, kick(), t0 + k * BEAT, .45)
    place(track, glock(hz('D6'), 1.2), 0, .35)
    place(track, glock(hz('A6'), 1.2), .12, .25)
    for at in swaps:
        place(track, swoosh(.32), at - .16, .22)
    for at in plates:
        place(track, glock(hz('A5'), .9), at, .22)
        place(track, glock(hz('D6'), .9), at + .06, .16)
    track = track[:int(SR * seconds)]
    fade = int(SR * 1.2)
    track[-fade:] *= np.linspace(1, 0, fade)
    track /= np.abs(track).max() + 1e-9
    return (track * .89 * 32767).astype(np.int16)


if __name__ == '__main__':
    out = sys.argv[1]
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 32
    swaps = [float(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 and sys.argv[3] else []
    plates = [float(x) for x in sys.argv[4].split(',')] if len(sys.argv) > 4 and sys.argv[4] else []
    pcm = render(seconds, swaps, plates)
    with wave.open(out, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print('wrote', out, len(pcm) / SR, 's')
