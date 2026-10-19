// Close-up avatar captures for geometry review: extreme poses x three camera angles.
// Usage: node scripts/avatar-shots.mjs <outDir> [baseUrl] [avatar]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const out = process.argv[2] ?? '.local/review/avatar';
const base = process.argv[3] ?? 'https://localhost:4173/';
const avatar = process.argv[4] ?? 'instructor';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
const poses = [[1, 2.67], [2, 2.33], [3, 3.43], [3, 7.7], [4, 3.0], [4, 4.2]];
const angles = [0, 40, -140];
const page = await context.newPage();
await page.goto(`${base}?specimen=1&review=1&avatar=${avatar}`, { waitUntil: 'load' });
await page.waitForSelector('.hud:not(.loading)', { timeout: 90000 }); await page.evaluate(() => document.fonts.ready);
await page.addStyleTag({ content: '.hud { visibility: hidden !important; }' });
for (const [s, t] of poses) for (const az of angles) {
  await page.evaluate(([s, t, az]) => window.__review.seek(s, t, az), [s, t, az]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${avatar}-s${s}-t${t}-az${az}.png`, clip: { x: 20, y: 150, width: 353, height: 520 } });
}
} finally {
  await browser.close();
}

console.log('ok');
