import '@napplet/shim';
import {
  identity,
  outbox,
  storage,
  themeGet,
  themeOnChanged,
  type NostrEvent,
  type Subscription,
  type Theme,
} from '@napplet/sdk';
import './styles.css';

const GAME_WIDTH = 720;
const GAME_HEIGHT = 800;
const SCORE_KIND = 30078;
const SCORE_D_TAG = 'breakoutlet/high-score/v1';
const SCOREBOARD_RELAYS = ['wss://nos.lol'];
const LOCAL_BEST_KEY = 'breakoutlet:best-score';
const MAX_SCORE = 100_000_000;

type NappletDomains = {
  outbox?: unknown;
  identity?: unknown;
  storage?: unknown;
  theme?: unknown;
};

type RuntimeWindow = Window & { napplet?: NappletDomains };
type GamePhase = 'ready' | 'running' | 'paused' | 'gameover';

type Brick = {
  x: number;
  y: number;
  width: number;
  height: number;
  alive: boolean;
  color: number;
};

type ScorePayload = {
  version: 1;
  score: number;
  level: number;
  bricks: number;
  playedAt: number;
};

type FinishedRun = {
  id: number;
  pubkey: string;
  payload: ScorePayload;
};

type LeaderboardEntry = ScorePayload & {
  pubkey: string;
  createdAt: number;
};

const runtime = window as RuntimeWindow;

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const app = requireElement<HTMLElement>('#app');
const canvas = requireElement<HTMLCanvasElement>('#game');

function requireCanvasContext(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const value = target.getContext('2d');
  if (!value) throw new Error('Canvas 2D is unavailable');
  return value;
}

const context = requireCanvasContext(canvas);

const elements = {
  score: requireElement<HTMLElement>('#score'),
  best: requireElement<HTMLElement>('#best'),
  level: requireElement<HTMLElement>('#level'),
  lives: requireElement<HTMLElement>('#lives'),
  message: requireElement<HTMLElement>('#gameMessage'),
  messageKicker: requireElement<HTMLElement>('#messageKicker'),
  messageTitle: requireElement<HTMLElement>('#messageTitle'),
  messageBody: requireElement<HTMLElement>('#messageBody'),
  gameStatus: requireElement<HTMLOutputElement>('#gameStatus'),
  launchButton: requireElement<HTMLButtonElement>('#launchButton'),
  leftButton: requireElement<HTMLButtonElement>('#leftButton'),
  rightButton: requireElement<HTMLButtonElement>('#rightButton'),
  refreshButton: requireElement<HTMLButtonElement>('#refreshButton'),
  leaderboard: requireElement<HTMLOListElement>('#leaderboard'),
  leaderboardStatus: requireElement<HTMLElement>('#leaderboardStatus'),
  identityStatus: requireElement<HTMLElement>('#identityStatus'),
};

const fallbackTheme: Theme = {
  colors: {
    background: '#070b16',
    text: '#f6f7fb',
    primary: '#ffcf33',
  },
};

let drawColors = {
  background: '#070b16',
  surface: '#11182a',
  border: '#30384d',
  text: '#f6f7fb',
  muted: '#979eb0',
  primary: '#ffcf33',
  paddle: '#f6f7fb',
};

let themeSubscription: Subscription | null = null;
let identitySubscription: Subscription | null = null;
let animationFrame = 0;
let lastFrameTime = 0;
let phase: GamePhase = 'ready';
let score = 0;
let bestScore = 0;
let level = 1;
let lives = 3;
let bricksBroken = 0;
let runId = 0;
let currentPubkey = '';
let leaderboardEntries: LeaderboardEntry[] = [];
let leaderboardLoading = false;
let scoreQueue = Promise.resolve();
const publishedBestByAuthor = new Map<string, number>();

const paddle = {
  x: GAME_WIDTH / 2 - 62,
  y: GAME_HEIGHT - 58,
  width: 124,
  height: 14,
  speed: 520,
};

const ball = {
  x: GAME_WIDTH / 2,
  y: paddle.y - 14,
  radius: 9,
  vx: 250,
  vy: -360,
};

const moveState = { left: false, right: false };
let bricks: Brick[] = [];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatScore(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString('en-US');
}

function shortPubkey(pubkey: string): string {
  return pubkey.length > 16 ? `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}` : pubkey;
}

