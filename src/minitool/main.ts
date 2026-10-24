/**
 * Xiaohongshu mini-tool runtime: the field trial on plain Three.js, offline. No IWSDK runtime
 * (its workers, WebAssembly, dynamic imports and WebXR are not allowed in the container); the
 * scene that the website loads from public/scenes is rebuilt here in code, the characters come
 * from their procedural source modules and the motion is bundled into the script.
 */
import {
  Color, DirectionalLight, Group, HemisphereLight, MathUtils, Object3D, PerspectiveCamera, PMREMGenerator, Scene,
  SRGBColorSpace, WebGLRenderer,
} from '@iwsdk/core';
import { TrialStage } from '../stage.js';
import { MOVES } from '../motion.js';
import { instructor } from '../scene-assets/instructor.scene-asset.js';
import { robot } from '../scene-assets/robot.scene-asset.js';
import { croc } from '../scene-assets/croc.scene-asset.js';
import { gentleman } from '../scene-assets/gentleman.scene-asset.js';
import { studio } from '../scene-assets/studio.scene-asset.js';
import { GradientEnvironment } from './gradient-environment.js';
import flashStep from '../../public/motion/flash-step.json';
import ballKick from '../../public/motion/ball-kick.json';
import bearShake from '../../public/motion/bear-shake.json';
import headShake from '../../public/motion/head-shake.json';

const MOTION: Record<string, unknown> = { 'flash-step': flashStep, 'ball-kick': ballKick, 'bear-shake': bearShake, 'head-shake': headShake };
const STAGE_AT = [0.7, 0, -2.8] as const;
// WebGL budget for mobile WebViews: pixel ratio at most 1.5 (1 on the low tier), drawing
// buffer at most ~2 M pixels (~1 M on the low tier).
const TIERS = [{ dpr: 1.5, pixels: 2e6 }, { dpr: 1, pixels: 1e6 }];
// Promo captures (?review=1) render at the video's full resolution.
const REVIEW = /[?&]review=1/.test(location.search);
if (REVIEW) TIERS[0].dpr = 3;

const container = document.getElementById('scene-container') as HTMLDivElement;

function fallback(title: string, detail: string): void {
  const div = document.createElement('div');
  div.className = 'fallback';
  div.innerHTML = `<b>${title}</b><span>${detail}</span>`;
  document.body.appendChild(div);
}

function createRenderer(): WebGLRenderer | null {
  try {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return null;
    const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'default' });
    renderer.outputColorSpace = SRGBColorSpace;
    return renderer;
  } catch {
    return null;
  }
}

function start(): void {
  const renderer = createRenderer();
  if (!renderer) { fallback('民间舞动作研究所', '当前设备不支持 3D 显示。<br>请更新小红书 App 或换一台设备再试。'); return; }
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, .1, 200);
  const player = new Group(); player.name = 'Player';
  player.add(camera); scene.add(player);
  const named = new Map<string, Object3D>();
  const place = (name: string, object: Object3D) => {
    const holder = new Group(); holder.name = name; holder.position.set(...STAGE_AT);
    holder.add(object); scene.add(holder); named.set(name, holder);
  };
  place('Instructor', instructor); place('Robot', robot); place('Croc', croc); place('Gentleman', gentleman);
  scene.add(studio); studio.position.set(...STAGE_AT); named.set('PracticeStage', studio);

  // Lights and gradient environment, as authored in public/scenes/main.iwsdk.scene.json.
  const directional = (name: string, color: number[], intensity: number, position: number[], degrees: number[]) => {
    const pivot = new Group(); pivot.name = name;
    pivot.position.fromArray(position);
    pivot.rotation.set(MathUtils.degToRad(degrees[0]), MathUtils.degToRad(degrees[1]), MathUtils.degToRad(degrees[2]));
    const light = new DirectionalLight(new Color(color[0], color[1], color[2]), intensity);
    const target = new Object3D(); target.position.set(0, 0, -1);
    pivot.add(light, target); light.target = target;
    scene.add(pivot); named.set(name, pivot);
  };
  directional('KeyLight', [1, .99, .97], 1.5, [-.3, 6.5, -1.3], [-80, -10, 0]);
  directional('RimLight', [.92, .95, 1], 2.4, [.7, 3.5, -6.5], [-30, 180, 0]);
  scene.add(new HemisphereLight(new Color(1, 1, 1), new Color(.82, .82, .8), .9));
  const pmrem = new PMREMGenerator(renderer);
  const hex = (c: number[]) => new Color(c[0], c[1], c[2]).getHex();
  const gradient = new GradientEnvironment(hex([1, 1, 1]), hex([.93, .93, .92]), hex([.7, .7, .69]), .7);
  scene.environment = pmrem.fromScene(gradient).texture;
  scene.environmentIntensity = .7;
  gradient.dispose(); pmrem.dispose();

  let tier = 0;
  const resize = () => {
    const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
    const { dpr, pixels } = TIERS[tier];
    const ratio = Math.max(.5, Math.min(window.devicePixelRatio || 1, dpr, Math.sqrt(pixels / Math.max(1, w * h))));
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  resize();

  const stage = new TrialStage({
    renderer, scene, camera, player,
    object: name => { const o = named.get(name); if (!o) throw new Error(`Missing ${name}`); return o; },
    add: object => { scene.add(object); },
    loadMotions: () => Promise.resolve(MOVES.map(move => MOTION[move.id])),
    maxPixelRatio: TIERS[tier].dpr,
    music: true,
  });
  resize();
  window.addEventListener('resize', resize);

  // Frame loop: paused while hidden; steps down a tier if frames stay slow.
  let last = 0, running = false, slow = 0, frames = 0;
  const frame = (now: number) => {
    const dt = last ? Math.min(.1, (now - last) / 1000) : 1 / 60;
    last = now;
    stage.update(dt);
    renderer.render(scene, camera);
    // Sustained frames slower than ~28 fps: lower the resolution and the shadow refresh.
    frames++;
    slow = dt > 1 / 28 ? slow + 1 : Math.max(0, slow - 1);
    if (!REVIEW && tier === 0 && frames > 90 && slow > 45) { tier = 1; stage.setLowPower(true); resize(); }
  };
  const run = (on: boolean) => {
    if (on === running) return;
    running = on; last = 0;
    renderer.setAnimationLoop(on ? frame : null);
  };
  document.addEventListener('visibilitychange', () => run(document.visibilityState === 'visible'));
  const canvas = renderer.domElement;
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); run(false);
    fallback('画面暂时中断', '3D 画面被系统回收了。<br>请关闭小工具后重新打开。');
  }, false);
  run(document.visibilityState !== 'hidden');
}

start();
