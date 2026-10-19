import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Run once per move (runs are capped at ~110 s):
//   REVIEW_MOVE=flash-step npx @iwsdk/cli browser run scripts/render-review.mjs --timeout 110000
// (dev server started with --allow-browser-automation). Writes the skinned-character
// render of every move to .local/review/render/<id>/NNNN.jpg for scripts/pose_delta.py.
const MOVES = { 'flash-step': .204, 'ball-kick': .176, 'bear-shake': .197, 'head-shake': .122 };

export default async function ({ frame, workspaceRoot }) {
  const summary = {};
  for (const [id, pitch] of Object.entries(MOVES).filter(([id]) => !process.env.REVIEW_MOVE || id === process.env.REVIEW_MOVE)) {
    const count = await frame.evaluate(async ([id, pitch]) => (await import('/scripts/review-render.ts')).setup(id, pitch), [id, pitch]);
    const dir = resolve(workspaceRoot, '.local/review/render', id);
    await mkdir(dir, { recursive: true });
    for (let from = 0; from < count; from += 30) {
      const images = await frame.evaluate(async ([from]) => (await import('/scripts/review-render.ts')).render(from, from + 30), [from]);
      await Promise.all(images.map((url, i) => writeFile(resolve(dir, `${String(from + i).padStart(4, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'))));
    }
    summary[id] = count;
  }
  return summary;
}
