/** The lab report's cover: the viewer's "throwing personality", from what the trials produced. */
export type Persona = 'dodge' | 'kick' | 'soak' | 'flatter' | 'carrot' | 'even';
export const REPORT_MIN_TRIALS = 3;

/** counts: dodged, returned, soaked, flattered. */
export function persona(counts: readonly number[]): Persona {
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const share = counts.map(n => n / total);
  const order = [0, 1, 2, 3].sort((a, b) => share[b] - share[a]);
  // Attacks (dodged or soaked) and flowers in similar measure: a slap, then a sweet.
  const harsh = share[0] + share[2];
  // Balls to kick in the mix make it a different experiment (an even spread, say).
  if (share[3] >= .25 && harsh >= .4 && share[1] <= .15 && Math.abs(share[3] - harsh) <= .35) return 'carrot';
  if (share[order[0]] >= .5) return (['dodge', 'kick', 'soak', 'flatter'] as const)[order[0]];
  if (share[order[0]] <= .4) return 'even';
  return (['dodge', 'kick', 'soak', 'flatter'] as const)[order[0]];
}
