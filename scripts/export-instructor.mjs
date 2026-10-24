import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Run with: [AVATAR=robot|croc|gentleman] npx @iwsdk/cli browser run scripts/export-instructor.mjs
// Export the deterministic bind-pose prototype, never the live lesson instance.
const AVATARS = {
  instructor: ['/src/scene-assets/instructor.scene-asset.ts', 'instructor'],
  robot: ['/src/scene-assets/robot.scene-asset.ts', 'robot'],
  croc: ['/src/scene-assets/croc.scene-asset.ts', 'croc'],
  gentleman: ['/src/scene-assets/gentleman.scene-asset.ts', 'gentleman'],
};
export default async function ({ frame, workspaceRoot }) {
  const id = process.env.AVATAR || 'instructor';
  const [modulePath, exportName] = AVATARS[id];
  const source = await frame.evaluate(async ([modulePath, exportName]) => {
    const instructor = (await import(modulePath))[exportName];
    const source = instructor.toJSON(), geometry = new Map(), material = new Map();
    instructor.traverse(object => {
      if (!object.isMesh) return;
      const original = object.geometry;
      if (!geometry.has(original.uuid)) {
        const copy = original.index ? original.toNonIndexed() : original.clone();
        if (object.material.flatShading) copy.computeVertexNormals();
        geometry.set(original.uuid, {
          uuid: original.uuid,
          attributes: Object.fromEntries(Object.entries(copy.attributes).map(([name, a]) => [name, { itemSize: a.itemSize, array: Array.from(a.array) }])),
        });
        copy.dispose();
      }
      const m = object.material;
      material.set(m.uuid, { uuid: m.uuid, color: m.color.toArray(), emissive: m.emissive.toArray().map(v => v * m.emissiveIntensity), roughness: m.roughness, metalness: m.metalness, doubleSided: m.side === 2 });
    });
    source.geometries = [...geometry.values()]; source.materials = [...material.values()];
    return source;
  }, [modulePath, exportName]);
  await writeFile(resolve(workspaceRoot, `.local/${id}-bind.json`), JSON.stringify(source));
  return { exported: `.local/${id}-bind.json`, geometries: source.geometries.length, skeletons: source.skeletons?.length ?? 0 };
}