function parseHex(color: string): [number, number, number] | null {
  const value = color.trim().replace(/^#/, '');
  const expanded = value.length === 3 ? [...value].map((character) => character.repeat(2)).join('') : value;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

function mixColor(base: string, overlay: string, amount: number): string {
  const from = parseHex(base);
  const to = parseHex(overlay);
  if (!from || !to) return base;
  const channels = from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * amount),
  );
  return `rgb(${channels.join(' ')})`;
}

function applyTheme(theme: Theme): void {
  const { background, text, primary } = theme.colors;
  const surface = mixColor(background, text, 0.07);
  const border = mixColor(background, text, 0.2);
  const muted = mixColor(background, text, 0.58);
  const root = document.documentElement;

  root.style.setProperty('--bg', background);
  root.style.setProperty('--text', text);
  root.style.setProperty('--primary', primary);
  root.style.setProperty('--surface', surface);
  root.style.setProperty('--border', border);
  root.style.setProperty('--muted', muted);
  root.style.backgroundColor = background;
  document.body.style.backgroundColor = background;
  document.body.style.color = text;
  app.style.backgroundColor = background;
  app.style.color = text;

  drawColors = {
    background,
    surface,
    border,
    text,
    muted,
    primary,
    paddle: text,
  };
}

async function initializeTheme(): Promise<void> {
  applyTheme(fallbackTheme);
  if (!runtime.napplet?.theme) return;
  try {
    applyTheme(await themeGet());
    themeSubscription = themeOnChanged(applyTheme);
  } catch {
    applyTheme(fallbackTheme);
  }
}

function showRuntimeGuard(): void {
  app.innerHTML = `
    <section class="runtime-guard" role="alert">
      <p class="eyebrow">Napplet runtime required</p>
      <h1>Open Breakoutlet in a compatible shell</h1>
      <p>The shell supplies the signed global leaderboard and sandboxed runtime.</p>
    </section>
  `;
}

function updateHud(): void {
  elements.score.textContent = formatScore(score);
  elements.best.textContent = formatScore(bestScore);
  elements.level.textContent = String(level);
  elements.lives.textContent = String(lives);
}

function setMessage(kicker: string, title: string, body: string, visible = true): void {
  elements.messageKicker.textContent = kicker;
  elements.messageTitle.textContent = title;
  elements.messageBody.textContent = body;
  elements.message.hidden = !visible;
}

function setGameStatus(message: string): void {
  elements.gameStatus.textContent = message;
}

function createBricks(): Brick[] {
  const rows = Math.min(9, 5 + level);
  const columns = 10;
  const gap = 8;
  const edge = 34;
  const top = 74;
  const height = 24;
  const width = (GAME_WIDTH - edge * 2 - gap * (columns - 1)) / columns;
  const result: Brick[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      result.push({
        x: edge + column * (width + gap),
        y: top + row * (height + gap),
        width,
        height,
        alive: true,
        color: row % 5,
      });
    }
  }

  return result;
}

function resetBall(direction = 1): void {
  paddle.x = GAME_WIDTH / 2 - paddle.width / 2;
  ball.x = GAME_WIDTH / 2;
  ball.y = paddle.y - ball.radius - 3;
  ball.vx = (220 + level * 14) * direction;
  ball.vy = -(350 + level * 18);
}

function resetRun(): void {
  runId += 1;
  score = 0;
  level = 1;
  lives = 3;
  bricksBroken = 0;
  bricks = createBricks();
  resetBall(Math.random() > 0.5 ? 1 : -1);
  phase = 'ready';
  elements.launchButton.textContent = 'Launch ball';
  setMessage('Ready?', 'Clear the wall', 'Move with your pointer or the arrow keys.');
  setGameStatus('Press Launch ball to begin.');
  updateHud();
}

function launchBall(): void {
  if (phase === 'gameover') {
    resetRun();
    return;
  }
  if (phase === 'paused') {
    phase = 'running';
    elements.launchButton.textContent = 'Pause';
    setMessage('', '', '', false);
    setGameStatus('Back in play.');
    return;
  }
  if (phase === 'running') {
    phase = 'paused';
    elements.launchButton.textContent = 'Resume';
    setMessage('Paused', 'Take a breath', 'Your run is waiting.');
    setGameStatus('Game paused.');
    return;
  }

  phase = 'running';
  elements.launchButton.textContent = 'Pause';
  setMessage('', '', '', false);
  setGameStatus(`Level ${level} is live.`);
  canvas.focus();
}

