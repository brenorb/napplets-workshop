export const title = "Play a run of Breakoutlet";
export const state = (v) => ({
  ready: "Ball ready to launch",
  running: "Ball in play",
  paused: "Paused",
  over: "Run over, checking the board",
  published: "New best published",
  done: "Run complete, board unchanged",
}[v.phase]);
const steps = {
  Launch: "you launch",
  Pause: "you pause",
  Resume: "you resume",
  WallCleared: "you clear the wall or lose a ball",
  BallLost: "you clear the wall or lose a ball",
  LastBallLost: "you lose the last ball",
  NewBest: "the run beats your published best",
  NotBest: "it does not, or the board cannot confirm your best",
  BoardUnsure: "it does not, or the board cannot confirm your best",
  NewRun: "you start a new run",
};
export const step = (action) => steps[action] ?? null;
