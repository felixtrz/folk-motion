import assert from 'node:assert/strict';
import { test } from 'node:test';
import { persona } from '../src/persona.ts';

// counts: dodged, returned, soaked, flattered
test('a clear majority names the personality', () => {
  assert.equal(persona([5, 0, 1, 0]), 'dodge');
  assert.equal(persona([0, 4, 0, 1]), 'kick');
  assert.equal(persona([1, 0, 6, 0]), 'soak');
  assert.equal(persona([0, 1, 0, 5]), 'flatter');
});

test('attacks mixed with flowers are a slap then a sweet', () => {
  assert.equal(persona([3, 0, 1, 2]), 'carrot');
  assert.equal(persona([0, 0, 2, 2]), 'carrot');
});

test('an even spread is the rigorous scientist', () => {
  assert.equal(persona([1, 1, 1, 1]), 'even');
  assert.equal(persona([2, 2, 1, 1]), 'even');
});

test('no trials still yields a personality', () => {
  assert.ok(['dodge', 'kick', 'soak', 'flatter', 'carrot', 'even'].includes(persona([0, 0, 0, 0])));
});
