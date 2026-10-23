import { AssetType, defineAssets } from '@iwsdk/core';
import { studio } from './scene-assets/studio.scene-asset.js';
import { redFlower, shuttlecock, sodaCan, waterBalloon } from './scene-assets/props.scene-asset.js';
export default defineAssets({
  'pose-guide': { url: `${import.meta.env.BASE_URL}characters/instructor.glb`, type: AssetType.GLTF, name: 'Low-poly folk instructor' },
  'avatar-robot': { url: `${import.meta.env.BASE_URL}characters/robot.glb`, type: AssetType.GLTF, name: 'Humanoid robot avatar' },
  'avatar-croc': { url: `${import.meta.env.BASE_URL}characters/croc.glb`, type: AssetType.GLTF, name: 'Crocodile costume avatar' },
  studio,
  'prop-soda-can': sodaCan,
  'prop-shuttlecock': shuttlecock,
  'prop-water-balloon': waterBalloon,
  'prop-red-flower': redFlower,
  'lesson-panel': {url:`${import.meta.env.BASE_URL}ui/lesson.uikitml`,type:AssetType.UIKitML,name:'Lesson controls'},
});
