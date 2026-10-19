// Phone-sized screenshots of the field-guide viewer for design review.
// Usage: node scripts/phone-shots.mjs <outDir> [baseUrl]
// Renders iPhone-class portrait frames (393x852 @3x, touch) plus one desktop frame,
// using deep links (?specimen=&t=&paused=1) so every capture is deterministic.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const out = process.argv[2] ?? '.local/review/phone';
const base = process.argv[3] ?? 'https://localhost:8081/';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = {};
try {
const shots = [
  ['phone-1-flash', 1, 2.67], ['phone-2-kick', 2, 2.33], ['phone-3-bear', 3, 3.43], ['phone-4-head', 4, 3.0],
  ['phone-3-bear-b', 3, 7.7], ['phone-1-flash-start', 1, 0.6],
  ['phone-2-kick-robot', 2, 2.33, 'robot'], ['phone-3-bear-croc', 3, 3.43, 'croc'], ['phone-4-head-croc', 4, 4.2, 'croc'],
];
async function capture(context, name, url, after) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.hud:not(.loading)', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  if (after) await after(page);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
  return errors;
}
const phone = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
for (const [name, s, t, avatar] of shots) report[name] = await capture(phone, name, `${base}?specimen=${s}&t=${t}&paused=1${avatar ? `&avatar=${avatar}` : ''}`);
  const small = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  report['small-2-kick-robot'] = await capture(small, 'small-2-kick-robot', `${base}?specimen=2&t=2.33&paused=1&avatar=robot`);
report['phone-notes'] = await capture(phone, 'phone-notes', `${base}?specimen=3&t=3.43&paused=1`, async page => { await page.click('.notes-toggle'); await page.waitForTimeout(700); });
// Playback filmstrip: one page, real playback between captures so footprints accumulate.
{
  const page = await phone.newPage();
  await page.goto(`${base}?specimen=3&review=1`, { waitUntil: 'load' });
  await page.waitForSelector('.hud:not(.loading)'); await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  for (const [i, t] of [1.6, 2.3, 3.0, 3.6, 4.3, 7.1, 7.7, 8.3].entries()) {
    await page.evaluate(t => window.__review.play(t), t);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/strip-${i}.png` });
  }
  await page.close();
}
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
report['desktop-3-bear'] = await capture(desktop, 'desktop-3-bear', `${base}?specimen=3&t=3.43&paused=1`);
} finally {
  await browser.close();
}

console.log(JSON.stringify(report));
