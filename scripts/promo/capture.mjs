// Frame-exact capture of the promo shots from the production build (vite preview).
// Usage: node scripts/promo/capture.mjs <outDir> [baseUrl] [fromFrame] [toFrame]
// Writes <outDir>/NNNN.png at 1080x1440.
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';

const [out, base = 'https://localhost:4173/', from = '0', to] = process.argv.slice(2);
const spec = JSON.parse(await readFile(new URL('./shots.json', import.meta.url)));
const WINDOWS = { 1: [.3, 7.0], 2: [.3, 4.7], 3: [1.0, 8.5], 4: [.8, 8.6] };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const open = async ([w, h], hero) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1080 / w, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  // The video is for a Chinese audience: the app runs in its Chinese edition.
  await page.goto(`${base}?specimen=1&review=1&lang=zh`, { waitUntil: 'load' });
  await page.waitForSelector('.hud:not(.loading)', { timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);
  if (hero) {
    await page.addStyleTag({ content: '.hud { visibility: hidden !important; }' });
    await page.evaluate(band => window.__review.band(band), spec.heroBand);
  }
  return { page, specimen: 0, subject: -1, notes: false, warm: false };
};
const ease = x => x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
try {
  const pages = { ui: await open(spec.uiViewport, false), hero: await open(spec.heroViewport, true) };
  const total = Math.round(spec.duration * spec.fps);
  for (let n = Number(from); n < Number(to ?? total); n++) {
    const T = n / spec.fps;
    const shot = spec.shots.find(s => T >= s.start && T < s.end);
    const p = pages[shot.page];
    const [ws, we] = WINDOWS[shot.specimen];
    let t = shot.t0 + (T - shot.start);
    t = ws + ((t - ws) % (we - ws) + (we - ws)) % (we - ws);
    const k = ease((T - shot.start) / (shot.end - shot.start));
    const az = shot.az[0] + (shot.az[1] - shot.az[0]) * k;
    if (p.specimen !== shot.specimen) { await p.page.evaluate(([s, t]) => window.__review.seek(s, t, 0), [shot.specimen, t]); p.specimen = shot.specimen; }
    const subject = shot.subjects.filter(([at]) => T >= at).at(-1)[1];
    if (p.subject !== subject) { await p.page.evaluate(i => window.__review.subject(i), subject); p.subject = subject; }
    if (!!shot.notes !== p.notes) {
      await p.page.click('[data-k="notesToggle"]'); p.notes = !!shot.notes; await p.page.waitForTimeout(500);
      // The video names no performer: hide the 'Observed subject' row of the notes sheet.
      await p.page.evaluate(() => document.querySelectorAll('.sheet tr').forEach(tr => {
        if (['Observed subject', '观察对象'].includes(tr.firstElementChild?.textContent ?? '')) tr.style.display = 'none';
      }));
    }
    await p.page.evaluate(async ([t, az]) => {
      window.__review.frame(t, az);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, [t, az]);
    // The first frame on each page waits out the subject's fade-in.
    if (!p.warm) { await p.page.waitForTimeout(2500); await p.page.evaluate(([t, az]) => window.__review.frame(t, az), [t, az]); await p.page.waitForTimeout(300); p.warm = true; }
    await p.page.screenshot({ path: `${out}/${String(n).padStart(4, '0')}.png`, timeout: 180000 });
    if (n % 30 === 0) console.log('frame', n, shot.page, 'T', T.toFixed(2));
  }
} finally {
  await browser.close();
}
