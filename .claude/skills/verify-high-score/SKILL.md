---
name: verify-high-score
description: Check that Breakoutlet never replaces a player's published high score with a lower one on the global Nostr board. Use when changing publishHighScore, fetchPublishedBest, finishRun, loadLeaderboard, normalizeLeaderboard, globalPersonalBest, or the SCORE_KIND and SCORE_D_TAG constants in src/main.ts.
---

# Verify the high-score board

**Property.** `BoardKeepsBest`: the relays always hold the player's best published score. Scores are kind 30078 addressable events, so any publish replaces the previous one.

**Harm if broken.** A player's best score drops from the global board because the game could not read the board before publishing.

## Run

```sh
export TLA2TOOLS=/absolute/path/to/tla2tools.jar   # TLC 1.7.4 release
export JAVA=/path/to/java                          # Java 11 or later
bash scripts/verification/check-model.sh .claude/skills/verify-high-score/model/HighScore.tla
bash scripts/verification/check-model.sh .claude/skills/verify-high-score/model/HighScore.tla --mutant
corepack pnpm type-check
```

The model must pass (11 distinct states). The `--mutant` run replays the code before commit 302ea03 and must report `BoardKeepsBest` violated. The path: the leaderboard did not return the player's 3, a run of 1 beats the assumed 0, and the publish replaces 3. Read every TLC result with the pstack `/statechart` skill.

The repository has no unit-test harness, so this path has not been replayed on the real code. To replay it by hand, run the napplet in a shell whose `outbox.query` returns `incomplete: true`, finish a low run, and check that no publish is sent.

## Coverage

Synced with the code at commit `302ea03`. Move this forward only after you confirm that the model still describes the code at the new commit.

| Model step | Code (`src/main.ts`) |
| --- | --- |
| `LoadBoard` | `loadLeaderboard` → `globalPersonalBest` |
| `EndRun` | `finishRun` |
| `CheckOwn` | `fetchPublishedBest` (own event; `null` on error or partial result) |
| `Publish` | `outbox.publish` in `publishHighScore` |

## Not covered

Two devices publishing for one player at once (the later publish wins), the local best in napplet storage, and signature checks, which the shell performs.
