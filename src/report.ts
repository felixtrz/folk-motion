import wordmarkUrl from './brand/elixr-games-black.svg?url';
import { PLATE_H, PLATE_W } from './plate.js';

export type ReportInfo = {
  brand: string; title: string; trial: string; kicker: string;
  name: string; binomial: string; verdict: string; stamp: string;
  labels: readonly string[]; counts: readonly number[];
  mostLabel: string; most: string; subjectLabel: string; subject: string;
  site: string; zhText: boolean;
};

const PAPER = '#f7f7f5', INK = '#141413', INK2 = '#4f4e4a', INK3 = '#5f5d57', RULE = 'rgba(20,20,19,.16)', SIGNAL = '#ff4d1a';
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const SERIF = "'Instrument Serif', 'Times New Roman', serif";
const ZH = "'Songti SC', 'STSong', 'Noto Serif SC', 'Source Han Serif SC', serif";

let mark: Promise<HTMLImageElement | null> | null = null;
function wordmark(): Promise<HTMLImageElement | null> {
  mark = mark || new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img); img.onerror = () => resolve(null);
    img.src = wordmarkUrl;
  });
  return mark;
}

function fit(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, px: number, width: number): void {
  for (; px > 40; px -= 4) { g.font = font(px); if (g.measureText(text).width <= width) return; }
}

/** The personality card, 3:4 like the plates. `shot` is the specimen at this moment. */
export async function composeReport(shot: CanvasImageSource, info: ReportInfo): Promise<HTMLCanvasElement> {
  const logo = await wordmark();
  const c = document.createElement('canvas'); c.width = PLATE_W; c.height = PLATE_H;
  const g = c.getContext('2d')!;
  const L = 64, R = PLATE_W - 64;
  const zhFont = (w: number) => (px: number) => `${w} ${px}px ${info.zhText ? ZH : SERIF}`;
  g.fillStyle = PAPER; g.fillRect(0, 0, PLATE_W, PLATE_H);

  // The specimen, on the right, feathered into the paper.
  const SX = 470, SY = 330, SW = 610, SH = 760;
  g.save();
  g.beginPath(); g.rect(SX, SY, SW, SH); g.clip();
  // The shot is 1080x800; show its middle at the specimen's height.
  const scale = SH / 800, w = 1080 * scale;
  g.drawImage(shot, SX + (SW - w) / 2, SY, w, SH);
  g.restore();
  for (const [x0, x1] of [[SX, SX + 120], [PLATE_W, PLATE_W - 40]]) {
    const fade = g.createLinearGradient(x0, 0, x1, 0);
    fade.addColorStop(0, PAPER); fade.addColorStop(1, 'rgba(247,247,245,0)');
    g.fillStyle = fade; g.fillRect(Math.min(x0, x1), SY, Math.abs(x1 - x0), SH);
  }
  for (const [y0, y1] of [[SY, SY + 60], [SY + SH, SY + SH - 90]]) {
    const fade = g.createLinearGradient(0, y0, 0, y1);
    fade.addColorStop(0, PAPER); fade.addColorStop(1, 'rgba(247,247,245,0)');
    g.fillStyle = fade; g.fillRect(SX, Math.min(y0, y1), SW, Math.abs(y1 - y0));
  }

  // Masthead.
  g.textBaseline = 'alphabetic';
  g.fillStyle = INK; g.font = `500 24px ${MONO}, ${ZH}`;
  g.fillText(`${info.brand} · ${info.title}`, L, 82);
  g.fillStyle = INK2; g.textAlign = 'right'; g.fillText(info.trial, R, 82); g.textAlign = 'left';
  g.fillStyle = RULE; g.fillRect(L, 104, R - L, 2);

  // The verdict: kicker, the personality, its binomial.
  g.fillStyle = SIGNAL; g.font = `500 28px ${MONO}, ${ZH}`;
  g.fillText(info.kicker, L, 172);
  g.fillStyle = INK; fit(g, info.name, zhFont(info.zhText ? 400 : 400), info.zhText ? 120 : 104, R - L);
  g.fillText(info.name, L - 4, 300);
  g.font = `italic 48px ${SERIF}`; g.fillStyle = INK3;
  g.fillText(info.binomial, L, 364);

  // Measurements, left column: four bars, the largest in the signal colour.
  const max = Math.max(1, ...info.counts);
  let y = 470;
  g.font = `400 26px ${MONO}, ${ZH}`;
  info.labels.forEach((label, i) => {
    const n = info.counts[i], top = n === max && n > 0;
    g.fillStyle = INK2; g.fillText(label, L, y);
    g.textAlign = 'right'; g.fillStyle = INK; g.fillText(String(n).padStart(2, '0'), L + 380, y); g.textAlign = 'left';
    g.fillStyle = RULE; g.fillRect(L, y + 18, 380, 6);
    g.fillStyle = top ? SIGNAL : INK; g.fillRect(L, y + 18, Math.max(6, 380 * n / max), 6);
    y += 92;
  });
  // Most thrown and the subject.
  y += 10;
  g.fillStyle = INK3; g.font = `400 22px ${MONO}, ${ZH}`; g.fillText(info.mostLabel, L, y);
  g.fillStyle = INK; g.font = `400 40px ${info.zhText ? ZH : SERIF}`; g.fillText(info.most, L, y + 50);
  y += 120;
  g.fillStyle = INK3; g.font = `400 22px ${MONO}, ${ZH}`; g.fillText(info.subjectLabel, L, y);
  g.fillStyle = INK; g.font = `400 40px ${info.zhText ? ZH : SERIF}`; g.fillText(info.subject, L, y + 50);

  // The examiner's note, and the stamp.
  g.fillStyle = RULE; g.fillRect(L, 1150, R - L, 2);
  g.fillStyle = INK; g.font = info.zhText ? `400 40px ${ZH}` : `italic 44px ${SERIF}`;
  const words = info.zhText ? [...info.verdict] : info.verdict.split(' ');
  let line = '', ly = 1214;
  for (const u of words) {
    const next = line ? (info.zhText ? line + u : `${line} ${u}`) : u;
    if (g.measureText(next).width > R - L - 40 && line) { g.fillText(line, L, ly); ly += 54; line = u; } else line = next;
  }
  if (line) g.fillText(line, L, ly);
  g.save();
  g.translate(R - 120, 1040); g.rotate(-.12);
  g.strokeStyle = SIGNAL; g.lineWidth = 3; g.globalAlpha = .9;
  g.strokeRect(-110, -36, 220, 72);
  g.fillStyle = SIGNAL; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `600 34px ${info.zhText ? ZH : MONO}`; g.fillText(info.stamp, 0, 2);
  g.restore();

  // Imprint.
  g.fillStyle = RULE; g.fillRect(L, 1350, R - L, 2);
  g.fillStyle = INK2; g.font = `400 24px ${MONO}`; g.textBaseline = 'alphabetic';
  g.fillText(info.site, L, 1398);
  if (logo) { const h = 40, lw = h * 3.13; g.drawImage(logo, R - lw, 1371, lw, h); }
  return c;
}
