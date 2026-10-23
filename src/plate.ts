/** A shareable specimen plate: the current moment, typeset like a field-guide page (3:4). */
export type PlateInfo = {
  brand: string; guide: string; trial: string;
  zh: string; numeral: string; binomial: string; gloss: string;
  fnLabel: string; fnText: string; result: string;
  site: string; zhText: boolean;
};

export const PLATE_W = 1080, PLATE_H = 1440;
// The specimen image sits between the title block and the caption.
export const SHOT_Y = 350, SHOT_H = 800;

const PAPER = '#f7f7f5', INK = '#141413', INK2 = '#4f4e4a', INK3 = '#5f5d57', RULE = 'rgba(20,20,19,.16)', SIGNAL = '#ff4d1a';
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const SERIF = "'Instrument Serif', 'Times New Roman', serif";
const ZH = "'Songti SC', 'STSong', 'Noto Serif SC', 'Source Han Serif SC', serif";

let mark: Promise<HTMLImageElement | null> | null = null;
function wordmark(): Promise<HTMLImageElement | null> {
  mark ??= new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img); img.onerror = () => resolve(null);
    img.src = `${import.meta.env.BASE_URL}brand/elixr-games-black.svg`;
  });
  return mark;
}

/** Letter-spaced text (canvas letterSpacing is not everywhere yet). Returns the end x. */
function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, align: 'left' | 'right' = 'left'): number {
  let width = 0;
  for (const ch of text) width += g.measureText(ch).width + spacing;
  width -= spacing;
  let cx = align === 'right' ? x - width : x;
  for (const ch of text) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + spacing; }
  return cx;
}

/** Breaks text into at most `max` lines that fit `width` (words, or characters for Chinese). */
function wrap(g: CanvasRenderingContext2D, text: string, width: number, max: number, byChar: boolean): string[] {
  const units = byChar ? [...text] : text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const u of units) {
    const next = line ? (byChar ? line + u : `${line} ${u}`) : u;
    if (g.measureText(next).width > width && line) { lines.push(line); line = u; } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, max);
}

export async function composePlate(shot: CanvasImageSource, info: PlateInfo): Promise<HTMLCanvasElement> {
  await Promise.all([
    document.fonts.load(`500 24px ${MONO}`), document.fonts.load(`400 24px ${MONO}`),
    document.fonts.load(`italic 54px ${SERIF}`), document.fonts.load(`400 100px ${SERIF}`),
  ]).catch(() => undefined);
  const logo = await wordmark();
  const c = document.createElement('canvas'); c.width = PLATE_W; c.height = PLATE_H;
  const g = c.getContext('2d')!;
  const L = 64, R = PLATE_W - 64;
  g.fillStyle = PAPER; g.fillRect(0, 0, PLATE_W, PLATE_H);
  g.drawImage(shot, 0, SHOT_Y, PLATE_W, SHOT_H);
  // Feather the render into the paper so it has no edge.
  for (const [y0, y1] of [[SHOT_Y, SHOT_Y + 50], [SHOT_Y + SHOT_H, SHOT_Y + SHOT_H - 90]]) {
    const fade = g.createLinearGradient(0, y0, 0, y1);
    fade.addColorStop(0, PAPER); fade.addColorStop(1, 'rgba(247,247,245,0)');
    g.fillStyle = fade; g.fillRect(0, Math.min(y0, y1), PLATE_W, Math.abs(y1 - y0));
  }
  g.textBaseline = 'alphabetic';

  // Masthead.
  g.fillStyle = INK; g.font = `500 24px ${MONO}`;
  let x = spaced(g, info.brand.toUpperCase(), L, 82, 2.6);
  g.fillStyle = INK2; g.font = `400 24px ${MONO}`;
  spaced(g, ` · ${info.guide.toUpperCase()}`, x, 82, 2.6);
  spaced(g, info.trial.toUpperCase(), R, 82, 2.6, 'right');
  g.fillStyle = RULE; g.fillRect(L, 104, R - L, 2);

  // Title block: Chinese name, plate numeral, binomial, gloss.
  g.fillStyle = INK; g.font = `400 96px ${ZH}`;
  g.fillText(info.zh, L - 4, 214);
  g.font = `400 108px ${SERIF}`; g.textAlign = 'right';
  g.fillText(info.numeral, R, 210);
  g.textAlign = 'left';
  g.font = `italic 56px ${SERIF}`;
  g.fillText(info.binomial, L, 280);
  g.fillStyle = INK2; g.font = `400 25px ${info.zhText ? `${MONO}, ${ZH}` : MONO}`;
  g.fillText(info.gloss, L, 326);

  // Caption: label, result (in the signal colour), the observed function.
  g.fillStyle = INK3; g.font = `400 22px ${info.zhText ? `${MONO}, ${ZH}` : MONO}`;
  spaced(g, info.fnLabel.toUpperCase(), L, 1196, info.zhText ? 1 : 2.2);
  g.fillStyle = SIGNAL; g.font = `500 22px ${info.zhText ? `${MONO}, ${ZH}` : MONO}`;
  spaced(g, info.result.toUpperCase(), R, 1196, info.zhText ? 1 : 2.2, 'right');
  g.fillStyle = INK; g.font = info.zhText ? `400 46px ${ZH}` : `italic 52px ${SERIF}`;
  wrap(g, info.fnText, R - L, 2, info.zhText).forEach((line, i) => g.fillText(line, L, 1258 + i * 58));

  // Imprint.
  g.fillStyle = RULE; g.fillRect(L, 1350, R - L, 2);
  g.fillStyle = INK2; g.font = `400 24px ${MONO}`;
  spaced(g, info.site, L, 1398, 1.5);
  if (logo) { const h = 40, w = h * 3.13; g.drawImage(logo, R - w, 1371, w, h); }   // wordmark viewBox is 3.13:1
  return c;
}
