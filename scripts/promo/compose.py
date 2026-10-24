"""Composite the captured promo frames with captions and the swipe hint, mux the soundtrack.

Usage: python compose.py <framesDir> <music.wav> <out.mp4>
Hero shots get a caption block at the top; UI shots carry their caption inside the app
(see capture.mjs); the notes shot gets a caption panel at the bottom.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
spec = json.loads((HERE / 'shots.json').read_text())
FPS, W, H = spec['fps'], 1080, 1440
PAPER, INK, INK3, ACCENT = (247, 247, 245), (20, 20, 19), (110, 108, 102), (255, 77, 26)
CACHE = Path('.local/promo-fonts'); CACHE.mkdir(parents=True, exist_ok=True)


def woff(path, name):
    out = CACHE / name
    if not out.exists():
        from fontTools.ttLib import TTFont   # only needed once, to unpack the woff
        f = TTFont(path); f.flavor = None; f.save(out)
    return str(out)


MONO = woff(ROOT / 'node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff', 'plex-mono-500.ttf')
SONG = '/System/Library/Fonts/Supplemental/Songti.ttc'
font = lambda path, size, index=0: ImageFont.truetype(path, size, index=index)
F_KICK = font(MONO, 25)
F_TITLE = font(SONG, 74, 1)     # Songti SC Bold
F_SUB = font(SONG, 40, 6)       # Songti SC Regular
F_NAME = font(SONG, 44, 1)
F_HINT = font(MONO, 22)
F_KICK_CJK = font(SONG, 25, 1)
F_HOOK = font(SONG, 84, 0)      # Songti SC Black, for the cover frame
for f, want in ((F_TITLE, 'Bold'), (F_SUB, 'Regular')):
    print('font', f.getname(), 'want', want)


def ease(x):
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 3


def spaced(draw, xy, text, fnt, fill, spacing=3):
    x, y = xy
    for ch in text:
        f = F_KICK_CJK if ord(ch) > 0x2e7f else fnt     # the mono face has no CJK glyphs
        draw.text((x, y - (3 if f is F_KICK_CJK else 0)), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + spacing
    return x


def caption(img, shot, local, top=70):
    """Kicker, title, sub; slides up and fades in over the shot's first 0.3 s. The opening
    shot is already in place on frame 0, which Xiaohongshu uses as the default cover."""
    a = 1.0 if shot['start'] == 0 else ease(local / .3)
    big = shot['start'] == 0
    if a <= 0:
        return
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    y = top + (1 - a) * 24
    alpha = int(255 * a)
    spaced(d, (64, y), shot['kicker'], F_KICK, ACCENT + (alpha,))
    d.text((58, y + 42), shot['title'], font=F_HOOK if big else F_TITLE, fill=INK + (alpha,))
    if shot.get('sub'):
        d.text((64, y + (156 if big else 136)), shot['sub'], font=F_SUB, fill=INK3 + (alpha,))
    img.alpha_composite(layer)


def names(img, shot, T, local, top=70):
    """Subject names under the swipe title, the current one in ink."""
    a = ease(local / .3)
    current = [i for at, i in shot['subjects'] if T >= at][-1]
    d = ImageDraw.Draw(img)
    x, y = 64, top + 136
    for i, n in enumerate(shot['names']):
        on = i == current
        d.text((x, y), n, font=F_NAME if on else F_SUB, fill=(INK if on else INK3) + (int(255 * a),))
        w = d.textlength(n, font=F_NAME if on else F_SUB)
        if on:
            d.rectangle([x, y + 58, x + w, y + 62], fill=INK + (int(255 * a),))
        x += w + 40
        if i < len(shot['names']) - 1:
            d.text((x - 28, y + 2), '/', font=F_SUB, fill=INK3 + (int(160 * a),))


def swipe(img, T, at):
    """A fingertip flicking right to left, ending just as the subject changes."""
    p = (T - (at - .32)) / .4
    if not 0 <= p <= 1:
        return
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    k = ease(p)
    x0, x1, y = 820, 300, 900
    fade = 1 - max(0, (p - .75) / .25)
    for s in range(10):   # trail
        q = max(0, k - s * .035)
        x = x0 + (x1 - x0) * q
        r = 30 - s * 2
        d.ellipse([x - r, y - r, x + r, y + r], fill=(20, 20, 19, int(28 * fade * (1 - s / 10))))
    x = x0 + (x1 - x0) * k
    d.ellipse([x - 44, y - 40, x + 44, y + 48], fill=(20, 20, 19, int(40 * fade)))   # soft shadow
    d.ellipse([x - 42, y - 42, x + 42, y + 42], fill=(255, 255, 255, int(240 * fade)), outline=(20, 20, 19, int(210 * fade)), width=4)
    img.alpha_composite(layer)


def panel(img, shot, local):
    """Bottom caption panel for the notes shot."""
    a = ease(local / .3)
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    top = H - 300 + (1 - a) * 40
    d.rectangle([0, top, W, H], fill=PAPER + (int(255 * a),))
    d.line([64, top, W - 64, top], fill=INK + (int(255 * a),), width=3)
    img.alpha_composite(layer)
    caption(img, shot, local, top=top + 34)


def main():
    frames, music, out = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    total = int(spec['duration'] * FPS)
    ff = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                           '-i', music, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
                           '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
    for n in range(total):
        T = n / FPS
        shot = next(s for s in spec['shots'] if s['start'] <= T < s['end'])
        local = T - shot['start']
        img = Image.open(frames / f'{n:04d}.png').convert('RGBA')
        if img.size != (W, H):
            img = img.resize((W, H), Image.LANCZOS)
        if shot['page'] == 'hero':
            caption(img, shot, local)
            if 'names' in shot:
                names(img, shot, T, local)
            for at in shot.get('swipes', []):
                swipe(img, T, at)
        elif shot.get('notes'):
            panel(img, shot, local)
        ff.stdin.write(np.asarray(img.convert('RGB')).tobytes())
    ff.stdin.close()
    ff.wait()
    print('wrote', out)


if __name__ == '__main__':
    main()
