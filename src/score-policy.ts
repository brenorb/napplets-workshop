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
