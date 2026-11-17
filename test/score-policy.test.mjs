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

// The whole publish path, publishRunIfBest, against a fake outbox: the query
// for the player's own score event, the decision, and the publish call.
import { publishRunIfBest } from '../src/score-policy.ts';

function fakeBoard(queryResult) {
  const calls = { queries: [], published: [] };
  const board = {
    outbox: {
      async query(filter, options) {
        calls.queries.push({ filter, options });
        if (queryResult instanceof Error) throw queryResult;
        return queryResult;
      },
      async publish(event, options) {
        calls.published.push({ event, options });
        return board.publishResult ?? { ok: true };
      },
    },
    kind: 30078,
    dTag: 'breakoutlet/high-score/v1',
    relays: ['wss://relay.test'],
    bestOf: (events, pubkey) => Math.max(0, ...events.filter((e) => e.pubkey === pubkey).map((e) => e.score)),
  };
  return { board, calls };
}

const run = { score: 100, level: 2, bricks: 30 };

test('an incomplete, failed or broken board query publishes nothing', async () => {
  for (const answer of [{ events: [], incomplete: true }, { events: [], error: 'relay down' }, new Error('offline')]) {
    const { board, calls } = fakeBoard(answer);
    assert.deepEqual(await publishRunIfBest(board, 'pk', run, 1), { status: 'unconfirmed' });
    assert.equal(calls.published.length, 0);
  }
});

test('a run below the confirmed best is not published over it', async () => {
  const { board, calls } = fakeBoard({ events: [{ pubkey: 'pk', score: 5000 }] });
  assert.deepEqual(await publishRunIfBest(board, 'pk', run, 1), { status: 'kept', best: 5000 });
  assert.equal(calls.published.length, 0);
  assert.deepEqual(calls.queries[0].filter, { kinds: [30078], authors: ['pk'], '#d': ['breakoutlet/high-score/v1'], limit: 10 });
});

test('a run that beats the confirmed best is published with its own values', async () => {
  const { board, calls } = fakeBoard({ events: [{ pubkey: 'pk', score: 50 }] });
  assert.deepEqual(await publishRunIfBest(board, 'pk', run, 1234), { status: 'published', score: 100 });
  const { event, options } = calls.published[0];
  assert.deepEqual(JSON.parse(event.content), { version: 1, score: 100, level: 2, bricks: 30, playedAt: 1234 });
  assert.deepEqual(event.tags[0], ['d', 'breakoutlet/high-score/v1']);
  assert.deepEqual(options, { relays: ['wss://relay.test'] });
});

test('a refused publish is reported as failed', async () => {
  const { board } = fakeBoard({ events: [] });
  board.publishResult = { ok: false, error: 'rate limited' };
  assert.deepEqual(await publishRunIfBest(board, 'pk', run, 1), { status: 'failed', score: 100 });
});
