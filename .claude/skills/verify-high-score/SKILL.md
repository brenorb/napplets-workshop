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
npm test
```

The model must pass (11 distinct states). The `--mutant` run replays the code before commit 302ea03 and must report `BoardKeepsBest` violated. The path: the leaderboard did not return the player's 3, a run of 1 beats the assumed 0, and the publish replaces 3. Read every TLC result with the pstack `/statechart` skill.

`npm test` replays that path through `publishRunIfBest` in `src/score-policy.ts`, which `publishHighScore` calls, with a fake outbox. It covers the player's own score query, the decision, and the publish call. Treating an unconfirmed best as 0 makes it fail.

## Coverage

Synced with the code at commit `302ea03`. Move this forward only after you confirm that the model still describes the code at the new commit.

| Model step | Code (`src/main.ts`) |
| --- | --- |
| `LoadBoard` | `loadLeaderboard` → `globalPersonalBest` |
| `EndRun` | `finishRun` → `publishHighScore` |
| `CheckOwn` | `fetchPublishedBest` in `score-policy.ts` (own event; `null` on error or partial result), then `shouldPublishScore` |
| `Publish` | `publishRunIfBest` → `outbox.publish`, rendered by `publishHighScore` |

## Not covered

Two devices publishing for one player at once (the later publish wins), the local best in napplet storage, and signature checks, which the shell performs.
