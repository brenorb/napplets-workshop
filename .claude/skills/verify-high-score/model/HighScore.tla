----------------------------- MODULE HighScore -----------------------------
\* Breakoutlet's global board for one player (src/main.ts). The relays hold
\* one kind 30078 score event per player; a publish replaces it.
\*   LoadBoard     -> loadLeaderboard: may succeed, fail, or miss the player
\*                    (partial result, or not in the first 100 events)
\*   EndRun(s)     -> finishRun with score s
\*   CheckOwn      -> fetchPublishedBest: the player's own event, or unknown
\*   Publish       -> outbox.publish of the run's payload
\* Broken = TRUE is the code before the fix: publish whenever the run beat
\* globalPersonalBest, with no check of the player's own event.
EXTENDS Naturals

CONSTANT Broken

Scores == {1, 2, 3}

VARIABLES board, known, run, pc, maxPublished

vars == <<board, known, run, pc, maxPublished>>

\* The player already has 3 on the board from an earlier session.
Init == board = 3 /\ known = 0 /\ run = 0 /\ pc = "idle" /\ maxPublished = 3

LoadBoard ==
  /\ pc = "idle"
  /\ known' \in {board, 0}       \* 0: query failed, partial, or player missing
  /\ UNCHANGED <<board, run, pc, maxPublished>>

EndRun ==
  /\ pc = "idle"
  /\ \E s \in Scores : run' = s
  /\ pc' = IF run' > known THEN "checking" ELSE "idle"
  /\ UNCHANGED <<board, known, maxPublished>>

CheckOwn ==
  /\ pc = "checking"
  /\ IF Broken THEN pc' = "publishing"
     ELSE \E answered \in BOOLEAN :   \* FALSE: error or partial result
            pc' = IF answered /\ run > board THEN "publishing" ELSE "idle"
  /\ UNCHANGED <<board, known, run, maxPublished>>

Publish ==
  /\ pc = "publishing"
  /\ board' = run /\ known' = run /\ pc' = "idle"
  /\ maxPublished' = IF run > maxPublished THEN run ELSE maxPublished
  /\ UNCHANGED run

Next == LoadBoard \/ EndRun \/ CheckOwn \/ Publish

Spec == Init /\ [][Next]_vars

\* The board never shows less than the player's best published score.
BoardKeepsBest == board = maxPublished
=============================================================================
