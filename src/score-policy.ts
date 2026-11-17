/**
 * Whether a finished run may be published to the global board.
 *
 * Scores are kind 30078 addressable events, so a publish replaces the
 * player's previous score. `publishedBest` is the player's own score as the
 * relays hold it, or null when they could not say for sure; publishing then
 * could replace a higher score with a lower one.
 */
export function shouldPublishScore(runScore: number, publishedBest: number | null): boolean {
  return publishedBest !== null && runScore > publishedBest;
}

/** The run being considered for the board, captured when it ended. */
export interface ScoreRun {
  score: number;
  level: number;
  bricks: number;
}

/** The parts of the napplet outbox and board this path uses. */
export interface ScoreBoard<E> {
  outbox: {
    query(
      filter: { kinds: number[]; authors: string[]; '#d': string[]; limit: number },
      options: { relays: string[]; limit: number; timeoutMs: number },
    ): Promise<{ events: E[]; incomplete?: boolean; error?: string }>;
    publish(
      event: { kind: number; content: string; tags: string[][]; created_at: number },
      options: { relays: string[] },
    ): Promise<{ ok: boolean; error?: string }>;
  };
  kind: number;
  dTag: string;
  relays: string[];
  /** The player's best score in these events, 0 when they have none. */
  bestOf(events: E[], pubkey: string): number;
}

export type PublishOutcome =
  | { status: 'published'; score: number }
  | { status: 'kept'; best: number }
  | { status: 'unconfirmed' }
  | { status: 'failed'; score: number };

/** The player's own published score, or null when the relays cannot say for sure. */
export async function fetchPublishedBest<E>(board: ScoreBoard<E>, pubkey: string): Promise<number | null> {
  try {
    const result = await board.outbox.query(
      { kinds: [board.kind], authors: [pubkey], '#d': [board.dTag], limit: 10 },
      { relays: board.relays, limit: 10, timeoutMs: 6000 },
    );
    if (result.error || result.incomplete) return null;
    return board.bestOf(result.events, pubkey);
  } catch {
    return null;
  }
}

/**
 * Publish a finished run as the player's score event only when it beats the
 * best the relays confirm. The event is addressable, so a publish replaces the
 * player's previous score.
 */
export async function publishRunIfBest<E>(
  board: ScoreBoard<E>,
  pubkey: string,
  run: ScoreRun,
  playedAt: number,
): Promise<PublishOutcome> {
  const publishedBest = await fetchPublishedBest(board, pubkey);
  if (publishedBest === null) return { status: 'unconfirmed' };
  if (!shouldPublishScore(run.score, publishedBest)) return { status: 'kept', best: publishedBest };

  const payload = { version: 1, score: run.score, level: run.level, bricks: run.bricks, playedAt };
  try {
    const result = await board.outbox.publish(
      {
        kind: board.kind,
        content: JSON.stringify(payload),
        tags: [
          ['d', board.dTag],
          ['t', 'breakoutlet'],
        ],
        created_at: playedAt,
      },
      { relays: board.relays },
    );
    if (!result.ok) return { status: 'failed', score: run.score };
    return { status: 'published', score: run.score };
  } catch {
    return { status: 'failed', score: run.score };
  }
}
