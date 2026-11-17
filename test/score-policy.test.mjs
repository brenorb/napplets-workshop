// HighScore.tla BoardKeepsBest, replayed on the real publish rule. Node runs
// the TypeScript module directly by stripping its types.
import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldPublishScore } from '../src/score-policy.ts';

test('a run is not published when the board cannot confirm the best', () => {
  // The old rule compared with globalPersonalBest, which stays 0 when the
  // leaderboard fails, so a run of 100 replaced a published 5,000.
  assert.equal(shouldPublishScore(100, null), false);
});

test('a run is published only when it beats the confirmed best', () => {
  assert.equal(shouldPublishScore(100, 5000), false);
  assert.equal(shouldPublishScore(5000, 5000), false);
  assert.equal(shouldPublishScore(5001, 5000), true);
  assert.equal(shouldPublishScore(1, 0), true);
});
