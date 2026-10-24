// Packages dist-minitool/ (from `vite build --config vite.minitool.config.ts`) as the
// Xiaohongshu mini-tool zip, after the checks in .claude/skills/minitool-zip-builder.
// Usage: node scripts/minitool/package.mjs   (or: npm run build:minitool)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const dist = join(root, 'dist-minitool');
const outDir = join(root, 'minitool');
const zipPath = join(outDir, 'folk-motion-minitool.zip');
const skill = join(root, '.claude/skills/minitool-zip-builder/scripts');
// Exactly the upload check's list (it rejects anything else, audio included).
const ALLOWED = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2', '.json']);
const errors = [], notes = [];

const walk = dir => readdirSync(dir).flatMap(name => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

// 1. Classic script at the end of <body>: the container needs <script src>, not type="module".
const indexPath = join(dist, 'index.html');
if (!existsSync(indexPath)) { console.error('dist-minitool/index.html missing: run the mini-tool build first'); process.exit(1); }
let html = readFileSync(indexPath, 'utf8');
const tag = html.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>\s*/);
if (!tag) errors.push('index.html: no entry <script src>');
else {
  html = html.replace(tag[0], '').replace('</body>', `  <script src="${tag[1]}"></script>\n</body>`);
  writeFileSync(indexPath, html);
}

