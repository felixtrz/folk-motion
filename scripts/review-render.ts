// Dev-only: imported into the managed browser by scripts/render-review.mjs.
// Renders the real skinned instructor, posed by the same InstructorRig the app uses,
// from a camera roughly matching the source footage and from a three-quarter view.
import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Mesh, CircleGeometry,
  MeshStandardMaterial, Color, Vector3, GridHelper, SRGBColorSpace,
} from '@iwsdk/core';
import { instructor } from '../src/scene-assets/instructor.scene-asset.ts';
import { InstructorRig } from '../src/instructor-rig.ts';
import { validateMotion, type Motion } from '../src/motion.ts';

const W = 480, H = 360;
let renderer: WebGLRenderer, scene: Scene, front: PerspectiveCamera, side: PerspectiveCamera, rig: InstructorRig, motion: Motion;
const points = Array.from({ length: 33 }, () => new Vector3());
const confidence = new Float32Array(33);

export async function setup(id: string, pitch: number): Promise<number> {
  if (!renderer) {
    const canvas = document.createElement('canvas');
    renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(1);
    renderer.setSize(W * 2, H, false);
    renderer.setScissorTest(true);
    scene = new Scene();
    scene.background = new Color(0x1d2b30);
    scene.add(new HemisphereLight(0xdfeeee, 0x30383a, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.8); sun.position.set(2, 4, 3); scene.add(sun);
    const floor = new Mesh(new CircleGeometry(2.2, 48), new MeshStandardMaterial({ color: 0x3d5357, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const grid = new GridHelper(4.4, 22, 0x7fa9a5, 0x58706f); grid.position.y = .002; scene.add(grid);
    scene.add(instructor);
    rig = new InstructorRig(instructor);
    front = new PerspectiveCamera(24, W / H, .1, 50);
    side = new PerspectiveCamera(30, W / H, .1, 50);
  }
  const response = await fetch(`/motion/${id}.json`);
  motion = validateMotion(await response.json());
  // Same downward tilt as the stage camera, so the front view lines up with the footage.
  const d = 7.5;
  front.position.set(0, .9 + d * Math.tan(pitch), d); front.lookAt(0, .9, 0);
  side.position.set(4.2, 1.7, 3.6); side.lookAt(0, .85, 0);
  return motion.frameCount;
}

export function render(from: number, to: number): string[] {
  const out: string[] = [];
  for (let n = from; n < Math.min(to, motion.frameCount); n++) {
    rig.apply(motion, n / motion.fps, true, points, confidence);
    instructor.updateMatrixWorld(true);
    renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H); renderer.render(scene, front);
    renderer.setViewport(W, 0, W, H); renderer.setScissor(W, 0, W, H); renderer.render(scene, side);
    out.push(renderer.domElement.toDataURL('image/jpeg', .9));
  }
  return out;
}
