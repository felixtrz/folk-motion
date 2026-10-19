import {
  Color, DoubleSide, Material, Mesh, MeshBasicMaterial, MeshDepthMaterial, Object3D, OrthographicCamera, PlaneGeometry, Scene,
  ShaderMaterial, Texture, WebGLRenderTarget, WebGLRenderer,
} from '@iwsdk/core';

const SINK = .04;
const BLUR_VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const BLUR_FRAGMENT = `
  uniform sampler2D tDiffuse; uniform vec2 step; varying vec2 vUv;
  void main() {
    vec4 sum = vec4(0.0);
    sum += texture2D(tDiffuse, vUv - 4.0 * step) * 0.051;
    sum += texture2D(tDiffuse, vUv - 3.0 * step) * 0.0918;
    sum += texture2D(tDiffuse, vUv - 2.0 * step) * 0.12245;
    sum += texture2D(tDiffuse, vUv - 1.0 * step) * 0.1531;
    sum += texture2D(tDiffuse, vUv) * 0.1633;
    sum += texture2D(tDiffuse, vUv + 1.0 * step) * 0.1531;
    sum += texture2D(tDiffuse, vUv + 2.0 * step) * 0.12245;
    sum += texture2D(tDiffuse, vUv + 3.0 * step) * 0.0918;
    sum += texture2D(tDiffuse, vUv + 4.0 * step) * 0.051;
    gl_FragColor = sum;
  }`;

/**
 * Photographic contact shadow: the subject is rendered from directly below into a
 * small target, darker the closer each surface is to the floor, blurred, and laid on
 * the floor. Smooth at any blur, unlike a filtered shadow map. Allocation-free per frame.
 */
export class ContactShadow {
  readonly plane: Mesh;
  private readonly camera: OrthographicCamera;
  private readonly target: WebGLRenderTarget;
  private readonly scratch: WebGLRenderTarget;
  private readonly depth: MeshDepthMaterial;
  private readonly blur: ShaderMaterial;
  private readonly quad: Mesh;
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly meshes: Mesh[] = [];
  private readonly materials: (Material | Material[])[] = [];
  private readonly clear = new Color();

  constructor(private subject: Object3D, size = 2.8, height = 1.4, resolution = 512,
    private readonly blurScale = 1.6, opacity = 1, exponent = 1.6) {
    this.target = new WebGLRenderTarget(resolution, resolution);
    this.scratch = new WebGLRenderTarget(resolution, resolution);
    // The camera sits just below the floor so soles resting on it are not clipped by the near plane.
    this.camera = new OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, height + SINK);
    this.camera.rotation.x = Math.PI / 2;   // look straight up from the floor
    // Depth-tested so the surface nearest the floor wins (a leg must not overwrite its sole).
    this.depth = new MeshDepthMaterial({ depthTest: true, depthWrite: true, side: DoubleSide });
    this.depth.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        `float k = 1.0 - fragCoordZ; gl_FragColor = vec4( vec3( 0.0 ), pow( k, ${exponent.toFixed(2)} ) );`);
    };
    this.blur = new ShaderMaterial({ uniforms: { tDiffuse: { value: null }, step: { value: [0, 0] } }, vertexShader: BLUR_VERTEX, fragmentShader: BLUR_FRAGMENT, depthTest: false });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.blur);
    this.quadScene.add(this.quad);
    const floor = new MeshBasicMaterial({ map: this.target.texture, transparent: true, depthWrite: false, fog: false, opacity });
    this.plane = new Mesh(new PlaneGeometry(size, size).rotateX(-Math.PI / 2), floor);
    this.plane.scale.z = -1;   // the camera looks up, so the image is mirrored front-to-back
    this.plane.name = 'ContactShadow';
    this.plane.renderOrder = 1;
    this.setSubject(subject);
  }

  /** Switch the shadow caster (allocates only on a switch, never per frame). */
  setSubject(subject: Object3D): void {
    this.subject = subject;
    this.meshes.length = 0; this.materials.length = 0;
    subject.traverse(o => { if ((o as Mesh).isMesh && o.visible) this.meshes.push(o as Mesh); });
  }

  update(renderer: WebGLRenderer, x: number, z: number, floorY = 0): void {
    this.camera.position.set(x, floorY - SINK, z);
    this.camera.updateMatrixWorld();
    this.plane.position.set(x, floorY + .0015, z);
    const previousTarget = renderer.getRenderTarget(), previousAlpha = renderer.getClearAlpha(), autoClear = renderer.autoClear;
    const xr = renderer.xr.enabled;
    renderer.getClearColor(this.clear);
    renderer.xr.enabled = false;
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    for (let i = 0; i < this.meshes.length; i++) { this.materials[i] = this.meshes[i].material; this.meshes[i].material = this.depth; }
    renderer.setRenderTarget(this.target);
    renderer.render(this.subject, this.camera);
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i].material = this.materials[i];
    const texel = 1 / this.target.width;
    for (let pass = 0; pass < 2; pass++) {
      const spread = (pass + 1) * this.blurScale * texel;
      this.blurPass(renderer, this.target.texture, this.scratch, spread, 0);
      this.blurPass(renderer, this.scratch.texture, this.target, 0, spread);
    }
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.clear, previousAlpha);
    renderer.autoClear = autoClear;
    renderer.xr.enabled = xr;
  }

  private blurPass(renderer: WebGLRenderer, source: Texture, destination: WebGLRenderTarget, dx: number, dy: number): void {
    this.blur.uniforms.tDiffuse.value = source;
    const s = this.blur.uniforms.step.value as number[]; s[0] = dx; s[1] = dy;
    renderer.setRenderTarget(destination);
    renderer.render(this.quadScene, this.quadCamera);
  }

  /** Review only: maximum and mean alpha in the shadow texture. */
  probe(renderer: WebGLRenderer): number[] {
    const w = this.target.width, px = new Uint8Array(w * w * 4);
    renderer.readRenderTargetPixels(this.target, 0, 0, w, w, px);
    let max = 0, sum = 0, n = 0;
    for (let i = 3; i < px.length; i += 4) { max = Math.max(max, px[i]); sum += px[i]; if (px[i] > 8) n++; }
    return [max, sum / (w * w), n];
  }

  dispose(): void {
    this.target.dispose(); this.scratch.dispose(); this.depth.dispose(); this.blur.dispose();
    this.quad.geometry.dispose(); this.plane.geometry.dispose(); (this.plane.material as Material).dispose();
  }
}
