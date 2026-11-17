# High-score verification

| Skill | What it checks | Tool |
| --- | --- | --- |
| [verify-high-score](../../.claude/skills/verify-high-score/SKILL.md) | A published high score is never replaced by a lower one | TLA+ / TLC, 11 states |

The model found that a failed, partial or truncated leaderboard query let a low run replace the player's published best, since kind 30078 scores are addressable. The game now reads the player's own score event before publishing.

## Play a run of Breakoutlet

Generated with pstack `/statechart` from [Play.tla](flows/play-breakoutlet/Play.tla) ([TLC report](flows/play-breakoutlet/report.md)).

```mermaid
---
title: "Play a run of Breakoutlet"
---
stateDiagram-v2
  s0: Ball ready to launch
  s1: Ball in play
  s2: Run over, checking the board
  s3: Paused
  s4: Run complete, board unchanged
  s5: New best published
  [*] --> s0
  s0 --> s1: you launch
  s1 --> s0: you clear the wall or lose a ball
  s1 --> s2: you lose the last ball
  s1 --> s3: you pause
  s2 --> s4: it does not, or the board cannot confirm your best
  s2 --> s5: the run beats your published best
  s3 --> s1: you resume
  s4 --> s0: you start a new run
  s5 --> s0: you start a new run
```