function circleHitsRect(rect: Brick): boolean {
  const closestX = clamp(ball.x, rect.x, rect.x + rect.width);
  const closestY = clamp(ball.y, rect.y, rect.y + rect.height);
  const deltaX = ball.x - closestX;
  const deltaY = ball.y - closestY;
  return deltaX * deltaX + deltaY * deltaY <= ball.radius * ball.radius;
}

function bounceFromBrick(brick: Brick): void {
  const overlapLeft = ball.x + ball.radius - brick.x;
  const overlapRight = brick.x + brick.width - (ball.x - ball.radius);
  const overlapTop = ball.y + ball.radius - brick.y;
  const overlapBottom = brick.y + brick.height - (ball.y - ball.radius);
  const minimum = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
  if (minimum === overlapLeft || minimum === overlapRight) ball.vx *= -1;
  else ball.vy *= -1;
}

function updateGame(deltaSeconds: number): void {
  if (phase !== 'running') {
    if (phase === 'ready') {
      ball.x = paddle.x + paddle.width / 2;
      ball.y = paddle.y - ball.radius - 3;
    }
    return;
  }

  const direction = Number(moveState.right) - Number(moveState.left);
  paddle.x = clamp(paddle.x + direction * paddle.speed * deltaSeconds, 18, GAME_WIDTH - paddle.width - 18);

  ball.x += ball.vx * deltaSeconds;
  ball.y += ball.vy * deltaSeconds;

  if (ball.x - ball.radius <= 14 && ball.vx < 0) {
    ball.x = 14 + ball.radius;
    ball.vx *= -1;
  }
  if (ball.x + ball.radius >= GAME_WIDTH - 14 && ball.vx > 0) {
    ball.x = GAME_WIDTH - 14 - ball.radius;
    ball.vx *= -1;
  }
  if (ball.y - ball.radius <= 14 && ball.vy < 0) {
    ball.y = 14 + ball.radius;
    ball.vy *= -1;
  }

  const paddleRect: Brick = { ...paddle, alive: true, color: 0 };
  if (ball.vy > 0 && circleHitsRect(paddleRect)) {
    ball.y = paddle.y - ball.radius - 1;
    const hit = clamp((ball.x - paddle.x) / paddle.width, 0, 1) * 2 - 1;
    const speed = Math.min(690, Math.hypot(ball.vx, ball.vy) * 1.025);
    const angle = hit * 1.08;
    ball.vx = Math.sin(angle) * speed;
    ball.vy = -Math.cos(angle) * speed;
  }

  for (const brick of bricks) {
    if (!brick.alive || !circleHitsRect(brick)) continue;
    brick.alive = false;
    bounceFromBrick(brick);
    bricksBroken += 1;
    score += 100 * level;
    if (score > bestScore) {
      bestScore = score;
      void persistBestScore();
    }
    updateHud();
    break;
  }

  if (bricks.every((brick) => !brick.alive)) {
    level += 1;
    score += 1_000 * (level - 1);
    bricks = createBricks();
    resetBall(level % 2 === 0 ? -1 : 1);
    phase = 'ready';
    elements.launchButton.textContent = 'Next level';
    setMessage('Wall cleared', `Level ${level}`, 'The ball is faster. The blocks are not impressed.');
    setGameStatus(`Level ${level} ready.`);
    updateHud();
  }

  if (ball.y - ball.radius > GAME_HEIGHT) {
    lives -= 1;
    updateHud();
    if (lives > 0) {
      resetBall(lives % 2 === 0 ? -1 : 1);
      phase = 'ready';
      elements.launchButton.textContent = 'Try again';
      setMessage('Ball lost', `${lives} ${lives === 1 ? 'life' : 'lives'} left`, 'Reset your angle and break through.');
      setGameStatus('Ball lost. Your score is safe.');
    } else {
      phase = 'gameover';
      elements.launchButton.textContent = 'New run';
      setMessage('Run complete', formatScore(score), currentPubkey ? 'Checking your global best…' : 'Connect an identity to join the global board.');
      setGameStatus('Run complete.');
      finishRun();
    }
  }
}

