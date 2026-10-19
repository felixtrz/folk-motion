import { CircleGeometry, Group, Mesh, MeshBasicMaterial, ShadowMaterial } from '@iwsdk/core';

// White photographic studio floor. Origin at floor centre; +Y up; contact plane y=0;
// envelope: 28 m disc. The floor is unlit paper colour so it is indistinguishable
// from the background (an infinite cove); a transparent catcher above it carries only
// the instructor's soft shadow.
export const STUDIO_PAPER = 0xf6f5f2;
export const studio = new Group();
studio.name = 'PracticeStage';
const disc = new CircleGeometry(14, 96).rotateX(-Math.PI / 2);
const floor = new Mesh(disc, new MeshBasicMaterial({ color: STUDIO_PAPER }));
floor.name = 'StudioFloor';
studio.add(floor);
const catcher = new Mesh(disc, new ShadowMaterial({ color: 0x141413, opacity: .34 }));
catcher.name = 'ShadowCatcher';
catcher.position.y = .001;
catcher.receiveShadow = true;
studio.add(catcher);