// 2. Package checks (zip-artifact-spec.md §6, device-capabilities.md §6).
const files = walk(dist);
for (const f of files) {
  const rel = relative(dist, f);
  if (!ALLOWED.has(extname(f).toLowerCase())) errors.push(`${rel}: file type not allowed`);
  if (/\.map$|\.DS_Store$|node_modules/.test(rel)) errors.push(`${rel}: development file`);
}
if (files.filter(f => f.endsWith('.html')).length !== 1) errors.push('exactly one .html (index.html) required');
const check = (cond, msg) => { if (cond) errors.push(msg); };
check(!/<!DOCTYPE html>/i.test(html), 'index.html: missing <!DOCTYPE html>');
check(!/lang="zh-CN"/.test(html), 'index.html: lang="zh-CN" missing');
check(!/charset="UTF-8"/i.test(html), 'index.html: charset UTF-8 missing');
check(!/width=device-width, initial-scale=1\.0[^"]*viewport-fit=cover/.test(html), 'index.html: viewport must include width=device-width, initial-scale=1.0, viewport-fit=cover');
check(/type="module"/.test(html), 'index.html: type="module" script');
check(/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'index.html: inline <script>');
check(/\son[a-z]+="/i.test(html), 'index.html: inline event handler');
check(/<base\s|<iframe|<object|http-equiv="Content-Security-Policy"/i.test(html), 'index.html: <base>/<iframe>/<object>/CSP meta');
check(/(src|href)="(https?:)?\/\//.test(html) || /(src|href)="\//.test(html), 'index.html: absolute or external resource');
const FORBIDDEN = [
  ['fetch(', /\bfetch\(/], ['XMLHttpRequest', /XMLHttpRequest/], ['WebSocket', /new WebSocket\(/], ['EventSource', /new EventSource\(/],
  ['RTCPeerConnection', /RTCPeerConnection/], ['geolocation', /navigator\.geolocation/], ['clipboard', /navigator\.clipboard|execCommand\(["']copy/],
  ['bluetooth/usb/hid/serial', /navigator\.(bluetooth|usb|hid|serial)\b/], ['battery/connection/credentials/locks', /navigator\.(getBattery|connection|credentials|locks)\b/],
  ['enumerateDevices/getDisplayMedia', /enumerateDevices|getDisplayMedia/], ['storage.persist/serviceWorker', /storage\.persist|serviceWorker\.register/],
  ['Worker', /new (Shared)?Worker\(/], ['sensors', /new (Accelerometer|Gyroscope|Magnetometer)\(|DeviceMotionEvent|DeviceOrientationEvent|["']device(motion|orientation)["']/],
  ['requestFullscreen', /requestFullscreen/], ['eval / new Function', /\beval\(|new Function\(/], ['WebAssembly', /WebAssembly\./],
  ['window.open / prompt', /window\.open\(|window\.prompt\(/], ['WebXR', /navigator\.xr|requestSession\(/],
  ['dynamic import / module syntax', /\bimport\(|import\.meta|^\s*(import|export)\s/m], ['download / _blank', /\bdownload=|_blank/],
];
// Built-ins newer than the container's Chrome 61 floor. The build lowers syntax to ES2017 but
// cannot polyfill these; one at load time stops the whole app (every button goes dead).
const NEWER = [
  ['Array.prototype.flat/flatMap (69)', /\.flatMap\(|\.flat\(\)/], ['Object.fromEntries (73)', /Object\.fromEntries/],
  ['replaceChildren (86)', /\.replaceChildren\(/], ['replaceAll (85)', /\.replaceAll\(/], ['matchAll (73)', /\.matchAll\(/],
  ['structuredClone (98)', /structuredClone\(/], ['Object.hasOwn (93)', /Object\.hasOwn\(/], ['Promise.allSettled/any (76/85)', /Promise\.(allSettled|any)\(/],
  ['queueMicrotask (71)', /queueMicrotask\(/], ['findLast (97)', /\.findLast(Index)?\(/], ['globalThis (71)', /\bglobalThis\b/],
  ['toSorted/toReversed (110)', /\.to(Sorted|Reversed|Spliced)\(/], ['trimStart/trimEnd (66)', /\.trim(Start|End)\(/],
];
for (const f of files.filter(f => /\.(js|html|css)$/.test(f))) {
  const text = readFileSync(f, 'utf8');
  for (const [name, re] of FORBIDDEN) if (re.test(text)) errors.push(`${relative(dist, f)}: forbidden capability: ${name}`);
  if (f.endsWith('.js')) for (const [name, re] of NEWER) if (re.test(text)) errors.push(`${relative(dist, f)}: API newer than Chrome 61: ${name}`);
  const external = text.match(/(?:src=|href=|url\()["']?https?:\/\/[^"')\s]+/g);
  if (external) errors.push(`${relative(dist, f)}: external resource reference ${external[0]}`);
}
const big64 = files.filter(f => /\.(js|css|html)$/.test(f)).flatMap(f => readFileSync(f, 'utf8').match(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]{136000,}/g) ?? []);
if (big64.length) errors.push(`${big64.length} base64 resource(s) over 100 KiB`);

if (errors.length) { for (const e of errors) console.log(`ERROR: ${e}`); process.exit(1); }

// 3. Zip the directory contents (index.html at the zip root), then the skill's audits.
mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zipPath, '.', '-x', '*.DS_Store'], { cwd: dist });
const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
if (!/\s index\.html\n/.test(listing)) { console.log('ERROR: index.html is not at the zip root'); process.exit(1); }
const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim(); } catch (e) { errors.push(`${cmd} audit failed`); return String(e.stdout ?? e); } };
if (existsSync(join(skill, 'audit_artifact.mjs'))) {
  notes.push(`node audit (dir):  ${run('node', [join(skill, 'audit_artifact.mjs'), dist])}`);
  notes.push(`node audit (zip):  ${run('node', [join(skill, 'audit_artifact.mjs'), zipPath])}`);
}
try {
  execFileSync('python3', ['--version']);
  notes.push(`python audit (zip): ${run('python3', [join(skill, 'audit_artifact.py'), zipPath])}`);
} catch { notes.push('python audit: python3 not available'); }
const size = statSync(zipPath).size;
console.log(`checks: ${files.length} files, all allowed types; classic script; no forbidden capabilities or external resources`);
for (const n of notes) console.log(n.replace(/\n/g, ' | '));
console.log(`zip: ${relative(root, zipPath)} (${(size / 1024 / 1024).toFixed(2)} MiB)`);
process.exit(errors.length ? 1 : 0);
