/**
 * Feature switches. The mini-tool's review rejects builds after 1.0.1 ("buttons not clickable")
 * without saying which; features are switched back on one group at a time to find it.
 */
export const FEATURES = {
  // The lab report: the score-row button, per-reaction shots, the multi-card sheet.
  // Round 2: back on, with snapshots rendered off-screen (the visible canvas is never resized)
  // and the sheet answering at once.
  report: true,
};