function drawRoundedRect(x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

function drawGame(): void {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  const ratio = canvas.width / GAME_WIDTH;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  context.fillStyle = drawColors.background;
  context.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  context.strokeStyle = drawColors.border;
  context.lineWidth = 2;
  context.strokeRect(14, 14, GAME_WIDTH - 28, GAME_HEIGHT - 28);

  const brickPalette = [
    drawColors.primary,
    '#ff6b6b',
    '#7ee787',
    '#70a7ff',
    '#c69cff',
  ];
  for (const brick of bricks) {
    if (!brick.alive) continue;
    context.fillStyle = brickPalette[brick.color] ?? drawColors.primary;
    drawRoundedRect(brick.x, brick.y, brick.width, brick.height, 6);
  }

  context.fillStyle = drawColors.paddle;
  context.shadowColor = drawColors.primary;
  context.shadowBlur = 18;
  drawRoundedRect(paddle.x, paddle.y, paddle.width, paddle.height, 7);
  context.shadowBlur = 0;

  context.fillStyle = drawColors.primary;
  context.beginPath();
  context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = drawColors.muted;
  context.font = '600 16px ui-monospace, monospace';
  context.textAlign = 'left';
  context.fillText(`L${level}`, 30, GAME_HEIGHT - 28);
  context.textAlign = 'right';
  context.fillText(formatScore(score), GAME_WIDTH - 30, GAME_HEIGHT - 28);
}

function frame(time: number): void {
  const elapsed = lastFrameTime === 0 ? 0 : Math.min(0.034, (time - lastFrameTime) / 1000);
  lastFrameTime = time;
  updateGame(elapsed);
  drawGame();
  animationFrame = window.requestAnimationFrame(frame);
}

function resizeCanvas(): void {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(GAME_WIDTH * ratio);
  canvas.height = Math.round(GAME_HEIGHT * ratio);
  drawGame();
}

function setPaddleFromPointer(event: PointerEvent): void {
  const bounds = canvas.getBoundingClientRect();
  const gameX = ((event.clientX - bounds.left) / bounds.width) * GAME_WIDTH;
  paddle.x = clamp(gameX - paddle.width / 2, 18, GAME_WIDTH - paddle.width - 18);
  if (phase === 'ready') {
    ball.x = paddle.x + paddle.width / 2;
  }
}

function attachHoldControl(button: HTMLButtonElement, direction: 'left' | 'right'): void {
  const stop = (): void => {
    moveState[direction] = false;
  };
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    moveState[direction] = true;
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('lostpointercapture', stop);
}

function handleGameKey(event: KeyboardEvent, pressed: boolean): void {
  if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
    event.preventDefault();
    moveState.left = pressed;
  }
  if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
    event.preventDefault();
    moveState.right = pressed;
  }
  if (pressed && (event.key === ' ' || event.key === 'Enter')) {
    event.preventDefault();
    launchBall();
  }
}

async function loadBestScore(): Promise<void> {
  if (!runtime.napplet?.storage) return;
  try {
    const saved = await storage.getItem(LOCAL_BEST_KEY);
    const parsed = Number(saved);
    if (Number.isSafeInteger(parsed) && parsed >= 0) bestScore = parsed;
    updateHud();
  } catch {
    setGameStatus('Local best is session-only in this shell.');
  }
}

async function persistBestScore(): Promise<void> {
  if (!runtime.napplet?.storage) return;
  try {
    await storage.setItem(LOCAL_BEST_KEY, String(bestScore));
  } catch {
    // The live session still retains the score when optional storage is unavailable.
  }
}

function parseScoreEvent(event: NostrEvent): LeaderboardEntry | null {
  if (event.kind !== SCORE_KIND) return null;
  if (!event.tags.some((tag) => tag[0] === 'd' && tag[1] === SCORE_D_TAG)) return null;

  try {
    const value = JSON.parse(event.content) as Partial<ScorePayload>;
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.score) ||
      !Number.isSafeInteger(value.level) ||
      !Number.isSafeInteger(value.bricks) ||
      !Number.isSafeInteger(value.playedAt) ||
      Number(value.score) < 0 ||
      Number(value.score) > MAX_SCORE ||
      Number(value.level) < 1 ||
      Number(value.bricks) < 0
    ) {
      return null;
    }

    return {
      version: 1,
      score: Number(value.score),
      level: Number(value.level),
      bricks: Number(value.bricks),
      playedAt: Number(value.playedAt),
      pubkey: event.pubkey,
      createdAt: event.created_at,
    };
  } catch {
    return null;
  }
}

