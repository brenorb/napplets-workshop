-------------------------------- MODULE Play --------------------------------
\* A run of Breakoutlet, from the player's point of view.
VARIABLES phase

vars == <<phase>>

Init == phase = "ready"

Launch == phase = "ready" /\ phase' = "running"
Pause == phase = "running" /\ phase' = "paused"
Resume == phase = "paused" /\ phase' = "running"
WallCleared == phase = "running" /\ phase' = "ready"
BallLost == phase = "running" /\ phase' = "ready"
LastBallLost == phase = "running" /\ phase' = "over"
NewBest == phase = "over" /\ phase' = "published"
NotBest == phase = "over" /\ phase' = "done"
BoardUnsure == phase = "over" /\ phase' = "done"
NewRun == phase \in {"done", "published"} /\ phase' = "ready"

Next == Launch \/ Pause \/ Resume \/ WallCleared \/ BallLost \/ LastBallLost \/ NewBest \/ NotBest \/ BoardUnsure \/ NewRun

Spec == Init /\ [][Next]_vars

Known == phase \in {"ready", "running", "paused", "over", "published", "done"}
=============================================================================
