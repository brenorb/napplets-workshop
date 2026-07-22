# Breakoutlet

Breakoutlet is a single-file NIP-5D napplet: a responsive Breakout game with a
global, signed Nostr high-score board.

## Play

- Move the paddle with pointer movement, the on-screen arrows, or left/right
  arrows and A/D while the canvas is focused.
- Launch, pause, or resume with the main button. Space and Enter work while the
  canvas is focused.
- A connected identity automatically publishes only a new personal best.
- The game remains playable when optional identity or storage domains are absent;
  the leaderboard requires the manifest-declared `outbox` domain.

## Global score protocol

Each player publishes one NIP-78 parameterized replaceable event:

- kind: `30078`
- `d` tag: `breakoutlet/high-score/v1`
- content: `{ "version": 1, "score": number, "level": number, "bricks": number, "playedAt": unixSeconds }`
- relay hint: `wss://nos.lol`

Reads and publishes use `@napplet/sdk`'s OUTBOX helpers. The shell owns signing,
relay policy, validation, deduplication, and network access. Local best-score
persistence uses optional NAP-STORAGE. Whole-surface colors follow optional
NAP-THEME with an explicit fallback palette.

## Develop and verify

```bash
pnpm install
pnpm verify
pnpm test:conformance
```

For a shell-backed preview:

```bash
napplet paja -- pnpm vite --host 127.0.0.1
```

The production build is one self-contained `dist/index.html`; it has no runtime
assets outside that file.