function normalizeLeaderboard(events: NostrEvent[]): LeaderboardEntry[] {
  const bestByPlayer = new Map<string, LeaderboardEntry>();
  for (const event of events) {
    const entry = parseScoreEvent(event);
    if (!entry) continue;
    const existing = bestByPlayer.get(entry.pubkey);
    if (!existing || entry.score > existing.score || (entry.score === existing.score && entry.createdAt > existing.createdAt)) {
      bestByPlayer.set(entry.pubkey, entry);
    }
  }
  return [...bestByPlayer.values()].sort((left, right) => right.score - left.score || left.playedAt - right.playedAt);
}

function renderLeaderboard(): void {
  const top = leaderboardEntries.slice(0, 10);
  if (top.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'leaderboard-empty';
    empty.textContent = leaderboardLoading ? 'Loading the world’s best breakers…' : 'No signed scores yet. Be the first.';
    elements.leaderboard.replaceChildren(empty);
    return;
  }

  elements.leaderboard.replaceChildren(
    ...top.map((entry, index) => {
      const item = document.createElement('li');
      if (entry.pubkey === currentPubkey) item.classList.add('is-you');

      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = String(index + 1).padStart(2, '0');

      const player = document.createElement('span');
      player.className = 'player';
      player.textContent = entry.pubkey === currentPubkey ? 'YOU' : shortPubkey(entry.pubkey);

      const value = document.createElement('strong');
      value.className = 'leader-score';
      value.textContent = formatScore(entry.score);

      item.append(rank, player, value);
      return item;
    }),
  );
}

async function loadLeaderboard(): Promise<void> {
  if (!runtime.napplet?.outbox || leaderboardLoading) return;
  leaderboardLoading = true;
  elements.refreshButton.disabled = true;
  elements.refreshButton.classList.add('is-loading');
  elements.leaderboardStatus.textContent = 'Reading signed high scores…';
  renderLeaderboard();

  try {
    const result = await outbox.query(
      { kinds: [SCORE_KIND], '#d': [SCORE_D_TAG], limit: 100 },
      { relays: SCOREBOARD_RELAYS, limit: 100, timeoutMs: 6000 },
    );
    if (result.error) throw new Error(result.error);
    leaderboardEntries = normalizeLeaderboard(result.events);
    elements.leaderboardStatus.textContent = result.incomplete
      ? `Showing ${leaderboardEntries.length} verified score${leaderboardEntries.length === 1 ? '' : 's'} · partial relay result`
      : `${leaderboardEntries.length} verified player${leaderboardEntries.length === 1 ? '' : 's'} on the shared board`;
  } catch {
    elements.leaderboardStatus.textContent = 'The global board is temporarily unreachable. Your game still works.';
  } finally {
    leaderboardLoading = false;
    elements.refreshButton.disabled = false;
    elements.refreshButton.classList.remove('is-loading');
    renderLeaderboard();
  }
}

async function readPersonalBest(pubkey: string): Promise<number | null> {
  try {
    const result = await outbox.query(
      { kinds: [SCORE_KIND], authors: [pubkey], '#d': [SCORE_D_TAG], limit: 1 },
      { relays: SCOREBOARD_RELAYS, limit: 1, timeoutMs: 6000 },
    );
    if (result.error || result.incomplete) return null;
    if (result.events.length === 0) return 0;
    return normalizeLeaderboard(result.events).find((entry) => entry.pubkey === pubkey)?.score ?? null;
  } catch {
    return null;
  }
}

