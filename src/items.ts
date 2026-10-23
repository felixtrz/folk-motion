import type { Object3D } from '@iwsdk/core';
import {
  beerBottle, bubbleTea, bun, coffeeCup, football, goldMedal, redEnvelope, redFlower, shuttlecock, slipper, sodaCan, waterBalloon,
} from './scene-assets/props.scene-asset.js';

/** The four responses; each tray slot holds a family of things that provoke one of them. */
export type Kind = 'can' | 'shuttle' | 'balloon' | 'flower';
export type ItemId = 'soda' | 'beer' | 'slipper' | 'shuttle' | 'football' | 'bun' | 'balloon' | 'coffee' | 'boba' | 'flower' | 'medal' | 'hongbao';
export type LandCue = 'clank' | 'clink' | 'thud' | 'kick';

export type Item = {
  id: ItemId; kind: Kind; proto: Object3D;
  rest: number;                    // centre height when lying on the floor
  spin: [number, number, number] | null;   // flight spin (rad/s); null = random tumble
  bounce: number;                  // restitution off the floor
  land: LandCue;
  pool: number;                    // instances (pinned things accumulate)
  trail?: boolean;                 // flies base first, feathers trailing (shuttlecock)
  splash?: { color: number; pearls?: boolean; shell?: boolean };   // soaks: liquid, and does the container survive
};

export const ITEMS: Record<ItemId, Item> = {
  soda: { id: 'soda', kind: 'can', proto: sodaCan, rest: .053, spin: null, bounce: .35, land: 'clank', pool: 2 },
  beer: { id: 'beer', kind: 'can', proto: beerBottle, rest: .058, spin: [0, 0, 16], bounce: .25, land: 'clink', pool: 2 },
  slipper: { id: 'slipper', kind: 'can', proto: slipper, rest: .03, spin: [0, 22, 0], bounce: .2, land: 'thud', pool: 2 },
  shuttle: { id: 'shuttle', kind: 'shuttle', proto: shuttlecock, rest: .036, spin: [0, 12, 0], bounce: .2, land: 'kick', pool: 2, trail: true },
  football: { id: 'football', kind: 'shuttle', proto: football, rest: .15, spin: [6, 0, 3], bounce: .55, land: 'thud', pool: 2 },
  bun: { id: 'bun', kind: 'shuttle', proto: bun, rest: .03, spin: [7, 0, 5], bounce: .15, land: 'thud', pool: 2 },
  balloon: { id: 'balloon', kind: 'balloon', proto: waterBalloon, rest: .08, spin: null, bounce: .2, land: 'thud', pool: 2, splash: { color: 0x6fb8f2 } },
  coffee: { id: 'coffee', kind: 'balloon', proto: coffeeCup, rest: .06, spin: [5, 0, 9], bounce: .3, land: 'thud', pool: 2, splash: { color: 0x5b3a22, shell: true } },
  boba: { id: 'boba', kind: 'balloon', proto: bubbleTea, rest: .06, spin: [4, 0, 8], bounce: .3, land: 'thud', pool: 2, splash: { color: 0xd2ab82, pearls: true, shell: true } },
  flower: { id: 'flower', kind: 'flower', proto: redFlower, rest: .01, spin: [0, 0, 9], bounce: .2, land: 'thud', pool: 4 },
  medal: { id: 'medal', kind: 'flower', proto: goldMedal, rest: .006, spin: [0, 0, 7], bounce: .2, land: 'clink', pool: 3 },
  hongbao: { id: 'hongbao', kind: 'flower', proto: redEnvelope, rest: .005, spin: [0, 0, 6], bounce: .1, land: 'thud', pool: 3 },
};

/** Tray slots, each a rotation: the card flips to the next item after every throw. */
export const SLOTS: ItemId[][] = [
  ['soda', 'beer', 'slipper'],
  ['shuttle', 'football', 'bun'],
  ['balloon', 'coffee', 'boba'],
  ['flower', 'medal', 'hongbao'],
];
