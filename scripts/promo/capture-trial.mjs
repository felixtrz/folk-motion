// Frame-exact capture of the throwing promo from the mini-tool build (served over http).
// Usage: node scripts/promo/capture-trial.mjs <outDir> [baseUrl] [segmentId...]
// Time is Playwright's paused fake clock, advanced one video frame at a time; CSS animations
// are stepped by hand. Writes <outDir>/<segment>/NNNN.png (1080x1440) and <segment>.json with
// the sound cues (seconds from the segment's first captured frame).
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const [out, base = 'http://localhost:4310/', ...only] = process.argv.slice(2);
const spec = JSON.parse(await readFile(new URL('./trial-shots.json', import.meta.url)));
const FPS = spec.fps, DT = 1000 / FPS, [VW, VH] = spec.viewport;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

const open = async hero => {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1080 / VW, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    // Seeded randomness (dodge choice, tumbles, splashes) and the container API, stubbed.
    let s = 20261023; Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const ok = () => Promise.resolve({});
    window.xhs = { miniTool: { saveImageToPhotosAlbum: ok, writeTempFile: () => Promise.resolve({ path: 'tmp' }), postNote: ok, vibrateShort: ok,
      followAuthor: ok, getFollowStatus: () => Promise.resolve({ followed: false }) } };
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.clock.install({ time: 0 });
  await page.goto(`${base}?review=1`, { waitUntil: 'load' });
  await page.clock.pauseAt(60000);
  for (let i = 0; i < 300 && !(await page.$('.hud:not(.loading)')); i++) await page.clock.runFor(100);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: `
    .promo-tap { position: fixed; z-index: 99; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
      background: rgba(20,20,19,.16); border: 2px solid rgba(20,20,19,.55); pointer-events: none; opacity: 0; }
    ${hero ? '.hud { visibility: hidden !important; }' : ''}` });
  await page.evaluate(() => { const d = document.createElement('div'); d.className = 'promo-tap'; document.body.appendChild(d); });
  if (hero) await page.evaluate(b => window.__review.band(b), spec.heroBand);
  return { page, subject: 0, tap: null };
};

// One video frame: the fake clock (rAF, timers) and every CSS animation advance by DT.
const step = async (p, now) => {
  await p.page.clock.runFor(DT);
  await p.page.evaluate(([ms, tap, now]) => {
    for (const a of document.getAnimations()) {
      if (a.__t === undefined) { a.__t = Number(a.currentTime) || 0; a.pause(); }
      a.__t += ms; a.currentTime = a.__t;
    }
    // The fingertip: presses in, then fades.
    const el = document.querySelector('.promo-tap');
    const k = tap ? (now - tap.at) : 9;
    if (tap) { el.style.left = `${tap.x}px`; el.style.top = `${tap.y}px`; }
    el.style.opacity = k < -.25 || k > .45 ? 0 : String(k < 0 ? 1 + k * 4 : 1 - k / .45);
    el.style.transform = `scale(${k < 0 ? 1.25 + k : 1 + k * .6})`;
  }, [DT, p.tap, now]);
};

const act = async (p, [, kind, arg], now) => {
  if (kind === 'throw') {
    await p.page.evaluate(([slot, v]) => { window.__review.next(slot, v); window.__review.throw(slot); }, arg);
  } else if (kind === 'tap') {
    const box = await (await p.page.$(arg)).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await p.page.touchscreen.tap(x, y);
    p.tap = { x, y, at: now };
  } else if (kind === 'next') {
    await p.page.evaluate(([slot, v]) => window.__review.next(slot, v), arg);
  }
};

try {
  const pages = { ui: await open(false), hero: await open(true) };
  await mkdir(out, { recursive: true });
  for (const seg of spec.segments) {
    if (seg.page === 'card' || (only.length && !only.includes(seg.id))) continue;
    const p = pages[seg.page];
    p.tap = null;
    if (seg.az !== undefined) await p.page.evaluate(az => window.__review.frame(window.__review.state().t, az), seg.az);
    if (p.subject !== seg.subject) {
      await p.page.evaluate(i => window.__review.subject(i), seg.subject); p.subject = seg.subject;
      for (let i = 0; i < 45; i++) await step(p, -99);
    }
    for (let i = 0; i < 400 && (await p.page.evaluate(() => window.__review.state().busy)); i++) await step(p, -99);
    for (const [k, v] of seg.next ?? []) await act(p, [0, 'next', [k, v]], -99);
    const actions = [...seg.actions ?? []].sort((a, b) => a[0] - b[0]);
    const preFrames = Math.round(seg.pre * FPS), frames = Math.round(seg.dur * FPS);
    let clock0 = 0, done = 0;
    const dir = `${out}/${seg.id}`; await mkdir(dir, { recursive: true });
    await p.page.evaluate(() => { window.__review.cues.length = 0; });
    for (let n = -preFrames; n < frames; n++) {
      const now = n / FPS;
      while (done < actions.length && actions[done][0] <= now + 1e-6) await act(p, actions[done++], now);
      if (n === 0) clock0 = await p.page.evaluate(() => window.__review.clock());
      await step(p, now);
      if (n >= 0) await p.page.screenshot({ path: `${dir}/${String(n).padStart(4, '0')}.png` });
    }
    const cues = (await p.page.evaluate(() => window.__review.cues)).map(c => ({ cue: c.cue, t: +(c.t - clock0).toFixed(3) }));
    await writeFile(`${out}/${seg.id}.json`, JSON.stringify({ frames, cues }));
    console.log(seg.id, frames, 'frames', JSON.stringify(cues));
  }
} finally {
  await browser.close();
}