async function publishHighScore({ id, pubkey, payload }: FinishedRun): Promise<void> {
  const showResult = (kicker: string, body: string): void => {
    if (phase === 'gameover' && runId === id) setMessage(kicker, formatScore(payload.score), body);
  };
  const identityChanged = 'The active identity changed. This run stays local.';
  if (currentPubkey !== pubkey) {
    showResult('Run complete', identityChanged);
    return;
  }

  const previousBest = await readPersonalBest(pubkey);
  if (currentPubkey !== pubkey) {
    showResult('Run complete', identityChanged);
    return;
  }
  if (previousBest === null) {
    showResult('Run complete', 'Could not check your global best. This run stays local.');
    elements.leaderboardStatus.textContent = 'Personal best unavailable. No score was published.';
    return;
  }
  const best = Math.max(previousBest, publishedBestByAuthor.get(pubkey) ?? 0);
  if (payload.score <= best) {
    showResult('Run complete', `Your global best is ${formatScore(best)}.`);
    return;
  }

  try {
    const activePubkey = await identity.getPublicKey();
    if (activePubkey !== pubkey || currentPubkey !== pubkey) {
      showResult('Run complete', identityChanged);
      return;
    }
    elements.leaderboardStatus.textContent = 'Signing your new personal best…';
    const result = await outbox.publish(
      {
        kind: SCORE_KIND,
        content: JSON.stringify(payload),
        tags: [
          ['d', SCORE_D_TAG],
          ['t', 'breakoutlet'],
        ],
        created_at: Math.floor(Date.now() / 1000),
      },
      { relays: SCOREBOARD_RELAYS },
    );
    if (!result.ok) throw new Error(result.error ?? 'Score publish failed');
    if (result.event && result.event.pubkey !== pubkey) throw new Error('Score signed by a different identity');
    publishedBestByAuthor.set(pubkey, payload.score);
    showResult('New personal best', 'Signed and published to the global board.');
    elements.leaderboardStatus.textContent = 'New personal best published.';
    void loadLeaderboard();
  } catch {
    showResult('Run complete', 'The shell did not confirm publication of this run.');
    elements.leaderboardStatus.textContent = 'Could not confirm this run on the global board.';
  }
}

function finishRun(): void {
  if (score > bestScore) {
    bestScore = score;
    void persistBestScore();
    updateHud();
  }
  if (!currentPubkey || !runtime.napplet?.outbox) return;
  const run: FinishedRun = {
    id: runId,
    pubkey: currentPubkey,
    payload: {
      version: 1,
      score,
      level,
      bricks: bricksBroken,
      playedAt: Math.floor(Date.now() / 1000),
    },
  };
  scoreQueue = scoreQueue.then(() => publishHighScore(run));
}

async function refreshIdentity(): Promise<void> {
  if (!runtime.napplet?.identity) {
    currentPubkey = '';
    elements.identityStatus.textContent = 'Play locally · identity unavailable in this shell';
    renderLeaderboard();
    return;
  }

  try {
    currentPubkey = await identity.getPublicKey();
    elements.identityStatus.textContent = currentPubkey
      ? `Playing as ${shortPubkey(currentPubkey)}`
      : 'Playing locally · connect an identity to publish scores';
    renderLeaderboard();
  } catch {
    currentPubkey = '';
    elements.identityStatus.textContent = 'Playing locally · identity unavailable';
  }
}

function subscribeToIdentity(): void {
  if (!runtime.napplet?.identity) return;
  try {
    identitySubscription = identity.onChanged((pubkey) => {
      currentPubkey = pubkey;
      elements.identityStatus.textContent = pubkey
        ? `Playing as ${shortPubkey(pubkey)}`
        : 'Playing locally · connect an identity to publish scores';
      renderLeaderboard();
    });
  } catch {
    identitySubscription = null;
  }
}

function bindControls(): void {
  elements.launchButton.addEventListener('click', launchBall);
  elements.refreshButton.addEventListener('click', () => void loadLeaderboard());
  canvas.addEventListener('pointermove', setPaddleFromPointer);
  canvas.addEventListener('pointerdown', (event) => {
    setPaddleFromPointer(event);
    canvas.focus();
  });
  canvas.addEventListener('keydown', (event) => handleGameKey(event, true));
  canvas.addEventListener('keyup', (event) => handleGameKey(event, false));
  canvas.addEventListener('blur', () => {
    moveState.left = false;
    moveState.right = false;
  });
  attachHoldControl(elements.leftButton, 'left');
  attachHoldControl(elements.rightButton, 'right');
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && phase === 'running') launchBall();
  });
}

async function initialize(): Promise<void> {
  if (!runtime.napplet) {
    showRuntimeGuard();
    return;
  }

  await initializeTheme();
  bindControls();
  resetRun();
  resizeCanvas();
  subscribeToIdentity();
  await Promise.allSettled([loadBestScore(), refreshIdentity()]);
  void loadLeaderboard();
  animationFrame = window.requestAnimationFrame(frame);
}

window.addEventListener('beforeunload', () => {
  window.cancelAnimationFrame(animationFrame);
  identitySubscription?.close();
  themeSubscription?.close();
});

void initialize();
