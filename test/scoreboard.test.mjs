import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import ts from 'typescript';

const author = '1'.repeat(64);
const otherAuthor = '2'.repeat(64);
const scoreTag = 'breakoutlet/high-score/v1';
const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
// Reach the actual last-ball and restart handlers without simulating a full game.
const appModule = ts.transpileModule(`${source}
  export function connect(pubkey) {
    runtime.napplet = { outbox: {}, storage: {}, identity: {} };
    currentPubkey = pubkey;
  }
  export function loseLastBall(finalScore, localBest) {
    resetRun();
    phase = 'running';
    score = finalScore;
    bestScore = localBest;
    level = 2;
    bricksBroken = 12;
    lives = 1;
    ball.y = GAME_HEIGHT + 2 * ball.radius;
    updateGame(0);
  }
  export { launchBall, loadLeaderboard };
`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function event(score) {
  return {
    pubkey: author,
    kind: 30078,
    tags: [['d', scoreTag]],
    created_at: 1000,
    content: JSON.stringify({ version: 1, score, level: 2, bricks: 10, playedAt: 1000 }),
  };
}

function makeElement() {
  return {
    getContext() { return {}; },
    classList: { add() {}, remove() {} },
    append() {},
    replaceChildren() {},
  };
}

async function setup({ read = () => ({ events: [] }), save = () => {}, publish = () => ({ ok: true }) } = {}) {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, makeElement());
      return elements.get(selector);
    },
    createElement: makeElement,
  };
  const context = createContext({ document, window: { addEventListener() {} } });
  const queries = [];
  const published = [];
  let signer = author;
  const sdk = {
    identity: { async getPublicKey() { return signer; } },
    storage: { async setItem(key, value) { return save(key, value); } },
    outbox: {
      async query(filters) { queries.push(filters); return read(filters); },
      async publish(template) {
        const record = { ...JSON.parse(template.content), signer };
        published.push(record);
        return publish(record);
      },
    },
    themeGet() {},
    themeOnChanged() {},
  };
  const sdkModule = new SyntheticModule(Object.keys(sdk), function () {
    for (const [key, value] of Object.entries(sdk)) this.setExport(key, value);
  }, { context });
  const emptyModule = new SyntheticModule([], () => {}, { context });
  const app = new SourceTextModule(appModule, { context });
  await app.link(name => name === '@napplet/sdk' ? sdkModule : emptyModule);
  await app.evaluate();
  app.namespace.connect(author);
  return {
    ...app.namespace,
    elements,
    queries,
    published,
    changeSigner(pubkey) { signer = pubkey; },
  };
}

test('publishes the finished score after restarting during a pending local save', async () => {
  const save = deferred();
  const read = deferred();
  const game = await setup({
    read: filters => filters.authors ? read.promise : { events: [event(1000)] },
    save: () => save.promise,
  });
  await game.loadLeaderboard();
  game.loseLastBall(1200, 1100);
  game.launchBall();
  save.resolve();
  read.resolve({ events: [event(1000)] });
  await setImmediate();

  assert.deepEqual(game.published.map(({ score, level, bricks, signer }) => ({ score, level, bricks, signer })), [
    { score: 1200, level: 2, bricks: 12, signer: author },
  ]);
  assert.equal(game.elements.get('#messageKicker').textContent, 'Ready?');
});

for (const [description, read] of [
  ['rejected read', () => { throw new Error('offline'); }],
  ['inline query error', () => ({ events: [], error: 'offline' })],
  ['incomplete results', () => ({ events: [event(100)], incomplete: true })],
]) {
  test(`does not treat ${description} as a known personal best`, async () => {
    const game = await setup({ read });
    await game.loadLeaderboard();
    game.loseLastBall(800, 1000);
    await setImmediate();
    assert.equal(game.published.length, 0);
  });
}

test('checks the exact author and score key even when the public board has no scores', async () => {
  const game = await setup({ read: filters => ({ events: filters.authors ? [event(1000)] : [] }) });
  await game.loadLeaderboard();
  game.loseLastBall(800, 1000);
  await setImmediate();

  const personalQuery = game.queries.find(filters => filters.authors);
  assert.deepEqual(JSON.parse(JSON.stringify(personalQuery)), {
    kinds: [30078], authors: [author], '#d': [scoreTag], limit: 1,
  });
  assert.equal(game.published.length, 0);
});

test('can publish a first score after a successful empty author query', async () => {
  const game = await setup();
  game.loseLastBall(800, 800);
  await setImmediate();
  assert.ok(game.queries.some(filters => filters.authors?.[0] === author));
  assert.deepEqual(game.published.map(record => record.score), [800]);
});

test('does not publish under a new signer while the personal record is being read', async () => {
  const read = deferred();
  const game = await setup({ read: () => read.promise });
  game.loseLastBall(1200, 1200);
  await setImmediate();
  game.changeSigner(otherAuthor);
  read.resolve({ events: [event(1000)] });
  await setImmediate();
  assert.equal(game.published.length, 0);
});

test('serializes finished records and keeps a just-published best when the relay read lags', async () => {
  const firstPublish = deferred();
  const game = await setup({ publish: ({ score }) => score === 1200 ? firstPublish.promise : { ok: true } });
  game.loseLastBall(1200, 1200);
  await setImmediate();
  game.loseLastBall(800, 1200);
  game.loseLastBall(1400, 1400);
  firstPublish.resolve({ ok: true });
  await setImmediate();
  assert.deepEqual(game.published.map(record => record.score), [1200, 1400]);
});
