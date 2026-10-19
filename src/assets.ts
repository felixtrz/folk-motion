import { AssetType, defineAssets } from '@iwsdk/core';
import { studio } from './scene-assets/studio.scene-asset.js';
export default defineAssets({
  'pose-guide': { url: `${import.meta.env.BASE_URL}characters/instructor.glb`, type: AssetType.GLTF, name: 'Low-poly folk instructor' },
  'avatar-robot': { url: `${import.meta.env.BASE_URL}characters/robot.glb`, type: AssetType.GLTF, name: 'Humanoid robot avatar' },
  'avatar-croc': { url: `${import.meta.env.BASE_URL}characters/croc.glb`, type: AssetType.GLTF, name: 'Crocodile costume avatar' },
  studio,
  'lesson-panel': {url:`${import.meta.env.BASE_URL}ui/lesson.uikitml`,type:AssetType.UIKitML,name:'Lesson controls'},
});
