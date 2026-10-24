import { BackSide, Color, Mesh, Scene, ShaderMaterial, SphereGeometry } from '@iwsdk/core';

/**
 * Sky/equator/ground gradient sphere for PMREM lighting: the same shader IWSDK uses for its
 * IBLGradient, so the mini-tool is lit exactly like the website.
 */
export class GradientEnvironment extends Scene {
  constructor(sky: number, equator: number, ground: number, intensity: number) {
    super();
    const material = new ShaderMaterial({
      uniforms: {
        skyColor: { value: new Color(sky).multiplyScalar(intensity) },
        equatorColor: { value: new Color(equator).multiplyScalar(intensity) },
        groundColor: { value: new Color(ground).multiplyScalar(intensity) },
      },
      vertexShader: `
        varying vec3 vWorldDirection;
        void main() {
          vec3 worldDirection = mat3(modelMatrix) * position;
          vWorldDirection = worldDirection;
          vec4 clipPosition = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(worldDirection, 1.0);
          gl_Position = clipPosition.xyww;
        }`,
      fragmentShader: `
        uniform vec3 skyColor;
        uniform vec3 equatorColor;
        uniform vec3 groundColor;
        varying vec3 vWorldDirection;
        void main() {
          float h = normalize(vWorldDirection).y;
          vec3 color = h > 0.0 ? mix(equatorColor, skyColor, h) : mix(equatorColor, groundColor, -h);
          gl_FragColor = vec4(color, 1.0);
        }`,
      side: BackSide, depthWrite: false, depthTest: false,
    });
    this.add(new Mesh(new SphereGeometry(100, 32, 15), material));
  }
  dispose(): void {
    this.traverse(o => { const m = o as Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as ShaderMaterial).dispose(); } });
  }
}
