"""Composite the throwing promo: captions over the hero shots, stickers on the app shots, an
end card, then mux the soundtrack.

Usage: python compose_trial.py <framesDir> <music.wav> <out.mp4> [stillsDir]
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from compose import ACCENT, F_HOOK, F_KICK, F_SUB, F_TITLE, INK, INK3, PAPER, W, H, ease, font, MONO, SONG, spaced

HERE = Path(__file__).parent
spec = json.loads((HERE / 'trial-shots.json').read_text())
FPS = spec['fps']
F_STICK = font(SONG, 44, 1)
F_END = font(SONG, 96, 0)
F_URL = font(MONO, 30)

STICKERS = {'tap-can': '点一下，扔过去', 'flower': '送小红花 → 他会得意', 'plate': '一键生成图版 · 发笔记'}
MONTAGE = ('m-tomato', 'm-eraser', 'm-melon', 'm-medal')


def caption(img, c, local, animate=True, big=False, top=70):
    a = ease(local / .3) if animate else 1.0
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    y, alpha = top + (1 - a) * 24, int(255 * a)
    spaced(d, (64, y), c['kicker'], F_KICK, ACCENT + (alpha,))
    d.text((58, y + 42), c['title'], font=F_HOOK if big else F_TITLE, fill=INK + (alpha,))
    if c.get('sub'):
        d.text((64, y + (156 if big else 136)), c['sub'], font=F_SUB, fill=INK3 + (alpha,))
    img.alpha_composite(layer)


def sticker(img, text, local, at=(60, 300)):
    """An ink tag, slightly askew, popping in over the app."""
    a = ease(local / .25)
    if a <= 0:
        return
    pad, d0 = 26, ImageDraw.Draw(img)
    w = int(d0.textlength(text, font=F_STICK)) + pad * 2
    tag = Image.new('RGBA', (w, 84), (0, 0, 0, 0))
    d = ImageDraw.Draw(tag)
    d.rounded_rectangle([0, 0, w - 1, 83], 14, fill=INK + (235,))
    d.text((pad, 14), text, font=F_STICK, fill=(255, 255, 255, 255))
    s = .85 + .15 * a
    tag = tag.resize((int(w * s), int(84 * s)), Image.LANCZOS).rotate(3, expand=True, resample=Image.BICUBIC)
    tag.putalpha(tag.getchannel('A').point(lambda v: int(v * a)))
    img.alpha_composite(tag, at)


def end_card(stills, local):
    img = Image.new('RGBA', (W, H), PAPER + (255,))
    if stills:
        hero = Image.open(stills).convert('RGBA')
        hero = hero.resize((W, H), Image.LANCZOS).crop((0, 200, W, H))
        img.alpha_composite(hero, (0, 380))
    a = ease(local / .35)
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    al = int(255 * a)
    spaced(d, (64, 90), '小红书小工具 · 也可以在浏览器打开', F_KICK, ACCENT + (al,))
    d.text((58, 140), '民间舞动作研究所', font=F_END, fill=INK + (al,))
    d.text((64, 270), '朝他扔东西，看他怎么接。', font=F_SUB, fill=INK3 + (al,))
    d.text((64, 340), 'fm.elixr.games', font=F_URL, fill=INK + (al,))
    img.alpha_composite(layer)
    return img


def cover(shot, out, zoom=1.12, drop=70):
    """Thumbnail: the shot pushed in on the subject, with the hook on top."""
    img = Image.open(shot).convert('RGBA').resize((W, H), Image.LANCZOS)
    z = img.resize((int(W * zoom), int(H * zoom)), Image.LANCZOS)
    x0 = (z.width - W) // 2
    canvas = Image.new('RGBA', (W, H), PAPER + (255,))
    canvas.alpha_composite(z.crop((x0, z.height - H - drop, x0 + W, z.height - drop)))
    caption(canvas, {'kicker': '民间舞动作研究所 · 小红书小工具', 'title': '朝他扔东西', 'sub': '他只会用民间舞回应'}, 1, animate=False, big=True)
    canvas.convert('RGB').save(out)
    print('wrote', out)


def main():
    if sys.argv[1] == 'cover':
        return cover(sys.argv[2], sys.argv[3])
    frames, music, out = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    still = sys.argv[4] if len(sys.argv) > 4 else None
    ff = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                           '-i', music, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
                           '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
    montage_started = None
    for s in [s for s in spec['segments'] if not s.get('still')]:
        n_frames = round(s['dur'] * FPS)
        for n in range(n_frames):
            local = n / FPS
            if s['page'] == 'card':
                img = end_card(still, local)
            else:
                img = Image.open(frames / s['id'] / f'{n:04d}.png').convert('RGBA')
                if img.size != (W, H):
                    img = img.resize((W, H), Image.LANCZOS)
                if s['id'] in MONTAGE:
                    if montage_started is None:
                        montage_started = s['id']
                    caption(img, s['caption'], local, animate=s['id'] == montage_started)
                elif 'caption' in s:
                    caption(img, s['caption'], local, animate=s['id'] != 'hook', big=s['id'] == 'hook')
                if s['id'] in STICKERS:
                    sticker(img, STICKERS[s['id']], local - .1, (520, 640) if s['id'] == 'plate' else (60, 300))
            ff.stdin.write(np.asarray(img.convert('RGB')).tobytes())
    ff.stdin.close()
    ff.wait()
    print('wrote', out)


if __name__ == '__main__':
    main()
