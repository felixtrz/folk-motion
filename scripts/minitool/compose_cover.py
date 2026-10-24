"""Store cover for the mini-tool listing (3:4, 1080x1440): one recognisable pose fills the
frame; the specimen-plate typography sits around it, small and light.

Usage: python compose_cover.py <hero.png> <out.png>
The hero is a 1080x1440 render of the stage with the HUD hidden (see the README).
"""
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.local/promo-fonts'
CACHE.mkdir(parents=True, exist_ok=True)
INK, INK2, INK3, RULE = (20, 20, 19), (79, 78, 74), (125, 123, 117), (20, 20, 19, 36)


def woff(name, out):
    path = CACHE / out
    if not path.exists():
        f = TTFont(ROOT / 'node_modules' / name)
        f.flavor = None
        f.save(path)
    return str(path)


MONO = woff('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff', 'plex-mono-400.ttf')
SERIF = woff('@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff', 'instrument-serif-400.ttf')
ITALIC = woff('@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff', 'instrument-serif-italic.ttf')
SONG = '/System/Library/Fonts/Supplemental/Songti.ttc'
HEI = '/System/Library/Fonts/STHeiti Light.ttc'
font = lambda path, size, index=0: ImageFont.truetype(path, size, index=index)


def spaced(d, xy, text, f, fill, spacing):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + spacing
    return x


def main():
    hero, out = sys.argv[1], sys.argv[2]
    img = Image.open(hero).convert('RGBA').resize((1080, 1440), Image.LANCZOS)
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    L, R = 64, 1016
    # Masthead: institute and plate number, quiet.
    x = spaced(d, (L, 58), '民间舞动作研究所', font(HEI, 22), INK2, 2)
    spaced(d, (x + 8, 58), '· 田野图鉴', font(HEI, 22), INK3, 2)
    d.text((R, 50), 'II', font=font(SERIF, 44), fill=INK2, anchor='ra')
    d.rectangle([L, 100, R, 101], fill=RULE)
    # Title: the move and its binomial on one line.
    d.text((L - 2, 126), '浪子踢球', font=font(SONG, 58, 1), fill=INK)
    d.text((L + 262, 140), 'Calx prodigi', font=font(ITALIC, 38), fill=INK2)
    # Caption and imprint at the foot.
    d.rectangle([L, 1286, R, 1287], fill=RULE)
    spaced(d, (L, 1304), '观察到的功能', font(HEI, 19), INK3, 1)
    d.text((L, 1334), '踢一个不存在的球。', font=font(SONG, 34, 6), fill=INK)
    d.text((R, 1346), 'fm.elixr.games', font=font(MONO, 19), fill=INK3, anchor='ra')
    img.alpha_composite(layer)
    img.convert('RGB').save(out, optimize=True)
    print('wrote', out)


if __name__ == '__main__':
    main()
