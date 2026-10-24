import { createSystem, type PerspectiveCamera } from '@iwsdk/core';
import { MOVES } from './motion.js';
import { TrialStage } from './stage.js';

/**
 * Website runtime for the field trial: hands IWSDK's world to the stage (src/stage.ts),
 * which the Xiaohongshu mini-tool also runs on plain Three.js (src/minitool/main.ts).
 */
export class SpecimenViewer extends createSystem({}) {
  private stage!: TrialStage;

  init(): void {
    const world = this.world;
    this.stage = new TrialStage({
      renderer: world.renderer,
      scene: world.scene,
      camera: world.camera as PerspectiveCamera,
      player: world.player,
      object: name => world.requireSceneObject(name),
      add: object => { world.createTransformEntity(object); },
      loadMotions: () => Promise.all(MOVES.map(async move => {
        const response = await fetch(`${import.meta.env.BASE_URL}motion/${move.id}.json`);
        if (!response.ok) throw new Error(`Missing motion: ${move.id}`);
        return response.json() as Promise<unknown>;
      })),
      xr: {
        presenting: () => world.renderer.xr.isPresenting,
        supported: () => navigator.xr?.isSessionSupported('immersive-vr') ?? Promise.resolve(false),
        launch: () => world.launchXR(),
        panel: world.requireSceneObject('LessonControls'),
      },
    });
    this.cleanupFuncs.push(() => this.stage.dispose());
  }

  update(delta: number): void { this.stage.update(delta); }
}
