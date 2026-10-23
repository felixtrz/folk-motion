import { AssetType, defineAssets } from '@iwsdk/core';
import { studio } from './scene-assets/studio.scene-asset.js';
import {
  beerBottle, bubbleTea, bun, coffeeCup, football, goldMedal, redEnvelope, redFlower, shuttlecock, slipper, sodaCan, waterBalloon,
} from './scene-assets/props.scene-asset.js';
export default defineAssets({
  'pose-guide': { url: `${import.meta.env.BASE_URL}characters/instructor.glb`, type: AssetType.GLTF, name: 'Low-poly folk instructor' },
  'avatar-robot': { url: `${import.meta.env.BASE_URL}characters/robot.glb`, type: AssetType.GLTF, name: 'Humanoid robot avatar' },
  'avatar-croc': { url: `${import.meta.env.BASE_URL}characters/croc.glb`, type: AssetType.GLTF, name: 'Crocodile costume avatar' },
  studio,
  'prop-soda-can': sodaCan,
  'prop-shuttlecock': shuttlecock,
  'prop-water-balloon': waterBalloon,
  'prop-red-flower': redFlower,
  'prop-beer-bottle': beerBottle,
  'prop-slipper': slipper,
  'prop-football': football,
  'prop-bun': bun,
  'prop-coffee-cup': coffeeCup,
  'prop-bubble-tea': bubbleTea,
  'prop-gold-medal': goldMedal,
  'prop-red-envelope': redEnvelope,
  'lesson-panel': {url:`${import.meta.env.BASE_URL}ui/lesson.uikitml`,type:AssetType.UIKitML,name:'Lesson controls'},
});
