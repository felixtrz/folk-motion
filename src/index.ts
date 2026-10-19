import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { LessonSystem } from './lesson.js';
import { SpecimenViewer } from './specimen-viewer.js';
World.create(document.getElementById('scene-container') as HTMLDivElement,projectOptions)
  .then(world => world.registerSystem(LessonSystem).registerSystem(SpecimenViewer))
  .catch(error => {console.error(error);document.getElementById('scene-container')!.textContent='Unable to open the studio. Reload to retry.';});
