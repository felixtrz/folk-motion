import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, SkinnedMesh, Skeleton, MeshStandardMaterial } from '@iwsdk/core';
import { LoftSurface } from './hardsurface.js';

export type Section = { y: number; w: number; d: number; x?: number; front?: number };
/** Faceted continuous profiles, with thickness transitions authored before detail. */
export function profile(sections: Section[], segments = 10): BufferGeometry {
  const loft = LoftSurface.tube(sections.map(s => ({ z: s.y, halfW: s.w, hUp: s.d, hDown: s.front ?? s.d, cx: s.x ?? 0, power: 2 })));
  return loft.build(sections.map(s => s.y), segments, true).rotateX(-Math.PI / 2);
}

export function skin(geometry: BufferGeometry, name: string, material: MeshStandardMaterial, skeleton: Skeleton, weight: (x: number, y: number, z: number) => [number, number, number]): SkinnedMesh {
  const indices: number[] = [], weights: number[] = [], points = geometry.getAttribute('position');
  for (let i = 0; i < points.count; i++) {
    const [a, b, blend] = weight(points.getX(i), points.getY(i), points.getZ(i));
    indices.push(a, b, 0, 0); weights.push(1 - blend, blend, 0, 0);
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  const mesh = new SkinnedMesh(geometry, material); mesh.name = name;
  mesh.frustumCulled = false; mesh.bind(skeleton); mesh.castShadow = false;
  return mesh;
}

export function rigidWeight(bone: number): (x: number, y: number, z: number) => [number, number, number] {
  return () => [bone, bone, 0];
}

export function limbWeight(x: number, y: number, dx: number, dy: number, upper: number, lower: number, end: number, lengthA: number, lengthB: number) {
  return (px: number, py: number): [number, number, number] => {
    const along = (px - x) * dx + (py - y) * dy;
    const wrist = lengthA + lengthB;
    if (along > wrist - .025) return [lower, end, Math.max(0, Math.min(1, (along - wrist + .025) / .05))];
    return [upper, lower, Math.max(0, Math.min(1, (along - lengthA + .055) / .11))];
  };
}
